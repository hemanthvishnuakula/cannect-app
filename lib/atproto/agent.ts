/**
 * AT Protocol Agent
 * 
 * Pure AT Protocol client using @atproto/api.
 * No Supabase dependency - all data goes directly to PDS.
 */

import { BskyAgent, RichText } from '@atproto/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { logger, perf } from '@/lib/utils/logger';

// Storage keys
const SESSION_KEY = 'atproto_session';

// Cannect's own PDS
const PDS_SERVICE = 'https://cannect.space';

// Bluesky AppView for content hydration
const BSKY_APPVIEW = 'https://public.api.bsky.app';

// Singleton agent instance
let agent: BskyAgent | null = null;

// Session expiry listeners
type SessionExpiredHandler = () => void;
const sessionExpiredListeners = new Set<SessionExpiredHandler>();

// Track if we've already notified about expiry to prevent spam
let hasNotifiedExpiry = false;

/**
 * Subscribe to session expiry events
 * Called when the refresh token expires and user must re-login
 */
export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredListeners.add(handler);
  return () => sessionExpiredListeners.delete(handler);
}

function notifySessionExpired() {
  // Prevent multiple notifications
  if (hasNotifiedExpiry) {
    console.log('[Agent] Session expiry already notified, skipping');
    return;
  }
  hasNotifiedExpiry = true;
  
  console.warn('[Auth] 🔴 Session expired - notifying', sessionExpiredListeners.size, 'listeners');
  logger.error('auth', 'notify_expired', `Notifying ${sessionExpiredListeners.size} listeners`);
  
  sessionExpiredListeners.forEach(handler => {
    try {
      handler();
    } catch (err) {
      console.error('[Auth] Session expired handler error:', err);
    }
  });
}

/**
 * Check if an error indicates the session is invalid
 * These errors mean the access token expired and refresh failed
 */
export function isAuthError(error: any): boolean {
  if (!error) return false;
  
  const status = error?.status || error?.response?.status;
  const errorCode = error?.error || error?.message || error?.data?.error;
  const errorMessage = typeof error === 'string' ? error : 
    error?.message || error?.data?.message || '';
  
  // Log the error being checked
  console.log('[Agent] isAuthError checking:', { status, errorCode, errorMessage: errorMessage.substring(0,100) });
  
  // 401 Unauthorized is always an auth error
  if (status === 401) {
    console.log('[Agent] 🔴 401 Unauthorized detected');
    logger.error('auth', 'auth_error', '401 Unauthorized', { status, errorCode });
    return true;
  }
  
  // 400 with specific auth-related error codes or messages
  // NOTE: Be VERY specific here to avoid false positives!
  if (status === 400) {
    const authPatterns = [
      'InvalidToken',
      'ExpiredToken', 
      'AuthenticationRequired',
      'invalid_token',
      'token_expired',
      'AuthRequired',
      'Bad token',
      'authentication required',
      'not authenticated',
      'session expired',        // More specific than just 'session'
      'invalid session',        // More specific than just 'session'
      'session not found',      // More specific than just 'session'
    ];
    
    const textToCheck = `${errorCode || ''} ${errorMessage || ''}`.toLowerCase();
    const matchedPattern = authPatterns.find(p => textToCheck.includes(p.toLowerCase()));
    
    if (matchedPattern) {
      console.log('[Agent] 🔴 400 with auth pattern detected:', { pattern: matchedPattern, text: textToCheck.substring(0,100) });
      logger.error('auth', 'auth_error', '400 with auth pattern', { status, errorCode, pattern: matchedPattern });
      return true;
    }
    
    console.log('[Agent] 400 error but no auth pattern match:', textToCheck.substring(0,100));
  }
  
  return false;
}

/**
 * Handle an auth error by clearing session and notifying listeners
 */
export async function handleAuthError(): Promise<void> {
  console.warn('[Agent] 🔴 handleAuthError called - clearing session');
  logger.error('auth', 'handle_auth_error', 'Clearing session due to auth error');
  await clearSession();
  agent = null;
  notifySessionExpired();
}

/**
 * Reset expiry notification state (call after successful login)
 */
export function resetExpiryState(): void {
  hasNotifiedExpiry = false;
}

// Storage helpers
async function getStoredSession(): Promise<any | null> {
  try {
    if (Platform.OS === 'web') {
      const data = await AsyncStorage.getItem(SESSION_KEY);
      return data ? JSON.parse(data) : null;
    }
    const data = await SecureStore.getItemAsync(SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function storeSession(session: any): Promise<void> {
  const data = JSON.stringify(session);
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(SESSION_KEY, data);
  } else {
    await SecureStore.setItemAsync(SESSION_KEY, data);
  }
}

async function clearSession(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(SESSION_KEY);
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}

/**
 * Get or create the BskyAgent singleton
 */
export function getAgent(): BskyAgent {
  if (!agent) {
    agent = new BskyAgent({
      service: PDS_SERVICE,
      persistSession: (evt, sess) => {
        console.log('[Agent] persistSession event:', evt, sess?.did ? `did:${sess.did.substring(8,20)}` : 'no session');
        logger.info('auth', 'persist_session', `Session event: ${evt}`, { 
          event: evt, 
          hasDid: !!sess?.did,
          did: sess?.did?.substring(8,20)
        });
        
        if (evt === 'expired') {
          // Refresh token expired - user must re-login
          console.warn('[Agent] 🔴 Session EXPIRED - user must re-login');
          logger.error('auth', 'session_expired', 'Refresh token expired');
          clearSession();
          notifySessionExpired();
        } else if (evt === 'create' || evt === 'update') {
          console.log('[Agent] ✅ Session created/updated, storing...');
          storeSession(sess);
        } else if (sess) {
          storeSession(sess);
        } else {
          console.log('[Agent] ⚠️ Clearing session (no session data)');
          clearSession();
        }
      },
    });
  }
  return agent;
}

/**
 * Initialize agent and restore session from storage
 */
export async function initializeAgent(): Promise<BskyAgent> {
  const bskyAgent = getAgent();
  
  const storedSession = await getStoredSession();
  console.log('[Agent] initializeAgent - stored session:', storedSession ? `did:${storedSession.did?.substring(8,20)}` : 'none');
  logger.info('auth', 'init_agent', 'Initializing agent', { 
    hasStoredSession: !!storedSession,
    storedDid: storedSession?.did?.substring(8,20)
  });
  
  if (storedSession) {
    try {
      console.log('[Agent] Attempting to resume session...');
      await bskyAgent.resumeSession(storedSession);
      console.log('[Agent] ✅ Session resumed successfully');
      logger.info('auth', 'session_resume', 'Session resumed', { did: storedSession.did?.substring(8,20) });
    } catch (err: any) {
      console.warn('[Agent] ❌ Failed to restore session:', err?.message || err);
      logger.error('auth', 'session_resume', `Resume failed: ${err?.message || 'Unknown'}`, { 
        error: err?.message,
        status: err?.status
      });
      await clearSession();
    }
  }
  
  return bskyAgent;
}

/**
 * Create a new account on the PDS
 */
export async function createAccount(opts: {
  email: string;
  password: string;
  handle: string;
  inviteCode?: string;
}): Promise<{ did: string; handle: string }> {
  const bskyAgent = getAgent();
  
  // Handle should be username.cannect.space for our PDS
  const fullHandle = opts.handle.includes('.') 
    ? opts.handle 
    : `${opts.handle}.cannect.space`;
  
  const result = await bskyAgent.createAccount({
    email: opts.email,
    password: opts.password,
    handle: fullHandle,
    inviteCode: opts.inviteCode,
  });
  
  return {
    did: result.data.did,
    handle: result.data.handle,
  };
}

/**
 * Login with identifier (handle or email) and password
 */
export async function login(identifier: string, password: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.login({ identifier, password });
}

/**
 * Logout and clear session
 */
export async function logout(): Promise<void> {
  const bskyAgent = getAgent();
  // BskyAgent doesn't have a logout method, just clear session
  agent = null;
  await clearSession();
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  const bskyAgent = getAgent();
  return !!bskyAgent.session;
}

/**
 * Get current session
 */
export function getSession() {
  const bskyAgent = getAgent();
  return bskyAgent.session;
}

/**
 * Refresh the current session
 * This will use the refresh token to get a new access token
 * Should be called before making API calls after a period of inactivity
 */
export async function refreshSession(): Promise<void> {
  const bskyAgent = getAgent();
  
  // If no session, nothing to refresh
  if (!bskyAgent.session) {
    console.log('[Agent] No session to refresh');
    return;
  }
  
  try {
    // BskyAgent.resumeSession will automatically refresh if needed
    await bskyAgent.resumeSession(bskyAgent.session);
    console.log('[Agent] Session refreshed successfully');
  } catch (err: any) {
    console.error('[Agent] Failed to refresh session:', err);
    
    // Check if this is an auth error that means we need to re-login
    if (isAuthError(err)) {
      await handleAuthError();
    }
    
    throw err;
  }
}

/**
 * Create a new post
 */
export async function createPost(text: string, opts?: {
  reply?: {
    parent: { uri: string; cid: string };
    root: { uri: string; cid: string };
  };
  embed?: any;
  langs?: string[];
}): Promise<{ uri: string; cid: string }> {
  const bskyAgent = getAgent();
  
  // Parse facets (mentions, links, hashtags)
  const rt = new RichText({ text });
  await rt.detectFacets(bskyAgent);
  
  const record: any = {
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
    langs: opts?.langs || ['en'],
  };
  
  if (opts?.reply) {
    record.reply = opts.reply;
  }
  
  if (opts?.embed) {
    record.embed = opts.embed;
  }
  
  const result = await bskyAgent.post(record);
  return result;
}

/**
 * Delete a post
 */
export async function deletePost(uri: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.deletePost(uri);
}

/**
 * Like a post
 */
export async function likePost(uri: string, cid: string): Promise<{ uri: string }> {
  const bskyAgent = getAgent();
  return bskyAgent.like(uri, cid);
}

/**
 * Unlike a post
 */
export async function unlikePost(likeUri: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.deleteLike(likeUri);
}

/**
 * Repost a post
 */
export async function repost(uri: string, cid: string): Promise<{ uri: string }> {
  const bskyAgent = getAgent();
  return bskyAgent.repost(uri, cid);
}

/**
 * Delete a repost
 */
export async function deleteRepost(repostUri: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.deleteRepost(repostUri);
}

/**
 * Follow a user
 */
export async function follow(did: string): Promise<{ uri: string }> {
  const bskyAgent = getAgent();
  return bskyAgent.follow(did);
}

/**
 * Unfollow a user
 */
export async function unfollow(followUri: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.deleteFollow(followUri);
}

/**
 * Get timeline feed
 */
export async function getTimeline(cursor?: string, limit = 50) {
  const bskyAgent = getAgent();
  const start = performance.now();
  const result = await bskyAgent.getTimeline({ cursor, limit });
  logger.network.requestSuccess('getTimeline', Math.round(performance.now() - start));
  return result;
}

/**
 * Get author's feed with optional filter
 * filter options: 'posts_with_replies', 'posts_no_replies', 'posts_with_media', 'posts_and_author_threads'
 */
export async function getAuthorFeed(
  actor: string, 
  cursor?: string, 
  limit = 50,
  filter?: 'posts_with_replies' | 'posts_no_replies' | 'posts_with_media' | 'posts_and_author_threads'
) {
  const bskyAgent = getAgent();
  const start = performance.now();
  const result = await bskyAgent.getAuthorFeed({ actor, cursor, limit, filter });
  logger.network.requestSuccess('getAuthorFeed', Math.round(performance.now() - start));
  return result;
}

/**
 * Get actor's likes
 */
export async function getActorLikes(actor: string, cursor?: string, limit = 50) {
  const bskyAgent = getAgent();
  return bskyAgent.app.bsky.feed.getActorLikes({ actor, cursor, limit });
}

/**
 * Get a single post thread
 */
export async function getPostThread(uri: string, depth = 6, parentHeight = 80) {
  const bskyAgent = getAgent();
  const start = performance.now();
  const result = await bskyAgent.getPostThread({ uri, depth, parentHeight });
  logger.network.requestSuccess('getPostThread', Math.round(performance.now() - start));
  return result;
}

/**
 * Get profile
 */
export async function getProfile(actor: string) {
  const bskyAgent = getAgent();
  const start = performance.now();
  const result = await bskyAgent.getProfile({ actor });
  logger.network.requestSuccess('getProfile', Math.round(performance.now() - start));
  return result;
}

/**
 * Update profile
 * Note: upsertProfile may log a 400 error if profile record doesn't exist yet - this is normal
 * and the profile will be created successfully anyway.
 */
export async function updateProfile(update: {
  displayName?: string;
  description?: string;
  avatar?: any;
  banner?: any;
}) {
  const bskyAgent = getAgent();
  
  // upsertProfile internally tries to get the existing profile first,
  // which may fail with 400 if no profile exists yet. This is expected behavior.
  // Only include fields that are explicitly set (not undefined) to avoid overwriting
  return bskyAgent.upsertProfile((existing) => {
    const result = { ...existing };
    
    // Only update fields that are explicitly provided
    if (update.displayName !== undefined) result.displayName = update.displayName;
    if (update.description !== undefined) result.description = update.description;
    if (update.avatar !== undefined) result.avatar = update.avatar;
    if (update.banner !== undefined) result.banner = update.banner;
    
    return result;
  });
}

/**
 * Get suggested users to follow
 */
export async function getSuggestions(cursor?: string, limit = 10) {
  const bskyAgent = getAgent();
  return bskyAgent.app.bsky.actor.getSuggestions({ cursor, limit });
}

/**
 * List all repos (users) on Cannect PDS
 */
export async function listPdsRepos(limit = 100): Promise<string[]> {
  try {
    const response = await fetch(`${PDS_SERVICE}/xrpc/com.atproto.sync.listRepos?limit=${limit}`);
    if (!response.ok) {
      console.error('[listPdsRepos] Failed:', response.status, response.statusText);
      return [];
    }
    const data = await response.json();
    return data.repos?.map((repo: { did: string }) => repo.did) || [];
  } catch (error) {
    console.error('[listPdsRepos] Error:', error);
    return [];
  }
}

/**
 * Get profiles for multiple DIDs
 * Falls back to individual getProfile calls if batch fails
 */
export async function getProfiles(dids: string[]) {
  const bskyAgent = getAgent();
  // API limit is 25 actors at a time
  const chunks = [];
  for (let i = 0; i < dids.length; i += 25) {
    chunks.push(dids.slice(i, i + 25));
  }
  
  try {
    const results = await Promise.all(
      chunks.map(chunk => bskyAgent.getProfiles({ actors: chunk }))
    );
    
    const profiles = results.flatMap(r => r.data.profiles);
    console.log('[getProfiles] Got', profiles.length, 'profiles from batch');
    return profiles;
  } catch (error) {
    console.error('[getProfiles] Batch failed, trying individual:', error);
    // Fallback: fetch profiles individually
    const profiles = [];
    for (const did of dids) {
      try {
        const result = await bskyAgent.getProfile({ actor: did });
        if (result.data) {
          profiles.push(result.data);
        }
      } catch (e) {
        // Skip failed profiles
        console.log('[getProfiles] Failed for', did);
      }
    }
    console.log('[getProfiles] Got', profiles.length, 'profiles from fallback');
    return profiles;
  }
}

/**
 * Get all Cannect users directly from PDS
 */
export async function getCannectUsers(limit = 50) {
  const dids = await listPdsRepos(limit);
  if (dids.length === 0) return [];
  return getProfiles(dids);
}

/**
 * Search actors
 */
export async function searchActors(query: string, cursor?: string, limit = 25) {
  const bskyAgent = getAgent();
  return bskyAgent.searchActors({ q: query, cursor, limit });
}

/**
 * Search posts
 */
export async function searchPosts(query: string, cursor?: string, limit = 25) {
  const bskyAgent = getAgent();
  return bskyAgent.app.bsky.feed.searchPosts({ q: query, cursor, limit });
}

/**
 * Get posts from an external feed generator
 * @param feedUri - The AT URI of the feed generator (e.g., at://did:plc:.../app.bsky.feed.generator/feedname)
 */
export async function getExternalFeed(feedUri: string, cursor?: string, limit = 30) {
  const bskyAgent = getAgent();
  const result = await bskyAgent.app.bsky.feed.getFeed({
    feed: feedUri,
    cursor,
    limit,
  });
  return result;
}

/**
 * Get recent posts from Cannect users
 * Fetches posts directly from a sample of active users on the PDS
 */
export async function getCannectPosts(limit = 30) {
  const dids = await listPdsRepos(50);
  if (dids.length === 0) return [];
  
  const bskyAgent = getAgent();
  
  // Get recent posts from up to 10 random users
  const shuffled = dids.sort(() => Math.random() - 0.5).slice(0, 10);
  
  const results = await Promise.all(
    shuffled.map(async (did) => {
      try {
        const feed = await bskyAgent.getAuthorFeed({ 
          actor: did, 
          limit: 5,
          filter: 'posts_no_replies'
        });
        return feed.data.feed.map(item => item.post);
      } catch {
        return [];
      }
    })
  );
  
  // Flatten and sort by createdAt (when user posted)
  const allPosts = results.flat();
  const sorted = allPosts.sort((a, b) => {
    const aDate = (a.record as any)?.createdAt || a.indexedAt;
    const bDate = (b.record as any)?.createdAt || b.indexedAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });
  
  return sorted.slice(0, limit);
}

/**
 * Get notifications
 */
export async function getNotifications(cursor?: string, limit = 50) {
  const bskyAgent = getAgent();
  return bskyAgent.listNotifications({ cursor, limit });
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(seenAt?: string) {
  const bskyAgent = getAgent();
  const dateStr = seenAt || new Date().toISOString();
  return bskyAgent.updateSeenNotifications(dateStr as `${string}-${string}-${string}T${string}:${string}:${string}Z`);
}

/**
 * Upload a blob (image/video)
 */
export async function uploadBlob(data: Uint8Array, mimeType: string) {
  const bskyAgent = getAgent();
  return bskyAgent.uploadBlob(data, { encoding: mimeType });
}

/**
 * Get followers
 */
export async function getFollowers(actor: string, cursor?: string, limit = 50) {
  const bskyAgent = getAgent();
  return bskyAgent.getFollowers({ actor, cursor, limit });
}

/**
 * Get following
 */
export async function getFollows(actor: string, cursor?: string, limit = 50) {
  const bskyAgent = getAgent();
  return bskyAgent.getFollows({ actor, cursor, limit });
}

/**
 * Get unread notification count
 */
export async function getUnreadCount() {
  const bskyAgent = getAgent();
  return bskyAgent.countUnreadNotifications();
}

/**
 * Cannect Feed Generator URI
 * This is the official Cannect cannabis feed hosted at feed.cannect.space
 * Only accessible to *.cannect.space users
 */
const CANNECT_FEED_URI = 'at://did:plc:ubkp6dfvxif7rmexyat5np6e/app.bsky.feed.generator/cannect';
const CANNECT_FOLLOWING_URI = 'at://did:plc:ubkp6dfvxif7rmexyat5np6e/app.bsky.feed.generator/following';

/**
 * Get the Cannect feed from our feed generator
 * 
 * Uses the Cannect Feed Generator at feed.cannect.space which:
 * - Indexes cannabis-related posts from the entire AT Protocol network
 * - Only accessible to cannect.space users
 */
export async function getCannectFeed(cursor?: string, limit = 30) {
  const bskyAgent = getAgent();
  
  try {
    // Use the official AT Protocol getFeed endpoint with our feed generator
    const result = await bskyAgent.app.bsky.feed.getFeed({
      feed: CANNECT_FEED_URI,
      cursor,
      limit,
    });
    
    return {
      data: {
        feed: result.data.feed,
        cursor: result.data.cursor,
      }
    };
  } catch (error: any) {
    console.error('[Cannect Feed] Failed to load feed:', error?.message || error);
    // Return empty feed on error
    return {
      data: {
        feed: [],
        cursor: undefined,
      }
    };
  }
}

/**
 * Get the Cannect Following feed from our feed generator
 * 
 * Shows posts from our database, filtered to only users you follow.
 * Includes migrated posts that Bluesky's timeline doesn't have.
 */
export async function getCannectFollowingFeed(cursor?: string, limit = 30) {
  const bskyAgent = getAgent();
  
  try {
    const result = await bskyAgent.app.bsky.feed.getFeed({
      feed: CANNECT_FOLLOWING_URI,
      cursor,
      limit,
    });
    
    return {
      data: {
        feed: result.data.feed,
        cursor: result.data.cursor,
      }
    };
  } catch (error: any) {
    console.error('[Cannect Following] Failed to load feed:', error?.message || error);
    return {
      data: {
        feed: [],
        cursor: undefined,
      }
    };
  }
}

/**
 * Request password reset - sends email with reset token
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.com.atproto.server.requestPasswordReset({ email });
}

/**
 * Reset password using token from email
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const bskyAgent = getAgent();
  await bskyAgent.com.atproto.server.resetPassword({ token, password });
}

/**
 * Report content to AT Protocol moderation service
 * This sends a report to Bluesky's moderation team
 */
export type ReportReason = 
  | 'spam'
  | 'violation' 
  | 'misleading'
  | 'sexual'
  | 'rude'
  | 'other';

export async function reportPost(
  postUri: string, 
  postCid: string, 
  reason: ReportReason,
  additionalInfo?: string
): Promise<void> {
  const bskyAgent = getAgent();
  
  // Map our simple reasons to AT Protocol reason types
  const reasonTypeMap: Record<ReportReason, string> = {
    spam: 'com.atproto.moderation.defs#reasonSpam',
    violation: 'com.atproto.moderation.defs#reasonViolation',
    misleading: 'com.atproto.moderation.defs#reasonMisleading',
    sexual: 'com.atproto.moderation.defs#reasonSexual',
    rude: 'com.atproto.moderation.defs#reasonRude',
    other: 'com.atproto.moderation.defs#reasonOther',
  };

  await bskyAgent.com.atproto.moderation.createReport({
    reasonType: reasonTypeMap[reason],
    reason: additionalInfo,
    subject: {
      $type: 'com.atproto.repo.strongRef',
      uri: postUri,
      cid: postCid,
    },
  });
}

/**
 * Report an account to AT Protocol moderation service
 */
export async function reportAccount(
  did: string,
  reason: ReportReason,
  additionalInfo?: string
): Promise<void> {
  const bskyAgent = getAgent();
  
  const reasonTypeMap: Record<ReportReason, string> = {
    spam: 'com.atproto.moderation.defs#reasonSpam',
    violation: 'com.atproto.moderation.defs#reasonViolation',
    misleading: 'com.atproto.moderation.defs#reasonMisleading',
    sexual: 'com.atproto.moderation.defs#reasonSexual',
    rude: 'com.atproto.moderation.defs#reasonRude',
    other: 'com.atproto.moderation.defs#reasonOther',
  };

  await bskyAgent.com.atproto.moderation.createReport({
    reasonType: reasonTypeMap[reason],
    reason: additionalInfo,
    subject: {
      $type: 'com.atproto.admin.defs#repoRef',
      did: did,
    },
  });
}

export { RichText };
