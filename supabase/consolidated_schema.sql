-- ============================================================================
-- CANNECT CONSOLIDATED SCHEMA
-- ============================================================================
-- Version: 2.1.0 (December 24, 2025)
-- 
-- This schema consolidates 64 migration files into a single authoritative
-- schema definition. It represents the complete current state of the
-- Cannect database with full AT Protocol / Bluesky federation support.
--
-- FEATURES:
-- - Full AT Protocol federation via cannect.space PDS
-- - Bluesky-compatible threading model (thread_root + thread_parent)
-- - Separate interaction tables (likes, reposts, follows)
-- - External actor support for Bluesky notifications
-- - Real-time push notifications (Expo + Web Push)
-- - PDS-first architecture for interactions
-- - Unified architecture: DB = Source of truth for OUR UI
-- - Cached tables for external Bluesky content
-- - Universal identifiers: actor_did + subject_uri
--
-- WARNING: This is for DOCUMENTATION and NEW DEPLOYMENTS only.
-- DO NOT run this on an existing database with data!
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_net";  -- For async HTTP calls
CREATE EXTENSION IF NOT EXISTS "pg_cron"; -- For scheduled jobs

-- ============================================================================
-- TABLE: profiles
-- ============================================================================
-- Maps Supabase Auth users to AT Protocol identity
-- ============================================================================

CREATE TABLE profiles (
  -- Primary identity (Supabase Auth)
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Human-readable identity
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  
  -- Media
  avatar_url TEXT,
  avatar_cid TEXT,           -- IPFS/AT CID for avatar
  banner_url TEXT,           -- Profile banner/cover image
  banner_cid TEXT,           -- IPFS/AT CID for banner
  
  -- AT Protocol identity
  did TEXT UNIQUE,           -- did:plc:xxx from plc.directory
  handle TEXT UNIQUE,        -- user.cannect.space
  pds_url TEXT,              -- https://cannect.space
  pds_registered BOOLEAN DEFAULT FALSE,
  pds_registered_at TIMESTAMPTZ,
  recovery_key TEXT,         -- PDS recovery key
  
  -- External links
  website TEXT,
  
  -- Counts (denormalized)
  followers_count INTEGER DEFAULT 0 NOT NULL,
  following_count INTEGER DEFAULT 0 NOT NULL,
  posts_count INTEGER DEFAULT 0 NOT NULL,
  
  -- Status
  is_verified BOOLEAN DEFAULT FALSE NOT NULL,
  
  -- Push notifications
  expo_push_token TEXT,
  web_push_subscription JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX idx_profiles_did ON profiles(did) WHERE did IS NOT NULL;
CREATE INDEX idx_profiles_handle ON profiles(handle) WHERE handle IS NOT NULL;
CREATE INDEX idx_profiles_push_token ON profiles(expo_push_token) WHERE expo_push_token IS NOT NULL;
CREATE INDEX idx_profiles_pds_registered ON profiles(pds_registered) WHERE pds_registered = TRUE;

-- ============================================================================
-- TABLE: posts
-- ============================================================================
-- Uses Bluesky threading model for federation compatibility
-- ============================================================================

CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- AT Protocol identity
  rkey TEXT,                 -- Record key (TID)
  at_uri TEXT UNIQUE,        -- at://did/app.bsky.feed.post/rkey
  at_cid TEXT,               -- Content hash
  
  -- Content
  content TEXT NOT NULL DEFAULT '',
  facets JSONB,              -- AT Protocol facets (mentions, links, tags)
  langs TEXT[],              -- Language codes ['en', 'es']
  
  -- Media (local URLs)
  media_urls TEXT[],
  video_url TEXT,
  video_thumbnail_url TEXT,
  
  -- Media (content-addressed)
  media_cids TEXT[],
  video_cid TEXT,
  
  -- Threading (Bluesky model)
  thread_root_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  thread_parent_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  thread_depth INTEGER DEFAULT 0 NOT NULL,
  
  -- AT Protocol thread references
  thread_root_uri TEXT,
  thread_root_cid TEXT,
  thread_parent_uri TEXT,
  thread_parent_cid TEXT,
  
  -- Embed/Quote (Bluesky model)
  embed_type TEXT CHECK (embed_type IN ('none', 'images', 'video', 'record', 'record_with_media', 'external')),
  embed_record_uri TEXT,     -- AT URI of quoted post
  embed_record_cid TEXT,
  embed_external_uri TEXT,
  embed_external_title TEXT,
  embed_external_description TEXT,
  embed_external_thumb TEXT,
  
  -- Post type (computed)
  is_reply BOOLEAN GENERATED ALWAYS AS (thread_parent_id IS NOT NULL) STORED,
  type TEXT DEFAULT 'post' CHECK (type IN ('post', 'reply', 'quote')),
  
  -- Legacy fields (deprecated but kept for compatibility)
  reply_to_id UUID,
  is_repost BOOLEAN DEFAULT FALSE,
  repost_of_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  external_id TEXT,
  external_source TEXT,
  external_metadata JSONB,
  
  -- Counts (denormalized)
  likes_count INTEGER DEFAULT 0 NOT NULL,
  replies_count INTEGER DEFAULT 0 NOT NULL,
  reposts_count INTEGER DEFAULT 0 NOT NULL,
  quotes_count INTEGER DEFAULT 0 NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_at_uri ON posts(at_uri) WHERE at_uri IS NOT NULL;
CREATE INDEX idx_posts_thread_root ON posts(thread_root_id) WHERE thread_root_id IS NOT NULL;
CREATE INDEX idx_posts_thread_parent ON posts(thread_parent_id) WHERE thread_parent_id IS NOT NULL;
CREATE INDEX idx_posts_feed ON posts(user_id, created_at DESC) WHERE thread_parent_id IS NULL;
CREATE INDEX idx_posts_has_media ON posts(user_id, created_at DESC) WHERE media_urls IS NOT NULL OR video_url IS NOT NULL;
CREATE UNIQUE INDEX idx_unique_repost ON posts(user_id, repost_of_id) WHERE type = 'repost' AND repost_of_id IS NOT NULL;

-- ============================================================================
-- TABLE: likes
-- ============================================================================
-- Separate table for AT Protocol compatibility
-- Supports both local posts and external Bluesky content
-- ============================================================================

CREATE TABLE likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Target (one of these must be set)
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,  -- Local post
  subject_uri TEXT,          -- AT URI of external post
  subject_cid TEXT,          -- CID at time of like
  
  -- AT Protocol fields
  rkey TEXT,                 -- Record key
  at_uri TEXT UNIQUE,        -- at://did/app.bsky.feed.like/rkey
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  federated_at TIMESTAMPTZ,  -- When synced to PDS
  
  -- Constraints
  CONSTRAINT likes_must_have_target CHECK (post_id IS NOT NULL OR subject_uri IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_likes_post_id ON likes(post_id);
CREATE INDEX idx_likes_user_id ON likes(user_id);
CREATE INDEX idx_likes_at_uri ON likes(at_uri) WHERE at_uri IS NOT NULL;
CREATE UNIQUE INDEX idx_likes_local_unique ON likes(user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX idx_likes_external_unique ON likes(user_id, subject_uri) WHERE post_id IS NULL AND subject_uri IS NOT NULL;

-- ============================================================================
-- TABLE: reposts
-- ============================================================================
-- Separate table for AT Protocol compatibility
-- ============================================================================

CREATE TABLE reposts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Target (one of these must be set)
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  subject_uri TEXT,
  subject_cid TEXT,
  
  -- AT Protocol fields
  rkey TEXT,
  at_uri TEXT UNIQUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  federated_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT reposts_must_have_target CHECK (post_id IS NOT NULL OR subject_uri IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_reposts_post_id ON reposts(post_id);
CREATE INDEX idx_reposts_user_id ON reposts(user_id);
CREATE INDEX idx_reposts_at_uri ON reposts(at_uri) WHERE at_uri IS NOT NULL;
CREATE INDEX idx_reposts_created_at ON reposts(created_at DESC);
CREATE UNIQUE INDEX idx_reposts_local_unique ON reposts(user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX idx_reposts_external_unique ON reposts(user_id, subject_uri) WHERE post_id IS NULL AND subject_uri IS NOT NULL;

-- ============================================================================
-- TABLE: follows
-- ============================================================================
-- Graph edges with AT Protocol support
-- ============================================================================

CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Local references
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL for external follows
  
  -- AT Protocol fields
  subject_did TEXT,          -- DID of followed user
  rkey TEXT,
  at_uri TEXT UNIQUE,
  
  -- External target info (for follows of external Bluesky users)
  target_did TEXT,
  target_handle TEXT,
  target_display_name TEXT,
  target_avatar TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  federated_at TIMESTAMPTZ,
  
  -- Constraints
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id OR following_id IS NULL)
);

-- Indexes
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_at_uri ON follows(at_uri) WHERE at_uri IS NOT NULL;

-- ============================================================================
-- TABLE: notifications
-- ============================================================================
-- Supports both internal and external (Bluesky) actors
-- ============================================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Internal actor (Cannect user)
  actor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- External actor (Bluesky user via Jetstream)
  is_external BOOLEAN DEFAULT FALSE,
  actor_did TEXT,
  actor_handle TEXT,
  actor_display_name TEXT,
  actor_avatar TEXT,
  
  -- Notification type (matches Bluesky reasons)
  reason TEXT NOT NULL CHECK (reason IN (
    'like', 'repost', 'follow', 'mention', 'reply', 'quote', 'starterpack-joined'
  )),
  
  -- Related post
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  subject_uri TEXT,
  
  -- Status
  is_read BOOLEAN DEFAULT FALSE NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Constraints: must have internal actor OR be external
  CONSTRAINT chk_notification_actor CHECK (
    actor_id IS NOT NULL OR is_external = TRUE
  )
);

-- Indexes
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_external_dedup ON notifications(user_id, reason, actor_did, post_id) WHERE is_external = TRUE;

-- ============================================================================
-- TABLE: pds_sessions
-- ============================================================================
-- Stores PDS authentication tokens for federation
-- ============================================================================

CREATE TABLE pds_sessions (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access_jwt TEXT NOT NULL,
  refresh_jwt TEXT NOT NULL,
  did TEXT,
  handle TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_pds_sessions_updated ON pds_sessions(updated_at);
CREATE INDEX idx_pds_sessions_did ON pds_sessions(did);

-- ============================================================================
-- TABLE: federation_queue
-- ============================================================================
-- Queue for outbound AT Protocol sync operations (posts only now)
-- ============================================================================

CREATE TABLE federation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type TEXT NOT NULL CHECK (record_type IN ('post', 'like', 'repost', 'follow', 'block', 'profile', 'reply')),
  record_id UUID NOT NULL,
  user_did TEXT,
  collection TEXT,
  rkey TEXT,
  at_uri TEXT,
  record_data JSONB,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  
  CONSTRAINT unique_pending_record UNIQUE (record_type, record_id, operation)
);

-- Indexes
CREATE INDEX idx_federation_queue_status ON federation_queue(status) WHERE status = 'pending';
CREATE INDEX idx_federation_queue_pending_created ON federation_queue(status, created_at) WHERE status = 'pending';
CREATE INDEX idx_federation_queue_user_did ON federation_queue(user_did);

-- ============================================================================
-- TABLE: jetstream_cursor
-- ============================================================================
-- Tracks SSE cursor for Jetstream polling (legacy, VPS consumer now preferred)
-- ============================================================================

CREATE TABLE jetstream_cursor (
  id INTEGER PRIMARY KEY DEFAULT 1,
  cursor_time_us BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pds_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE federation_queue ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Posts
CREATE POLICY "Posts are viewable by everyone" ON posts FOR SELECT USING (true);
CREATE POLICY "Users can create own posts" ON posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON posts FOR DELETE USING (auth.uid() = user_id);

-- Likes
CREATE POLICY "Likes are viewable by everyone" ON likes FOR SELECT USING (true);
CREATE POLICY "Users can like posts" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unlike posts" ON likes FOR DELETE USING (auth.uid() = user_id);

-- Reposts
CREATE POLICY "Reposts are viewable by everyone" ON reposts FOR SELECT USING (true);
CREATE POLICY "Users can repost" ON reposts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unrepost" ON reposts FOR DELETE USING (auth.uid() = user_id);

-- Follows
CREATE POLICY "Follows are viewable by everyone" ON follows FOR SELECT USING (true);
CREATE POLICY "Users can follow others" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users can unfollow others" ON follows FOR DELETE USING (auth.uid() = follower_id);

-- Notifications
CREATE POLICY "Users can view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System can insert notifications" ON notifications FOR INSERT WITH CHECK (true);

-- PDS Sessions
CREATE POLICY "Users can view own PDS session" ON pds_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own PDS session" ON pds_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own PDS session" ON pds_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own PDS session" ON pds_sessions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage PDS sessions" ON pds_sessions FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Federation Queue (service role only)
CREATE POLICY "Service role can manage federation queue" ON federation_queue FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- FUNCTIONS: TID Generation
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_tid()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  s32_chars TEXT := '234567abcdefghijklmnopqrstuvwxyz';
  now_us BIGINT;
  clock_id INTEGER;
  combined BIGINT;
  tid TEXT := '';
  i INTEGER;
BEGIN
  now_us := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::BIGINT;
  clock_id := floor(random() * 1024)::INTEGER;
  combined := (now_us << 10) | clock_id;
  
  FOR i IN 1..13 LOOP
    tid := substr(s32_chars, (combined & 31)::INTEGER + 1, 1) || tid;
    combined := combined >> 5;
  END LOOP;
  
  RETURN tid;
END;
$$;

-- ============================================================================
-- FUNCTIONS: Post Type Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION set_post_type()
RETURNS TRIGGER AS $$
BEGIN
  -- Set type based on structure
  IF NEW.embed_record_uri IS NOT NULL OR NEW.embed_type = 'record' OR NEW.embed_type = 'record_with_media' THEN
    NEW.type := 'quote';
  ELSIF NEW.thread_parent_id IS NOT NULL THEN
    NEW.type := 'reply';
  ELSE
    NEW.type := 'post';
  END IF;
  
  -- Calculate thread depth
  IF NEW.thread_parent_id IS NOT NULL THEN
    SELECT COALESCE(thread_depth, 0) + 1 INTO NEW.thread_depth
    FROM posts WHERE id = NEW.thread_parent_id;
  END IF;
  
  -- Set thread_root if this is a reply
  IF NEW.thread_parent_id IS NOT NULL AND NEW.thread_root_id IS NULL THEN
    SELECT COALESCE(thread_root_id, id) INTO NEW.thread_root_id
    FROM posts WHERE id = NEW.thread_parent_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_post_type
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_post_type();

-- ============================================================================
-- FUNCTIONS: Auto-create Profile
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public 
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- FUNCTIONS: Count Updates
-- ============================================================================

-- Likes count
CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL THEN
    UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_post_likes
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();

-- Reposts count
CREATE OR REPLACE FUNCTION update_post_reposts_count()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL THEN
    UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL THEN
    UPDATE posts SET reposts_count = GREATEST(0, reposts_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_reposts_count
  AFTER INSERT OR DELETE ON reposts
  FOR EACH ROW EXECUTE FUNCTION update_post_reposts_count();

-- Replies count
CREATE OR REPLACE FUNCTION update_parent_replies_count()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.thread_parent_id IS NOT NULL THEN
    UPDATE posts SET replies_count = replies_count + 1 WHERE id = NEW.thread_parent_id;
  ELSIF TG_OP = 'DELETE' AND OLD.thread_parent_id IS NOT NULL THEN
    UPDATE posts SET replies_count = GREATEST(0, replies_count - 1) WHERE id = OLD.thread_parent_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_replies_count
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_parent_replies_count();

-- Quotes count
CREATE OR REPLACE FUNCTION update_post_quotes_count()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  quoted_post_id UUID;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.type = 'quote' AND NEW.embed_record_uri IS NOT NULL THEN
    SELECT id INTO quoted_post_id FROM posts WHERE at_uri = NEW.embed_record_uri;
    IF quoted_post_id IS NOT NULL THEN
      UPDATE posts SET quotes_count = quotes_count + 1 WHERE id = quoted_post_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.type = 'quote' AND OLD.embed_record_uri IS NOT NULL THEN
    SELECT id INTO quoted_post_id FROM posts WHERE at_uri = OLD.embed_record_uri;
    IF quoted_post_id IS NOT NULL THEN
      UPDATE posts SET quotes_count = GREATEST(0, quotes_count - 1) WHERE id = quoted_post_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_quotes_count
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_post_quotes_count();

-- Follow counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    IF NEW.following_id IS NOT NULL THEN
      UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    IF OLD.following_id IS NOT NULL THEN
      UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.following_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_follow_counts
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Profile posts count
CREATE OR REPLACE FUNCTION update_profile_posts_count()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.thread_parent_id IS NULL THEN
    UPDATE profiles SET posts_count = posts_count + 1 WHERE id = NEW.user_id;
  ELSIF TG_OP = 'DELETE' AND OLD.thread_parent_id IS NULL THEN
    UPDATE profiles SET posts_count = GREATEST(0, posts_count - 1) WHERE id = OLD.user_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_profile_posts
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_profile_posts_count();

-- ============================================================================
-- FUNCTIONS: Notification Creation
-- ============================================================================

-- Like notification
CREATE OR REPLACE FUNCTION create_like_notification()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  post_author_id UUID;
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    SELECT user_id INTO post_author_id FROM posts WHERE id = NEW.post_id;
    IF post_author_id IS NOT NULL AND post_author_id != NEW.user_id THEN
      INSERT INTO notifications (user_id, actor_id, reason, post_id)
      VALUES (post_author_id, NEW.user_id, 'like', NEW.post_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_create_like_notification
  AFTER INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION create_like_notification();

-- Repost notification
CREATE OR REPLACE FUNCTION create_repost_notification()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  post_author_id UUID;
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    SELECT user_id INTO post_author_id FROM posts WHERE id = NEW.post_id;
    IF post_author_id IS NOT NULL AND post_author_id != NEW.user_id THEN
      INSERT INTO notifications (user_id, actor_id, reason, post_id)
      VALUES (post_author_id, NEW.user_id, 'repost', NEW.post_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_create_repost_notification
  AFTER INSERT ON reposts
  FOR EACH ROW EXECUTE FUNCTION create_repost_notification();

-- Reply notification
CREATE OR REPLACE FUNCTION create_reply_notification()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  parent_author_id UUID;
BEGIN
  IF NEW.thread_parent_id IS NOT NULL THEN
    SELECT user_id INTO parent_author_id FROM posts WHERE id = NEW.thread_parent_id;
    IF parent_author_id IS NOT NULL AND parent_author_id != NEW.user_id THEN
      INSERT INTO notifications (user_id, actor_id, reason, post_id)
      VALUES (parent_author_id, NEW.user_id, 'reply', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_create_reply_notification
  AFTER INSERT ON posts
  FOR EACH ROW WHEN (NEW.thread_parent_id IS NOT NULL)
  EXECUTE FUNCTION create_reply_notification();

-- Quote notification
CREATE OR REPLACE FUNCTION create_quote_notification()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  quoted_author_id UUID;
BEGIN
  IF NEW.type = 'quote' AND NEW.embed_record_uri IS NOT NULL THEN
    SELECT user_id INTO quoted_author_id FROM posts WHERE at_uri = NEW.embed_record_uri;
    IF quoted_author_id IS NOT NULL AND quoted_author_id != NEW.user_id THEN
      INSERT INTO notifications (user_id, actor_id, reason, post_id)
      VALUES (quoted_author_id, NEW.user_id, 'quote', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_create_quote_notification
  AFTER INSERT ON posts
  FOR EACH ROW WHEN (NEW.type = 'quote')
  EXECUTE FUNCTION create_quote_notification();

-- Follow notification
CREATE OR REPLACE FUNCTION create_follow_notification()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.following_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, actor_id, reason)
    VALUES (NEW.following_id, NEW.follower_id, 'follow');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_create_follow_notification
  AFTER INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION create_follow_notification();

-- ============================================================================
-- FUNCTIONS: Push Notification
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_push_notification()
RETURNS TRIGGER AS $$
DECLARE
  actor_name TEXT;
  actor_username TEXT;
  notification_title TEXT;
  notification_body TEXT;
  notification_data JSONB;
  edge_function_url TEXT := 'https://luljncadylctsrkqtatk.supabase.co/functions/v1/send-push-notification';
BEGIN
  -- Get actor info
  IF NEW.is_external = TRUE THEN
    actor_name := COALESCE(NEW.actor_display_name, NEW.actor_handle, 'Someone on Bluesky');
    actor_username := NEW.actor_handle;
  ELSE
    SELECT COALESCE(display_name, username, 'Someone'), username
    INTO actor_name, actor_username
    FROM profiles WHERE id = NEW.actor_id;
  END IF;

  -- Build notification content
  CASE NEW.reason
    WHEN 'like' THEN
      notification_title := '❤️ New Like';
      notification_body := actor_name || ' liked your post';
    WHEN 'reply' THEN
      notification_title := '💬 New Reply';
      notification_body := actor_name || ' replied to your post';
    WHEN 'follow' THEN
      notification_title := '👤 New Follower';
      notification_body := actor_name || ' started following you';
    WHEN 'repost' THEN
      notification_title := '🔄 New Repost';
      notification_body := actor_name || ' reposted your post';
    WHEN 'quote' THEN
      notification_title := '💬 New Quote';
      notification_body := actor_name || ' quoted your post';
    WHEN 'mention' THEN
      notification_title := '📣 New Mention';
      notification_body := actor_name || ' mentioned you';
    ELSE
      RETURN NEW;
  END CASE;

  notification_data := jsonb_build_object(
    'type', NEW.reason,
    'postId', NEW.post_id,
    'notificationId', NEW.id,
    'isExternal', COALESCE(NEW.is_external, false)
  );

  PERFORM net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'userId', NEW.user_id,
      'title', notification_title,
      'body', notification_body,
      'data', notification_data
    )::text
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Push notification error: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_notify_push
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION notify_push_notification();

-- ============================================================================
-- FUNCTIONS: Post Federation Queue
-- ============================================================================

CREATE OR REPLACE FUNCTION queue_post_for_federation()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public 
LANGUAGE plpgsql AS $$
DECLARE
  v_user_did TEXT;
  v_rkey TEXT;
  v_at_uri TEXT;
  v_record_data JSONB;
  v_parent_uri TEXT;
  v_parent_cid TEXT;
  v_root_uri TEXT;
  v_root_cid TEXT;
BEGIN
  -- Get user's DID
  SELECT did INTO v_user_did FROM profiles WHERE id = NEW.user_id;
  
  -- Skip if user isn't federated
  IF v_user_did IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Generate TID-based rkey
  v_rkey := generate_tid();
  v_at_uri := 'at://' || v_user_did || '/app.bsky.feed.post/' || v_rkey;
  
  -- Update post with AT Protocol fields
  UPDATE posts SET rkey = v_rkey, at_uri = v_at_uri
  WHERE id = NEW.id AND (rkey IS NULL OR at_uri IS NULL);
  
  -- Build AT Protocol record
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
  
  -- Add reply reference
  IF NEW.thread_parent_id IS NOT NULL THEN
    SELECT at_uri, at_cid INTO v_parent_uri, v_parent_cid
    FROM posts WHERE id = NEW.thread_parent_id;
    
    IF NEW.thread_root_id IS NOT NULL THEN
      SELECT at_uri, at_cid INTO v_root_uri, v_root_cid
      FROM posts WHERE id = NEW.thread_root_id;
    ELSE
      v_root_uri := v_parent_uri;
      v_root_cid := v_parent_cid;
    END IF;
    
    IF v_parent_uri IS NOT NULL AND v_root_uri IS NOT NULL THEN
      v_record_data := v_record_data || jsonb_build_object(
        'reply', jsonb_build_object(
          'parent', jsonb_build_object('uri', v_parent_uri, 'cid', COALESCE(v_parent_cid, '')),
          'root', jsonb_build_object('uri', v_root_uri, 'cid', COALESCE(v_root_cid, ''))
        )
      );
    END IF;
  END IF;
  
  -- Queue for federation
  INSERT INTO federation_queue (
    record_type, record_id, user_did, collection, rkey, at_uri, record_data, operation
  ) VALUES (
    CASE WHEN NEW.thread_parent_id IS NOT NULL THEN 'reply' ELSE 'post' END,
    NEW.id,
    v_user_did,
    'app.bsky.feed.post',
    v_rkey,
    v_at_uri,
    v_record_data,
    'create'
  )
  ON CONFLICT (record_type, record_id, operation) DO UPDATE SET
    record_data = EXCLUDED.record_data,
    status = 'pending',
    attempts = 0,
    created_at = NOW();
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Post federation queue error: %', SQLERRM;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_queue_post_federation
  AFTER INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION queue_post_for_federation();

-- ============================================================================
-- VERSION 2.1: UNIFIED ARCHITECTURE TABLES
-- ============================================================================
-- "DB = Source of truth for OUR UI, PDS = Source of truth for THE NETWORK"
-- 
-- These tables cache external Bluesky content for unified rendering.
-- Cannect posts live in 'posts' table, external posts in 'cached_posts'.
-- The UI hooks unify both sources for seamless federation display.
-- ============================================================================

-- Cached posts from Bluesky (external content)
CREATE TABLE IF NOT EXISTS cached_posts (
  at_uri TEXT PRIMARY KEY,
  cid TEXT,
  author_did TEXT NOT NULL,
  content TEXT,
  embed JSONB,
  reply_parent TEXT,
  reply_root TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW(),
  like_count INTEGER DEFAULT 0,
  repost_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  liked_by_user BOOLEAN DEFAULT FALSE,
  reposted_by_user BOOLEAN DEFAULT FALSE,
  cache_priority TEXT DEFAULT 'standard' CHECK (cache_priority IN ('ephemeral', 'standard', 'extended')),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cached_posts_author ON cached_posts(author_did);
CREATE INDEX IF NOT EXISTS idx_cached_posts_expires ON cached_posts(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cached_posts_priority ON cached_posts(cache_priority);

-- Cached profiles from Bluesky (external actors)
CREATE TABLE IF NOT EXISTS cached_profiles (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  avatar TEXT,
  description TEXT,
  followers_count INTEGER DEFAULT 0,
  follows_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  indexed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_stale BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_cached_profiles_handle ON cached_profiles(handle);
CREATE INDEX IF NOT EXISTS idx_cached_profiles_stale ON cached_profiles(is_stale) WHERE is_stale = TRUE;

-- Cached follows (external follow relationships)
CREATE TABLE IF NOT EXISTS cached_follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_did TEXT NOT NULL,
  followee_did TEXT NOT NULL,
  at_uri TEXT,
  cid TEXT,
  indexed_at TIMESTAMPTZ DEFAULT NOW(),
  is_stale BOOLEAN DEFAULT FALSE,
  UNIQUE(follower_did, followee_did)
);

CREATE INDEX IF NOT EXISTS idx_cached_follows_follower ON cached_follows(follower_did);
CREATE INDEX IF NOT EXISTS idx_cached_follows_followee ON cached_follows(followee_did);

-- ============================================================================
-- VERSION 2.1: TRIGGERS FOR CACHED POST INTERACTIONS
-- ============================================================================

-- Mark cached_posts as liked when a like is created
CREATE OR REPLACE FUNCTION mark_cached_post_liked()
RETURNS TRIGGER AS $$
BEGIN
  -- Update cached_posts if the subject_uri exists there
  UPDATE cached_posts 
  SET liked_by_user = TRUE, like_count = like_count + 1
  WHERE at_uri = NEW.subject_uri;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mark_cached_post_liked
  AFTER INSERT ON likes
  FOR EACH ROW
  WHEN (NEW.subject_uri LIKE 'at://%')
  EXECUTE FUNCTION mark_cached_post_liked();

-- Mark cached_posts as reposted when a repost is created
CREATE OR REPLACE FUNCTION mark_cached_post_reposted()
RETURNS TRIGGER AS $$
BEGIN
  -- Update cached_posts if the subject_uri exists there
  UPDATE cached_posts 
  SET reposted_by_user = TRUE, repost_count = repost_count + 1
  WHERE at_uri = NEW.subject_uri;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mark_cached_post_reposted
  AFTER INSERT ON reposts
  FOR EACH ROW
  WHEN (NEW.subject_uri LIKE 'at://%')
  EXECUTE FUNCTION mark_cached_post_reposted();

-- ============================================================================
-- VERSION 2.1: pg_cron CLEANUP JOBS
-- ============================================================================
-- These jobs maintain the cached tables and prevent unbounded growth.
-- Requires pg_cron extension to be enabled.
-- ============================================================================

-- Note: pg_cron jobs are created via:
-- SELECT cron.schedule('cleanup-ephemeral-cached-posts', '*/15 * * * *', 
--   $$DELETE FROM cached_posts WHERE cache_priority = 'ephemeral' AND expires_at < NOW()$$);
-- SELECT cron.schedule('cleanup-standard-cached-posts', '0 * * * *', 
--   $$DELETE FROM cached_posts WHERE cache_priority = 'standard' AND expires_at < NOW()$$);
-- SELECT cron.schedule('cleanup-extended-cached-posts', '0 0 * * *', 
--   $$DELETE FROM cached_posts WHERE cache_priority = 'extended' AND expires_at < NOW()$$);
-- SELECT cron.schedule('mark-stale-cached-follows', '0 */6 * * *', 
--   $$UPDATE cached_follows SET is_stale = TRUE WHERE indexed_at < NOW() - INTERVAL '7 days' AND is_stale = FALSE$$);
-- SELECT cron.schedule('cleanup-stale-cached-follows', '0 0 * * 0', 
--   $$DELETE FROM cached_follows WHERE is_stale = TRUE AND indexed_at < NOW() - INTERVAL '30 days'$$);

-- ============================================================================
-- END OF CONSOLIDATED SCHEMA
-- ============================================================================
