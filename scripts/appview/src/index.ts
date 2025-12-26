import express from 'express'
import cors from 'cors'
import { createDb, AppViewDb, DbPost, DbProfile } from './db.js'
import { config } from './config.js'
import { Ingester } from './ingester.js'
import { backfillFromPds } from './backfill.js'

const app = express()
app.use(cors())
app.use(express.json())

let db: AppViewDb
let ingester: Ingester

// Types for API responses
interface PostView {
  uri: string
  cid: string
  author: {
    did: string
    handle: string
    displayName?: string
    avatar?: string
  }
  record: {
    $type: string
    text: string
    createdAt: string
    reply?: {
      parent: { uri: string }
      root: { uri: string }
    }
    embed?: unknown
    facets?: unknown[]
    langs?: string[]
  }
  replyCount: number
  repostCount: number
  likeCount: number
  indexedAt: string
}

interface FeedViewPost {
  post: PostView
  reply?: {
    root: PostView
    parent: PostView
  }
  reason?: {
    $type: string
    by: { did: string; handle: string }
    indexedAt: string
  }
}

// Helper: Convert DB post to PostView
function toPostView(post: DbPost & Partial<DbProfile>, counts: { likes: number; reposts: number; replies: number }): PostView {
  // Avatar could be a full URL (from Bluesky CDN) or a CID
  let avatarUrl: string | undefined
  if (post.avatar_cid) {
    if (post.avatar_cid.startsWith('http')) {
      avatarUrl = post.avatar_cid
    } else {
      avatarUrl = `${config.cannectPds}/xrpc/com.atproto.sync.getBlob?did=${post.author_did}&cid=${post.avatar_cid}`
    }
  }

  return {
    uri: post.uri,
    cid: post.cid,
    author: {
      did: post.author_did,
      handle: post.handle || post.author_did,
      displayName: post.display_name || undefined,
      avatar: avatarUrl,
    },
    record: {
      $type: 'app.bsky.feed.post',
      text: post.text || '',
      createdAt: post.created_at,
      reply: post.reply_parent ? {
        parent: { uri: post.reply_parent },
        root: { uri: post.reply_root || post.reply_parent },
      } : undefined,
      embed: post.embed_data ? JSON.parse(post.embed_data) : undefined,
      facets: post.facets ? JSON.parse(post.facets) : undefined,
      langs: post.langs ? JSON.parse(post.langs) : undefined,
    },
    replyCount: counts.replies,
    repostCount: counts.reposts,
    likeCount: counts.likes,
    indexedAt: post.indexed_at,
  }
}

// Get engagement counts for a post
function getPostCounts(db: AppViewDb, uri: string): { likes: number; reposts: number; replies: number } {
  const likes = (db.prepare('SELECT COUNT(*) as count FROM likes WHERE subject_uri = ?').get(uri) as { count: number }).count
  const reposts = (db.prepare('SELECT COUNT(*) as count FROM reposts WHERE subject_uri = ?').get(uri) as { count: number }).count
  const replies = (db.prepare('SELECT COUNT(*) as count FROM posts WHERE reply_parent = ?').get(uri) as { count: number }).count
  return { likes, reposts, replies }
}

// ========================================
// API ENDPOINTS
// ========================================

// Health check
app.get('/xrpc/_health', (req, res) => {
  const stats = {
    profiles: (db.prepare('SELECT COUNT(*) as count FROM profiles').get() as { count: number }).count,
    posts: (db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number }).count,
  }
  res.json({ version: '1.0.0', status: 'ok', ...stats })
})

// ----------------------------------------
// TIMELINE (Following feed) - THE KEY ONE!
// ----------------------------------------
app.get('/xrpc/app.bsky.feed.getTimeline', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const cursor = req.query.cursor as string | undefined

    // Get viewer DID from custom header or auth header
    let viewerDid: string | null = null
    
    // Option 1: Custom header (preferred - simple and direct)
    const viewerHeader = req.headers['x-viewer-did'] as string | undefined
    if (viewerHeader?.startsWith('did:')) {
      viewerDid = viewerHeader
    }
    
    // Option 2: Bearer token as DID (fallback for testing)
    if (!viewerDid) {
      const authHeader = req.headers.authorization
      if (authHeader?.startsWith('Bearer ') && authHeader.slice(7).startsWith('did:')) {
        viewerDid = authHeader.slice(7)
      }
    }

    if (!viewerDid) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' })
    }

    console.log('[Timeline] Fetching for viewer:', viewerDid)

    // Parse cursor (format: timestamp:uri)
    let cursorTimestamp = new Date().toISOString()
    if (cursor) {
      const [ts] = cursor.split(':')
      cursorTimestamp = ts
    }

    // Get posts from users the viewer follows + their own posts
    const posts = db.prepare(`
      SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
      FROM posts p
      LEFT JOIN profiles pr ON pr.did = p.author_did
      WHERE (
        p.author_did IN (SELECT subject_did FROM follows WHERE author_did = ?)
        OR p.author_did = ?
      )
        AND p.created_at < ?
        AND p.reply_parent IS NULL  -- Top-level posts only
      ORDER BY p.created_at DESC
      LIMIT ?
    `).all(viewerDid, viewerDid, cursorTimestamp, limit) as (DbPost & Partial<DbProfile>)[]

    const feed: FeedViewPost[] = posts.map(post => ({
      post: toPostView(post, getPostCounts(db, post.uri)),
    }))

    const nextCursor = posts.length === limit
      ? `${posts[posts.length - 1].created_at}:${posts[posts.length - 1].uri}`
      : undefined

    res.json({ cursor: nextCursor, feed })
  } catch (err) {
    console.error('[API] getTimeline error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// AUTHOR FEED (User's posts)
// ----------------------------------------
app.get('/xrpc/app.bsky.feed.getAuthorFeed', (req, res) => {
  try {
    const actor = req.query.actor as string
    if (!actor) {
      return res.status(400).json({ error: 'BadRequest', message: 'actor is required' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const cursor = req.query.cursor as string | undefined
    const filter = req.query.filter as string || 'posts_with_replies'

    // Resolve actor to DID
    let did = actor
    if (!actor.startsWith('did:')) {
      const profile = db.prepare('SELECT did FROM profiles WHERE handle = ?').get(actor) as { did: string } | undefined
      if (!profile) {
        return res.status(404).json({ error: 'NotFound', message: 'Actor not found' })
      }
      did = profile.did
    }

    // Parse cursor
    let cursorTimestamp = new Date().toISOString()
    if (cursor) {
      const [ts] = cursor.split(':')
      cursorTimestamp = ts
    }

    // Build query based on filter
    let whereClause = 'WHERE p.author_did = ? AND p.created_at < ?'
    if (filter === 'posts_no_replies') {
      whereClause += ' AND p.reply_parent IS NULL'
    } else if (filter === 'posts_with_media') {
      whereClause += ' AND p.embed_type IS NOT NULL'
    }

    const posts = db.prepare(`
      SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
      FROM posts p
      LEFT JOIN profiles pr ON pr.did = p.author_did
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ?
    `).all(did, cursorTimestamp, limit) as (DbPost & Partial<DbProfile>)[]

    const feed: FeedViewPost[] = posts.map(post => ({
      post: toPostView(post, getPostCounts(db, post.uri)),
    }))

    const nextCursor = posts.length === limit
      ? `${posts[posts.length - 1].created_at}:${posts[posts.length - 1].uri}`
      : undefined

    res.json({ cursor: nextCursor, feed })
  } catch (err) {
    console.error('[API] getAuthorFeed error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// GET POSTS (Hydrate by URIs - for feed generators!)
// ----------------------------------------
app.get('/xrpc/app.bsky.feed.getPosts', (req, res) => {
  try {
    let uris = req.query.uris
    if (!uris) {
      return res.status(400).json({ error: 'BadRequest', message: 'uris is required' })
    }

    // Handle both single string and array
    if (typeof uris === 'string') {
      uris = [uris]
    }

    if (!Array.isArray(uris) || uris.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'uris must be a non-empty array' })
    }

    // Limit to 25 URIs
    const limitedUris = (uris as string[]).slice(0, 25)

    const placeholders = limitedUris.map(() => '?').join(',')
    const posts = db.prepare(`
      SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
      FROM posts p
      LEFT JOIN profiles pr ON pr.did = p.author_did
      WHERE p.uri IN (${placeholders})
    `).all(...limitedUris) as (DbPost & Partial<DbProfile>)[]

    // Create a map for ordering
    const postMap = new Map(posts.map(p => [p.uri, p]))

    // Return in requested order
    const orderedPosts = limitedUris
      .map(uri => postMap.get(uri))
      .filter((p): p is DbPost & Partial<DbProfile> => p !== undefined)
      .map(post => toPostView(post, getPostCounts(db, post.uri)))

    res.json({ posts: orderedPosts })
  } catch (err) {
    console.error('[API] getPosts error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// GET POST THREAD
// ----------------------------------------
app.get('/xrpc/app.bsky.feed.getPostThread', (req, res) => {
  try {
    const uri = req.query.uri as string
    if (!uri) {
      return res.status(400).json({ error: 'BadRequest', message: 'uri is required' })
    }

    const depth = Math.min(parseInt(req.query.depth as string) || 6, 10)

    // Get the main post
    const post = db.prepare(`
      SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
      FROM posts p
      LEFT JOIN profiles pr ON pr.did = p.author_did
      WHERE p.uri = ?
    `).get(uri) as (DbPost & Partial<DbProfile>) | undefined

    if (!post) {
      return res.status(404).json({ error: 'NotFound', message: 'Post not found' })
    }

    const postView = toPostView(post, getPostCounts(db, post.uri))

    // Get replies
    const replies = db.prepare(`
      SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
      FROM posts p
      LEFT JOIN profiles pr ON pr.did = p.author_did
      WHERE p.reply_parent = ?
      ORDER BY p.created_at ASC
      LIMIT 50
    `).all(uri) as (DbPost & Partial<DbProfile>)[]

    const replyViews = replies.map(r => ({
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: toPostView(r, getPostCounts(db, r.uri)),
      replies: [],
    }))

    // Get parent chain
    let parent: unknown = undefined
    if (post.reply_parent) {
      const parentPost = db.prepare(`
        SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
        FROM posts p
        LEFT JOIN profiles pr ON pr.did = p.author_did
        WHERE p.uri = ?
      `).get(post.reply_parent) as (DbPost & Partial<DbProfile>) | undefined

      if (parentPost) {
        parent = {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: toPostView(parentPost, getPostCounts(db, parentPost.uri)),
        }
      }
    }

    res.json({
      thread: {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: postView,
        parent,
        replies: replyViews,
      },
    })
  } catch (err) {
    console.error('[API] getPostThread error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// GET PROFILE
// ----------------------------------------
app.get('/xrpc/app.bsky.actor.getProfile', (req, res) => {
  try {
    const actor = req.query.actor as string
    if (!actor) {
      return res.status(400).json({ error: 'BadRequest', message: 'actor is required' })
    }

    let profile: DbProfile | undefined

    if (actor.startsWith('did:')) {
      profile = db.prepare('SELECT * FROM profiles WHERE did = ?').get(actor) as DbProfile | undefined
    } else {
      profile = db.prepare('SELECT * FROM profiles WHERE handle = ?').get(actor) as DbProfile | undefined
    }

    if (!profile) {
      return res.status(404).json({ error: 'NotFound', message: 'Profile not found' })
    }

    res.json({
      did: profile.did,
      handle: profile.handle,
      displayName: profile.display_name,
      description: profile.description,
      avatar: profile.avatar_cid ? `${config.cannectPds}/xrpc/com.atproto.sync.getBlob?did=${profile.did}&cid=${profile.avatar_cid}` : undefined,
      banner: profile.banner_cid ? `${config.cannectPds}/xrpc/com.atproto.sync.getBlob?did=${profile.did}&cid=${profile.banner_cid}` : undefined,
      followersCount: profile.followers_count,
      followsCount: profile.follows_count,
      postsCount: profile.posts_count,
      indexedAt: profile.indexed_at,
    })
  } catch (err) {
    console.error('[API] getProfile error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// GET PROFILES (batch)
// ----------------------------------------
app.get('/xrpc/app.bsky.actor.getProfiles', (req, res) => {
  try {
    let actors = req.query.actors
    if (!actors) {
      return res.status(400).json({ error: 'BadRequest', message: 'actors is required' })
    }

    if (typeof actors === 'string') {
      actors = [actors]
    }

    if (!Array.isArray(actors) || actors.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: 'actors must be a non-empty array' })
    }

    const limitedActors = (actors as string[]).slice(0, 25)
    const profiles: DbProfile[] = []

    for (const actor of limitedActors) {
      let profile: DbProfile | undefined
      if (actor.startsWith('did:')) {
        profile = db.prepare('SELECT * FROM profiles WHERE did = ?').get(actor) as DbProfile | undefined
      } else {
        profile = db.prepare('SELECT * FROM profiles WHERE handle = ?').get(actor) as DbProfile | undefined
      }
      if (profile) {
        profiles.push(profile)
      }
    }

    res.json({
      profiles: profiles.map(profile => ({
        did: profile.did,
        handle: profile.handle,
        displayName: profile.display_name,
        description: profile.description,
        avatar: profile.avatar_cid ? `${config.cannectPds}/xrpc/com.atproto.sync.getBlob?did=${profile.did}&cid=${profile.avatar_cid}` : undefined,
        followersCount: profile.followers_count,
        followsCount: profile.follows_count,
        postsCount: profile.posts_count,
      })),
    })
  } catch (err) {
    console.error('[API] getProfiles error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// SEARCH POSTS
// ----------------------------------------
app.get('/xrpc/app.bsky.feed.searchPosts', (req, res) => {
  try {
    const q = req.query.q as string
    if (!q) {
      return res.status(400).json({ error: 'BadRequest', message: 'q is required' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100)
    const cursor = req.query.cursor as string | undefined

    let cursorTimestamp = new Date().toISOString()
    if (cursor) {
      const [ts] = cursor.split(':')
      cursorTimestamp = ts
    }

    // Simple text search (for better performance, consider FTS5)
    const searchTerm = `%${q}%`
    const posts = db.prepare(`
      SELECT p.*, pr.handle, pr.display_name, pr.avatar_cid
      FROM posts p
      LEFT JOIN profiles pr ON pr.did = p.author_did
      WHERE p.text LIKE ?
        AND p.created_at < ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `).all(searchTerm, cursorTimestamp, limit) as (DbPost & Partial<DbProfile>)[]

    const postViews = posts.map(post => toPostView(post, getPostCounts(db, post.uri)))

    const nextCursor = posts.length === limit
      ? `${posts[posts.length - 1].created_at}:${posts[posts.length - 1].uri}`
      : undefined

    res.json({
      cursor: nextCursor,
      hitsTotal: posts.length,
      posts: postViews,
    })
  } catch (err) {
    console.error('[API] searchPosts error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// GET FOLLOWS
// ----------------------------------------
app.get('/xrpc/app.bsky.graph.getFollows', (req, res) => {
  try {
    const actor = req.query.actor as string
    if (!actor) {
      return res.status(400).json({ error: 'BadRequest', message: 'actor is required' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const cursor = req.query.cursor as string | undefined

    // Resolve actor to DID
    let did = actor
    if (!actor.startsWith('did:')) {
      const profile = db.prepare('SELECT did FROM profiles WHERE handle = ?').get(actor) as { did: string } | undefined
      if (!profile) {
        return res.status(404).json({ error: 'NotFound', message: 'Actor not found' })
      }
      did = profile.did
    }

    let cursorTimestamp = new Date().toISOString()
    if (cursor) {
      const [ts] = cursor.split(':')
      cursorTimestamp = ts
    }

    const follows = db.prepare(`
      SELECT f.*, pr.handle, pr.display_name, pr.description, pr.avatar_cid
      FROM follows f
      LEFT JOIN profiles pr ON pr.did = f.subject_did
      WHERE f.author_did = ?
        AND f.created_at < ?
      ORDER BY f.created_at DESC
      LIMIT ?
    `).all(did, cursorTimestamp, limit) as Array<{
      uri: string
      subject_did: string
      created_at: string
      handle: string | null
      display_name: string | null
      description: string | null
      avatar_cid: string | null
    }>

    const followViews = follows.map(f => ({
      did: f.subject_did,
      handle: f.handle || f.subject_did,
      displayName: f.display_name,
      description: f.description,
      avatar: f.avatar_cid ? `${config.cannectPds}/xrpc/com.atproto.sync.getBlob?did=${f.subject_did}&cid=${f.avatar_cid}` : undefined,
    }))

    const nextCursor = follows.length === limit
      ? `${follows[follows.length - 1].created_at}:${follows[follows.length - 1].uri}`
      : undefined

    res.json({
      cursor: nextCursor,
      follows: followViews,
    })
  } catch (err) {
    console.error('[API] getFollows error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ----------------------------------------
// GET FOLLOWERS
// ----------------------------------------
app.get('/xrpc/app.bsky.graph.getFollowers', (req, res) => {
  try {
    const actor = req.query.actor as string
    if (!actor) {
      return res.status(400).json({ error: 'BadRequest', message: 'actor is required' })
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const cursor = req.query.cursor as string | undefined

    // Resolve actor to DID
    let did = actor
    if (!actor.startsWith('did:')) {
      const profile = db.prepare('SELECT did FROM profiles WHERE handle = ?').get(actor) as { did: string } | undefined
      if (!profile) {
        return res.status(404).json({ error: 'NotFound', message: 'Actor not found' })
      }
      did = profile.did
    }

    let cursorTimestamp = new Date().toISOString()
    if (cursor) {
      const [ts] = cursor.split(':')
      cursorTimestamp = ts
    }

    const followers = db.prepare(`
      SELECT f.*, pr.handle, pr.display_name, pr.description, pr.avatar_cid
      FROM follows f
      LEFT JOIN profiles pr ON pr.did = f.author_did
      WHERE f.subject_did = ?
        AND f.created_at < ?
      ORDER BY f.created_at DESC
      LIMIT ?
    `).all(did, cursorTimestamp, limit) as Array<{
      uri: string
      author_did: string
      created_at: string
      handle: string | null
      display_name: string | null
      description: string | null
      avatar_cid: string | null
    }>

    const followerViews = followers.map(f => ({
      did: f.author_did,
      handle: f.handle || f.author_did,
      displayName: f.display_name,
      description: f.description,
      avatar: f.avatar_cid ? `${config.cannectPds}/xrpc/com.atproto.sync.getBlob?did=${f.author_did}&cid=${f.avatar_cid}` : undefined,
    }))

    const nextCursor = followers.length === limit
      ? `${followers[followers.length - 1].created_at}:${followers[followers.length - 1].uri}`
      : undefined

    res.json({
      cursor: nextCursor,
      followers: followerViews,
    })
  } catch (err) {
    console.error('[API] getFollowers error:', err)
    res.status(500).json({ error: 'InternalServerError' })
  }
})

// ========================================
// STARTUP
// ========================================
async function main() {
  console.log('[AppView] Starting Cannect AppView...')

  // Initialize database
  db = createDb()
  console.log('[AppView] Database initialized')

  // Check if we need initial backfill
  const postCount = (db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number }).count
  if (postCount === 0) {
    console.log('[AppView] Empty database, running initial backfill...')
    await backfillFromPds(db)
  }

  // Start ingester for real-time updates
  ingester = new Ingester(db)
  ingester.start()
  console.log('[AppView] Ingester started')

  // Start API server
  app.listen(config.port, () => {
    console.log(`[AppView] API server running on port ${config.port}`)
    console.log(`[AppView] Health: http://localhost:${config.port}/xrpc/_health`)
  })
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[AppView] Shutting down...')
  if (ingester) ingester.stop()
  process.exit(0)
})

main().catch(err => {
  console.error('[AppView] Fatal error:', err)
  process.exit(1)
})
