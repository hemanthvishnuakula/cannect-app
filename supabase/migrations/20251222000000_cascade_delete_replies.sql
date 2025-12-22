-- =============================================================================
-- CASCADE DELETE for Thread Replies
-- =============================================================================
-- Changes thread_parent_id and thread_root_id from ON DELETE SET NULL to 
-- ON DELETE CASCADE. This means:
-- - Deleting a post deletes ALL its replies (and their nested replies)
-- - Each cascaded delete triggers the federation queue (via BEFORE DELETE trigger)
-- - Bluesky/PDS stays in sync automatically
-- =============================================================================

-- Drop existing foreign key constraints
ALTER TABLE posts 
  DROP CONSTRAINT IF EXISTS posts_thread_parent_id_fkey;

ALTER TABLE posts 
  DROP CONSTRAINT IF EXISTS posts_thread_root_id_fkey;

-- Recreate with ON DELETE CASCADE
ALTER TABLE posts
  ADD CONSTRAINT posts_thread_parent_id_fkey 
  FOREIGN KEY (thread_parent_id) 
  REFERENCES posts(id) 
  ON DELETE CASCADE;

ALTER TABLE posts
  ADD CONSTRAINT posts_thread_root_id_fkey 
  FOREIGN KEY (thread_root_id) 
  REFERENCES posts(id) 
  ON DELETE CASCADE;

-- Also fix repost_of_id if it's inconsistent (some migrations had SET NULL)
ALTER TABLE posts 
  DROP CONSTRAINT IF EXISTS posts_repost_of_id_fkey;

ALTER TABLE posts
  ADD CONSTRAINT posts_repost_of_id_fkey 
  FOREIGN KEY (repost_of_id) 
  REFERENCES posts(id) 
  ON DELETE CASCADE;

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON CONSTRAINT posts_thread_parent_id_fkey ON posts IS 
  'CASCADE: Deleting a post deletes all direct replies';
  
COMMENT ON CONSTRAINT posts_thread_root_id_fkey ON posts IS 
  'CASCADE: Deleting thread root deletes entire thread';
  
COMMENT ON CONSTRAINT posts_repost_of_id_fkey ON posts IS 
  'CASCADE: Deleting original post deletes all quote posts referencing it';
