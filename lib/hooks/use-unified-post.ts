/**
 * use-unified-post.ts - Unified hooks for post interactions
 * 
 * Provides a single hook interface that works for both local and external posts.
 * Automatically routes to the correct mutation based on post source.
 */

import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/lib/stores";
import type { UnifiedPost } from "@/lib/types/unified-post";
import {
  useLikePost,
  useUnlikePost,
  useToggleRepost,
  useLikeBlueskyPost,
  useUnlikeBlueskyPost,
  useRepostBlueskyPost,
  useUnrepostBlueskyPost,
  useHasLikedBlueskyPost,
  useHasRepostedBlueskyPost,
} from "./use-posts";

/** Return type for unified interaction hook */
export interface UnifiedPostActions {
  /** Like the post */
  like: () => void;
  /** Unlike the post */
  unlike: () => void;
  /** Toggle like state */
  toggleLike: () => void;
  /** Repost the post */
  repost: () => void;
  /** Un-repost the post */
  unrepost: () => void;
  /** Toggle repost state */
  toggleRepost: () => void;
  /** Navigate to reply composer */
  reply: () => void;
  /** Navigate to post detail */
  viewPost: () => void;
  /** Navigate to author profile */
  viewAuthor: () => void;
  /** Loading states */
  isLikeLoading: boolean;
  isRepostLoading: boolean;
  /** Current viewer state (may be stale for external) */
  isLiked: boolean;
  isReposted: boolean;
}

/**
 * Hook that provides unified interactions for any post type
 * 
 * Automatically routes to correct mutation based on whether post is cached or local.
 * - Cannect posts (isCached=false): Use local mutations
 * - Cached posts (isCached=true): Use Bluesky mutations
 */
export function useUnifiedPostActions(post: UnifiedPost): UnifiedPostActions {
  const router = useRouter();
  const { user } = useAuthStore();
  
  // Determine if post is cached (external) - check both isCached and legacy isExternal
  const isCached = post.isCached || post.isExternal || false;
  
  // Local post mutations
  const localLike = useLikePost();
  const localUnlike = useUnlikePost();
  const localToggleRepost = useToggleRepost();
  
  // External post mutations
  const externalLike = useLikeBlueskyPost();
  const externalUnlike = useUnlikeBlueskyPost();
  const externalRepost = useRepostBlueskyPost();
  const externalUnrepost = useUnrepostBlueskyPost();
  
  // For external posts, we might need to check state from queries
  // (since viewer state might not be in the post data)
  const { data: externalLikeState } = useHasLikedBlueskyPost(isCached ? post.uri : "");
  const { data: externalRepostState } = useHasRepostedBlueskyPost(isCached ? post.uri : "");
  
  // Determine current like/repost state
  const isLiked = isCached 
    ? (externalLikeState ?? post.viewer.isLiked)
    : post.viewer.isLiked;
    
  const isReposted = isCached
    ? (externalRepostState ?? post.viewer.isReposted)
    : post.viewer.isReposted;

  // Like action
  const like = useCallback(() => {
    if (!user) return;
    
    if (isCached) {
      externalLike.mutate({ uri: post.uri, cid: post.cid || "" });
    } else if (post.localId) {
      localLike.mutate({
        postId: post.localId,
        subjectUri: post.uri.startsWith("at://") ? post.uri : null,
        subjectCid: post.cid || null,
      });
    }
  }, [user, post, isCached, externalLike, localLike]);

  // Unlike action
  const unlike = useCallback(() => {
    if (!user) return;
    
    if (isCached) {
      externalUnlike.mutate(post.uri);
    } else if (post.localId) {
      localUnlike.mutate({
        postId: post.localId,
        subjectUri: post.uri.startsWith("at://") ? post.uri : null,
      });
    }
  }, [user, post, isCached, externalUnlike, localUnlike]);

  // Toggle like
  const toggleLike = useCallback(() => {
    if (isLiked) {
      unlike();
    } else {
      like();
    }
  }, [isLiked, like, unlike]);

  // Repost action
  const repost = useCallback(() => {
    if (!user) return;
    
    if (isCached) {
      externalRepost.mutate({ uri: post.uri, cid: post.cid || "" });
    } else if (post.localId) {
      // Use toggleRepost with undo=false
      localToggleRepost.mutate({
        post: { id: post.localId, is_reposted_by_me: false, at_uri: post.uri, at_cid: post.cid },
        undo: false,
        subjectUri: post.uri.startsWith("at://") ? post.uri : null,
        subjectCid: post.cid || null,
      });
    }
  }, [user, post, isCached, externalRepost, localToggleRepost]);

  // Un-repost action
  const unrepost = useCallback(() => {
    if (!user) return;
    
    if (isCached) {
      externalUnrepost.mutate(post.uri);
    } else if (post.localId) {
      // Use toggleRepost with undo=true
      localToggleRepost.mutate({
        post: { id: post.localId, is_reposted_by_me: true, at_uri: post.uri, at_cid: post.cid },
        undo: true,
        subjectUri: post.uri.startsWith("at://") ? post.uri : null,
      });
    }
  }, [user, post, isCached, externalUnrepost, localToggleRepost]);

  // Toggle repost
  const toggleRepost = useCallback(() => {
    if (isReposted) {
      unrepost();
    } else {
      repost();
    }
  }, [isReposted, repost, unrepost]);

  // Reply navigation
  const reply = useCallback(() => {
    if (isCached) {
      router.push({
        pathname: "/compose",
        params: {
          replyToUri: post.uri,
          replyToCid: post.cid,
          replyToAuthor: post.author.displayName,
          replyToHandle: post.author.handle,
          replyToContent: post.content.slice(0, 100),
        }
      } as any);
    } else if (post.localId) {
      router.push({
        pathname: "/compose",
        params: {
          replyToId: post.localId,
          replyToAuthor: post.author.displayName,
          replyToContent: post.content.slice(0, 100),
        }
      } as any);
    }
  }, [router, post, isCached]);

  // View post navigation
  // Use federated view for ANY post with an AT URI to ensure lazy sync with Bluesky
  const viewPost = useCallback(() => {
    const hasAtUri = post.uri.startsWith("at://");
    
    if (hasAtUri) {
      // Federated view fetches fresh data from Bluesky and syncs to Supabase
      router.push({
        pathname: "/federated/post",
        params: { uri: post.uri }
      } as any);
    } else if (post.localId) {
      // Local-only posts (no AT URI) use the local view
      router.push(`/post/${post.localId}` as any);
    }
  }, [router, post]);

  // View author navigation
  const viewAuthor = useCallback(() => {
    router.push(`/user/${post.author.handle}` as any);
  }, [router, post.author.handle]);

  // Loading states
  const isLikeLoading = isCached
    ? externalLike.isPending || externalUnlike.isPending
    : localLike.isPending || localUnlike.isPending;
    
  const isRepostLoading = isCached
    ? externalRepost.isPending || externalUnrepost.isPending
    : localToggleRepost.isPending;

  return {
    like,
    unlike,
    toggleLike,
    repost,
    unrepost,
    toggleRepost,
    reply,
    viewPost,
    viewAuthor,
    isLikeLoading,
    isRepostLoading,
    isLiked,
    isReposted,
  };
}

/**
 * Creates a unified post with up-to-date viewer state
 * 
 * Merges fresh like/repost state from local database for any post with AT URI
 * (both local Cannect users and external Bluesky users)
 */
export function useUnifiedPostWithState(post: UnifiedPost): UnifiedPost {
  const hasAtUri = post.uri?.startsWith("at://") ?? false;
  const uri = hasAtUri ? post.uri : "";
  
  const { data: likeState } = useHasLikedBlueskyPost(uri);
  const { data: repostState } = useHasRepostedBlueskyPost(uri);
  
  // If no AT URI, return as-is (pure local post without federation)
  if (!hasAtUri) {
    return post;
  }
  
  // Merge fresh state for any federated post
  return {
    ...post,
    viewer: {
      ...post.viewer,
      isLiked: likeState ?? post.viewer.isLiked,
      isReposted: repostState ?? post.viewer.isReposted,
    },
  };
}

/**
 * Wrapper component that enriches a post with viewer state
 * Use this in post detail views to get correct like/repost state
 * 
 * Checks local likes/reposts tables for ANY post with an AT URI,
 * not just external posts, since local Cannect users also have AT URIs.
 */
export function useEnrichedPost(post: UnifiedPost | null | undefined): UnifiedPost | null {
  // Enrich any post with an AT URI (both local Cannect users and external Bluesky users)
  const hasAtUri = post?.uri?.startsWith("at://") ?? false;
  const uri = hasAtUri ? post!.uri : "";
  
  const { data: isLiked } = useHasLikedBlueskyPost(uri);
  const { data: isReposted } = useHasRepostedBlueskyPost(uri);
  
  if (!post) return null;
  
  // If no AT URI, return as-is (pure local post)
  if (!hasAtUri) return post;
  
  return {
    ...post,
    viewer: {
      ...post.viewer,
      isLiked: isLiked ?? post.viewer.isLiked,
      isReposted: isReposted ?? post.viewer.isReposted,
    },
  };
}
