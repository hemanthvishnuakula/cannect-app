-- Force reset the pending delete operation
UPDATE federation_queue 
SET status = 'pending', 
    attempts = 0, 
    last_error = NULL,
    created_at = NOW()
WHERE record_type = 'post' 
  AND record_id = 'c47406ad-a1c7-4064-a004-7836f3aa8cf3'::uuid 
  AND operation = 'delete';

-- Debug: Show what's in the queue
DO $$
DECLARE
  v_status TEXT;
  v_count INTEGER;
BEGIN
  SELECT status, COUNT(*) INTO v_status, v_count
  FROM federation_queue 
  WHERE record_id = 'c47406ad-a1c7-4064-a004-7836f3aa8cf3'::uuid
  GROUP BY status;
  
  RAISE NOTICE 'Queue status for record: %, count: %', v_status, v_count;
END $$;
