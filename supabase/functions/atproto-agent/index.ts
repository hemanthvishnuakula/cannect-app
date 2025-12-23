import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * AT Protocol Agent Edge Function
 * 
 * PDS-First Architecture: All AT Protocol interactions go directly to the PDS,
 * then mirror results to the database. This provides:
 * - Instant feedback (no async queue delays)
 * - Automatic token refresh
 * - Consistent behavior for local and external content
 * - Federation that actually works (PDS syncs to relay automatically)
 * 
 * Supported actions:
 * - like / unlike
 * - repost / unrepost
 * - follow / unfollow
 * - reply (to external posts)
 * - post (with federation)
 */

const PDS_URL = "https://cannect.space";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PdsSession {
  user_id: string;
  access_jwt: string;
  refresh_jwt: string;
  did: string;
  handle: string;
  expires_at: string | null;
}

interface ActionRequest {
  action: 'like' | 'unlike' | 'repost' | 'unrepost' | 'follow' | 'unfollow' | 'reply' | 'post';
  userId: string;
  // For like/repost:
  subjectUri?: string;
  subjectCid?: string;
  postId?: string; // Local post ID if exists
  // For follow/unfollow:
  targetDid?: string;
  targetHandle?: string;
  targetDisplayName?: string;
  targetAvatar?: string;
  // For reply/post:
  content?: string;
  parentUri?: string;
  parentCid?: string;
  rootUri?: string;
  rootCid?: string;
  mediaUrls?: string[];
}

/**
 * Refresh access token using refresh_jwt
 */
async function refreshSession(
  supabase: any,
  session: PdsSession
): Promise<PdsSession | null> {
  console.log(`[atproto-agent] Refreshing session for ${session.did}`);
  
  try {
    const response = await fetch(`${PDS_URL}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.refresh_jwt}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error(`[atproto-agent] Refresh failed:`, error);
      return null;
    }

    const data = await response.json();
    
    // Update session in database
    const { error: updateError } = await supabase
      .from('pds_sessions')
      .update({
        access_jwt: data.accessJwt,
        refresh_jwt: data.refreshJwt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', session.user_id);

    if (updateError) {
      console.error(`[atproto-agent] Failed to update session:`, updateError);
    }

    console.log(`[atproto-agent] Session refreshed successfully`);
    
    return {
      ...session,
      access_jwt: data.accessJwt,
      refresh_jwt: data.refreshJwt,
    };
  } catch (error) {
    console.error(`[atproto-agent] Refresh error:`, error);
    return null;
  }
}

/**
 * Get or refresh PDS session for user
 */
async function getSession(supabase: any, userId: string): Promise<PdsSession | null> {
  const { data: session, error } = await supabase
    .from('pds_sessions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !session) {
    console.error(`[atproto-agent] No session found for user ${userId}`);
    return null;
  }

  // Check if token might be expired (we can't decode JWT in Deno easily, so refresh proactively)
  const updatedAt = new Date(session.updated_at);
  const hoursSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
  
  // Refresh if older than 1 hour (access tokens typically last 2 hours)
  if (hoursSinceUpdate > 1) {
    const refreshed = await refreshSession(supabase, session);
    if (refreshed) return refreshed;
  }

  return session;
}

/**
 * Make authenticated PDS API call with auto-retry on 401
 */
async function pdsCall(
  supabase: any,
  session: PdsSession,
  endpoint: string,
  method: 'GET' | 'POST',
  body?: any
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const makeRequest = async (jwt: string) => {
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);
    return fetch(`${PDS_URL}/xrpc/${endpoint}`, options);
  };

  let response = await makeRequest(session.access_jwt);

  // If unauthorized, try refreshing and retry once
  if (response.status === 401) {
    console.log(`[atproto-agent] Got 401, refreshing token...`);
    const refreshed = await refreshSession(supabase, session);
    if (refreshed) {
      response = await makeRequest(refreshed.access_jwt);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    return { ok: false, error: error.message || error.error || 'PDS request failed' };
  }

  // DELETE operations may not return a body
  if (response.status === 200) {
    const data = await response.json().catch(() => ({}));
    return { ok: true, data };
  }

  return { ok: true };
}

/**
 * Generate TID (Timestamp ID) for rkey
 */
function generateTID(): string {
  const now = Date.now() * 1000; // microseconds
  const clockId = Math.floor(Math.random() * 1024);
  const tid = ((BigInt(now) << 10n) | BigInt(clockId)).toString(32);
  return tid.padStart(13, '0');
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleLike(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!req.subjectUri || !req.subjectCid) {
    return { ok: false, error: 'Missing subjectUri or subjectCid' };
  }

  const rkey = generateTID();
  const record = {
    $type: 'app.bsky.feed.like',
    subject: {
      uri: req.subjectUri,
      cid: req.subjectCid,
    },
    createdAt: new Date().toISOString(),
  };

  // Create on PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.feed.like',
    rkey,
    record,
  });

  if (!result.ok) {
    return result;
  }

  const atUri = `at://${session.did}/app.bsky.feed.like/${rkey}`;

  // Mirror to database
  const { error: dbError } = await supabase
    .from('likes')
    .insert({
      user_id: req.userId,
      post_id: req.postId || null,
      subject_uri: req.subjectUri,
      subject_cid: req.subjectCid,
      rkey,
      at_uri: atUri,
      federated_at: new Date().toISOString(),
    });

  if (dbError) {
    console.error(`[atproto-agent] DB mirror failed for like:`, dbError);
    // Don't fail - PDS succeeded, DB is just mirror
  }

  return { ok: true, data: { uri: atUri, cid: result.data?.cid } };
}

async function handleUnlike(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; error?: string }> {
  if (!req.subjectUri) {
    return { ok: false, error: 'Missing subjectUri' };
  }

  // Find the like record to get its rkey
  const { data: likeRecord } = await supabase
    .from('likes')
    .select('rkey, at_uri')
    .eq('user_id', req.userId)
    .eq('subject_uri', req.subjectUri)
    .single();

  if (!likeRecord?.rkey) {
    // Try to find by post_id if no subject_uri match
    if (req.postId) {
      const { data: likeByPost } = await supabase
        .from('likes')
        .select('rkey, at_uri')
        .eq('user_id', req.userId)
        .eq('post_id', req.postId)
        .single();
      
      if (likeByPost?.rkey) {
        // Delete from PDS
        const result = await pdsCall(supabase, session, 'com.atproto.repo.deleteRecord', 'POST', {
          repo: session.did,
          collection: 'app.bsky.feed.like',
          rkey: likeByPost.rkey,
        });

        if (!result.ok) {
          return result;
        }

        // Delete from database
        await supabase
          .from('likes')
          .delete()
          .eq('user_id', req.userId)
          .eq('post_id', req.postId);

        return { ok: true };
      }
    }
    
    // No federated like found, just delete locally
    await supabase
      .from('likes')
      .delete()
      .eq('user_id', req.userId)
      .or(`subject_uri.eq.${req.subjectUri},post_id.eq.${req.postId}`);
    
    return { ok: true };
  }

  // Delete from PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.deleteRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.feed.like',
    rkey: likeRecord.rkey,
  });

  if (!result.ok) {
    return result;
  }

  // Delete from database
  await supabase
    .from('likes')
    .delete()
    .eq('user_id', req.userId)
    .eq('subject_uri', req.subjectUri);

  return { ok: true };
}

async function handleRepost(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!req.subjectUri || !req.subjectCid) {
    return { ok: false, error: 'Missing subjectUri or subjectCid' };
  }

  const rkey = generateTID();
  const record = {
    $type: 'app.bsky.feed.repost',
    subject: {
      uri: req.subjectUri,
      cid: req.subjectCid,
    },
    createdAt: new Date().toISOString(),
  };

  // Create on PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.feed.repost',
    rkey,
    record,
  });

  if (!result.ok) {
    return result;
  }

  const atUri = `at://${session.did}/app.bsky.feed.repost/${rkey}`;

  // Mirror to database
  const { error: dbError } = await supabase
    .from('reposts')
    .insert({
      user_id: req.userId,
      post_id: req.postId || null,
      subject_uri: req.subjectUri,
      subject_cid: req.subjectCid,
      rkey,
      at_uri: atUri,
      federated_at: new Date().toISOString(),
    });

  if (dbError) {
    console.error(`[atproto-agent] DB mirror failed for repost:`, dbError);
  }

  return { ok: true, data: { uri: atUri, cid: result.data?.cid } };
}

async function handleUnrepost(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; error?: string }> {
  if (!req.subjectUri) {
    return { ok: false, error: 'Missing subjectUri' };
  }

  // Find the repost record
  const { data: repostRecord } = await supabase
    .from('reposts')
    .select('rkey')
    .eq('user_id', req.userId)
    .eq('subject_uri', req.subjectUri)
    .single();

  if (!repostRecord?.rkey) {
    // Just delete locally if not federated
    await supabase
      .from('reposts')
      .delete()
      .eq('user_id', req.userId)
      .or(`subject_uri.eq.${req.subjectUri},post_id.eq.${req.postId}`);
    
    return { ok: true };
  }

  // Delete from PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.deleteRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.feed.repost',
    rkey: repostRecord.rkey,
  });

  if (!result.ok) {
    return result;
  }

  // Delete from database
  await supabase
    .from('reposts')
    .delete()
    .eq('user_id', req.userId)
    .eq('subject_uri', req.subjectUri);

  return { ok: true };
}

async function handleFollow(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!req.targetDid) {
    return { ok: false, error: 'Missing targetDid' };
  }

  const rkey = generateTID();
  const record = {
    $type: 'app.bsky.graph.follow',
    subject: req.targetDid,
    createdAt: new Date().toISOString(),
  };

  // Create on PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.follow',
    rkey,
    record,
  });

  if (!result.ok) {
    return result;
  }

  const atUri = `at://${session.did}/app.bsky.graph.follow/${rkey}`;

  // Upsert external profile if needed
  let followingId: string | null = null;
  
  if (req.targetHandle) {
    const { data: profileId } = await supabase.rpc('upsert_external_profile', {
      p_did: req.targetDid,
      p_handle: req.targetHandle,
      p_display_name: req.targetDisplayName || req.targetHandle,
      p_avatar_url: req.targetAvatar || null,
    });
    followingId = profileId;
  }

  // Mirror to database
  const { error: dbError } = await supabase
    .from('follows')
    .insert({
      follower_id: req.userId,
      following_id: followingId,
      subject_did: req.targetDid,
      rkey,
      at_uri: atUri,
      federated_at: new Date().toISOString(),
    });

  if (dbError) {
    console.error(`[atproto-agent] DB mirror failed for follow:`, dbError);
  }

  return { ok: true, data: { uri: atUri, cid: result.data?.cid } };
}

async function handleUnfollow(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; error?: string }> {
  if (!req.targetDid) {
    return { ok: false, error: 'Missing targetDid' };
  }

  // Find the follow record
  const { data: followRecord } = await supabase
    .from('follows')
    .select('rkey')
    .eq('follower_id', req.userId)
    .eq('subject_did', req.targetDid)
    .single();

  if (!followRecord?.rkey) {
    // Just delete locally if not federated
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', req.userId)
      .eq('subject_did', req.targetDid);
    
    return { ok: true };
  }

  // Delete from PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.deleteRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.graph.follow',
    rkey: followRecord.rkey,
  });

  if (!result.ok) {
    return result;
  }

  // Delete from database
  await supabase
    .from('follows')
    .delete()
    .eq('follower_id', req.userId)
    .eq('subject_did', req.targetDid);

  return { ok: true };
}

async function handleReply(
  supabase: any,
  session: PdsSession,
  req: ActionRequest
): Promise<{ ok: boolean; data?: any; error?: string }> {
  if (!req.content || !req.parentUri || !req.parentCid) {
    return { ok: false, error: 'Missing content, parentUri, or parentCid' };
  }

  const rkey = generateTID();
  const record: any = {
    $type: 'app.bsky.feed.post',
    text: req.content,
    createdAt: new Date().toISOString(),
    reply: {
      parent: {
        uri: req.parentUri,
        cid: req.parentCid,
      },
      root: {
        uri: req.rootUri || req.parentUri,
        cid: req.rootCid || req.parentCid,
      },
    },
    langs: ['en'],
  };

  // Create on PDS
  const result = await pdsCall(supabase, session, 'com.atproto.repo.createRecord', 'POST', {
    repo: session.did,
    collection: 'app.bsky.feed.post',
    rkey,
    record,
  });

  if (!result.ok) {
    return result;
  }

  const atUri = `at://${session.did}/app.bsky.feed.post/${rkey}`;

  // Mirror to database as a reply
  const { data: post, error: dbError } = await supabase
    .from('posts')
    .insert({
      user_id: req.userId,
      content: req.content,
      is_reply: true,
      // These point to external content, so local IDs may be null
      thread_parent_uri: req.parentUri,
      thread_parent_cid: req.parentCid,
      thread_root_uri: req.rootUri || req.parentUri,
      thread_root_cid: req.rootCid || req.parentCid,
      rkey,
      at_uri: atUri,
      at_cid: result.data?.cid,
      federated_at: new Date().toISOString(),
      type: 'post',
    })
    .select()
    .single();

  if (dbError) {
    console.error(`[atproto-agent] DB mirror failed for reply:`, dbError);
  }

  return { ok: true, data: { uri: atUri, cid: result.data?.cid, post } };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body: ActionRequest = await req.json();
    
    if (!body.action || !body.userId) {
      return new Response(
        JSON.stringify({ error: "Missing action or userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[atproto-agent] Processing ${body.action} for user ${body.userId}`);

    // Get user's PDS session
    const session = await getSession(supabase, body.userId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: "No PDS session found. User may need to re-authenticate." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result: { ok: boolean; data?: any; error?: string };

    switch (body.action) {
      case 'like':
        result = await handleLike(supabase, session, body);
        break;
      case 'unlike':
        result = await handleUnlike(supabase, session, body);
        break;
      case 'repost':
        result = await handleRepost(supabase, session, body);
        break;
      case 'unrepost':
        result = await handleUnrepost(supabase, session, body);
        break;
      case 'follow':
        result = await handleFollow(supabase, session, body);
        break;
      case 'unfollow':
        result = await handleUnfollow(supabase, session, body);
        break;
      case 'reply':
        result = await handleReply(supabase, session, body);
        break;
      default:
        result = { ok: false, error: `Unknown action: ${body.action}` };
    }

    if (!result.ok) {
      console.error(`[atproto-agent] Action failed:`, result.error);
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[atproto-agent] Action succeeded:`, result.data);
    return new Response(
      JSON.stringify({ success: true, ...result.data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`[atproto-agent] Error:`, error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
