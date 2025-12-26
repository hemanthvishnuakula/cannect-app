/**
 * AT Protocol Feed & Posts Hooks
 * 
 * Pure AT Protocol - no Supabase.
 * All data comes directly from the PDS.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as atproto from '@/lib/atproto/agent';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
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

/**
 * Get home timeline feed (Following) with infinite scroll
 */
export function useTimeline() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['timeline'],
    queryFn: async ({ pageParam }) => {
      const result = await atproto.getTimeline(pageParam, 30);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Get Global feed - posts from people you follow on Bluesky network
 * Uses Bluesky's official timeline API
 */
export function useGlobalFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['globalFeed'],
    queryFn: async ({ pageParam }) => {
      // Use Bluesky's official timeline API
      const result = await atproto.getTimeline(pageParam, 30);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Get Cannect feed - cannabis content from the network + cannect.space users
 * This is our custom curated feed combining:
 * - Cannabis-related posts from the entire AT Protocol network
 * - Posts from users on cannect.space PDS (our community)
 */
export function useCannectFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['cannectFeed'],
    queryFn: async ({ pageParam }) => {
      const result = await atproto.getCannectFeed(pageParam, 30);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 2, // 2 minutes (search results change less frequently)
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
      return atproto.createPost(text, { reply, embed });
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
 * Delete a post
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (uri: string) => {
      await atproto.deletePost(uri);
      return uri;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
  });
}

/**
 * Like a post with optimistic update
 */
export function useLikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, cid }: { uri: string; cid: string }) => {
      return atproto.likePost(uri, cid);
    },
    onMutate: async ({ uri }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['timeline'] });
      await queryClient.cancelQueries({ queryKey: ['cannectFeed'] });
      await queryClient.cancelQueries({ queryKey: ['globalFeed'] });
      await queryClient.cancelQueries({ queryKey: ['authorFeed'] });
      await queryClient.cancelQueries({ queryKey: ['thread'] });

      // Snapshot previous values for rollback
      const previousTimeline = queryClient.getQueryData(['timeline']);
      const previousCannectFeed = queryClient.getQueryData(['cannectFeed']);
      const previousglobalFeed = queryClient.getQueryData(['globalFeed']);

      // Helper to update post in feed data
      const updatePostInFeed = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.map((item: FeedViewPost) => {
              if (item.post.uri === uri) {
                return {
                  ...item,
                  post: {
                    ...item.post,
                    likeCount: (item.post.likeCount || 0) + 1,
                    viewer: { ...item.post.viewer, like: 'pending' },
                  },
                };
              }
              return item;
            }),
          })),
        };
      };

      // Optimistically update all feeds (use partial key match for authorFeed)
      queryClient.setQueryData(['timeline'], updatePostInFeed);
      queryClient.setQueryData(['cannectFeed'], updatePostInFeed);
      queryClient.setQueryData(['globalFeed'], updatePostInFeed);
      // Update all authorFeed queries
      queryClient.setQueriesData({ queryKey: ['authorFeed'] }, updatePostInFeed);

      return { previousTimeline, previousCannectFeed, previousglobalFeed };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline'], context.previousTimeline);
      }
      if (context?.previousCannectFeed) {
        queryClient.setQueryData(['cannectFeed'], context.previousCannectFeed);
      }
      if (context?.previousglobalFeed) {
        queryClient.setQueryData(['globalFeed'], context.previousglobalFeed);
      }
      // Note: authorFeed rollback handled by invalidation
    },
    onSettled: () => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['cannectFeed'] });
      queryClient.invalidateQueries({ queryKey: ['globalFeed'] });
      queryClient.invalidateQueries({ queryKey: ['authorFeed'] });
      queryClient.invalidateQueries({ queryKey: ['actorLikes'] });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

/**
 * Unlike a post with optimistic update
 */
export function useUnlikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ likeUri, postUri }: { likeUri: string; postUri: string }) => {
      await atproto.unlikePost(likeUri);
    },
    onMutate: async ({ postUri }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline'] });
      await queryClient.cancelQueries({ queryKey: ['cannectFeed'] });
      await queryClient.cancelQueries({ queryKey: ['globalFeed'] });
      await queryClient.cancelQueries({ queryKey: ['authorFeed'] });

      const previousTimeline = queryClient.getQueryData(['timeline']);
      const previousCannectFeed = queryClient.getQueryData(['cannectFeed']);
      const previousglobalFeed = queryClient.getQueryData(['globalFeed']);

      const updatePostInFeed = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.map((item: FeedViewPost) => {
              if (item.post.uri === postUri) {
                return {
                  ...item,
                  post: {
                    ...item.post,
                    likeCount: Math.max((item.post.likeCount || 1) - 1, 0),
                    viewer: { ...item.post.viewer, like: undefined },
                  },
                };
              }
              return item;
            }),
          })),
        };
      };

      queryClient.setQueryData(['timeline'], updatePostInFeed);
      queryClient.setQueryData(['cannectFeed'], updatePostInFeed);
      queryClient.setQueryData(['globalFeed'], updatePostInFeed);
      queryClient.setQueriesData({ queryKey: ['authorFeed'] }, updatePostInFeed);

      return { previousTimeline, previousCannectFeed, previousglobalFeed };
    },
    onError: (err, variables, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline'], context.previousTimeline);
      }
      if (context?.previousCannectFeed) {
        queryClient.setQueryData(['cannectFeed'], context.previousCannectFeed);
      }
      if (context?.previousglobalFeed) {
        queryClient.setQueryData(['globalFeed'], context.previousglobalFeed);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['cannectFeed'] });
      queryClient.invalidateQueries({ queryKey: ['globalFeed'] });
      queryClient.invalidateQueries({ queryKey: ['authorFeed'] });
      queryClient.invalidateQueries({ queryKey: ['actorLikes'] });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

/**
 * Repost a post with optimistic update
 */
export function useRepost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, cid }: { uri: string; cid: string }) => {
      return atproto.repost(uri, cid);
    },
    onMutate: async ({ uri }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline'] });
      await queryClient.cancelQueries({ queryKey: ['cannectFeed'] });
      await queryClient.cancelQueries({ queryKey: ['globalFeed'] });
      await queryClient.cancelQueries({ queryKey: ['authorFeed'] });

      const previousTimeline = queryClient.getQueryData(['timeline']);
      const previousCannectFeed = queryClient.getQueryData(['cannectFeed']);
      const previousglobalFeed = queryClient.getQueryData(['globalFeed']);

      const updatePostInFeed = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.map((item: FeedViewPost) => {
              if (item.post.uri === uri) {
                return {
                  ...item,
                  post: {
                    ...item.post,
                    repostCount: (item.post.repostCount || 0) + 1,
                    viewer: { ...item.post.viewer, repost: 'pending' },
                  },
                };
              }
              return item;
            }),
          })),
        };
      };

      queryClient.setQueryData(['timeline'], updatePostInFeed);
      queryClient.setQueryData(['cannectFeed'], updatePostInFeed);
      queryClient.setQueryData(['globalFeed'], updatePostInFeed);
      queryClient.setQueriesData({ queryKey: ['authorFeed'] }, updatePostInFeed);

      return { previousTimeline, previousCannectFeed, previousglobalFeed };
    },
    onError: (err, variables, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline'], context.previousTimeline);
      }
      if (context?.previousCannectFeed) {
        queryClient.setQueryData(['cannectFeed'], context.previousCannectFeed);
      }
      if (context?.previousglobalFeed) {
        queryClient.setQueryData(['globalFeed'], context.previousglobalFeed);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['cannectFeed'] });
      queryClient.invalidateQueries({ queryKey: ['globalFeed'] });
      queryClient.invalidateQueries({ queryKey: ['authorFeed'] });
    },
  });
}

/**
 * Delete a repost with optimistic update
 */
export function useDeleteRepost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ repostUri, postUri }: { repostUri: string; postUri: string }) => {
      await atproto.deleteRepost(repostUri);
    },
    onMutate: async ({ postUri }) => {
      await queryClient.cancelQueries({ queryKey: ['timeline'] });
      await queryClient.cancelQueries({ queryKey: ['cannectFeed'] });
      await queryClient.cancelQueries({ queryKey: ['globalFeed'] });
      await queryClient.cancelQueries({ queryKey: ['authorFeed'] });

      const previousTimeline = queryClient.getQueryData(['timeline']);
      const previousCannectFeed = queryClient.getQueryData(['cannectFeed']);
      const previousglobalFeed = queryClient.getQueryData(['globalFeed']);

      const updatePostInFeed = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.map((item: FeedViewPost) => {
              if (item.post.uri === postUri) {
                return {
                  ...item,
                  post: {
                    ...item.post,
                    repostCount: Math.max((item.post.repostCount || 1) - 1, 0),
                    viewer: { ...item.post.viewer, repost: undefined },
                  },
                };
              }
              return item;
            }),
          })),
        };
      };

      queryClient.setQueryData(['timeline'], updatePostInFeed);
      queryClient.setQueryData(['cannectFeed'], updatePostInFeed);
      queryClient.setQueryData(['globalFeed'], updatePostInFeed);
      queryClient.setQueriesData({ queryKey: ['authorFeed'] }, updatePostInFeed);

      return { previousTimeline, previousCannectFeed, previousglobalFeed };
    },
    onError: (err, variables, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline'], context.previousTimeline);
      }
      if (context?.previousCannectFeed) {
        queryClient.setQueryData(['cannectFeed'], context.previousCannectFeed);
      }
      if (context?.previousglobalFeed) {
        queryClient.setQueryData(['globalFeed'], context.previousglobalFeed);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['cannectFeed'] });
      queryClient.invalidateQueries({ queryKey: ['globalFeed'] });
      queryClient.invalidateQueries({ queryKey: ['authorFeed'] });
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

/**
 * Get trending hashtags from Cannect feed generator
 */
export function useTrending(hours = 24, limit = 10) {
  const { isAuthenticated } = useAuthStore();
  
  return useQuery({
    queryKey: ['trending', hours, limit],
    queryFn: async () => {
      const response = await fetch(
        `https://feed.cannect.space/trending?hours=${hours}&limit=${limit}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch trending');
      }
      const data = await response.json() as {
        hashtags: { tag: string; count: number; posts: number }[];
        analyzedPosts: number;
        timeWindow: string;
      };
      return data;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
