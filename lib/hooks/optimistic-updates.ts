/**
 * Optimistic Updates - Unified utilities for React Query mutations
 *
 * Provides reusable helpers for:
 * - Canceling queries before mutation
 * - Snapshotting state for rollback
 * - Updating posts in all feeds
 * - Removing posts from feeds
 * - Restoring state on error
 * - Invalidating queries after mutation
 */

import { QueryClient } from '@tanstack/react-query';
import type { AppBskyFeedDefs } from '@atproto/api';

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

// All feed-related query keys
export const FEED_KEYS = {
  timeline: 'timeline',
  cannectFeed: 'cannectFeed',
  globalFeed: 'globalFeed',
  localFeed: 'localFeed',
  authorFeed: 'authorFeed',
  actorLikes: 'actorLikes',
  thread: 'thread',
} as const;

// All infinite query feeds - use setQueriesData for partial matching
const ALL_FEED_KEYS = ['timeline', 'cannectFeed', 'globalFeed', 'localFeed', 'authorFeed', 'actorLikes', 'thread'];

/**
 * Cancel all outgoing queries to prevent race conditions
 */
export async function cancelFeedQueries(
  queryClient: QueryClient,
  keys: string[] = ALL_FEED_KEYS
) {
  await Promise.all(keys.map((key) => queryClient.cancelQueries({ queryKey: [key] })));
}

/**
 * Snapshot current feed state for potential rollback
 */
export function snapshotFeedState(
  queryClient: QueryClient,
  keys: string[] = ALL_FEED_KEYS
): Record<string, any> {
  const snapshots: Record<string, any> = {};

  keys.forEach((key) => {
    // Use getQueriesData for all - handles both single and parameterized queries
    snapshots[key] = queryClient.getQueriesData({ queryKey: [key] });
  });

  return snapshots;
}

/**
 * Restore feed state from snapshot (on error)
 */
export function restoreFeedState(queryClient: QueryClient, snapshots: Record<string, any>) {
  Object.entries(snapshots).forEach(([key, data]) => {
    if (Array.isArray(data)) {
      // Restore all matching queries
      data.forEach(([queryKey, queryData]: [any, any]) => {
        if (queryData) {
          queryClient.setQueryData(queryKey, queryData);
        }
      });
    }
  });
}

/**
 * Update a post in all feeds with a custom updater function
 */
export function updatePostInFeeds(
  queryClient: QueryClient,
  postUri: string,
  updater: (post: PostView) => PostView,
  options?: {
    removeFromLikes?: boolean;
    skipKeys?: string[];
  }
) {
  const { removeFromLikes = false, skipKeys = [] } = options || {};

  // Generic feed updater for infinite queries
  const updateFeed = (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        feed: page.feed.map((item: FeedViewPost) => {
          if (item.post.uri === postUri) {
            return { ...item, post: updater(item.post) };
          }
          return item;
        }),
      })),
    };
  };

  // Update all standard feeds using setQueriesData (handles infinite queries properly)
  const feedKeysToUpdate = ['cannectFeed', 'globalFeed', 'localFeed', 'timeline', 'authorFeed'];
  feedKeysToUpdate
    .filter((key) => !skipKeys.includes(key))
    .forEach((key) => {
      queryClient.setQueriesData({ queryKey: [key] }, updateFeed);
    });

  // Handle actorLikes - either update or remove
  if (!skipKeys.includes('actorLikes')) {
    if (removeFromLikes) {
      queryClient.setQueriesData({ queryKey: ['actorLikes'] }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.filter((item: FeedViewPost) => item.post.uri !== postUri),
          })),
        };
      });
    } else {
      queryClient.setQueriesData({ queryKey: ['actorLikes'] }, updateFeed);
    }
  }

  // Update thread views
  if (!skipKeys.includes('thread')) {
    queryClient.setQueriesData({ queryKey: ['thread'] }, (old: any) => {
      if (!old?.thread?.post) return old;
      if (old.thread.post.uri === postUri) {
        return {
          ...old,
          thread: { ...old.thread, post: updater(old.thread.post) },
        };
      }
      return old;
    });
  }
}

/**
 * Remove a post from all feeds (for delete operations)
 */
export function removePostFromFeeds(
  queryClient: QueryClient,
  postUri: string,
  skipKeys: string[] = []
) {
  const removeFromFeed = (old: any) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        feed: page.feed.filter((item: FeedViewPost) => item.post.uri !== postUri),
      })),
    };
  };

  // Remove from all feeds using setQueriesData
  const feedKeysToUpdate = ['cannectFeed', 'globalFeed', 'localFeed', 'timeline', 'authorFeed', 'actorLikes'];
  feedKeysToUpdate
    .filter((key) => !skipKeys.includes(key))
    .forEach((key) => {
      queryClient.setQueriesData({ queryKey: [key] }, removeFromFeed);
    });
}

/**
 * Invalidate feed queries after mutation completes
 * Use exclude to skip certain feeds (e.g., don't refetch actorLikes after unlike)
 */
export function invalidateFeeds(
  queryClient: QueryClient,
  options?: {
    exclude?: string[];
    only?: string[];
  }
) {
  const { exclude = [], only } = options || {};

  const keysToInvalidate = only || ALL_FEED_KEYS;

  keysToInvalidate
    .filter((key) => !exclude.includes(key))
    .forEach((key) => {
      queryClient.invalidateQueries({ queryKey: [key] });
    });
}

/**
 * Post updater helpers - common transformations
 */
export const postUpdaters = {
  like: (post: PostView): PostView => ({
    ...post,
    likeCount: (post.likeCount || 0) + 1,
    viewer: { ...post.viewer, like: 'pending' },
  }),

  unlike: (post: PostView): PostView => ({
    ...post,
    likeCount: Math.max((post.likeCount || 1) - 1, 0),
    viewer: { ...post.viewer, like: undefined },
  }),

  repost: (post: PostView): PostView => ({
    ...post,
    repostCount: (post.repostCount || 0) + 1,
    viewer: { ...post.viewer, repost: 'pending' },
  }),

  unrepost: (post: PostView): PostView => ({
    ...post,
    repostCount: Math.max((post.repostCount || 1) - 1, 0),
    viewer: { ...post.viewer, repost: undefined },
  }),

  /** Update like URI after server confirms */
  confirmLike:
    (likeUri: string) =>
    (post: PostView): PostView => ({
      ...post,
      viewer: { ...post.viewer, like: likeUri },
    }),

  /** Update repost URI after server confirms */
  confirmRepost:
    (repostUri: string) =>
    (post: PostView): PostView => ({
      ...post,
      viewer: { ...post.viewer, repost: repostUri },
    }),
};

/**
 * Create a standard optimistic mutation context
 * Returns cancel, snapshot, and restore functions bound to the query client
 */
export function createOptimisticContext(queryClient: QueryClient) {
  return {
    cancel: (keys?: string[]) => cancelFeedQueries(queryClient, keys),
    snapshot: (keys?: string[]) => snapshotFeedState(queryClient, keys),
    restore: (snapshots: Record<string, any>) => restoreFeedState(queryClient, snapshots),
    updatePost: (
      uri: string,
      updater: (post: PostView) => PostView,
      options?: Parameters<typeof updatePostInFeeds>[3]
    ) => updatePostInFeeds(queryClient, uri, updater, options),
    removePost: (uri: string, skipKeys?: string[]) =>
      removePostFromFeeds(queryClient, uri, skipKeys),
    invalidate: (options?: Parameters<typeof invalidateFeeds>[1]) =>
      invalidateFeeds(queryClient, options),
  };
}
