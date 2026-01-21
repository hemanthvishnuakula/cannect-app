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

// Cannect's PDS endpoints
const PDS_SERVICE_LEGACY = 'https://cannect.space';
const PDS_SERVICE = 'https://pds.cannect.space';

// Bluesky AppView for content hydration
const _BSKY_APPVIEW = 'https://public.api.bsky.app';

/**
 * Resolve a user's PDS endpoint from their handle or DID
 * This is needed for users who have migrated between PDS instances
 */
async function resolvePdsEndpoint(identifier: string): Promise<string> {
  try {
    // If it's an email, we can't resolve - try legacy PDS first (most existing users are there)
    if (identifier.includes('@') && !identifier.includes('.cannect.space')) {
      return PDS_SERVICE_LEGACY;
    }

    // Determine which PDS to query based on handle suffix
    if (identifier.endsWith('.pds.cannect.space')) {
      return PDS_SERVICE;
    }

    // For handles like user.cannect.space or DIDs, resolve via PLC directory
    let did = identifier;
    if (!identifier.startsWith('did:')) {
      // Resolve handle to DID first
      const handle = identifier.includes('.') ? identifier : `${identifier}.cannect.space`;
      try {
        const resolveResp = await fetch(
          `https://plc.directory/${encodeURIComponent(handle)}/.well-known/atproto-did`
        );
        if (!resolveResp.ok) {
          // Try resolving via the PDS
          const pdsResolve = await fetch(
            `${PDS_SERVICE_LEGACY}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
          );
          if (pdsResolve.ok) {
            const data = await pdsResolve.json();
            did = data.did;
          } else {
            // Try new PDS
            const newPdsResolve = await fetch(
              `${PDS_SERVICE}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
            );
            if (newPdsResolve.ok) {
              const data = await newPdsResolve.json();
              did = data.did;
            } else {
              return PDS_SERVICE; // Default
            }
          }
        }
      } catch {
        return PDS_SERVICE; // Default on error
      }
    }

    // Now resolve DID to get PDS endpoint
    if (did.startsWith('did:plc:')) {
      const plcResp = await fetch(`https://plc.directory/${did}`);
      if (plcResp.ok) {
        const plcDoc = await plcResp.json();
        const pdsService = plcDoc.service?.find((s: any) => s.id === '#atproto_pds');
        if (pdsService?.serviceEndpoint) {
          console.log('[Agent] Resolved PDS endpoint:', pdsService.serviceEndpoint);
          return pdsService.serviceEndpoint;
        }
      }
    }
  } catch (err) {
    console.warn('[Agent] Failed to resolve PDS endpoint:', err);
  }

  return PDS_SERVICE_LEGACY; // Default to legacy PDS for existing users
}

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
  const storedSession = await getStoredSession();
  console.log(
    '[Agent] initializeAgent - stored session:',
    storedSession ? `did:${storedSession.did?.substring(8, 20)}` : 'none',
    storedSession?.pdsEndpoint ? `pds:${storedSession.pdsEndpoint}` : ''
  );

  // If we have a stored session with a PDS endpoint, use that
  if (storedSession?.pdsEndpoint && storedSession.pdsEndpoint !== PDS_SERVICE) {
    console.log('[Agent] Using stored PDS endpoint:', storedSession.pdsEndpoint);
    agent = new BskyAgent({
      service: storedSession.pdsEndpoint,
      persistSession: (evt, sess) => {
        console.log('[Agent] persistSession event:', evt);
        if (evt === 'expired') {
          clearSession();
          notifySessionExpired();
        } else if (sess) {
          storeSession({ ...sess, pdsEndpoint: storedSession.pdsEndpoint });
        } else {
          clearSession();
        }
      },
    });
  }

  const bskyAgent = getAgent();

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
  displayName?: string;
  inviteCode?: string;
}): Promise<{ did: string; handle: string }> {
  const bskyAgent = getAgent();

  // Handle should be username.pds.cannect.space for our PDS
  const fullHandle = opts.handle.includes('.') ? opts.handle : `${opts.handle}.pds.cannect.space`;

  const result = await bskyAgent.createAccount({
    email: opts.email,
    password: opts.password,
    handle: fullHandle,
    inviteCode: opts.inviteCode,
  });

  // Create initial profile record so AppView can properly index the user
  // Without this, users won't appear in feeds and searches
  const displayName = opts.displayName || opts.handle;
  try {
    await bskyAgent.upsertProfile((existing) => ({
      ...existing,
      displayName,
    }));
    console.log('[Agent] Created initial profile record with displayName:', displayName);
  } catch (profileError) {
    // Log but don't fail registration if profile creation fails
    console.warn('[Agent] Failed to create initial profile:', profileError);
  }

  // Auto-follow the founder so new users see Cannect content immediately
  try {
    await bskyAgent.follow(FOUNDER_DID);
    console.log('[Agent] New user auto-followed founder');
  } catch (followError) {
    // Don't fail registration if auto-follow fails
    console.warn('[Agent] Failed to auto-follow founder:', followError);
  }

  return {
    did: result.data.did,
    handle: result.data.handle,
  };
}

/**
 * Helper to create an agent for a specific PDS endpoint
 */
function createAgentForPds(pdsEndpoint: string): BskyAgent {
  return new BskyAgent({
    service: pdsEndpoint,
    persistSession: (evt, sess) => {
      console.log(
        '[Agent] persistSession event:',
        evt,
        sess?.did ? `did:${sess.did.substring(8, 20)}` : 'no session'
      );

      if (evt === 'expired') {
        console.warn('[Agent] 🔴 Session EXPIRED - user must re-login');
        clearSession();
        notifySessionExpired();
      } else if (evt === 'create' || evt === 'update') {
        console.log('[Agent] ✅ Session created/updated, storing...');
        // Store the PDS endpoint along with the session
        storeSession({ ...sess, pdsEndpoint });
      } else if (sess) {
        storeSession({ ...sess, pdsEndpoint });
      } else {
        console.log('[Agent] ⚠️ Clearing session (no session data)');
        clearSession();
      }
    },
  });
}

/**
 * Login with identifier (handle or email) and password
 * Automatically resolves the correct PDS for the user
 * For email login, tries both PDSes since we can't resolve email to PDS directly
 */
export async function login(identifier: string, password: string): Promise<void> {
  const isEmail = identifier.includes('@') && !identifier.includes('.cannect.space');

  // For email login, we need to try both PDSes since email can't be resolved
  if (isEmail) {
    console.log('[Agent] Email login detected, trying both PDSes...');

    // Try legacy PDS first (most users are there)
    try {
      console.log('[Agent] Trying legacy PDS:', PDS_SERVICE_LEGACY);
      const legacyAgent = createAgentForPds(PDS_SERVICE_LEGACY);
      await legacyAgent.login({ identifier, password });
      agent = legacyAgent;
      resetExpiryState();
      console.log('[Agent] ✅ Login successful on legacy PDS');
      return;
    } catch (legacyErr: any) {
      console.log('[Agent] Legacy PDS login failed:', legacyErr?.message || legacyErr);
      // If it's not an auth error (wrong password), don't try the other PDS
      if (legacyErr?.status === 401 && legacyErr?.message?.includes('Invalid identifier')) {
        // User doesn't exist on legacy PDS, try new PDS
        console.log('[Agent] User not found on legacy PDS, trying new PDS...');
      } else if (legacyErr?.status === 401) {
        // Wrong password - don't try other PDS, throw the error
        throw legacyErr;
      }
    }

    // Try new PDS
    try {
      console.log('[Agent] Trying new PDS:', PDS_SERVICE);
      const newAgent = createAgentForPds(PDS_SERVICE);
      await newAgent.login({ identifier, password });
      agent = newAgent;
      resetExpiryState();
      console.log('[Agent] ✅ Login successful on new PDS');
      return;
    } catch (newErr: any) {
      console.log('[Agent] New PDS login failed:', newErr?.message || newErr);
      // Throw the last error
      throw newErr;
    }
  }

  // For handle/DID login, resolve the PDS first
  const pdsEndpoint = await resolvePdsEndpoint(identifier);
  console.log('[Agent] Login - resolved PDS:', pdsEndpoint, 'for identifier:', identifier);

  // If the user is on a different PDS than current agent, recreate agent
  if (agent && (agent as any).service?.toString() !== pdsEndpoint) {
    console.log('[Agent] Switching PDS from', (agent as any).service, 'to', pdsEndpoint);
    agent = null;
  }

  // Create agent for the correct PDS
  if (!agent) {
    agent = createAgentForPds(pdsEndpoint);
  }

  await agent.login({ identifier, password });
  resetExpiryState();
}

/**
 * Logout and clear session
 */
export async function logout(): Promise<void> {
  const _bskyAgent = getAgent();
  // BskyAgent doesn't have a logout method, just clear session
  agent = null;
  await clearSession();
  // Reset founder follow check so next login will re-check
  hasCheckedFounderFollow = false;
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

// Track if we've already checked founder follow status this session
let hasCheckedFounderFollow = false;

/**
 * Founder DID - auto-follow on signup and session restore
 */
export const FOUNDER_DID = 'did:plc:75x5kjjh32aunyomuh33nuh7'; // hemanthvishnuakula.cannect.space

/**
 * Ensure the current user follows the founder
 * Called on app startup for existing users to gradually get all users following
 * Runs silently in the background - failures are logged but don't affect the user
 */
export async function ensureFollowingFounder(): Promise<void> {
  console.log('[Agent] 🔍 ensureFollowingFounder called, hasChecked:', hasCheckedFounderFollow);

  // Only check once per session to avoid spamming the API
  if (hasCheckedFounderFollow) {
    console.log('[Agent] Already checked this session, skipping');
    return;
  }
  hasCheckedFounderFollow = true;

  const bskyAgent = getAgent();

  // Must have a session
  if (!bskyAgent.session?.did) {
    console.log('[Agent] No session, skipping founder follow check');
    return;
  }

  console.log(
    '[Agent] Checking if user',
    bskyAgent.session.did.substring(0, 20),
    'follows founder'
  );

  // Don't follow yourself
  if (bskyAgent.session.did === FOUNDER_DID) {
    console.log('[Agent] User is founder, skipping self-follow');
    return;
  }

  try {
    // Check if already following the founder
    console.log('[Agent] Fetching founder profile to check follow status...');
    const profile = await bskyAgent.getProfile({ actor: FOUNDER_DID });
    console.log(
      '[Agent] Founder profile fetched, viewer.following:',
      profile.data.viewer?.following
    );

    if (profile.data.viewer?.following) {
      console.log('[Agent] User already follows founder');
      return;
    }

    // Not following - auto-follow
    console.log('[Agent] User does NOT follow founder, auto-following...');
    await bskyAgent.follow(FOUNDER_DID);
    console.log('[Agent] ✅ Existing user now follows founder');
  } catch (err) {
    // Silent failure - don't disrupt the user experience
    console.error('[Agent] ❌ Failed to ensure founder follow:', err);
  }
}

/**
 * Reset founder follow check (call on logout so next login re-checks)
 */
export function resetFounderFollowCheck(): void {
  hasCheckedFounderFollow = false;
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
 * Get the PDS URL for a Cannect user based on their handle
 * - user.pds.cannect.space -> https://pds.cannect.space
 * - user.cannect.space -> https://cannect.space (legacy)
 */
function getPdsUrlForHandle(handle: string): string {
  if (handle.endsWith('.pds.cannect.space')) {
    return PDS_SERVICE; // https://pds.cannect.space
  }
  return PDS_SERVICE_LEGACY; // https://cannect.space
}

/**
 * Fetch profile record directly from PDS for Cannect users
 * This ensures users see their own profile updates immediately
 * even if the Bluesky relay hasn't synced yet
 */
async function getProfileFromPds(
  did: string,
  pdsUrl: string
): Promise<{
  displayName?: string;
  description?: string;
  avatar?: { ref: { $link: string }; mimeType: string };
  banner?: { ref: { $link: string }; mimeType: string };
} | null> {
  try {
    const response = await fetch(
      `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`
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
    const pdsUrl = getPdsUrlForHandle(handle);
    const pdsProfile = await getProfileFromPds(did, pdsUrl);

    if (pdsProfile) {
      // Merge PDS data into the result, preferring PDS values for profile fields
      // This ensures displayName/description from PDS override stale AppView data
      if (pdsProfile.displayName !== undefined) {
        result.data.displayName = pdsProfile.displayName;
      }
      if (pdsProfile.description !== undefined) {
        result.data.description = pdsProfile.description;
      }
      // For avatar/banner, construct the blob URL from the correct PDS
      if (pdsProfile.avatar?.ref?.$link) {
        result.data.avatar = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${pdsProfile.avatar.ref.$link}`;
      }
      if (pdsProfile.banner?.ref?.$link) {
        result.data.banner = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${pdsProfile.banner.ref.$link}`;
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
        if (
          profile.handle &&
          isCannectUser(profile.handle) &&
          (profile.avatar || profile.banner || profile.displayName)
        ) {
          const pdsUrl = getPdsUrlForHandle(profile.handle);
          const pdsProfile = await getProfileFromPds(profile.did, pdsUrl);
          if (pdsProfile) {
            // Merge PDS data
            if (pdsProfile.displayName !== undefined) {
              profile.displayName = pdsProfile.displayName;
            }
            if (pdsProfile.description !== undefined) {
              profile.description = pdsProfile.description;
            }
            if (pdsProfile.avatar?.ref?.$link) {
              profile.avatar = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(profile.did)}&cid=${pdsProfile.avatar.ref.$link}`;
            }
            if (pdsProfile.banner?.ref?.$link) {
              profile.banner = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(profile.did)}&cid=${pdsProfile.banner.ref.$link}`;
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
 * Tries both PDS instances since we don't know which one has the account
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const endpoints = [PDS_SERVICE, PDS_SERVICE_LEGACY];
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/xrpc/com.atproto.server.requestPasswordReset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        console.log('[Agent] Password reset requested via:', endpoint);
        return; // Success - email sent
      }

      const data = await response.json().catch(() => ({}));
      // If account not found on this PDS, try next one
      if (
        data.message?.toLowerCase().includes('not found') ||
        data.message?.toLowerCase().includes('no account')
      ) {
        continue;
      }

      // Other error - throw it
      throw new Error(data.message || 'Failed to request password reset');
    } catch (err: any) {
      lastError = err;
      // Network error - try next endpoint
      continue;
    }
  }

  // If we get here, neither PDS had the account
  throw lastError || new Error('Account not found');
}

/**
 * Reset password using token from email
 * The token is tied to a specific PDS, so we try both
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const endpoints = [PDS_SERVICE, PDS_SERVICE_LEGACY];
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/xrpc/com.atproto.server.resetPassword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        console.log('[Agent] Password reset successful via:', endpoint);
        return;
      }

      const data = await response.json().catch(() => ({}));
      // Invalid token on this PDS - try next
      if (data.message?.toLowerCase().includes('invalid') || data.error === 'InvalidToken') {
        continue;
      }

      throw new Error(data.message || 'Failed to reset password');
    } catch (err: any) {
      lastError = err;
      continue;
    }
  }

  throw lastError || new Error('Invalid or expired reset token');
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
// VIDEO UPLOAD (Direct PDS Upload)
// ============================================================

/**
 * Upload video directly to the PDS using uploadBlob
 * Note: Bluesky's video.bsky.app service doesn't work from third-party origins (CORS/HTTP2 issues)
 * So we upload directly to the user's PDS and play back via getBlob
 */
export async function uploadVideoToPDS(
  data: ArrayBuffer,
  mimeType: string = 'video/mp4',
  onProgress?: (progress: number) => void
): Promise<{ blob: any }> {
  const bskyAgent = getAgent();

  if (!bskyAgent.session) {
    throw new Error('Not authenticated');
  }

  console.log('[Video] Uploading to PDS via uploadBlob...');
  console.log('[Video] Data size:', data.byteLength, 'bytes');

  onProgress?.(0);

  // Convert ArrayBuffer to Uint8Array for uploadBlob
  const uint8Array = new Uint8Array(data);

  try {
    const result = await bskyAgent.uploadBlob(uint8Array, { encoding: mimeType });
    console.log('[Video] PDS upload complete:', result.data);
    onProgress?.(100);
    return { blob: result.data.blob };
  } catch (error: any) {
    console.error('[Video] PDS upload failed:', error);
    throw new Error(error.message || 'Failed to upload video to PDS');
  }
}

/**
 * Upload video - main entry point for video uploads
 * Uses direct PDS upload for reliable cross-origin support
 */
export async function uploadVideoWithFallback(
  data: ArrayBuffer,
  mimeType: string = 'video/mp4',
  onProgress?: (stage: 'uploading' | 'processing', progress: number) => void
): Promise<{ blob: any }> {
  console.log('[Video] Uploading to PDS...');
  onProgress?.('uploading', 0);

  const result = await uploadVideoToPDS(data, mimeType, (p) => onProgress?.('uploading', p));
  onProgress?.('uploading', 100);
  return result;
}

// ============================================================
// CHAT / DIRECT MESSAGES
// ============================================================

// Bluesky Chat service DID for proxy header
const CHAT_SERVICE_DID = 'did:web:api.bsky.chat#bsky_chat';

/**
 * Make a chat API request with the proper proxy header
 */
async function chatRequest(
  method: 'GET' | 'POST',
  endpoint: string,
  params?: Record<string, any>,
  body?: Record<string, any>
) {
  const bskyAgent = getAgent();

  if (!bskyAgent.session) {
    throw new Error('Not authenticated');
  }

  // Get the agent's actual PDS service URL (not the hardcoded one)
  // Remove trailing slash to avoid double slashes in URL
  const agentService = ((bskyAgent as any).service?.toString() || PDS_SERVICE).replace(/\/$/, '');
  const url = new URL(`${agentService}/xrpc/${endpoint}`);

  // Add query params for GET
  if (method === 'GET' && params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        // Handle arrays (e.g., members=[did1, did2] -> members=did1&members=did2)
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${bskyAgent.session.accessJwt}`,
    'atproto-proxy': CHAT_SERVICE_DID,
  };

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error('[Chat] API error:', response.status, error);
    throw new Error(error.message || `Chat request failed: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

/**
 * List all conversations
 */
export async function listConversations(cursor?: string, limit: number = 50) {
  return chatRequest('GET', 'chat.bsky.convo.listConvos', { cursor, limit });
}

/**
 * Get a single conversation by ID
 */
export async function getConversation(convoId: string) {
  return chatRequest('GET', 'chat.bsky.convo.getConvo', { convoId });
}

/**
 * Get messages in a conversation
 */
export async function getMessages(convoId: string, cursor?: string, limit: number = 50) {
  return chatRequest('GET', 'chat.bsky.convo.getMessages', { convoId, cursor, limit });
}

/**
 * Get or create a conversation with a user
 */
export async function getConvoForMembers(members: string[]) {
  return chatRequest('GET', 'chat.bsky.convo.getConvoForMembers', {
    members: members, // Pass as array, chatRequest will handle it
  });
}

/**
 * Send a message in a conversation
 * Automatically detects and includes facets (mentions, links, hashtags)
 * Supports embedding posts (share to DM)
 */
export async function sendMessage(
  convoId: string,
  text: string,
  embed?: { uri: string; cid: string }
) {
  const bskyAgent = getAgent();

  // Parse facets (mentions, links, hashtags) using RichText
  const rt = new RichText({ text });
  await rt.detectFacets(bskyAgent);

  const message: { text: string; facets?: any[]; embed?: any } = { text: rt.text };

  // Only include facets if we found any
  if (rt.facets && rt.facets.length > 0) {
    message.facets = rt.facets;
  }

  // Include post embed if provided
  if (embed) {
    message.embed = {
      $type: 'app.bsky.embed.record',
      record: {
        uri: embed.uri,
        cid: embed.cid,
      },
    };
  }

  return chatRequest('POST', 'chat.bsky.convo.sendMessage', undefined, {
    convoId,
    message,
  });
}

/**
 * Mark conversation as read
 */
export async function updateConvoRead(convoId: string) {
  return chatRequest('POST', 'chat.bsky.convo.updateRead', undefined, { convoId });
}

/**
 * Leave/delete a conversation
 */
export async function leaveConversation(convoId: string) {
  return chatRequest('POST', 'chat.bsky.convo.leaveConvo', undefined, { convoId });
}

/**
 * Delete a message (for self only)
 */
export async function deleteMessageForSelf(convoId: string, messageId: string) {
  return chatRequest('POST', 'chat.bsky.convo.deleteMessageForSelf', undefined, {
    convoId,
    messageId,
  });
}

/**
 * Check if we can message a user
 * Returns { canChat: boolean, convo?: Conversation }
 */
export async function getConvoAvailability(memberDid: string) {
  const session = getSession();
  if (!session) throw new Error('Not authenticated');

  return chatRequest('GET', 'chat.bsky.convo.getConvoAvailability', {
    members: [session.did, memberDid],
  });
}

export { RichText };
