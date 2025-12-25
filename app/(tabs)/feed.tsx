/**
 * Feed Screen - Pure AT Protocol
 * 
 * Displays timeline from Bluesky PDS directly.
 */

import { View, Text, RefreshControl, ActivityIndicator, Platform, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Leaf, Heart, MessageCircle, Repeat2, Share } from "lucide-react-native";
import { useMemo, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { useTimeline, useLikePost, useUnlikePost, useRepost, useDeleteRepost } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import { OfflineBanner } from "@/components/OfflineBanner";
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

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

function FeedItem({ 
  item, 
  onPress,
  onLike,
  onRepost,
}: { 
  item: FeedViewPost;
  onPress: () => void;
  onLike: () => void;
  onRepost: () => void;
}) {
  const post = item.post;
  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author;
  const isRepost = !!item.reason && item.reason.$type === 'app.bsky.feed.defs#reasonRepost';
  const repostBy = isRepost ? (item.reason as any).by : null;

  // Get embed images if present
  const embedImages = post.embed?.$type === 'app.bsky.embed.images#view' 
    ? (post.embed as any).images 
    : [];

  return (
    <Pressable 
      onPress={onPress}
      className="px-4 py-3 border-b border-border active:bg-surface-elevated"
    >
      {/* Repost indicator */}
      {isRepost && repostBy && (
        <View className="flex-row items-center mb-2 pl-10">
          <Repeat2 size={14} color="#6B7280" />
          <Text className="text-text-muted text-xs ml-1">
            Reposted by {repostBy.displayName || repostBy.handle}
          </Text>
        </View>
      )}

      <View className="flex-row">
        {/* Avatar */}
        <Pressable onPress={() => {}}>
          {author.avatar ? (
            <Image 
              source={{ uri: author.avatar }} 
              className="w-10 h-10 rounded-full bg-surface-elevated"
            />
          ) : (
            <View className="w-10 h-10 rounded-full bg-surface-elevated items-center justify-center">
              <Text className="text-text-muted text-lg">{author.handle[0].toUpperCase()}</Text>
            </View>
          )}
        </Pressable>

        {/* Content */}
        <View className="flex-1 ml-3">
          {/* Header */}
          <View className="flex-row items-center flex-wrap">
            <Text className="font-semibold text-text-primary" numberOfLines={1}>
              {author.displayName || author.handle}
            </Text>
            <Text className="text-text-muted ml-1" numberOfLines={1}>
              @{author.handle}
            </Text>
            <Text className="text-text-muted mx-1">·</Text>
            <Text className="text-text-muted">
              {formatTime(record.createdAt)}
            </Text>
          </View>

          {/* Post text */}
          <Text className="text-text-primary mt-1 leading-5">
            {record.text}
          </Text>

          {/* Images */}
          {embedImages.length > 0 && (
            <View className="mt-2 rounded-xl overflow-hidden">
              {embedImages.length === 1 ? (
                <Image 
                  source={{ uri: embedImages[0].thumb }} 
                  className="w-full h-48 rounded-xl"
                  resizeMode="cover"
                />
              ) : (
                <View className="flex-row flex-wrap gap-1">
                  {embedImages.slice(0, 4).map((img: any, idx: number) => (
                    <Image 
                      key={idx}
                      source={{ uri: img.thumb }} 
                      className="w-[48%] h-32 rounded-lg"
                      resizeMode="cover"
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Actions */}
          <View className="flex-row items-center mt-3 gap-6">
            {/* Reply */}
            <Pressable className="flex-row items-center">
              <MessageCircle size={18} color="#6B7280" />
              <Text className="text-text-muted text-sm ml-1">
                {post.replyCount || ''}
              </Text>
            </Pressable>

            {/* Repost */}
            <Pressable 
              onPress={onRepost}
              className="flex-row items-center"
            >
              <Repeat2 
                size={18} 
                color={post.viewer?.repost ? "#10B981" : "#6B7280"} 
              />
              <Text className={`text-sm ml-1 ${post.viewer?.repost ? 'text-primary' : 'text-text-muted'}`}>
                {post.repostCount || ''}
              </Text>
            </Pressable>

            {/* Like */}
            <Pressable 
              onPress={onLike}
              className="flex-row items-center"
            >
              <Heart 
                size={18} 
                color={post.viewer?.like ? "#EF4444" : "#6B7280"}
                fill={post.viewer?.like ? "#EF4444" : "none"}
              />
              <Text className={`text-sm ml-1 ${post.viewer?.like ? 'text-red-500' : 'text-text-muted'}`}>
                {post.likeCount || ''}
              </Text>
            </Pressable>

            {/* Share */}
            <Pressable className="flex-row items-center">
              <Share size={18} color="#6B7280" />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function FeedSkeleton() {
  return (
    <View className="px-4 py-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} className="flex-row mb-4 pb-4 border-b border-border">
          <View className="w-10 h-10 rounded-full bg-surface-elevated" />
          <View className="flex-1 ml-3">
            <View className="h-4 w-32 bg-surface-elevated rounded mb-2" />
            <View className="h-4 w-full bg-surface-elevated rounded mb-1" />
            <View className="h-4 w-3/4 bg-surface-elevated rounded" />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const { did } = useAuthStore();
  
  const timelineQuery = useTimeline();
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();

  const posts = useMemo(() => {
    return timelineQuery.data?.pages?.flatMap(page => page.feed) || [];
  }, [timelineQuery.data]);

  const handleRefresh = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    timelineQuery.refetch();
  }, [timelineQuery]);

  const handleLike = useCallback(async (post: PostView) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    if (post.viewer?.like) {
      await unlikeMutation.mutateAsync(post.viewer.like);
    } else {
      await likeMutation.mutateAsync({ uri: post.uri, cid: post.cid });
    }
  }, [likeMutation, unlikeMutation]);

  const handleRepost = useCallback(async (post: PostView) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    if (post.viewer?.repost) {
      await unrepostMutation.mutateAsync(post.viewer.repost);
    } else {
      await repostMutation.mutateAsync({ uri: post.uri, cid: post.cid });
    }
  }, [repostMutation, unrepostMutation]);

  const handlePostPress = useCallback((post: PostView) => {
    // Navigate to thread view using DID and rkey
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.author.did}/${rkey}`);
  }, [router]);

  if (timelineQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-text-primary text-lg font-semibold mb-2">Failed to load feed</Text>
        <Pressable onPress={() => timelineQuery.refetch()} className="bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-bold">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4 border-b border-border">
        <Leaf size={28} color="#10B981" />
        <Text className="text-2xl font-bold text-text-primary ml-3">Cannect</Text>
      </View>

      {/* Offline Banner */}
      <OfflineBanner />

      {timelineQuery.isLoading ? (
        <FeedSkeleton />
      ) : (
        <View style={{ flex: 1, minHeight: 2 }}>
          <FlashList
            data={posts}
            keyExtractor={(item, index) => `${item.post.uri}-${index}`}
            renderItem={({ item }) => (
              <FeedItem
                item={item}
                onPress={() => handlePostPress(item.post)}
                onLike={() => handleLike(item.post)}
                onRepost={() => handleRepost(item.post)}
              />
            )}
            estimatedItemSize={200}
            refreshControl={
              <RefreshControl 
                refreshing={timelineQuery.isRefetching} 
                onRefresh={handleRefresh} 
                tintColor="#10B981"
                colors={["#10B981"]}
              />
            }
            onEndReached={() => {
              if (timelineQuery.hasNextPage && !timelineQuery.isFetchingNextPage) {
                timelineQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-20">
                <Text className="text-text-muted text-center">
                  Your timeline is empty.{'\n'}Follow some people to see their posts!
                </Text>
              </View>
            }
            ListFooterComponent={
              timelineQuery.isFetchingNextPage ? (
                <View className="py-4 items-center">
                  <ActivityIndicator size="small" color="#10B981" />
                </View>
              ) : null
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}
