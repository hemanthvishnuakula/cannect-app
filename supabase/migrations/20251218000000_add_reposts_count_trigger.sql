-- CRITICAL FIX: Add trigger to persist reposts_count to database
-- Without this, reposts_count only updates optimistically in UI but never persists

-- Function to update repost counts on original post
CREATE OR REPLACE FUNCTION update_post_reposts_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment reposts_count on original post
    IF NEW.type = 'repost' AND NEW.repost_of_id IS NOT NULL THEN
      UPDATE posts 
      SET reposts_count = reposts_count + 1
      WHERE id = NEW.repost_of_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement reposts_count on original post
    IF OLD.type = 'repost' AND OLD.repost_of_id IS NOT NULL THEN
      UPDATE posts 
      SET reposts_count = GREATEST(0, reposts_count - 1)
      WHERE id = OLD.repost_of_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Create separate triggers for INSERT and DELETE
DROP TRIGGER IF EXISTS trigger_update_reposts_count_insert ON posts;
CREATE TRIGGER trigger_update_reposts_count_insert
  AFTER INSERT ON posts
  FOR EACH ROW
  WHEN (NEW.type = 'repost' AND NEW.repost_of_id IS NOT NULL)
  EXECUTE FUNCTION update_post_reposts_count();

DROP TRIGGER IF EXISTS trigger_update_reposts_count_delete ON posts;
CREATE TRIGGER trigger_update_reposts_count_delete
  AFTER DELETE ON posts
  FOR EACH ROW
  WHEN (OLD.type = 'repost' AND OLD.repost_of_id IS NOT NULL)
  EXECUTE FUNCTION update_post_reposts_count();

-- Add unique constraint to prevent duplicate reposts
-- This prevents the race condition where rapid clicks create multiple reposts
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_repost 
ON posts(user_id, repost_of_id) 
WHERE type = 'repost' AND repost_of_id IS NOT NULL;

-- Add unique constraint for federated reposts
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_external_repost 
ON posts(user_id, external_id) 
WHERE type = 'repost' AND external_id IS NOT NULL;

-- Add cascade delete: when original post is deleted, delete all reposts of it
-- This prevents orphaned repost wrappers pointing to deleted content
ALTER TABLE posts 
DROP CONSTRAINT IF EXISTS posts_repost_of_id_fkey;

ALTER TABLE posts 
ADD CONSTRAINT posts_repost_of_id_fkey 
  FOREIGN KEY (repost_of_id) 
  REFERENCES posts(id) 
  ON DELETE CASCADE;
