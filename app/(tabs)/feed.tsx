/**
 * Feed Screen - Pure AT Protocol
 * 
 * Displays two feeds:
 * - Cannect: Posts from cannect.space users (our community)
 * - Global: Posts from the Bluesky network (people you follow)
 */

import { View, Text, RefreshControl, ActivityIndicator, Platform, Pressable, Image, Share as RNShare } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Leaf, Heart, MessageCircle, Repeat2, Share } from "lucide-react-native";
import { useState, useMemo, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { useCannectFeed, useGlobalFeed, useLikePost, useUnlikePost, useRepost, useDeleteRepost } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import { OfflineBanner } from "@/components/OfflineBanner";
import { RepostMenu } from "@/components/social/RepostMenu";
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type FeedType = 'cannect' | 'global';
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
  onReply,
  onAuthorPress,
  onShare,
}: { 
  item: FeedViewPost;
  onPress: () => void;
  onLike: () => void;
  onRepost: () => void;
  onReply: () => void;
  onAuthorPress: () => void;
  onShare: () => void;
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
        <Pressable onPress={onAuthorPress}>
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
          {/* Header - Row 1: Name and Time */}
          <View className="flex-row items-center">
            <Text className="font-semibold text-text-primary flex-shrink" numberOfLines={1}>
              {author.displayName || author.handle}
            </Text>
            <Text className="text-text-muted mx-1">·</Text>
            <Text className="text-text-muted flex-shrink-0">
              {formatTime(record.createdAt)}
            </Text>
          </View>
          {/* Header - Row 2: Handle */}
          <Text className="text-text-muted text-sm" numberOfLines={1}>
            @{author.handle}
          </Text>

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
          <View className="flex-row items-center justify-between mt-3 pr-4">
            {/* Reply */}
            <Pressable 
              onPress={onReply}
              className="flex-row items-center py-1"
            >
              <MessageCircle size={18} color="#6B7280" />
              <Text className="text-text-muted text-sm ml-1.5">
                {post.replyCount || ''}
              </Text>
            </Pressable>

            {/* Repost */}
            <Pressable 
              onPress={onRepost}
              className="flex-row items-center py-1"
            >
              <Repeat2 
                size={18} 
                color={post.viewer?.repost ? "#10B981" : "#6B7280"} 
              />
              <Text className={`text-sm ml-1.5 ${post.viewer?.repost ? 'text-primary' : 'text-text-muted'}`}>
                {post.repostCount || ''}
              </Text>
            </Pressable>

            {/* Like */}
            <Pressable 
              onPress={onLike}
              className="flex-row items-center py-1"
            >
              <Heart 
                size={18} 
                color={post.viewer?.like ? "#EF4444" : "#6B7280"}
                fill={post.viewer?.like ? "#EF4444" : "none"}
              />
              <Text className={`text-sm ml-1.5 ${post.viewer?.like ? 'text-red-500' : 'text-text-muted'}`}>
                {post.likeCount || ''}
              </Text>
            </Pressable>

            {/* Share */}
            <Pressable onPress={onShare} className="flex-row items-center py-1">
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
  const [activeFeed, setActiveFeed] = useState<FeedType>('cannect');
  
  // Repost menu state
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<PostView | null>(null);
  
  // Both feeds - only active one will fetch
  const cannectFeedQuery = useCannectFeed();
  const globalQuery = useGlobalFeed();
  
  // Select active query based on tab
  const activeQuery = activeFeed === 'cannect' ? cannectFeedQuery : globalQuery;
  
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();

  const posts = useMemo(() => {
    return activeQuery.data?.pages?.flatMap(page => page.feed) || [];
  }, [activeQuery.data]);

  const handleTabChange = useCallback((feed: FeedType) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setActiveFeed(feed);
  }, []);

  const handleRefresh = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    activeQuery.refetch();
  }, [activeQuery]);

  const handleLike = useCallback(async (post: PostView) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    if (post.viewer?.like) {
      await unlikeMutation.mutateAsync({ likeUri: post.viewer.like, postUri: post.uri });
    } else {
      await likeMutation.mutateAsync({ uri: post.uri, cid: post.cid });
    }
  }, [likeMutation, unlikeMutation]);

  // Open repost menu
  const handleRepostPress = useCallback((post: PostView) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedPost(post);
    setRepostMenuVisible(true);
  }, []);

  // Handle actual repost from menu
  const handleRepost = useCallback(async () => {
    if (!selectedPost) return;
    
    if (selectedPost.viewer?.repost) {
      await unrepostMutation.mutateAsync({ repostUri: selectedPost.viewer.repost, postUri: selectedPost.uri });
    } else {
      await repostMutation.mutateAsync({ uri: selectedPost.uri, cid: selectedPost.cid });
    }
  }, [selectedPost, repostMutation, unrepostMutation]);

  // Handle quote post from menu
  const handleQuotePost = useCallback(() => {
    if (!selectedPost) return;
    
    router.push({
      pathname: '/compose',
      params: {
        quoteUri: selectedPost.uri,
        quoteCid: selectedPost.cid,
      }
    });
  }, [selectedPost, router]);

  // Share post
  const handleShare = useCallback(async (post: PostView) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    const shareUrl = `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
    
    try {
      await RNShare.share({
        message: `Check out this post on Cannect: ${shareUrl}`,
        url: shareUrl,
      });
    } catch (err) {
      console.log('Share cancelled or failed');
    }
  }, []);

  const handlePostPress = useCallback((post: PostView) => {
    // Navigate to thread view using DID and rkey
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.author.did}/${rkey}`);
  }, [router]);

  const handleAuthorPress = useCallback((post: PostView) => {
    router.push(`/user/${post.author.handle}`);
  }, [router]);

  const handleReply = useCallback((post: PostView) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    // Navigate to compose with reply params
    router.push({
      pathname: '/compose',
      params: {
        replyToUri: post.uri,
        replyToCid: post.cid,
        rootUri: post.uri,
        rootCid: post.cid,
      }
    });
  }, [router]);

  if (activeQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-text-primary text-lg font-semibold mb-2">Failed to load feed</Text>
        <Pressable onPress={() => activeQuery.refetch()} className="bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-bold">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header with Logo */}
      <View className="flex-row items-center justify-center px-5 py-3 border-b border-border">
        <Leaf size={24} color="#10B981" />
        <Text className="text-xl font-bold text-text-primary ml-2">Cannect</Text>
      </View>

      {/* Feed Tabs */}
      <View className="flex-row border-b border-border">
        <Pressable 
          onPress={() => handleTabChange('cannect')}
          className={`flex-1 py-3 items-center ${activeFeed === 'cannect' ? 'border-b-2 border-primary' : ''}`}
        >
          <Text className={`font-semibold ${activeFeed === 'cannect' ? 'text-primary' : 'text-text-muted'}`}>
            Cannect
          </Text>
        </Pressable>
        <Pressable 
          onPress={() => handleTabChange('global')}
          className={`flex-1 py-3 items-center ${activeFeed === 'global' ? 'border-b-2 border-primary' : ''}`}
        >
          <Text className={`font-semibold ${activeFeed === 'global' ? 'text-primary' : 'text-text-muted'}`}>
            Global
          </Text>
        </Pressable>
      </View>

      {/* Offline Banner */}
      <OfflineBanner />

      {activeQuery.isLoading ? (
        <FeedSkeleton />
      ) : (
        <View style={{ flex: 1, minHeight: 2 }}>
          <FlashList
            data={posts}
            keyExtractor={(item, index) => `${activeFeed}-${item.post.uri}-${index}`}
            renderItem={({ item }) => (
              <FeedItem
                item={item}
                onPress={() => handlePostPress(item.post)}
                onLike={() => handleLike(item.post)}
                onRepost={() => handleRepostPress(item.post)}
                onReply={() => handleReply(item.post)}
                onAuthorPress={() => handleAuthorPress(item.post)}
                onShare={() => handleShare(item.post)}
              />
            )}
            estimatedItemSize={200}
            refreshControl={
              <RefreshControl 
                refreshing={activeQuery.isRefetching} 
                onRefresh={handleRefresh} 
                tintColor="#10B981"
                colors={["#10B981"]}
              />
            }
            onEndReached={() => {
              if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
                activeQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-20">
                <Text className="text-text-muted text-center">
                  {activeFeed === 'cannect' 
                    ? 'No cannabis content found.\nBe the first to post!' 
                    : 'Your timeline is empty.\nFollow some people to see their posts!'}
                </Text>
              </View>
            }
            ListFooterComponent={
              activeQuery.isFetchingNextPage ? (
                <View className="py-4 items-center">
                  <ActivityIndicator size="small" color="#10B981" />
                </View>
              ) : null
            }
          />
        </View>
      )}

      {/* Repost Menu */}
      <RepostMenu
        isVisible={repostMenuVisible}
        onClose={() => setRepostMenuVisible(false)}
        onRepost={handleRepost}
        onQuotePost={handleQuotePost}
        isReposted={!!selectedPost?.viewer?.repost}
      />
    </SafeAreaView>
  );
}
