/**
 * Cannect Feed Generator
 * 
 * Official Bluesky Feed Generator implementation
 * https://docs.bsky.app/docs/starter-templates/custom-feeds
 * 
 * How it works:
 * 1. Listen to Jetstream firehose for posts from curated accounts
 * 2. Store post URIs in SQLite database
 * 3. Serve feed skeleton via /xrpc/app.bsky.feed.getFeedSkeleton
 * 4. Bluesky AppView hydrates posts with full data + viewer state
 * 
 * Feed URI: at://did:plc:YOUR_DID/app.bsky.feed.generator/cannabis
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');

// ============================================
// Configuration
// ============================================

const PORT = process.env.PORT || 3000;
const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe';

// Your feed generator identity (replace with your actual DID)
const FEED_GENERATOR_DID = process.env.FEED_GENERATOR_DID || 'did:plc:ubkp6dfvxif7rmexyat5np6e';

// Feed definitions
const FEEDS = {
  'cannabis': {
    displayName: 'Cannabis Community',
    description: 'Cannabis news, culture, and community from curated accounts',
  },
  'cannect': {
    displayName: 'Cannect Network',
    description: 'Posts from Cannect PDS users',
  },
};

// ============================================
// Curated Cannabis Accounts (137 verified)
// ============================================

const CANNABIS_ACCOUNTS = new Set([
  // High confidence accounts (50%+ cannabis content)
  'normlorg.bsky.social',
  'weedjesus.bsky.social',
  'oglesby.bsky.social',
  'potculturemagazine.com',
  'mimjnews.bsky.social',
  'headynj.bsky.social',
  'mpp.org',
  'montelwilliams.bsky.social',
  'cannabistech.com',
  'weednews.bsky.social',
  'chrisgoldstein.bsky.social',
  'dannydanko.bsky.social',
  'grinspoon.bsky.social',
  'oaksterdam.bsky.social',
  'cacannabisdept.bsky.social',
  'canorml.bsky.social',
  'realjohnnygreen.bsky.social',
  'cannabislover.bsky.social',
  'jberke.bsky.social',
  'mybpg.bsky.social',
  // Add more from verified-accounts.json as needed
]);

// Cannect PDS hostname for local feed
const CANNECT_PDS_HOST = 'cannect.space';

// ============================================
// Database Setup
// ============================================

const db = new Database(path.join(__dirname, 'feed.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    uri TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    author_did TEXT NOT NULL,
    author_handle TEXT,
    created_at TEXT NOT NULL,
    indexed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    feed_type TEXT NOT NULL CHECK(feed_type IN ('cannabis', 'cannect'))
  );
  
  CREATE INDEX IF NOT EXISTS idx_posts_feed_indexed 
    ON posts(feed_type, indexed_at DESC);
  
  CREATE INDEX IF NOT EXISTS idx_posts_author 
    ON posts(author_did);
`);

// Prepared statements
const insertPost = db.prepare(`
  INSERT OR IGNORE INTO posts (uri, cid, author_did, author_handle, created_at, feed_type)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const deletePost = db.prepare(`DELETE FROM posts WHERE uri = ?`);

const getFeedPosts = db.prepare(`
  SELECT uri FROM posts 
  WHERE feed_type = ? 
  ORDER BY indexed_at DESC 
  LIMIT ?
`);

const getFeedPostsWithCursor = db.prepare(`
  SELECT uri FROM posts 
  WHERE feed_type = ? AND indexed_at < ?
  ORDER BY indexed_at DESC 
  LIMIT ?
`);

const getPostIndexedAt = db.prepare(`
  SELECT indexed_at FROM posts WHERE uri = ?
`);

console.log('[DB] Database initialized');

// ============================================
// DID Cache (handle → DID mapping)
// ============================================

const didCache = new Map();

async function resolveDid(handle) {
  if (didCache.has(handle)) {
    return didCache.get(handle);
  }
  
  try {
    const response = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    if (response.ok) {
      const data = await response.json();
      didCache.set(handle, data.did);
      return data.did;
    }
  } catch (error) {
    console.warn(`[DID] Failed to resolve ${handle}:`, error.message);
  }
  
  return null;
}

// Pre-resolve DIDs for curated accounts
async function initializeDids() {
  console.log('[DID] Resolving DIDs for curated accounts...');
  
  for (const handle of CANNABIS_ACCOUNTS) {
    await resolveDid(handle);
  }
  
  console.log(`[DID] Resolved ${didCache.size} DIDs`);
}

// ============================================
// Jetstream Firehose Connection
// ============================================

let ws = null;
let reconnectTimer = null;

function connectJetstream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Build collections filter
  const params = new URLSearchParams();
  params.set('wantedCollections', 'app.bsky.feed.post');
  
  const url = `${JETSTREAM_URL}?${params}`;
  
  console.log('[Jetstream] Connecting...');
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[Jetstream] Connected');
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      handleJetstreamEvent(event);
    } catch (error) {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('[Jetstream] Disconnected, reconnecting in 5s...');
    reconnectTimer = setTimeout(connectJetstream, 5000);
  });

  ws.on('error', (error) => {
    console.error('[Jetstream] Error:', error.message);
  });
}

function handleJetstreamEvent(event) {
  // Only process post commits
  if (event.kind !== 'commit') return;
  if (event.commit?.collection !== 'app.bsky.feed.post') return;

  const { did, commit } = event;
  const { operation, rkey, record } = commit;

  if (operation === 'create' && record) {
    handleNewPost(did, rkey, record, commit.cid);
  } else if (operation === 'delete') {
    const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
    deletePost.run(uri);
  }
}

function handleNewPost(did, rkey, record, cid) {
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const createdAt = record.createdAt;
  
  // Determine feed type
  let feedType = null;
  
  // Check if author is in cannabis accounts (by DID)
  for (const [handle, cachedDid] of didCache.entries()) {
    if (cachedDid === did) {
      feedType = 'cannabis';
      insertPost.run(uri, cid, did, handle, createdAt, feedType);
      return;
    }
  }
  
  // Check if from Cannect PDS (local feed)
  // DIDs from Cannect PDS start with did:plc: and resolve to cannect.space
  // For now, we'll check the handle if available
  // This is handled separately via PDS events
  
  // If not matched, skip
}

// ============================================
// Express Server
// ============================================

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    name: 'Cannect Feed Generator',
    version: '1.0.0',
    feeds: Object.keys(FEEDS),
  });
});

// ============================================
// AT Protocol Feed Generator Endpoints
// ============================================

/**
 * Describe Feed Generator
 * Returns information about available feeds
 */
app.get('/xrpc/app.bsky.feed.describeFeedGenerator', (req, res) => {
  const feeds = Object.entries(FEEDS).map(([shortname, info]) => ({
    uri: `at://${FEED_GENERATOR_DID}/app.bsky.feed.generator/${shortname}`,
    ...info,
  }));

  res.json({
    did: FEED_GENERATOR_DID,
    feeds,
  });
});

/**
 * Get Feed Skeleton
 * Returns just the post URIs - Bluesky hydrates them with full data
 */
app.get('/xrpc/app.bsky.feed.getFeedSkeleton', (req, res) => {
  const { feed, limit = 50, cursor } = req.query;
  
  if (!feed) {
    return res.status(400).json({ error: 'InvalidRequest', message: 'feed parameter required' });
  }

  // Parse feed URI: at://did/app.bsky.feed.generator/shortname
  const feedParts = feed.split('/');
  const shortname = feedParts[feedParts.length - 1];
  
  if (!FEEDS[shortname]) {
    return res.status(400).json({ error: 'UnknownFeed', message: `Unknown feed: ${shortname}` });
  }

  const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
  
  let posts;
  if (cursor) {
    // Cursor is the indexed_at timestamp
    const cursorTime = parseInt(cursor, 10);
    posts = getFeedPostsWithCursor.all(shortname, cursorTime, limitNum);
  } else {
    posts = getFeedPosts.all(shortname, limitNum);
  }

  // Build response
  const feedItems = posts.map(p => ({ post: p.uri }));
  
  // Build cursor from last post
  let nextCursor;
  if (posts.length > 0) {
    const lastUri = posts[posts.length - 1].uri;
    const lastPost = getPostIndexedAt.get(lastUri);
    if (lastPost) {
      nextCursor = String(lastPost.indexed_at);
    }
  }

  res.json({
    feed: feedItems,
    cursor: nextCursor,
  });
});

// ============================================
// Well-Known DID Document
// ============================================

app.get('/.well-known/did.json', (req, res) => {
  const hostname = req.get('host');
  
  res.json({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: `did:web:${hostname}`,
    service: [
      {
        id: '#bsky_fg',
        type: 'BskyFeedGenerator',
        serviceEndpoint: `https://${hostname}`,
      },
    ],
  });
});

// ============================================
// Admin Endpoints (for debugging)
// ============================================

app.get('/admin/stats', (req, res) => {
  const cannabisCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE feed_type = ?').get('cannabis');
  const cannectCount = db.prepare('SELECT COUNT(*) as count FROM posts WHERE feed_type = ?').get('cannect');
  
  res.json({
    feeds: {
      cannabis: cannabisCount.count,
      cannect: cannectCount.count,
    },
    didsCached: didCache.size,
    jetstreamConnected: ws?.readyState === WebSocket.OPEN,
  });
});

app.get('/admin/recent/:feed', (req, res) => {
  const { feed } = req.params;
  const posts = getFeedPosts.all(feed, 20);
  res.json(posts);
});

// ============================================
// Start Server
// ============================================

async function start() {
  // Initialize DIDs
  await initializeDids();
  
  // Connect to Jetstream
  connectJetstream();
  
  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`[Server] Feed Generator running on port ${PORT}`);
    console.log(`[Server] Feeds: ${Object.keys(FEEDS).join(', ')}`);
  });
}

start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  if (ws) ws.close();
  db.close();
  process.exit(0);
});
