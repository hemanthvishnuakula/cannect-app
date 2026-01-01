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
 * Uses Bluesky's official API
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
      // Refresh profile data - use setProfile directly (no invalidation to avoid flash)
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
        // Only invalidate the specific profile query, not all profile queries
        // This prevents the cascade of re-renders across the app
        queryClient.setQueryData(['profile', 'self', did], result.data);
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
    maxPages: 20, // Memory optimization: keep max 20 pages (1000 followers) to prevent crashes
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
    maxPages: 20, // Memory optimization: keep max 20 pages (1000 following) to prevent crashes
    enabled: !!actor,
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Follow a user with optimistic update
 * Updates profile cache AND user list caches (suggested users, search results)
 */
export function useFollow() {
  const queryClient = useQueryClient();
  const { did: myDid } = useAuthStore();

  // Helper to update a user in any list cache
  const updateUserInLists = (targetDid: string, followUri: string | undefined) => {
    // Update suggested users cache
    queryClient.setQueriesData({ queryKey: ['suggestedUsers'] }, (old: any) => {
      if (!old || !Array.isArray(old)) return old;
      return old.map((user: any) =>
        user.did === targetDid
          ? { ...user, viewer: { ...user.viewer, following: followUri } }
          : user
      );
    });

    // Update search users cache (infinite query format)
    queryClient.setQueriesData({ queryKey: ['searchUsers'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          actors: page.actors?.map((user: any) =>
            user.did === targetDid
              ? { ...user, viewer: { ...user.viewer, following: followUri } }
              : user
          ),
        })),
      };
    });
  };

  return useMutation({
    mutationFn: async (targetDid: string) => {
      const result = await atproto.follow(targetDid);
      return { ...result, targetDid };
    },
    onMutate: async (targetDid: string) => {
      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['profile', targetDid] });
      await queryClient.cancelQueries({ queryKey: ['suggestedUsers'] });
      await queryClient.cancelQueries({ queryKey: ['searchUsers'] });

      // Snapshot current state for rollback
      const previousProfile = queryClient.getQueryData(['profile', targetDid]);
      const previousSuggested = queryClient.getQueriesData({ queryKey: ['suggestedUsers'] });
      const previousSearch = queryClient.getQueriesData({ queryKey: ['searchUsers'] });

      // Optimistically update the profile
      queryClient.setQueryData(['profile', targetDid], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          followersCount: (old.followersCount || 0) + 1,
          viewer: { ...old.viewer, following: 'pending' },
        };
      });

      // Optimistically update user lists
      updateUserInLists(targetDid, 'pending');

      return { previousProfile, previousSuggested, previousSearch, targetDid };
    },
    onSuccess: (result, _, context) => {
      // Update with actual follow URI from server
      if (context?.targetDid) {
        queryClient.setQueryData(['profile', context.targetDid], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            viewer: { ...old.viewer, following: result.uri },
          };
        });

        // Update lists with actual URI
        updateUserInLists(context.targetDid, result.uri);
      }
    },
    onError: (err, targetDid, context) => {
      // Rollback profile
      if (context?.previousProfile) {
        queryClient.setQueryData(['profile', targetDid], context.previousProfile);
      }

      // Rollback suggested users
      if (context?.previousSuggested) {
        context.previousSuggested.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }

      // Rollback search users
      if (context?.previousSearch) {
        context.previousSearch.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: (_, __, targetDid) => {
      // Reconcile with server after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['profile', targetDid] });
        queryClient.invalidateQueries({ queryKey: ['followers', targetDid] });
        queryClient.invalidateQueries({ queryKey: ['following', myDid] });
      }, 2000);
    },
  });
}

/**
 * Unfollow a user with optimistic update
 * Updates profile cache AND user list caches (suggested users, search results)
 */
export function useUnfollow() {
  const queryClient = useQueryClient();
  const { did: myDid } = useAuthStore();

  // Helper to update a user in any list cache
  const updateUserInLists = (targetDid: string, followUri: string | undefined) => {
    // Update suggested users cache
    queryClient.setQueriesData({ queryKey: ['suggestedUsers'] }, (old: any) => {
      if (!old || !Array.isArray(old)) return old;
      return old.map((user: any) =>
        user.did === targetDid
          ? { ...user, viewer: { ...user.viewer, following: followUri } }
          : user
      );
    });

    // Update search users cache (infinite query format)
    queryClient.setQueriesData({ queryKey: ['searchUsers'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          actors: page.actors?.map((user: any) =>
            user.did === targetDid
              ? { ...user, viewer: { ...user.viewer, following: followUri } }
              : user
          ),
        })),
      };
    });
  };

  return useMutation({
    mutationFn: async ({ followUri, targetDid }: { followUri: string; targetDid: string }) => {
      // Validate followUri before attempting to unfollow
      if (!followUri || followUri === 'pending') {
        throw new Error('Invalid follow URI - please refresh and try again');
      }
      await atproto.unfollow(followUri);
      return { targetDid };
    },
    onMutate: async ({ targetDid }) => {
      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['profile', targetDid] });
      await queryClient.cancelQueries({ queryKey: ['suggestedUsers'] });
      await queryClient.cancelQueries({ queryKey: ['searchUsers'] });

      // Snapshot current state for rollback
      const previousProfile = queryClient.getQueryData(['profile', targetDid]);
      const previousSuggested = queryClient.getQueriesData({ queryKey: ['suggestedUsers'] });
      const previousSearch = queryClient.getQueriesData({ queryKey: ['searchUsers'] });

      // Optimistically update the profile
      queryClient.setQueryData(['profile', targetDid], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          followersCount: Math.max((old.followersCount || 1) - 1, 0),
          viewer: { ...old.viewer, following: undefined },
        };
      });

      // Optimistically update user lists
      updateUserInLists(targetDid, undefined);

      return { previousProfile, previousSuggested, previousSearch, targetDid };
    },
    onError: (err, variables, context) => {
      // Rollback profile
      if (context?.previousProfile) {
        queryClient.setQueryData(['profile', context.targetDid], context.previousProfile);
      }

      // Rollback suggested users
      if (context?.previousSuggested) {
        context.previousSuggested.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }

      // Rollback search users
      if (context?.previousSearch) {
        context.previousSearch.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: (_, __, { targetDid }) => {
      // Reconcile with server after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['profile', targetDid] });
        queryClient.invalidateQueries({ queryKey: ['followers', targetDid] });
        queryClient.invalidateQueries({ queryKey: ['following', myDid] });
      }, 2000);
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
 * Get suggested users to follow - Cannect users first, then Bluesky suggestions
 * Fetches users directly from Cannect PDS, falls back to Bluesky network suggestions
 */
export function useSuggestedUsers() {
  const { isAuthenticated, did } = useAuthStore();

  return useQuery({
    queryKey: ['suggestedUsers', 'cannect', did],
    queryFn: async () => {
      // First, try to get users from Cannect PDS
      const cannectProfiles = await atproto.getCannectUsers(100);

      // Filter out current user
      const cannectUsers = cannectProfiles.filter((p) => p.did !== did);

      // Sort by follower count descending
      const sortedCannect = cannectUsers.sort(
        (a, b) => (b.followersCount || 0) - (a.followersCount || 0)
      );

      // If we have Cannect users, return them (up to 100)
      if (sortedCannect.length > 0) {
        return sortedCannect.slice(0, 100);
      }

      // Fallback: Get suggestions from Bluesky network
      try {
        const bskySuggestions = await atproto.getSuggestions(undefined, 50);
        const bskyActors = bskySuggestions.data?.actors || [];

        // Filter out current user and return
        return bskyActors.filter((p) => p.did !== did).slice(0, 100);
      } catch (error) {
        console.error('[useSuggestedUsers] Bluesky suggestions fallback failed:', error);
        return [];
      }
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
