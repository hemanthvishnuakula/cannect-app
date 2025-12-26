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
 * Get Following feed - posts from users the current user follows
 * Fetches followed users, then their posts, sorted by date
 */
export function useTimeline() {
  const { isAuthenticated, did } = useAuthStore();


  return useInfiniteQuery({
    queryKey: ['timeline', did],
    queryFn: async ({ pageParam }) => {
      if (!did) {
        return { feed: [], cursor: undefined };
      }
      
      // Get users the current user follows
      const followsResult = await atproto.getFollows(did, undefined, 100);
      const followedUsers = followsResult.data.follows;
      
      if (followedUsers.length === 0) {
        return { feed: [], cursor: undefined };
      }
      
      // Fetch recent posts from all followed users in parallel
      // Get 5 posts per user
      const results = await Promise.allSettled(
        followedUsers.map(async (user) => {
          try {
            const feed = await atproto.getAuthorFeed(user.did, undefined, 5, 'posts_no_replies');
            return feed.data.feed;
          } catch {
            return [];
          }
        })
      );
      
      // Collect all posts
      const allPosts: FeedViewPost[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          allPosts.push(...result.value);
        }
      }
      
      // Sort by createdAt (when user posted) - not indexedAt (when network indexed)
      const sorted = allPosts.sort((a, b) => {
        const aDate = (a.post.record as any)?.createdAt || a.post.indexedAt;
        const bDate = (b.post.record as any)?.createdAt || b.post.indexedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      // Apply content moderation filter
      const moderated = filterFeedForModeration(sorted);
      
      // Parse cursor for pagination through sorted results
      const offset = pageParam ? parseInt(pageParam, 10) : 0;
      const pageSize = 20;
      
      // Get the page slice
      const pageSlice = moderated.slice(offset, offset + pageSize);
      
      // Calculate next cursor
      const nextOffset = offset + pageSize;
      const hasMore = nextOffset < moderated.length;
      
      return {
        feed: pageSlice,
        cursor: hasMore ? String(nextOffset) : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated && !!did,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Top cannabis feeds on Bluesky - aggregated for Global feed
 * Multiple feeds combined for diverse, high-quality content
 * Sorted by likes/popularity - feeds may go offline, handled gracefully
 */
const CANNABIS_FEEDS = [
  // Top 5 (most popular)
  {
    name: 'The Weed Feed',
    uri: 'at://did:plc:kil6rach2ost5soyq4qc3yyj/app.bsky.feed.generator/aaacchngc7ky4',
    likes: 308,
  },
  {
    name: 'WeedMob',
    uri: 'at://did:plc:bz77aitjmyojh2gcrzle55qt/app.bsky.feed.generator/aaajk2dvt3bnu',
    likes: 224,
  },
  {
    name: 'Cannabis Community 420',
    uri: 'at://did:plc:ofa3uzadvnxtusxbpr6yvdck/app.bsky.feed.generator/aaanpawlgfvb6',
    likes: 76,
  },
  {
    name: 'Weedsky',
    uri: 'at://did:plc:icrcghfflckt22o7dhyyuzfl/app.bsky.feed.generator/aaakxsdsjsy64',
    likes: 69,
  },
  {
    name: 'Cannabis',
    uri: 'at://did:plc:lr32wj3jvvt3reue6wexabfh/app.bsky.feed.generator/aaahmzu672jva',
    likes: 51,
  },
  // Additional feeds
  {
    name: 'Maconha',
    uri: 'at://did:plc:lqzay5ya6b7gwyn45qbl2s4x/app.bsky.feed.generator/maconha',
    likes: 44,
  },
  {
    name: 'The Weed Feed 🥦💚',
    uri: 'at://did:plc:pn26lakhwjdhgcwmjth3xfnn/app.bsky.feed.generator/aaaco4ykybqh4',
    likes: 41,
  },
  {
    name: 'Skyhigh',
    uri: 'at://did:plc:yyds2w4plzj2atyn7yirzxo4/app.bsky.feed.generator/aaadytslg5w5s',
    likes: 29,
  },
  {
    name: 'Cannabis+ (DE)',
    uri: 'at://did:plc:mdn3kmif4emrl5ipgjwgi3bs/app.bsky.feed.generator/feed420',
    likes: 27,
  },
  {
    name: '420Sky',
    uri: 'at://did:plc:wlmqo4tsne55b7acvmmygswh/app.bsky.feed.generator/aaak3xiau2t3y',
    likes: 20,
  },
  {
    name: 'Black Cannabis Community',
    uri: 'at://did:plc:v42wslr7d5oixwivjwwlg2ra/app.bsky.feed.generator/blackcannabis',
    likes: 18,
  },
  {
    name: 'Weed Memes',
    uri: 'at://did:plc:23mflh3oyzajrpua5dmy7cj5/app.bsky.feed.generator/aaaohjsoof6aa',
    likes: 15,
  },
  {
    name: 'CannabisSky',
    uri: 'at://did:plc:pvyuheklxfqw6cdnmam2u5yw/app.bsky.feed.generator/aaagareaigvvg',
    likes: 14,
  },
  {
    name: 'Cannabis Cultivators 🍃',
    uri: 'at://did:plc:nukogzpij6wd4cx35lhonnaq/app.bsky.feed.generator/aaag6zmge756k',
    likes: 12,
  },
];

// Track feed failures to avoid spamming logs
const feedFailures = new Map<string, number>();

/**
 * Get Global feed - aggregated cannabis content from multiple Bluesky feeds
 * Fetches from all cannabis feeds, deduplicates, and sorts by recency
 */
export function useGlobalFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['globalFeed'],
    queryFn: async ({ pageParam }) => {
      // Parse cursors for each feed (stored as JSON)
      const cursors: Record<string, string | undefined> = pageParam 
        ? JSON.parse(pageParam) 
        : {};
      
      // Fetch from all feeds in parallel
      const feedResults = await Promise.allSettled(
        CANNABIS_FEEDS.map(async (feed) => {
          try {
            const result = await atproto.getExternalFeed(
              feed.uri, 
              cursors[feed.uri], 
              8  // Get 8 from each feed (14 feeds * 8 = 112 max posts)
            );
            // Reset failure count on success
            feedFailures.delete(feed.uri);
            return { 
              feedUri: feed.uri, 
              data: result.data,
              name: feed.name 
            };
          } catch (error: any) {
            // Track failures - only log first occurrence to avoid spam
            const failCount = (feedFailures.get(feed.uri) || 0) + 1;
            feedFailures.set(feed.uri, failCount);
            
            if (failCount === 1) {
              // Only log on first failure
              const status = error?.status || error?.response?.status || 'unknown';
              console.log(`[Feed] ${feed.name} unavailable (${status})`);
            }
            return null;
          }
        })
      );

      // Collect posts and new cursors
      const allPosts: FeedViewPost[] = [];
      const newCursors: Record<string, string | undefined> = {};
      const seenUris = new Set<string>();

      for (const result of feedResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { feedUri, data } = result.value;
          newCursors[feedUri] = data.cursor;
          
          // Deduplicate by post URI
          for (const item of data.feed) {
            if (!seenUris.has(item.post.uri)) {
              seenUris.add(item.post.uri);
              allPosts.push(item);
            }
          }
        }
      }

      // Sort by createdAt (when user posted) - not indexedAt (when network indexed)
      const sorted = allPosts.sort((a, b) => {
        const aDate = (a.post.record as any)?.createdAt || a.post.indexedAt;
        const bDate = (b.post.record as any)?.createdAt || b.post.indexedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      // Apply content moderation filter
      const moderated = filterFeedForModeration(sorted);

      // Check if any feed has more content
      const hasMore = Object.values(newCursors).some(c => c !== undefined);

      return {
        feed: moderated,
        cursor: hasMore ? JSON.stringify(newCursors) : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

/**
 * Get Cannect feed - posts from Cannect PDS users
 * Fetches from ALL users, sorts globally by date, then paginates
 */
export function useCannectFeed() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['cannectFeed'],
    queryFn: async ({ pageParam }) => {
      // Get all Cannect user DIDs from PDS
      const dids = await atproto.listPdsRepos(100);
      if (dids.length === 0) {
        return { feed: [], cursor: undefined };
      }
      
      // Fetch recent posts from ALL users in parallel
      // Get 3 posts per user to keep it fast (86 users × 3 = ~258 posts max)
      const results = await Promise.allSettled(
        dids.map(async (did) => {
          try {
            const feed = await atproto.getAuthorFeed(did, undefined, 3, 'posts_no_replies');
            return feed.data.feed;
          } catch {
            return [];
          }
        })
      );
      
      // Collect all posts
      const allPosts: FeedViewPost[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          allPosts.push(...result.value);
        }
      }
      
      // Sort by createdAt (when user posted) - not indexedAt (when network indexed)
      const sorted = allPosts.sort((a, b) => {
        const aDate = (a.post.record as any)?.createdAt || a.post.indexedAt;
        const bDate = (b.post.record as any)?.createdAt || b.post.indexedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      // Apply content moderation filter
      const moderated = filterFeedForModeration(sorted);
      
      // Parse cursor for pagination through sorted results
      const offset = pageParam ? parseInt(pageParam, 10) : 0;
      const pageSize = 20;
      
      // Get the page slice
      const pageSlice = moderated.slice(offset, offset + pageSize);
      
      // Calculate next cursor
      const nextOffset = offset + pageSize;
      const hasMore = nextOffset < moderated.length;
      
      return {
        feed: pageSlice,
        cursor: hasMore ? String(nextOffset) : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
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
 * Delete a post with optimistic update
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (uri: string) => {
      await atproto.deletePost(uri);
      return uri;
    },
    onMutate: async (uri: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['timeline'] });
      await queryClient.cancelQueries({ queryKey: ['cannectFeed'] });
      await queryClient.cancelQueries({ queryKey: ['globalFeed'] });
      await queryClient.cancelQueries({ queryKey: ['authorFeed'] });
      await queryClient.cancelQueries({ queryKey: ['actorLikes'] });

      // Snapshot previous values for rollback
      const previousTimeline = queryClient.getQueryData(['timeline']);
      const previousCannectFeed = queryClient.getQueryData(['cannectFeed']);
      const previousGlobalFeed = queryClient.getQueryData(['globalFeed']);
      const previousAuthorFeed = queryClient.getQueriesData({ queryKey: ['authorFeed'] });
      const previousActorLikes = queryClient.getQueriesData({ queryKey: ['actorLikes'] });

      // Helper to remove post from feed data
      const removePostFromFeed = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.filter((item: FeedViewPost) => item.post.uri !== uri),
          })),
        };
      };

      // Optimistically remove from all feeds
      queryClient.setQueryData(['timeline'], removePostFromFeed);
      queryClient.setQueryData(['cannectFeed'], removePostFromFeed);
      queryClient.setQueryData(['globalFeed'], removePostFromFeed);
      queryClient.setQueriesData({ queryKey: ['authorFeed'] }, removePostFromFeed);
      queryClient.setQueriesData({ queryKey: ['actorLikes'] }, removePostFromFeed);

      return { previousTimeline, previousCannectFeed, previousGlobalFeed, previousAuthorFeed, previousActorLikes };
    },
    onError: (err, uri, context) => {
      // Rollback on error
      if (context?.previousTimeline) {
        queryClient.setQueryData(['timeline'], context.previousTimeline);
      }
      if (context?.previousCannectFeed) {
        queryClient.setQueryData(['cannectFeed'], context.previousCannectFeed);
      }
      if (context?.previousGlobalFeed) {
        queryClient.setQueryData(['globalFeed'], context.previousGlobalFeed);
      }
      if (context?.previousAuthorFeed) {
        context.previousAuthorFeed.forEach(([queryKey, data]: [any, any]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousActorLikes) {
        context.previousActorLikes.forEach(([queryKey, data]: [any, any]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    // NOTE: We intentionally do NOT refetch after delete
    // The optimistic update already removed the post from cache
    // Refetching would bring back the post due to AppView caching delays
    // The next natural refetch (pull-to-refresh, navigation, etc.) will sync
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
      // Update thread queries
      queryClient.setQueriesData({ queryKey: ['thread'] }, (old: any) => {
        if (!old?.thread?.post) return old;
        if (old.thread.post.uri === uri) {
          return {
            ...old,
            thread: {
              ...old.thread,
              post: {
                ...old.thread.post,
                likeCount: (old.thread.post.likeCount || 0) + 1,
                viewer: { ...old.thread.post.viewer, like: 'pending' },
              },
            },
          };
        }
        return old;
      });

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
      await queryClient.cancelQueries({ queryKey: ['actorLikes'] });

      const previousTimeline = queryClient.getQueryData(['timeline']);
      const previousCannectFeed = queryClient.getQueryData(['cannectFeed']);
      const previousglobalFeed = queryClient.getQueryData(['globalFeed']);
      const previousActorLikes = queryClient.getQueriesData({ queryKey: ['actorLikes'] });

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

      // Remove post from actorLikes (Likes tab on profile)
      const removeFromLikes = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            feed: page.feed.filter((item: FeedViewPost) => item.post.uri !== postUri),
          })),
        };
      };

      queryClient.setQueryData(['timeline'], updatePostInFeed);
      queryClient.setQueryData(['cannectFeed'], updatePostInFeed);
      queryClient.setQueryData(['globalFeed'], updatePostInFeed);
      queryClient.setQueriesData({ queryKey: ['authorFeed'] }, updatePostInFeed);
      queryClient.setQueriesData({ queryKey: ['actorLikes'] }, removeFromLikes);
      
      // Update thread queries for unlike
      queryClient.setQueriesData({ queryKey: ['thread'] }, (old: any) => {
        if (!old?.thread?.post) return old;
        if (old.thread.post.uri === postUri) {
          return {
            ...old,
            thread: {
              ...old.thread,
              post: {
                ...old.thread.post,
                likeCount: Math.max((old.thread.post.likeCount || 1) - 1, 0),
                viewer: { ...old.thread.post.viewer, like: undefined },
              },
            },
          };
        }
        return old;
      });

      return { previousTimeline, previousCannectFeed, previousglobalFeed, previousActorLikes };
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
      // Restore actorLikes on error
      if (context?.previousActorLikes) {
        context.previousActorLikes.forEach(([queryKey, data]: [any, any]) => {
          queryClient.setQueryData(queryKey, data);
        });
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
      // Update thread queries for repost
      queryClient.setQueriesData({ queryKey: ['thread'] }, (old: any) => {
        if (!old?.thread?.post) return old;
        if (old.thread.post.uri === uri) {
          return {
            ...old,
            thread: {
              ...old.thread,
              post: {
                ...old.thread.post,
                repostCount: (old.thread.post.repostCount || 0) + 1,
                viewer: { ...old.thread.post.viewer, repost: 'pending' },
              },
            },
          };
        }
        return old;
      });

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
      queryClient.invalidateQueries({ queryKey: ['thread'] });
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

      // Also update thread queries
      queryClient.setQueriesData({ queryKey: ['thread'] }, (old: any) => {
        if (!old?.thread?.post) return old;
        if (old.thread.post.uri === postUri) {
          return {
            ...old,
            thread: {
              ...old.thread,
              post: {
                ...old.thread.post,
                repostCount: Math.max((old.thread.post.repostCount || 1) - 1, 0),
                viewer: { ...old.thread.post.viewer, repost: undefined },
              },
            },
          };
        }
        return old;
      });

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
      queryClient.invalidateQueries({ queryKey: ['thread'] });
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
