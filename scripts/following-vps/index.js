/**
 * Following Timeline Service for Cannect
 *
 * Aggregates posts from users that the requesting user follows.
 * Uses Bluesky public API - pure AT Protocol.
 *
 * Port: 3002
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;

// CORS for Cannect app
app.use(
  cors({
    origin: [
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
    ],
  })
);

app.use(express.json());

// Rate limiting
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP (expensive queries)
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// =============================================================================
// CACHE
// =============================================================================

const cache = {
  follows: new Map(), // "did:plc:xxx" -> { data: [...], expires: timestamp }
  posts: new Map(), // "did:plc:xxx" -> { data: [...], expires: timestamp }
};

const CACHE_TTL = {
  FOLLOWS: 5 * 60 * 1000, // 5 minutes
  POSTS: 2 * 60 * 1000, // 2 minutes
};

function getCached(map, key) {
  const entry = map.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.data;
  }
  map.delete(key);
  return null;
}

function setCache(map, key, data, ttl) {
  map.set(key, { data, expires: Date.now() + ttl });
}

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.follows) {
    if (entry.expires <= now) cache.follows.delete(key);
  }
  for (const [key, entry] of cache.posts) {
    if (entry.expires <= now) cache.posts.delete(key);
  }
}, 60 * 1000); // Every minute

// =============================================================================
// BLUESKY API HELPERS
// =============================================================================

const BSKY_PUBLIC_API = 'https://public.api.bsky.app/xrpc';

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get list of DIDs that a user follows
 */
async function getFollows(actor) {
  // Check cache
  const cached = getCached(cache.follows, actor);
  if (cached) {
    console.log(`[CACHE HIT] follows:${actor}`);
    return cached;
  }

  console.log(`[API CALL] getFollows:${actor}`);

  const follows = [];
  let cursor = null;

  // Paginate through all follows (max 100 per request)
  do {
    const url = `${BSKY_PUBLIC_API}/app.bsky.graph.getFollows?actor=${encodeURIComponent(actor)}&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    const data = await fetchJson(url);

    follows.push(...data.follows.map((f) => f.did));
    cursor = data.cursor;
  } while (cursor);

  // Cache the result
  setCache(cache.follows, actor, follows, CACHE_TTL.FOLLOWS);

  return follows;
}

/**
 * Get recent posts from a user
 */
async function getAuthorPosts(did, limit = 20) {
  // Check cache
  const cached = getCached(cache.posts, did);
  if (cached) {
    console.log(`[CACHE HIT] posts:${did.slice(-8)}`);
    return cached;
  }

  console.log(`[API CALL] getAuthorFeed:${did.slice(-8)}`);

  try {
    const url = `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&limit=${limit}&filter=posts_and_author_threads`;
    const data = await fetchJson(url);

    // Cache the result
    setCache(cache.posts, did, data.feed || [], CACHE_TTL.POSTS);

    return data.feed || [];
  } catch (error) {
    console.error(`Error fetching posts for ${did}:`, error.message);
    return [];
  }
}

// =============================================================================
// MAIN ENDPOINT
// =============================================================================

/**
 * GET /api/following
 *
 * Query params:
 *   - actor: DID or handle of the user (required)
 *   - limit: Number of posts to return (default: 50, max: 100)
 *   - cursor: Pagination cursor (ISO timestamp)
 */
app.get('/api/following', apiLimiter, async (req, res) => {
  const startTime = Date.now();

  try {
    const { actor, limit = 50, cursor } = req.query;

    if (!actor) {
      return res.status(400).json({ error: 'actor parameter is required' });
    }

    const requestedLimit = Math.min(parseInt(limit) || 50, 100);

    // Step 1: Get follows
    const followDids = await getFollows(actor);

    if (followDids.length === 0) {
      return res.json({ feed: [], cursor: null });
    }

    console.log(`[INFO] ${actor} follows ${followDids.length} accounts`);

    // Step 2: Fetch posts from all follows (parallel, max 10 concurrent)
    const CONCURRENCY = 10;
    const allPosts = [];

    for (let i = 0; i < followDids.length; i += CONCURRENCY) {
      const batch = followDids.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map((did) => getAuthorPosts(did, 20)));
      batchResults.forEach((posts) => allPosts.push(...posts));
    }

    // Step 3: Deduplicate by post URI
    const seenUris = new Set();
    const uniquePosts = allPosts.filter((item) => {
      if (seenUris.has(item.post.uri)) return false;
      seenUris.add(item.post.uri);
      return true;
    });

    // Step 4: Sort by createdAt (newest first)
    uniquePosts.sort((a, b) => {
      const timeA = new Date(a.post.record.createdAt || a.post.indexedAt).getTime();
      const timeB = new Date(b.post.record.createdAt || b.post.indexedAt).getTime();
      return timeB - timeA;
    });

    // Step 5: Apply cursor (pagination)
    let filteredPosts = uniquePosts;
    if (cursor) {
      const cursorTime = new Date(cursor).getTime();
      filteredPosts = uniquePosts.filter((item) => {
        const postTime = new Date(item.post.record.createdAt || item.post.indexedAt).getTime();
        return postTime < cursorTime;
      });
    }

    // Step 6: Slice to limit
    const resultPosts = filteredPosts.slice(0, requestedLimit);

    // Step 7: Generate next cursor
    let nextCursor = null;
    if (resultPosts.length === requestedLimit && filteredPosts.length > requestedLimit) {
      const lastPost = resultPosts[resultPosts.length - 1];
      nextCursor = lastPost.post.record.createdAt || lastPost.post.indexedAt;
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[DONE] ${resultPosts.length} posts in ${elapsed}ms (${followDids.length} follows)`
    );

    res.json({
      feed: resultPosts,
      cursor: nextCursor,
    });
  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch timeline', details: error.message });
  }
});

// =============================================================================
// HEALTH & STATS
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'following-timeline',
    cache: {
      follows: cache.follows.size,
      posts: cache.posts.size,
    },
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Cannect Following Timeline',
    version: '1.0.0',
    endpoints: {
      '/api/following': 'GET - Fetch following timeline (params: actor, limit, cursor)',
      '/health': 'GET - Health check with cache stats',
    },
  });
});

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log(`Following Timeline Service running on port ${PORT}`);
  console.log(`Cache TTL: follows=${CACHE_TTL.FOLLOWS / 1000}s, posts=${CACHE_TTL.POSTS / 1000}s`);
});
