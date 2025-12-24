import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BSKY_PUBLIC_API = "https://public.api.bsky.app/xrpc";

// Initialize Supabase client with service role for admin operations
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * ✅ Gold Standard Resilience: fetchWithTimeout
 * Prevents "hanging" upstream requests from blocking your app.
 */
async function fetchWithTimeout(url: string, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

/**
 * Cache an external profile in cached_profiles table
 */
async function cacheProfile(profile: any) {
  if (!profile?.did) return;
  
  try {
    // Check if this is a Cannect user (don't cache local users)
    const { data: localProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("did", profile.did)
      .maybeSingle();
    
    if (localProfile) return; // Don't cache Cannect users
    
    await supabaseAdmin
      .from("cached_profiles")
      .upsert({
        did: profile.did,
        handle: profile.handle,
        display_name: profile.displayName || null,
        avatar_url: profile.avatar || null,
        banner_url: profile.banner || null,
        description: profile.description || null,
        followers_count: profile.followersCount || 0,
        following_count: profile.followsCount || 0,
        posts_count: profile.postsCount || 0,
        last_accessed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days TTL
      }, { onConflict: 'did' });
  } catch (e) {
    console.error("Error caching profile:", e);
  }
}

/**
 * Cache an external post in cached_posts table
 */
async function cachePost(post: any, author: any) {
  if (!post?.uri) return;
  
  try {
    // Check if this is a Cannect post (don't cache local posts)
    const { data: localPost } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("at_uri", post.uri)
      .maybeSingle();
    
    if (localPost) return; // Don't cache Cannect posts
    
    await supabaseAdmin
      .from("cached_posts")
      .upsert({
        at_uri: post.uri,
        cid: post.cid,
        author_did: author?.did || post.author?.did,
        content: post.record?.text || "",
        reply_parent_uri: post.record?.reply?.parent?.uri || null,
        reply_root_uri: post.record?.reply?.root?.uri || null,
        embed_type: post.embed?.$type || null,
        embed_data: post.embed ? JSON.stringify(post.embed) : null,
        facets: post.record?.facets ? JSON.stringify(post.record.facets) : null,
        langs: post.record?.langs || null,
        like_count: post.likeCount || 0,
        repost_count: post.repostCount || 0,
        reply_count: post.replyCount || 0,
        quote_count: post.quoteCount || 0,
        indexed_at: post.indexedAt || new Date().toISOString(),
        access_count: 1,
        last_accessed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours default TTL
      }, { 
        onConflict: 'at_uri',
        // Update access count on conflict
      });
    
    // Also cache the author profile
    if (author || post.author) {
      await cacheProfile(author || post.author);
    }
  } catch (e) {
    console.error("Error caching post:", e);
  }
}

/**
 * Cache multiple posts from a feed response (fire and forget)
 */
async function cacheFeedPosts(feedItems: any[]) {
  if (!feedItems || !Array.isArray(feedItems)) return;
  
  // Process in background - don't block the response
  for (const item of feedItems.slice(0, 20)) { // Only cache first 20 posts
    const post = item.post || item;
    const author = post.author;
    if (post.uri && author) {
      cachePost(post, author).catch(() => {}); // Fire and forget
    }
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "feed";
    const limit = url.searchParams.get("limit") || "50";
    const cursor = url.searchParams.get("cursor") || "";

    let bskyUrl: string;
    
    // Switch on common actions for specific formatting
    switch (action) {
      case "feed":
        const feedUri = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${limit}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "search":
        const qPost = url.searchParams.get("q") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(qPost)}&sort=latest&limit=${limit}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "searchActors":
        const qActor = url.searchParams.get("q") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.actor.searchActors?q=${encodeURIComponent(qActor)}&limit=${limit}`;
        break;

      case "trending":
        // Fallback for public use: search for popular activity
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.actor.searchActors?q=*&limit=${limit}`;
        break;

      case "trendingTopics":
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.unspecced.getTrendingTopics?limit=${limit}`;
        break;

      case "getProfile":
        // Support both "actor" and "handle" params for compatibility
        const actor = url.searchParams.get("actor") || url.searchParams.get("handle") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
        break;

      case "getAuthorFeed":
        // Support both "actor" and "handle" params for compatibility
        const author = url.searchParams.get("actor") || url.searchParams.get("handle") || "";
        // Filter options: posts_no_replies, posts_with_replies, posts_with_media, posts_and_author_threads
        const filter = url.searchParams.get("filter") || "posts_no_replies";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(author)}&limit=${limit}&filter=${filter}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "getFollowers":
        const followersActor = url.searchParams.get("actor") || url.searchParams.get("handle") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.graph.getFollowers?actor=${encodeURIComponent(followersActor)}&limit=${limit}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "getFollows":
        const followsActor = url.searchParams.get("actor") || url.searchParams.get("handle") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.graph.getFollows?actor=${encodeURIComponent(followsActor)}&limit=${limit}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "syncFollowsList": {
        // Sync followers/following list from Bluesky to local DB
        const syncActor = url.searchParams.get("actor") || "";
        const syncType = url.searchParams.get("type") as "followers" | "following";
        const profileId = url.searchParams.get("profileId") || "";
        
        if (!syncActor || !syncType || !profileId) {
          throw new Error("Missing required params: actor, type, profileId");
        }
        
        const listAction = syncType === "followers" ? "getFollowers" : "getFollows";
        const listUrl = `${BSKY_PUBLIC_API}/app.bsky.graph.${listAction}?actor=${encodeURIComponent(syncActor)}&limit=100`;
        
        const listRes = await fetchWithTimeout(listUrl, {
          headers: { "Accept": "application/json", "User-Agent": "Cannect/1.0" },
        });
        
        if (!listRes.ok) {
          return new Response(JSON.stringify({ synced: 0, error: "Failed to fetch from Bluesky" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        const listData = await listRes.json();
        const users = syncType === "followers" ? listData.followers : listData.follows;
        
        if (!users || !Array.isArray(users)) {
          return new Response(JSON.stringify({ synced: 0 }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        let synced = 0;
        for (const user of users) {
          try {
            // Upsert external profile using RPC
            const { data: newProfileId } = await supabaseAdmin.rpc("upsert_external_profile", {
              p_did: user.did,
              p_handle: user.handle,
              p_display_name: user.displayName || user.handle,
              p_avatar_url: user.avatar || null,
              p_bio: user.description || null,
              p_followers_count: user.followersCount || 0,
              p_following_count: user.followsCount || 0,
              p_posts_count: user.postsCount || 0,
            });
            
            if (newProfileId) {
              const followerId = syncType === "followers" ? newProfileId : profileId;
              const followingId = syncType === "followers" ? profileId : newProfileId;
              
              // Check if exists
              const { data: existing } = await supabaseAdmin
                .from("follows")
                .select("id")
                .eq("follower_id", followerId)
                .eq("following_id", followingId)
                .maybeSingle();
              
              if (!existing) {
                await supabaseAdmin.from("follows").insert({
                  follower_id: followerId,
                  following_id: followingId,
                  subject_did: syncType === "followers" ? syncActor : user.did,
                });
                synced++;
              }
            }
          } catch (err) {
            console.error("Sync user error:", err);
          }
        }
        
        return new Response(JSON.stringify({ synced, total: users.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "syncPostInteractions": {
        // Sync likes/reposts from Bluesky and create notifications
        const postUri = url.searchParams.get("uri") || "";
        const postId = url.searchParams.get("postId") || "";
        const postAuthorId = url.searchParams.get("authorId") || "";
        const interactionType = url.searchParams.get("type") as "likes" | "reposts";
        
        if (!postUri || !postId || !postAuthorId || !interactionType) {
          throw new Error("Missing required params: uri, postId, authorId, type");
        }
        
        // Fetch likers or reposters from Bluesky
        const endpoint = interactionType === "likes" ? "getLikes" : "getRepostedBy";
        const listUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.${endpoint}?uri=${encodeURIComponent(postUri)}&limit=50`;
        
        const listRes = await fetchWithTimeout(listUrl, {
          headers: { "Accept": "application/json", "User-Agent": "Cannect/1.0" },
        });
        
        if (!listRes.ok) {
          return new Response(JSON.stringify({ synced: 0, error: "Failed to fetch from Bluesky" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        const listData = await listRes.json();
        const users = interactionType === "likes" 
          ? listData.likes?.map((l: any) => l.actor) 
          : listData.repostedBy;
        
        if (!users || !Array.isArray(users)) {
          return new Response(JSON.stringify({ synced: 0 }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        let synced = 0;
        const reason = interactionType === "likes" ? "like" : "repost";
        
        for (const user of users) {
          try {
            // Skip if this is a local Cannect user (they'd already have a notification from the trigger)
            const { data: localProfile } = await supabaseAdmin
              .from("profiles")
              .select("id, is_local")
              .eq("did", user.did)
              .maybeSingle();
            
            if (localProfile?.is_local) {
              continue; // Skip local users
            }
            
            // Check if notification already exists for this actor
            const { data: existingNotif } = await supabaseAdmin
              .from("notifications")
              .select("id")
              .eq("user_id", postAuthorId)
              .eq("post_id", postId)
              .eq("reason", reason)
              .eq("actor_did", user.did)
              .maybeSingle();
            
            if (existingNotif) {
              continue; // Already notified
            }
            
            // Create external notification
            await supabaseAdmin.from("notifications").insert({
              user_id: postAuthorId,
              actor_id: null,
              actor_did: user.did,
              actor_handle: user.handle,
              actor_display_name: user.displayName || user.handle,
              actor_avatar: user.avatar,
              reason: reason,
              post_id: postId,
              is_external: true,
            });
            synced++;
          } catch (err) {
            console.error("Sync interaction error:", err);
          }
        }
        
        return new Response(JSON.stringify({ synced, total: users.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "xrpc":
        // ✅ Gold Standard Resilience: Generic XRPC Passthrough
        const path = url.searchParams.get("path") || url.searchParams.get("endpoint") || "";
        if (!path) throw new Error("Missing XRPC path");
        const xrpcParams = new URLSearchParams();
        url.searchParams.forEach((value, key) => {
          if (!["action", "path", "endpoint"].includes(key)) {
            xrpcParams.set(key, value);
          }
        });
        // Ensure path starts with / for proper URL construction
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        bskyUrl = `${BSKY_PUBLIC_API}${normalizedPath}?${xrpcParams.toString()}`;
        break;

      default:
        throw new Error(`Unsupported action: ${action}`);
    }

    console.log("Fetching from Bluesky:", bskyUrl);

    // ✅ Resilience: Wrapped fetch with timeout and error capture
    try {
      const response = await fetchWithTimeout(bskyUrl, {
        headers: { "Accept": "application/json", "User-Agent": "Cannect/1.0" },
      });

      if (!response.ok) {
        throw new Error(`Bluesky Upstream Error: ${response.status}`);
      }

      const data = await response.json();
      
      // ✅ Cache responses based on action type (fire and forget)
      if (action === "getProfile" && data) {
        cacheProfile(data).catch(() => {});
      } else if ((action === "feed" || action === "search" || action === "getAuthorFeed") && data.feed) {
        cacheFeedPosts(data.feed).catch(() => {});
      } else if (action === "searchActors" && data.actors) {
        // Cache search actor results
        for (const actor of data.actors.slice(0, 10)) {
          cacheProfile(actor).catch(() => {});
        }
      }
      
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (innerError) {
      console.error("Inner Fetch Error:", innerError.message);
      // ✅ Resilience: Return empty sets instead of 500
      const fallback: any = { actors: [], posts: [], feed: [], topics: [] };
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (error) {
    console.error("Global Proxy Crash:", error.message);
    return new Response(
      JSON.stringify({ error: error.message, actors: [], posts: [], feed: [] }),
      {
        status: 200, // Return 200 to keep Frontend hooks in a successful (but empty) state
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
