/**
 * SQLite Database for Feed Generator
 *
 * Stores post URIs for the feed. Simple and reliable.
 * Auto-cleans posts older than 7 days.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'posts.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    uri TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    author_did TEXT NOT NULL,
    author_handle TEXT,
    indexed_at TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_indexed_at ON posts(indexed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_author ON posts(author_did);
  CREATE INDEX IF NOT EXISTS idx_created ON posts(created_at);

  -- Boosted posts table
  CREATE TABLE IF NOT EXISTS boosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_uri TEXT NOT NULL,
    author_did TEXT NOT NULL,
    boosted_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    UNIQUE(post_uri)
  );

  CREATE INDEX IF NOT EXISTS idx_boost_expires ON boosts(expires_at);
  CREATE INDEX IF NOT EXISTS idx_boost_author ON boosts(author_did);

  -- Post views table for tracking impressions
  CREATE TABLE IF NOT EXISTS post_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_uri TEXT NOT NULL,
    viewer_did TEXT,
    viewed_at INTEGER DEFAULT (unixepoch()),
    source TEXT DEFAULT 'feed'
  );

  CREATE INDEX IF NOT EXISTS idx_views_post ON post_views(post_uri);
  CREATE INDEX IF NOT EXISTS idx_views_viewer ON post_views(viewer_did);
  CREATE INDEX IF NOT EXISTS idx_views_time ON post_views(viewed_at);

  -- Aggregate view counts (updated periodically for performance)
  CREATE TABLE IF NOT EXISTS post_view_counts (
    post_uri TEXT PRIMARY KEY,
    view_count INTEGER DEFAULT 0,
    unique_viewers INTEGER DEFAULT 0,
    last_updated INTEGER DEFAULT (unixepoch())
  );

  -- Estimated views table with gradual release system
  -- released_views: views already shown to users
  -- pending_views: views waiting to trickle in
  -- pending_started_at: when the current pending batch started (for calculating release rate)
  CREATE TABLE IF NOT EXISTS estimated_views (
    post_uri TEXT PRIMARY KEY,
    like_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    released_views INTEGER DEFAULT 0,
    pending_views INTEGER DEFAULT 0,
    pending_started_at INTEGER DEFAULT 0,
    last_updated INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_estimated_views ON estimated_views(released_views DESC);
`);

// Prepared statements for performance
const insertPost = db.prepare(`
  INSERT OR REPLACE INTO posts (uri, cid, author_did, author_handle, indexed_at)
  VALUES (?, ?, ?, ?, ?)
`);

const deletePost = db.prepare(`DELETE FROM posts WHERE uri = ?`);

const getFeed = db.prepare(`
  SELECT uri FROM posts
  ORDER BY indexed_at DESC
  LIMIT ? OFFSET ?
`);

const getPostCount = db.prepare(`SELECT COUNT(*) as count FROM posts`);

const getAllPostsStmt = db.prepare(`SELECT uri, author_did, author_handle FROM posts`);

const cleanOldPosts = db.prepare(`
  DELETE FROM posts WHERE created_at < unixepoch() - ?
`);

// Boost prepared statements
const insertBoost = db.prepare(`
  INSERT OR REPLACE INTO boosts (post_uri, author_did, boosted_at, expires_at)
  VALUES (?, ?, unixepoch(), unixepoch() + ?)
`);

const removeBoost = db.prepare(`DELETE FROM boosts WHERE post_uri = ?`);

const getActiveBoosts = db.prepare(`
  SELECT post_uri, author_did, boosted_at, expires_at 
  FROM boosts 
  WHERE expires_at > unixepoch()
  ORDER BY boosted_at DESC
`);

const getBoostByUri = db.prepare(`
  SELECT post_uri, author_did, boosted_at, expires_at 
  FROM boosts 
  WHERE post_uri = ? AND expires_at > unixepoch()
`);

const getBoostsByAuthor = db.prepare(`
  SELECT post_uri, boosted_at, expires_at 
  FROM boosts 
  WHERE author_did = ? AND expires_at > unixepoch()
`);

const cleanExpiredBoosts = db.prepare(`
  DELETE FROM boosts WHERE expires_at < unixepoch()
`);

// View tracking prepared statements
const insertView = db.prepare(`
  INSERT INTO post_views (post_uri, viewer_did, source)
  VALUES (?, ?, ?)
`);

const insertViewsBatch = db.prepare(`
  INSERT INTO post_views (post_uri, viewer_did, source)
  VALUES (?, ?, ?)
`);

const getViewCount = db.prepare(`
  SELECT COUNT(*) as count FROM post_views WHERE post_uri = ?
`);

const getUniqueViewers = db.prepare(`
  SELECT COUNT(DISTINCT viewer_did) as count FROM post_views 
  WHERE post_uri = ? AND viewer_did IS NOT NULL
`);

const getPostStats = db.prepare(`
  SELECT 
    COUNT(*) as total_views,
    COUNT(DISTINCT viewer_did) as unique_viewers,
    MIN(viewed_at) as first_view,
    MAX(viewed_at) as last_view
  FROM post_views 
  WHERE post_uri = ?
`);

const getRecentViews = db.prepare(`
  SELECT post_uri, COUNT(*) as views 
  FROM post_views 
  WHERE viewed_at > unixepoch() - ?
  GROUP BY post_uri 
  ORDER BY views DESC 
  LIMIT ?
`);

const hasViewedRecently = db.prepare(`
  SELECT 1 FROM post_views 
  WHERE post_uri = ? AND viewer_did = ? AND viewed_at > unixepoch() - ?
  LIMIT 1
`);

const cleanOldViews = db.prepare(`
  DELETE FROM post_views WHERE viewed_at < unixepoch() - ?
`);

const getAuthorViewStatsStmt = db.prepare(`
  SELECT 
    p.author_did,
    COUNT(*) as total_views,
    COUNT(DISTINCT pv.viewer_did) as unique_viewers
  FROM post_views pv
  JOIN posts p ON p.uri = pv.post_uri
  WHERE p.author_did = ?
  GROUP BY p.author_did
`);

// =============================================================================
// View Count System
// =============================================================================
// View Count System
// =============================================================================
// Views are tracked when posts enter the viewport.
// Engagement (likes/replies/reposts) provides a minimum baseline.

const upsertEngagement = db.prepare(`
  INSERT INTO estimated_views (post_uri, like_count, reply_count, repost_count, released_views, pending_views, pending_started_at, last_updated)
  VALUES (?, ?, ?, ?, 0, 0, 0, unixepoch())
  ON CONFLICT(post_uri) DO UPDATE SET
    like_count = excluded.like_count,
    reply_count = excluded.reply_count,
    repost_count = excluded.repost_count,
    last_updated = unixepoch()
`);

const getEngagement = db.prepare(`
  SELECT like_count, reply_count, repost_count, last_updated
  FROM estimated_views
  WHERE post_uri = ?
`);

const getEngagementBatch = db.prepare(`
  SELECT post_uri, like_count, reply_count, repost_count
  FROM estimated_views
  WHERE post_uri IN (SELECT value FROM json_each(?))
`);

/**
 * Add a post to the feed
 */
function addPost(uri, cid, authorDid, authorHandle, indexedAt) {
  try {
    insertPost.run(uri, cid, authorDid, authorHandle, indexedAt);
    return true;
  } catch (err) {
    console.error('[DB] Insert error:', err.message);
    return false;
  }
}

/**
 * Remove a post from the feed
 */
function removePost(uri) {
  try {
    deletePost.run(uri);
    return true;
  } catch (err) {
    console.error('[DB] Delete error:', err.message);
    return false;
  }
}

/**
 * Get posts for feed (paginated)
 */
function getPosts(limit = 30, offset = 0) {
  return getFeed.all(limit, offset).map((row) => row.uri);
}

/**
 * Get total post count
 */
function getCount() {
  return getPostCount.get().count;
}

/**
 * Get all posts (for cleanup/migration scripts)
 */
function getAllPosts() {
  return getAllPostsStmt.all();
}

/**
 * Clean posts older than X seconds (default 7 days)
 */
function cleanup(maxAgeSeconds = 7 * 24 * 60 * 60) {
  const result = cleanOldPosts.run(maxAgeSeconds);
  // Also clean expired boosts
  cleanExpiredBoosts.run();
  return result.changes;
}

// =============================================================================
// Boost Functions
// =============================================================================

/**
 * Boost a post for 24 hours
 * @param {string} postUri - The post URI to boost
 * @param {string} authorDid - The author's DID (for verification)
 * @param {number} durationSeconds - Boost duration (default 24 hours)
 */
function boostPost(postUri, authorDid, durationSeconds = 24 * 60 * 60) {
  try {
    insertBoost.run(postUri, authorDid, durationSeconds);
    console.log(`[Boost] Post boosted: ${postUri.substring(0, 50)}... for ${durationSeconds}s`);
    return true;
  } catch (err) {
    console.error('[DB] Boost error:', err.message);
    return false;
  }
}

/**
 * Remove boost from a post
 */
function unboostPost(postUri) {
  try {
    removeBoost.run(postUri);
    return true;
  } catch (err) {
    console.error('[DB] Unboost error:', err.message);
    return false;
  }
}

/**
 * Get all active (non-expired) boosts
 */
function getActiveBoostedPosts() {
  return getActiveBoosts.all();
}

/**
 * Check if a post is currently boosted
 */
function isPostBoosted(postUri) {
  const boost = getBoostByUri.get(postUri);
  return boost ? true : false;
}

/**
 * Get boost info for a post
 */
function getBoostInfo(postUri) {
  return getBoostByUri.get(postUri) || null;
}

/**
 * Get all boosts by a specific author
 */
function getAuthorBoosts(authorDid) {
  return getBoostsByAuthor.all(authorDid);
}

// =============================================================================
// View Tracking Functions
// =============================================================================

/**
 * Record a post view
 * @param {string} postUri - The post URI that was viewed
 * @param {string|null} viewerDid - The viewer's DID (null for anonymous)
 * @param {string} source - Where the view came from (feed, profile, thread, search)
 */
function recordView(postUri, viewerDid = null, source = 'feed') {
  try {
    insertView.run(postUri, viewerDid, source);
    return true;
  } catch (err) {
    console.error('[DB] View record error:', err.message);
    return false;
  }
}

/**
 * Record multiple views at once (batch insert for efficiency)
 * @param {Array<{postUri: string, viewerDid: string|null, source: string}>} views
 */
function recordViewsBatch(views) {
  const insertMany = db.transaction((viewList) => {
    for (const view of viewList) {
      insertViewsBatch.run(view.postUri, view.viewerDid || null, view.source || 'feed');
    }
  });

  try {
    insertMany(views);
    return true;
  } catch (err) {
    console.error('[DB] Batch view error:', err.message);
    return false;
  }
}

/**
 * Get view count for a post
 */
function getPostViewCount(postUri) {
  return getViewCount.get(postUri)?.count || 0;
}

/**
 * Get unique viewer count for a post
 */
function getPostUniqueViewers(postUri) {
  return getUniqueViewers.get(postUri)?.count || 0;
}

/**
 * Get full stats for a post
 */
function getPostViewStats(postUri) {
  return getPostStats.get(postUri) || { total_views: 0, unique_viewers: 0 };
}

/**
 * Get trending posts (most viewed in time period)
 * @param {number} timeWindowSeconds - Time window (default 24 hours)
 * @param {number} limit - Max results
 */
function getTrendingPosts(timeWindowSeconds = 24 * 60 * 60, limit = 20) {
  return getRecentViews.all(timeWindowSeconds, limit);
}

/**
 * Check if viewer has seen this post recently (to avoid duplicate counts)
 * @param {string} postUri
 * @param {string} viewerDid
 * @param {number} windowSeconds - Deduplication window (default 5 minutes)
 */
function hasViewerSeenRecently(postUri, viewerDid, windowSeconds = 300) {
  if (!viewerDid) return false;
  return hasViewedRecently.get(postUri, viewerDid, windowSeconds) ? true : false;
}

/**
 * Get view stats for an author's posts
 */
function getAuthorViewStats(authorDid) {
  return getAuthorViewStatsStmt.get(authorDid) || { total_views: 0, unique_viewers: 0 };
}

/**
 * Clean old view records (default 30 days)
 */
function cleanupViews(maxAgeSeconds = 30 * 24 * 60 * 60) {
  const result = cleanOldViews.run(maxAgeSeconds);
  return result.changes;
}

// =============================================================================
// View Count Functions
// =============================================================================

/**
 * Calculate views from engagement
 * 
 * Multipliers based on typical engagement rates:
 * - 1 like ≈ 50 views (2% engagement)
 * - 1 reply ≈ 250 views (0.4% engagement)
 * - 1 repost ≈ 400 views (0.25% engagement)
 */
function calculateViewsFromEngagement(likeCount, replyCount, repostCount, postUri) {
  const LIKE_MULTIPLIER = 50;
  const REPLY_MULTIPLIER = 250;
  const REPOST_MULTIPLIER = 400;

  const likeViews = likeCount * LIKE_MULTIPLIER;
  const replyViews = replyCount * REPLY_MULTIPLIER;
  const repostViews = repostCount * REPOST_MULTIPLIER;

  const rawViews = likeViews + replyViews + repostViews;

  // Apply slight logarithmic scaling for very high engagement
  let scaledViews;
  if (rawViews <= 500) {
    scaledViews = rawViews;
  } else if (rawViews <= 2000) {
    scaledViews = 500 + Math.round((rawViews - 500) * 0.8);
  } else {
    scaledViews = 1700 + Math.round((rawViews - 2000) * 0.6);
  }

  // Deterministic variance based on post URI hash (±15%)
  let hash = 0;
  for (let i = 0; i < (postUri || '').length; i++) {
    const char = postUri.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  const variance = 0.85 + (hash % 31) / 100; // 0.85 to 1.15

  return Math.round(scaledViews * variance);
}

/**
 * Update engagement data for a post (called when likes/replies/reposts change)
 */
function updateEngagement(postUri, likeCount, replyCount, repostCount) {
  try {
    upsertEngagement.run(postUri, likeCount, replyCount, repostCount);
    return getViews(postUri);
  } catch (err) {
    console.error('[DB] updateEngagement error:', err.message);
    return 0;
  }
}

/**
 * Get view count for a post
 */
function getViews(postUri) {
  const trackedViews = getPostViewCount(postUri);
  const engagement = getEngagement.get(postUri);
  
  let baselineViews = 0;
  if (engagement) {
    baselineViews = calculateViewsFromEngagement(
      engagement.like_count || 0,
      engagement.reply_count || 0,
      engagement.repost_count || 0,
      postUri
    );
  }
  
  return Math.max(trackedViews, baselineViews);
}

/**
 * Get view data for a post (for API response)
 */
function getViewData(postUri) {
  const engagement = getEngagement.get(postUri);
  const views = getViews(postUri);
  
  return {
    views,
    like_count: engagement?.like_count || 0,
    reply_count: engagement?.reply_count || 0,
    repost_count: engagement?.repost_count || 0,
  };
}

/**
 * Get views for multiple posts at once
 */
function getViewsBatch(postUris) {
  if (!postUris || postUris.length === 0) return {};
  
  try {
    const engagementRows = getEngagementBatch.all(JSON.stringify(postUris));
    const engagementMap = {};
    for (const row of engagementRows) {
      engagementMap[row.post_uri] = {
        like_count: row.like_count || 0,
        reply_count: row.reply_count || 0,
        repost_count: row.repost_count || 0,
      };
    }
    
    const result = {};
    for (const postUri of postUris) {
      const trackedViews = getPostViewCount(postUri);
      const engagement = engagementMap[postUri];
      
      let baselineViews = 0;
      if (engagement) {
        baselineViews = calculateViewsFromEngagement(
          engagement.like_count,
          engagement.reply_count,
          engagement.repost_count,
          postUri
        );
      }
      
      result[postUri] = Math.max(trackedViews, baselineViews);
    }
    return result;
  } catch (err) {
    console.error('[DB] getViewsBatch error:', err.message);
    return {};
  }
}

/**
 * Close database connection
 */
function close() {
  db.close();
}

module.exports = {
  addPost,
  removePost,
  getPosts,
  getAllPosts,
  getCount,
  cleanup,
  // Boost functions
  boostPost,
  unboostPost,
  getActiveBoostedPosts,
  isPostBoosted,
  getBoostInfo,
  getAuthorBoosts,
  // View tracking
  recordView,
  recordViewsBatch,
  getPostViewCount,
  getPostUniqueViewers,
  getPostViewStats,
  getTrendingPosts,
  hasViewerSeenRecently,
  getAuthorViewStats,
  cleanupViews,
  // Views API
  updateEngagement,
  getViews,
  getViewData,
  getViewsBatch,
  close,
};
