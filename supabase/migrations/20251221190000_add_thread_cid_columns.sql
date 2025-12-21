-- Add thread CID columns to match Bluesky's reply structure exactly
-- 
-- AT Protocol reply structure requires:
--   reply.root: { uri, cid }
--   reply.parent: { uri, cid }
--
-- We already have thread_root_uri and thread_parent_uri.
-- Adding CID columns so federation triggers don't need to look them up.

-- Add the missing CID columns
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thread_root_cid TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thread_parent_cid TEXT;

-- Add comments
COMMENT ON COLUMN posts.thread_root_uri IS 'AT URI of thread root post (for federation)';
COMMENT ON COLUMN posts.thread_root_cid IS 'CID of thread root post at time of reply (for federation)';
COMMENT ON COLUMN posts.thread_parent_uri IS 'AT URI of parent post (for federation)';
COMMENT ON COLUMN posts.thread_parent_cid IS 'CID of parent post at time of reply (for federation)';

-- Update queue_post_for_federation to use stored CIDs instead of looking them up
-- This makes federation simpler and supports external (non-Cannect) parent posts
CREATE OR REPLACE FUNCTION queue_post_for_federation()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_user_did TEXT;
  v_rkey TEXT;
  v_at_uri TEXT;
  v_record_data JSONB;
  v_parent_uri TEXT;
  v_parent_cid TEXT;
  v_root_uri TEXT;
  v_root_cid TEXT;
  v_quoted_uri TEXT;
  v_quoted_cid TEXT;
BEGIN
  -- Skip if user doesn't have a DID (not federated)
  SELECT did INTO v_user_did FROM profiles WHERE id = NEW.user_id;
  IF v_user_did IS NULL THEN
    RAISE NOTICE 'Skipping post federation: user % has no DID', NEW.user_id;
    RETURN NEW;
  END IF;
  
  -- Generate rkey using TID format
  v_rkey := generate_tid();
  
  -- Build the AT URI
  v_at_uri := 'at://' || v_user_did || '/app.bsky.feed.post/' || v_rkey;
  
  -- Update the post with AT Protocol fields BEFORE building record
  UPDATE posts SET 
    at_uri = v_at_uri, 
    rkey = v_rkey
  WHERE id = NEW.id;
  
  -- Build the base AT Protocol record
  v_record_data := jsonb_build_object(
    '$type', 'app.bsky.feed.post',
    'text', COALESCE(NEW.content, ''),
    'createdAt', to_char(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'langs', COALESCE(NEW.langs, ARRAY['en'])
  );
  
  -- Add facets if present
  IF NEW.facets IS NOT NULL THEN
    v_record_data := v_record_data || jsonb_build_object('facets', NEW.facets);
  END IF;
  
  -- Add reply reference if this is a reply
  IF NEW.thread_parent_id IS NOT NULL THEN
    -- First check if URIs/CIDs are already stored (preferred)
    IF NEW.thread_parent_uri IS NOT NULL AND NEW.thread_parent_cid IS NOT NULL THEN
      v_parent_uri := NEW.thread_parent_uri;
      v_parent_cid := NEW.thread_parent_cid;
      v_root_uri := COALESCE(NEW.thread_root_uri, NEW.thread_parent_uri);
      v_root_cid := COALESCE(NEW.thread_root_cid, NEW.thread_parent_cid);
    ELSE
      -- Fallback: Look up from parent post (for backward compatibility)
      SELECT at_uri, at_cid INTO v_parent_uri, v_parent_cid
      FROM posts WHERE id = NEW.thread_parent_id;
      
      SELECT at_uri, at_cid INTO v_root_uri, v_root_cid
      FROM posts WHERE id = COALESCE(NEW.thread_root_id, NEW.thread_parent_id);
      
      -- Store for future reference
      UPDATE posts SET
        thread_parent_uri = v_parent_uri,
        thread_parent_cid = v_parent_cid,
        thread_root_uri = COALESCE(v_root_uri, v_parent_uri),
        thread_root_cid = COALESCE(v_root_cid, v_parent_cid)
      WHERE id = NEW.id;
    END IF;
    
    -- Only add reply reference if we have the required info
    IF v_parent_uri IS NOT NULL AND v_parent_cid IS NOT NULL THEN
      v_record_data := v_record_data || jsonb_build_object(
        'reply', jsonb_build_object(
          'root', jsonb_build_object(
            'uri', COALESCE(v_root_uri, v_parent_uri), 
            'cid', COALESCE(v_root_cid, v_parent_cid)
          ),
          'parent', jsonb_build_object(
            'uri', v_parent_uri, 
            'cid', v_parent_cid
          )
        )
      );
    END IF;
  END IF;
  
  -- Add embed for quote posts (when embed_record_uri is set OR repost_of_id with content)
  IF NEW.embed_record_uri IS NOT NULL AND NEW.embed_record_cid IS NOT NULL THEN
    -- Use stored embed URIs (preferred)
    v_record_data := v_record_data || jsonb_build_object(
      'embed', jsonb_build_object(
        '$type', 'app.bsky.embed.record',
        'record', jsonb_build_object(
          'uri', NEW.embed_record_uri,
          'cid', NEW.embed_record_cid
        )
      )
    );
  ELSIF NEW.repost_of_id IS NOT NULL AND NEW.content IS NOT NULL AND NEW.content != '' THEN
    -- Fallback: Look up from quoted post (backward compatibility)
    SELECT at_uri, at_cid INTO v_quoted_uri, v_quoted_cid
    FROM posts WHERE id = NEW.repost_of_id;
    
    IF v_quoted_uri IS NOT NULL AND v_quoted_cid IS NOT NULL THEN
      v_record_data := v_record_data || jsonb_build_object(
        'embed', jsonb_build_object(
          '$type', 'app.bsky.embed.record',
          'record', jsonb_build_object(
            'uri', v_quoted_uri,
            'cid', v_quoted_cid
          )
        )
      );
      
      -- Store for future reference
      UPDATE posts SET 
        embed_type = 'record',
        embed_record_uri = v_quoted_uri,
        embed_record_cid = v_quoted_cid
      WHERE id = NEW.id;
    END IF;
  END IF;
  
  -- Add to federation queue
  INSERT INTO federation_queue (
    record_type,
    record_id,
    user_did,
    collection,
    rkey,
    at_uri,
    record_data,
    operation,
    status
  ) VALUES (
    CASE 
      WHEN NEW.is_reply THEN 'reply' 
      ELSE 'post' 
    END,
    NEW.id,
    v_user_did,
    'app.bsky.feed.post',
    v_rkey,
    v_at_uri,
    v_record_data,
    'create',
    'pending'
  )
  ON CONFLICT (record_type, record_id, operation) 
  DO UPDATE SET
    record_data = EXCLUDED.record_data,
    status = 'pending',
    attempts = 0,
    last_error = NULL,
    created_at = NOW();
  
  RAISE NOTICE 'Queued post % for federation: %', NEW.id, v_at_uri;
  
  RETURN NEW;
END;
$$;
