/**
 * Cannabis Account Management System
 * 
 * Usage:
 *   node manage-accounts.mjs add <handle>      - Add and verify a new account
 *   node manage-accounts.mjs review            - Review all current accounts
 *   node manage-accounts.mjs discover          - Discover new accounts from follows
 *   node manage-accounts.mjs search            - Search for cannabis posts, add authors to pending
 *   node manage-accounts.mjs pending           - Review pending accounts from search
 *   node manage-accounts.mjs export            - Export verified accounts as JS array
 */

import fs from 'fs';
import path from 'path';

const ACCOUNTS_FILE = './verified-accounts.json';
const MIN_CANNABIS_PERCENTAGE = 10; // Minimum % of posts about cannabis

const CANNABIS_KEYWORDS = [
  'cannabis', 'marijuana', 'weed', '420', 'thc', 'cbd',
  'dispensary', 'strain', 'indica', 'sativa', 'hybrid',
  'edible', 'flower', 'concentrate', 'dab', 'vape',
  'legalize', 'legalization', 'decriminalize',
  'stoner', 'bud', 'nug', 'kush', 'hemp',
  'terpene', 'cannabinoid', 'joint', 'blunt', 'bong',
  'grower', 'cultivator', 'norml', 'reform', 'prohibition'
];

// Load existing accounts
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { verified: [], rejected: [], pending: [] };
}

// Save accounts
function saveAccounts(data) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}

// Fetch profile
async function getProfile(handle) {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Fetch recent posts
async function getRecentPosts(handle, limit = 30) {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=${limit}&filter=posts_no_replies`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.feed || [];
  } catch {
    return [];
  }
}

// Count cannabis keywords in text
function countCannabisKeywords(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  for (const keyword of CANNABIS_KEYWORDS) {
    if (lower.includes(keyword)) count++;
  }
  return count;
}

// Analyze an account
async function analyzeAccount(handle) {
  console.log(`\n🔍 Analyzing ${handle}...`);
  
  const profile = await getProfile(handle);
  if (!profile) {
    console.log(`  ❌ Account not found`);
    return null;
  }
  
  const posts = await getRecentPosts(handle);
  const bioKeywords = countCannabisKeywords(profile.description || '');
  
  let cannabisPosts = 0;
  const examples = [];
  
  for (const item of posts) {
    const text = item.post?.record?.text || '';
    if (countCannabisKeywords(text) > 0) {
      cannabisPosts++;
      if (examples.length < 2) {
        examples.push(text.slice(0, 80) + (text.length > 80 ? '...' : ''));
      }
    }
  }
  
  const percentage = posts.length > 0 ? Math.round((cannabisPosts / posts.length) * 100) : 0;
  
  const result = {
    handle,
    did: profile.did,
    displayName: profile.displayName || handle,
    bio: (profile.description || '').slice(0, 100),
    bioHasCannabis: bioKeywords > 0,
    postsAnalyzed: posts.length,
    cannabisPosts,
    percentage,
    examples,
    reviewedAt: new Date().toISOString()
  };
  
  console.log(`  📊 ${profile.displayName || handle}`);
  console.log(`  Bio: "${result.bio}${result.bio.length >= 100 ? '...' : ''}"`);
  console.log(`  Cannabis in bio: ${bioKeywords > 0 ? 'Yes' : 'No'}`);
  console.log(`  Cannabis posts: ${cannabisPosts}/${posts.length} (${percentage}%)`);
  
  if (examples.length > 0) {
    console.log(`  Examples:`);
    for (const ex of examples) {
      console.log(`    - "${ex}"`);
    }
  }
  
  if (percentage >= 50) {
    console.log(`  Rating: 🟢 HIGH CONFIDENCE`);
  } else if (percentage >= 20) {
    console.log(`  Rating: 🟡 MEDIUM CONFIDENCE`);
  } else if (percentage >= MIN_CANNABIS_PERCENTAGE) {
    console.log(`  Rating: 🟠 LOW CONFIDENCE (borderline)`);
  } else {
    console.log(`  Rating: 🔴 NOT RECOMMENDED`);
  }
  
  return result;
}

// Add a new account
async function addAccount(handle) {
  const data = loadAccounts();
  
  // Check if already exists
  if (data.verified.find(a => a.handle === handle)) {
    console.log(`⚠️ ${handle} is already in verified list`);
    return;
  }
  if (data.rejected.find(a => a.handle === handle)) {
    console.log(`⚠️ ${handle} was previously rejected`);
  }
  
  const result = await analyzeAccount(handle);
  if (!result) return;
  
  if (result.percentage >= MIN_CANNABIS_PERCENTAGE) {
    data.verified.push(result);
    console.log(`\n✅ Added ${handle} to verified list`);
  } else {
    data.rejected.push(result);
    console.log(`\n❌ Added ${handle} to rejected list (only ${result.percentage}% cannabis posts)`);
  }
  
  saveAccounts(data);
  console.log(`\n📁 Saved to ${ACCOUNTS_FILE}`);
}

// Review all accounts
async function reviewAll() {
  const data = loadAccounts();
  console.log(`\n📋 Reviewing ${data.verified.length} verified accounts...\n`);
  
  const updated = [];
  for (const account of data.verified) {
    const result = await analyzeAccount(account.handle);
    if (result) {
      updated.push(result);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  data.verified = updated;
  saveAccounts(data);
  
  // Summary
  const high = updated.filter(a => a.percentage >= 50);
  const medium = updated.filter(a => a.percentage >= 20 && a.percentage < 50);
  const low = updated.filter(a => a.percentage >= 10 && a.percentage < 20);
  const bad = updated.filter(a => a.percentage < 10);
  
  console.log(`\n📊 Summary:`);
  console.log(`  🟢 HIGH (50%+): ${high.length} accounts`);
  console.log(`  🟡 MEDIUM (20-49%): ${medium.length} accounts`);
  console.log(`  🟠 LOW (10-19%): ${low.length} accounts`);
  console.log(`  🔴 REMOVE (<10%): ${bad.length} accounts`);
  
  if (bad.length > 0) {
    console.log(`\n⚠️ Consider removing these accounts:`);
    for (const a of bad) {
      console.log(`  - ${a.handle} (${a.percentage}%)`);
    }
  }
}

// Discover new accounts
async function discover() {
  const data = loadAccounts();
  const seedHandles = data.verified.slice(0, 10).map(a => a.handle); // Use top 10 as seeds
  
  console.log(`\n🔍 Discovering accounts from ${seedHandles.length} seed accounts...\n`);
  
  const followCounts = new Map();
  
  for (const seed of seedHandles) {
    console.log(`Fetching follows for ${seed}...`);
    
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${seed}&limit=100`);
      if (!res.ok) continue;
      
      const { follows } = await res.json();
      for (const follow of follows) {
        const handle = follow.handle;
        
        // Skip already verified/rejected
        if (data.verified.find(a => a.handle === handle)) continue;
        if (data.rejected.find(a => a.handle === handle)) continue;
        
        const existing = followCounts.get(handle) || { count: 0, profile: follow };
        existing.count++;
        followCounts.set(handle, existing);
      }
      
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Find accounts followed by multiple seeds
  const candidates = [];
  for (const [handle, { count, profile }] of followCounts) {
    const bioMatch = countCannabisKeywords(profile.description || '') > 0;
    if (count >= 2 || bioMatch) {
      candidates.push({ handle, count, bioMatch, displayName: profile.displayName });
    }
  }
  
  candidates.sort((a, b) => b.count - a.count);
  
  console.log(`\n🎯 Found ${candidates.length} potential accounts:\n`);
  
  for (const c of candidates.slice(0, 20)) {
    console.log(`  ${c.count} seeds follow: ${c.handle} ${c.bioMatch ? '(cannabis in bio)' : ''}`);
  }
  
  console.log(`\nTo add an account, run: node manage-accounts.mjs add <handle>`);
}

// Export as JS array
function exportAccounts() {
  const data = loadAccounts();
  
  console.log('\n// Copy this to server.js:\n');
  console.log('const CANNABIS_ACCOUNTS = [');
  
  // Sort by percentage
  const sorted = [...data.verified].sort((a, b) => b.percentage - a.percentage);
  
  for (const a of sorted) {
    console.log(`  '${a.handle}',  // ${a.percentage}% - ${a.displayName}`);
  }
  
  console.log('];');
}

// Search for cannabis posts and add authors to pending
async function searchCannabis() {
  const data = loadAccounts();
  
  console.log(`\n🔍 Discovering cannabis accounts via multiple methods...\n`);
  
  const foundAuthors = new Map(); // did -> { handle, displayName, postCount, examples, source }
  
  // Method 1: Get more follows from verified accounts (deeper crawl)
  console.log('📡 Method 1: Deep crawl of verified account follows...\n');
  
  const verifiedHandles = data.verified.map(a => a.handle);
  
  for (const handle of verifiedHandles.slice(0, 15)) {
    console.log(`  Fetching follows for ${handle}...`);
    
    try {
      let cursor = null;
      let followCount = 0;
      
      // Get up to 200 follows per account
      for (let i = 0; i < 2; i++) {
        const url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${handle}&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) break;
        
        const { follows, cursor: nextCursor } = await res.json();
        
        for (const follow of follows) {
          // Skip already known
          if (data.verified.find(a => a.handle === follow.handle)) continue;
          if (data.rejected.find(a => a.handle === follow.handle)) continue;
          if (data.pending?.find(a => a.handle === follow.handle)) continue;
          
          const existing = foundAuthors.get(follow.did) || {
            handle: follow.handle,
            did: follow.did,
            displayName: follow.displayName || follow.handle,
            bio: follow.description || '',
            followedBy: [],
            bioMatch: false,
            source: 'follows'
          };
          
          existing.followedBy.push(handle);
          
          // Check if bio mentions cannabis
          if (countCannabisKeywords(follow.description || '') > 0) {
            existing.bioMatch = true;
          }
          
          foundAuthors.set(follow.did, existing);
          followCount++;
        }
        
        cursor = nextCursor;
        if (!cursor) break;
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`    Found ${followCount} follows`);
      await new Promise(r => setTimeout(r, 150));
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
  }
  
  // Method 2: Check who interacts with verified accounts (likes their posts)
  console.log('\n📡 Method 2: Checking who likes verified accounts\' posts...\n');
  
  for (const handle of verifiedHandles.slice(0, 8)) {
    console.log(`  Checking likers for ${handle}...`);
    
    try {
      // Get recent posts
      const feedRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=5`);
      if (!feedRes.ok) continue;
      
      const { feed } = await feedRes.json();
      
      for (const item of feed.slice(0, 3)) {
        const postUri = item.post.uri;
        
        // Get likes for this post
        const likesRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getLikes?uri=${encodeURIComponent(postUri)}&limit=50`);
        if (!likesRes.ok) continue;
        
        const { likes } = await likesRes.json();
        
        for (const like of likes || []) {
          const actor = like.actor;
          
          // Skip already known
          if (data.verified.find(a => a.handle === actor.handle)) continue;
          if (data.rejected.find(a => a.handle === actor.handle)) continue;
          if (data.pending?.find(a => a.handle === actor.handle)) continue;
          
          const existing = foundAuthors.get(actor.did) || {
            handle: actor.handle,
            did: actor.did,
            displayName: actor.displayName || actor.handle,
            bio: actor.description || '',
            followedBy: [],
            likedPosts: 0,
            bioMatch: false,
            source: 'likes'
          };
          
          existing.likedPosts = (existing.likedPosts || 0) + 1;
          
          if (countCannabisKeywords(actor.description || '') > 0) {
            existing.bioMatch = true;
          }
          
          foundAuthors.set(actor.did, existing);
        }
        
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (e) {
      console.log(`    Error: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Score and filter candidates
  const candidates = [];
  
  for (const [did, author] of foundAuthors) {
    let score = 0;
    const reasons = [];
    
    // Followed by multiple verified accounts
    if (author.followedBy?.length >= 3) {
      score += author.followedBy.length * 2;
      reasons.push(`followed by ${author.followedBy.length} verified`);
    } else if (author.followedBy?.length >= 2) {
      score += author.followedBy.length;
      reasons.push(`followed by ${author.followedBy.length} verified`);
    }
    
    // Liked multiple cannabis posts
    if (author.likedPosts >= 3) {
      score += author.likedPosts;
      reasons.push(`liked ${author.likedPosts} cannabis posts`);
    }
    
    // Bio mentions cannabis
    if (author.bioMatch) {
      score += 5;
      reasons.push('cannabis in bio');
    }
    
    // Handle contains cannabis terms
    const handleLower = author.handle.toLowerCase();
    if (CANNABIS_KEYWORDS.some(t => handleLower.includes(t))) {
      score += 3;
      reasons.push('handle match');
    }
    
    if (score >= 3) {
      candidates.push({
        ...author,
        score,
        reasons
      });
    }
  }
  
  // Sort by score
  candidates.sort((a, b) => b.score - a.score);
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n📊 Found ${candidates.length} potential accounts\n`);
  
  // Show top candidates
  for (const c of candidates.slice(0, 25)) {
    console.log(`\nScore ${c.score} │ ${c.handle}`);
    console.log(`  ${c.displayName}`);
    console.log(`  ${c.reasons.join(', ')}`);
    if (c.bio) {
      console.log(`  Bio: "${c.bio.slice(0, 60)}${c.bio.length > 60 ? '...' : ''}"`);
    }
  }
  
  // Add to pending
  if (!data.pending) data.pending = [];
  
  let added = 0;
  for (const c of candidates) {
    if (!data.pending.find(p => p.handle === c.handle)) {
      data.pending.push({
        handle: c.handle,
        did: c.did,
        displayName: c.displayName,
        bio: c.bio,
        score: c.score,
        reasons: c.reasons,
        addedAt: new Date().toISOString()
      });
      added++;
    }
  }
  
  saveAccounts(data);
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n✅ Added ${added} new accounts to pending list`);
  console.log(`📋 Total pending: ${data.pending.length}`);
  console.log(`\nRun 'node manage-accounts.mjs pending' to review and verify them`);
}

// Review pending accounts
async function reviewPending() {
  const data = loadAccounts();
  
  if (!data.pending || data.pending.length === 0) {
    console.log('\n📭 No pending accounts to review');
    console.log('Run "node manage-accounts.mjs search" to find candidates');
    return;
  }
  
  console.log(`\n📋 Reviewing ${data.pending.length} pending accounts...\n`);
  
  const toVerify = [];
  const toReject = [];
  
  for (const pending of data.pending) {
    const result = await analyzeAccount(pending.handle);
    
    if (!result) {
      toReject.push(pending);
      continue;
    }
    
    if (result.percentage >= MIN_CANNABIS_PERCENTAGE) {
      toVerify.push(result);
      console.log(`  → Will VERIFY`);
    } else {
      result.searchPostCount = pending.searchPostCount;
      result.searchTerms = pending.searchTerms;
      toReject.push(result);
      console.log(`  → Will REJECT`);
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Move verified
  for (const v of toVerify) {
    if (!data.verified.find(a => a.handle === v.handle)) {
      data.verified.push(v);
    }
  }
  
  // Move rejected
  for (const r of toReject) {
    if (!data.rejected.find(a => a.handle === r.handle)) {
      data.rejected.push(r);
    }
  }
  
  // Clear pending
  data.pending = [];
  
  saveAccounts(data);
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n✅ Verified: ${toVerify.length} accounts added`);
  console.log(`❌ Rejected: ${toReject.length} accounts`);
  console.log(`📊 Total verified: ${data.verified.length}`);
  
  if (toVerify.length > 0) {
    console.log(`\nNew verified accounts:`);
    for (const v of toVerify) {
      console.log(`  + ${v.handle} (${v.percentage}%)`);
    }
  }
}

// Initialize with current accounts from server.js
async function initFromServer() {
  const data = loadAccounts();
  
  if (data.verified.length > 0) {
    console.log('Already initialized. Use "review" to refresh data.');
    return;
  }
  
  const currentAccounts = [
    'normlorg.bsky.social',
    'weedjesus.bsky.social',
    'oglesby.bsky.social',
    'junglecae.bsky.social',
    'montelwilliams.bsky.social',
    'chrisgoldstein.bsky.social',
    'nycannabistimes.com',
    'mybpg.bsky.social',
    'breedersteve.bsky.social',
    'nhcannapatient.bsky.social',
    'ngaio420.bsky.social',
    'cantrip.bsky.social',
    'cannabis.bsky.social',
    'filtermag.bsky.social',
    'leddder.bsky.social',
    'ommpeddie.bsky.social',
    'samreisman.bsky.social',
    'danalarsen.bsky.social',
    'ricksteves.bsky.social',
    'cannabis-lounges.bsky.social',
    'shaleen.bsky.social',
    'boxbrown.bsky.social',
    'hempfarm.bsky.social',
    'buchanan.today',
    'thepotlabphd.bsky.social',
  ];
  
  console.log(`\n📥 Initializing with ${currentAccounts.length} accounts from server.js...\n`);
  
  for (const handle of currentAccounts) {
    const result = await analyzeAccount(handle);
    if (result) {
      data.verified.push(result);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  saveAccounts(data);
  console.log(`\n✅ Initialized ${data.verified.length} accounts in ${ACCOUNTS_FILE}`);
}

// Main
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'add':
    if (!arg) {
      console.log('Usage: node manage-accounts.mjs add <handle>');
      process.exit(1);
    }
    await addAccount(arg);
    break;
    
  case 'review':
    await reviewAll();
    break;
    
  case 'discover':
    await discover();
    break;
    
  case 'search':
    await searchCannabis();
    break;
    
  case 'pending':
    await reviewPending();
    break;
    
  case 'export':
    exportAccounts();
    break;
    
  case 'init':
    await initFromServer();
    break;
    
  default:
    console.log(`
Cannabis Account Management System

Commands:
  add <handle>   Add and verify a new account
  review         Review all current accounts  
  discover       Discover new accounts from follows
  search         Search for cannabis posts, add authors to pending
  pending        Review pending accounts (verify or reject)
  export         Export verified accounts as JS array
  init           Initialize from current server.js accounts

Workflow:
  1. node manage-accounts.mjs search    # Find accounts posting about cannabis
  2. node manage-accounts.mjs pending   # Review and verify them
  3. node manage-accounts.mjs export    # Get updated list for server.js

Examples:
  node manage-accounts.mjs search
  node manage-accounts.mjs add weedjesus.bsky.social
  node manage-accounts.mjs review
`);
}
