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

  -- Estimated views table (calculated from engagement, consistent across users)
  CREATE TABLE IF NOT EXISTS estimated_views (
    post_uri TEXT PRIMARY KEY,
    like_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    estimated_views INTEGER DEFAULT 0,
    last_updated INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_estimated_views ON estimated_views(estimated_views DESC);
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

// Estimated views prepared statements
const upsertEstimatedViews = db.prepare(`
  INSERT INTO estimated_views (post_uri, like_count, reply_count, repost_count, estimated_views, last_updated)
  VALUES (?, ?, ?, ?, ?, unixepoch())
  ON CONFLICT(post_uri) DO UPDATE SET
    like_count = excluded.like_count,
    reply_count = excluded.reply_count,
    repost_count = excluded.repost_count,
    estimated_views = excluded.estimated_views,
    last_updated = unixepoch()
`);

const getEstimatedViews = db.prepare(`
  SELECT estimated_views, like_count, reply_count, repost_count, last_updated
  FROM estimated_views
  WHERE post_uri = ?
`);

const getEstimatedViewsBatch = db.prepare(`
  SELECT post_uri, estimated_views
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
// Estimated Views Functions (Engagement-based, consistent across users)
// =============================================================================

/**
 * Calculate estimated views based on engagement metrics
 * 
 * Strategy: More natural, gradual view counts
 * - Lower engagement multipliers (realistic ~3-5% engagement rate)
 * - Base views for any post with engagement (people scrolled past it)
 * - Logarithmic scaling to prevent huge jumps from single engagements
 * 
 * New multipliers:
 * - 1 like ≈ 3-5 views (was 30) - ~20-30% like rate is normal
 * - 1 reply ≈ 10-15 views (was 100) - replies are rarer
 * - 1 repost ≈ 15-20 views (was 200) - reposts indicate high value
 */
function calculateEstimatedViewCount(likeCount, replyCount, repostCount, postUri) {
  // Much lower, more realistic multipliers
  const LIKE_MULTIPLIER = 4;
  const COMMENT_MULTIPLIER = 12;
  const REPOST_MULTIPLIER = 18;
  
  // Base views - if there's ANY engagement, post was seen by at least a few people
  const BASE_VIEWS = (likeCount > 0 || replyCount > 0 || repostCount > 0) ? 3 : 0;

  // Calculate raw engagement views
  const likeViews = likeCount * LIKE_MULTIPLIER;
  const commentViews = replyCount * COMMENT_MULTIPLIER;
  const repostViews = repostCount * REPOST_MULTIPLIER;
  
  const rawEngagementViews = likeViews + commentViews + repostViews;
  
  // Apply logarithmic scaling for high engagement to prevent unrealistic numbers
  // This means first engagements count more, diminishing returns after
  let scaledViews;
  if (rawEngagementViews <= 20) {
    scaledViews = rawEngagementViews; // Linear for low engagement
  } else if (rawEngagementViews <= 100) {
    // Slight reduction: 20 + 80% of overflow
    scaledViews = 20 + Math.round((rawEngagementViews - 20) * 0.8);
  } else {
    // More reduction for high engagement
    scaledViews = 84 + Math.round((rawEngagementViews - 100) * 0.5);
  }

  const baseViews = BASE_VIEWS + scaledViews;

  // Deterministic variance based on post URI hash (±10%)
  let hash = 0;
  for (let i = 0; i < (postUri || '').length; i++) {
    const char = postUri.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  const variance = 0.9 + (hash % 21) / 100; // 0.90 to 1.10

  if (likeCount === 0 && replyCount === 0 && repostCount === 0) {
    return 0;
  }

  return Math.max(1, Math.round(baseViews * variance));
}

/**
 * Store or update estimated views for a post
 * Combines engagement-based estimate with actual tracked viewport views
 */
function setEstimatedViews(postUri, likeCount, replyCount, repostCount) {
  // Get actual tracked viewport views
  const actualViews = getPostViewCount(postUri);

  // Calculate engagement-based estimate
  const engagementEstimate = calculateEstimatedViewCount(
    likeCount,
    replyCount,
    repostCount,
    postUri
  );

  // Combine: use higher of actual vs engagement, then add any overflow
  // This ensures actual views always count, plus engagement estimate for reach
  // Formula: max(actual, engagement) + min(actual, engagement) * 0.2
  // This gives weight to both metrics without double counting
  const combined =
    Math.max(actualViews, engagementEstimate) +
    Math.round(Math.min(actualViews, engagementEstimate) * 0.2);

  // Ensure at least actual views are shown
  const finalViews = Math.max(actualViews, combined);

  try {
    upsertEstimatedViews.run(postUri, likeCount, replyCount, repostCount, finalViews);
    return finalViews;
  } catch (err) {
    console.error('[DB] setEstimatedViews error:', err.message);
    return finalViews;
  }
}

/**
 * Get stored estimated views for a post
 * Returns null if not stored (caller should calculate and store)
 */
function getStoredEstimatedViews(postUri) {
  const row = getEstimatedViews.get(postUri);
  return row || null;
}

/**
 * Get estimated views for multiple posts at once
 */
function getEstimatedViewsBatchFn(postUris) {
  if (!postUris || postUris.length === 0) return {};
  try {
    const rows = getEstimatedViewsBatch.all(JSON.stringify(postUris));
    const result = {};
    for (const row of rows) {
      result[row.post_uri] = row.estimated_views;
    }
    return result;
  } catch (err) {
    console.error('[DB] getEstimatedViewsBatch error:', err.message);
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
  // View tracking functions
  recordView,
  recordViewsBatch,
  getPostViewCount,
  getPostUniqueViewers,
  getPostViewStats,
  getTrendingPosts,
  hasViewerSeenRecently,
  getAuthorViewStats,
  cleanupViews,
  // Estimated views functions
  calculateEstimatedViewCount,
  setEstimatedViews,
  getStoredEstimatedViews,
  getEstimatedViewsBatch: getEstimatedViewsBatchFn,
  close,
};
