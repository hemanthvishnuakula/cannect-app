import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Process Jetstream Event
 * 
 * Receives events from the Jetstream consumer running on VPS.
 * Creates notifications for Cannect users when external Bluesky
 * users interact with their content.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface JetstreamEvent {
  actorDid: string;
  collection: string;
  operation: string;
  record: Record<string, unknown>;
  rkey: string;
  time_us: number;
}

async function getActorProfile(did: string) {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.error("Failed to fetch actor profile:", e);
  }
  return null;
}

/**
 * Cache an external actor's profile in cached_profiles
 */
async function cacheActorProfile(did: string, profile?: Record<string, unknown>) {
  const actorProfile = profile || await getActorProfile(did);
  if (!actorProfile) return null;

  const { error } = await supabase
    .from("cached_profiles")
    .upsert({
      did,
      handle: actorProfile.handle || did,
      display_name: actorProfile.displayName || null,
      avatar_url: actorProfile.avatar || null,
      banner_url: actorProfile.banner || null,
      description: actorProfile.description || null,
      followers_count: actorProfile.followersCount || 0,
      following_count: actorProfile.followsCount || 0,
      posts_count: actorProfile.postsCount || 0,
      last_accessed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    }, { onConflict: 'did' });

  if (error) {
    console.error("Error caching actor profile:", error);
  }
  return actorProfile;
}

/**
 * Record a like in the likes table (for external actors liking Cannect posts)
 */
async function recordLike(params: {
  postId: string;
  actorDid: string;
  atUri: string;
}) {
  const { postId, actorDid, atUri } = params;

  // Check for existing like
  const { data: existing } = await supabase
    .from("likes")
    .select("id")
    .eq("post_id", postId)
    .eq("actor_did", actorDid)
    .maybeSingle();

  if (existing) {
    console.log("Like already exists");
    return { recorded: false, reason: "duplicate" };
  }

  const { error } = await supabase
    .from("likes")
    .insert({
      post_id: postId,
      user_id: null, // External actor - no local user_id
      actor_did: actorDid,
      at_uri: atUri,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.error("Error recording like:", error);
    return { recorded: false, reason: error.message };
  }

  console.log(`Recorded like from ${actorDid} on post ${postId}`);
  return { recorded: true };
}

/**
 * Remove a like from the likes table
 */
async function removeLike(params: {
  actorDid: string;
  atUri: string;
}) {
  const { actorDid, atUri } = params;

  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("actor_did", actorDid)
    .eq("at_uri", atUri);

  if (error) {
    console.error("Error removing like:", error);
    return { removed: false, reason: error.message };
  }

  console.log(`Removed like ${atUri} from ${actorDid}`);
  return { removed: true };
}

/**
 * Record a repost in the reposts table (for external actors reposting Cannect posts)
 */
async function recordRepost(params: {
  postId: string;
  actorDid: string;
  atUri: string;
}) {
  const { postId, actorDid, atUri } = params;

  // Check for existing repost
  const { data: existing } = await supabase
    .from("reposts")
    .select("id")
    .eq("post_id", postId)
    .eq("actor_did", actorDid)
    .maybeSingle();

  if (existing) {
    console.log("Repost already exists");
    return { recorded: false, reason: "duplicate" };
  }

  const { error } = await supabase
    .from("reposts")
    .insert({
      post_id: postId,
      user_id: null, // External actor - no local user_id
      actor_did: actorDid,
      at_uri: atUri,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.error("Error recording repost:", error);
    return { recorded: false, reason: error.message };
  }

  console.log(`Recorded repost from ${actorDid} on post ${postId}`);
  return { recorded: true };
}

/**
 * Remove a repost from the reposts table
 */
async function removeRepost(params: {
  actorDid: string;
  atUri: string;
}) {
  const { actorDid, atUri } = params;

  const { error } = await supabase
    .from("reposts")
    .delete()
    .eq("actor_did", actorDid)
    .eq("at_uri", atUri);

  if (error) {
    console.error("Error removing repost:", error);
    return { removed: false, reason: error.message };
  }

  console.log(`Removed repost ${atUri} from ${actorDid}`);
  return { removed: true };
}

/**
 * Record a follow in cached_follows (for external actors following Cannect users)
 */
async function recordFollow(params: {
  followerDid: string;
  followeeDid: string;
  atUri: string;
}) {
  const { followerDid, followeeDid, atUri } = params;

  const { error } = await supabase
    .from("cached_follows")
    .upsert({
      follower_did: followerDid,
      followee_did: followeeDid,
      at_uri: atUri,
      created_at: new Date().toISOString(),
    }, { onConflict: 'follower_did,followee_did' });

  if (error) {
    console.error("Error recording follow:", error);
    return { recorded: false, reason: error.message };
  }

  console.log(`Recorded follow from ${followerDid} to ${followeeDid}`);
  return { recorded: true };
}

/**
 * Remove a follow from cached_follows
 */
async function removeFollow(params: {
  followerDid: string;
  atUri: string;
}) {
  const { followerDid, atUri } = params;

  const { error } = await supabase
    .from("cached_follows")
    .delete()
    .eq("follower_did", followerDid)
    .eq("at_uri", atUri);

  if (error) {
    console.error("Error removing follow:", error);
    return { removed: false, reason: error.message };
  }

  console.log(`Removed follow ${atUri} from ${followerDid}`);
  return { removed: true };
}

async function findUserByDid(did: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("did", did)
    .maybeSingle();
  
  if (error) {
    console.error("Error finding user:", error);
    return null;
  }
  return data;
}

async function findPostByUri(uri: string): Promise<{ id: string; user_id: string; content: string } | null> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, user_id, content")
    .eq("at_uri", uri)
    .maybeSingle();
  
  if (error) {
    console.error("Error finding post:", error);
    return null;
  }
  return data;
}

async function createNotification(params: {
  userId: string;
  actorDid: string;
  reason: "like" | "repost" | "reply" | "quote" | "follow";
  postId?: string;
}) {
  const { userId, actorDid, reason, postId } = params;
  
  // Get actor profile for display
  const actorProfile = await getActorProfile(actorDid);
  const actorHandle = actorProfile?.handle || actorDid;
  const actorName = actorProfile?.displayName || actorHandle;
  
  // Check if notification already exists (dedup)
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("reason", reason)
    .eq("actor_did", actorDid)
    .eq("is_external", true)
    .limit(1);
  
  if (existing && existing.length > 0) {
    console.log("Notification already exists, skipping");
    return { created: false, reason: "duplicate" };
  }
  
  // Create notification (actor_id is null for external notifications)
  const insertData: Record<string, unknown> = {
    user_id: userId,
    reason: reason,
    post_id: postId || null,
    is_external: true,
    actor_did: actorDid,
    actor_handle: actorHandle,
    actor_display_name: actorName,
    actor_avatar: actorProfile?.avatar || null,
    is_read: false,
    created_at: new Date().toISOString(),
  };
  
  const { error } = await supabase.from("notifications").insert(insertData);
  
  if (error) {
    console.error("Error creating notification:", error);
    return { created: false, reason: error.message };
  }
  
  console.log(`Created ${reason} notification for user ${userId}`);
  return { created: true, type: reason };
}

async function processLike(event: JetstreamEvent) {
  const subject = (event.record as { subject?: { uri?: string; cid?: string } })?.subject;
  const subjectUri = subject?.uri;
  if (!subjectUri) {
    return { processed: false, reason: "no subject uri" };
  }
  
  // Build the like's AT URI
  const likeAtUri = `at://${event.actorDid}/app.bsky.feed.like/${event.rkey}`;
  
  // Find the post being liked
  const post = await findPostByUri(subjectUri);
  if (!post) {
    return { processed: false, reason: "post not found" };
  }
  
  // Check if actor is a Cannect user
  const actor = await findUserByDid(event.actorDid);
  
  // Don't notify/record if user is liking their own post
  if (actor?.id === post.user_id) {
    return { processed: false, reason: "self-like" };
  }
  
  // Cache the external actor's profile
  if (!actor) {
    await cacheActorProfile(event.actorDid);
  }
  
  // Record the like in the database
  await recordLike({
    postId: post.id,
    actorDid: event.actorDid,
    atUri: likeAtUri,
  });
  
  // Create notification for post owner
  return createNotification({
    userId: post.user_id,
    actorDid: event.actorDid,
    reason: "like",
    postId: post.id,
  });
}

async function processRepost(event: JetstreamEvent) {
  const subject = (event.record as { subject?: { uri?: string; cid?: string } })?.subject;
  const subjectUri = subject?.uri;
  if (!subjectUri) {
    return { processed: false, reason: "no subject uri" };
  }
  
  // Build the repost's AT URI
  const repostAtUri = `at://${event.actorDid}/app.bsky.feed.repost/${event.rkey}`;
  
  // Find the post being reposted
  const post = await findPostByUri(subjectUri);
  if (!post) {
    return { processed: false, reason: "post not found" };
  }
  
  // Check if actor is a Cannect user
  const actor = await findUserByDid(event.actorDid);
  
  // Don't notify/record if user is reposting their own post
  if (actor?.id === post.user_id) {
    return { processed: false, reason: "self-repost" };
  }
  
  // Cache the external actor's profile
  if (!actor) {
    await cacheActorProfile(event.actorDid);
  }
  
  // Record the repost in the database
  await recordRepost({
    postId: post.id,
    actorDid: event.actorDid,
    atUri: repostAtUri,
  });
  
  // Create notification for post owner
  return createNotification({
    userId: post.user_id,
    actorDid: event.actorDid,
    reason: "repost",
    postId: post.id,
  });
}

async function processPost(event: JetstreamEvent) {
  const record = event.record as {
    reply?: {
      parent?: { uri?: string };
      root?: { uri?: string };
    };
    embed?: {
      record?: { uri?: string };
    };
  };
  
  // Check for reply to Cannect post (consumer already filtered for Cannect DIDs)
  const parentUri = record?.reply?.parent?.uri;
  if (parentUri) {
    const post = await findPostByUri(parentUri);
    if (post) {
      const actor = await findUserByDid(event.actorDid);
      if (actor?.id !== post.user_id) {
        // Cache the external actor's profile
        if (!actor) {
          await cacheActorProfile(event.actorDid);
        }
        return createNotification({
          userId: post.user_id,
          actorDid: event.actorDid,
          reason: "reply",
          postId: post.id,
        });
      }
    }
  }
  
  // Check for quote of Cannect post
  const quotedUri = record?.embed?.record?.uri;
  if (quotedUri) {
    const post = await findPostByUri(quotedUri);
    if (post) {
      const actor = await findUserByDid(event.actorDid);
      if (actor?.id !== post.user_id) {
        // Cache the external actor's profile
        if (!actor) {
          await cacheActorProfile(event.actorDid);
        }
        return createNotification({
          userId: post.user_id,
          actorDid: event.actorDid,
          reason: "quote",
          postId: post.id,
        });
      }
    }
  }
  
  return { processed: false, reason: "not relevant" };
}

async function processFollow(event: JetstreamEvent) {
  const subjectDid = (event.record as { subject?: string })?.subject;
  if (!subjectDid) {
    return { processed: false, reason: "no subject" };
  }
  
  // Build the follow's AT URI
  const followAtUri = `at://${event.actorDid}/app.bsky.graph.follow/${event.rkey}`;
  
  // Find if subject is a Cannect user
  const targetUser = await findUserByDid(subjectDid);
  if (!targetUser) {
    return { processed: false, reason: "target not cannect user" };
  }
  
  // Check if actor is a Cannect user
  const actor = await findUserByDid(event.actorDid);
  
  // Don't notify if following self (shouldn't happen but just in case)
  if (actor?.id === targetUser.id) {
    return { processed: false, reason: "self-follow" };
  }
  
  // Cache the external actor's profile
  if (!actor) {
    await cacheActorProfile(event.actorDid);
  }
  
  // Record the follow in cached_follows
  await recordFollow({
    followerDid: event.actorDid,
    followeeDid: subjectDid,
    atUri: followAtUri,
  });
  
  return createNotification({
    userId: targetUser.id,
    actorDid: event.actorDid,
    reason: "follow",
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  
  try {
    const event: JetstreamEvent = await req.json();
    
    console.log(`Processing ${event.collection} ${event.operation} from ${event.actorDid.slice(0, 20)}...`);
    
    let result: { processed?: boolean; created?: boolean; removed?: boolean; type?: string; reason?: string };
    
    // Handle DELETE operations
    if (event.operation === "delete") {
      const atUri = `at://${event.actorDid}/${event.collection}/${event.rkey}`;
      
      switch (event.collection) {
        case "app.bsky.feed.like":
          result = await removeLike({ actorDid: event.actorDid, atUri });
          break;
          
        case "app.bsky.feed.repost":
          result = await removeRepost({ actorDid: event.actorDid, atUri });
          break;
          
        case "app.bsky.graph.follow":
          result = await removeFollow({ followerDid: event.actorDid, atUri });
          break;
          
        default:
          result = { processed: false, reason: "delete not handled for collection" };
      }
      
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Only process create operations for notifications
    if (event.operation !== "create") {
      return new Response(JSON.stringify({ processed: false, reason: "not create or delete operation" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    switch (event.collection) {
      case "app.bsky.feed.like":
        result = await processLike(event);
        break;
        
      case "app.bsky.feed.repost":
        result = await processRepost(event);
        break;
        
      case "app.bsky.feed.post":
        result = await processPost(event);
        break;
        
      case "app.bsky.graph.follow":
        result = await processFollow(event);
        break;
        
      default:
        result = { processed: false, reason: "unknown collection" };
    }
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (error) {
    console.error("Error processing event:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
