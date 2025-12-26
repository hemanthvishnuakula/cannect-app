import { QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

// max 15 chars
export const shortname = 'following'

const BSKY_API = 'https://public.api.bsky.app'
const CANNECT_PDS = 'https://cannect.space'

// Cache for Cannect user DIDs (refreshed every 5 minutes)
let cannectDidsCache: { dids: Set<string>; expires: number } = { dids: new Set(), expires: 0 }

// Cache for user following list (expires after 5 minutes)
const followingCache = new Map<string, { dids: Set<string>; expires: number }>()

// Extract DID from AT URI: at://did:plc:xxx/app.bsky.feed.post/rkey
function getAuthorFromUri(uri: string): string {
  const match = uri.match(/^at:\/\/(did:[^/]+)\//)
  return match ? match[1] : ''
}

// Get all Cannect.space user DIDs
async function getCannectDids(): Promise<Set<string>> {
  if (cannectDidsCache.expires > Date.now()) {
    return cannectDidsCache.dids
  }

  const dids = new Set<string>()
  let cursor: string | undefined

  try {
    do {
      const url = cursor
        ? `${CANNECT_PDS}/xrpc/com.atproto.sync.listRepos?limit=1000&cursor=${cursor}`
        : `${CANNECT_PDS}/xrpc/com.atproto.sync.listRepos?limit=1000`

      const response = await fetch(url)
      if (!response.ok) break

      const data = await response.json() as { repos: { did: string }[]; cursor?: string }
      for (const repo of data.repos) {
        dids.add(repo.did)
      }
      cursor = data.cursor
    } while (cursor)

    cannectDidsCache = { dids, expires: Date.now() + 5 * 60 * 1000 }
    console.log(`[Following] Refreshed Cannect DIDs: ${dids.size} users`)
  } catch (error) {
    console.error('[Following] Failed to fetch Cannect DIDs:', error)
  }

  return dids
}

// Get viewer's following list
async function getFollowingDids(viewerDid: string): Promise<Set<string>> {
  const cached = followingCache.get(viewerDid)
  if (cached && cached.expires > Date.now()) {
    return cached.dids
  }

  const followingDids = new Set<string>()
  let cursor: string | undefined

  try {
    do {
      const params = new URLSearchParams({ actor: viewerDid, limit: '100' })
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`${BSKY_API}/xrpc/app.bsky.graph.getFollows?${params}`)
      if (!response.ok) break

      const data = await response.json() as { follows: { did: string }[]; cursor?: string }
      for (const follow of data.follows) {
        followingDids.add(follow.did)
      }
      cursor = data.cursor
    } while (cursor)

    followingCache.set(viewerDid, { dids: followingDids, expires: Date.now() + 5 * 60 * 1000 })
    console.log(`[Following] Loaded ${followingDids.size} follows for viewer`)
  } catch (error) {
    console.error('[Following] Failed to fetch follows:', error)
  }

  return followingDids
}

export const handler = async (
  ctx: AppContext,
  params: QueryParams,
  viewerDid?: string
) => {
  if (!viewerDid) {
    return { cursor: undefined, feed: [] }
  }

  // Get both sets
  const [cannectDids, followingDids] = await Promise.all([
    getCannectDids(),
    getFollowingDids(viewerDid),
  ])

  // Intersection: Cannect users that the viewer follows
  const allowedDids = new Set<string>()
  for (const did of cannectDids) {
    if (followingDids.has(did)) {
      allowedDids.add(did)
    }
  }

  if (allowedDids.size === 0) {
    return { cursor: undefined, feed: [] }
  }

  // Get posts and filter by allowed DIDs
  let builder = ctx.db
    .selectFrom('post')
    .selectAll()
    .orderBy('indexedAt', 'desc')
    .orderBy('cid', 'desc')
    .limit(500)

  if (params.cursor) {
    const timeStr = new Date(parseInt(params.cursor, 10)).toISOString()
    builder = builder.where('indexedAt', '<', timeStr)
  }

  const allPosts = await builder.execute()

  // Filter: only posts from Cannect users that viewer follows
  const filteredPosts = allPosts
    .filter(post => allowedDids.has(getAuthorFromUri(post.uri)))
    .slice(0, params.limit)

  const feed = filteredPosts.map(row => ({ post: row.uri }))

  let cursor: string | undefined
  const last = filteredPosts.at(-1)
  if (last) {
    cursor = new Date(last.indexedAt).getTime().toString(10)
  }

  return { cursor, feed }
}

