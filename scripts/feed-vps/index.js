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
const { verifyWithAI, scorePost, QUALITY_THRESHOLD } = require('./ai-filter');
const { generateStoryImage, loadFonts } = require('./story-image');
const { generateProfileImage, loadFonts: loadProfileFonts } = require('./profile-image');

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

// Trust proxy for proper IP detection behind Caddy
app.set('trust proxy', 1);

app.use(express.json()); // Parse JSON bodies

// CORS middleware MUST be first - before rate limiting
// Otherwise 429 responses won't have CORS headers
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

// Rate limiting - high limits for app usage
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

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
        expiresAt: new Date(boostInfo.expires_at * 1000).toISOString(),
      });
    }

    // Boost for 24 hours
    const success = db.boostPost(postUri, authorDid);

    if (success) {
      console.log(`[Boost] Post boosted by ${authorDid.substring(0, 20)}...`);
      return res.json({
        success: true,
        message: 'Post boosted for 24 hours',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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
        expiresAt: new Date(boostInfo.expires_at * 1000).toISOString(),
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
      boosts: boosts.map((b) => ({
        postUri: b.post_uri,
        authorDid: b.author_did,
        expiresAt: new Date(b.expires_at * 1000).toISOString(),
      })),
      count: boosts.length,
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

// =============================================================================
// Story Image Generator - Server-side image for Instagram Stories sharing
// =============================================================================

/**
 * Generate Instagram Stories image for a post
 * GET /api/story-image?uri=at://did:plc:.../app.bsky.feed.post/...
 * Returns: PNG image (1080x1920)
 */
app.get('/api/story-image', generalLimiter, async (req, res) => {
  try {
    const { uri } = req.query;

    if (!uri) {
      return res.status(400).json({ error: 'Missing uri parameter' });
    }

    // Validate it's an AT Protocol URI
    if (!uri.startsWith('at://')) {
      return res.status(400).json({ error: 'Invalid AT Protocol URI' });
    }

    // Generate the image
    const pngBuffer = await generateStoryImage(uri);

    // Set cache headers (cache for 1 hour)
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': pngBuffer.length,
      'Cache-Control': 'public, max-age=3600',
    });

    res.send(pngBuffer);
  } catch (err) {
    console.error('[StoryImage] Error:', err.message);
    return res.status(500).json({ error: 'Failed to generate image' });
  }
});

/**
 * Generate shareable profile card image
 * GET /api/profile-image?handle=user.cannect.space
 * Returns: PNG image (1080x1920)
 */
app.get('/api/profile-image', generalLimiter, async (req, res) => {
  try {
    const { handle } = req.query;

    if (!handle) {
      return res.status(400).json({ error: 'Missing handle parameter' });
    }

    // Clean handle (remove @ if present)
    const cleanHandle = handle.replace(/^@/, '');

    // Get user's reach from database (same logic as /api/reach endpoint)
    // First we need to resolve handle to DID
    const { BskyAgent } = require('@atproto/api');
    const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });
    const profile = await agent.getProfile({ actor: cleanHandle });
    const userDid = profile.data.did;

    // Get reach with auto-recalculation if stale (like /api/reach does)
    const STALE_THRESHOLD = 5 * 60; // 5 minutes in seconds
    const now = Math.floor(Date.now() / 1000);
    const data = db.getUserReachData(userDid);
    const isStale = now - data.last_updated > STALE_THRESHOLD;
    const isNew = data.last_updated === 0;
    const reach = isNew || isStale ? db.updateUserReach(userDid) : data.total_reach;

    // Generate the image
    const pngBuffer = await generateProfileImage(cleanHandle, reach);

    // Set cache headers (cache for 1 hour)
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': pngBuffer.length,
      'Cache-Control': 'public, max-age=3600',
    });

    res.send(pngBuffer);
  } catch (err) {
    console.error('[ProfileImage] Error:', err.message);
    return res.status(500).json({ error: 'Failed to generate image' });
  }
});

// =============================================================================
// Post View Tracking API
// =============================================================================

/**
 * Record post views (batch)
 * POST /api/views
 * Body: { views: [{ postUri: "at://...", source: "feed" }], viewerDid?: "did:plc:..." }
 */
app.post('/api/views', generalLimiter, async (req, res) => {
  try {
    const { views, viewerDid } = req.body;

    if (!views || !Array.isArray(views) || views.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid views array' });
    }

    // Limit batch size
    if (views.length > 50) {
      return res.status(400).json({ error: 'Max 50 views per batch' });
    }

    // Validate and prepare views
    const validViews = views
      .filter((v) => v.postUri && v.postUri.startsWith('at://'))
      .map((v) => ({
        postUri: v.postUri,
        viewerDid: viewerDid || null,
        source: v.source || 'feed',
      }));

    if (validViews.length === 0) {
      return res.status(400).json({ error: 'No valid post URIs' });
    }

    // Deduplicate if viewer provided (don't count same post twice in 30 sec)
    const dedupedViews = [];
    for (const view of validViews) {
      if (!viewerDid || !db.hasViewerSeenRecently(view.postUri, viewerDid, 30)) {
        dedupedViews.push(view);
      }
    }

    if (dedupedViews.length > 0) {
      db.recordViewsBatch(dedupedViews);

      // Update user reach for post authors (async, non-blocking)
      const authorDids = new Set();
      for (const view of dedupedViews) {
        // Extract author DID from post URI: at://did:plc:xxx/app.bsky.feed.post/yyy
        const match = view.postUri.match(/^at:\/\/(did:[^/]+)\//);
        if (match) {
          authorDids.add(match[1]);
        }
      }
      // Increment tracked views for each author
      for (const authorDid of authorDids) {
        const viewCount = dedupedViews.filter((v) =>
          v.postUri.startsWith(`at://${authorDid}/`)
        ).length;
        db.incrementUserTrackedViews(authorDid, viewCount);
      }
    }

    res.json({
      success: true,
      recorded: dedupedViews.length,
      skipped: validViews.length - dedupedViews.length,
    });
  } catch (err) {
    console.error('[Views] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get view stats for a post
 * GET /api/views/:postUri (base64 encoded)
 */
app.get('/api/views/post', generalLimiter, async (req, res) => {
  try {
    const { uri } = req.query;

    if (!uri) {
      return res.status(400).json({ error: 'Missing uri parameter' });
    }

    const stats = db.getPostViewStats(uri);
    res.json({
      postUri: uri,
      totalViews: stats.total_views || 0,
      uniqueViewers: stats.unique_viewers || 0,
      firstView: stats.first_view ? new Date(stats.first_view * 1000).toISOString() : null,
      lastView: stats.last_view ? new Date(stats.last_view * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error('[Views] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get trending posts (most viewed)
 * GET /api/trending?hours=24&limit=20
 */
app.get('/api/trending', generalLimiter, async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 168); // Max 1 week
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const trending = db.getTrendingPosts(hours * 60 * 60, limit);
    res.json({
      period: `${hours}h`,
      posts: trending.map((p) => ({
        postUri: p.post_uri,
        views: p.views,
      })),
    });
  } catch (err) {
    console.error('[Trending] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get author's view stats
 * GET /api/views/author?did=did:plc:...
 */
app.get('/api/views/author', generalLimiter, async (req, res) => {
  try {
    const { did } = req.query;

    if (!did) {
      return res.status(400).json({ error: 'Missing did parameter' });
    }

    const stats = db.getAuthorViewStats(did);
    res.json({
      authorDid: did,
      totalViews: stats.total_views || 0,
      uniqueViewers: stats.unique_viewers || 0,
    });
  } catch (err) {
    console.error('[Views] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get user's total reach (stored in database - single source of truth)
 * GET /api/reach?did=did:plc:...
 *
 * Auto-recalculates if:
 * - User doesn't exist in db (first visit)
 * - Data is stale (older than 5 minutes)
 */
app.get('/api/reach', generalLimiter, async (req, res) => {
  try {
    const { did } = req.query;

    if (!did) {
      return res.status(400).json({ error: 'Missing did parameter' });
    }

    const STALE_THRESHOLD = 5 * 60; // 5 minutes in seconds
    const now = Math.floor(Date.now() / 1000);

    // Get stored reach data
    const data = db.getUserReachData(did);

    let reach;
    const isStale = now - data.last_updated > STALE_THRESHOLD;
    const isNew = data.last_updated === 0;

    if (isNew || isStale) {
      // Recalculate and store
      reach = db.updateUserReach(did);
    } else {
      // Return cached value
      reach = data.total_reach;
    }

    res.json({
      did,
      reach,
      cached: !isNew && !isStale,
    });
  } catch (err) {
    console.error('[Reach] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// =============================================================================
// Estimated Views API (Engagement-based, consistent across all users)
// =============================================================================

/**
 * Get views for a single post
 * GET /api/views/count?uri=at://...&likes=10&replies=2&reposts=1
 */
app.get('/api/estimated-views', generalLimiter, async (req, res) => {
  try {
    const { uri, likes, replies, reposts } = req.query;

    if (!uri) {
      return res.status(400).json({ error: 'Missing uri parameter' });
    }

    // Parse engagement counts from query
    const likeCount = parseInt(likes) || 0;
    const replyCount = parseInt(replies) || 0;
    const repostCount = parseInt(reposts) || 0;

    // Update engagement and get views
    const views = db.updateEngagement(uri, likeCount, replyCount, repostCount);

    // Update user reach for the post author (extract DID from URI)
    const match = uri.match(/^at:\/\/(did:[^/]+)\//);
    if (match) {
      // Async update - don't block response
      setImmediate(() => db.updateUserReach(match[1]));
    }

    res.json({
      postUri: uri,
      views,
      // Keep old field names for backwards compatibility
      estimatedViews: views,
    });
  } catch (err) {
    console.error('[Views] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get views for multiple posts at once (batch)
 * POST /api/estimated-views/batch
 * Body: { posts: [{ uri: "at://...", likes: 10, replies: 2, reposts: 1 }, ...] }
 */
app.post('/api/estimated-views/batch', generalLimiter, async (req, res) => {
  try {
    const { posts } = req.body;

    if (!posts || !Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid posts array' });
    }

    // Limit batch size
    if (posts.length > 100) {
      return res.status(400).json({ error: 'Max 100 posts per batch' });
    }

    const result = {};
    for (const post of posts) {
      if (!post.uri) continue;

      const views = db.updateEngagement(
        post.uri,
        post.likes || 0,
        post.replies || 0,
        post.reposts || 0
      );
      result[post.uri] = views;
    }

    res.json({ views: result });
  } catch (err) {
    console.error('[Views] Batch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
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

    // ==========================================================================
    // Scalable Boost Distribution
    //
    // Goals:
    // 1. FAIR: Every boosted post gets equal visibility
    // 2. SPREAD: Boosts are distributed evenly, not clustered
    // 3. FRESH: Order shuffles periodically so feed feels dynamic
    // 4. SCALABLE: Works with 1 boost or 100 boosts
    // 5. NO SPAM: Cap boosts per page to avoid overwhelming users
    //
    // Algorithm:
    // - Show up to MAX_BOOSTS_PER_PAGE boosts per page
    // - Space them BOOST_SPACING posts apart
    // - Shuffle order every SHUFFLE_INTERVAL_MINS
    // - Paginate boosts across scroll pages
    // ==========================================================================
    if (boostedPosts.length > 0) {
      const MAX_BOOSTS_PER_PAGE = 5; // Max boosts to show per page
      const FIRST_BOOST_POSITION = 3; // Where first boost appears
      const BOOST_SPACING = 10; // Minimum posts between boosts
      const SHUFFLE_INTERVAL_MINS = 15; // Reshuffle order every N minutes

      // Shuffle boosts based on time (creates variety without being random)
      const shuffleSeed = Math.floor(Date.now() / (SHUFFLE_INTERVAL_MINS * 60 * 1000));
      const shuffledBoosts = [...boostedPosts].sort((a, b) => {
        // Simple deterministic shuffle based on ID and time
        const hashA = ((a.id || 0) * 31 + shuffleSeed) % 1000;
        const hashB = ((b.id || 0) * 31 + shuffleSeed) % 1000;
        return hashA - hashB;
      });

      // Calculate which boosts to show on this page
      const pageNumber = Math.floor(offset / limit);
      const startBoostIndex = pageNumber * MAX_BOOSTS_PER_PAGE;
      const boostsForThisPage = shuffledBoosts.slice(
        startBoostIndex,
        startBoostIndex + MAX_BOOSTS_PER_PAGE
      );

      // Track how many we've inserted (affects subsequent positions)
      let insertedCount = 0;

      // Inject boosts at evenly spread positions
      boostsForThisPage.forEach((boost, idx) => {
        const position = FIRST_BOOST_POSITION + idx * BOOST_SPACING + insertedCount;

        if (position < feedItems.length) {
          // Skip if already in feed (could be an organic post)
          const alreadyInFeed = feedItems.some((item) => item.post === boost.post_uri);
          if (!alreadyInFeed) {
            feedItems.splice(position, 0, { post: boost.post_uri });
            insertedCount++;
          }
        }
      });

      if (insertedCount > 0) {
        console.log(
          `[Feed] Injected ${insertedCount}/${boostsForThisPage.length} boosts on page ${pageNumber} ` +
            `(total active: ${boostedPosts.length})`
        );
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

    console.log(
      `[Feed] Served ${feedItems.length} posts (offset: ${offset}, boosted: ${boostedPosts.length})`
    );
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
 * Process a post with AI quality scoring
 */
async function processWithAI(uri, cid, did, handle, text, indexedAt, reason) {
  try {
    const aiResult = await scorePost(text);

    if (aiResult.error) {
      // If AI fails, don't include (conservative approach)
      console.log(`[AI-Filter] Error for "${text.substring(0, 40)}..." - skipping`);
      return;
    }

    if (aiResult.isCannabis) {
      db.addPost(uri, cid, did, handle, indexedAt, aiResult.score, aiResult.category);
      stats.indexed++;
      console.log(`[AI-Filter] ✓ INCLUDED [${aiResult.score}/10 ${aiResult.category}] (${reason}): ${text.substring(0, 50)}...`);
    } else {
      console.log(`[AI-Filter] ✗ REJECTED [${aiResult.score}/10 ${aiResult.category}] (${reason}): ${text.substring(0, 50)}...`);
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

  const postCount = db.getCount();
  console.log(`Posts:     ${postCount}`);

  // SAFETY CHECK: Warn if database seems empty (possible mount issue)
  if (postCount < 1000) {
    console.log('='.repeat(60));
    console.log('⚠️  WARNING: Database has fewer than 1000 posts!');
    console.log('⚠️  This may indicate a volume mount issue.');
    console.log('⚠️  Expected 10,000+ posts. Check /app/data mount.');
    console.log('='.repeat(60));
  }

  console.log('='.repeat(60));

  // Fetch cannect.space users first
  await refreshCannectUsers();

  // Preload fonts for story image generation
  try {
    await loadFonts();
    console.log('[Server] Story image fonts loaded');
  } catch (err) {
    console.warn('[Server] Failed to load story image fonts:', err.message);
  }

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
