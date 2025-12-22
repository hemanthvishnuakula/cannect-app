-- =============================================================================
-- External Interactions: Allow liking/reposting external Bluesky posts
-- =============================================================================
-- This migration makes post_id nullable so users can interact with
-- external Bluesky posts that don't exist in our local database.
-- =============================================================================

-- =============================================================================
-- LIKES TABLE: Make post_id nullable
-- =============================================================================

-- Drop foreign key first
ALTER TABLE likes DROP CONSTRAINT IF EXISTS likes_post_id_fkey;

-- Make post_id nullable
ALTER TABLE likes ALTER COLUMN post_id DROP NOT NULL;

-- Recreate foreign key allowing NULL
ALTER TABLE likes ADD CONSTRAINT likes_post_id_fkey 
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

-- Add check constraint: must have either post_id OR subject_uri
ALTER TABLE likes ADD CONSTRAINT likes_must_have_target 
  CHECK (post_id IS NOT NULL OR subject_uri IS NOT NULL);

-- Drop old unique constraint
ALTER TABLE likes DROP CONSTRAINT IF EXISTS likes_user_id_post_id_key;

-- Create new unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_local_unique 
  ON likes(user_id, post_id) 
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_external_unique 
  ON likes(user_id, subject_uri) 
  WHERE post_id IS NULL AND subject_uri IS NOT NULL;

-- =============================================================================
-- REPOSTS TABLE: Make post_id nullable
-- =============================================================================

-- Drop foreign key first
ALTER TABLE reposts DROP CONSTRAINT IF EXISTS reposts_post_id_fkey;

-- Make post_id nullable
ALTER TABLE reposts ALTER COLUMN post_id DROP NOT NULL;

-- Recreate foreign key allowing NULL
ALTER TABLE reposts ADD CONSTRAINT reposts_post_id_fkey 
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

-- Add check constraint: must have either post_id OR subject_uri
ALTER TABLE reposts ADD CONSTRAINT reposts_must_have_target 
  CHECK (post_id IS NOT NULL OR subject_uri IS NOT NULL);

-- Drop old unique constraint
ALTER TABLE reposts DROP CONSTRAINT IF EXISTS reposts_user_id_post_id_key;

-- Create new unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_reposts_local_unique 
  ON reposts(user_id, post_id) 
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reposts_external_unique 
  ON reposts(user_id, subject_uri) 
  WHERE post_id IS NULL AND subject_uri IS NOT NULL;

-- =============================================================================
-- Update federation triggers to handle external interactions
-- =============================================================================

-- Like trigger: handle external likes
CREATE OR REPLACE FUNCTION queue_like_for_federation()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public, extensions
LANGUAGE plpgsql AS $$
DECLARE
  v_user_did TEXT;
  v_post_at_uri TEXT;
  v_post_at_cid TEXT;
  v_rkey TEXT;
  v_at_uri TEXT;
  v_record_data JSONB;
BEGIN
  -- Get user's DID
  SELECT did INTO v_user_did FROM profiles WHERE id = NEW.user_id;
  
  -- Skip if user isn't federated
  IF v_user_did IS NULL THEN
    RAISE NOTICE 'Skipping like federation - user % has no DID', NEW.user_id;
    RETURN NEW;
  END IF;
  
  -- Get subject URI/CID: prefer explicit values, fallback to post lookup
  v_post_at_uri := NEW.subject_uri;
  v_post_at_cid := NEW.subject_cid;
  
  -- If no explicit subject, lookup from local post
  IF v_post_at_uri IS NULL AND NEW.post_id IS NOT NULL THEN
    SELECT posts.at_uri, posts.at_cid 
    INTO v_post_at_uri, v_post_at_cid
    FROM posts WHERE id = NEW.post_id;
  END IF;
  
  -- Skip if no AT URI available
  IF v_post_at_uri IS NULL THEN
    RAISE NOTICE 'Skipping like federation - no AT URI for subject';
    RETURN NEW;
  END IF;
  
  -- Skip if no CID yet (post not synced)
  IF v_post_at_cid IS NULL THEN
    RAISE NOTICE 'Skipping like federation - no CID for subject';
    RETURN NEW;
  END IF;
  
  -- Generate rkey if not set
  v_rkey := NEW.rkey;
  IF v_rkey IS NULL THEN
    v_rkey := REPLACE(REPLACE(REPLACE(encode(gen_random_bytes(10), 'base64'), '/', '_'), '+', '-'), '=', '');
  END IF;
  
  -- Build AT URI for the like
  v_at_uri := 'at://' || v_user_did || '/app.bsky.feed.like/' || v_rkey;
  
  -- Update the like record with AT fields
  UPDATE likes SET
    rkey = v_rkey,
    at_uri = v_at_uri,
    subject_uri = v_post_at_uri,
    subject_cid = v_post_at_cid
  WHERE id = NEW.id;
  
  -- Build the AT Protocol record
  v_record_data := jsonb_build_object(
    '$type', 'app.bsky.feed.like',
    'subject', jsonb_build_object(
      'uri', v_post_at_uri,
      'cid', v_post_at_cid
    ),
    'createdAt', to_char(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  
  -- Add to federation queue
  INSERT INTO federation_queue (
    record_type, record_id, user_did, collection, rkey, at_uri, record_data, operation, status
  ) VALUES (
    'like', NEW.id, v_user_did, 'app.bsky.feed.like', v_rkey, v_at_uri, v_record_data, 'create', 'pending'
  )
  ON CONFLICT (record_type, record_id, operation) 
  DO UPDATE SET
    record_data = EXCLUDED.record_data,
    status = 'pending',
    attempts = 0,
    last_error = NULL,
    created_at = NOW();
  
  RAISE NOTICE 'Queued like for federation: %', v_at_uri;
  RETURN NEW;
END;
$$;

-- Repost trigger: handle external reposts
CREATE OR REPLACE FUNCTION queue_repost_for_federation()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public, extensions
LANGUAGE plpgsql AS $$
DECLARE
  v_user_did TEXT;
  v_post_at_uri TEXT;
  v_post_at_cid TEXT;
  v_rkey TEXT;
  v_at_uri TEXT;
  v_record_data JSONB;
BEGIN
  -- Get user's DID
  SELECT did INTO v_user_did FROM profiles WHERE id = NEW.user_id;
  
  IF v_user_did IS NULL THEN
    RAISE NOTICE 'Skipping repost federation - user % has no DID', NEW.user_id;
    RETURN NEW;
  END IF;
  
  -- Get subject URI/CID: prefer explicit values, fallback to post lookup
  v_post_at_uri := NEW.subject_uri;
  v_post_at_cid := NEW.subject_cid;
  
  IF v_post_at_uri IS NULL AND NEW.post_id IS NOT NULL THEN
    SELECT posts.at_uri, posts.at_cid 
    INTO v_post_at_uri, v_post_at_cid
    FROM posts WHERE id = NEW.post_id;
  END IF;
  
  IF v_post_at_uri IS NULL THEN
    RAISE NOTICE 'Skipping repost federation - no AT URI for subject';
    RETURN NEW;
  END IF;
  
  IF v_post_at_cid IS NULL THEN
    RAISE NOTICE 'Skipping repost federation - no CID for subject';
    RETURN NEW;
  END IF;
  
  -- Generate rkey
  v_rkey := NEW.rkey;
  IF v_rkey IS NULL THEN
    v_rkey := REPLACE(REPLACE(REPLACE(encode(gen_random_bytes(10), 'base64'), '/', '_'), '+', '-'), '=', '');
  END IF;
  
  v_at_uri := 'at://' || v_user_did || '/app.bsky.feed.repost/' || v_rkey;
  
  UPDATE reposts SET
    rkey = v_rkey,
    at_uri = v_at_uri,
    subject_uri = v_post_at_uri,
    subject_cid = v_post_at_cid
  WHERE id = NEW.id;
  
  v_record_data := jsonb_build_object(
    '$type', 'app.bsky.feed.repost',
    'subject', jsonb_build_object(
      'uri', v_post_at_uri,
      'cid', v_post_at_cid
    ),
    'createdAt', to_char(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  
  INSERT INTO federation_queue (
    record_type, record_id, user_did, collection, rkey, at_uri, record_data, operation, status
  ) VALUES (
    'repost', NEW.id, v_user_did, 'app.bsky.feed.repost', v_rkey, v_at_uri, v_record_data, 'create', 'pending'
  )
  ON CONFLICT (record_type, record_id, operation) 
  DO UPDATE SET
    record_data = EXCLUDED.record_data,
    status = 'pending',
    attempts = 0,
    last_error = NULL,
    created_at = NOW();
  
  RAISE NOTICE 'Queued repost for federation: %', v_at_uri;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON COLUMN likes.post_id IS 'Local post ID (NULL for external Bluesky likes)';
COMMENT ON COLUMN reposts.post_id IS 'Local post ID (NULL for external Bluesky reposts)';
