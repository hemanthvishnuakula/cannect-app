/**
 * User Profile Screen - Pure AT Protocol
 * 
 * Route: /user/[handle]
 * Displays a user's profile and their posts.
 */

import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { ArrowLeft, UserPlus, UserMinus, MoreHorizontal, RefreshCw } from "lucide-react-native";
import { Image } from "expo-image";
import { useMemo, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { useProfile, useAuthorFeed, useFollow, useUnfollow } from "@/lib/hooks";
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

function PostItem({ item, onPress }: { item: FeedViewPost; onPress: () => void }) {
  const post = item.post;
  const record = post.record as AppBskyFeedPost.Record;

  return (
    <Pressable onPress={onPress} className="px-4 py-3 border-b border-border active:bg-surface-elevated">
      <Text className="text-text-primary leading-5">{record.text}</Text>
      <View className="flex-row items-center mt-2">
        <Text className="text-text-muted text-sm">{formatTime(record.createdAt)}</Text>
        <Text className="text-text-muted text-sm ml-4">❤️ {formatNumber(post.likeCount)}</Text>
        <Text className="text-text-muted text-sm ml-3">🔄 {formatNumber(post.repostCount)}</Text>
      </View>
    </Pressable>
  );
}

export default function UserProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const { did: myDid } = useAuthStore();
  
  const profileQuery = useProfile(handle || "");
  const followMutation = useFollow();
  const unfollowMutation = useUnfollow();
  
  const profileData = profileQuery.data;
  const isOwnProfile = profileData?.did === myDid;
  
  // Only fetch feed once we have the user's DID
  const feedQuery = useAuthorFeed(profileData?.did);

  const posts = useMemo(() => {
    return feedQuery.data?.pages?.flatMap(page => page.feed) || [];
  }, [feedQuery.data]);

  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed');
    }
  };

  const handleRefresh = useCallback(() => {
    triggerHaptic();
    profileQuery.refetch();
    feedQuery.refetch();
  }, [profileQuery, feedQuery]);

  const handleFollowToggle = async () => {
    if (!profileData) return;
    triggerHaptic();
    
    if (profileData.viewer?.following) {
      await unfollowMutation.mutateAsync(profileData.viewer.following);
    } else {
      await followMutation.mutateAsync(profileData.did);
    }
    profileQuery.refetch();
  };

  const handlePostPress = (post: FeedViewPost) => {
    const uriParts = post.post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.post.author.did}/${rkey}`);
  };

  // Loading state
  if (profileQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen 
          options={{ 
            headerShown: true,
            headerTitle: "",
            headerStyle: { backgroundColor: "#0A0A0A" },
            headerTintColor: "#FAFAFA",
            headerLeft: () => (
              <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (profileQuery.error || !profileData) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen 
          options={{ 
            headerShown: true,
            headerTitle: "",
            headerStyle: { backgroundColor: "#0A0A0A" },
            headerTintColor: "#FAFAFA",
            headerLeft: () => (
              <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-muted text-center text-lg">User not found</Text>
          <Text className="text-text-muted text-center mt-2">@{handle}</Text>
          <Pressable onPress={() => profileQuery.refetch()} className="mt-4 px-4 py-2 bg-primary rounded-lg">
            <Text className="text-white font-medium">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isFollowing = !!profileData.viewer?.following;
  const isFollowPending = followMutation.isPending || unfollowMutation.isPending;

  const ListHeader = () => (
    <View>
      {/* Banner */}
      {profileData.banner ? (
        <Image 
          source={{ uri: profileData.banner }} 
          className="w-full h-32"
          contentFit="cover"
        />
      ) : (
        <View className="w-full h-32 bg-surface-elevated" />
      )}

      {/* Profile Info */}
      <View className="px-4 pb-4">
        {/* Avatar - overlapping banner */}
        <View className="flex-row items-end justify-between -mt-12">
          {profileData.avatar ? (
            <Image 
              source={{ uri: profileData.avatar }} 
              className="w-24 h-24 rounded-full border-4 border-background"
              contentFit="cover"
            />
          ) : (
            <View className="w-24 h-24 rounded-full border-4 border-background bg-surface-elevated items-center justify-center">
              <Text className="text-text-muted text-3xl">{profileData.handle[0].toUpperCase()}</Text>
            </View>
          )}
          
          {/* Actions */}
          {!isOwnProfile && (
            <View className="flex-row items-center space-x-2 mb-2">
              <Pressable className="p-2 rounded-full border border-border active:opacity-70">
                <MoreHorizontal size={20} color="#6B7280" />
              </Pressable>
              <Pressable 
                onPress={handleFollowToggle}
                disabled={isFollowPending}
                className={`px-4 py-2 rounded-full flex-row items-center ${
                  isFollowing ? 'border border-border' : 'bg-primary'
                } ${isFollowPending ? 'opacity-50' : ''} active:opacity-70`}
              >
                {isFollowPending ? (
                  <ActivityIndicator size="small" color={isFollowing ? "#6B7280" : "#FFFFFF"} />
                ) : (
                  <>
                    {isFollowing ? (
                      <UserMinus size={16} color="#6B7280" />
                    ) : (
                      <UserPlus size={16} color="#FFFFFF" />
                    )}
                    <Text className={`ml-1 font-medium ${isFollowing ? 'text-text-muted' : 'text-white'}`}>
                      {isFollowing ? 'Unfollow' : 'Follow'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </View>

        {/* Name and handle */}
        <Text className="text-text-primary text-xl font-bold mt-3">
          {profileData.displayName || profileData.handle}
        </Text>
        <Text className="text-text-muted">@{profileData.handle}</Text>

        {/* Bio */}
        {profileData.description && (
          <Text className="text-text-secondary mt-3 leading-5">{profileData.description}</Text>
        )}

        {/* Stats */}
        <View className="flex-row mt-4">
          <Pressable className="mr-4">
            <Text className="text-text-primary">
              <Text className="font-bold">{formatNumber(profileData.followersCount)}</Text>
              <Text className="text-text-muted"> followers</Text>
            </Text>
          </Pressable>
          <Pressable>
            <Text className="text-text-primary">
              <Text className="font-bold">{formatNumber(profileData.followsCount)}</Text>
              <Text className="text-text-muted"> following</Text>
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Posts Header */}
      <View className="px-4 py-3 border-t border-b border-border flex-row items-center justify-between">
        <Text className="text-text-primary font-medium">Posts</Text>
        <Pressable onPress={handleRefresh} className="p-1 active:opacity-70">
          <RefreshCw size={18} color="#6B7280" />
        </Pressable>
      </View>
    </View>
  );

  const ListEmpty = () => (
    <View className="py-12 items-center">
      {feedQuery.isLoading ? (
        <ActivityIndicator size="small" color="#10B981" />
      ) : (
        <Text className="text-text-muted">No posts yet</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: "",
          headerStyle: { backgroundColor: "#0A0A0A" },
          headerTintColor: "#FAFAFA",
          headerLeft: () => (
            <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
              <ArrowLeft size={24} color="#FAFAFA" />
            </Pressable>
          ),
        }}
      />
      
      <FlashList
        data={posts}
        keyExtractor={(item) => item.post.uri}
        renderItem={({ item }) => (
          <PostItem item={item} onPress={() => handlePostPress(item)} />
        )}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        estimatedItemSize={100}
        onEndReached={() => {
          if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
            feedQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={() => 
          feedQuery.isFetchingNextPage ? (
            <View className="py-4">
              <ActivityIndicator size="small" color="#10B981" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
