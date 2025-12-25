/**
 * AT Protocol Profile Hooks
 * 
 * Pure AT Protocol - no Supabase.
 * All profile data comes directly from the PDS.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as atproto from '@/lib/atproto/agent';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
import type { AppBskyActorDefs } from '@atproto/api';

// Re-export types
export type ProfileView = AppBskyActorDefs.ProfileView;
export type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;

/**
 * Get a user's profile by DID or handle
 */
export function useProfile(actor: string | undefined) {
  return useQuery({
    queryKey: ['profile', actor],
    queryFn: async () => {
      if (!actor) throw new Error('Actor required');
      const result = await atproto.getProfile(actor);
      return result.data;
    },
    enabled: !!actor,
    staleTime: 1000 * 30, // 30 seconds - profile counts change often
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when user returns to app (PWA)
  });
}

/**
 * Get current user's profile
 */
export function useMyProfile() {
  const { did, isAuthenticated } = useAuthStore();
  
  return useQuery({
    queryKey: ['profile', 'self', did],
    queryFn: async () => {
      if (!did) throw new Error('Not authenticated');
      const result = await atproto.getProfile(did);
      return result.data;
    },
    enabled: !!did && isAuthenticated,
    staleTime: 1000 * 30, // 30 seconds - profile counts change often
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when user returns to app (PWA)
  });
}

/**
 * Update current user's profile
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { did, setProfile } = useAuthStore();

  return useMutation({
    mutationFn: async (update: {
      displayName?: string;
      description?: string;
      avatar?: Uint8Array;
      avatarMimeType?: string;
      banner?: Uint8Array;
      bannerMimeType?: string;
    }) => {
      // Upload avatar if provided
      let avatarBlob;
      if (update.avatar && update.avatarMimeType) {
        const uploadResult = await atproto.uploadBlob(update.avatar, update.avatarMimeType);
        avatarBlob = uploadResult.data.blob;
      }

      // Upload banner if provided
      let bannerBlob;
      if (update.banner && update.bannerMimeType) {
        const uploadResult = await atproto.uploadBlob(update.banner, update.bannerMimeType);
        bannerBlob = uploadResult.data.blob;
      }

      return atproto.updateProfile({
        displayName: update.displayName,
        description: update.description,
        avatar: avatarBlob,
        banner: bannerBlob,
      });
    },
    onSuccess: async () => {
      // Refresh profile data
      if (did) {
        const result = await atproto.getProfile(did);
        setProfile({
          did: result.data.did,
          handle: result.data.handle,
          displayName: result.data.displayName,
          description: result.data.description,
          avatar: result.data.avatar,
          banner: result.data.banner,
          followersCount: result.data.followersCount,
          followsCount: result.data.followsCount,
          postsCount: result.data.postsCount,
        });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
    },
  });
}

/**
 * Get a user's followers
 */
export function useFollowers(actor: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['followers', actor],
    queryFn: async ({ pageParam }) => {
      if (!actor) throw new Error('Actor required');
      const result = await atproto.getFollowers(actor, pageParam, 50);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!actor,
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Get users that a user follows
 */
export function useFollowing(actor: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['following', actor],
    queryFn: async ({ pageParam }) => {
      if (!actor) throw new Error('Actor required');
      const result = await atproto.getFollows(actor, pageParam, 50);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!actor,
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Follow a user
 */
export function useFollow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (did: string) => {
      return atproto.follow(did);
    },
    onSuccess: (_, targetDid) => {
      queryClient.invalidateQueries({ queryKey: ['profile', targetDid] });
      queryClient.invalidateQueries({ queryKey: ['followers'] });
      queryClient.invalidateQueries({ queryKey: ['following'] });
    },
  });
}

/**
 * Unfollow a user
 */
export function useUnfollow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (followUri: string) => {
      await atproto.unfollow(followUri);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['followers'] });
      queryClient.invalidateQueries({ queryKey: ['following'] });
    },
  });
}

/**
 * Combined follow/unfollow hook
 */
export function useToggleFollow() {
  const followMutation = useFollow();
  const unfollowMutation = useUnfollow();

  return {
    follow: followMutation.mutateAsync,
    unfollow: unfollowMutation.mutateAsync,
    isFollowing: followMutation.isPending,
    isUnfollowing: unfollowMutation.isPending,
    isPending: followMutation.isPending || unfollowMutation.isPending,
  };
}

/**
 * Search for users
 */
export function useSearchUsers(query: string) {
  return useInfiniteQuery({
    queryKey: ['searchUsers', query],
    queryFn: async ({ pageParam }) => {
      const result = await atproto.searchActors(query, pageParam, 25);
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: query.length > 0,
    staleTime: 1000 * 60,
  });
}

/**
 * Get suggested users to follow - Cannect users only
 * Fetches users directly from Cannect PDS instead of relying on Bluesky's search index
 */
export function useSuggestedUsers() {
  const { isAuthenticated, did } = useAuthStore();
  
  return useQuery({
    queryKey: ['suggestedUsers', 'cannect', did],
    queryFn: async () => {
      // Get all users directly from Cannect PDS
      const profiles = await atproto.getCannectUsers(100);
      
      // Filter out current user and shuffle for variety
      const otherUsers = profiles.filter(p => p.did !== did);
      
      // Sort by follower count descending, take top 25
      const sorted = otherUsers.sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0));
      return sorted.slice(0, 25);
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
