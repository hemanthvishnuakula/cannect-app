import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import type { Profile } from "@/lib/types/database";
import * as atprotoAgent from "@/lib/services/atproto-agent";

// Fetch profile by ID
export function useProfile(userId: string) {
  return useQuery({
    queryKey: queryKeys.profiles.detail(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      return data as Profile;
    },
    enabled: !!userId,
  });
}

// Update profile
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Profile> }) => {
      const { error } = await (supabase
        .from("profiles") as any)
        .update(updates)
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      // Invalidate profile cache
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.profiles.detail(variables.id) 
      });
      // ✅ Also invalidate posts cache so updated name/avatar shows in feed
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.posts.byUser(variables.id) 
      });
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.posts.all 
      });
    },
  });
}

// Fetch profile by username
export function useProfileByUsername(username: string) {
  return useQuery({
    queryKey: queryKeys.profiles.byUsername(username),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username)
        .single();

      if (error) throw error;
      return data as Profile;
    },
    enabled: !!username,
  });
}

// Constants for Bluesky API proxy
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const getProxyHeaders = () => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "apikey": SUPABASE_ANON_KEY,
});

/**
 * Unified Profile Resolver - handles both local and external users
 * 
 * Resolution order:
 * 1. Check if identifier is a UUID → direct lookup
 * 2. Check profiles table by handle
 * 3. Check profiles table by username (for local users)
 * 4. If identifier has a dot, fetch from Bluesky and upsert
 */
export function useResolveProfile(identifier: string) {
  return useQuery({
    queryKey: ['profile', 'resolve', identifier],
    queryFn: async () => {
      if (!identifier) return null;
      
      // Step 0: Check if identifier is a UUID (36 chars with dashes)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
      
      if (isUUID) {
        const { data: byId } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", identifier)
          .maybeSingle();
        
        if (byId) {
          return {
            ...byId,
            is_external: byId.is_local === false,
          } as Profile & { is_external?: boolean };
        }
        return null; // UUID not found, don't try other lookups
      }
      
      // Step 1: Try to find by handle (works for both local and external)
      const { data: byHandle } = await supabase
        .from("profiles")
        .select("*")
        .eq("handle", identifier)
        .maybeSingle();
      
      if (byHandle) {
        return {
          ...byHandle,
          is_external: byHandle.is_local === false,
        } as Profile & { is_external?: boolean };
      }
      
      // Step 2: Try by username (for local users with Cannect usernames)
      const { data: byUsername } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", identifier)
        .maybeSingle();
      
      if (byUsername) {
        return {
          ...byUsername,
          is_external: byUsername.is_local === false,
        } as Profile & { is_external?: boolean };
      }
      
      // Step 3: If identifier looks like a Bluesky handle (has a dot), fetch from Bluesky
      if (identifier.includes('.')) {
        try {
          const profileUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=getProfile&handle=${encodeURIComponent(identifier)}`;
          const profileRes = await fetch(profileUrl, { headers: getProxyHeaders() });
          
          if (!profileRes.ok) {
            throw new Error(`Bluesky API error: ${profileRes.status}`);
          }
          
          const blueskyProfile = await profileRes.json();
          
          if (blueskyProfile && blueskyProfile.did) {
            // Upsert the external profile and return it
            const { data: profileId } = await supabase.rpc('upsert_external_profile', {
              p_did: blueskyProfile.did,
              p_handle: blueskyProfile.handle,
              p_display_name: blueskyProfile.displayName || blueskyProfile.handle,
              p_avatar_url: blueskyProfile.avatar || null,
              p_bio: blueskyProfile.description || null,
              p_followers_count: blueskyProfile.followersCount || 0,
              p_following_count: blueskyProfile.followsCount || 0,
              p_posts_count: blueskyProfile.postsCount || 0,
            });
            
            // Fetch the newly created/updated profile
            const { data: newProfile } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", profileId)
              .single();
            
            if (newProfile) {
              return {
                ...newProfile,
                is_external: !newProfile.is_local,
              } as Profile & { is_external?: boolean };
            }
          }
        } catch (error) {
          console.error("Failed to fetch Bluesky profile:", error);
          throw error;
        }
      }
      
      // Profile not found
      return null;
    },
    enabled: !!identifier,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: 1, // Only retry once for network errors
  });
}

// Check if current user follows target user
export function useIsFollowing(targetUserId: string) {
  const { user } = useAuthStore(); // ✅ Consistent: use store instead of getSession

  return useQuery({
    queryKey: queryKeys.follows.isFollowing("current", targetUserId),
    queryFn: async () => {
      if (!user) return false;

      const { data, error } = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", user.id)
        .eq("following_id", targetUserId)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!targetUserId && !!user,
  });
}

// Follow a user with optimistic updates
export function useFollowUser() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({ targetUserId, targetDid }: { targetUserId: string; targetDid?: string | null }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("follows").insert({
        follower_id: user.id,
        following_id: targetUserId,
        subject_did: targetDid, // AT Protocol DID for federation
      } as any);
      if (error) throw error;
      return targetUserId;
    },
    // ✅ Optimistic update for instant UI feedback
    onMutate: async ({ targetUserId }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ 
        queryKey: queryKeys.follows.isFollowing("current", targetUserId) 
      });
      await queryClient.cancelQueries({ 
        queryKey: queryKeys.profiles.detail(targetUserId) 
      });
      
      // Snapshot previous values
      const previousIsFollowing = queryClient.getQueryData(
        queryKeys.follows.isFollowing("current", targetUserId)
      );
      const previousProfile = queryClient.getQueryData(
        queryKeys.profiles.detail(targetUserId)
      );
      const previousMyProfile = queryClient.getQueryData(
        queryKeys.profiles.detail(user?.id ?? "")
      );
      
      // Optimistically set to following
      queryClient.setQueryData(
        queryKeys.follows.isFollowing("current", targetUserId),
        true
      );
      
      // Optimistically update follower count on target
      queryClient.setQueryData(
        queryKeys.profiles.detail(targetUserId),
        (old: any) => old ? { 
          ...old, 
          followers_count: (old.followers_count || 0) + 1 
        } : old
      );
      
      // Optimistically update following count on self
      if (user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          (old: any) => old ? { 
            ...old, 
            following_count: (old.following_count || 0) + 1 
          } : old
        );
      }
      
      return { previousIsFollowing, previousProfile, previousMyProfile };
    },
    onError: (err, { targetUserId }, context) => {
      // Rollback on error
      if (context?.previousIsFollowing !== undefined) {
        queryClient.setQueryData(
          queryKeys.follows.isFollowing("current", targetUserId),
          context.previousIsFollowing
        );
      }
      if (context?.previousProfile) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(targetUserId),
          context.previousProfile
        );
      }
      if (context?.previousMyProfile && user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          context.previousMyProfile
        );
      }
    },
    onSettled: (result, error, { targetUserId }) => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: queryKeys.follows.isFollowing("current", targetUserId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(targetUserId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user?.id!) });
      // ✅ Invalidate relationships lists so they refresh
      queryClient.invalidateQueries({ queryKey: ['user-relationships', targetUserId!] });
      queryClient.invalidateQueries({ queryKey: ['user-relationships', user?.id!] });
    },
  });
}

// Unfollow a user with optimistic updates
export function useUnfollowUser() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore(); // ✅ Consistent: use store instead of getSession

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", targetUserId);

      if (error) throw error;
      return targetUserId;
    },
    // ✅ Optimistic update for instant UI feedback
    onMutate: async (targetUserId) => {
      await queryClient.cancelQueries({ 
        queryKey: queryKeys.follows.isFollowing("current", targetUserId) 
      });
      await queryClient.cancelQueries({ 
        queryKey: queryKeys.profiles.detail(targetUserId) 
      });
      
      const previousIsFollowing = queryClient.getQueryData(
        queryKeys.follows.isFollowing("current", targetUserId)
      );
      const previousProfile = queryClient.getQueryData(
        queryKeys.profiles.detail(targetUserId)
      );
      const previousMyProfile = queryClient.getQueryData(
        queryKeys.profiles.detail(user?.id ?? "")
      );
      
      // Optimistically set to not following
      queryClient.setQueryData(
        queryKeys.follows.isFollowing("current", targetUserId),
        false
      );
      
      // Optimistically update follower count on target
      queryClient.setQueryData(
        queryKeys.profiles.detail(targetUserId),
        (old: any) => old ? { 
          ...old, 
          followers_count: Math.max(0, (old.followers_count || 0) - 1)
        } : old
      );
      
      // Optimistically update following count on self
      if (user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          (old: any) => old ? { 
            ...old, 
            following_count: Math.max(0, (old.following_count || 0) - 1)
          } : old
        );
      }
      
      return { previousIsFollowing, previousProfile, previousMyProfile };
    },
    onError: (err, targetUserId, context) => {
      if (context?.previousIsFollowing !== undefined) {
        queryClient.setQueryData(
          queryKeys.follows.isFollowing("current", targetUserId),
          context.previousIsFollowing
        );
      }
      if (context?.previousProfile) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(targetUserId),
          context.previousProfile
        );
      }
      if (context?.previousMyProfile && user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          context.previousMyProfile
        );
      }
    },
    onSettled: (targetUserId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.follows.isFollowing("current", targetUserId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.profiles.detail(targetUserId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.profiles.detail(user?.id!),
      });
      // ✅ Invalidate relationships lists so they refresh
      queryClient.invalidateQueries({ queryKey: ['user-relationships', targetUserId!] });
      queryClient.invalidateQueries({ queryKey: ['user-relationships', user?.id!] });
    },
  });
}

// ============================================================================
// External Bluesky User Follow/Unfollow
// ============================================================================

export interface BlueskyUserInfo {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * Check if current user follows an external Bluesky user by DID
 */
export function useIsFollowingDid(targetDid: string) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["follows", "isFollowingDid", user?.id, targetDid],
    queryFn: async () => {
      if (!user) return false;

      const { data, error } = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", user.id)
        .eq("subject_did", targetDid)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!targetDid && !!user,
  });
}

/**
 * Follow an external Bluesky user (PDS-first approach)
 * Creates the follow on PDS first, then mirrors to database
 */
export function useFollowBlueskyUser() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (blueskyUser: BlueskyUserInfo) => {
      if (!user) throw new Error("Not authenticated");
      
      // PDS-first: Call atproto-agent edge function
      // The edge function handles both PDS creation and DB mirroring
      await atprotoAgent.followUser({
        userId: user.id,
        targetDid: blueskyUser.did,
        targetHandle: blueskyUser.handle,
        targetDisplayName: blueskyUser.displayName,
        targetAvatar: blueskyUser.avatar,
      });
      
      console.log("[useFollowBlueskyUser] Follow created via PDS-first");
      return blueskyUser.did;
    },
    onMutate: async (blueskyUser) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ 
        queryKey: ["follows", "isFollowingDid", user?.id, blueskyUser.did] 
      });
      
      // Snapshot previous value
      const previousIsFollowing = queryClient.getQueryData(
        ["follows", "isFollowingDid", user?.id, blueskyUser.did]
      );
      
      // Optimistically set to following
      queryClient.setQueryData(
        ["follows", "isFollowingDid", user?.id, blueskyUser.did],
        true
      );
      
      // Update my following count
      if (user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          (old: any) => old ? { 
            ...old, 
            following_count: (old.following_count || 0) + 1 
          } : old
        );
      }
      
      return { previousIsFollowing };
    },
    onError: (err, blueskyUser, context) => {
      if (context?.previousIsFollowing !== undefined) {
        queryClient.setQueryData(
          ["follows", "isFollowingDid", user?.id, blueskyUser.did],
          context.previousIsFollowing
        );
      }
      if (user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          (old: any) => old ? { 
            ...old, 
            following_count: Math.max(0, (old.following_count || 0) - 1)
          } : old
        );
      }
    },
    onSettled: (did) => {
      queryClient.invalidateQueries({ queryKey: ["follows", "isFollowingDid", user?.id, did] });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user?.id!) });
      queryClient.invalidateQueries({ queryKey: ['user-relationships', user?.id!] });
    },
  });
}

/**
 * Unfollow an external Bluesky user (PDS-first approach)
 * Deletes the follow from PDS first, then removes from database
 */
export function useUnfollowBlueskyUser() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (targetDid: string) => {
      if (!user) throw new Error("Not authenticated");

      // PDS-first: Call atproto-agent edge function
      await atprotoAgent.unfollowUser({
        userId: user.id,
        targetDid,
      });

      console.log("[useUnfollowBlueskyUser] Unfollow completed via PDS-first");
      return targetDid;
    },
    onMutate: async (targetDid) => {
      await queryClient.cancelQueries({ 
        queryKey: ["follows", "isFollowingDid", user?.id, targetDid] 
      });
      
      const previousIsFollowing = queryClient.getQueryData(
        ["follows", "isFollowingDid", user?.id, targetDid]
      );
      
      queryClient.setQueryData(
        ["follows", "isFollowingDid", user?.id, targetDid],
        false
      );
      
      if (user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          (old: any) => old ? { 
            ...old, 
            following_count: Math.max(0, (old.following_count || 0) - 1)
          } : old
        );
      }
      
      return { previousIsFollowing };
    },
    onError: (err, targetDid, context) => {
      if (context?.previousIsFollowing !== undefined) {
        queryClient.setQueryData(
          ["follows", "isFollowingDid", user?.id, targetDid],
          context.previousIsFollowing
        );
      }
      if (user?.id) {
        queryClient.setQueryData(
          queryKeys.profiles.detail(user.id),
          (old: any) => old ? { 
            ...old, 
            following_count: (old.following_count || 0) + 1
          } : old
        );
      }
    },
    onSettled: (targetDid) => {
      queryClient.invalidateQueries({ queryKey: ["follows", "isFollowingDid", user?.id, targetDid] });
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(user?.id!) });
      queryClient.invalidateQueries({ queryKey: ['user-relationships', user?.id!] });
    },
  });
}

// Get followers
export function useFollowers(userId: string) {
  return useQuery({
    queryKey: queryKeys.follows.followers(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          *,
          follower:profiles!follower_id(*)
        `)
        .eq("following_id", userId);

      if (error) throw error;
      return (data as any[]).map((f) => f.follower) as Profile[];
    },
    enabled: !!userId,
  });
}

// Get following
export function useFollowing(userId: string) {
  return useQuery({
    queryKey: queryKeys.follows.following(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          *,
          following:profiles!following_id(*)
        `)
        .eq("follower_id", userId);

      if (error) throw error;
      return (data as any[]).map((f) => f.following) as Profile[];
    },
    enabled: !!userId,
  });
}

// Search users by name or username
export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: queryKeys.search.users(query), // Use factory key
    queryFn: async () => {
      // Logic handled by 'enabled' property to prevent empty calls
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .limit(20);

      if (error) throw error;
      return data as Profile[];
    },
    enabled: query.trim().length >= 2, // Threshold check
    staleTime: 1000 * 60, // Search results can stay fresh for 1 minute
  });
}

// ✅ Diamond Standard: Infinite scrolling social graph discovery
// SIMPLIFIED: All follows now have proper profile references (no more NULL following_id)
export function useUserRelationships(userId: string, type: 'followers' | 'following') {
  const { user: currentUser } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['user-relationships', userId, type],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * 20;
      const to = from + 19;

      const matchColumn = type === 'followers' ? 'following_id' : 'follower_id';
      const selectColumn = type === 'followers' 
        ? 'profile:profiles!follower_id(*)' 
        : 'profile:profiles!following_id(*)';

      const { data, error } = await supabase
        .from('follows')
        .select(`id, ${selectColumn}`)
        .eq(matchColumn, userId)
        .range(from, to);

      if (error) throw error;

      // Extract the profile objects - now includes both local and external users
      const profiles = data.map((item: any) => ({
        ...item.profile,
        // Mark external users for UI differentiation
        is_external: item.profile?.is_local === false,
      }));
      
      // Enrich with "is_following" status for the current viewer
      if (currentUser?.id && profiles.length > 0) {
        const profileIds = profiles.map((p: any) => p.id);
        const { data: myFollows } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', currentUser.id)
          .in('following_id', profileIds);
          
        const followSet = new Set((myFollows as any[])?.map(f => f.following_id) || []);
        return profiles.map((p: any) => ({
          ...p,
          is_following: followSet.has(p.id)
        }));
      }

      return profiles;
    },
    getNextPageParam: (lastPage, allPages) => 
      lastPage.length === 20 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!userId,
  });
}
