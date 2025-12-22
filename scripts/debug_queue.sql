-- Debug: Show federation queue contents
DO $$
DECLARE
  queue_count INTEGER;
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO queue_count FROM federation_queue;
  SELECT COUNT(*) INTO pending_count FROM federation_queue WHERE status = 'pending';
  RAISE NOTICE 'Total queue items: %, Pending: %', queue_count, pending_count;
END $$;

-- Show recent queue items  
SELECT id, record_type, operation, status, rkey, created_at, last_error 
FROM federation_queue 
ORDER BY created_at DESC 
LIMIT 10;
