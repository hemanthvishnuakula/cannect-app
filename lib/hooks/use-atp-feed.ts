/**
 * AT Protocol Feed & Posts Hooks
 * 
 * Pure AT Protocol - no Supabase.
 * All data comes directly from the PDS.
 * 
 * Feed aggregation is done server-side by the Cannect Feed Service
 * (feed.cannect.space) to reduce API calls from 100+ to just 1-2.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as atproto from '@/lib/atproto/agent';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
import { logger, perf } from '@/lib/utils/logger';
import {
  createOptimisticContext,
  postUpdaters,
} from './optimistic-updates';
import type { 
  AppBskyFeedDefs, 
  AppBskyFeedPost,
  AppBskyFeedGetTimeline,
  AppBskyFeedGetAuthorFeed,
  AppBskyFeedGetPostThread,
} from '@atproto/api';

// Re-export types for convenience
export type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
export type PostView = AppBskyFeedDefs.PostView;
export type ThreadViewPost = AppBskyFeedDefs.ThreadViewPost;

// Feed Service URL - aggregates feeds server-side to reduce API calls
const FEED_SERVICE_URL = 'https://feed.cannect.space';

/**
 * Content moderation - filter out NSFW/harmful content
 * Bluesky's labeling system includes labels like: porn, sexual, nsfw, nudity, gore, graphic-media, etc.
 */
const BLOCKED_LABELS = new Set([
  // Sexual content
  'porn',
  'sexual',
  'nsfw', 
  'nudity',
  'adult',
  // Violence/gore
  'gore',
  'graphic-media',
  'corpse',
  // Child safety (CSAM)
  'csam',
  'child-exploitation',
  // Other harmful content
  'self-harm',
  'intolerant',
  'threat',
  'spam',
  'impersonation',
]);

/**
 * Keyword-based content filtering for unlabeled explicit content
 * These keywords will trigger filtering even if the post isn't labeled
 */
const BLOCKED_KEYWORDS = [
  // Sexual content - explicit terms
  'nude', 'nudes', 'naked', 'dick', 'cock', 'pussy', 'penis', 'vagina',
  'boobs', 'tits', 'titties', 'sex', 'sexy', 'horny', 'cum', 'cumshot',
  'blowjob', 'bj', 'handjob', 'fuck', 'fucking', 'fucked', 'fucks',
  'anal', 'porn', 'pornhub', 'xvideos', 'onlyfans', 'fansly',
  'hentai', 'xxx', 'nsfw', 'erotic', 'masturbat',
  // Child safety - CSAM indicators
  'cp', 'pedo', 'pedophile', 'underage', 'minor', 'jailbait', 'loli', 'shota',
  'child porn', 'kiddie', 'preteen',
];

// Build regex for efficient keyword matching
const BLOCKED_KEYWORDS_REGEX = new RegExp(
  '\\b(' + BLOCKED_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i'
);

/**
 * Check if text contains blocked keywords
 */
function containsBlockedKeywords(text: string): boolean {
  if (!text) return false;
  return BLOCKED_KEYWORDS_REGEX.test(text);
}

/**
 * Check if a post should be filtered based on its labels
 */
function shouldFilterPost(post: PostView): boolean {
  // Check post labels
  if (post.labels && post.labels.length > 0) {
    for (const label of post.labels) {
      if (BLOCKED_LABELS.has(label.val.toLowerCase())) {
        return true;
      }
    }
  }
  
  // Check author labels (account-level moderation)
  if (post.author?.labels && post.author.labels.length > 0) {
    for (const label of post.author.labels) {
      if (BLOCKED_LABELS.has(label.val.toLowerCase())) {
        return true;
      }
    }
  }

  // Check post text for blocked keywords
  const record = post.record as any;
  if (record?.text && containsBlockedKeywords(record.text)) {
    return true;
  }

  // Check author display name and bio for blocked keywords (catches spam accounts)
  if (post.author?.displayName && containsBlockedKeywords(post.author.displayName)) {
    return true;
  }
  
  return false;
}

/**
 * Filter an array of feed posts for moderation
 */
function filterFeedForModeration(feed: FeedViewPost[]): FeedViewPost[] {
  return feed.filter(item => !shouldFilterPost(item.post));
}

/**
 * Get Timeline (Following feed) - posts from users the current user follows
 * Uses Bluesky's official getTimeline API (1 call vs N×getAuthorFeed)
 */
export function useTimeline() {
  const { isAuthenticated, did } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['timeline', did],
    queryFn: async ({ pageParam }) => {
      if (!did) {
        return { feed: [], cursor: undefined };
      }
      
      const perfKey = 'timeline_fetch';
      perf.start(perfKey);
      logger.start('network', 'timeline_fetch', 'Fetching timeline', { hasCursor: !!pageParam });
      
      try {
        // Use official Bluesky getTimeline API - single call!
        const result = await atproto.getTimeline(pageParam, 50);
        const duration = perf.end(perfKey);
        
        // Apply content moderation filter
        const moderated = filterFeedForModeration(result.data.feed);
        
        logger.success('network', 'timeline_fetch', `Timeline: ${moderated.length} posts in ${duration}ms`, {
          postCount: moderated.length,
          durationMs: duration,
          apiCalls: 1,  // KEY: was N calls before (one per followed user)
          hasCursor: !!result.data.cursor,
        });
        
        return {
          feed: moderated,
          cursor: result.data.cursor,
        };
      } catch (error: any) {
        const duration = perf.end(perfKey);
        logger.error('network', 'timeline_fetch', error.message || 'Unknown error', { durationMs: duration });
        throw error;
      }
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 8, // Memory optimization: keep max 8 pages (400 posts) to prevent iOS PWA crashes
    enabled: isAuthenticated && !!did,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Helper: Fetch from Feed Service and convert to FeedViewPost format
 * The Feed Service returns a simplified format, we wrap it for compatibility
 */
async function fetchFromFeedService(
  endpoint: 'local' | 'global', 
  cursor?: string, 
  limit: number = 50
): Promise<{ feed: FeedViewPost[]; cursor: string | undefined }> {
  const perfKey = `feed_service_${endpoint}`;
  const feedEndpoint = `feed.cannect.space/feed/${endpoint}`;
  
  perf.start(perfKey);
  logger.start('network', 'feed_fetch', `Fetching ${endpoint} feed`, {
    endpoint,
    limit,
    hasCursor: !!cursor,
    source: 'feed_service',  // vs 'direct_api' - the old way
  });
  
  const url = new URL(`${FEED_SERVICE_URL}/feed/${endpoint}`);
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  
  try {
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      const duration = perf.end(perfKey);
      logger.error('network', 'feed_fetch', `Feed service HTTP ${response.status}`, {
        endpoint,
        httpStatus: response.status,
        durationMs: duration,
        source: 'feed_service',
      });
      throw new Error(`Feed service error: ${response.status}`);
    }
    
    const data = await response.json();
    const duration = perf.end(perfKey);
    
    // Comprehensive success log with all metrics for comparison
    logger.success('network', 'feed_fetch', `${endpoint}: ${data.posts?.length || 0} posts in ${duration}ms`, {
      endpoint,
      postCount: data.posts?.length || 0,
      durationMs: duration,
      hasCursor: !!data.cursor,
      source: 'feed_service',
      apiCalls: 1,  // KEY METRIC: was 100+ getAuthorFeed calls before!
      // Compare to old method which did: 100 users * 1 call = 100 calls
      // Now: 1 call to aggregated feed service
    });
    
    // Convert Feed Service format to FeedViewPost format expected by the app
    const feed: FeedViewPost[] = data.posts.map((post: any) => ({
      post: {
        uri: post.uri,
        cid: post.cid,
        author: {
          did: post.author.did,
          handle: post.author.handle,
          displayName: post.author.displayName || post.author.handle,
          avatar: post.author.avatar,
          labels: [],
        },
        record: {
          $type: 'app.bsky.feed.post',
          text: post.record.text,
          createdAt: post.record.createdAt,
        },
        embed: post.embed,
        likeCount: post.likeCount || 0,
        repostCount: post.repostCount || 0,
        replyCount: post.replyCount || 0,
        indexedAt: post.indexedAt,
        labels: [],
      },
      // No reply context from feed service (yet)
      reply: undefined,
    }));
    
    return {
      feed,
      cursor: data.cursor,
    };
  } catch (error: any) {
    const duration = perf.end(perfKey);
    logger.error('network', 'feed_fetch', error.message || 'Unknown error', {
      endpoint,
      durationMs: duration,
      source: 'feed_service',
    });
    throw error;
  }
}

/**
 * Get Global feed - aggregated cannabis content from Cannect Feed Service
 * 
 * This is now a SINGLE API call instead of 14+ parallel feed requests.
 * The Feed Service aggregates content from curated cannabis accounts.
 */
export function useGlobalFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['globalFeed'],
    queryFn: async ({ pageParam }) => {
      // Single API call to Feed Service
      const result = await fetchFromFeedService('global', pageParam, 50);
      
      // Apply content moderation filter (in case of any slipped through)
      const moderated = filterFeedForModeration(result.feed);

      return {
        feed: moderated,
        cursor: result.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 8, // Memory optimization: keep max 8 pages (400 posts) to prevent iOS PWA crashes
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

/**
 * Get Cannect feed - posts from Cannect PDS users via Feed Service
 * 
 * This is now a SINGLE API call instead of 100+ parallel getAuthorFeed requests.
 * The Feed Service maintains a real-time cache of all Cannect user posts via Jetstream.
 */
export function useCannectFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['cannectFeed'],
    queryFn: async ({ pageParam }) => {
      // Single API call to Feed Service
      const result = await fetchFromFeedService('local', pageParam, 50);
      
      // Apply content moderation filter
      const moderated = filterFeedForModeration(result.feed);

      return {
        feed: moderated,
        cursor: result.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 8, // Memory optimization: keep max 8 pages (400 posts) to prevent iOS PWA crashes
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 2, // 2 minutes - cache the sorted results
  });
}

/**
 * Get a specific user's feed with optional filter
 * Uses Bluesky's official API
 */
export function useAuthorFeed(
  actor: string | undefined, 
  filter?: 'posts_with_replies' | 'posts_no_replies' | 'posts_with_media' | 'posts_and_author_threads'
) {
  return useInfiniteQuery({
    queryKey: ['authorFeed', actor, filter],
    queryFn: async ({ pageParam }) => {
      if (!actor) throw new Error('Actor required');
      const result = await atproto.getAuthorFeed(actor, pageParam, 30, filter);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 10, // Memory optimization: keep max 10 pages (300 posts) to prevent crashes
    enabled: !!actor,
    staleTime: 1000 * 60,
  });
}

/**
 * Get a user's liked posts
 */
export function useActorLikes(actor: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['actorLikes', actor],
    queryFn: async ({ pageParam }) => {
      if (!actor) throw new Error('Actor required');
      const result = await atproto.getActorLikes(actor, pageParam, 30);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 10, // Memory optimization: keep max 10 pages (300 likes) to prevent crashes
    enabled: !!actor,
    staleTime: 1000 * 60,
  });
}

/**
 * Get a post thread with ancestors and replies
 */
export function usePostThread(uri: string | undefined) {
  return useQuery({
    queryKey: ['thread', uri],
    queryFn: async () => {
      if (!uri) throw new Error('URI required');
      const result = await atproto.getPostThread(uri);
      // Return the thread object directly, which contains post, parent, replies
      return result.data.thread as ThreadViewPost;
    },
    enabled: !!uri,
    staleTime: 1000 * 30,
  });
}

/**
 * Create a new post
 */
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      text, 
      reply,
      embed,
    }: { 
      text: string; 
      reply?: {
        parent: { uri: string; cid: string };
        root: { uri: string; cid: string };
      };
      embed?: any;
    }) => {
      logger.post.createStart(text, embed?.images?.length || 0);
      perf.start('post_create');
      try {
        const result = await atproto.createPost(text, { reply, embed });
        const duration = perf.end('post_create');
        logger.post.createSuccess(result.uri);
        return result;
      } catch (err: any) {
        perf.end('post_create');
        logger.post.createError(err.message || 'Unknown error');
        throw err;
      }
    },
    onSuccess: (_, variables) => {
      // Invalidate all feeds so new post appears immediately
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['cannectFeed'] });
      queryClient.invalidateQueries({ queryKey: ['authorFeed'] });
      if (variables.reply) {
        queryClient.invalidateQueries({ queryKey: ['thread', variables.reply.root.uri] });
      }
    },
  });
}

/**
 * Delete a post with optimistic update
 */
export function useDeletePost() {
  const queryClient = useQueryClient();
  const optimistic = createOptimisticContext(queryClient);

  return useMutation({
    mutationFn: async (uri: string) => {
      logger.post.deleteStart(uri);
      try {
        await atproto.deletePost(uri);
        logger.post.deleteSuccess(uri);
        return uri;
      } catch (err: any) {
        logger.post.deleteError(uri, err.message || 'Unknown error');
        throw err;
      }
    },
    onMutate: async (uri: string) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.removePost(uri);
      return snapshots;
    },
    onError: (err, uri, context) => {
      if (context) optimistic.restore(context);
    },
    // NOTE: We intentionally do NOT refetch after delete
    // The optimistic update already removed the post from cache
    // Refetching would bring back the post due to AppView caching delays
  });
}

/**
 * Like a post with optimistic update
 */
export function useLikePost() {
  const queryClient = useQueryClient();
  const optimistic = createOptimisticContext(queryClient);

  return useMutation({
    mutationFn: async ({ uri, cid }: { uri: string; cid: string }) => {
      const result = await atproto.likePost(uri, cid);
      logger.post.like(uri);
      return result;
    },
    onMutate: async ({ uri }) => {
      logger.mutation.optimisticStart('like', uri, { liked: true, likeCountDelta: 1 });
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(uri, postUpdaters.like);
      return snapshots;
    },
    onError: (err, variables, context) => {
      logger.mutation.rollback('like', variables.uri, err.message || 'Unknown error');
      if (context) optimistic.restore(context);
    },
    onSuccess: (result, variables) => {
      logger.mutation.serverResponse('like', variables.uri, { likeUri: result.uri }, true);
    },
    // No onSettled - optimistic update is the final state
  });
}

/**
 * Unlike a post with optimistic update
 */
export function useUnlikePost() {
  const queryClient = useQueryClient();
  const optimistic = createOptimisticContext(queryClient);

  return useMutation({
    mutationFn: async ({ likeUri, postUri }: { likeUri: string; postUri: string }) => {
      await atproto.unlikePost(likeUri);
      logger.post.unlike(postUri);
    },
    onMutate: async ({ postUri }) => {
      logger.mutation.optimisticStart('unlike', postUri, { liked: false, likeCountDelta: -1 });
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      // Update like count in all feeds, and REMOVE from Likes tab
      optimistic.updatePost(postUri, postUpdaters.unlike, { removeFromLikes: true });
      return snapshots;
    },
    onError: (err, variables, context) => {
      logger.mutation.rollback('unlike', variables.postUri, err.message || 'Unknown error');
      if (context) optimistic.restore(context);
    },
    onSuccess: (_, variables) => {
      logger.mutation.serverResponse('unlike', variables.postUri, { removed: true }, true);
    },
    // No onSettled - optimistic update is the final state
  });
}

/**
 * Repost a post with optimistic update
 */
export function useRepost() {
  const queryClient = useQueryClient();
  const optimistic = createOptimisticContext(queryClient);

  return useMutation({
    mutationFn: async ({ uri, cid }: { uri: string; cid: string }) => {
      const result = await atproto.repost(uri, cid);
      logger.post.repost(uri);
      return result;
    },
    onMutate: async ({ uri }) => {
      logger.mutation.optimisticStart('repost', uri, { reposted: true, repostCountDelta: 1 });
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(uri, postUpdaters.repost);
      return snapshots;
    },
    onError: (err, variables, context) => {
      logger.mutation.rollback('repost', variables.uri, err.message || 'Unknown error');
      if (context) optimistic.restore(context);
    },
    onSuccess: (result, variables) => {
      logger.mutation.serverResponse('repost', variables.uri, { repostUri: result.uri }, true);
    },
    // No onSettled - optimistic update is the final state
  });
}

/**
 * Delete a repost with optimistic update
 */
export function useDeleteRepost() {
  const queryClient = useQueryClient();
  const optimistic = createOptimisticContext(queryClient);

  return useMutation({
    mutationFn: async ({ repostUri, postUri }: { repostUri: string; postUri: string }) => {
      await atproto.deleteRepost(repostUri);
      logger.post.unrepost(postUri);
    },
    onMutate: async ({ postUri }) => {
      logger.mutation.optimisticStart('unrepost', postUri, { reposted: false, repostCountDelta: -1 });
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(postUri, postUpdaters.unrepost);
      return snapshots;
    },
    onError: (err, variables, context) => {
      logger.mutation.rollback('unrepost', variables.postUri, err.message || 'Unknown error');
      if (context) optimistic.restore(context);
    },
    onSuccess: (_, variables) => {
      logger.mutation.serverResponse('unrepost', variables.postUri, { removed: true }, true);
    },
    // No onSettled - optimistic update is the final state
  });
}

/**
 * Combined like/unlike hook for convenience
 */
export function useToggleLike() {
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();

  return {
    like: likeMutation.mutateAsync,
    unlike: unlikeMutation.mutateAsync,
    isLiking: likeMutation.isPending,
    isUnliking: unlikeMutation.isPending,
    isPending: likeMutation.isPending || unlikeMutation.isPending,
  };
}

/**
 * Combined repost/unrepost hook for convenience
 */
export function useToggleRepost() {
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();

  return {
    repost: repostMutation.mutateAsync,
    unrepost: unrepostMutation.mutateAsync,
    isReposting: repostMutation.isPending,
    isUnreposting: unrepostMutation.isPending,
    isPending: repostMutation.isPending || unrepostMutation.isPending,
  };
}

/**
 * Search posts
 */
export function useSearchPosts(query: string) {
  return useInfiniteQuery({
    queryKey: ['searchPosts', query],
    queryFn: async ({ pageParam }) => {
      const result = await atproto.searchPosts(query, pageParam, 25);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: query.length > 0,
    staleTime: 1000 * 60,
  });
}

/**
 * Get suggested posts from Cannect users
 * Fetches recent posts directly from Cannect PDS users
 */
export function useSuggestedPosts() {
  const { isAuthenticated } = useAuthStore();
  
  return useQuery({
    queryKey: ['suggestedPosts', 'cannect'],
    queryFn: async () => {
      // Get recent posts directly from Cannect PDS users
      const posts = await atproto.getCannectPosts(30);
      return posts;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Local Feed - Direct from Cannect PDS
 * Fetches posts from all users on cannect.space directly
 * No middleman VPS needed!
 */
export function useLocalFeed() {
  const { isAuthenticated } = useAuthStore();
  
  // Bluesky AppView for feed hydration (PDS doesn't serve app.bsky.feed.* endpoints)
  const BSKY_APPVIEW = 'https://public.api.bsky.app';
  
  return useInfiniteQuery({
    queryKey: ['localFeed'],
    queryFn: async ({ pageParam }) => {
      // Get all DIDs from our PDS
      const dids = await atproto.listPdsRepos(100);
      if (dids.length === 0) {
        return { feed: [], cursor: undefined };
      }
      
      // Fetch recent posts from all users in parallel via Bluesky AppView
      const results = await Promise.all(
        dids.map(async (did) => {
          try {
            const res = await fetch(
              `${BSKY_APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&limit=10&filter=posts_no_replies`
            );
            if (!res.ok) return [];
            const data = await res.json();
            return data.feed || [];
          } catch {
            return [];
          }
        })
      );
      
      // Flatten all posts
      const allPosts = results.flat();
      
      // Sort by createdAt (newest first)
      const sorted = allPosts.sort((a: any, b: any) => {
        const aDate = a.post?.record?.createdAt || a.post?.indexedAt;
        const bDate = b.post?.record?.createdAt || b.post?.indexedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
      
      // Simple pagination: use page number as cursor
      const page = pageParam || 0;
      const pageSize = 30;
      const start = page * pageSize;
      const paginated = sorted.slice(start, start + pageSize);
      
      return { 
        feed: paginated, 
        cursor: paginated.length === pageSize ? page + 1 : undefined 
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: 0,
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
    maxPages: 5, // Limit pages to prevent memory issues
  });
}
