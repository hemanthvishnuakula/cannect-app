#!/bin/bash
# check-and-fix.sh - Run on PDS server
# Checks which users have broken AppView indexing

echo "Checking AppView status for all users..."
echo ""

# Get all DIDs
for line in $(pdsadmin account list 2>/dev/null | grep -oE 'did:plc:[a-z0-9]+'); do
  # Check AppView status
  result=$(curl -s "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=$line" 2>/dev/null)
  created=$(echo "$result" | jq -r '.createdAt // "error"')
  handle=$(echo "$result" | jq -r '.handle // "unknown"')
  posts=$(echo "$result" | jq -r '.postsCount // 0')
  
  if [ "$created" = "0001-01-01T00:00:00.000Z" ]; then
    echo "BROKEN: $handle (posts on AppView: $posts)"
  fi
  
  # Rate limit - 1 request per second
  sleep 1
done

echo ""
echo "Done checking."
