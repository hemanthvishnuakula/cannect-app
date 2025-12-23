-- =============================================================================
-- Migration: Remove Interaction Federation Triggers
-- =============================================================================
-- With PDS-first architecture, interactions (likes, reposts, follows) go 
-- directly to the PDS via the atproto-agent edge function. The database
-- becomes a mirror/cache rather than the source of truth.
--
-- This migration removes the async federation triggers that queued interactions
-- for background processing. Posts still use triggers for federation since
-- they may include media that needs blob upload.
-- =============================================================================

-- Drop like federation triggers
DROP TRIGGER IF EXISTS trigger_queue_like_federation ON likes;
DROP TRIGGER IF EXISTS trigger_queue_unlike_federation ON likes;

-- Drop repost federation triggers
DROP TRIGGER IF EXISTS trigger_queue_repost_federation ON reposts;
DROP TRIGGER IF EXISTS trigger_queue_unrepost_federation ON reposts;

-- Drop follow federation triggers
DROP TRIGGER IF EXISTS trigger_queue_follow_federation ON follows;
DROP TRIGGER IF EXISTS trigger_queue_unfollow_federation ON follows;

-- We keep the functions in case they're needed for debugging or rollback
-- They won't be executed without the triggers

-- Add federated_at column if not exists (used by atproto-agent to mark when mirrored)
ALTER TABLE likes ADD COLUMN IF NOT EXISTS federated_at TIMESTAMPTZ;
ALTER TABLE reposts ADD COLUMN IF NOT EXISTS federated_at TIMESTAMPTZ;
ALTER TABLE follows ADD COLUMN IF NOT EXISTS federated_at TIMESTAMPTZ;

-- Create indexes for efficient AT URI lookups
CREATE INDEX IF NOT EXISTS idx_likes_federated ON likes(federated_at) WHERE federated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reposts_federated ON reposts(federated_at) WHERE federated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follows_federated ON follows(federated_at) WHERE federated_at IS NOT NULL;

-- Add rkey column to follows if not exists (for AT Protocol record keys)
ALTER TABLE follows ADD COLUMN IF NOT EXISTS rkey TEXT;
ALTER TABLE follows ADD COLUMN IF NOT EXISTS at_uri TEXT;

-- Create index for follow AT URI lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_at_uri ON follows(at_uri) WHERE at_uri IS NOT NULL;

-- Comment on the changes
COMMENT ON COLUMN likes.federated_at IS 'Timestamp when this like was created on the PDS (PDS-first architecture)';
COMMENT ON COLUMN reposts.federated_at IS 'Timestamp when this repost was created on the PDS (PDS-first architecture)';
COMMENT ON COLUMN follows.federated_at IS 'Timestamp when this follow was created on the PDS (PDS-first architecture)';

-- =============================================================================
-- CLEANUP: Remove stale interaction items from federation_queue
-- =============================================================================
-- Since interactions now go directly to PDS, we can clean up any pending
-- interaction items that were queued under the old architecture

DELETE FROM federation_queue 
WHERE record_type IN ('like', 'repost', 'follow')
  AND status = 'pending';

-- Log the cleanup
DO $$
BEGIN
  RAISE NOTICE 'PDS-first migration complete: Interaction triggers removed, stale queue items cleaned up';
END $$;
