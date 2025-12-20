-- ============================================================================
-- FEDERATION COMPLETENESS MIGRATION
-- Adds missing AT Protocol fields for full Bluesky compatibility
-- ============================================================================

-- 1. Add facets for rich text (mentions, links, hashtags)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS facets JSONB;
COMMENT ON COLUMN posts.facets IS 'Rich text annotations: mentions, links, hashtags per AT Protocol';

-- 2. Add labels for content warnings
ALTER TABLE posts ADD COLUMN IF NOT EXISTS labels JSONB;
COMMENT ON COLUMN posts.labels IS 'Self-applied content warning labels';

-- 3. Add record keys for AT URI generation (at://did/collection/rkey)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS rkey TEXT;
ALTER TABLE likes ADD COLUMN IF NOT EXISTS rkey TEXT;
ALTER TABLE reposts ADD COLUMN IF NOT EXISTS rkey TEXT;
ALTER TABLE follows ADD COLUMN IF NOT EXISTS rkey TEXT;

-- 4. Add profile fields from app.bsky.actor.profile lexicon
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pinned_post_uri TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_labels JSONB;

-- 5. Create blocks table (app.bsky.graph.block)
CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  at_uri TEXT UNIQUE,
  subject_did TEXT,
  rkey TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, blocked_id)
);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own blocks" ON blocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create blocks" ON blocks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete blocks" ON blocks FOR DELETE USING (auth.uid() = user_id);

-- 6. Create mutes table (client-side preference, not a record type)
CREATE TABLE IF NOT EXISTS mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, muted_id)
);

ALTER TABLE mutes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own mutes" ON mutes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can mute" ON mutes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unmute" ON mutes FOR DELETE USING (auth.uid() = user_id);

-- 7. Create muted_words table for word/tag filtering
CREATE TABLE IF NOT EXISTS muted_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  targets TEXT[] DEFAULT ARRAY['content', 'tag'],
  actor_target TEXT DEFAULT 'all' CHECK (actor_target IN ('all', 'exclude-following')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE muted_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own muted words" ON muted_words FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create muted words" ON muted_words FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete muted words" ON muted_words FOR DELETE USING (auth.uid() = user_id);

-- 8. Create threadgates table (app.bsky.feed.threadgate - reply controls)
CREATE TABLE IF NOT EXISTS threadgates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  at_uri TEXT UNIQUE,
  rkey TEXT,
  -- allow_rules: array of {type: 'mentionRule'|'followingRule'|'listRule', list?: at-uri}
  allow_rules JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE threadgates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Threadgates viewable by everyone" ON threadgates FOR SELECT USING (true);
CREATE POLICY "Users can create own threadgates" ON threadgates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own threadgates" ON threadgates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own threadgates" ON threadgates FOR DELETE USING (auth.uid() = user_id);

-- 9. Create postgates table (app.bsky.feed.postgate - quote/embed controls)
CREATE TABLE IF NOT EXISTS postgates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  at_uri TEXT UNIQUE,
  rkey TEXT,
  -- detached_embedding_uris: AT URIs of posts that should not embed this post
  detached_uris TEXT[],
  -- embedding_rules: array of rule objects for who can embed
  embedding_rules JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE postgates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Postgates viewable by everyone" ON postgates FOR SELECT USING (true);
CREATE POLICY "Users can create own postgates" ON postgates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own postgates" ON postgates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own postgates" ON postgates FOR DELETE USING (auth.uid() = user_id);

-- 10. Create lists table (app.bsky.graph.list)
CREATE TABLE IF NOT EXISTS lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  at_uri TEXT UNIQUE,
  rkey TEXT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('curatelist', 'modlist', 'referencelist')),
  description TEXT,
  avatar_cid TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lists viewable by everyone" ON lists FOR SELECT USING (true);
CREATE POLICY "Users can create own lists" ON lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own lists" ON lists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own lists" ON lists FOR DELETE USING (auth.uid() = user_id);

-- 11. Create list_items table (app.bsky.graph.listitem)
CREATE TABLE IF NOT EXISTS list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  subject_did TEXT NOT NULL,
  subject_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  at_uri TEXT UNIQUE,
  rkey TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "List items viewable by everyone" ON list_items FOR SELECT USING (true);
CREATE POLICY "List owners can manage items" ON list_items FOR ALL
  USING (EXISTS (SELECT 1 FROM lists WHERE lists.id = list_items.list_id AND lists.user_id = auth.uid()));

-- 12. Add indexes for new tables
CREATE INDEX IF NOT EXISTS idx_blocks_user ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes(user_id);
CREATE INDEX IF NOT EXISTS idx_muted_words_user ON muted_words(user_id);
CREATE INDEX IF NOT EXISTS idx_threadgates_post ON threadgates(post_id);
CREATE INDEX IF NOT EXISTS idx_postgates_post ON postgates(post_id);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_subject ON list_items(subject_did);

-- 13. Add rkey index on posts for AT URI lookups
CREATE INDEX IF NOT EXISTS idx_posts_rkey ON posts(rkey) WHERE rkey IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_at_uri ON posts(at_uri) WHERE at_uri IS NOT NULL;
