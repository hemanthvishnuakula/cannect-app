/**
 * use-posts.ts - Federation-Ready Post Hooks
 * 
 * Updated for Bluesky AT Protocol compatibility:
 * - Uses thread_parent_id instead of reply_to_id
 * - Uses replies_count instead of comments_count  
 * - Reposts use separate `reposts` table (pointer model like Bluesky)
 * - Quotes still use posts table with type='quote'
 * - Posts auto-federate to AT Protocol via database trigger
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-client";
import type { PostWithAuthor } from "@/lib/types/database";
import type { ThreadView, ThreadReply } from "@/lib/types/thread";
import { useAuthStore } from "@/lib/stores";
import { generateTID, parseTextToFacets, buildAtUri } from "@/lib/utils/atproto";
import * as atprotoAgent from "@/lib/services/atproto-agent";

const POSTS_PER_PAGE = 20;

/**
 * Helper to update a post within a ThreadView (ancestors, focusedPost, or replies)
 * Used for optimistic updates on likes, reposts, etc. in thread context
 * 
 * Updated for Bluesky flat style - no nested descendants, just flat replies array
 */
function updatePostInThread(
  thread: ThreadView,
  postId: string,
  updater: (post: PostWithAuthor) => PostWithAuthor
): ThreadView {
  return {
    ...thread,
    // Update focused post if it matches
    focusedPost: thread.focusedPost.id === postId 
      ? updater(thread.focusedPost) 
      : thread.focusedPost,
    // Update ancestors
    ancestors: thread.ancestors.map(post => 
      post.id === postId ? updater(post) : post
    ),
    // Update replies (flat array - Bluesky style)
    replies: thread.replies.map(reply => 
      reply.post.id === postId 
        ? { ...reply, post: updater(reply.post) }
        : reply
    ),
  };
}

/**
 * Helper to enrich posts with engagement flags and counts
 * 
 * Federation-ready: Uses separate `reposts` table for is_reposted_by_me
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

  // 3. Get "Liked By Me" status
  let likedPostIds = new Set<string>();
  if (userId) {
    const { data: myLikes } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", allRelevantIds);
      
    myLikes?.forEach((l: any) => likedPostIds.add(l.post_id));
  }

  // 4. Get "Reposted By Me" status from the REPOSTS TABLE (Bluesky pattern)
  // This is the key federation change - reposts are now a pointer table
  let repostedPostIds = new Set<string>();
  if (userId) {
    const { data: myReposts } = await supabase
      .from("reposts")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", allRelevantIds);
      
    myReposts?.forEach((r: any) => {
      if (r.post_id) repostedPostIds.add(r.post_id);
    });
  }

  // 5. Return Enriched Posts with Live Engagement Sync
  return posts.map((post: any) => {
    // For quote posts, the quoted_post contains the original content
    const isQuote = post.type === 'quote' && post.quoted_post;
    const liveSource = isQuote ? post.quoted_post : post;
    const sourceId = liveSource?.id || post.id;
    
    return {
      ...post,
      // Check if the ORIGINAL content is liked (not the wrapper)
      is_liked: likedPostIds.has(sourceId),
      // Check if the ORIGINAL content is reposted by me (from reposts table)
      is_reposted_by_me: repostedPostIds.has(sourceId) || repostedPostIds.has(post.id),
      // Sync live counts from original post if it's a quote
      likes_count: isQuote && liveSource?.likes 
        ? (liveSource.likes?.[0]?.count ?? liveSource.likes_count ?? 0)
        : (post.likes?.[0]?.count ?? post.likes_count ?? 0),
      replies_count: isQuote && liveSource?.replies_count !== undefined
        ? liveSource.replies_count
        : post.replies_count,
      reposts_count: isQuote && liveSource?.reposts_count !== undefined
        ? liveSource.reposts_count
        : post.reposts_count,
    };
  });
}

// --- Modified Fetchers ---

/**
 * Main feed query - includes all posts + reposts from reposts table
 * 
 * Federation-ready: Uses thread_parent_id, replies_count, and reposts table
 */
export function useFeed() {
  const { user } = useAuthStore();
  
  return useInfiniteQuery({
    queryKey: queryKeys.posts.all,
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      // 1. Fetch all posts (not replies)
      const { data: authoredPosts, error: postsError } = await supabase
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
            thread_parent_id,
            thread_root_id,
            replies_count,
            reposts_count,
            quoted_post_id:repost_of_id,
            author:profiles!user_id(*),
            likes:likes(count)
          ),
          parent_post:thread_parent_id(
            author:profiles!user_id(username, display_name)
          ),
          external_id,
          external_source,
          external_metadata
        `)
        .eq("is_reply", false)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (postsError) throw postsError;

      // 2. Fetch all reposts (to show posts with "Reposted by" header)
      const { data: repostsData, error: repostsError } = await supabase
        .from("reposts")
        .select(`
          id,
          created_at,
          user_id,
          post_id,
          reposter:profiles!user_id(id, username, display_name, avatar_url),
          post:posts!post_id(
            *,
            author:profiles!user_id(*),
            likes:likes(count),
            quoted_post:repost_of_id(
              id,
              content,
              created_at,
              media_urls,
              is_reply,
              thread_parent_id,
              thread_root_id,
              replies_count,
              reposts_count,
              quoted_post_id:repost_of_id,
              author:profiles!user_id(*),
              likes:likes(count)
            ),
            parent_post:thread_parent_id(
              author:profiles!user_id(username, display_name)
            ),
            external_id,
            external_source,
            external_metadata
          )
        `)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (repostsError) throw repostsError;

      // 3. Transform reposts with reposted_by info
      const repostedPosts = (repostsData || [])
        .filter((r: any) => r.post && r.post.is_reply === false)
        .map((r: any) => ({
          ...r.post,
          reposted_by: r.reposter,
          reposted_at: r.created_at,
          _feed_timestamp: r.created_at,
        }));

      // 4. Add timestamp to authored posts
      const authoredWithTimestamp = (authoredPosts || []).map((p: any) => ({
        ...p,
        _feed_timestamp: p.created_at,
      }));

      // 5. Merge all posts
      const allPosts = [...authoredWithTimestamp, ...repostedPosts];

      // 6. Sort by feed timestamp FIRST (most recent first)
      allPosts.sort((a: any, b: any) => 
        new Date(b._feed_timestamp).getTime() - new Date(a._feed_timestamp).getTime()
      );

      // 7. Deduplicate (keep first/newest occurrence of each post)
      const seenPostIds = new Set<string>();
      const deduplicatedPosts = allPosts.filter((p: any) => {
        if (seenPostIds.has(p.id)) return false;
        seenPostIds.add(p.id);
        return true;
      });

      // 8. Take only the page slice
      const pagedPosts = deduplicatedPosts.slice(0, POSTS_PER_PAGE);

      // 9. Enrich with is_liked and is_reposted_by_me
      return enrichPostsWithStatus(pagedPosts, user?.id);
    },
    getNextPageParam: (lastPage, allPages) => lastPage.length < POSTS_PER_PAGE ? undefined : allPages.length,
    initialPageParam: 0,
  });
}

/**
 * Following Feed - Posts from users you follow + posts they reposted
 * 
 * Bluesky-style: If @alice follows @bob and @bob reposts @charlie's post,
 * @alice sees it with "Reposted by @bob" header
 */
export function useFollowingFeed() {
  const { user } = useAuthStore();
  
  return useInfiniteQuery({
    queryKey: ['posts', 'following', user?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user) return [];
      
      const from = pageParam * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      // 1. Get list of users the current user follows
      const { data: followingData, error: followsError } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);
      
      if (followsError) throw followsError;
      
      // Filter out NULL following_ids (external Bluesky follows don't have local user IDs)
      const followingIds = (followingData as any[])
        ?.map(f => f.following_id)
        .filter((id): id is string => id !== null && id !== undefined) || [];
      
      // Include own user ID for own posts
      const followingIdsWithSelf = [...followingIds, user.id];
      
      if (followingIdsWithSelf.length === 0) return [];

      // 2. Fetch posts authored by followed users
      const { data: authoredPosts, error: postsError } = await supabase
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
            thread_parent_id,
            thread_root_id,
            replies_count,
            reposts_count,
            quoted_post_id:repost_of_id,
            author:profiles!user_id(*),
            likes:likes(count)
          ),
          parent_post:thread_parent_id(
            author:profiles!user_id(username, display_name)
          ),
          external_id,
          external_source,
          external_metadata
        `)
        .eq("is_reply", false)
        .in("user_id", followingIdsWithSelf)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (postsError) throw postsError;

      // 3. Fetch reposts by followed users AND yourself (to show posts they/you reposted)
      const { data: repostsData, error: repostsError } = await supabase
        .from("reposts")
        .select(`
          id,
          created_at,
          user_id,
          post_id,
          reposter:profiles!user_id(id, username, display_name, avatar_url),
          post:posts!post_id(
            *,
            author:profiles!user_id(*),
            likes:likes(count),
            quoted_post:repost_of_id(
              id,
              content,
              created_at,
              media_urls,
              is_reply,
              thread_parent_id,
              thread_root_id,
              replies_count,
              reposts_count,
              quoted_post_id:repost_of_id,
              author:profiles!user_id(*),
              likes:likes(count)
            ),
            parent_post:thread_parent_id(
              author:profiles!user_id(username, display_name)
            ),
            external_id,
            external_source,
            external_metadata
          )
        `)
        .in("user_id", followingIdsWithSelf) // Include own reposts with "Reposted by" header
        .order("created_at", { ascending: false })
        .range(from, to);

      if (repostsError) throw repostsError;

      // 4. Transform reposted posts to include reposted_by info
      const repostedPosts = (repostsData || [])
        .filter((r: any) => r.post && r.post.is_reply === false)
        .map((r: any) => ({
          ...r.post,
          reposted_by: r.reposter,
          reposted_at: r.created_at,
          // Use repost timestamp for feed ordering
          _feed_timestamp: r.created_at,
        }));

      // 5. Add feed timestamp to authored posts
      const authoredWithTimestamp = (authoredPosts || []).map((p: any) => ({
        ...p,
        _feed_timestamp: p.created_at,
      }));
      
      // 6. Merge all posts

      // 6. Merge all posts
      const allPosts = [...authoredWithTimestamp, ...repostedPosts];

      // 7. Sort by feed timestamp FIRST (most recent first)
      allPosts.sort((a: any, b: any) => 
        new Date(b._feed_timestamp).getTime() - new Date(a._feed_timestamp).getTime()
      );

      // 8. Deduplicate (keep first/newest occurrence of each post)
      const seenPostIds = new Set<string>();
      const deduplicatedPosts = allPosts.filter((p: any) => {
        if (seenPostIds.has(p.id)) return false;
        seenPostIds.add(p.id);
        return true;
      });

      // 9. Take only the page slice
      const pagedPosts = deduplicatedPosts.slice(0, POSTS_PER_PAGE);

      // 10. Enrich with is_liked and is_reposted_by_me
      return enrichPostsWithStatus(pagedPosts, user?.id);
    },
    getNextPageParam: (lastPage, allPages) => 
      lastPage.length < POSTS_PER_PAGE ? undefined : allPages.length,
    initialPageParam: 0,
    enabled: !!user,
  });
}

/**
 * Helper to enrich posts with is_liked and is_reposted_by_me status
 */
async function enrichPostsWithStatus(posts: any[], userId?: string) {
  if (!posts.length) return [];
  
  const postIds = posts.map((p: any) => p.id);
  
  // Get liked status
  let likedPostIds = new Set<string>();
  if (userId) {
    const { data: myLikes } = await supabase
      .from("likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", postIds);
    myLikes?.forEach((l: any) => likedPostIds.add(l.post_id));
  }

  // Get reposted status (simple reposts)
  let repostedPostIds = new Set<string>();
  if (userId) {
    const { data: myReposts } = await supabase
      .from("reposts")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", postIds);
    myReposts?.forEach((r: any) => {
      if (r.post_id) repostedPostIds.add(r.post_id);
    });
  }

  // Get quoted status (quote posts I've created)
  let quotedPostIds = new Set<string>();
  if (userId) {
    const { data: myQuotes } = await supabase
      .from("posts")
      .select("repost_of_id")
      .eq("user_id", userId)
      .eq("type", "quote")
      .in("repost_of_id", postIds);
    myQuotes?.forEach((q: any) => {
      if (q.repost_of_id) quotedPostIds.add(q.repost_of_id);
    });
  }

  return posts.map((post: any) => ({
    ...post,
    is_liked: likedPostIds.has(post.id),
    is_reposted_by_me: repostedPostIds.has(post.id),
    is_quoted_by_me: quotedPostIds.has(post.id),
    likes_count: post.likes?.[0]?.count ?? post.likes_count ?? 0,
  }));
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
            is_reply,
            thread_parent_id,
            thread_root_id,
            replies_count,
            reposts_count,
            quoted_post_id:repost_of_id,
            author:profiles!user_id(*),
            likes:likes(count)
          ),
          parent_post:thread_parent_id(
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

/**
 * Fetch direct replies to a post
 * 
 * Federation-ready: Uses thread_parent_id instead of reply_to_id
 */
export function usePostReplies(postId: string) {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: queryKeys.posts.replies(postId),
    queryFn: async () => {
      // Fetch DIRECT replies using thread_parent_id
      const { data: replies, error } = await supabase
        .from("posts")
        .select(`*, author:profiles!user_id(*), likes:likes(count)`)
        .eq("thread_parent_id", postId)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      if (!replies || replies.length === 0) return [];
      
      // Enrich with is_liked and is_reposted_by_me
      const postIds = replies.map((p: any) => p.id);
      let likedPostIds = new Set<string>();
      let repostedPostIds = new Set<string>();
      
      if (user?.id) {
        // Check likes
        const { data: myLikes } = await supabase
          .from("likes")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", postIds);
        myLikes?.forEach((l: any) => likedPostIds.add(l.post_id));
        
        // Check reposts from REPOSTS TABLE (federation pattern)
        const { data: myReposts } = await supabase
          .from("reposts")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", postIds);
        myReposts?.forEach((r: any) => {
          if (r.post_id) repostedPostIds.add(r.post_id);
        });
      }
      
      return replies.map((post: any) => ({
        ...post,
        likes_count: post.likes?.[0]?.count ?? 0,
        replies_count: post.replies_count ?? 0,
        is_liked: likedPostIds.has(post.id),
        is_reposted_by_me: repostedPostIds.has(post.id),
      }));
    },
    enabled: !!postId,
  });
}

/**
 * Profile Tabs:
 * - 'posts': Original posts + quotes (public face)
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

      // For 'posts' tab, we need to merge authored posts + reposts
      if (tab === 'posts') {
        // 1. Fetch user's authored posts (not replies)
        const { data: authoredPosts, error: postsError } = await supabase
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
            parent_post:thread_parent_id(
              author:profiles!user_id(username, display_name)
            ),
            external_id,
            external_source,
            external_metadata
          `)
          .eq("user_id", userId)
          .eq("is_reply", false)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (postsError) throw postsError;

        // 2. Fetch user's profile info for reposted_by
        const { data: userProfile } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .eq("id", userId)
          .single();

        // 3. Fetch user's reposts
        const { data: repostsData, error: repostsError } = await supabase
          .from("reposts")
          .select(`
            id,
            created_at,
            user_id,
            post_id,
            post:posts!post_id(
              *,
              author:profiles!user_id(*),
              likes:likes(count),
              quoted_post:repost_of_id(
                *,
                author:profiles!user_id(*),
                likes:likes(count)
              ),
              parent_post:thread_parent_id(
                author:profiles!user_id(username, display_name)
              ),
              external_id,
              external_source,
              external_metadata
            )
          `)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (repostsError) throw repostsError;

        // 4. Transform reposts with reposted_by info
        const repostedPosts = (repostsData || [])
          .filter((r: any) => r.post && r.post.is_reply === false)
          .map((r: any) => ({
            ...r.post,
            reposted_by: userProfile,
            reposted_at: r.created_at,
            _feed_timestamp: r.created_at,
          }));

        // 5. Add timestamp to authored posts
        const authoredWithTimestamp = (authoredPosts || []).map((p: any) => ({
          ...p,
          _feed_timestamp: p.created_at,
        }));

        // 6. Merge all posts
        const allPosts = [...authoredWithTimestamp, ...repostedPosts];

        // 7. Sort by feed timestamp FIRST (most recent first)
        allPosts.sort((a: any, b: any) =>
          new Date(b._feed_timestamp).getTime() - new Date(a._feed_timestamp).getTime()
        );

        // 8. Deduplicate (keep first/newest occurrence of each post)
        const seenPostIds = new Set<string>();
        const deduplicatedPosts = allPosts.filter((p: any) => {
          if (seenPostIds.has(p.id)) return false;
          seenPostIds.add(p.id);
          return true;
        });

        // 9. Take page slice
        const pagedPosts = deduplicatedPosts.slice(0, POSTS_PER_PAGE);

        // 10. Enrich with status
        return enrichPostsWithStatus(pagedPosts, user?.id);
      }

      // For 'replies' and 'media' tabs, use simple query
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
          parent_post:thread_parent_id(
            author:profiles!user_id(username, display_name)
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (tab === 'replies') {
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

/**
 * Like a post
 * 
 * Federation-ready: Accepts AT URI and CID for federated posts.
 * Database trigger will auto-queue the like for sync to Bluesky.
 */
export function useLikePost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ 
      postId, 
      subjectUri, 
      subjectCid 
    }: { 
      postId: string; 
      subjectUri?: string | null; 
      subjectCid?: string | null;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("likes").insert({
        user_id: user.id,
        post_id: postId,
        // AT Protocol fields for federation
        subject_uri: subjectUri,
        subject_cid: subjectCid,
      });
      if (error) throw error;
      return postId;
    },
    onMutate: async ({ postId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });
      
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(postId));
      
      // Capture all thread caches that might contain this post
      const threadQueries = queryClient.getQueriesData<ThreadView>({ queryKey: ['thread'] });
      const previousThreads = new Map(threadQueries);

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
      
      // Update all thread views that contain this post
      threadQueries.forEach(([queryKey, thread]) => {
        if (!thread) return;
        queryClient.setQueryData(queryKey, updatePostInThread(thread, postId, (post) => ({
          ...post,
          is_liked: true,
          likes_count: (post.likes_count || 0) + 1,
        })));
      });

      return { previousPosts, previousDetail, previousThreads, postId };
    },
    onError: (err, { postId }, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
      if (context?.postId) {
        queryClient.setQueryData(queryKeys.posts.detail(context.postId), context?.previousDetail);
      }
      // Restore thread caches
      context?.previousThreads?.forEach((thread, queryKey) => {
        queryClient.setQueryData(queryKey, thread);
      });
    },
    onSettled: (data, error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
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
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });
      
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(postId));
      
      // Capture all thread caches that might contain this post
      const threadQueries = queryClient.getQueriesData<ThreadView>({ queryKey: ['thread'] });
      const previousThreads = new Map(threadQueries);

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
      
      // Update all thread views that contain this post
      threadQueries.forEach(([queryKey, thread]) => {
        if (!thread) return;
        queryClient.setQueryData(queryKey, updatePostInThread(thread, postId, (post) => ({
          ...post,
          is_liked: false,
          likes_count: Math.max(0, (post.likes_count || 0) - 1),
        })));
      });

      return { previousPosts, previousDetail, previousThreads, postId };
    },
    onError: (err, postId, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
      if (context?.postId) {
        queryClient.setQueryData(queryKeys.posts.detail(context.postId), context?.previousDetail);
      }
      // Restore thread caches
      context?.previousThreads?.forEach((thread, queryKey) => {
        queryClient.setQueryData(queryKey, thread);
      });
    },
    onSettled: (data, error, postId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

/**
 * Create a new post
 * 
 * Federation-ready: 
 * - Uses thread_parent_id/thread_root_id for replies
 * - Generates AT Protocol rkey and facets
 * - Database trigger auto-queues for federation to Bluesky
 */
export function useCreatePost() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuthStore();

  return useMutation({
    mutationFn: async ({ 
      content, 
      mediaUrls, 
      replyToId,
      videoUrl,
      videoThumbnailUrl,
    }: { 
      content: string; 
      mediaUrls?: string[]; 
      replyToId?: string;
      videoUrl?: string;
      videoThumbnailUrl?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      
      // Generate AT Protocol fields
      const rkey = generateTID();
      const { facets } = parseTextToFacets(content);
      
      // Build AT URI if user has a DID (federated)
      const atUri = profile?.did 
        ? buildAtUri(profile.did, 'app.bsky.feed.post', rkey)
        : null;
      
      // For replies, we need to determine thread_root_id and AT Protocol fields
      let threadRootId: string | undefined;
      let threadDepth = 0;
      let threadParentUri: string | null = null;
      let threadParentCid: string | null = null;
      let threadRootUri: string | null = null;
      let threadRootCid: string | null = null;
      
      if (replyToId) {
        // Fetch the parent post to get its thread_root_id and AT Protocol fields
        const { data: parentPost } = await supabase
          .from("posts")
          .select("thread_root_id, thread_depth, at_uri, at_cid, thread_root_uri, thread_root_cid")
          .eq("id", replyToId)
          .single();
        
        // If parent has a thread_root_id, use it; otherwise parent IS the root
        threadRootId = parentPost?.thread_root_id || replyToId;
        threadDepth = (parentPost?.thread_depth ?? 0) + 1;
        
        // AT Protocol threading fields (for federation)
        threadParentUri = parentPost?.at_uri || null;
        threadParentCid = parentPost?.at_cid || null;
        threadRootUri = parentPost?.thread_root_uri || parentPost?.at_uri || null;
        threadRootCid = parentPost?.thread_root_cid || parentPost?.at_cid || null;
      }
      
      // Clean facets for storage (remove _unresolvedHandle, keep only resolved)
      const cleanFacets = facets
        .filter(f => {
          // Only include mentions that have DIDs (resolved)
          const mentionFeature = f.features.find(
            feat => feat.$type === 'app.bsky.richtext.facet#mention'
          );
          return !mentionFeature || mentionFeature.did;
        })
        .map(f => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { _unresolvedHandle, ...cleanFacet } = f as any;
          return cleanFacet;
        });
      
      const { data, error } = await supabase.from("posts").insert({
        user_id: user.id,
        content,
        media_urls: mediaUrls,
        video_url: videoUrl,
        video_thumbnail_url: videoThumbnailUrl,
        thread_parent_id: replyToId || null,
        thread_root_id: threadRootId || null,
        thread_depth: threadDepth,
        // AT Protocol threading fields (for federation)
        thread_parent_uri: threadParentUri,
        thread_parent_cid: threadParentCid,
        thread_root_uri: threadRootUri,
        thread_root_cid: threadRootCid,
        type: 'post',
        // AT Protocol fields
        rkey,
        at_uri: atUri,
        facets: cleanFacets.length > 0 ? cleanFacets : null,
        langs: ['en'],
      }).select(`*, author:profiles!user_id(*)`).single();
      
      if (error) throw error;
      return { ...data, _replyToId: replyToId };
    },
    // Optimistic Update: Increment parent's replies_count instantly
    onMutate: async ({ replyToId }) => {
      if (!replyToId) return {};
      
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(replyToId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(replyToId));
      const previousFeed = queryClient.getQueryData(queryKeys.posts.all);
      
      // Optimistically update the parent post's replies_count
      queryClient.setQueryData(queryKeys.posts.detail(replyToId), (old: any) => {
        if (!old) return old;
        return { ...old, replies_count: (old.replies_count || 0) + 1 };
      });
      
      // Also update in Feed (if parent post is visible there)
      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            page.map((post: any) => 
              post.id === replyToId 
                ? { ...post, replies_count: (post.replies_count || 0) + 1 }
                : post
            )
          ),
        };
      });
      
      return { previousDetail, previousFeed, replyToId };
    },
    onError: (err, variables, context) => {
      if (context?.replyToId && context?.previousDetail) {
        queryClient.setQueryData(queryKeys.posts.detail(context.replyToId), context.previousDetail);
      }
      if (context?.previousFeed) {
        queryClient.setQueryData(queryKeys.posts.all, context.previousFeed);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user?.id!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user?.id!) });
      
      if (data._replyToId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.replies(data._replyToId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(data._replyToId) });
        queryClient.invalidateQueries({ predicate: (query) => 
          query.queryKey[0] === 'posts' && query.queryKey[1] === 'replies'
        });
      }
    },
  });
}

/**
 * Create Reply with Optimistic Updates
 * 
 * Federation-ready: Uses thread_parent_id and thread_root_id
 */
export function useCreateReply(postId: string) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuthStore();

  return useMutation({
    mutationFn: async (content: string) => {
      if (!user) throw new Error("Not authenticated");
      
      // Get parent post's thread info AND AT Protocol fields for federation
      const { data: parentPost } = await supabase
        .from("posts")
        .select("thread_root_id, thread_depth, at_uri, at_cid, thread_root_uri, thread_root_cid")
        .eq("id", postId)
        .single();
      
      const threadRootId = parentPost?.thread_root_id || postId;
      const threadDepth = (parentPost?.thread_depth ?? 0) + 1;
      
      // AT Protocol threading fields (for federation)
      const threadParentUri = parentPost?.at_uri || null;
      const threadParentCid = parentPost?.at_cid || null;
      const threadRootUri = parentPost?.thread_root_uri || parentPost?.at_uri || null;
      const threadRootCid = parentPost?.thread_root_cid || parentPost?.at_cid || null;
      
      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: user.id,
          content,
          thread_parent_id: postId,
          thread_root_id: threadRootId,
          thread_depth: threadDepth,
          // AT Protocol threading fields (for federation)
          thread_parent_uri: threadParentUri,
          thread_parent_cid: threadParentCid,
          thread_root_uri: threadRootUri,
          thread_root_cid: threadRootCid,
          type: "post",
        })
        .select(`*, author:profiles!user_id(*)`)
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async (newContent) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.replies(postId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(postId) });

      const previousReplies = queryClient.getQueryData(queryKeys.posts.replies(postId));
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(postId));

      // Optimistically inject the new reply
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
          replies_count: 0,
          reposts_count: 0,
          is_liked: false,
          is_optimistic: true,
        };
        return [...(old || []), optimisticReply];
      });

      // Optimistically increment parent's replies_count
      queryClient.setQueryData(queryKeys.posts.detail(postId), (old: any) => {
        if (!old) return old;
        return { ...old, replies_count: (old.replies_count || 0) + 1 };
      });

      return { previousReplies, previousDetail };
    },
    onError: (err, newContent, context) => {
      queryClient.setQueryData(queryKeys.posts.replies(postId), context?.previousReplies);
      queryClient.setQueryData(queryKeys.posts.detail(postId), context?.previousDetail);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.replies(postId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(postId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user?.id!) });
    },
  });
}

/**
 * Create a Quote Post (with commentary)
 * 
 * Quotes remain in the posts table with type='quote'
 */
export function useQuotePost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ originalPostId, content }: { originalPostId: string, content: string }) => {
      if (!user) throw new Error("Not authenticated");
      
      const { error } = await supabase.from("posts").insert({
        user_id: user.id,
        content: content,
        repost_of_id: originalPostId,
        type: 'quote',
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}

/**
 * Toggle Repost - Creates or Undoes a simple repost
 * 
 * FEDERATION-READY: Uses separate `reposts` table (Bluesky pointer model)
 * - Reposts are now a separate table, not posts with is_repost=true
 * - This is identical to how Bluesky handles reposts
 * - Database trigger auto-queues for sync to Bluesky
 */
export function useToggleRepost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ 
      post, 
      undo = false,
      subjectUri,
      subjectCid,
    }: { 
      post: any; 
      undo?: boolean;
      subjectUri?: string | null;
      subjectCid?: string | null;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const targetId = post.id;

      if (undo || post.is_reposted_by_me) {
        // UNDO REPOST: Delete from reposts table
        const { error } = await supabase
          .from("reposts")
          .delete()
          .eq("user_id", user.id)
          .eq("post_id", targetId);
        if (error) throw error;
      } else {
        // CREATE REPOST: Insert into reposts table with AT Protocol fields
        const { error } = await supabase.from("reposts").insert({
          user_id: user.id,
          post_id: targetId,
          // AT Protocol fields for federation
          subject_uri: subjectUri || post.at_uri,
          subject_cid: subjectCid || post.at_cid,
        });
        if (error) throw error;
      }
    },
    // Optimistic update for instant feedback
    onMutate: async ({ post, undo }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.detail(post.id) });
      
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      const previousDetail = queryClient.getQueryData(queryKeys.posts.detail(post.id));
      
      // Capture all thread caches that might contain this post
      const threadQueries = queryClient.getQueriesData<ThreadView>({ queryKey: ['thread'] });
      const previousThreads = new Map(threadQueries);
      
      const shouldUndo = undo || post.is_reposted_by_me;
      
      // Get current user's profile for "Reposted by you" header
      const { profile } = useAuthStore.getState();
      const myRepostInfo = profile ? {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      } : null;

      // Helper to update a post in a pages array
      const updatePostInPages = (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            shouldUndo
              // When unreposting: remove the repost entry OR clear reposted_by on the original
              ? page.filter((p: any) => !(p.id === post.id && p.reposted_by)).map((p: any) =>
                  p.id === post.id
                    ? {
                        ...p,
                        is_reposted_by_me: false,
                        reposts_count: Math.max(0, (p.reposts_count || 0) - 1),
                        reposted_by: undefined,
                        reposted_at: undefined,
                      }
                    : p
                )
              // When reposting: add reposted_by info for "Reposted by you" header
              : page.map((p: any) =>
                  p.id === post.id
                    ? {
                        ...p,
                        is_reposted_by_me: true,
                        reposts_count: (p.reposts_count || 0) + 1,
                        reposted_by: myRepostInfo,
                        reposted_at: new Date().toISOString(),
                      }
                    : p
                )
          ),
        };
      };

      // Update Feed cache (all posts)
      queryClient.setQueryData(queryKeys.posts.all, updatePostInPages);
      
      // Update all user post caches (profile pages)
      queryClient.setQueriesData(
        { queryKey: ['posts', 'user'], exact: false },
        updatePostInPages
      );

      // Also update Detail view cache
      queryClient.setQueryData(queryKeys.posts.detail(post.id), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          is_reposted_by_me: !shouldUndo,
          reposts_count: shouldUndo 
            ? Math.max(0, (old.reposts_count || 0) - 1)
            : (old.reposts_count || 0) + 1,
          // Add/clear reposted_by for header
          reposted_by: shouldUndo ? undefined : myRepostInfo,
          reposted_at: shouldUndo ? undefined : new Date().toISOString(),
        };
      });
      
      // Update all thread views that contain this post
      threadQueries.forEach(([queryKey, thread]) => {
        if (!thread) return;
        queryClient.setQueryData(queryKey, updatePostInThread(thread, post.id, (p) => ({
          ...p,
          is_reposted_by_me: !shouldUndo,
          reposts_count: shouldUndo 
            ? Math.max(0, (p.reposts_count || 0) - 1)
            : (p.reposts_count || 0) + 1,
        })));
      });

      return { previousPosts, previousDetail, previousThreads, postId: post.id };
    },
    onError: (err, vars, context) => {
      queryClient.setQueryData(queryKeys.posts.all, context?.previousPosts);
      if (context?.postId) {
        queryClient.setQueryData(queryKeys.posts.detail(context.postId), context?.previousDetail);
      }
      // Restore thread caches
      context?.previousThreads?.forEach((thread, queryKey) => {
        queryClient.setQueryData(queryKey, thread);
      });
    },
    onSettled: (data, error, { post }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.detail(post.id) });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user.id) });
      }
    },
  });
}

/**
 * Legacy repost function - for creating quote posts
 * @deprecated Use useQuotePost for quotes, useToggleRepost for simple reposts
 */
export function useRepost() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuthStore.getState();

  return useMutation({
    mutationFn: async ({ originalPost, content = "" }: { originalPost: any, content?: string }) => {
      if (!user) throw new Error("Not authenticated");
      
      if (content) {
        // Quote post - goes in posts table
        const { data, error } = await supabase.from("posts").insert({
          user_id: user.id,
          content: content,
          repost_of_id: originalPost.id,
          type: 'quote',
        }).select('id').single();
        if (error) throw error;
        return { type: 'quote', postId: data.id, originalPostId: originalPost.id, content };
      } else {
        // Simple repost - goes in reposts table
        const { error } = await supabase.from("reposts").insert({
          user_id: user.id,
          post_id: originalPost.id,
        });
        if (error) throw error;
        return { type: 'repost', originalPostId: originalPost.id };
      }
    },
    onMutate: async ({ originalPost, content }) => {
      // Only do optimistic update for quote posts
      if (!content) return {};
      
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      const previousPosts = queryClient.getQueryData(queryKeys.posts.all);
      
      // Get current user's profile for the new quote post
      const { user, profile } = useAuthStore.getState();
      
      // Create optimistic quote post
      const optimisticQuote = {
        id: `temp-${Date.now()}`, // Temporary ID
        content,
        type: 'quote',
        user_id: user?.id,
        created_at: new Date().toISOString(),
        author: profile ? {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        } : null,
        quoted_post: originalPost,
        likes_count: 0,
        reposts_count: 0,
        replies_count: 0,
        is_liked: false,
        is_reposted_by_me: false,
      };
      
      // Add quote to top of feed
      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old?.pages?.[0]) return old;
        return {
          ...old,
          pages: [
            [optimisticQuote, ...old.pages[0]],
            ...old.pages.slice(1)
          ],
        };
      });
      
      // Increment quotes_count on original post
      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) =>
            page.map((p: any) =>
              p.id === originalPost.id
                ? { ...p, quotes_count: (p.quotes_count || 0) + 1, is_quoted_by_me: true }
                : p
            )
          ),
        };
      });
      
      return { previousPosts, originalPostId: originalPost.id };
    },
    onError: (err, vars, context: any) => {
      if (context?.previousPosts) {
        queryClient.setQueryData(queryKeys.posts.all, context.previousPosts);
      }
    },
    onSuccess: () => {
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
      return postId;
    },
    onMutate: async (postId) => {
      // Optimistically remove from feed
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });
      
      const previousFeed = queryClient.getQueryData(queryKeys.posts.all);
      
      queryClient.setQueryData(queryKeys.posts.all, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => 
            page.filter((post: any) => post.id !== postId)
          ),
        };
      });
      
      return { previousFeed };
    },
    onError: (err, postId, context) => {
      // Rollback on error
      if (context?.previousFeed) {
        queryClient.setQueryData(queryKeys.posts.all, context.previousFeed);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}

// =============================================================================
// External Bluesky Post Interactions
// =============================================================================
// These hooks allow interacting with posts that don't exist in our local DB
// They use AT Protocol URIs and CIDs directly

export interface BlueskyPostRef {
  uri: string;  // at://did:plc:xxx/app.bsky.feed.post/rkey
  cid: string;  // CID of the post
}

/**
 * Check if current user has liked an external Bluesky post
 */
export function useHasLikedBlueskyPost(subjectUri: string) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["likes", "external", user?.id, subjectUri],
    queryFn: async () => {
      if (!user) return false;

      const { data, error } = await supabase
        .from("likes")
        .select("id")
        .eq("user_id", user.id)
        .eq("subject_uri", subjectUri)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!subjectUri && !!user,
  });
}

/**
 * Like an external Bluesky post (PDS-first approach)
 * Creates the like on PDS first, then mirrors to database
 */
export function useLikeBlueskyPost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (postRef: BlueskyPostRef) => {
      if (!user) throw new Error("Not authenticated");
      
      // PDS-first: Call atproto-agent edge function
      await atprotoAgent.likePost({
        userId: user.id,
        subjectUri: postRef.uri,
        subjectCid: postRef.cid,
      });
      
      return postRef.uri;
    },
    onMutate: async (postRef) => {
      const queryKey = ["likes", "external", user?.id, postRef.uri];
      await queryClient.cancelQueries({ queryKey });
      
      const previousValue = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, true);
      
      return { previousValue, queryKey };
    },
    onError: (err, postRef, context) => {
      if (context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousValue);
      }
    },
    onSettled: (uri) => {
      queryClient.invalidateQueries({ queryKey: ["likes", "external", user?.id, uri] });
    },
  });
}

/**
 * Unlike an external Bluesky post (PDS-first approach)
 * Deletes the like from PDS first, then removes from database
 */
export function useUnlikeBlueskyPost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (subjectUri: string) => {
      if (!user) throw new Error("Not authenticated");

      // PDS-first: Call atproto-agent edge function
      await atprotoAgent.unlikePost({
        userId: user.id,
        subjectUri,
      });

      return subjectUri;
    },
    onMutate: async (subjectUri) => {
      const queryKey = ["likes", "external", user?.id, subjectUri];
      await queryClient.cancelQueries({ queryKey });
      
      const previousValue = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, false);
      
      return { previousValue, queryKey };
    },
    onError: (err, subjectUri, context) => {
      if (context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousValue);
      }
    },
    onSettled: (uri) => {
      queryClient.invalidateQueries({ queryKey: ["likes", "external", user?.id, uri] });
    },
  });
}

/**
 * Check if current user has reposted an external Bluesky post
 */
export function useHasRepostedBlueskyPost(subjectUri: string) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["reposts", "external", user?.id, subjectUri],
    queryFn: async () => {
      if (!user) return false;

      const { data, error } = await supabase
        .from("reposts")
        .select("id")
        .eq("user_id", user.id)
        .eq("subject_uri", subjectUri)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!subjectUri && !!user,
  });
}

/**
 * Repost an external Bluesky post (PDS-first approach)
 * Creates the repost on PDS first, then mirrors to database
 */
export function useRepostBlueskyPost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (postRef: BlueskyPostRef) => {
      if (!user) throw new Error("Not authenticated");
      
      // PDS-first: Call atproto-agent edge function
      await atprotoAgent.repostPost({
        userId: user.id,
        subjectUri: postRef.uri,
        subjectCid: postRef.cid,
      });
      
      return postRef.uri;
    },
    onMutate: async (postRef) => {
      const queryKey = ["reposts", "external", user?.id, postRef.uri];
      await queryClient.cancelQueries({ queryKey });
      
      const previousValue = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, true);
      
      return { previousValue, queryKey };
    },
    onError: (err, postRef, context) => {
      if (context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousValue);
      }
    },
    onSettled: (uri) => {
      queryClient.invalidateQueries({ queryKey: ["reposts", "external", user?.id, uri] });
    },
  });
}

/**
 * Un-repost an external Bluesky post (PDS-first approach)
 * Deletes the repost from PDS first, then removes from database
 */
export function useUnrepostBlueskyPost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (subjectUri: string) => {
      if (!user) throw new Error("Not authenticated");

      // PDS-first: Call atproto-agent edge function
      await atprotoAgent.unrepostPost({
        userId: user.id,
        subjectUri,
      });

      return subjectUri;
    },
    onMutate: async (subjectUri) => {
      const queryKey = ["reposts", "external", user?.id, subjectUri];
      await queryClient.cancelQueries({ queryKey });
      
      const previousValue = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, false);
      
      return { previousValue, queryKey };
    },
    onError: (err, subjectUri, context) => {
      if (context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousValue);
      }
    },
    onSettled: (uri) => {
      queryClient.invalidateQueries({ queryKey: ["reposts", "external", user?.id, uri] });
    },
  });
}

/**
 * Reply to an external Bluesky post (PDS-first approach)
 * Creates the reply on PDS first, then mirrors to database
 */
export interface BlueskyReplyRef {
  parentUri: string;
  parentCid: string;
  rootUri?: string;
  rootCid?: string;
}

export function useReplyToBlueskyPost() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ content, parent }: { content: string; parent: BlueskyReplyRef }) => {
      if (!user) throw new Error("Not authenticated");
      
      // PDS-first: Call atproto-agent edge function
      const result = await atprotoAgent.replyToPost({
        userId: user.id,
        content,
        parentUri: parent.parentUri,
        parentCid: parent.parentCid,
        rootUri: parent.rootUri,
        rootCid: parent.rootCid,
      });
      
      console.log("[useReplyToBlueskyPost] Reply created via PDS-first:", result);
      return result;
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.posts.byUser(user.id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user.id) });
      }
    },
  });
}
