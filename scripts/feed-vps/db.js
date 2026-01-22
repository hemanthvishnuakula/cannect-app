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
  close,
};