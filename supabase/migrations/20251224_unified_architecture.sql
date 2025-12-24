-- ============================================================================
-- UNIFIED ARCHITECTURE MIGRATION
-- ============================================================================
-- Version: 2.1 - December 24, 2025
-- 
-- This migration implements the unified architecture:
-- - actor_did column on likes/reposts (universal identifier)
-- - cached_profiles table (external users)
-- - cached_posts table (external posts)  
-- - cached_follows table (external relationships)
-- - Triggers for cache maintenance
-- ============================================================================

-- ============================================================================
-- PHASE 1.1: LIKES TABLE - Add actor_did, make user_id nullable
-- ============================================================================

-- Add actor_did column
ALTER TABLE likes ADD COLUMN IF NOT EXISTS actor_did TEXT;

-- Backfill actor_did from profiles
UPDATE likes 
SET actor_did = p.did 
FROM profiles p 
WHERE likes.user_id = p.id 
  AND likes.actor_did IS NULL;

-- Make actor_did NOT NULL after backfill
ALTER TABLE likes ALTER COLUMN actor_did SET NOT NULL;

-- Make user_id nullable (for external actors)
ALTER TABLE likes ALTER COLUMN user_id DROP NOT NULL;

-- Add unique constraint on actor_did + subject_uri
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_actor_subject_unique 
  ON likes(actor_did, subject_uri) 
  WHERE subject_uri IS NOT NULL;

-- Update existing constraint comment
COMMENT ON TABLE likes IS 'Likes from both Cannect users and external users. actor_did identifies who liked (universal). user_id is set only for Cannect users.';

-- ============================================================================
-- PHASE 1.2: REPOSTS TABLE - Add actor_did, make user_id nullable
-- ============================================================================

-- Add actor_did column
ALTER TABLE reposts ADD COLUMN IF NOT EXISTS actor_did TEXT;

-- Backfill actor_did from profiles
UPDATE reposts 
SET actor_did = p.did 
FROM profiles p 
WHERE reposts.user_id = p.id 
  AND reposts.actor_did IS NULL;

-- Make actor_did NOT NULL after backfill
ALTER TABLE reposts ALTER COLUMN actor_did SET NOT NULL;

-- Make user_id nullable (for external actors)
ALTER TABLE reposts ALTER COLUMN user_id DROP NOT NULL;

-- Add unique constraint on actor_did + subject_uri
CREATE UNIQUE INDEX IF NOT EXISTS idx_reposts_actor_subject_unique 
  ON reposts(actor_did, subject_uri) 
  WHERE subject_uri IS NOT NULL;

COMMENT ON TABLE reposts IS 'Reposts from both Cannect users and external users. actor_did identifies who reposted (universal). user_id is set only for Cannect users.';

-- ============================================================================
-- PHASE 1.3: CACHED_PROFILES TABLE (External users)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cached_profiles (
  -- Primary identity (DID is universal)
  did TEXT PRIMARY KEY,
  
  -- Profile data
  handle TEXT NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  
  -- Counts (snapshot at cache time)
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  
  -- Caching metadata
  cached_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  refreshed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  access_count INTEGER DEFAULT 1,
  
  -- Retention flags (prevent cleanup if true)
  has_interaction BOOLEAN DEFAULT FALSE,   -- Cannect user interacted with this profile
  is_follower BOOLEAN DEFAULT FALSE,       -- Follows a Cannect user
  is_following BOOLEAN DEFAULT FALSE,      -- Followed by a Cannect user
  pin_until TIMESTAMPTZ                    -- Manual pin (admin override)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cached_profiles_handle ON cached_profiles(handle);
CREATE INDEX IF NOT EXISTS idx_cached_profiles_cleanup ON cached_profiles(last_accessed_at) 
  WHERE NOT has_interaction AND NOT is_follower AND NOT is_following AND pin_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_cached_profiles_refreshed ON cached_profiles(refreshed_at);

COMMENT ON TABLE cached_profiles IS 'Cached profiles of external users (from other PDSes). Used for display in followers list, global feed, etc.';

-- ============================================================================
-- PHASE 1.4: CACHED_POSTS TABLE (External posts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cached_posts (
  -- Primary identity (AT URI is universal)
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  
  -- Author (references cached_profiles)
  author_did TEXT NOT NULL REFERENCES cached_profiles(did) ON DELETE CASCADE,
  
  -- Content
  content TEXT,
  facets JSONB,              -- Mentions, links, hashtags
  media_urls TEXT[],
  embed_data JSONB,          -- Full embed (quotes, links, etc.)
  
  -- Threading
  reply_parent_uri TEXT,
  reply_root_uri TEXT,
  
  -- Counts (snapshot at cache time)
  likes_count INTEGER DEFAULT 0,
  reposts_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  
  -- Timestamps
  post_created_at TIMESTAMPTZ NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  refreshed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  access_count INTEGER DEFAULT 1,
  
  -- Retention flags (prevent cleanup if true)
  has_cannect_like BOOLEAN DEFAULT FALSE,    -- A Cannect user liked this
  has_cannect_repost BOOLEAN DEFAULT FALSE,  -- A Cannect user reposted this
  has_cannect_reply BOOLEAN DEFAULT FALSE,   -- A Cannect user replied to this
  is_reply_to_cannect BOOLEAN DEFAULT FALSE, -- This is a reply to a Cannect post
  
  -- Source tracking
  source TEXT DEFAULT 'feed' CHECK (source IN ('feed', 'thread', 'profile', 'quote', 'search'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cached_posts_author ON cached_posts(author_did);
CREATE INDEX IF NOT EXISTS idx_cached_posts_cleanup ON cached_posts(last_accessed_at) 
  WHERE NOT has_cannect_like AND NOT has_cannect_repost AND NOT has_cannect_reply AND NOT is_reply_to_cannect;
CREATE INDEX IF NOT EXISTS idx_cached_posts_thread ON cached_posts(reply_root_uri) WHERE reply_root_uri IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cached_posts_created ON cached_posts(post_created_at DESC);

COMMENT ON TABLE cached_posts IS 'Cached posts from external users (global feed, etc.). Retained if Cannect users interacted.';

-- ============================================================================
-- PHASE 1.5: CACHED_FOLLOWS TABLE (External follow relationships)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cached_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who follows whom
  follower_did TEXT NOT NULL,
  following_did TEXT NOT NULL,
  at_uri TEXT,               -- Follow record URI
  
  -- At least one side must be a Cannect user
  follower_is_cannect BOOLEAN DEFAULT FALSE,
  following_is_cannect BOOLEAN DEFAULT FALSE,
  
  -- Caching metadata
  cached_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  refreshed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Constraints
  CONSTRAINT cached_follows_unique UNIQUE (follower_did, following_did),
  CONSTRAINT cached_follows_has_cannect CHECK (follower_is_cannect OR following_is_cannect)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cached_follows_follower ON cached_follows(follower_did);
CREATE INDEX IF NOT EXISTS idx_cached_follows_following ON cached_follows(following_did);
CREATE INDEX IF NOT EXISTS idx_cached_follows_stale ON cached_follows(refreshed_at);

COMMENT ON TABLE cached_follows IS 'Cached follow relationships involving at least one Cannect user. Used for followers list display.';

-- ============================================================================
-- PHASE 1.6: TRIGGERS & FUNCTIONS
-- ============================================================================

-- Function: Mark cached post as liked by Cannect user
CREATE OR REPLACE FUNCTION mark_cached_post_liked()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject_uri IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    -- This is a Cannect user liking a post
    UPDATE cached_posts
    SET has_cannect_like = TRUE
    WHERE uri = NEW.subject_uri;
    
    -- Also mark the author as interacted
    UPDATE cached_profiles
    SET has_interaction = TRUE
    WHERE did = (SELECT author_did FROM cached_posts WHERE uri = NEW.subject_uri);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_mark_cached_post_liked ON likes;
CREATE TRIGGER trigger_mark_cached_post_liked
  AFTER INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION mark_cached_post_liked();

-- Function: Mark cached post as reposted by Cannect user
CREATE OR REPLACE FUNCTION mark_cached_post_reposted()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject_uri IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    UPDATE cached_posts
    SET has_cannect_repost = TRUE
    WHERE uri = NEW.subject_uri;
    
    UPDATE cached_profiles
    SET has_interaction = TRUE
    WHERE did = (SELECT author_did FROM cached_posts WHERE uri = NEW.subject_uri);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_mark_cached_post_reposted ON reposts;
CREATE TRIGGER trigger_mark_cached_post_reposted
  AFTER INSERT ON reposts
  FOR EACH ROW EXECUTE FUNCTION mark_cached_post_reposted();

-- Function: Touch cached post (update access tracking)
CREATE OR REPLACE FUNCTION touch_cached_post(post_uri TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cached_posts
  SET last_accessed_at = NOW(),
      access_count = access_count + 1
  WHERE uri = post_uri;
END;
$$;

-- Function: Batch touch cached posts
CREATE OR REPLACE FUNCTION touch_cached_posts(post_uris TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cached_posts
  SET last_accessed_at = NOW(),
      access_count = access_count + 1
  WHERE uri = ANY(post_uris);
END;
$$;

-- Function: Touch cached profile
CREATE OR REPLACE FUNCTION touch_cached_profile(profile_did TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cached_profiles
  SET last_accessed_at = NOW(),
      access_count = access_count + 1
  WHERE did = profile_did;
END;
$$;

-- ============================================================================
-- PHASE 7.1: CLEANUP CRON JOBS (pg_cron)
-- ============================================================================
-- Note: These require pg_cron extension to be enabled

-- Cleanup ephemeral cached posts (24h old, access_count=1, no interactions)
-- Run hourly
SELECT cron.schedule('cleanup-ephemeral-cached-posts', '0 * * * *', $$
  DELETE FROM cached_posts
  WHERE access_count = 1
    AND last_accessed_at < NOW() - INTERVAL '24 hours'
    AND NOT has_cannect_like
    AND NOT has_cannect_repost
    AND NOT has_cannect_reply
    AND NOT is_reply_to_cannect;
$$);

-- Cleanup standard cached posts (7d old, access_count<3, no interactions)
-- Run daily at 3 AM UTC
SELECT cron.schedule('cleanup-standard-cached-posts', '0 3 * * *', $$
  DELETE FROM cached_posts
  WHERE access_count < 3
    AND last_accessed_at < NOW() - INTERVAL '7 days'
    AND NOT has_cannect_like
    AND NOT has_cannect_repost
    AND NOT has_cannect_reply
    AND NOT is_reply_to_cannect;

  -- Also cleanup orphaned cached profiles
  DELETE FROM cached_profiles
  WHERE last_accessed_at < NOW() - INTERVAL '7 days'
    AND NOT has_interaction
    AND NOT is_follower
    AND NOT is_following
    AND pin_until IS NULL
    AND NOT EXISTS (SELECT 1 FROM cached_posts WHERE author_did = cached_profiles.did);
$$);

-- Cleanup extended cached posts (30d old, no permanent retention)
-- Run weekly on Sunday at 4 AM UTC
SELECT cron.schedule('cleanup-extended-cached-posts', '0 4 * * 0', $$
  DELETE FROM cached_posts
  WHERE last_accessed_at < NOW() - INTERVAL '30 days'
    AND NOT has_cannect_like
    AND NOT has_cannect_repost
    AND NOT has_cannect_reply
    AND NOT is_reply_to_cannect;
$$);

-- Mark stale cached_follows for refresh (older than 7 days)
-- Run weekly on Sunday at 5 AM UTC
SELECT cron.schedule('mark-stale-cached-follows', '0 5 * * 0', $$
  UPDATE cached_follows
  SET refreshed_at = NULL
  WHERE refreshed_at < NOW() - INTERVAL '7 days';
$$);


-- ============================================================================
-- RLS POLICIES FOR NEW TABLES
-- ============================================================================

-- Enable RLS
ALTER TABLE cached_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cached_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cached_follows ENABLE ROW LEVEL SECURITY;

-- cached_profiles: Public read, service role write
CREATE POLICY "cached_profiles_public_read" ON cached_profiles
  FOR SELECT USING (true);

CREATE POLICY "cached_profiles_service_write" ON cached_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- cached_posts: Public read, service role write
CREATE POLICY "cached_posts_public_read" ON cached_posts
  FOR SELECT USING (true);

CREATE POLICY "cached_posts_service_write" ON cached_posts
  FOR ALL USING (auth.role() = 'service_role');

-- cached_follows: Public read, service role write
CREATE POLICY "cached_follows_public_read" ON cached_follows
  FOR SELECT USING (true);

CREATE POLICY "cached_follows_service_write" ON cached_follows
  FOR ALL USING (auth.role() = 'service_role');

-- Update likes RLS for new actor_did column
DROP POLICY IF EXISTS "Users can view all likes" ON likes;
CREATE POLICY "likes_public_read" ON likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own likes" ON likes;
CREATE POLICY "likes_cannect_insert" ON likes
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can delete their own likes" ON likes;
CREATE POLICY "likes_cannect_delete" ON likes
  FOR DELETE USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Update reposts RLS for new actor_did column
DROP POLICY IF EXISTS "Users can view all reposts" ON reposts;
CREATE POLICY "reposts_public_read" ON reposts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own reposts" ON reposts;
CREATE POLICY "reposts_cannect_insert" ON reposts
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can delete their own reposts" ON reposts;
CREATE POLICY "reposts_cannect_delete" ON reposts
  FOR DELETE USING (auth.uid() = user_id OR auth.role() = 'service_role');


-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Next steps:
-- 1. Deploy this migration to Supabase
-- 2. Update process-jetstream-event to insert into likes/reposts
-- 3. Update bluesky-proxy to cache into cached_posts/cached_profiles
-- 4. Consolidate frontend hooks
-- ============================================================================
