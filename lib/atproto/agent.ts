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

// Storage keys
const SESSION_KEY = 'atproto_session';

// Cannect's own PDS
const PDS_SERVICE = 'https://cannect.space';

// Bluesky AppView for content hydration
const _BSKY_APPVIEW = 'https://public.api.bsky.app';

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

  sessionExpiredListeners.forEach((handler) => {
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
  const errorMessage =
    typeof error === 'string' ? error : error?.message || error?.data?.message || '';

  // Log the error being checked
  console.log('[Agent] isAuthError checking:', {
    status,
    errorCode,
    errorMessage: errorMessage.substring(0, 100),
  });

  // 401 Unauthorized is always an auth error
  if (status === 401) {
    console.log('[Agent] 🔴 401 Unauthorized detected');
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
      'session expired', // More specific than just 'session'
      'invalid session', // More specific than just 'session'
      'session not found', // More specific than just 'session'
    ];

    const textToCheck = `${errorCode || ''} ${errorMessage || ''}`.toLowerCase();
    const matchedPattern = authPatterns.find((p) => textToCheck.includes(p.toLowerCase()));

    if (matchedPattern) {
      console.log('[Agent] 🔴 400 with auth pattern detected:', {
        pattern: matchedPattern,
        text: textToCheck.substring(0, 100),
      });
      return true;
    }

    console.log('[Agent] 400 error but no auth pattern match:', textToCheck.substring(0, 100));
  }

  return false;
}

/**
 * Handle an auth error by clearing session and notifying listeners
 */
export async function handleAuthError(): Promise<void> {
  console.warn('[Agent] 🔴 handleAuthError called - clearing session');
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
        console.log(
          '[Agent] persistSession event:',
          evt,
          sess?.did ? `did:${sess.did.substring(8, 20)}` : 'no session'
        );

        if (evt === 'expired') {
          // Refresh token expired - user must re-login
          console.warn('[Agent] 🔴 Session EXPIRED - user must re-login');
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
  console.log(
    '[Agent] initializeAgent - stored session:',
    storedSession ? `did:${storedSession.did?.substring(8, 20)}` : 'none'
  );

  if (storedSession) {
    try {
      console.log('[Agent] Attempting to resume session...');
      await bskyAgent.resumeSession(storedSession);
      console.log('[Agent] ✅ Session resumed successfully');
    } catch (err: any) {
      console.warn('[Agent] ❌ Failed to restore session:', err?.message || err);
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
  const fullHandle = opts.handle.includes('.') ? opts.handle : `${opts.handle}.cannect.space`;

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
  const _bskyAgent = getAgent();
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
export async function createPost(
  text: string,
  opts?: {
    reply?: {
      parent: { uri: string; cid: string };
      root: { uri: string; cid: string };
    };
    embed?: any;
    langs?: string[];
  }
): Promise<{ uri: string; cid: string }> {
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

  // Notify feed generator to include this post immediately
  notifyFeedGenerator(result.uri, result.cid, bskyAgent.session?.did || '');

  return result;
}

/**
 * Notify the Cannect feed generator about a new post
 * This allows the post to appear immediately in the feed without waiting for Jetstream
 * Includes retry logic with exponential backoff (3 attempts)
 */
async function notifyFeedGenerator(uri: string, cid: string, authorDid: string): Promise<void> {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000; // 1 second

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch('https://feed.cannect.space/api/notify-post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uri, cid, authorDid }),
      });

      if (response.ok) {
        console.log('[Feed] Post notified to feed generator');
        return; // Success - exit
      } else {
        const error = await response.json().catch(() => ({}));
        console.warn(`[Feed] Attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      }
    } catch (err) {
      console.warn(`[Feed] Attempt ${attempt}/${MAX_RETRIES} error:`, err);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s)
    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.warn('[Feed] All retry attempts failed for notifyFeedGenerator');
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
  const result = await bskyAgent.getTimeline({ cursor, limit });
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
  filter?:
    | 'posts_with_replies'
    | 'posts_no_replies'
    | 'posts_with_media'
    | 'posts_and_author_threads'
) {
  const bskyAgent = getAgent();
  const result = await bskyAgent.getAuthorFeed({ actor, cursor, limit, filter });
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
  const result = await bskyAgent.getPostThread({ uri, depth, parentHeight });
  return result;
}

/**
 * Get a single post (minimal thread fetch for quote preview)
 */
export async function getPost(uri: string) {
  const bskyAgent = getAgent();
  const result = await bskyAgent.getPostThread({ uri, depth: 0, parentHeight: 0 });
  return { data: { thread: result.data.thread } };
}

/**
 * Get multiple posts by URI (with authenticated viewer state)
 * Max 25 URIs per request per Bluesky API limits
 */
export async function getPosts(uris: string[]) {
  const bskyAgent = getAgent();
  // Bluesky limits to 25 posts per request
  const limitedUris = uris.slice(0, 25);
  const result = await bskyAgent.getPosts({ uris: limitedUris });
  return result;
}

/**
 * Check if a handle belongs to a Cannect PDS user
 * Only returns true for .cannect.space handles to avoid unnecessary PDS requests
 */
function isCannectUser(handle: string): boolean {
  // Only check for .cannect.space handles
  // DIDs alone are not enough - we need the handle to determine PDS
  return handle.includes('.cannect.space');
}

/**
 * Fetch profile record directly from PDS for Cannect users
 * This ensures users see their own profile updates immediately
 * even if the Bluesky relay hasn't synced yet
 */
async function getProfileFromPds(did: string): Promise<{
  displayName?: string;
  description?: string;
  avatar?: { ref: { $link: string }; mimeType: string };
  banner?: { ref: { $link: string }; mimeType: string };
} | null> {
  try {
    const response = await fetch(
      `${PDS_SERVICE}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`
    );
    
    if (!response.ok) {
      // User might not have a profile record yet, or not on this PDS
      return null;
    }
    
    const data = await response.json();
    return data.value || null;
  } catch (error) {
    console.log('[getProfileFromPds] Failed to fetch from PDS:', error);
    return null;
  }
}

/**
 * Get profile
 * For Cannect users, merges profile data from PDS to ensure
 * users see their own updates immediately (Read Your Own Writes pattern)
 */
export async function getProfile(actor: string) {
  const bskyAgent = getAgent();
  const result = await bskyAgent.getProfile({ actor });
  
  // Check if this is a Cannect user based on handle (from input or result)
  const handle = result.data.handle || actor;
  if (isCannectUser(handle)) {
    const did = result.data.did;
    const pdsProfile = await getProfileFromPds(did);
    
    if (pdsProfile) {
      // Merge PDS data into the result, preferring PDS values for profile fields
      // This ensures displayName/description from PDS override stale AppView data
      if (pdsProfile.displayName !== undefined) {
        result.data.displayName = pdsProfile.displayName;
      }
      if (pdsProfile.description !== undefined) {
        result.data.description = pdsProfile.description;
      }
      // For avatar/banner, construct the blob URL from PDS
      if (pdsProfile.avatar?.ref?.$link) {
        result.data.avatar = `${PDS_SERVICE}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${pdsProfile.avatar.ref.$link}`;
      }
      if (pdsProfile.banner?.ref?.$link) {
        result.data.banner = `${PDS_SERVICE}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${pdsProfile.banner.ref.$link}`;
      }
      console.log('[getProfile] Merged PDS data for Cannect user:', did.substring(0, 20));
    }
  }
  
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
 * Applies Read Your Own Writes pattern for Cannect users
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
      chunks.map((chunk) => bskyAgent.getProfiles({ actors: chunk }))
    );

    const profiles = results.flatMap((r) => r.data.profiles);
    console.log('[getProfiles] Got', profiles.length, 'profiles from batch');
    
    // Apply Read Your Own Writes pattern for Cannect users
    const enhancedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        // Only fetch from PDS if:
        // 1. User has a .cannect.space handle (confirmed Cannect user)
        // 2. Profile has an avatar/banner already (likely has profile record)
        // Skip users without handles or avatars - they likely haven't set up profiles yet
        if (profile.handle && isCannectUser(profile.handle) && (profile.avatar || profile.banner || profile.displayName)) {
          const pdsProfile = await getProfileFromPds(profile.did);
          if (pdsProfile) {
            // Merge PDS data
            if (pdsProfile.displayName !== undefined) {
              profile.displayName = pdsProfile.displayName;
            }
            if (pdsProfile.description !== undefined) {
              profile.description = pdsProfile.description;
            }
            if (pdsProfile.avatar?.ref?.$link) {
              profile.avatar = `${PDS_SERVICE}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(profile.did)}&cid=${pdsProfile.avatar.ref.$link}`;
            }
            if (pdsProfile.banner?.ref?.$link) {
              profile.banner = `${PDS_SERVICE}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(profile.did)}&cid=${pdsProfile.banner.ref.$link}`;
            }
          }
        }
        return profile;
      })
    );
    
    return enhancedProfiles;
  } catch (error) {
    console.error('[getProfiles] Batch failed, trying individual:', error);
    // Fallback: fetch profiles individually using our enhanced getProfile
    const profiles = [];
    for (const did of dids) {
      try {
        const result = await getProfile(did);
        if (result.data) {
          profiles.push(result.data);
        }
      } catch {
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
 * Search actors typeahead for @mention autocomplete
 * This is optimized for real-time typing suggestions
 * Does NOT require authentication
 */
export async function searchActorsTypeahead(query: string, limit = 8) {
  const bskyAgent = getAgent();
  return bskyAgent.app.bsky.actor.searchActorsTypeahead({ q: query, limit });
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
          filter: 'posts_no_replies',
        });
        return feed.data.feed.map((item) => item.post);
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
  return bskyAgent.updateSeenNotifications(
    dateStr as `${string}-${string}-${string}T${string}:${string}:${string}Z`
  );
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
 *
 * Our custom feed generator at feed.cannect.space
 * Includes: cannect.space users + cannabis keyword matches
 */
const CANNECT_FEED_URI = 'at://did:plc:akbqlqbx6afvzcd5eygtrgl5/app.bsky.feed.generator/cannect';

/**
 * Get the Cannect feed from our Feed Generator
 *
 * Uses feed.cannect.space which indexes:
 * - All posts from cannect.space users
 * - Posts with cannabis keywords from anywhere on Bluesky
 *
 * Returns proper viewer state via Bluesky's hydration
 */
export async function getCannectFeed(cursor?: string, limit = 50) {
  const bskyAgent = getAgent();

  try {
    const result = await bskyAgent.app.bsky.feed.getFeed({
      feed: CANNECT_FEED_URI,
      cursor,
      limit,
    });

    return {
      data: {
        feed: result.data.feed,
        cursor: result.data.cursor,
      },
    };
  } catch (error: any) {
    console.error('[Cannect Feed] Failed to load feed:', error?.message || error);
    return {
      data: {
        feed: [],
        cursor: undefined,
      },
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
export type ReportReason = 'spam' | 'violation' | 'misleading' | 'sexual' | 'rude' | 'other';

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

// ============================================================
// VIDEO UPLOAD WITH JOB STATUS POLLING
// ============================================================

const VIDEO_SERVICE = 'https://video.bsky.app';

export interface VideoJobStatus {
  jobId: string;
  did: string;
  state: 'JOB_STATE_COMPLETED' | 'JOB_STATE_FAILED' | string;
  progress?: number;
  blob?: any;
  error?: string;
  message?: string;
}

/**
 * Get a service auth token for video upload
 * This is required because video uploads go to a separate service
 */
async function getServiceAuthToken(lxm: string): Promise<string> {
  const bskyAgent = getAgent();
  const session = bskyAgent.session;
  
  if (!session) {
    throw new Error('Not authenticated');
  }

  // Get the service auth token from the PDS
  const response = await bskyAgent.com.atproto.server.getServiceAuth({
    aud: `did:web:${new URL(VIDEO_SERVICE).hostname}`,
    lxm,
    exp: Math.floor(Date.now() / 1000) + 60 * 30, // 30 minutes
  });

  return response.data.token;
}

/**
 * Generate a unique ID for the video filename
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Upload a video using the proper video upload endpoint
 * Returns a job ID that can be polled for completion
 */
export async function uploadVideo(
  data: Uint8Array,
  mimeType: string = 'video/mp4',
  onProgress?: (progress: number) => void
): Promise<VideoJobStatus> {
  const bskyAgent = getAgent();
  const session = bskyAgent.session;
  
  if (!session) {
    throw new Error('Not authenticated');
  }

  // Get service auth token
  console.log('[Video] Getting service auth token...');
  const token = await getServiceAuthToken('com.atproto.repo.uploadBlob');

  // Determine file extension from mime type
  const ext = mimeType === 'video/quicktime' ? 'mov' : 
              mimeType === 'video/webm' ? 'webm' : 'mp4';

  // Build upload URL with required params
  const uploadUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
  uploadUrl.searchParams.set('did', session.did);
  uploadUrl.searchParams.set('name', `${generateId()}.${ext}`);

  console.log('[Video] Uploading to:', uploadUrl.toString());

  // Upload using XMLHttpRequest for progress tracking on web
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = e.loaded / e.total;
        onProgress?.(progress);
        console.log('[Video] Upload progress:', Math.round(progress * 100) + '%');
      }
    });

    xhr.onloadend = () => {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log('[Video] Upload response:', response);
            if (response.jobId) {
              resolve(response as VideoJobStatus);
            } else if (response.jobStatus) {
              resolve(response.jobStatus as VideoJobStatus);
            } else {
              reject(new Error(response.error || response.message || 'Upload failed - no job ID'));
            }
          } catch (e) {
            reject(new Error('Failed to parse upload response'));
          }
        } else {
          console.error('[Video] Upload failed:', xhr.status, xhr.responseText);
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.message || error.error || `Upload failed: ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        }
      }
    };

    xhr.onerror = () => {
      console.error('[Video] XHR error');
      reject(new Error('Network error during upload'));
    };

    xhr.open('POST', uploadUrl.toString());
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(data);
  });
}

/**
 * Get the current status of a video processing job
 */
export async function getVideoJobStatus(jobId: string): Promise<VideoJobStatus> {
  const bskyAgent = getAgent();
  const session = bskyAgent.session;

  if (!session) {
    throw new Error('Not authenticated');
  }

  // Get service auth token for job status check
  const token = await getServiceAuthToken('app.bsky.video.getJobStatus');

  const response = await fetch(
    `${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get job status: ${response.status}`);
  }

  const result = await response.json();
  return result.jobStatus as VideoJobStatus;
}

/**
 * Upload video and wait for processing to complete
 * Polls the job status until the video is ready
 */
export async function uploadVideoAndWait(
  data: Uint8Array,
  mimeType: string = 'video/mp4',
  onProgress?: (stage: 'uploading' | 'processing', progress: number) => void,
  maxWaitMs: number = 120000 // 2 minutes max
): Promise<{ blob: any }> {
  // Start the upload
  onProgress?.('uploading', 0);
  const job = await uploadVideo(data, mimeType, (p) => onProgress?.('uploading', p * 100));
  onProgress?.('uploading', 100);

  console.log('[Video] Processing started, jobId:', job.jobId);

  // Poll for completion
  const startTime = Date.now();
  const pollInterval = 1500; // 1.5 seconds between polls

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const status = await getVideoJobStatus(job.jobId);
    console.log('[Video] Job status:', status.state, 'progress:', status.progress);

    onProgress?.('processing', status.progress || 0);

    if (status.state === 'JOB_STATE_COMPLETED') {
      if (!status.blob) {
        throw new Error('Video processing completed but no blob returned');
      }
      console.log('[Video] Processing complete!');
      return { blob: status.blob };
    }

    if (status.state === 'JOB_STATE_FAILED') {
      throw new Error(status.error || status.message || 'Video processing failed');
    }
  }

  throw new Error('Video processing timed out');
}

export { RichText };
