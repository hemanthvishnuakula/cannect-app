/**
 * useThread - Fetch complete thread with ancestors and nested descendants
 * 
 * Federation-Ready (Bluesky AT Protocol compatible):
 * - Uses thread_parent_id instead of reply_to_id
 * - Uses thread_root_id for fast thread lookups
 * - Uses replies_count instead of comments_count
 * - Walks up thread_parent_id chain for full ancestor context
 * - Fetches nested replies up to MAX_INLINE_DEPTH levels
 * - Supports optimistic updates for new replies
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores';
import type { PostWithAuthor } from '@/lib/types/database';
import type { ThreadView, ThreadNode } from '@/lib/types/thread';

const POST_SELECT = `
  *,
  author:profiles!user_id(*),
  original_post:repost_of_id(
    *,
    author:profiles!user_id(*)
  )
`;

// Simpler select for INSERT operations (avoid nested query issues)
const INSERT_SELECT = `*, author:profiles!user_id(*)`;

/**
 * Fetch the complete thread view for a post
 */
export function useThread(postId: string) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ['thread', postId],
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

      // 2. Fetch like status if logged in
      let isLiked = false;
      if (user) {
        const { data: like } = await supabase
          .from('likes')
          .select('id')
          .eq('post_id', postId)
          .eq('user_id', user.id)
          .maybeSingle();
        isLiked = !!like;
      }

      // 3. Recursively fetch ancestors (walk up thread_parent_id chain)
      const ancestors = await fetchAncestors(focusedPost.thread_parent_id, user?.id);

      // 4. Fetch descendants with nesting (2 levels deep)
      const descendants = await fetchDescendants(postId, 0, 2, user?.id);

      return {
        focusedPost: { ...focusedPost, is_liked: isLiked } as PostWithAuthor,
        ancestors: ancestors.reverse(), // Root first
        descendants,
        totalReplies: focusedPost.replies_count || 0,
        hasMoreAncestors: false,
      };
    },
    enabled: !!postId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Recursively fetch ancestor posts up the thread chain
 * 
 * Uses thread_parent_id for walking up the thread tree
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
 * Fetch descendants with nested structure
 * 
 * Uses thread_parent_id to find direct children
 */
async function fetchDescendants(
  parentId: string,
  currentDepth: number,
  maxDepth: number,
  userId?: string,
  limit: number = 10
): Promise<ThreadNode[]> {
  const { data: replies, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('thread_parent_id', parentId)
    .eq('is_reply', true)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error || !replies) return [];

  // Batch fetch like statuses
  let likeMap: Record<string, boolean> = {};
  if (userId && replies.length > 0) {
    const { data: likes } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId)
      .in('post_id', replies.map(r => r.id));
    
    likeMap = (likes || []).reduce((acc, l) => {
      acc[l.post_id] = true;
      return acc;
    }, {} as Record<string, boolean>);
  }

  return Promise.all(
    replies.map(async (reply) => {
      const replyWithLike = { 
        ...reply, 
        is_liked: likeMap[reply.id] || false 
      } as PostWithAuthor;

      // Fetch nested children if not at max depth
      const children = currentDepth < maxDepth
        ? await fetchDescendants(reply.id, currentDepth + 1, maxDepth, userId, 3)
        : [];

      return {
        post: replyWithLike,
        children,
        depth: currentDepth,
        hasMoreReplies: (reply.replies_count || 0) > children.length,
        replyCount: reply.replies_count || 0,
      };
    })
  );
}

/**
 * Create a reply in a thread with optimistic update
 * 
 * Federation-ready: Sets thread_parent_id and thread_root_id
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
        .select("thread_root_id, thread_depth, at_uri, at_cid, thread_root_uri, thread_root_cid")
        .eq("id", threadParentId)
        .single();
      
      const threadRootId = parentPost?.thread_root_id || threadParentId;
      const threadDepth = (parentPost?.thread_depth ?? 0) + 1;
      
      // Build AT Protocol threading fields (so trigger doesn't need to look them up)
      const threadParentUri = parentPost?.at_uri || null;
      const threadParentCid = parentPost?.at_cid || null;
      // Root is either the stored root or the parent itself (for direct replies to root posts)
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
          // AT Protocol fields for federation (stored directly, no lookups needed)
          thread_parent_uri: threadParentUri,
          thread_parent_cid: threadParentCid,
          thread_root_uri: threadRootUri,
          thread_root_cid: threadRootCid,
          type: 'post',
        })
        .select(INSERT_SELECT)
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async ({ content, parentId }) => {
      const threadParentId = parentId || threadPostId;
      
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['thread', threadPostId] });

      // Snapshot previous value
      const previousThread = queryClient.getQueryData<ThreadView>(['thread', threadPostId]);

      // Optimistically add the reply
      if (previousThread && user) {
        const ghostReply: ThreadNode = {
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
          children: [],
          depth: 0,
          hasMoreReplies: false,
          replyCount: 0,
        };

        queryClient.setQueryData<ThreadView>(['thread', threadPostId], {
          ...previousThread,
          descendants: [...previousThread.descendants, ghostReply],
          totalReplies: previousThread.totalReplies + 1,
        });
      }

      return { previousThread };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousThread) {
        queryClient.setQueryData(['thread', threadPostId], context.previousThread);
      }
    },
    onSettled: () => {
      // Refetch to get actual data
      queryClient.invalidateQueries({ queryKey: ['thread', threadPostId] });
    },
  });
}

/**
 * Load more replies for a specific parent post in the thread
 */
export function useLoadMoreReplies(threadPostId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ parentId, offset }: { parentId: string; offset: number }) => {
      const { data: replies, error } = await supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('thread_parent_id', parentId)
        .eq('is_reply', true)
        .order('created_at', { ascending: true })
        .range(offset, offset + 9);

      if (error) throw error;
      return { parentId, replies };
    },
    onSuccess: ({ parentId, replies }) => {
      // Update thread with new replies
      queryClient.setQueryData<ThreadView>(['thread', threadPostId], (old) => {
        if (!old) return old;
        
        // Find and update the parent node with new children
        const updateNode = (nodes: ThreadNode[]): ThreadNode[] => {
          return nodes.map(node => {
            if (node.post.id === parentId) {
              return {
                ...node,
                children: [
                  ...node.children,
                  ...replies.map(r => ({
                    post: r as PostWithAuthor,
                    children: [],
                    depth: node.depth + 1,
                    hasMoreReplies: false,
                    replyCount: r.replies_count || 0,
                  })),
                ],
                hasMoreReplies: replies.length === 10, // Has more if we got full page
              };
            }
            return {
              ...node,
              children: updateNode(node.children),
            };
          });
        };

        return {
          ...old,
          descendants: updateNode(old.descendants),
        };
      });
    },
  });
}
