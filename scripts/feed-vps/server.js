/**
 * Cannect Feed Service
 * Real-time feed aggregation via Jetstream
 * 
 * Phase 1: Local Feed + Global Feed
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const CANNECT_PDS = 'https://cannect.space';
const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe';

// Curated cannabis community accounts for global feed
// Verified accounts that actively post about cannabis (reviewed 2024-12-28)
// Rating: percentage of recent posts about cannabis
const CANNABIS_ACCOUNTS = [
  // === 🟢 HIGH CONFIDENCE (50%+ cannabis posts) ===
  'normlorg.bsky.social',           // 100% - NORML, cannabis reform since 1970
  'weedjesus.bsky.social',          // 100% - OG cannabis cultivator
  'oglesby.bsky.social',            // 100% - Tax lawyer turned marijuana law reformer
  'junglecae.bsky.social',          // 100% - Cannabis educator
  'montelwilliams.bsky.social',     // 93% - Let's Be Blunt cannabis podcast
  'chrisgoldstein.bsky.social',     // 67% - Cannabis writer/activist
  'nycannabistimes.com',            // 63% - NY Cannabis Times
  'mybpg.bsky.social',              // 63% - Berkeley Patients Group dispensary
  
  // === 🟡 MEDIUM CONFIDENCE (20-49% cannabis posts) ===
  'breedersteve.bsky.social',       // 47% - Cannabis breeder
  'nhcannapatient.bsky.social',     // 47% - NH cannabis patient advocate
  'ngaio420.bsky.social',           // 43% - Comedian, stoner, activist
  'cantrip.bsky.social',            // 41% - Weed beverage company
  'cannabis.bsky.social',           // 40% - Cannabis 101 growing
  'filtermag.bsky.social',          // 37% - Drug policy journalism
  'leddder.bsky.social',            // 37% - Cannabis editor at SFGATE
  'ommpeddie.bsky.social',          // 37% - Oregon Medical Marijuana
  'samreisman.bsky.social',         // 37% - Cannabis reporter at Law360
  'danalarsen.bsky.social',         // 23% - Drug testing/mushroom dispensary
  'ricksteves.bsky.social',         // 23% - Travel writer, NORML board member
  'cannabis-lounges.bsky.social',   // 20% - Cannabis consumption lounges
  
  // === 🟡 MEDIUM CONFIDENCE (10-19% cannabis posts, strong bio) ===
  'shaleen.bsky.social',            // 17% - Former marijuana regulator
  'boxbrown.bsky.social',           // 13% - Cannabis activist, cartoonist
  'hempfarm.bsky.social',           // 11% - Hemp revival advocate
  'buchanan.today',                 // 10% - Cannabis activist/researcher
  'thepotlabphd.bsky.social',       // 10% - ThePotLab cannabis research
];

// Initialize SQLite database
const db = new Database('/root/cannect-feed/feed.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    uri TEXT PRIMARY KEY,
    cid TEXT,
    author_did TEXT,
    author_handle TEXT,
    author_name TEXT,
    author_avatar TEXT,
    text TEXT,
    has_media INTEGER DEFAULT 0,
    media_json TEXT,
    reply_to TEXT,
    embed_json TEXT,
    like_count INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    created_at TEXT,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    feed_type TEXT DEFAULT 'local'
  );
  
  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_did);
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_feed_type ON posts(feed_type);
  CREATE INDEX IF NOT EXISTS idx_posts_media ON posts(has_media) WHERE has_media = 1;
`);

// Middleware
app.use(cors());
app.use(express.json());

// State
let cannectDids = new Set();
let jetstreamWs = null;
let isConnected = false;
let stats = {
  eventsReceived: 0,
  postsProcessed: 0,
  lastEventTime: null,
  startedAt: new Date().toISOString(),
};

// === HELPER FUNCTIONS ===

async function fetchCannectUsers() {
  try {
    const response = await fetch(`${CANNECT_PDS}/xrpc/com.atproto.sync.listRepos?limit=100`);
    if (!response.ok) throw new Error(`PDS error: ${response.status}`);
    const data = await response.json();
    cannectDids = new Set(data.repos?.map(r => r.did) || []);
    console.log(`[Feed] Loaded ${cannectDids.size} Cannect users from PDS`);
    return cannectDids;
  } catch (error) {
    console.error('[Feed] Error fetching Cannect users:', error.message);
    return cannectDids;
  }
}

async function fetchAuthorFeed(did, limit = 30) {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=${limit}`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.feed || [];
  } catch (error) {
    console.error(`[Feed] Error fetching feed for ${did}:`, error.message);
    return [];
  }
}

async function fetchExternalFeed(feedUri, limit = 30) {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${limit}`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.feed || [];
  } catch (error) {
    console.error(`[Feed] Error fetching external feed:`, error.message);
    return [];
  }
}

function savePost(post, feedType = 'local') {
  try {
    const hasMedia = post.embed?.images?.length > 0 || 
                     post.embed?.media?.images?.length > 0 ||
                     post.embed?.video != null;
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO posts 
      (uri, cid, author_did, author_handle, author_name, author_avatar, 
       text, has_media, media_json, reply_to, embed_json, 
       like_count, repost_count, reply_count, created_at, feed_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      post.uri,
      post.cid,
      post.author?.did,
      post.author?.handle,
      post.author?.displayName || '',
      post.author?.avatar || '',
      post.record?.text || '',
      hasMedia ? 1 : 0,
      hasMedia ? JSON.stringify(post.embed) : null,
      post.record?.reply?.parent?.uri || null,
      post.embed ? JSON.stringify(post.embed) : null,
      post.likeCount || 0,
      post.repostCount || 0,
      post.replyCount || 0,
      post.record?.createdAt || post.indexedAt,
      feedType
    );
    return true;
  } catch (error) {
    console.error('[Feed] Error saving post:', error.message);
    return false;
  }
}

async function refreshLocalFeed() {
  console.log('[Feed] Refreshing local feed from Cannect users...');
  const dids = Array.from(cannectDids);
  let totalPosts = 0;
  
  for (const did of dids) {
    const feed = await fetchAuthorFeed(did, 20);
    for (const item of feed) {
      if (item.post && savePost(item.post, 'local')) {
        totalPosts++;
      }
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`[Feed] Refreshed local feed: ${totalPosts} posts from ${dids.length} users`);
  return totalPosts;
}

async function refreshGlobalFeed() {
  console.log('[Feed] Refreshing global cannabis feeds from curated accounts...');
  let totalPosts = 0;
  
  for (const handle of CANNABIS_ACCOUNTS) {
    const feed = await fetchAuthorFeed(handle, 20);
    for (const item of feed) {
      if (item.post) {
        // Skip posts from Cannect users (they're already in local feed)
        if (cannectDids.has(item.post.author?.did)) continue;
        
        if (savePost(item.post, 'global')) {
          totalPosts++;
        }
      }
    }
    // Small delay between fetches
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`[Feed] Refreshed global feed: ${totalPosts} posts from ${CANNABIS_ACCOUNTS.length} accounts`);
  return totalPosts;
}

// === JETSTREAM CONNECTION ===

function connectJetstream() {
  if (cannectDids.size === 0) {
    console.log('[Jetstream] No Cannect users to track, skipping connection');
    return;
  }
  
  const didsArray = Array.from(cannectDids).slice(0, 100);
  const params = new URLSearchParams();
  params.set('wantedCollections', 'app.bsky.feed.post');
  didsArray.forEach(did => params.append('wantedDids', did));
  
  const url = `${JETSTREAM_URL}?${params.toString()}`;
  console.log(`[Jetstream] Connecting with ${didsArray.length} DIDs...`);
  
  jetstreamWs = new WebSocket(url);
  
  jetstreamWs.on('open', () => {
    console.log('[Jetstream] Connected!');
    isConnected = true;
  });
  
  jetstreamWs.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      stats.eventsReceived++;
      stats.lastEventTime = new Date().toISOString();
      
      if (event.kind === 'commit' && event.commit?.collection === 'app.bsky.feed.post') {
        if (event.commit.operation === 'create') {
          await handleNewPost(event);
        } else if (event.commit.operation === 'delete') {
          handleDeletePost(event);
        }
      }
    } catch (error) {
      console.error('[Jetstream] Error processing message:', error.message);
    }
  });
  
  jetstreamWs.on('close', (code, reason) => {
    console.log(`[Jetstream] Disconnected: ${code} ${reason}`);
    isConnected = false;
    // Reconnect after 5 seconds
    setTimeout(connectJetstream, 5000);
  });
  
  jetstreamWs.on('error', (error) => {
    console.error('[Jetstream] Error:', error.message);
  });
}

async function handleNewPost(event) {
  const { did, commit } = event;
  const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
  
  // Fetch full post data from API
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`
    );
    if (response.ok) {
      const data = await response.json();
      if (data.posts?.[0]) {
        savePost(data.posts[0], 'local');
        stats.postsProcessed++;
        console.log(`[Jetstream] Saved new post from ${did}`);
      }
    }
  } catch (error) {
    // Save minimal post from event data
    const minimalPost = {
      uri,
      cid: commit.cid,
      author: { did },
      record: commit.record,
      indexedAt: new Date().toISOString(),
    };
    savePost(minimalPost, 'local');
    stats.postsProcessed++;
  }
}

function handleDeletePost(event) {
  const { did, commit } = event;
  const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
  
  try {
    db.prepare('DELETE FROM posts WHERE uri = ?').run(uri);
    console.log(`[Jetstream] Deleted post: ${uri}`);
  } catch (error) {
    console.error('[Jetstream] Error deleting post:', error.message);
  }
}

// === API ENDPOINTS ===

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cannect-feed',
    timestamp: new Date().toISOString(),
    jetstream: isConnected ? 'connected' : 'disconnected',
  });
});

// Stats
app.get('/stats', (req, res) => {
  const localCount = db.prepare("SELECT COUNT(*) as count FROM posts WHERE feed_type = 'local'").get();
  const globalCount = db.prepare("SELECT COUNT(*) as count FROM posts WHERE feed_type = 'global'").get();
  
  res.json({
    ...stats,
    jetstreamConnected: isConnected,
    cannectUsersTracked: cannectDids.size,
    postsInDb: {
      local: localCount.count,
      global: globalCount.count,
    },
  });
});

// Local Feed (Cannect users)
app.get('/feed/local', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const cursor = req.query.cursor;
  
  let query = `
    SELECT * FROM posts 
    WHERE feed_type = 'local'
    ${cursor ? 'AND created_at < ?' : ''}
    ORDER BY created_at DESC 
    LIMIT ?
  `;
  
  const params = cursor ? [cursor, limit + 1] : [limit + 1];
  const posts = db.prepare(query).all(...params);
  
  const hasMore = posts.length > limit;
  const resultPosts = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? resultPosts[resultPosts.length - 1].created_at : null;
  
  // Format posts for client
  const formattedPosts = resultPosts.map(p => ({
    uri: p.uri,
    cid: p.cid,
    author: {
      did: p.author_did,
      handle: p.author_handle,
      displayName: p.author_name,
      avatar: p.author_avatar,
    },
    record: {
      text: p.text,
      createdAt: p.created_at,
    },
    embed: p.embed_json ? JSON.parse(p.embed_json) : undefined,
    likeCount: p.like_count,
    repostCount: p.repost_count,
    replyCount: p.reply_count,
    indexedAt: p.indexed_at,
  }));
  
  res.json({
    posts: formattedPosts,
    cursor: nextCursor,
  });
});

// Global Feed (Cannabis community)
app.get('/feed/global', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const cursor = req.query.cursor;
  
  let query = `
    SELECT * FROM posts 
    WHERE feed_type = 'global'
    ${cursor ? 'AND created_at < ?' : ''}
    ORDER BY created_at DESC 
    LIMIT ?
  `;
  
  const params = cursor ? [cursor, limit + 1] : [limit + 1];
  const posts = db.prepare(query).all(...params);
  
  const hasMore = posts.length > limit;
  const resultPosts = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? resultPosts[resultPosts.length - 1].created_at : null;
  
  const formattedPosts = resultPosts.map(p => ({
    uri: p.uri,
    cid: p.cid,
    author: {
      did: p.author_did,
      handle: p.author_handle,
      displayName: p.author_name,
      avatar: p.author_avatar,
    },
    record: {
      text: p.text,
      createdAt: p.created_at,
    },
    embed: p.embed_json ? JSON.parse(p.embed_json) : undefined,
    likeCount: p.like_count,
    repostCount: p.repost_count,
    replyCount: p.reply_count,
    indexedAt: p.indexed_at,
  }));
  
  res.json({
    posts: formattedPosts,
    cursor: nextCursor,
  });
});

// Force refresh endpoints
app.post('/feed/refresh/local', async (req, res) => {
  const count = await refreshLocalFeed();
  res.json({ status: 'ok', postsRefreshed: count });
});

app.post('/feed/refresh/global', async (req, res) => {
  const count = await refreshGlobalFeed();
  res.json({ status: 'ok', postsRefreshed: count });
});

// === STARTUP ===

async function start() {
  console.log('[Feed] Starting Cannect Feed Service...');
  
  // Load Cannect users
  await fetchCannectUsers();
  
  // Initial feed load
  await refreshLocalFeed();
  await refreshGlobalFeed();
  
  // Connect to Jetstream for real-time updates
  connectJetstream();
  
  // Periodic refresh (every 5 minutes for global, every 2 minutes for local)
  setInterval(refreshGlobalFeed, 5 * 60 * 1000);
  setInterval(refreshLocalFeed, 2 * 60 * 1000);
  setInterval(fetchCannectUsers, 10 * 60 * 1000); // Refresh user list every 10 min
  
  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Feed] Server running on port ${PORT}`);
  });
}

start().catch(console.error);
