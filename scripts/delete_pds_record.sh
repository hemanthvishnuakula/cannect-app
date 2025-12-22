#!/bin/bash
# Delete orphaned record from PDS

IDENTIFIER="fedtest.cannect.space"
PASSWORD="awx6MAAT"
REPO="did:plc:zccnnuz7vbtqcptq6ituk74k"
COLLECTION="app.bsky.feed.post"
RKEY="3maj4i4ovlnvj"

echo "Creating session..."
RESPONSE=$(curl -s -X POST http://localhost:3000/xrpc/com.atproto.server.createSession \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$IDENTIFIER\",\"password\":\"$PASSWORD\"}")

echo "Session response: $RESPONSE"

TOKEN=$(echo "$RESPONSE" | jq -r '.accessJwt')
echo "Token: ${TOKEN:0:50}..."

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Failed to get token!"
  exit 1
fi

echo "Deleting record..."
DELETE_RESPONSE=$(curl -s -X POST http://localhost:3000/xrpc/com.atproto.repo.deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"repo\":\"$REPO\",\"collection\":\"$COLLECTION\",\"rkey\":\"$RKEY\"}")

echo "Delete response: $DELETE_RESPONSE"

echo ""
echo "Verifying - listing remaining records..."
curl -s "http://localhost:3000/xrpc/com.atproto.repo.listRecords?repo=$REPO&collection=$COLLECTION&limit=10" | jq .
