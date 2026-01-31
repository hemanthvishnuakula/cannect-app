/**
 * SQLite Database for Feed Generator
 *
 * Stores post URIs and content for the feed. Simple and reliable.
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
    text TEXT,
    facets TEXT,
    has_media INTEGER DEFAULT 0,
    embed_type TEXT,
    langs TEXT,
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

  -- User reach table - aggregated reach per user
  CREATE TABLE IF NOT EXISTS user_reach (
    user_did TEXT PRIMARY KEY,
    tracked_views INTEGER DEFAULT 0,
    engagement_views INTEGER DEFAULT 0,
    total_reach INTEGER DEFAULT 0,
    last_updated INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_user_reach ON user_reach(total_reach DESC);
`);

// Prepared statements for performance
const insertPost = db.prepare(`
  INSERT OR REPLACE INTO posts (uri, cid, author_did, author_handle, indexed_at, text, facets, has_media, embed_type, langs)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

// Engagement statements
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

// ========== POST CONTENT FUNCTIONS ==========

// Get post content by URI
const getPostContentStmt = db.prepare(`
  SELECT uri, text, facets, has_media, embed_type, langs, author_did, author_handle, indexed_at
  FROM posts
  WHERE uri = ?
`);

// Get posts with content for ML training
const getPostsWithContentStmt = db.prepare(`
  SELECT uri, text, facets, has_media, embed_type, langs, author_did, indexed_at
  FROM posts
  WHERE text IS NOT NULL AND text != ''
  ORDER BY indexed_at DESC
  LIMIT ? OFFSET ?
`);

// Search posts full-text (if FTS5 table exists, otherwise fallback to LIKE)
let searchPostsStmt;
try {
  searchPostsStmt = db.prepare(`
    SELECT p.uri, p.text, p.author_did, p.author_handle, p.indexed_at, p.has_media
    FROM posts p
    JOIN posts_fts fts ON p.rowid = fts.rowid
    WHERE posts_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);
} catch (err) {
  // FTS5 not available, use LIKE fallback
  searchPostsStmt = db.prepare(`
    SELECT uri, text, author_did, author_handle, indexed_at, has_media
    FROM posts
    WHERE text LIKE '%' || ? || '%'
    ORDER BY indexed_at DESC
    LIMIT ?
  `);
}

// Content statistics
const getContentStatsStmt = db.prepare(`
  SELECT 
    COUNT(*) as total_posts,
    COUNT(CASE WHEN text IS NOT NULL AND text != '' THEN 1 END) as posts_with_text,
    SUM(has_media) as posts_with_media
  FROM posts
`);

/**
 * Add a post to the feed with optional content
 * @param {string} uri - Post URI
 * @param {string} cid - Content ID
 * @param {string} authorDid - Author DID
 * @param {string} authorHandle - Author handle
 * @param {string} indexedAt - ISO timestamp
 * @param {object} content - Optional content {text, facets, hasMedia, embedType, langs}
 */
function addPost(uri, cid, authorDid, authorHandle, indexedAt, content = {}) {
  try {
    const text = content.text || null;
    const facets = content.facets ? JSON.stringify(content.facets) : null;
    const hasMedia = content.hasMedia ? 1 : 0;
    const embedType = content.embedType || null;
    const langs = content.langs ? JSON.stringify(content.langs) : null;

    insertPost.run(
      uri,
      cid,
      authorDid,
      authorHandle,
      indexedAt,
      text,
      facets,
      hasMedia,
      embedType,
      langs
    );
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
 * Get post content by URI
 */
function getPostContent(uri) {
  const row = getPostContentStmt.get(uri);
  if (!row) return null;
  return {
    ...row,
    facets: row.facets ? JSON.parse(row.facets) : null,
    langs: row.langs ? JSON.parse(row.langs) : null,
    has_media: row.has_media === 1,
  };
}

/**
 * Get posts with content for ML training/analysis
 */
function getPostsWithContent(limit = 1000, offset = 0) {
  return getPostsWithContentStmt.all(limit, offset).map((row) => ({
    ...row,
    facets: row.facets ? JSON.parse(row.facets) : null,
    langs: row.langs ? JSON.parse(row.langs) : null,
    has_media: row.has_media === 1,
  }));
}

/**
 * Search posts by text content
 */
function searchPosts(query, limit = 50) {
  try {
    return searchPostsStmt.all(query, limit);
  } catch (err) {
    console.error('[DB] Search error:', err.message);
    return [];
  }
}

/**
 * Get content statistics
 */
function getContentStats() {
  return getContentStatsStmt.get();
}

/**
 * Clean posts older than X seconds (default 7 days)
 */
function cleanup(maxAgeSeconds = 7 * 24 * 60 * 60) {
  const result = cleanOldPosts.run(maxAgeSeconds);
  cleanExpiredBoosts.run();
  return result.changes;
}

// ========== BOOST FUNCTIONS ==========

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

function unboostPost(postUri) {
  try {
    removeBoost.run(postUri);
    return true;
  } catch (err) {
    console.error('[DB] Unboost error:', err.message);
    return false;
  }
}

function getActiveBoostedPosts() {
  return getActiveBoosts.all();
}

function isPostBoosted(postUri) {
  return getBoostByUri.get(postUri) ? true : false;
}

function getBoostInfo(postUri) {
  return getBoostByUri.get(postUri) || null;
}

function getAuthorBoosts(authorDid) {
  return getBoostsByAuthor.all(authorDid);
}

// ========== VIEW TRACKING FUNCTIONS ==========

function recordView(postUri, viewerDid = null, source = 'feed') {
  try {
    insertView.run(postUri, viewerDid, source);
    return true;
  } catch (err) {
    console.error('[DB] View record error:', err.message);
    return false;
  }
}

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

function getPostViewCount(postUri) {
  return getViewCount.get(postUri)?.count || 0;
}

function getPostUniqueViewers(postUri) {
  return getUniqueViewers.get(postUri)?.count || 0;
}

function getPostViewStats(postUri) {
  return getPostStats.get(postUri) || { total_views: 0, unique_viewers: 0 };
}

function getTrendingPosts(timeWindowSeconds = 24 * 60 * 60, limit = 20) {
  return getRecentViews.all(timeWindowSeconds, limit);
}

function hasViewerSeenRecently(postUri, viewerDid, windowSeconds = 60) {
  if (!viewerDid) return false;
  return hasViewedRecently.get(postUri, viewerDid, windowSeconds) ? true : false;
}

function getAuthorViewStats(authorDid) {
  return getAuthorViewStatsStmt.get(authorDid) || { total_views: 0, unique_viewers: 0 };
}

function cleanupViews(maxAgeSeconds = 30 * 24 * 60 * 60) {
  const result = cleanOldViews.run(maxAgeSeconds);
  return result.changes;
}

// ========== VIEW COUNT FUNCTIONS ==========

function calculateViewsFromEngagement(likeCount, replyCount, repostCount, postUri) {
  const LIKE_MULTIPLIER = 50;
  const REPLY_MULTIPLIER = 250;
  const REPOST_MULTIPLIER = 400;

  const rawViews =
    likeCount * LIKE_MULTIPLIER + replyCount * REPLY_MULTIPLIER + repostCount * REPOST_MULTIPLIER;

  // Deterministic variance based on post URI hash (±15%)
  let hash = 0;
  for (let i = 0; i < (postUri || '').length; i++) {
    const char = postUri.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  const variance = 0.85 + (hash % 31) / 100;

  return Math.round(rawViews * variance);
}

function updateEngagement(postUri, likeCount, replyCount, repostCount) {
  try {
    upsertEngagement.run(postUri, likeCount, replyCount, repostCount);
    return getViews(postUri);
  } catch (err) {
    console.error('[DB] updateEngagement error:', err.message);
    return 0;
  }
}

function getViews(postUri) {
  const trackedViews = getPostViewCount(postUri);
  const engagement = getEngagement.get(postUri);

  let engagementViews = 0;
  if (engagement) {
    engagementViews = calculateViewsFromEngagement(
      engagement.like_count || 0,
      engagement.reply_count || 0,
      engagement.repost_count || 0,
      postUri
    );
  }

  return trackedViews + engagementViews;
}

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

      let engagementViews = 0;
      if (engagement) {
        engagementViews = calculateViewsFromEngagement(
          engagement.like_count,
          engagement.reply_count,
          engagement.repost_count,
          postUri
        );
      }

      result[postUri] = trackedViews + engagementViews;
    }
    return result;
  } catch (err) {
    console.error('[DB] getViewsBatch error:', err.message);
    return {};
  }
}

// ========== USER REACH FUNCTIONS ==========

const upsertUserReach = db.prepare(`
  INSERT INTO user_reach (user_did, tracked_views, engagement_views, total_reach, last_updated)
  VALUES (?, ?, ?, ?, unixepoch())
  ON CONFLICT(user_did) DO UPDATE SET
    tracked_views = excluded.tracked_views,
    engagement_views = excluded.engagement_views,
    total_reach = excluded.total_reach,
    last_updated = unixepoch()
`);

const getUserReachStmt = db.prepare(`
  SELECT tracked_views, engagement_views, total_reach, last_updated
  FROM user_reach
  WHERE user_did = ?
`);

function getUserReach(userDid) {
  const row = getUserReachStmt.get(userDid);
  return row ? row.total_reach : 0;
}

function getUserReachData(userDid) {
  const row = getUserReachStmt.get(userDid);
  return row || { tracked_views: 0, engagement_views: 0, total_reach: 0, last_updated: 0 };
}

function updateUserReach(userDid) {
  try {
    const userPosts = db.prepare(`SELECT uri FROM posts WHERE author_did = ?`).all(userDid);

    if (userPosts.length === 0) {
      upsertUserReach.run(userDid, 0, 0, 0);
      return 0;
    }

    let totalTrackedViews = 0;
    let totalEngagementViews = 0;

    for (const post of userPosts) {
      const trackedViews = getPostViewCount(post.uri);
      totalTrackedViews += trackedViews;

      const engagement = getEngagement.get(post.uri);
      if (engagement) {
        const engViews = calculateViewsFromEngagement(
          engagement.like_count || 0,
          engagement.reply_count || 0,
          engagement.repost_count || 0,
          post.uri
        );
        totalEngagementViews += engViews;
      }
    }

    const totalReach = totalTrackedViews + totalEngagementViews;
    upsertUserReach.run(userDid, totalTrackedViews, totalEngagementViews, totalReach);

    return totalReach;
  } catch (err) {
    console.error('[DB] updateUserReach error:', err.message);
    return 0;
  }
}

function incrementUserTrackedViews(userDid, count = 1) {
  try {
    db.prepare(
      `
      INSERT INTO user_reach (user_did, tracked_views, engagement_views, total_reach, last_updated)
      VALUES (?, ?, 0, ?, unixepoch())
      ON CONFLICT(user_did) DO UPDATE SET
        tracked_views = tracked_views + ?,
        total_reach = total_reach + ?,
        last_updated = unixepoch()
    `
    ).run(userDid, count, count, count, count);
    return true;
  } catch (err) {
    console.error('[DB] incrementUserTrackedViews error:', err.message);
    return false;
  }
}

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
  // Post content
  getPostContent,
  getPostsWithContent,
  searchPosts,
  getContentStats,
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
  // User Reach
  getUserReach,
  getUserReachData,
  updateUserReach,
  incrementUserTrackedViews,
  close,
};
