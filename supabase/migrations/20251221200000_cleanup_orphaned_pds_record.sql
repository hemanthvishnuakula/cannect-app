-- Manual cleanup: Delete orphaned PDS record that wasn't cleaned up properly
-- This inserts a delete operation for the federation worker to process

INSERT INTO federation_queue (
  record_type,
  record_id,
  user_did,
  collection,
  rkey,
  at_uri,
  operation,
  status
) VALUES (
  'post',
  'c47406ad-a1c7-4064-a004-7836f3aa8cf3',
  'did:plc:zccnnuz7vbtqcptq6ituk74k',
  'app.bsky.feed.post',
  '3maj4i4ovlnvj',
  'at://did:plc:zccnnuz7vbtqcptq6ituk74k/app.bsky.feed.post/3maj4i4ovlnvj',
  'delete',
  'pending'
) ON CONFLICT (record_type, record_id, operation) DO UPDATE SET
  status = 'pending',
  attempts = 0,
  last_error = NULL,
  created_at = NOW();
