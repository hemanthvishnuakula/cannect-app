/**
 * AT Protocol Feed & Posts Hooks
 *
 * Pure AT Protocol - no Supabase, no custom VPS.
 * All data comes directly from the PDS and Bluesky Feed Creator.
 *
 * Feed Architecture:
 * - Global: Cannabis Community feed via Bluesky Feed Creator
 * - Local: Cannect Network feed via Bluesky Feed Creator
 * - Following: Bluesky's official getTimeline API
 *
 * All feeds use Bluesky's hydration layer for proper viewer state.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as atproto from '@/lib/atproto/agent';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
import { createOptimisticContext, postUpdaters } from './optimistic-updates';
import type { AppBskyFeedDefs } from '@atproto/api';

// Re-export types for convenience
export type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
export type PostView = AppBskyFeedDefs.PostView;
export type ThreadViewPost = AppBskyFeedDefs.ThreadViewPost;

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
  'nude',
  'nudes',
  'naked',
  'dick',
  'cock',
  'pussy',
  'penis',
  'vagina',
  'boobs',
  'tits',
  'titties',
  'sex',
  'sexy',
  'horny',
  'cum',
  'cumshot',
  'blowjob',
  'bj',
  'handjob',
  'fuck',
  'fucking',
  'fucked',
  'fucks',
  'anal',
  'porn',
  'pornhub',
  'xvideos',
  'onlyfans',
  'fansly',
  'hentai',
  'xxx',
  'nsfw',
  'erotic',
  'masturbat',
  // Child safety - CSAM indicators
  'cp',
  'pedo',
  'pedophile',
  'underage',
  'minor',
  'jailbait',
  'loli',
  'shota',
  'child porn',
  'kiddie',
  'preteen',
];

// Build regex for efficient keyword matching
const BLOCKED_KEYWORDS_REGEX = new RegExp(
  '\\b(' + BLOCKED_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
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
  return feed.filter((item) => !shouldFilterPost(item.post));
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

      try {
        // Use official Bluesky getTimeline API - single call!
        const result = await atproto.getTimeline(pageParam, 50);

        // Apply content moderation filter
        const moderated = filterFeedForModeration(result.data.feed);

        return {
          feed: moderated,
          cursor: result.data.cursor,
        };
      } catch (error: any) {
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
 * Get Global feed - Cannabis Community content from Bluesky Feed Creator
 *
 * Uses Bluesky Feed Creator hosted feed which:
 * - Indexes posts containing cannabis-related keywords
 * - Returns proper viewer state (like/repost) through Bluesky's hydration
 * - Single API call - Bluesky handles everything
 */
export function useGlobalFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['globalFeed'],
    queryFn: async ({ pageParam }) => {
      // Use AT Protocol feed generator - includes viewer state!
      const result = await atproto.getCannabisFeed(pageParam, 50);

      // Apply content moderation filter
      const moderated = filterFeedForModeration(result.data.feed);

      return {
        feed: moderated,
        cursor: result.data.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 8, // 8 pages × 50 posts = 400 posts max
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Get Cannect feed - posts from Cannect users via Bluesky Feed Creator
 *
 * Uses Bluesky Feed Creator which:
 * - Indexes all Cannect PDS user posts
 * - Returns proper viewer state (like/repost) through Bluesky's hydration
 * - Supports optimistic updates because viewer state is accurate
 */
export function useCannectFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['cannectFeed'],
    queryFn: async ({ pageParam }) => {
      // Use AT Protocol feed generator - includes viewer state!
      const result = await atproto.getCannectFeed(pageParam, 50);

      // Apply content moderation filter
      const moderated = filterFeedForModeration(result.data.feed);

      return {
        feed: moderated,
        cursor: result.data.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 8, // Memory optimization: keep max 8 pages (400 posts)
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute - feed generator is fast
  });
}

/**
 * Get a specific user's feed with optional filter
 * Uses Bluesky's official API
 */
export function useAuthorFeed(
  actor: string | undefined,
  filter?:
    | 'posts_with_replies'
    | 'posts_no_replies'
    | 'posts_with_media'
    | 'posts_and_author_threads'
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
      const result = await atproto.createPost(text, { reply, embed });
      return result;
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
      await atproto.deletePost(uri);
      return uri;
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
      return result;
    },
    onMutate: async ({ uri }) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(uri, postUpdaters.like);
      return snapshots;
    },
    onError: (err, variables, context) => {
      if (context) optimistic.restore(context);
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
    mutationFn: async ({ likeUri, postUri: _postUri }: { likeUri: string; postUri: string }) => {
      await atproto.unlikePost(likeUri);
    },
    onMutate: async ({ postUri }) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      // Update like count in all feeds, and REMOVE from Likes tab
      optimistic.updatePost(postUri, postUpdaters.unlike, { removeFromLikes: true });
      return snapshots;
    },
    onError: (err, variables, context) => {
      if (context) optimistic.restore(context);
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
      return result;
    },
    onMutate: async ({ uri }) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(uri, postUpdaters.repost);
      return snapshots;
    },
    onError: (err, variables, context) => {
      if (context) optimistic.restore(context);
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
    mutationFn: async ({
      repostUri,
      postUri: _postUri,
    }: {
      repostUri: string;
      postUri: string;
    }) => {
      await atproto.deleteRepost(repostUri);
    },
    onMutate: async ({ postUri }) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(postUri, postUpdaters.unrepost);
      return snapshots;
    },
    onError: (err, variables, context) => {
      if (context) optimistic.restore(context);
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
 * Local Feed - Cannect users via Bluesky Feed Creator
 * Fetches posts from Cannect PDS users
 * Uses AT Protocol - no VPS needed!
 */
export function useLocalFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['localFeed'],
    queryFn: async ({ pageParam }) => {
      // Use AT Protocol feed - once user creates the local feed in Bluesky Feed Creator,
      // update CANNECT_FEED_URI in agent.ts to point to it
      const result = await atproto.getCannectFeed(pageParam, 50);

      // Apply content moderation filter
      const moderated = filterFeedForModeration(result.data.feed);

      return {
        feed: moderated,
        cursor: result.data.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    maxPages: 8,
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
    maxPages: 5, // Limit pages to prevent memory issues
  });
}
