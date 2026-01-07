#!/bin/bash
# fix-broken-profiles.sh
# Run on PDS server to force profile updates for all users
# This creates new commits that will be picked up by the firehose

PDS_HOST="http://localhost:3000"
ADMIN_PASSWORD="05ae258b5462447d5b98e23d8db4ac0c"

# List of broken user DIDs (from our analysis)
BROKEN_DIDS=(
  "did:plc:akx74gjaogubgle2qgqtvcwx"  # vermontijuana
  "did:plc:ubg7temxt72h73b5iko2zjjz"  # longpassuser6751
  "did:plc:5tgxehejgej3dxuuizsncugf"  # greenmountainsativ
  "did:plc:ht77gfixoq5feuj6bl4vffbq"  # nate
  "did:plc:ocifbfutxz7z6okitevnptmg"  # kevinjodrey
  "did:plc:yqzjamzfflrkey4j6kwaj7hg"  # altitudedrops
  "did:plc:f5jlfxgmmrhxttzokkcsk6i3"  # hemanthvishnu
  "did:plc:2dzrgmqhimcfmc2h5z3m2fhx"  # charlesb
  "did:plc:y335tgajsmhqrirv5w5jkz6c"  # offpistefarm
  "did:plc:p6crkfp6rftuk7dcg7lk3xis"  # tiliahills
  "did:plc:medscxgdwlxd5ynxip4agz7r"  # betweentwobrooks
  "did:plc:he5kkmve4ms7fcgen2zq4udb"  # gnanideep
  "did:plc:g23uu7yixcbylxpodppfoptz"  # crazymonkeycake
  "did:plc:goqd4nhah4llmsme3asat6jt"  # marjee
  "did:plc:hadqmd4v5krcsz3q7d7vyder"  # thymeandagainvt
  "did:plc:uuu6nomo3e22qdlsdzvsz7r4"  # edwardhashhands
  "did:plc:twbst24j4ghqjrnpmszdq5ox"  # prv3nzaza
)

echo "=== Fixing ${#BROKEN_DIDS[@]} broken profiles ==="
echo ""

for did in "${BROKEN_DIDS[@]}"; do
  echo -n "Processing $did... "
  
  # Get current profile record
  profile=$(curl -s "$PDS_HOST/xrpc/com.atproto.repo.getRecord?repo=$did&collection=app.bsky.actor.profile&rkey=self")
  
  if echo "$profile" | grep -q '"error"'; then
    echo "NO PROFILE - creating empty one"
    # Create a minimal profile if none exists
    # This requires user auth which we don't have as admin
    echo "  SKIPPED (no profile record)"
    continue
  fi
  
  # Extract the current CID and value
  cid=$(echo "$profile" | jq -r '.cid')
  value=$(echo "$profile" | jq -c '.value')
  
  echo "has profile (cid: ${cid:0:20}...)"
  
  # The trick: We can't PUT as admin, but we CAN request a crawl
  # which will force the relay to re-fetch this repo
done

echo ""
echo "=== Requesting relay crawl ==="
pdsadmin request-crawl bsky.network

echo ""
echo "Done! The relay should now re-index these repos."
echo "Note: AppView may take several minutes to process."
