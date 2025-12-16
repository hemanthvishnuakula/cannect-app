-- Trigger to update comments_count on parent post when a reply is created/deleted

-- Function to update comment counts
CREATE OR REPLACE FUNCTION update_parent_comments_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment comments_count on parent post
    IF NEW.reply_to_id IS NOT NULL THEN
      UPDATE posts 
      SET comments_count = comments_count + 1
      WHERE id = NEW.reply_to_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement comments_count on parent post
    IF OLD.reply_to_id IS NOT NULL THEN
      UPDATE posts 
      SET comments_count = GREATEST(0, comments_count - 1)
      WHERE id = OLD.reply_to_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Create separate triggers for INSERT and DELETE (can't use WHEN with both NEW and OLD)
DROP TRIGGER IF EXISTS trigger_update_comments_count_insert ON posts;
CREATE TRIGGER trigger_update_comments_count_insert
  AFTER INSERT ON posts
  FOR EACH ROW
  WHEN (NEW.reply_to_id IS NOT NULL)
  EXECUTE FUNCTION update_parent_comments_count();

DROP TRIGGER IF EXISTS trigger_update_comments_count_delete ON posts;
CREATE TRIGGER trigger_update_comments_count_delete
  AFTER DELETE ON posts
  FOR EACH ROW
  WHEN (OLD.reply_to_id IS NOT NULL)
  EXECUTE FUNCTION update_parent_comments_count();

-- Also create notification for comments
CREATE OR REPLACE FUNCTION create_comment_notification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  parent_user_id UUID;
BEGIN
  -- Get the user who owns the parent post
  SELECT user_id INTO parent_user_id FROM posts WHERE id = NEW.reply_to_id;
  
  -- Don't notify yourself
  IF parent_user_id IS NOT NULL AND parent_user_id != NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, post_id)
    VALUES (parent_user_id, NEW.user_id, 'comment', NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_comment_notification ON posts;
CREATE TRIGGER trigger_create_comment_notification
  AFTER INSERT ON posts
  FOR EACH ROW
  WHEN (NEW.reply_to_id IS NOT NULL)
  EXECUTE FUNCTION create_comment_notification();
