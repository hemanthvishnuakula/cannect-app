/**
 * Profile Screen - Pure AT Protocol
 */

import { View, Text, Image, Pressable, RefreshControl, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Settings, LogOut, RefreshCw } from "lucide-react-native";
import { useMemo, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { useMyProfile, useAuthorFeed, useLogout } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;

function formatNumber(num: number | undefined): string {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function ProfilePost({ item }: { item: FeedViewPost }) {
  const post = item.post;
  const record = post.record as AppBskyFeedPost.Record;

  return (
    <View className="px-4 py-3 border-b border-border">
      <Text className="text-text-primary leading-5">{record.text}</Text>
      <Text className="text-text-muted text-sm mt-2">{formatTime(record.createdAt)}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { did, handle, profile } = useAuthStore();
  const logoutMutation = useLogout();
  
  const profileQuery = useMyProfile();
  const feedQuery = useAuthorFeed(did || undefined);

  const posts = useMemo(() => {
    return feedQuery.data?.pages?.flatMap(page => page.feed) || [];
  }, [feedQuery.data]);

  const handleRefresh = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    profileQuery.refetch();
    feedQuery.refetch();
  }, [profileQuery, feedQuery]);

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    router.replace("/(auth)/welcome");
  };

  const profileData = profileQuery.data;

  if (profileQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#10B981" />
      </SafeAreaView>
    );
  }

  if (profileQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-6">
        <RefreshCw size={48} color="#6B7280" />
        <Text className="text-text-primary text-lg font-semibold mt-4">Failed to load profile</Text>
        <Pressable onPress={() => profileQuery.refetch()} className="bg-primary px-6 py-3 rounded-full mt-4">
          <Text className="text-white font-semibold">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <FlashList
        data={posts}
        keyExtractor={(item, index) => `${item.post.uri}-${index}`}
        estimatedItemSize={100}
        ListHeaderComponent={
          <View>
            {/* Banner */}
            {profileData?.banner ? (
              <Image source={{ uri: profileData.banner }} className="w-full h-32" resizeMode="cover" />
            ) : (
              <View className="w-full h-32 bg-primary/20" />
            )}

            {/* Profile Info */}
            <View className="px-4 -mt-12">
              {/* Avatar */}
              {profileData?.avatar ? (
                <Image 
                  source={{ uri: profileData.avatar }} 
                  className="w-24 h-24 rounded-full border-4 border-background"
                />
              ) : (
                <View className="w-24 h-24 rounded-full border-4 border-background bg-surface-elevated items-center justify-center">
                  <Text className="text-text-muted text-3xl">
                    {(profileData?.handle || handle || '?')[0].toUpperCase()}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View className="absolute right-4 top-14 flex-row gap-2">
                <Pressable 
                  onPress={handleLogout}
                  className="bg-surface-elevated border border-border px-4 py-2 rounded-full flex-row items-center"
                >
                  <LogOut size={16} color="#EF4444" />
                  <Text className="text-red-500 font-semibold ml-2">Logout</Text>
                </Pressable>
              </View>

              {/* Name & Handle */}
              <Text className="text-xl font-bold text-text-primary mt-3">
                {profileData?.displayName || handle}
              </Text>
              <Text className="text-text-muted">@{profileData?.handle || handle}</Text>

              {/* Bio */}
              {profileData?.description && (
                <Text className="text-text-primary mt-2">{profileData.description}</Text>
              )}

              {/* Stats */}
              <View className="flex-row gap-4 mt-3">
                <Pressable className="flex-row items-center">
                  <Text className="font-bold text-text-primary">
                    {formatNumber(profileData?.followersCount)}
                  </Text>
                  <Text className="text-text-muted ml-1">followers</Text>
                </Pressable>
                <Pressable className="flex-row items-center">
                  <Text className="font-bold text-text-primary">
                    {formatNumber(profileData?.followsCount)}
                  </Text>
                  <Text className="text-text-muted ml-1">following</Text>
                </Pressable>
                <View className="flex-row items-center">
                  <Text className="font-bold text-text-primary">
                    {formatNumber(profileData?.postsCount)}
                  </Text>
                  <Text className="text-text-muted ml-1">posts</Text>
                </View>
              </View>
            </View>

            {/* Posts Header */}
            <View className="border-b border-border mt-4 pb-3 px-4">
              <Text className="font-semibold text-text-primary">Posts</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => <ProfilePost item={item} />}
        refreshControl={
          <RefreshControl
            refreshing={profileQuery.isRefetching || feedQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor="#10B981"
          />
        }
        onEndReached={() => {
          if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
            feedQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          feedQuery.isLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#10B981" />
            </View>
          ) : (
            <View className="py-20 items-center">
              <Text className="text-text-muted">No posts yet</Text>
            </View>
          )
        }
        ListFooterComponent={
          feedQuery.isFetchingNextPage ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#10B981" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
