/**
 * AT Protocol Agent Service
 * 
 * Client-side wrapper for the atproto-agent edge function.
 * Provides PDS-first federation for all AT Protocol interactions.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

interface AtprotoAgentResponse {
  success?: boolean;
  error?: string;
  uri?: string;
  cid?: string;
  post?: any;
}

interface LikeParams {
  userId: string;
  subjectUri: string;
  subjectCid: string;
  postId?: string;
}

interface RepostParams {
  userId: string;
  subjectUri: string;
  subjectCid: string;
  postId?: string;
}

interface FollowParams {
  userId: string;
  targetDid: string;
  targetHandle?: string;
  targetDisplayName?: string;
  targetAvatar?: string;
}

interface ReplyParams {
  userId: string;
  content: string;
  parentUri: string;
  parentCid: string;
  rootUri?: string;
  rootCid?: string;
}

/**
 * Call the atproto-agent edge function
 */
async function callAgent(body: Record<string, any>): Promise<AtprotoAgentResponse> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/atproto-agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'AT Protocol action failed');
  }

  return data;
}

// ============================================================================
// LIKE / UNLIKE
// ============================================================================

export async function likePost(params: LikeParams): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'like',
    userId: params.userId,
    subjectUri: params.subjectUri,
    subjectCid: params.subjectCid,
    postId: params.postId,
  });
}

export async function unlikePost(params: { userId: string; subjectUri: string; postId?: string }): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'unlike',
    userId: params.userId,
    subjectUri: params.subjectUri,
    postId: params.postId,
  });
}

// ============================================================================
// REPOST / UNREPOST
// ============================================================================

export async function repostPost(params: RepostParams): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'repost',
    userId: params.userId,
    subjectUri: params.subjectUri,
    subjectCid: params.subjectCid,
    postId: params.postId,
  });
}

export async function unrepostPost(params: { userId: string; subjectUri: string; postId?: string }): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'unrepost',
    userId: params.userId,
    subjectUri: params.subjectUri,
    postId: params.postId,
  });
}

// ============================================================================
// FOLLOW / UNFOLLOW
// ============================================================================

export async function followUser(params: FollowParams): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'follow',
    userId: params.userId,
    targetDid: params.targetDid,
    targetHandle: params.targetHandle,
    targetDisplayName: params.targetDisplayName,
    targetAvatar: params.targetAvatar,
  });
}

export async function unfollowUser(params: { userId: string; targetDid: string }): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'unfollow',
    userId: params.userId,
    targetDid: params.targetDid,
  });
}

// ============================================================================
// REPLY (to external posts)
// ============================================================================

export async function replyToPost(params: ReplyParams): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'reply',
    userId: params.userId,
    content: params.content,
    parentUri: params.parentUri,
    parentCid: params.parentCid,
    rootUri: params.rootUri,
    rootCid: params.rootCid,
  });
}

// ============================================================================
// QUOTE POST (Version 2.1 Unified Architecture)
// ============================================================================

export interface QuoteParams {
  userId: string;
  content: string;
  quoteUri: string;
  quoteCid: string;
}

export async function quotePost(params: QuoteParams): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'quote',
    userId: params.userId,
    content: params.content,
    quoteUri: params.quoteUri,
    quoteCid: params.quoteCid,
  });
}

// ============================================================================
// DELETE POST (PDS-first delete for posts, replies, and quotes)
// ============================================================================

export interface DeletePostParams {
  userId: string;
  postId: string;
  rkey?: string;    // Optional - will be looked up if not provided
  atUri?: string;   // Optional - for logging/reference
}

export async function deletePost(params: DeletePostParams): Promise<AtprotoAgentResponse> {
  return callAgent({
    action: 'deletePost',
    userId: params.userId,
    postId: params.postId,
    rkey: params.rkey,
    atUri: params.atUri,
  });
}
