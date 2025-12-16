/**
 * Bluesky Federation Service
 * Fetches public posts from Bluesky via Supabase Edge Function proxy.
 * This avoids CORS issues when running in the browser.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";

export async function getFederatedPosts(limit = 25) {
  try {
    // Use Supabase Edge Function proxy to avoid CORS
    const proxyUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=feed&limit=${limit}`;
    
    const response = await fetch(proxyUrl, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`);
    }
    
    const data = await response.json();
    const posts = data.feed || [];

    return posts.map((item: any) => {
      const bskyPost = item.post;
      return {
        id: bskyPost.cid,
        user_id: bskyPost.author.did,
        content: bskyPost.record?.text || "",
        created_at: bskyPost.record?.createdAt || bskyPost.indexedAt,
        media_urls: bskyPost.embed?.images?.map((img: any) => img.fullsize) || [],
        likes_count: bskyPost.likeCount || 0,
        reposts_count: bskyPost.repostCount || 0,
        comments_count: bskyPost.replyCount || 0,
        is_federated: true, // Internal flag for UI logic
        type: 'post',
        author: {
          id: bskyPost.author.did,
          username: bskyPost.author.handle,
          display_name: bskyPost.author.displayName || bskyPost.author.handle,
          avatar_url: bskyPost.author.avatar,
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
      headers: {
        "Content-Type": "application/json",
      },
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
      comments_count: bskyPost.replyCount || 0,
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
