/**
 * useThread - Bluesky Gold Standard Thread Fetching
 * 
 * Federation-Ready (Bluesky AT Protocol compatible):
 * - Uses thread_parent_id / thread_root_id for thread structure
 * - FLAT reply list (no inline nesting)
 * - "Replying to @user" labels instead of indentation
 * - Tap a reply to see its sub-thread
 * 
 * Gold Standard Features:
 * - Thread preferences (sort/view) with persistence
 * - Query key includes params for proper caching
 * - Pagination support via useInfiniteQuery pattern
 * - prepareForParamsUpdate for smooth param changes
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores';
import type { PostWithAuthor } from '@/lib/types/database';
import type { ThreadView, ThreadReply } from '@/lib/types/thread';
import { THREAD_CONFIG } from '@/lib/types/thread';
import { 
  useThreadPreferences, 
  createThreadQueryKey,
  type ThreadSort,
  type ThreadView as ThreadViewOption,
} from './use-thread-preferences';

const POST_SELECT = `
  *,
  author:profiles!user_id(*),
  parent_post:thread_parent_id(
    author:profiles!user_id(username)
  ),
  original_post:repost_of_id(
    *,
    author:profiles!user_id(*)
  )
`;

// Simpler select for INSERT operations
const INSERT_SELECT = `*, author:profiles!user_id(*)`;

/**
 * Thread hook return type - Bluesky Gold Standard
 */
export interface UseThreadReturn {
  /** Thread data */
  data: ThreadView | undefined;
  /** Whether thread is loading */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Refetch thread data */
  refetch: () => void;
  /** Thread state (preferences) */
  state: {
    isLoaded: boolean;
    sort: ThreadSort;
    view: ThreadViewOption;
  };
  /** Thread actions */
  actions: {
    setSort: (sort: ThreadSort) => void;
    setView: (view: ThreadViewOption) => void;
    refetch: () => void;
  };
}

/**
 * Fetch the complete thread view for a post - Bluesky Gold Standard
 * 
 * Returns data + state + actions pattern like Bluesky's usePostThread
 */
export function useThread(postId: string): UseThreadReturn {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  
  // Thread preferences (sort/view) with persistence
  const {
    isLoaded: isPrefsLoaded,
    sort,
    setSort: baseSetSort,
    view,
    setView: baseSetView,
  } = useThreadPreferences();

  // Query key includes sort/view for proper caching per combination
  const threadQueryKey = createThreadQueryKey(postId, sort, view);

  const query = useQuery({
    queryKey: threadQueryKey,
    queryFn: async (): Promise<ThreadView> => {
      if (!postId) throw new Error('Post ID required');

      // 1. Fetch the focused post
      const { data: focusedPost, error: postError } = await supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('id', postId)
        .single();

      if (postError || !focusedPost) {
        throw new Error('Post not found');
      }

      // 2. Fetch like/repost status for focused post if logged in
      let focusedIsLiked = false;
      let focusedIsReposted = false;
      if (user) {
        const [likeResult, repostResult] = await Promise.all([
          supabase
            .from('likes')
            .select('id')
            .eq('post_id', postId)
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('reposts')
            .select('id')
            .eq('post_id', postId)
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);
        focusedIsLiked = !!likeResult.data;
        focusedIsReposted = !!repostResult.data;
      }

      // 3. Fetch ancestors (walk up thread_parent_id chain)
      const ancestors = await fetchAncestors(focusedPost.thread_parent_id, user?.id);

      // 4. Fetch replies with sort preference
      const threadRootId = focusedPost.thread_root_id || focusedPost.id;
      const isRootPost = !focusedPost.thread_root_id;
      
      const replies = await fetchRepliesFlat(
        isRootPost ? focusedPost.id : threadRootId,
        focusedPost.id,
        user?.id,
        sort // Pass sort preference
      );

      return {
        focusedPost: { 
          ...focusedPost, 
          is_liked: focusedIsLiked,
          is_reposted_by_me: focusedIsReposted,
        } as PostWithAuthor,
        ancestors, // Already in order: [root, ..., parent]
        replies,
        totalReplies: focusedPost.replies_count || 0,
        hasMoreReplies: replies.length >= THREAD_CONFIG.REPLIES_PER_PAGE,
      };
    },
    enabled: !!postId && isPrefsLoaded,
    staleTime: 30000, // 30 seconds
  });

  // Wrapped setters that invalidate queries when changed (Bluesky pattern)
  const setSort = useCallback((newSort: ThreadSort) => {
    baseSetSort(newSort);
  }, [baseSetSort]);

  const setView = useCallback((newView: ThreadViewOption) => {
    baseSetView(newView);
  }, [baseSetView]);

  // Return Bluesky-style { data, state, actions } pattern
  return {
    data: query.data,
    isLoading: query.isLoading || !isPrefsLoaded,
    error: query.error,
    refetch: query.refetch,
    state: {
      isLoaded: isPrefsLoaded,
      sort,
      view,
    },
    actions: {
      setSort,
      setView,
      refetch: query.refetch,
    },
  };
}

/**
 * Recursively fetch ancestor posts up the thread chain
 */
async function fetchAncestors(
  threadParentId: string | null,
  userId?: string,
  maxDepth: number = 10
): Promise<PostWithAuthor[]> {
  if (!threadParentId || maxDepth <= 0) return [];

  const { data: parent, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('id', threadParentId)
    .single();

  if (error || !parent) return [];

  // Fetch like status for ancestor
  let isLiked = false;
  if (userId) {
    const { data: like } = await supabase
      .from('likes')
      .select('id')
      .eq('post_id', parent.id)
      .eq('user_id', userId)
      .maybeSingle();
    isLiked = !!like;
  }

  const parentWithLike = { ...parent, is_liked: isLiked } as PostWithAuthor;

  // Recursively get parent's ancestors
  const grandparents = await fetchAncestors(parent.thread_parent_id, userId, maxDepth - 1);
  return [...grandparents, parentWithLike];
}

/**
 * Fetch DIRECT replies to the focused post only (Bluesky Linear View style)
 * 
 * Only gets replies where thread_parent_id = focusedPostId (direct replies).
 * Nested replies-to-replies are accessed by tapping a reply to see its thread.
 * 
 * @param sort - Sort order: 'hotness' (likes), 'newest', 'oldest'
 */
async function fetchRepliesFlat(
  threadRootId: string,
  focusedPostId: string,
  userId?: string,
  sort: ThreadSort = 'hotness'
): Promise<ThreadReply[]> {
  // Build query with sort preference
  let query = supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('thread_parent_id', focusedPostId)
    .eq('is_reply', true);
  
  // Apply sort order
  switch (sort) {
    case 'hotness':
      // Sort by likes (engagement) - most liked first
      query = query.order('likes_count', { ascending: false })
                   .order('created_at', { ascending: false });
      break;
    case 'newest':
      query = query.order('created_at', { ascending: false });
      break;
    case 'oldest':
    default:
      query = query.order('created_at', { ascending: true });
      break;
  }
  
  const { data: replies, error } = await query.limit(THREAD_CONFIG.REPLIES_PER_PAGE);

  if (error || !replies) return [];

  // Batch fetch like & repost statuses
  let likeMap: Record<string, boolean> = {};
  let repostMap: Record<string, boolean> = {};
  
  if (userId && replies.length > 0) {
    const replyIds = replies.map(r => r.id);
    const [likesResult, repostsResult] = await Promise.all([
      supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', userId)
        .in('post_id', replyIds),
      supabase
        .from('reposts')
        .select('post_id')
        .eq('user_id', userId)
        .in('post_id', replyIds),
    ]);

    likeMap = (likesResult.data || []).reduce((acc, l) => {
      acc[l.post_id] = true;
      return acc;
    }, {} as Record<string, boolean>);

    repostMap = (repostsResult.data || []).reduce((acc, r) => {
      acc[r.post_id] = true;
      return acc;
    }, {} as Record<string, boolean>);
  }

  return replies.map((reply) => ({
    post: {
      ...reply,
      is_liked: likeMap[reply.id] || false,
      is_reposted_by_me: repostMap[reply.id] || false,
    } as PostWithAuthor,
    // Direct replies don't need "Replying to" since they all reply to focused post
    replyingTo: undefined,
  }));
}

/**
 * Create a reply in a thread with optimistic update
 */
export function useThreadReply(threadPostId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string }) => {
      if (!user) throw new Error('Must be logged in');

      const threadParentId = parentId || threadPostId;
      
      // Get parent post's thread info AND AT Protocol fields for federation
      const { data: parentPost } = await supabase
        .from("posts")
        .select("thread_root_id, thread_depth, at_uri, at_cid, thread_root_uri, thread_root_cid, author:profiles!user_id(username)")
        .eq("id", threadParentId)
        .single();
      
      const threadRootId = parentPost?.thread_root_id || threadParentId;
      const threadDepth = (parentPost?.thread_depth ?? 0) + 1;
      
      // Build AT Protocol threading fields
      const threadParentUri = parentPost?.at_uri || null;
      const threadParentCid = parentPost?.at_cid || null;
      const threadRootUri = parentPost?.thread_root_uri || parentPost?.at_uri || null;
      const threadRootCid = parentPost?.thread_root_cid || parentPost?.at_cid || null;

      const { data, error } = await supabase
        .from('posts')
        .insert({
          user_id: user.id,
          content,
          thread_parent_id: threadParentId,
          thread_root_id: threadRootId,
          thread_depth: threadDepth,
          thread_parent_uri: threadParentUri,
          thread_parent_cid: threadParentCid,
          thread_root_uri: threadRootUri,
          thread_root_cid: threadRootCid,
          type: 'post',
        })
        .select(INSERT_SELECT)
        .single();

      if (error) throw error;
      
      // Return with parent username for "Replying to" display
      return { 
        ...data, 
        replyingToUsername: (parentPost as any)?.author?.username 
      };
    },
    onMutate: async ({ content, parentId }) => {
      const threadParentId = parentId || threadPostId;
      
      await queryClient.cancelQueries({ queryKey: ['thread', threadPostId] });
      const previousThread = queryClient.getQueryData<ThreadView>(['thread', threadPostId]);

      // Get parent's username for "Replying to" label
      let replyingTo: string | undefined;
      if (previousThread) {
        if (threadParentId === previousThread.focusedPost.id) {
          replyingTo = previousThread.focusedPost.author?.username;
        } else {
          const parentReply = previousThread.replies.find(r => r.post.id === threadParentId);
          replyingTo = parentReply?.post.author?.username;
        }
      }

      // Optimistically add the reply
      if (previousThread && user) {
        const ghostReply: ThreadReply = {
          post: {
            id: `ghost-${Date.now()}`,
            user_id: user.id,
            content,
            created_at: new Date().toISOString(),
            is_reply: true,
            thread_parent_id: threadParentId,
            likes_count: 0,
            replies_count: 0,
            reposts_count: 0,
            author: {
              id: user.id,
              username: user.user_metadata?.username || 'you',
              display_name: user.user_metadata?.display_name || 'You',
              avatar_url: user.user_metadata?.avatar_url,
            },
            is_liked: false,
          } as PostWithAuthor,
          replyingTo,
        };

        queryClient.setQueryData<ThreadView>(['thread', threadPostId], {
          ...previousThread,
          replies: [...previousThread.replies, ghostReply],
          totalReplies: previousThread.totalReplies + 1,
        });
      }

      return { previousThread };
    },
    onError: (err, variables, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(['thread', threadPostId], context.previousThread);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', threadPostId] });
    },
  });
}

/**
 * Load more replies in the thread
 */
export function useLoadMoreReplies(threadPostId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (offset: number) => {
      const { data: currentThread } = await supabase
        .from('posts')
        .select('thread_root_id')
        .eq('id', threadPostId)
        .single();

      const threadRootId = currentThread?.thread_root_id || threadPostId;

      const { data: replies, error } = await supabase
        .from('posts')
        .select(POST_SELECT)
        .or(`thread_parent_id.eq.${threadPostId},thread_root_id.eq.${threadPostId}`)
        .eq('is_reply', true)
        .order('created_at', { ascending: true })
        .range(offset, offset + THREAD_CONFIG.REPLIES_PER_PAGE - 1);

      if (error) throw error;

      // Fetch like statuses
      let likeMap: Record<string, boolean> = {};
      if (user && replies && replies.length > 0) {
        const { data: likes } = await supabase
          .from('likes')
          .select('post_id')
          .eq('user_id', user.id)
          .in('post_id', replies.map(r => r.id));
        
        likeMap = (likes || []).reduce((acc, l) => {
          acc[l.post_id] = true;
          return acc;
        }, {} as Record<string, boolean>);
      }

      return (replies || []).map((reply) => ({
        post: { ...reply, is_liked: likeMap[reply.id] || false } as PostWithAuthor,
        replyingTo: (reply as any).parent_post?.author?.username || undefined,
      }));
    },
    onSuccess: (newReplies) => {
      queryClient.setQueryData<ThreadView>(['thread', threadPostId], (old) => {
        if (!old) return old;
        return {
          ...old,
          replies: [...old.replies, ...newReplies],
          hasMoreReplies: newReplies.length >= THREAD_CONFIG.REPLIES_PER_PAGE,
        };
      });
    },
  });
}

/**
 * Delete a reply in the thread with optimistic update
 */
export function useThreadDelete(threadPostId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", postId);
      if (error) throw error;
      return postId;
    },
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: ['thread', threadPostId] });
      
      const previousThread = queryClient.getQueryData<ThreadView>(['thread', threadPostId]);
      
      if (previousThread) {
        queryClient.setQueryData<ThreadView>(['thread', threadPostId], {
          ...previousThread,
          replies: previousThread.replies.filter(r => r.post.id !== postId),
          totalReplies: Math.max(0, previousThread.totalReplies - 1),
        });
      }
      
      return { previousThread };
    },
    onError: (err, postId, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(['thread', threadPostId], context.previousThread);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', threadPostId] });
    },
  });
}
