/**
 * Bluesky Federation Service
 * Fetches public posts from Bluesky via Supabase Edge Function proxy.
 * This avoids CORS issues when running in the browser.
 */

import { supabase } from "@/lib/supabase";

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
  type: 'post' | 'quote';
  author: {
    id: string;
    did: string;
    handle: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    is_verified: boolean;
  };
  // Quoted post for quote posts
  quoted_post?: {
    uri: string;
    cid: string;
    content: string;
    author: {
      did: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
    };
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
        // Use thumb for feed performance, fullsize available if needed
        media_urls: bskyPost.embed?.images?.map((img: any) => img.thumb || img.fullsize) || [],
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
      // Use thumb for feed performance, fullsize available if needed
      media_urls: bskyPost.embed?.images?.map((img: any) => img.thumb || img.fullsize) || [],
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
  // Check for quoted post embed
  const embed = bskyPost.embed;
  let quoted_post: FederatedPost['quoted_post'] | undefined;
  let isQuote = false;
  
  if (embed?.$type === 'app.bsky.embed.record#view' && embed.record) {
    const quotedRecord = embed.record;
    isQuote = true;
    quoted_post = {
      uri: quotedRecord.uri,
      cid: quotedRecord.cid,
      content: quotedRecord.value?.text || '',
      author: {
        did: quotedRecord.author?.did || '',
        handle: quotedRecord.author?.handle || 'user',
        display_name: quotedRecord.author?.displayName || quotedRecord.author?.handle || 'User',
        avatar_url: quotedRecord.author?.avatar || null,
      },
    };
  }
  
  // Extract images (handle both direct images and recordWithMedia embeds)
  let media_urls: string[] = [];
  if (embed?.images) {
    media_urls = embed.images.map((img: any) => img.thumb || img.fullsize);
  } else if (embed?.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media?.images) {
    media_urls = embed.media.images.map((img: any) => img.thumb || img.fullsize);
  }
  
  return {
    id: bskyPost.cid,
    uri: bskyPost.uri,
    cid: bskyPost.cid,
    user_id: bskyPost.author.did,
    content: bskyPost.record?.text || "",
    created_at: bskyPost.record?.createdAt || bskyPost.indexedAt,
    media_urls,
    likes_count: bskyPost.likeCount || 0,
    reposts_count: bskyPost.repostCount || 0,
    replies_count: bskyPost.replyCount || 0,
    is_federated: true as const,
    type: isQuote ? 'quote' as const : 'post' as const,
    author: {
      id: bskyPost.author.did,
      did: bskyPost.author.did,
      handle: bskyPost.author.handle,
      username: bskyPost.author.handle,
      display_name: bskyPost.author.displayName || bskyPost.author.handle,
      avatar_url: bskyPost.author.avatar || null,
      is_verified: false,
    },
    quoted_post,
  };
}

/**
 * Lazy sync: Update local post counts from Bluesky
 * Called when viewing post details to keep counts fresh
 * Fails silently - doesn't block the UI if update fails
 */
async function syncPostCounts(post: FederatedPost): Promise<void> {
  try {
    // First try to update posts table (for Cannect posts)
    const { error } = await supabase
      .from('posts')
      .update({
        likes_count: post.likes_count,
        reposts_count: post.reposts_count,
        replies_count: post.replies_count,
      })
      .eq('at_uri', post.uri);
    
    if (error) {
      // Silently fail - this is just an optimization
      console.debug('[syncPostCounts] Update failed (post may not exist locally):', error.message);
    }
    
    // Also update cached_posts if it exists there
    await supabase
      .from('cached_posts')
      .update({
        like_count: post.likes_count,
        repost_count: post.reposts_count,
        reply_count: post.replies_count,
        last_accessed_at: new Date().toISOString(),
      })
      .eq('at_uri', post.uri);
  } catch (err) {
    // Silently fail
    console.debug('[syncPostCounts] Error:', err);
  }
}

/**
 * Check if a post exists in cached_posts table
 * Returns the cached post or null if not found
 */
async function getCachedPost(uri: string): Promise<FederatedPost | null> {
  try {
    const { data, error } = await supabase
      .from('cached_posts')
      .select(`
        at_uri,
        cid,
        author_did,
        content,
        embed_type,
        embed_data,
        like_count,
        repost_count,
        reply_count,
        quote_count,
        indexed_at,
        cached_profiles!cached_posts_author_did_fkey (
          did,
          handle,
          display_name,
          avatar_url
        )
      `)
      .eq('at_uri', uri)
      .maybeSingle();
    
    if (error || !data) return null;
    
    // Update last_accessed_at (fire and forget)
    supabase
      .from('cached_posts')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('at_uri', uri)
      .then(() => {});
    
    const profile = data.cached_profiles as any;
    
    return {
      id: data.cid,
      uri: data.at_uri,
      cid: data.cid,
      user_id: data.author_did,
      content: data.content,
      created_at: data.indexed_at,
      media_urls: [], // TODO: Parse from embed_data
      likes_count: data.like_count || 0,
      reposts_count: data.repost_count || 0,
      replies_count: data.reply_count || 0,
      is_federated: true as const,
      type: 'post' as const,
      author: {
        id: data.author_did,
        did: data.author_did,
        handle: profile?.handle || 'user',
        username: profile?.handle || 'user',
        display_name: profile?.display_name || profile?.handle || 'User',
        avatar_url: profile?.avatar_url || null,
        is_verified: false,
      },
    };
  } catch (err) {
    console.debug('[getCachedPost] Error:', err);
    return null;
  }
}

export async function getBlueskyPostThread(uri: string): Promise<BlueskyThread | null> {
  try {
    // First check if the post is a Cannect post (in posts table)
    const { data: cannectPost } = await supabase
      .from('posts')
      .select('id, at_uri')
      .eq('at_uri', uri)
      .maybeSingle();
    
    // Always fetch fresh from Bluesky to get latest counts and replies
    // (even for Cannect posts, we want fresh interaction counts from the network)
    const data = await fetchBluesky("app.bsky.feed.getPostThread", {
      uri,
      depth: 6,
      parentHeight: 1,
    });

    if (!data.thread || data.thread.$type !== "app.bsky.feed.defs#threadViewPost") {
      // If Bluesky doesn't have it, try to get from cached_posts
      const cachedPost = await getCachedPost(uri);
      if (cachedPost) {
        return { post: cachedPost, replies: [] };
      }
      return null;
    }

    const thread = data.thread;
    const mainPost = parseBlueskyPost(thread.post);
    
    // Lazy sync: Update local DB with fresh counts from Bluesky
    // Fire and forget - don't await, don't block the UI
    syncPostCounts(mainPost);
    
    // Parse only direct replies (depth 1), not nested replies
    const replies: FederatedPost[] = [];
    if (thread.replies) {
      for (const reply of thread.replies) {
        if (reply.$type === "app.bsky.feed.defs#threadViewPost" && reply.post) {
          replies.push(parseBlueskyPost(reply.post));
        }
      }
    }
    
    // Parse parent if exists
    let parent: FederatedPost | undefined;
    if (thread.parent && thread.parent.$type === "app.bsky.feed.defs#threadViewPost") {
      parent = parseBlueskyPost(thread.parent.post);
    }

    return { post: mainPost, replies, parent };
  } catch (error) {
    console.error("Failed to fetch Bluesky thread:", error);
    
    // On error, try to get from cached_posts as fallback
    const cachedPost = await getCachedPost(uri);
    if (cachedPost) {
      return { post: cachedPost, replies: [] };
    }
    
    return null;
  }
}
