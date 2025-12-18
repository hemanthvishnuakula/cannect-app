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

  // 2. Extract Post IDs (include both wrapper and original content IDs)
  const postIds = posts.map((p: any) => p.id);
  const originalContentIds = posts
    .filter((p: any) => p.quoted_post?.id)
    .map((p: any) => p.quoted_post.id);
  const allRelevantIds = Array.from(new Set([...postIds, ...originalContentIds]));
  
  if (allRelevantIds.length === 0) return [];

  // 3. Get "Liked By Me" status (check both wrapper and original content)
  let likedPostIds = new Set<string>();
  if (userId) {
    const { data: myLikes } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", allRelevantIds);
      
    myLikes?.forEach((l: any) => likedPostIds.add(l.post_id));
  }

  // 4. Get "Reposted By Me" status - check for SIMPLE reposts only (type='repost')
  // Quote posts (type='quote') don't count as "reposted" for the toggle button
  let repostedPostIds = new Set<string>();
  if (userId) {
    const { data: myReposts } = await supabase
      .from("posts")
      .select("repost_of_id, external_id")
      .eq("user_id", userId)
      .eq("type", "repost");
      
    myReposts?.forEach((r: any) => {
      if (r.repost_of_id) repostedPostIds.add(r.repost_of_id);
      if (r.external_id) repostedPostIds.add(r.external_id);
    });
  }

  // 5. Return Enriched Posts with Live Engagement Sync
  return posts.map((post: any) => {
    // ✅ Gold Standard: For reposts, use the original post's live engagement
    const isRepost = post.type === 'repost' && post.quoted_post;
    const liveSource = isRepost ? post.quoted_post : post;
    const sourceId = liveSource?.id || post.id;
    
    return {
      ...post,
      // ✅ Check if the ORIGINAL content is liked (not the wrapper)
      is_liked: likedPostIds.has(sourceId),
      // ✅ Check if the ORIGINAL content is reposted by me
      is_reposted_by_me: repostedPostIds.has(sourceId) || repostedPostIds.has(post.id),
      // Sync live counts from original post if it's a repost
      likes_count: isRepost && liveSource?.likes 
        ? (liveSource.likes?.[0]?.count ?? liveSource.likes_count ?? 0)
        : (post.likes?.[0]?.count ?? post.likes_count ?? 0),
      comments_count: isRepost && liveSource?.comments_count !== undefined
        ? liveSource.comments_count
        : post.comments_count,
      // ✅ Sync reposts_count from original content (the "Viral" effect)
      reposts_count: isRepost && liveSource?.reposts_count !== undefined
        ? liveSource.reposts_count
        : post.reposts_count,
    };
  });
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
      // ✅ Gold Standard: Join parent_post for "Replying to" context
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
            is_reply,
            reply_to_id,
            comments_count,
            reposts_count,
            quoted_post_id:repost_of_id,
            author:profiles!user_id(*),
            likes:likes(count)
          ),
          parent_post:reply_to_id(
            author:profiles!user_id(username, display_name)
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
      // ✅ Gold Standard: Include parent_post for "Replying to" context
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
            is_reply,
            reply_to_id,
            comments_count,
            reposts_count,
            quoted_post_id:repost_of_id,
            author:profiles!user_id(*),
            likes:likes(count)
          ),
          parent_post:reply_to_id(
            author:profiles!user_id(username, display_name)
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
      // Infinite Pivot: Only fetch DIRECT replies to this post/comment
      // Each comment can be "pivoted" to become the main post, fetching its own direct replies
      const { data: replies, error } = await supabase
        .from("posts")
        .select(`*, author:profiles!user_id(*), likes:likes(count)`)
        .eq("reply_to_id", postId)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      if (!replies || replies.length === 0) return [];
      
      // Enrich with is_liked and is_reposted_by_me
      const postIds = replies.map((p: any) => p.id);
      let likedPostIds = new Set<string>();
      let repostedPostIds = new Set<string>();
      
      if (user?.id) {
        // ✅ Diamond Standard: Check likes
        const { data: myLikes } = await supabase
          .from("likes")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", postIds);
        myLikes?.forEach((l: any) => likedPostIds.add(l.post_id));
        
        // ✅ Diamond Standard: Check reposts (fixes green state for reposted replies)
        const { data: myReposts } = await supabase
          .from("posts")
          .select("repost_of_id, external_id")
          .eq("user_id", user.id)
          .eq("type", "repost")
          .in("repost_of_id", postIds);
        myReposts?.forEach((r: any) => {
          if (r.repost_of_id) repostedPostIds.add(r.repost_of_id);
          if (r.external_id) repostedPostIds.add(r.external_id);
        });
      }
      
      return replies.map((post: any) => ({
        ...post,
        likes_count: post.likes?.[0]?.count ?? 0,
        comments_count: post.comments_count ?? 0,
        is_liked: likedPostIds.has(post.id),
        is_reposted_by_me: repostedPostIds.has(post.id), // ✅ Now replies show green repost state
      }));
    },
    enabled: !!postId,
  });
}

/**
 * Gold Standard Profile Tabs:
 * - 'posts': Original posts + reposts (public face)
 * - 'replies': Comments/replies with thread context
 * - 'media': Posts containing images/videos
 */
export type ProfileTab = 'posts' | 'replies' | 'media';

export function useUserPosts(userId: string, tab: ProfileTab = 'posts') {
  const { user } = useAuthStore(); // Current user (viewer)
  return useInfiniteQuery({
    queryKey: [...queryKeys.posts.byUser(userId), tab],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      let query = supabase
        .from("posts")
        .select(`
          *,
          author:profiles!user_id(*),
          likes:likes(count),
          quoted_post:repost_of_id(
            *,
            author:profiles!user_id(*),
            likes:likes(count)
          ),
          parent_post:reply_to_id(
            author:profiles!user_id(username, display_name)
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(from, to);

      // ✅ Diamond Standard Tab Filtering
      if (tab === 'posts') {
        // Show ONLY original content (posts, reposts, quotes) - strictly exclude replies
        query = query.eq('is_reply', false);
      } else if (tab === 'replies') {
        // Show ONLY conversational interactions - all replies
        query = query.eq('is_reply', true);
      } else if (tab === 'media') {
        // Show any post with media attachments (visual portfolio)
        query = query.not('media_urls', 'is', null);
      }

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
      // Cancel both feed and detail queries
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });
      
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(postId));

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
      
      // Update Detail view
      queryClient.setQueryData(queryKeys.posts.detail(postId), (old: any) => {
        if (!old) return old;
        return { ...old, is_liked: true, likes_count: (old.likes_count || 0) + 1 };
      });

      return { previousPosts, previousDetail, postId };
    },
    onError: (err, postId, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
      if (context?.postId) {
        queryClient.setQueryData(queryKeys.posts.detail(context.postId), context?.previousDetail);
      }
    },
    onSettled: (data, error, postId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
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
      // Cancel both feed and detail queries
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });
      
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(postId));

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
      
      // Update Detail view
      queryClient.setQueryData(queryKeys.posts.detail(postId), (old: any) => {
        if (!old) return old;
        return { ...old, is_liked: false, likes_count: Math.max(0, (old.likes_count || 0) - 1) };
      });

      return { previousPosts, previousDetail, postId };
    },
    onError: (err, postId, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
      if (context?.postId) {
        queryClient.setQueryData(queryKeys.posts.detail(context.postId), context?.previousDetail);
      }
    },
    onSettled: (data, error, postId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
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
      return { ...data, _replyToId: replyToId }; // Pass through for onSuccess
    },
    // Optimistic Update: Increment parent's comments_count instantly for snappy UX
    onMutate: async ({ replyToId }) => {
      if (!replyToId) return {};
      
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(replyToId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      
      // Snapshot previous values for rollback
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(replyToId));
      const previousFeed = queryClient.getQueryData(queryKeys.posts.all);
      
      // Optimistically update the parent post's comments_count in Detail view
      queryClient.setQueryData(queryKeys.posts.detail(replyToId), (old: any) => {
        if (!old) return old;
        return { ...old, comments_count: (old.comments_count || 0) + 1 };
      });
      
      // Also update in Feed (if parent post is visible there)
      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            page.map((post: any) => 
              post.id === replyToId 
                ? { ...post, comments_count: (post.comments_count || 0) + 1 }
                : post
            )
          ),
        };
      });
      
      return { previousDetail, previousFeed, replyToId };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.replyToId && context?.previousDetail) {
        queryClient.setQueryData(queryKeys.posts.detail(context.replyToId), context.previousDetail);
      }
      if (context?.previousFeed) {
        queryClient.setQueryData(queryKeys.posts.all, context.previousFeed);
      }
    },
    onSuccess: (data) => {
      // Invalidate feed and profile
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user?.id!) });
      
      // ✅ Invalidate user posts for ALL tabs (posts, replies, media) to update profile tabs
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user?.id!) });
      
      // If this was a reply, invalidate the thread's replies
      if (data._replyToId) {
        // Invalidate replies for the immediate parent
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.replies(data._replyToId) });
        // Also invalidate the parent's detail to sync real count from DB
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(data._replyToId) });
        // The parent post might be a reply itself, so we invalidate all reply queries
        queryClient.invalidateQueries({ predicate: (query) => 
          query.queryKey[0] === 'posts' && query.queryKey[1] === 'replies'
        });
      }
    },
  });
}

/**
 * Diamond Standard: Create Reply with Optimistic Updates
 * 
 * The reply appears INSTANTLY in the thread with a "sending..." state.
 * If the server fails, it gracefully rolls back.
 */
export function useCreateReply(postId: string) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuthStore();

  return useMutation({
    mutationFn: async (content: string) => {
      if (!user) throw new Error("Not authenticated");
      
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: user.id,
          content,
          reply_to_id: postId,
          is_reply: true,
          type: "post",
          is_repost: false,
        })
        .select(`*, author:profiles!user_id(*)`)
        .single();

      if (error) throw error;
      return data;
    },
    // ✅ Optimistic Update: Instant feedback
    onMutate: async (newContent) => {
      // 1. Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.replies(postId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });

      // 2. Snapshot current cache for rollback
      const previousReplies = queryClient.getQueryData(queryKeys.posts.replies(postId));
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(postId));

      // 3. Optimistically inject the new reply
      queryClient.setQueryData(queryKeys.posts.replies(postId), (old: any) => {
        const optimisticReply = {
          id: `optimistic-${Date.now()}`,
          content: newContent,
          user_id: user?.id,
          author: {
            id: user?.id,
            username: profile?.username || user?.email?.split("@")[0] || "you",
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
          },
          created_at: new Date().toISOString(),
          likes_count: 0,
          comments_count: 0,
          reposts_count: 0,
          is_liked: false,
          is_optimistic: true, // 👈 Flag for "sending..." UI state
        };
        return [...(old || []), optimisticReply];
      });

      // 4. Optimistically increment parent's comments_count
      queryClient.setQueryData(queryKeys.posts.detail(postId), (old: any) => {
        if (!old) return old;
        return { ...old, comments_count: (old.comments_count || 0) + 1 };
      });

      return { previousReplies, previousDetail };
    },
    onError: (err, newContent, context) => {
      // Rollback on failure
      queryClient.setQueryData(queryKeys.posts.replies(postId), context?.previousReplies);
      queryClient.setQueryData(queryKeys.posts.detail(postId), context?.previousDetail);
    },
    onSettled: () => {
      // Sync with server to get real IDs
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.replies(postId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
      // Also invalidate user's profile to show new reply in Replies tab
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user?.id!) });
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
        // ✅ Gold Standard: Target the ORIGINAL content ID, not the wrapper
        if (post.is_federated) {
          // For federated posts, match by external_id
          const targetId = post.external_id || post.id;
          const { error } = await supabase
            .from("posts")
            .delete()
            .eq("user_id", user.id)
            .eq("external_id", targetId)
            .eq("is_repost", true);
          if (error) throw error;
        } else {
          // For internal posts, match by repost_of_id and type="repost" (not quote)
          // If this IS a repost wrapper, target its quoted_post.id
          // If this is the original post, target its own id
          const targetId = post.quoted_post?.id || post.repost_of_id || post.id;
          const { error } = await supabase
            .from("posts")
            .delete()
            .eq("user_id", user.id)
            .eq("repost_of_id", targetId)
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
      // ✅ Diamond Standard: Cancel and snapshot BOTH feed and detail caches
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(post.id) });
      
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(post.id));
      
      const shouldUndo = undo || post.is_reposted_by_me;

      // Update Feed cache
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

      // ✅ Diamond Standard: Also update Detail view cache
      queryClient.setQueryData(queryKeys.posts.detail(post.id), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          is_reposted_by_me: !shouldUndo,
          reposts_count: shouldUndo 
            ? Math.max(0, (old.reposts_count || 0) - 1)
            : (old.reposts_count || 0) + 1
        };
      });

      return { previousPosts, previousDetail, postId: post.id };
    },
    onError: (err, vars, context) => {
      // Rollback both caches on error
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
      if (context?.postId) {
        queryClient.setQueryData(queryKeys.posts.detail(context.postId), context?.previousDetail);
      }
    },
    onSettled: (data, error, { post }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(post.id) });
      // ✅ Fix: Invalidate user profile posts (repost appears in their profile)
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user.id) });
      }
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
