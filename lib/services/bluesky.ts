/**
 * Bluesky Federation Service
 * Fetches public posts from Bluesky via Supabase Edge Function proxy.
 * This avoids CORS issues when running in the browser.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// Common headers for edge function calls
const getProxyHeaders = () => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "apikey": SUPABASE_ANON_KEY,
});

/**
 * Generic Bluesky API fetcher via proxy
 * Use this for any Bluesky XRPC endpoint
 */
export async function fetchBluesky(
  endpoint: string,
  params: Record<string, string | number> = {}
) {
  const searchParams = new URLSearchParams();
  searchParams.set("action", "xrpc");
  searchParams.set("endpoint", endpoint);
  
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  const proxyUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?${searchParams.toString()}`;

  const response = await fetch(proxyUrl, {
    headers: getProxyHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Bluesky API error: ${response.status}`);
  }

  return response.json();
}

export interface FederatedPost {
  id: string;
  uri: string;
  cid: string;
  user_id: string;
  content: string;
  created_at: string;
  media_urls: string[];
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  is_federated: true;
  type: 'post';
  author: {
    id: string;
    did: string;
    handle: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    is_verified: boolean;
  };
}

export async function getFederatedPosts(limit = 25): Promise<FederatedPost[]> {
  try {
    // Use Supabase Edge Function proxy to avoid CORS
    const proxyUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=feed&limit=${limit}`;
    
    const response = await fetch(proxyUrl, {
      headers: getProxyHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }
    
    const data = await response.json();
    const posts = data.feed || [];

    return posts.map((item: any) => {
      const bskyPost = item.post;
      return {
        id: bskyPost.cid, // Keep cid as id for backward compat
        uri: bskyPost.uri, // Add URI for AT Protocol interactions
        cid: bskyPost.cid,
        user_id: bskyPost.author.did,
        content: bskyPost.record?.text || "",
        created_at: bskyPost.record?.createdAt || bskyPost.indexedAt,
        media_urls: bskyPost.embed?.images?.map((img: any) => img.fullsize) || [],
        likes_count: bskyPost.likeCount || 0,
        reposts_count: bskyPost.repostCount || 0,
        replies_count: bskyPost.replyCount || 0,
        is_federated: true as const,
        type: 'post' as const,
        author: {
          id: bskyPost.author.did,
          did: bskyPost.author.did,
          handle: bskyPost.author.handle,
          username: bskyPost.author.handle,
          display_name: bskyPost.author.displayName || bskyPost.author.handle,
          avatar_url: bskyPost.author.avatar || null,
          is_verified: false,
        },
      };
    });
  } catch (error) {
    console.error("Bluesky fetch failed:", error);
    return [];
  }
}

/**
 * Search Bluesky posts by query
 */
export async function searchFederatedPosts(query: string, limit = 25) {
  try {
    const proxyUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=search&q=${encodeURIComponent(query)}&limit=${limit}`;
    
    const response = await fetch(proxyUrl, {
      headers: getProxyHeaders(),
    });
    
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }
    
    const data = await response.json();
    const posts = data.posts || [];

    return posts.map((bskyPost: any) => ({
      id: bskyPost.cid,
      user_id: bskyPost.author.did,
      content: bskyPost.record?.text || "",
      created_at: bskyPost.record?.createdAt || bskyPost.indexedAt,
      media_urls: bskyPost.embed?.images?.map((img: any) => img.fullsize) || [],
      likes_count: bskyPost.likeCount || 0,
      reposts_count: bskyPost.repostCount || 0,
      replies_count: bskyPost.replyCount || 0,
      is_federated: true,
      type: 'post',
      author: {
        id: bskyPost.author.did,
        username: bskyPost.author.handle,
        display_name: bskyPost.author.displayName || bskyPost.author.handle,
        avatar_url: bskyPost.author.avatar,
        is_verified: false,
      },
    }));
  } catch (error) {
    console.error("Bluesky search failed:", error);
    return [];
  }
}

/**
 * Fetch a single post with its thread (replies)
 */
export interface BlueskyThread {
  post: FederatedPost;
  replies: FederatedPost[];
  parent?: FederatedPost;
}

function parseBlueskyPost(bskyPost: any): FederatedPost {
  return {
    id: bskyPost.cid,
    uri: bskyPost.uri,
    cid: bskyPost.cid,
    user_id: bskyPost.author.did,
    content: bskyPost.record?.text || "",
    created_at: bskyPost.record?.createdAt || bskyPost.indexedAt,
    media_urls: bskyPost.embed?.images?.map((img: any) => img.fullsize) || [],
    likes_count: bskyPost.likeCount || 0,
    reposts_count: bskyPost.repostCount || 0,
    replies_count: bskyPost.replyCount || 0,
    is_federated: true as const,
    type: 'post' as const,
    author: {
      id: bskyPost.author.did,
      did: bskyPost.author.did,
      handle: bskyPost.author.handle,
      username: bskyPost.author.handle,
      display_name: bskyPost.author.displayName || bskyPost.author.handle,
      avatar_url: bskyPost.author.avatar || null,
      is_verified: false,
    },
  };
}

export async function getBlueskyPostThread(uri: string): Promise<BlueskyThread | null> {
  try {
    const data = await fetchBluesky("app.bsky.feed.getPostThread", {
      uri,
      depth: 6,
      parentHeight: 1,
    });

    if (!data.thread || data.thread.$type !== "app.bsky.feed.defs#threadViewPost") {
      return null;
    }

    const thread = data.thread;
    const mainPost = parseBlueskyPost(thread.post);
    
    // Parse replies recursively (flatten for now)
    const replies: FederatedPost[] = [];
    function collectReplies(node: any, depth = 0) {
      if (!node.replies || depth > 10) return;
      for (const reply of node.replies) {
        if (reply.$type === "app.bsky.feed.defs#threadViewPost" && reply.post) {
          replies.push(parseBlueskyPost(reply.post));
          collectReplies(reply, depth + 1);
        }
      }
    }
    collectReplies(thread);
    
    // Parse parent if exists
    let parent: FederatedPost | undefined;
    if (thread.parent && thread.parent.$type === "app.bsky.feed.defs#threadViewPost") {
      parent = parseBlueskyPost(thread.parent.post);
    }

    return { post: mainPost, replies, parent };
  } catch (error) {
    console.error("Failed to fetch Bluesky thread:", error);
    return null;
  }
}
