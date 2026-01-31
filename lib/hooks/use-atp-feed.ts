/**
 * AT Protocol Feed & Posts Hooks
 *
 * Pure AT Protocol - no Supabase, no custom VPS.
 * All data comes directly from the PDS and Bluesky Feed Creator.
 *
 * Feed Architecture:
 * - Global: Cannabis Community feed via Bluesky Feed Creator
 * - Local: Cannect Network feed via Bluesky Feed Creator
 * - Following: Custom Following Timeline API for cannect.space users,
 *              Bluesky's getTimeline API for others
 *
 * All feeds use Bluesky's hydration layer for proper viewer state.
 *
 * @updated 2024-12-30 - Added Following Timeline service for cannect.space PDS
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
 *
 * Removed overly broad terms that cause false positives:
 * - 'sex', 'sexy' - too common in casual/news contexts
 * - 'minor' - matches "minor issue", "G minor", etc.
 * - 'cp' - matches other abbreviations (cerebral palsy)
 * - 'fuck' variants - casual profanity, not sexual
 */
const BLOCKED_KEYWORDS = [
  // Sexual content - explicit terms only
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
  'horny',
  'cum',
  'cumshot',
  'blowjob',
  'bj',
  'handjob',
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
  'pedo',
  'pedophile',
  'underage',
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
 * Extract labels from embed objects (images, videos, record with media)
 * Bluesky's AI moderation labels images/videos at upload time
 */
function getEmbedLabels(embed: any): string[] {
  if (!embed) return [];

  const labels: string[] = [];
  const embedType = embed.$type;

  // Images - each image can have its own labels
  if (embedType === 'app.bsky.embed.images#view') {
    for (const img of embed.images || []) {
      if (img.labels && Array.isArray(img.labels)) {
        labels.push(...img.labels.map((l: any) => l.val));
      }
    }
  }

  // Video - video embed can have labels
  if (embedType === 'app.bsky.embed.video#view') {
    if (embed.labels && Array.isArray(embed.labels)) {
      labels.push(...embed.labels.map((l: any) => l.val));
    }
  }

  // Record with media - check the nested media embed
  if (embedType === 'app.bsky.embed.recordWithMedia#view') {
    if (embed.media) {
      labels.push(...getEmbedLabels(embed.media));
    }
  }

  // Also check alt text for blocked keywords (some users hide explicit content in alt text)
  if (embedType === 'app.bsky.embed.images#view') {
    for (const img of embed.images || []) {
      if (img.alt && containsBlockedKeywords(img.alt)) {
        labels.push('blocked-keyword-in-alt');
      }
    }
  }

  return labels;
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

  // Check embed labels (images/videos can have NSFW labels from Bluesky's AI)
  if (post.embed) {
    const embedLabels = getEmbedLabels(post.embed);
    for (const label of embedLabels) {
      if (BLOCKED_LABELS.has(label.toLowerCase()) || label === 'blocked-keyword-in-alt') {
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
 * Also ensures viewer state is always defined (Bluesky API sometimes returns undefined for older posts)
 */
function filterFeedForModeration(feed: FeedViewPost[]): FeedViewPost[] {
  return feed
    .filter((item) => !shouldFilterPost(item.post))
    .map((item) => ({
      ...item,
      post: {
        ...item.post,
        // Ensure viewer is always an object (API sometimes returns undefined for older/cached posts)
        viewer: item.post.viewer ?? {},
      },
    }));
}

/**
 * Check if user is on cannect.space PDS (handle ends with .cannect.space)
 */
function isCannectSpaceUser(handle: string | null): boolean {
  return handle?.endsWith('.cannect.space') ?? false;
}

/**
 * Fetch following timeline from our custom API (for cannect.space users)
 * This aggregates posts from followed users since Bluesky's getTimeline
 * doesn't work properly for third-party PDS users.
 *
 * The VPS uses public API (no auth), so we need to hydrate posts with
 * viewer state using authenticated getPosts API.
 */
async function fetchCannectFollowingTimeline(
  actor: string,
  cursor?: string,
  limit: number = 50
): Promise<{ feed: FeedViewPost[]; cursor?: string }> {
  const params = new URLSearchParams({
    actor,
    limit: String(limit),
  });
  if (cursor) {
    params.append('cursor', cursor);
  }

  const response = await fetch(`https://feed.cannect.space/api/following?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Following API error: ${response.status}`);
  }

  const data = await response.json();
  const feed: FeedViewPost[] = data.feed || [];

  // Hydrate posts with viewer state using authenticated getPosts API
  // This adds like/repost state that the public VPS API doesn't include
  // Bluesky limits getPosts to 25 URIs per request, so we batch in parallel
  if (feed.length > 0) {
    try {
      const uris = feed.map((item) => item.post.uri);
      const hydratedMap = new Map<string, PostView>();

      // Batch requests in chunks of 25, run all batches in parallel
      const BATCH_SIZE = 25;
      const batches: string[][] = [];
      for (let i = 0; i < uris.length; i += BATCH_SIZE) {
        batches.push(uris.slice(i, i + BATCH_SIZE));
      }

      const results = await Promise.all(batches.map((batch) => atproto.getPosts(batch)));
      for (const hydrated of results) {
        for (const post of hydrated.data.posts) {
          hydratedMap.set(post.uri, post);
        }
      }

      // Merge hydrated viewer state into feed posts
      for (const item of feed) {
        const hydratedPost = hydratedMap.get(item.post.uri);
        if (hydratedPost) {
          item.post.viewer = hydratedPost.viewer;
          // Also update counts in case they changed
          item.post.likeCount = hydratedPost.likeCount;
          item.post.repostCount = hydratedPost.repostCount;
          item.post.replyCount = hydratedPost.replyCount;
        }

        // For Following feed: ensure author.viewer.following is set to true
        // since by definition we follow everyone in this feed
        if (item.post.author) {
          item.post.author.viewer = {
            ...item.post.author.viewer,
            following: 'following', // URI placeholder - presence indicates following
          };
        }
      }
    } catch (error) {
      console.warn('[Following] Failed to hydrate viewer state:', error);
      // Continue without hydration - posts will just not show like/repost state
    }
  }

  return {
    feed,
    cursor: data.cursor,
  };
}

/**
 * Get Timeline (Following feed) - posts from users the current user follows
 *
 * For cannect.space users: Uses our custom Following Timeline API
 * For other users: Uses Bluesky's official getTimeline API
 */
export function useTimeline() {
  const { isAuthenticated, did, handle } = useAuthStore();
  const isCannectUser = isCannectSpaceUser(handle);

  return useInfiniteQuery({
    queryKey: ['timeline', did, isCannectUser],
    queryFn: async ({ pageParam }) => {
      if (!did) {
        return { feed: [], cursor: undefined };
      }

      try {
        let feed: FeedViewPost[];
        let cursor: string | undefined;

        if (isCannectUser) {
          // cannect.space users: Use our custom Following Timeline API
          const result = await fetchCannectFollowingTimeline(did, pageParam, 50);
          feed = result.feed;
          cursor = result.cursor;
        } else {
          // Other users: Use official Bluesky getTimeline API
          const result = await atproto.getTimeline(pageParam, 50);
          feed = result.data.feed;
          cursor = result.data.cursor;
        }

        // Apply content moderation filter
        const moderated = filterFeedForModeration(feed);

        return {
          feed: moderated,
          cursor,
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
 * Get Cannect feed - our custom feed from feed.cannect.space
 *
 * Includes:
 * - All posts from cannect.space users
 * - Posts with cannabis keywords from anywhere on Bluesky
 *
 * Returns proper viewer state (like/repost) through Bluesky's hydration
 */
export function useCannectFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['cannectFeed'],
    queryFn: async ({ pageParam }) => {
      // Use our feed generator - includes viewer state!
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
    maxPages: 8, // 8 pages × 50 posts = 400 posts max
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
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
 * Includes viewer DID in query key to refetch with auth after session restore
 */
export function usePostThread(uri: string | undefined) {
  // Include viewer DID in query key so thread refetches when session is restored
  // This ensures viewer state (likes, reposts) is correct after hard refresh
  const { did: viewerDid } = useAuthStore();

  return useQuery({
    queryKey: ['thread', uri, viewerDid],
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
 * Delete a post with optimistic update and server verification
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
      return { snapshots, uri };
    },
    onError: (err, uri, context) => {
      if (context?.snapshots) optimistic.restore(context.snapshots);
    },
    onSuccess: (uri) => {
      // Verify deletion after AppView propagation delay
      // If the post still exists, it means delete failed silently
      setTimeout(async () => {
        try {
          // Try to fetch the post - if it succeeds, deletion failed
          const result = await atproto.getPost(uri);
          if (result?.data?.thread) {
            console.warn('[Delete] Post still exists after deletion, restoring to cache');
            // Post still exists - invalidate to bring it back
            optimistic.invalidate({ only: ['authorFeed', 'timeline', 'cannectFeed'] });
          }
        } catch {
          // 404 or error = post is actually deleted, which is expected
          console.log('[Delete] Post verified as deleted');
        }
      }, 5000); // Wait 5 seconds for AppView to propagate
    },
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
      return { ...result, postUri: uri };
    },
    onMutate: async ({ uri }) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(uri, postUpdaters.like);
      return snapshots;
    },
    onSuccess: (result) => {
      // Update with the actual like URI from the server
      optimistic.updatePost(result.postUri, postUpdaters.confirmLike(result.uri));
    },
    onError: (err, variables, context) => {
      if (context) optimistic.restore(context);
    },
    onSettled: () => {
      // Reconcile with server state after a delay to avoid immediate refetch
      setTimeout(() => {
        optimistic.invalidate({ only: ['thread'] });
      }, 2000);
    },
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
      // Validate likeUri before attempting to unlike
      if (!likeUri || likeUri === 'pending') {
        throw new Error('Invalid like URI - please refresh and try again');
      }
      await atproto.unlikePost(likeUri);
      return { postUri };
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
    onSettled: () => {
      // Reconcile with server state after a delay
      setTimeout(() => {
        optimistic.invalidate({ only: ['thread', 'actorLikes'] });
      }, 2000);
    },
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
      return { ...result, postUri: uri };
    },
    onMutate: async ({ uri }) => {
      await optimistic.cancel();
      const snapshots = optimistic.snapshot();
      optimistic.updatePost(uri, postUpdaters.repost);
      return snapshots;
    },
    onSuccess: (result) => {
      // Update with the actual repost URI from the server
      optimistic.updatePost(result.postUri, postUpdaters.confirmRepost(result.uri));
    },
    onError: (err, variables, context) => {
      if (context) optimistic.restore(context);
    },
    onSettled: () => {
      // Reconcile with server state after a delay
      setTimeout(() => {
        optimistic.invalidate({ only: ['thread'] });
      }, 2000);
    },
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
      // Validate repostUri before attempting to delete
      if (!repostUri || repostUri === 'pending') {
        throw new Error('Invalid repost URI - please refresh and try again');
      }
      await atproto.deleteRepost(repostUri);
      return { postUri };
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
    onSettled: () => {
      // Reconcile with server state after a delay
      setTimeout(() => {
        optimistic.invalidate({ only: ['thread'] });
      }, 2000);
    },
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

const FEED_API_URL = 'https://feed.cannect.space';

/**
 * Get list of currently boosted post URIs
 * Returns a Set for O(1) lookup
 */
export function useBoostedPosts() {
  return useQuery<Set<string>>({
    queryKey: ['boostedPosts'],
    queryFn: async () => {
      const response = await fetch(`${FEED_API_URL}/api/boosts`);
      if (!response.ok) {
        return new Set<string>();
      }
      const data = await response.json();
      return new Set<string>(data.boosts?.map((b: { postUri: string }) => b.postUri) || []);
    },
    staleTime: 1000 * 60 * 2, // 2 minutes - boosts can change
    gcTime: 1000 * 60 * 10, // 10 minutes
  });
}
