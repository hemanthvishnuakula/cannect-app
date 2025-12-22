#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3000/xrpc/com.atproto.server.createSession \
  -H "Content-Type: application/json" \
  -d '{"identifier":"fedtest.cannect.space","password":"FedTest123!"}' | jq -r '.accessJwt')

echo "Token: ${TOKEN:0:50}..."

curl -s -X POST http://localhost:3000/xrpc/com.atproto.repo.deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"repo":"did:plc:zccnnuz7vbtqcptq6ituk74k","collection":"app.bsky.feed.post","rkey":"3maj4i4ovlnvj"}'
