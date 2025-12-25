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

// AppView for reading (Bluesky's infrastructure)
const APPVIEW_SERVICE = 'https://api.bsky.app';

// Singleton agent instance
let agent: BskyAgent | null = null;

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
        if (sess) {
          storeSession(sess);
        } else {
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
  if (storedSession) {
    try {
      await bskyAgent.resumeSession(storedSession);
    } catch (err) {
      console.warn('Failed to restore session:', err);
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
  return bskyAgent.getTimeline({ cursor, limit });
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
  return bskyAgent.getAuthorFeed({ actor, cursor, limit, filter });
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
  return bskyAgent.getPostThread({ uri, depth, parentHeight });
}

/**
 * Get profile
 */
export async function getProfile(actor: string) {
  const bskyAgent = getAgent();
  return bskyAgent.getProfile({ actor });
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
  return bskyAgent.upsertProfile((existing) => ({
    ...existing,
    ...update,
  }));
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
 */
export async function getProfiles(dids: string[]) {
  const bskyAgent = getAgent();
  // API limit is 25 actors at a time
  const chunks = [];
  for (let i = 0; i < dids.length; i += 25) {
    chunks.push(dids.slice(i, i + 25));
  }
  
  const results = await Promise.all(
    chunks.map(chunk => bskyAgent.getProfiles({ actors: chunk }))
  );
  
  return results.flatMap(r => r.data.profiles);
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
  
  // Flatten and sort by date, most recent first
  const allPosts = results.flat();
  const sorted = allPosts.sort((a, b) => 
    new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime()
  );
  
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

export { RichText };
