/**
 * Cannect Feed Generator
 *
 * A Bluesky Feed Generator for the cannabis community.
 *
 * Includes:
 * - All posts from cannect.space users
 * - Posts containing cannabis keywords from anywhere on Bluesky
 *
 * Architecture:
 * - Jetstream WebSocket for real-time post ingestion
 * - SQLite for post storage
 * - Express for AT Protocol feed endpoints
 */

require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const db = require('./db');
const { shouldIncludePost, getPostText } = require('./feed-logic');
const { verifyWithAI } = require('./ai-filter');

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.FEEDGEN_PORT || 3000;
const HOSTNAME = process.env.FEEDGEN_HOSTNAME || 'feed.cannect.space';
const PUBLISHER_DID = process.env.FEEDGEN_PUBLISHER_DID;
const CANNECT_PDS_URLS = ['https://cannect.space', 'https://pds.cannect.space'];

// =============================================================================
// Cannect User DID Cache
// =============================================================================

// Set of DIDs that belong to Cannect users (from all PDSes)
const cannectUserDIDs = new Set();

async function refreshCannectUsers() {
  try {
    console.log('[Users] Fetching users from all Cannect PDSes...');
    const oldCount = cannectUserDIDs.size;
    cannectUserDIDs.clear();

    for (const pdsUrl of CANNECT_PDS_URLS) {
      try {
        const response = await fetch(`${pdsUrl}/xrpc/com.atproto.sync.listRepos?limit=1000`);
        if (!response.ok) {
          console.warn(`[Users] Failed to fetch from ${pdsUrl}: HTTP ${response.status}`);
          continue;
        }
        const data = await response.json();
        for (const repo of data.repos || []) {
          if (repo.did) cannectUserDIDs.add(repo.did);
        }
        console.log(`[Users] Loaded from ${pdsUrl}: ${data.repos?.length || 0} users`);
      } catch (err) {
        console.warn(`[Users] Failed to fetch from ${pdsUrl}:`, err.message);
      }
    }

    console.log(`[Users] Total: ${cannectUserDIDs.size} Cannect users (was ${oldCount})`);
  } catch (err) {
    console.error('[Users] Failed to fetch users:', err.message);
  }
}

// Check if a DID belongs to a cannect.space user
function isCannectUser(did) {
  return cannectUserDIDs.has(did);
}

// Feed URI - this is what the app uses
const FEED_URI = `at://${PUBLISHER_DID}/app.bsky.feed.generator/cannect`;

// Jetstream endpoint
const JETSTREAM_URL =
  'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

// =============================================================================
// Express Server - AT Protocol Endpoints
// =============================================================================

const app = express();
const rateLimit = require('express-rate-limit');

app.use(express.json()); // Parse JSON bodies

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute (for notify-post)
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// CORS middleware for cross-origin requests from the Cannect app
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://cannect.net',
    'https://www.cannect.net',
    'https://cannect.nexus',
    'https://www.cannect.nexus',
    'https://cannect-app.vercel.app',
    'https://cannect-vps-proxy.vercel.app',
    'https://cannect-proxy.vercel.app',
    'https://cannect.space',
    'https://pds.cannect.space',
    'http://localhost:8081',
    'http://localhost:19006',
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  const count = db.getCount();
  res.json({
    status: 'ok',
    posts: count,
    cannectUsers: cannectUserDIDs.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Notify Endpoint - Instant post inclusion for Cannect App
// =============================================================================

app.post('/api/notify-post', strictLimiter, async (req, res) => {
  try {
    const { uri, cid, authorDid } = req.body;

    // Validate required fields
    if (!uri || !authorDid) {
      return res.status(400).json({ error: 'Missing uri or authorDid' });
    }

    // Validate URI format
    if (!uri.startsWith('at://')) {
      return res.status(400).json({ error: 'Invalid URI format' });
    }

    // Only accept posts from cannect.space users
    if (!isCannectUser(authorDid)) {
      // Refresh user list and try again (in case they just signed up)
      await refreshCannectUsers();

      if (!isCannectUser(authorDid)) {
        return res.status(403).json({ error: 'Not a cannect.space user' });
      }
    }

    // Add to database
    const indexedAt = new Date().toISOString();
    const success = db.addPost(uri, cid || '', authorDid, 'cannect.space', indexedAt);

    if (success) {
      console.log(`[Notify] Added post from cannect user: ${uri.substring(0, 60)}...`);
      return res.json({ success: true, message: 'Post added to feed' });
    } else {
      return res.status(500).json({ error: 'Failed to add post' });
    }
  } catch (err) {
    console.error('[Notify] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// Boost Post API - Let users boost their posts for visibility
// =============================================================================

/**
 * Boost a post (author only)
 * POST /api/boost
 * Body: { postUri: "at://...", authorDid: "did:plc:..." }
 */
app.post('/api/boost', strictLimiter, async (req, res) => {
  try {
    const { postUri, authorDid } = req.body;

    if (!postUri || !authorDid) {
      return res.status(400).json({ error: 'Missing postUri or authorDid' });
    }

    // Validate URI format and ownership
    if (!postUri.startsWith('at://')) {
      return res.status(400).json({ error: 'Invalid post URI format' });
    }

    // Extract author DID from post URI to verify ownership
    const uriParts = postUri.split('/');
    const postAuthor = uriParts[2]; // at://DID/collection/rkey

    if (postAuthor !== authorDid) {
      return res.status(403).json({ error: 'You can only boost your own posts' });
    }

    // Check if already boosted
    if (db.isPostBoosted(postUri)) {
      const boostInfo = db.getBoostInfo(postUri);
      const expiresIn = boostInfo.expires_at - Math.floor(Date.now() / 1000);
      return res.status(400).json({ 
        error: 'Post already boosted', 
        expiresIn,
        expiresAt: new Date(boostInfo.expires_at * 1000).toISOString()
      });
    }

    // Boost for 24 hours
    const success = db.boostPost(postUri, authorDid);

    if (success) {
      console.log(`[Boost] Post boosted by ${authorDid.substring(0, 20)}...`);
      return res.json({ 
        success: true, 
        message: 'Post boosted for 24 hours',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    } else {
      return res.status(500).json({ error: 'Failed to boost post' });
    }
  } catch (err) {
    console.error('[Boost] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Remove boost from a post
 * DELETE /api/boost
 * Body: { postUri: "at://...", authorDid: "did:plc:..." }
 */
app.delete('/api/boost', strictLimiter, async (req, res) => {
  try {
    const { postUri, authorDid } = req.body;

    if (!postUri || !authorDid) {
      return res.status(400).json({ error: 'Missing postUri or authorDid' });
    }

    // Verify ownership
    const uriParts = postUri.split('/');
    const postAuthor = uriParts[2];

    if (postAuthor !== authorDid) {
      return res.status(403).json({ error: 'You can only unboost your own posts' });
    }

    const success = db.unboostPost(postUri);

    if (success) {
      return res.json({ success: true, message: 'Boost removed' });
    } else {
      return res.status(500).json({ error: 'Failed to remove boost' });
    }
  } catch (err) {
    console.error('[Boost] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Check if a post is boosted
 * GET /api/boost?postUri=at://...
 */
app.get('/api/boost', generalLimiter, (req, res) => {
  try {
    const { postUri } = req.query;

    if (!postUri) {
      return res.status(400).json({ error: 'Missing postUri parameter' });
    }

    const boostInfo = db.getBoostInfo(postUri);

    if (boostInfo) {
      const expiresIn = boostInfo.expires_at - Math.floor(Date.now() / 1000);
      return res.json({
        boosted: true,
        expiresIn,
        expiresAt: new Date(boostInfo.expires_at * 1000).toISOString()
      });
    } else {
      return res.json({ boosted: false });
    }
  } catch (err) {
    console.error('[Boost] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all active boosted post URIs
 * GET /api/boosts
 */
app.get('/api/boosts', generalLimiter, (req, res) => {
  try {
    const boosts = db.getActiveBoostedPosts();
    return res.json({
      boosts: boosts.map(b => ({
        postUri: b.post_uri,
        authorDid: b.author_did,
        expiresAt: new Date(b.expires_at * 1000).toISOString()
      })),
      count: boosts.length
    });
  } catch (err) {
    console.error('[Boost] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// oEmbed Proxy - Fetch video metadata for YouTube URLs (CORS-safe)
// =============================================================================

app.get('/api/oembed', generalLimiter, async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Only allow YouTube URLs for security
    const isYouTube = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url);
    if (!isYouTube) {
      return res.status(400).json({ error: 'Only YouTube URLs are supported' });
    }

    // Fetch from YouTube's oEmbed endpoint
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Cannect/1.0' },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch video metadata' });
    }

    const data = await response.json();

    // Return only the fields we need
    res.json({
      title: data.title || 'YouTube Video',
      author_name: data.author_name || '',
      thumbnail_url: data.thumbnail_url || '',
      provider_name: data.provider_name || 'YouTube',
    });
  } catch (err) {
    console.error('[oEmbed] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

// DID document for feed generator
app.get('/.well-known/did.json', (req, res) => {
  res.json({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: `did:web:${HOSTNAME}`,
    service: [
      {
        id: '#bsky_fg',
        type: 'BskyFeedGenerator',
        serviceEndpoint: `https://${HOSTNAME}`,
      },
    ],
  });
});

// Describe feed generator
app.get('/xrpc/app.bsky.feed.describeFeedGenerator', (req, res) => {
  res.json({
    did: `did:web:${HOSTNAME}`,
    feeds: [
      {
        uri: FEED_URI,
      },
    ],
  });
});

// Get feed skeleton - THE MAIN ENDPOINT
app.get('/xrpc/app.bsky.feed.getFeedSkeleton', (req, res) => {
  try {
    const feed = req.query.feed;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const cursor = req.query.cursor;

    // Parse cursor (format: "timestamp:offset")
    let offset = 0;
    if (cursor) {
      const parts = cursor.split(':');
      offset = parseInt(parts[1]) || 0;
    }

    // Get posts from database
    const posts = db.getPosts(limit, offset);

    // Get active boosted posts and inject them into the feed
    const boostedPosts = db.getActiveBoostedPosts();
    let feedItems = posts.map((uri) => ({ post: uri }));

    // Inject boosted posts - show 1 boosted post per ~10 regular posts
    // Only inject on first page or randomly
    if (boostedPosts.length > 0 && offset === 0) {
      // Inject first boosted post near position 3-5
      const position = Math.floor(Math.random() * 3) + 3;
      if (position < feedItems.length) {
        const boostToInject = boostedPosts[Math.floor(Math.random() * boostedPosts.length)];
        // Make sure we're not duplicating a post already in the feed
        const alreadyInFeed = feedItems.some(item => item.post === boostToInject.post_uri);
        if (!alreadyInFeed) {
          feedItems.splice(position, 0, { post: boostToInject.post_uri, reason: 'promoted' });
          console.log(`[Feed] Injected boosted post at position ${position}`);
        }
      }
    } else if (boostedPosts.length > 0 && Math.random() < 0.3) {
      // 30% chance to inject on paginated loads
      const position = Math.floor(Math.random() * 5) + 3;
      if (position < feedItems.length) {
        const boostToInject = boostedPosts[Math.floor(Math.random() * boostedPosts.length)];
        const alreadyInFeed = feedItems.some(item => item.post === boostToInject.post_uri);
        if (!alreadyInFeed) {
          feedItems.splice(position, 0, { post: boostToInject.post_uri, reason: 'promoted' });
        }
      }
    }

    // Build response
    const response = {
      feed: feedItems,
    };

    // Add cursor if there are more posts
    if (posts.length === limit) {
      response.cursor = `${Date.now()}:${offset + limit}`;
    }

    console.log(`[Feed] Served ${feedItems.length} posts (offset: ${offset}, boosted: ${boostedPosts.length})`);
    res.json(response);
  } catch (err) {
    console.error('[Feed] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// Jetstream - Real-time Post Ingestion
// =============================================================================

let ws = null;
let reconnectAttempts = 0;
let stats = { processed: 0, indexed: 0, deleted: 0 };

function connectJetstream() {
  console.log('[Jetstream] Connecting...');

  ws = new WebSocket(JETSTREAM_URL);

  ws.on('open', () => {
    console.log('[Jetstream] Connected!');
    reconnectAttempts = 0;
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      handleJetstreamEvent(event);
    } catch (err) {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('[Jetstream] Connection closed, reconnecting...');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[Jetstream] Error:', err.message);
  });
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  console.log(`[Jetstream] Reconnecting in ${delay}ms...`);
  setTimeout(connectJetstream, delay);
}

function handleJetstreamEvent(event) {
  // Only handle commits
  if (event.kind !== 'commit') return;

  const { commit, did } = event;
  if (!commit) return;

  stats.processed++;

  // Handle post creation
  if (commit.operation === 'create' && commit.collection === 'app.bsky.feed.post') {
    handleNewPost(did, commit);
  }

  // Handle post deletion
  if (commit.operation === 'delete' && commit.collection === 'app.bsky.feed.post') {
    const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
    db.removePost(uri);
    stats.deleted++;
  }
}

function handleNewPost(did, commit) {
  const record = commit.record;
  if (!record) return;

  // Skip replies - only include top-level posts for better feed quality
  if (record.reply) {
    return;
  }

  // Get post text
  const text = getPostText(record);

  // Check if this is a cannect.space user (by DID lookup)
  const isCannectSpaceUser = isCannectUser(did);

  // Check if post should be included
  // Pass a fake handle for cannect.space users so shouldIncludePost works
  const handle = isCannectSpaceUser ? 'user.cannect.space' : '';
  const result = shouldIncludePost(handle, text);

  const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
  const cid = commit.cid;
  // Always use server UTC time for consistent sorting
  const indexedAt = new Date().toISOString();

  // If post should be included directly (high confidence or cannect user)
  if (result.include) {
    db.addPost(uri, cid, did, handle, indexedAt);
    stats.indexed++;

    if (result.reason === 'cannect_user') {
      console.log(`[Indexer] Cannect user post: ${uri.substring(0, 60)}...`);
    }

    if (stats.indexed % 100 === 0) {
      console.log(`[Indexer] Stats: ${stats.indexed} indexed, ${stats.processed} processed`);
    }
    return;
  }

  // If post needs AI verification (ambiguous content)
  if (result.needsAI && text) {
    // Process async - don't block the main event loop
    processWithAI(uri, cid, did, handle, text, indexedAt, result.reason).catch((err) => {
      console.error(`[AI-Filter] Error processing post:`, err.message);
    });
  }
}

/**
 * Process a post with AI verification
 */
async function processWithAI(uri, cid, did, handle, text, indexedAt, reason) {
  try {
    const aiResult = await verifyWithAI(text);

    if (aiResult.error) {
      // If AI fails, don't include (conservative approach)
      console.log(`[AI-Filter] Error for "${text.substring(0, 40)}..." - skipping`);
      return;
    }

    if (aiResult.isCannabis) {
      db.addPost(uri, cid, did, handle, indexedAt);
      stats.indexed++;
      console.log(`[AI-Filter] ✓ INCLUDED (${reason}): ${text.substring(0, 50)}...`);
    } else {
      console.log(`[AI-Filter] ✗ REJECTED (${reason}): ${text.substring(0, 50)}...`);
    }
  } catch (err) {
    console.error(`[AI-Filter] Exception:`, err.message);
  }
}

// =============================================================================
// Maintenance - Cleanup DISABLED (posts kept forever)
// =============================================================================

// Cleanup is disabled - posts are kept indefinitely
// To manually clean old posts, use: db.cleanup(days * 24 * 60 * 60)
// function runCleanup() {
//   const deleted = db.cleanup(7 * 24 * 60 * 60); // 7 days
//   if (deleted > 0) {
//     console.log(`[Cleanup] Removed ${deleted} old posts`);
//   }
// }
// setInterval(runCleanup, 60 * 60 * 1000);

// =============================================================================
// Stats logging
// =============================================================================

setInterval(() => {
  const count = db.getCount();
  console.log(
    `[Stats] Posts in DB: ${count} | Indexed: ${stats.indexed} | Processed: ${stats.processed}`
  );
}, 60 * 1000); // Every minute

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, async () => {
  console.log('='.repeat(60));
  console.log('Cannect Feed Generator');
  console.log('='.repeat(60));
  console.log(`Server:    http://localhost:${PORT}`);
  console.log(`Hostname:  ${HOSTNAME}`);
  console.log(`Feed URI:  ${FEED_URI}`);
  console.log(`Posts:     ${db.getCount()}`);
  console.log('='.repeat(60));

  // Fetch cannect.space users first
  await refreshCannectUsers();

  // Refresh user list every 5 minutes
  setInterval(refreshCannectUsers, 5 * 60 * 1000);

  // Connect to Jetstream
  connectJetstream();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  if (ws) ws.close();
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  if (ws) ws.close();
  db.close();
  process.exit(0);
});
