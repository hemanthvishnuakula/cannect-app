/**
 * Profile Screen - Pure AT Protocol
 * Tabs: Posts, Reposts, Replies, Likes
 */

import { useState, useMemo, useCallback } from "react";
import { View, Text, Image, Pressable, RefreshControl, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { LogOut, RefreshCw, Edit3 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useMyProfile, useAuthorFeed, useActorLikes, useLogout } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type ProfileTab = "posts" | "reposts" | "replies" | "likes";

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

function ProfilePost({ item, showAuthor = false }: { item: FeedViewPost; showAuthor?: boolean }) {
  const post = item.post;
  const record = post.record as AppBskyFeedPost.Record;
  const router = useRouter();

  const handlePress = () => {
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.author.did}/${rkey}`);
  };

  return (
    <Pressable 
      onPress={handlePress}
      className="px-4 py-3 border-b border-border active:bg-surface-elevated"
    >
      {showAuthor && (
        <View className="flex-row items-center mb-2">
          {post.author.avatar ? (
            <Image source={{ uri: post.author.avatar }} className="w-8 h-8 rounded-full" />
          ) : (
            <View className="w-8 h-8 rounded-full bg-surface-elevated items-center justify-center">
              <Text className="text-text-muted">{post.author.handle[0].toUpperCase()}</Text>
            </View>
          )}
          <Text className="font-semibold text-text-primary ml-2">
            {post.author.displayName || post.author.handle}
          </Text>
        </View>
      )}
      <Text className="text-text-primary leading-5">{record.text}</Text>
      <Text className="text-text-muted text-sm mt-2">{formatTime(record.createdAt)}</Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { did, handle } = useAuthStore();
  const logoutMutation = useLogout();
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  
  const profileQuery = useMyProfile();
  
  // Different feeds based on active tab
  const postsQuery = useAuthorFeed(did || undefined, 'posts_no_replies');
  const repliesQuery = useAuthorFeed(did || undefined, 'posts_with_replies');
  const likesQuery = useActorLikes(did || undefined);

  // Get posts data based on active tab
  const posts = useMemo(() => {
    if (activeTab === "posts") {
      return postsQuery.data?.pages?.flatMap(page => page.feed) || [];
    } else if (activeTab === "reposts") {
      // Filter for reposts only
      const allPosts = postsQuery.data?.pages?.flatMap(page => page.feed) || [];
      return allPosts.filter(item => item.reason?.$type === 'app.bsky.feed.defs#reasonRepost');
    } else if (activeTab === "replies") {
      // Get posts with replies then filter for actual replies
      const allPosts = repliesQuery.data?.pages?.flatMap(page => page.feed) || [];
      return allPosts.filter(item => {
        const record = item.post.record as any;
        return record?.reply; // Has reply reference = it's a reply
      });
    } else if (activeTab === "likes") {
      return likesQuery.data?.pages?.flatMap(page => page.feed) || [];
    }
    return [];
  }, [activeTab, postsQuery.data, repliesQuery.data, likesQuery.data]);

  const currentQuery = activeTab === "likes" ? likesQuery : 
                       activeTab === "replies" ? repliesQuery : postsQuery;

  const handleRefresh = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    profileQuery.refetch();
    currentQuery.refetch();
  }, [profileQuery, currentQuery]);

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    router.replace("/(auth)/welcome");
  };

  const handleEditProfile = () => {
    router.push("/settings/edit-profile" as any);
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

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "posts", label: "Posts" },
    { key: "reposts", label: "Reposts" },
    { key: "replies", label: "Replies" },
    { key: "likes", label: "Likes" },
  ];

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

              {/* Actions - Edit Profile + Sign Out */}
              <View className="absolute right-4 top-14 flex-row gap-2">
                <Pressable 
                  onPress={handleEditProfile}
                  className="bg-surface-elevated border border-border px-4 py-2 rounded-full flex-row items-center"
                >
                  <Edit3 size={16} color="#FAFAFA" />
                  <Text className="text-text-primary font-semibold ml-2">Edit Profile</Text>
                </Pressable>
                <Pressable 
                  onPress={handleLogout}
                  className="bg-surface-elevated border border-border p-2 rounded-full items-center justify-center"
                >
                  <LogOut size={18} color="#EF4444" />
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

            {/* Tabs */}
            <View className="flex-row border-b border-border mt-4">
              {tabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  className={`flex-1 py-3 items-center ${activeTab === tab.key ? "border-b-2 border-primary" : ""}`}
                >
                  <Text className={activeTab === tab.key ? "text-primary font-semibold" : "text-text-muted"}>
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <ProfilePost item={item} showAuthor={activeTab === "likes"} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={profileQuery.isRefetching || currentQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor="#10B981"
          />
        }
        onEndReached={() => {
          if (currentQuery.hasNextPage && !currentQuery.isFetchingNextPage) {
            currentQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          currentQuery.isLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#10B981" />
            </View>
          ) : (
            <View className="py-20 items-center">
              <Text className="text-text-muted">
                {activeTab === "posts" && "No posts yet"}
                {activeTab === "reposts" && "No reposts yet"}
                {activeTab === "replies" && "No replies yet"}
                {activeTab === "likes" && "No likes yet"}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          currentQuery.isFetchingNextPage ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#10B981" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
