/**
 * Search Screen - Pure AT Protocol
 */

import { useState, useMemo, useCallback } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Image, ScrollView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Search as SearchIcon, X, Users, Sparkles, UserPlus, Check } from "lucide-react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSearchUsers, useSuggestedUsers, useFollow } from "@/lib/hooks";
import { useDebounce } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import { useQueryClient } from "@tanstack/react-query";
import type { AppBskyActorDefs } from '@atproto/api';

type ProfileView = AppBskyActorDefs.ProfileView;
type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type AnyProfileView = ProfileView | ProfileViewDetailed;

type SearchTab = "users" | "trending";

function UserRow({ 
  user, 
  onPress, 
  onFollow,
  isFollowPending,
  showFollowButton = true,
  currentUserDid,
}: { 
  user: AnyProfileView; 
  onPress: () => void;
  onFollow?: () => void;
  isFollowPending?: boolean;
  showFollowButton?: boolean;
  currentUserDid?: string;
}) {
  const isFollowing = !!user.viewer?.following;
  const isSelf = user.did === currentUserDid;
  const canShowFollow = showFollowButton && !isFollowing && !isSelf && onFollow;

  return (
    <Pressable 
      onPress={onPress}
      className="flex-row items-center px-4 py-3 border-b border-border active:bg-surface-elevated"
    >
      {user.avatar ? (
        <Image source={{ uri: user.avatar }} className="w-12 h-12 rounded-full" />
      ) : (
        <View className="w-12 h-12 rounded-full bg-surface-elevated items-center justify-center">
          <Text className="text-text-muted text-lg">{user.handle[0].toUpperCase()}</Text>
        </View>
      )}
      <View className="flex-1 ml-3">
        <Text className="font-semibold text-text-primary">{user.displayName || user.handle}</Text>
        <Text className="text-text-muted">@{user.handle}</Text>
        {user.description && (
          <Text className="text-text-secondary text-sm mt-1" numberOfLines={2}>
            {user.description}
          </Text>
        )}
      </View>
      
      {/* Follow Button */}
      {canShowFollow && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onFollow();
          }}
          disabled={isFollowPending}
          className={`ml-2 px-4 py-2 rounded-full ${isFollowPending ? 'bg-primary/50' : 'bg-primary'}`}
        >
          {isFollowPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <View className="flex-row items-center gap-1">
              <UserPlus size={14} color="white" />
              <Text className="text-white font-semibold text-sm">Follow</Text>
            </View>
          )}
        </Pressable>
      )}
      
      {/* Already Following Badge */}
      {isFollowing && !isSelf && (
        <View className="ml-2 flex-row items-center gap-1 px-3 py-2 rounded-full bg-surface-elevated">
          <Check size={14} color="#10B981" />
          <Text className="text-primary text-sm font-medium">Following</Text>
        </View>
      )}
    </Pressable>
  );
}

function TrendingPlaceholder() {
  return (
    <View className="py-12 items-center px-6">
      <Sparkles size={48} color="#6B7280" />
      <Text className="text-text-primary text-lg font-semibold mt-4">
        Coming Soon
      </Text>
      <Text className="text-text-muted text-center mt-2">
        Trending topics and hashtags will appear here.
      </Text>
    </View>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("users");
  
  const debouncedQuery = useDebounce(query, 300);
  const hasQuery = debouncedQuery.trim().length >= 2;

  const usersQuery = useSearchUsers(hasQuery && activeTab === "users" ? debouncedQuery : "");
  const suggestedUsersQuery = useSuggestedUsers();
  
  const { did: currentUserDid } = useAuthStore();
  const followMutation = useFollow();
  const queryClient = useQueryClient();
  const [pendingFollows, setPendingFollows] = useState<Set<string>>(new Set());

  // Filter out users already being followed and self
  const users = useMemo(() => {
    const allUsers = usersQuery.data?.pages?.flatMap(page => page.actors) || [];
    return allUsers.filter(user => 
      !user.viewer?.following && user.did !== currentUserDid
    );
  }, [usersQuery.data, currentUserDid]);

  // Filter suggested users - exclude already following and self
  const suggestedUsers = useMemo(() => {
    const allUsers = suggestedUsersQuery.data || [];
    return allUsers.filter(user => 
      !user.viewer?.following && user.did !== currentUserDid
    );
  }, [suggestedUsersQuery.data, currentUserDid]);

  const isLoading = usersQuery.isLoading;
  const data = users;

  const handleUserPress = (user: AnyProfileView) => {
    router.push(`/user/${user.handle}`);
  };

  const handleFollow = useCallback(async (user: AnyProfileView) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    
    setPendingFollows(prev => new Set(prev).add(user.did));
    
    try {
      await followMutation.mutateAsync(user.did);
      // Invalidate queries to refresh the user lists
      queryClient.invalidateQueries({ queryKey: ['searchUsers'] });
      queryClient.invalidateQueries({ queryKey: ['suggestedUsers'] });
    } catch (error) {
      console.error('Failed to follow:', error);
    } finally {
      setPendingFollows(prev => {
        const next = new Set(prev);
        next.delete(user.did);
        return next;
      });
    }
  }, [followMutation, queryClient]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Search Header */}
      <View className="px-4 py-3 border-b border-border">
        <View className="flex-row items-center bg-surface-elevated rounded-xl px-4 py-2">
          <SearchIcon size={20} color="#6B7280" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Cannect..."
            placeholderTextColor="#6B7280"
            className="flex-1 ml-2 text-text-primary text-base py-1"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <X size={20} color="#6B7280" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View className="flex-row border-b border-border">
        <Pressable
          onPress={() => setActiveTab("users")}
          className={`flex-1 py-3 items-center ${activeTab === "users" ? "border-b-2 border-primary" : ""}`}
        >
          <Text className={activeTab === "users" ? "text-primary font-semibold" : "text-text-muted"}>
            Users
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("trending")}
          className={`flex-1 py-3 items-center ${activeTab === "trending" ? "border-b-2 border-primary" : ""}`}
        >
          <Text className={activeTab === "trending" ? "text-primary font-semibold" : "text-text-muted"}>
            Trending
          </Text>
        </Pressable>
      </View>

      {/* Results */}
      {!hasQuery ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {activeTab === "users" ? (
            <>
              {/* Suggested Users Section */}
              <View className="px-4 pt-4 pb-2">
                <View className="flex-row items-center gap-2 mb-3">
                  <Sparkles size={18} color="#10B981" />
                  <Text className="text-text-primary font-semibold text-lg">
                    Cannect Users
                  </Text>
                </View>
              </View>
              
              {suggestedUsersQuery.isLoading ? (
                <View className="py-8 items-center">
                  <ActivityIndicator size="large" color="#10B981" />
                </View>
              ) : suggestedUsers && suggestedUsers.length > 0 ? (
                suggestedUsers.map((user) => (
                  <UserRow 
                    key={user.did} 
                    user={user} 
                    onPress={() => handleUserPress(user)}
                    onFollow={() => handleFollow(user)}
                    isFollowPending={pendingFollows.has(user.did)}
                    currentUserDid={currentUserDid || undefined}
                  />
                ))
              ) : (
                <View className="py-12 items-center px-6">
                  <Users size={48} color="#6B7280" />
                  <Text className="text-text-primary text-lg font-semibold mt-4">
                    Be the first!
                  </Text>
                  <Text className="text-text-muted text-center mt-2">
                    No Cannect users yet. Invite your friends to join!
                  </Text>
                </View>
              )}
            </>
          ) : (
            <TrendingPlaceholder />
          )}
        </ScrollView>
      ) : activeTab === "trending" ? (
        <TrendingPlaceholder />
      ) : isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      ) : (
        <FlashList
          data={data}
          keyExtractor={(item: ProfileView, index) => `${item.did}-${index}`}
          estimatedItemSize={80}
          renderItem={({ item }: { item: ProfileView }) => (
            <UserRow 
              user={item} 
              onPress={() => handleUserPress(item)}
              onFollow={() => handleFollow(item)}
              isFollowPending={pendingFollows.has(item.did)}
              currentUserDid={currentUserDid || undefined}
            />
          )}
          onEndReached={() => {
            if (usersQuery.hasNextPage && !usersQuery.isFetchingNextPage) {
              usersQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <Text className="text-text-muted">No users found</Text>
            </View>
          }
          ListFooterComponent={
            usersQuery.isFetchingNextPage ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#10B981" />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
