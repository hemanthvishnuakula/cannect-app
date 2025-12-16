import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-client";
import type { PostWithAuthor } from "@/lib/types/database";
import { useAuthStore } from "@/lib/stores";

const POSTS_PER_PAGE = 20;

/**
 * Helper to enrich posts with "is_liked", "likes_count", and "is_reposted_by_me"
 */
async function fetchPostsWithCounts(query: any, userId?: string) {
  // 1. Get the raw posts
  const { data: posts, error } = await query;
  if (error) throw error;
  if (!posts) return [];

  // 2. Extract Post IDs
  const postIds = posts.map((p: any) => p.id);
  
  if (postIds.length === 0) return [];

  // 3. Get "Liked By Me" status
  let likedPostIds = new Set<string>();
  if (userId) {
    const { data: myLikes } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", postIds);
      
    myLikes?.forEach((l: any) => likedPostIds.add(l.post_id));
  }

  // 4. Get "Reposted By Me" status - check for posts where I reposted these IDs
  let repostedPostIds = new Set<string>();
  if (userId) {
    const { data: myReposts } = await supabase
      .from("posts")
      .select("repost_of_id, external_id")
      .eq("user_id", userId)
      .eq("is_repost", true);
      
    myReposts?.forEach((r: any) => {
      if (r.repost_of_id) repostedPostIds.add(r.repost_of_id);
      if (r.external_id) repostedPostIds.add(r.external_id);
    });
  }

  // 5. Return Enriched Posts
  return posts.map((post: any) => ({
    ...post,
    is_liked: likedPostIds.has(post.id),
    is_reposted_by_me: repostedPostIds.has(post.id),
    // Get count from the likes aggregate or fallback to column
    likes_count: post.likes?.[0]?.count ?? post.likes_count ?? 0,
  }));
}

// --- Modified Fetchers ---

export function useFeed() {
  const { user } = useAuthStore();
  
  return useInfiniteQuery({
    queryKey: queryKeys.posts.all,
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      // Select with a Count for likes
      // Note: For quoted_post, we use repost_of_id to get the original post this one is quoting
      // Also include external_* columns for shadow reposts of federated content
      const query = supabase
        .from("posts")
        .select(`
          *,
          author:profiles!user_id(*),
          likes:likes(count),
          quoted_post:repost_of_id(
            id,
            content,
            created_at,
            media_urls,
            author:profiles!user_id(*)
          ),
          external_id,
          external_source,
          external_metadata
        `)
        .eq("is_reply", false)
        .order("created_at", { ascending: false })
        .range(from, to);

      return fetchPostsWithCounts(query, user?.id);
    },
    getNextPageParam: (lastPage, allPages) => lastPage.length < POSTS_PER_PAGE ? undefined : allPages.length,
    initialPageParam: 0,
  });
}

export function usePost(postId: string) {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: queryKeys.posts.detail(postId),
    queryFn: async () => {
      const query = supabase
        .from("posts")
        .select(`
          *,
          author:profiles!user_id(*),
          likes:likes(count),
          quoted_post:repost_of_id(
            id,
            content,
            created_at,
            media_urls,
            author:profiles!user_id(*)
          ),
          external_id,
          external_source,
          external_metadata
        `)
        .eq("id", postId)
        .single();
      
      // Handle single result manually since fetchPostsWithCounts expects array
      const { data: post, error } = await query;
      if (error) throw error;
      
      const enriched = await fetchPostsWithCounts({ data: [post] }, user?.id);
      return enriched[0] as PostWithAuthor;
    },
    enabled: !!postId,
  });
}

export function usePostReplies(postId: string) {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: queryKeys.posts.replies(postId),
    queryFn: async () => {
      const query = supabase
        .from("posts")
        .select(`*, author:profiles!user_id(*), likes:likes(count)`)
        .eq("reply_to_id", postId)
        .order("created_at", { ascending: true });

      return fetchPostsWithCounts(query, user?.id);
    },
    enabled: !!postId,
  });
}

export function useUserPosts(userId: string) {
  const { user } = useAuthStore(); // Current user (viewer)
  return useInfiniteQuery({
    queryKey: queryKeys.posts.byUser(userId),
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      const query = supabase
        .from("posts")
        .select(`*, author:profiles!user_id(*), likes:likes(count)`)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(from, to);

      return fetchPostsWithCounts(query, user?.id);
    },
    getNextPageParam: (lastPage, allPages) => lastPage.length < POSTS_PER_PAGE ? undefined : allPages.length,
    initialPageParam: 0,
    enabled: !!userId,
  });
}

// --- Mutations with Optimistic Updates ---

export function useLikePost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (postId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("likes").insert({
        user_id: user.id,
        post_id: postId,
      });
      if (error) throw error;
      return postId;
    },
    // Optimistic Update: Update UI immediately
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);

      // Update Feed
      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            page.map((post: any) => 
              post.id === postId 
                ? { ...post, is_liked: true, likes_count: (post.likes_count || 0) + 1 }
                : post
            )
          ),
        };
      });

      return { previousPosts };
    },
    onError: (err, postId, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}

export function useUnlikePost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (postId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("likes")
        .delete()
        .eq("user_id", user.id)
        .eq("post_id", postId);
      if (error) throw error;
      return postId;
    },
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);

      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            page.map((post: any) => 
              post.id === postId 
                ? { ...post, is_liked: false, likes_count: Math.max(0, (post.likes_count || 0) - 1) }
                : post
            )
          ),
        };
      });

      return { previousPosts };
    },
    onError: (err, postId, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}

// Keep existing hooks below

export function useCreatePost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore(); // Use store instead of calling getSession

  return useMutation({
    mutationFn: async ({ content, mediaUrls, replyToId }: { content: string; mediaUrls?: string[]; replyToId?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase.from("posts").insert({
        user_id: user.id,
        content,
        media_urls: mediaUrls,
        is_reply: !!replyToId,
        reply_to_id: replyToId,
        type: 'post', // Explicitly set type to 'post' for new posts
        is_repost: false,
      }).select(`*, author:profiles!user_id(*)`).single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Invalidate both feed and the user's own profile to update post_count
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user?.id!) });
    },
  });
}

export function useRepost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ originalPost, content = "" }: { originalPost: any, content?: string }) => {
      if (!user) throw new Error("Not authenticated");
      
      const insertData: any = {
        user_id: user.id,
        content: content,
        is_repost: true,
      };

      // If it's a federated post, save as an external reference (Shadow Repost)
      if (originalPost.is_federated) {
        insertData.external_id = originalPost.id; // Bluesky CID
        insertData.external_source = "bluesky";
        insertData.external_metadata = {
          author: originalPost.author,
          content: originalPost.content,
          media_urls: originalPost.media_urls,
          created_at: originalPost.created_at,
          likes_count: originalPost.likes_count,
          reposts_count: originalPost.reposts_count,
          comments_count: originalPost.comments_count,
        };
        insertData.type = content ? 'quote' : 'repost';
      } else {
        // Internal post - use repost_of_id
        insertData.repost_of_id = originalPost.id;
        insertData.type = content ? 'quote' : 'repost';
      }

      const { error } = await supabase.from("posts").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}

/**
 * Toggle Repost - Creates or Undoes a simple repost
 * Green icon = already reposted (click to undo)
 * Grey icon = not reposted (click to repost)
 */
export function useToggleRepost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ post, undo = false }: { post: any, undo?: boolean }) => {
      if (!user) throw new Error("Not authenticated");

      if (undo || post.is_reposted_by_me) {
        // UNDO REPOST: Delete the repost row from our posts table
        if (post.is_federated) {
          // For federated posts, match by external_id
          const { error } = await supabase
            .from("posts")
            .delete()
            .eq("user_id", user.id)
            .eq("external_id", post.id)
            .eq("is_repost", true);
          if (error) throw error;
        } else {
          // For internal posts, match by repost_of_id and type="repost" (not quote)
          const { error } = await supabase
            .from("posts")
            .delete()
            .eq("user_id", user.id)
            .eq("repost_of_id", post.id)
            .eq("type", "repost");
          if (error) throw error;
        }
      } else {
        // CREATE SIMPLE REPOST
        const insertData: any = {
          user_id: user.id,
          content: "",
          is_repost: true,
          type: "repost",
        };

        if (post.is_federated) {
          insertData.external_id = post.id;
          insertData.external_source = "bluesky";
          insertData.external_metadata = {
            author: post.author,
            content: post.content,
            media_urls: post.media_urls,
            created_at: post.created_at,
            likes_count: post.likes_count,
            reposts_count: post.reposts_count,
            comments_count: post.comments_count,
          };
        } else {
          insertData.repost_of_id = post.id;
        }

        const { error } = await supabase.from("posts").insert(insertData);
        if (error) throw error;
      }
    },
    // Optimistic update for instant feedback
    onMutate: async ({ post, undo }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      
      const shouldUndo = undo || post.is_reposted_by_me;

      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            page.map((p: any) => 
              p.id === post.id 
                ? { 
                    ...p, 
                    is_reposted_by_me: !shouldUndo,
                    reposts_count: shouldUndo 
                      ? Math.max(0, (p.reposts_count || 0) - 1)
                      : (p.reposts_count || 0) + 1
                  }
                : p
            )
          ),
        };
      });

      return { previousPosts };
    },
    onError: (err, vars, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.posts.all })
  });
}
