import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import type { Profile } from "@/lib/types/database";

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
    mutationFn: async (targetUserId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("follows").insert({
        follower_id: user.id,
        following_id: targetUserId,
      } as any);
      if (error) throw error;
      return targetUserId;
    },
    // ✅ Optimistic update for instant UI feedback
    onMutate: async (targetUserId) => {
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
    onError: (err, targetUserId, context) => {
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
    onSettled: (targetUserId) => {
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
export function useUserRelationships(userId: string, type: 'followers' | 'following') {
  const { user: currentUser } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['user-relationships', userId, type],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * 20;
      const to = from + 19;

      const matchColumn = type === 'followers' ? 'following_id' : 'follower_id';
      const selectColumn = type === 'followers' 
        ? 'follower:profiles!follower_id(*)' 
        : 'following:profiles!following_id(*)';

      const { data, error } = await supabase
        .from('follows')
        .select(`id, ${selectColumn}`)
        .eq(matchColumn, userId)
        .range(from, to);

      if (error) throw error;

      // Extract the profile objects from the join
      const profiles = data.map((item: any) => 
        type === 'followers' ? item.follower : item.following
      );
      
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
