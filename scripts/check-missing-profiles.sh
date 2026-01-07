#!/bin/bash
# Check all PDS users for missing profile records
# Run on the PDS server: bash check-missing-profiles.sh

echo "Checking all users for missing profiles..."
echo ""

missing_count=0

# Get all DIDs from account list
docker exec pds pdsadmin account list 2>/dev/null | while IFS= read -r line; do
  # Extract DID from line
  did=$(echo "$line" | grep -oE 'did:plc:[a-z0-9]+')
  
  if [ -n "$did" ]; then
    # Get collections for this user
    collections=$(curl -s "http://localhost:3000/xrpc/com.atproto.repo.describeRepo?repo=$did" 2>/dev/null)
    
    # Check if profile collection exists
    if ! echo "$collections" | grep -q "app.bsky.actor.profile"; then
      handle=$(echo "$line" | awk '{print $1}')
      echo "MISSING: $handle - $did"
      ((missing_count++))
    fi
  fi
done

echo ""
echo "Done. Found $missing_count users without profiles."
