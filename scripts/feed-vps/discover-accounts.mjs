/**
 * Discover cannabis accounts by analyzing who seed accounts follow
 * Run: node discover-accounts.mjs
 */

const SEED_ACCOUNTS = [
  'boxbrown.bsky.social',
  'mistressmatisse.bsky.social', 
  'rosasparks.bsky.social',
];

// Known cannabis-related terms for filtering
const CANNABIS_TERMS = [
  'cannabis', 'weed', '420', 'marijuana', 'thc', 'cbd',
  'stoner', 'dispensary', 'budtender', 'hemp', 'dank',
  'indica', 'sativa', 'edibles', 'terpenes', 'kush'
];

async function getFollows(actor) {
  const follows = [];
  let cursor = null;
  
  do {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${actor}&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Error fetching follows for ${actor}: ${res.status}`);
        break;
      }
      
      const data = await res.json();
      follows.push(...data.follows);
      cursor = data.cursor;
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`Failed to fetch follows for ${actor}:`, err.message);
      break;
    }
  } while (cursor);
  
  return follows;
}

function hasCannabisBio(bio) {
  if (!bio) return false;
  const lower = bio.toLowerCase();
  return CANNABIS_TERMS.some(term => lower.includes(term));
}

function hasCannabisBioStrict(bio) {
  if (!bio) return false;
  const lower = bio.toLowerCase();
  // More specific terms that definitely indicate cannabis focus
  const strictTerms = ['cannabis', 'dispensary', 'budtender', '420', 'marijuana', 'thc', 'cbd'];
  return strictTerms.some(term => lower.includes(term));
}

async function main() {
  console.log('🌿 Cannabis Account Discovery\n');
  console.log(`Seed accounts: ${SEED_ACCOUNTS.length}`);
  
  // Track all follows and how many seeds follow each account
  const followCounts = new Map(); // handle -> { count, profile }
  
  for (const seed of SEED_ACCOUNTS) {
    console.log(`\nFetching follows for ${seed}...`);
    const follows = await getFollows(seed);
    console.log(`  Found ${follows.length} follows`);
    
    for (const follow of follows) {
      const handle = follow.handle;
      const existing = followCounts.get(handle) || { count: 0, profile: follow };
      existing.count++;
      followCounts.set(handle, existing);
    }
  }
  
  console.log(`\n📊 Total unique accounts followed by seeds: ${followCounts.size}`);
  
  // Filter candidates
  const candidates = [];
  
  for (const [handle, data] of followCounts) {
    const { count, profile } = data;
    const bio = profile.description || '';
    
    // Skip seed accounts themselves
    if (SEED_ACCOUNTS.includes(handle)) continue;
    
    // Scoring
    let score = 0;
    let reasons = [];
    
    // Followed by multiple seeds
    if (count >= 2) {
      score += count * 3;
      reasons.push(`followed by ${count} seeds`);
    }
    
    // Cannabis bio (strict)
    if (hasCannabisBioStrict(bio)) {
      score += 10;
      reasons.push('cannabis bio');
    } else if (hasCannabisBio(bio)) {
      score += 3;
      reasons.push('related bio');
    }
    
    // Handle contains cannabis term
    const handleLower = handle.toLowerCase();
    if (CANNABIS_TERMS.some(t => handleLower.includes(t))) {
      score += 5;
      reasons.push('handle match');
    }
    
    if (score >= 5) {
      candidates.push({
        handle,
        displayName: profile.displayName || handle,
        bio: bio.slice(0, 100),
        score,
        reasons: reasons.join(', '),
        followedBySeeds: count
      });
    }
  }
  
  // Sort by score
  candidates.sort((a, b) => b.score - a.score);
  
  console.log(`\n🎯 High-confidence cannabis accounts: ${candidates.length}\n`);
  console.log('─'.repeat(80));
  
  // Print top candidates
  for (const c of candidates.slice(0, 50)) {
    console.log(`${c.score.toString().padStart(2)} │ ${c.handle.padEnd(35)} │ ${c.reasons}`);
    if (c.bio) {
      console.log(`   │ "${c.bio}..."`);
    }
    console.log('─'.repeat(80));
  }
  
  // Output as array for copy/paste
  console.log('\n\n📋 COPY THIS ARRAY TO server.js:\n');
  console.log('const CANNABIS_ACCOUNTS = [');
  for (const c of candidates) {
    console.log(`  '${c.handle}',`);
  }
  console.log('];');
  
  console.log(`\n✅ Total: ${candidates.length} accounts`);
}

main().catch(console.error);
