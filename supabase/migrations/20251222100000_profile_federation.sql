-- =============================================================================
-- Profile Federation: Sync profile updates to AT Protocol PDS
-- =============================================================================
-- This migration adds triggers to queue profile updates for federation
-- when display_name, bio, or avatar_url changes.
-- =============================================================================

-- =============================================================================
-- Function to queue profile updates for federation
-- =============================================================================
CREATE OR REPLACE FUNCTION queue_profile_for_federation()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public, extensions
LANGUAGE plpgsql AS $$
DECLARE
  v_record_data JSONB;
  v_at_uri TEXT;
BEGIN
  -- Skip if user isn't federated (no DID)
  IF NEW.did IS NULL THEN
    RAISE NOTICE 'Skipping profile federation - user % has no DID', NEW.id;
    RETURN NEW;
  END IF;
  
  -- Only queue if relevant fields changed
  IF (
    OLD.display_name IS NOT DISTINCT FROM NEW.display_name AND
    OLD.bio IS NOT DISTINCT FROM NEW.bio AND
    OLD.avatar_url IS NOT DISTINCT FROM NEW.avatar_url
  ) THEN
    RAISE NOTICE 'Skipping profile federation - no relevant changes';
    RETURN NEW;
  END IF;
  
  -- Build AT Protocol URI for profile (self record)
  v_at_uri := 'at://' || NEW.did || '/app.bsky.actor.profile/self';
  
  -- Build AT Protocol profile record
  -- Note: Avatar/banner need to be uploaded as blobs first, which is handled by the worker
  v_record_data := jsonb_build_object(
    '$type', 'app.bsky.actor.profile',
    'displayName', COALESCE(NEW.display_name, ''),
    'description', COALESCE(NEW.bio, '')
  );
  
  -- Add avatar URL for worker to process (will convert to blob ref)
  IF NEW.avatar_url IS NOT NULL THEN
    v_record_data := v_record_data || jsonb_build_object('avatarUrl', NEW.avatar_url);
  END IF;
  
  -- Queue for federation
  INSERT INTO federation_queue (
    record_type, record_id, user_did, collection, rkey, at_uri, record_data, operation, status
  ) VALUES (
    'profile', NEW.id, NEW.did, 'app.bsky.actor.profile', 'self', v_at_uri, v_record_data, 'update', 'pending'
  )
  ON CONFLICT (record_type, record_id, operation) 
  DO UPDATE SET 
    record_data = EXCLUDED.record_data, 
    status = 'pending', 
    attempts = 0,
    last_error = NULL,
    created_at = NOW();
  
  RAISE NOTICE 'Queued profile % for federation: %', NEW.id, v_at_uri;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- Trigger for profile updates
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_queue_profile_federation ON profiles;

CREATE TRIGGER trigger_queue_profile_federation
AFTER UPDATE OF display_name, bio, avatar_url ON profiles
FOR EACH ROW
EXECUTE FUNCTION queue_profile_for_federation();

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON FUNCTION queue_profile_for_federation() IS 
  'Auto-queues profile updates for AT Protocol federation when display_name, bio, or avatar_url changes';

COMMENT ON TRIGGER trigger_queue_profile_federation ON profiles IS 
  'Fires when profile display_name, bio, or avatar_url is updated to sync to PDS';
