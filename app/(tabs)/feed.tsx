/**
 * Feed Screen - v5.0 Simplified
 *
 * Two feeds:
 * - Feed: Cannect feed (cannect.space users + cannabis keywords) from feed.cannect.space
 * - Following: Posts from users you follow (Bluesky Timeline API)
 *
 * Clean, simple, debuggable.
 */

import {
  View,
  Text,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Pressable,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Leaf } from 'lucide-react-native';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { useTimeline, useCannectFeed } from '@/lib/hooks';
import { OfflineBanner } from '@/components/OfflineBanner';
import { MediaViewer } from '@/components/ui/MediaViewer';
import { PostCard, FeedSkeleton } from '@/components/Post';
import type { AppBskyFeedDefs } from '@atproto/api';

type FeedType = 'feed' | 'following';
type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

export default function FeedScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [activeFeed, setActiveFeed] = useState<FeedType>('feed');
  const listRef = useRef<FlashList<FeedViewPost>>(null);

  // Scroll position preservation
  const scrollOffsets = useRef<Record<FeedType, number>>({ feed: 0, following: 0 });

  // Restore scroll position when screen regains focus
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        const savedOffset = scrollOffsets.current[activeFeed];
        if (savedOffset > 0 && listRef.current) {
          listRef.current.scrollToOffset({ offset: savedOffset, animated: false });
        }
      }, 50);
      return () => clearTimeout(timer);
    }, [activeFeed])
  );

  // === FEEDS ===
  const cannectQuery = useCannectFeed();
  const followingQuery = useTimeline();

  // === DERIVED STATE ===
  const cannectPosts = useMemo(
    () => cannectQuery.data?.pages?.flatMap((page) => page.feed) || [],
    [cannectQuery.data]
  );

  const followingPosts = useMemo(
    () => followingQuery.data?.pages?.flatMap((page) => page.feed) || [],
    [followingQuery.data]
  );

  const posts = activeFeed === 'feed' ? cannectPosts : followingPosts;
  const currentQuery = activeFeed === 'feed' ? cannectQuery : followingQuery;

  const isLoading = currentQuery.isLoading && posts.length === 0;
  const isRefreshing = currentQuery.isRefetching;
  const hasMore = currentQuery.hasNextPage;
  const feedError = currentQuery.isError ? 'Failed to load feed' : null;

  // === HANDLERS ===
  const handleTabChange = useCallback((feed: FeedType) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setActiveFeed(feed);
    setTimeout(() => {
      const savedOffset = scrollOffsets.current[feed];
      listRef.current?.scrollToOffset({ offset: savedOffset, animated: false });
    }, 50);
  }, []);

  const handleRefresh = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    currentQuery.refetch();
  }, [currentQuery]);

  const handleLoadMore = useCallback(() => {
    if (currentQuery.hasNextPage && !currentQuery.isFetchingNextPage) {
      currentQuery.fetchNextPage();
    }
  }, [currentQuery]);

  // Media viewer state
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [mediaViewerImages, setMediaViewerImages] = useState<string[]>([]);
  const [mediaViewerIndex, setMediaViewerIndex] = useState(0);

  // Web refresh hint
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  const refreshHintTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (showRefreshHint && Platform.OS === 'web') {
      if (refreshHintTimeoutRef.current) clearTimeout(refreshHintTimeoutRef.current);
      refreshHintTimeoutRef.current = setTimeout(() => setShowRefreshHint(false), 3000);
    }
    return () => {
      if (refreshHintTimeoutRef.current) clearTimeout(refreshHintTimeoutRef.current);
    };
  }, [showRefreshHint]);

  const handleImagePress = useCallback((images: string[], index: number) => {
    setMediaViewerImages(images);
    setMediaViewerIndex(index);
    setMediaViewerVisible(true);
  }, []);

  const handlePostPress = useCallback(
    (post: PostView) => {
      const uriParts = post.uri.split('/');
      const rkey = uriParts[uriParts.length - 1];
      router.push(`/post/${post.author.did}/${rkey}`);
    },
    [router]
  );

  // Error state
  if (feedError) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-text-primary text-lg font-semibold mb-2">Failed to load feed</Text>
        <Text className="text-text-muted mb-4">{feedError}</Text>
        <Pressable onPress={handleRefresh} className="bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-bold">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header with Logo */}
      <View className="flex-row items-center justify-center px-5 py-3 border-b border-border">
        <Leaf size={24} color="#10B981" />
        <Text className="text-xl font-bold text-text-primary ml-2">Cannect</Text>
      </View>

      {/* Feed Tabs - Just 2 */}
      <View className="flex-row border-b border-border">
        <Pressable
          onPress={() => handleTabChange('feed')}
          className={`flex-1 py-3 items-center ${activeFeed === 'feed' ? 'border-b-2 border-primary' : ''}`}
        >
          <Text
            className={`font-semibold ${activeFeed === 'feed' ? 'text-primary' : 'text-text-muted'}`}
          >
            Feed
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleTabChange('following')}
          className={`flex-1 py-3 items-center ${activeFeed === 'following' ? 'border-b-2 border-primary' : ''}`}
        >
          <Text
            className={`font-semibold ${activeFeed === 'following' ? 'text-primary' : 'text-text-muted'}`}
          >
            Following
          </Text>
        </Pressable>
      </View>

      {/* Offline Banner */}
      <OfflineBanner />

      {/* Loading skeleton */}
      {isLoading ? (
        <FeedSkeleton />
      ) : Platform.OS === 'web' ? (
        /* Web: Use ScrollView */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#10B981"
              colors={['#10B981']}
            />
          }
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            scrollOffsets.current[activeFeed] = y;
            setShowRefreshHint(y <= 0);

            // Infinite scroll
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const isNearEnd =
              layoutMeasurement.height + contentOffset.y >= contentSize.height - 500;
            if (isNearEnd) handleLoadMore();
          }}
          scrollEventThrottle={16}
        >
          {showRefreshHint && (
            <Pressable onPress={handleRefresh} className="py-3 items-center border-b border-border">
              <Text className="text-text-muted text-sm">Pull to refresh</Text>
            </Pressable>
          )}

          {posts.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <Text className="text-text-muted text-center">
                {activeFeed === 'feed'
                  ? 'No posts yet.\nThe feed is building up!'
                  : 'Your timeline is empty.\nFollow some people to see their posts!'}
              </Text>
            </View>
          ) : (
            posts.map((item, index) => (
              <PostCard
                key={`${activeFeed}-${item.post.uri}-${index}`}
                item={item}
                onPress={() => handlePostPress(item.post)}
                onImagePress={handleImagePress}
              />
            ))
          )}

          {hasMore && posts.length > 0 ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#10B981" />
            </View>
          ) : posts.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-text-muted text-sm">You've reached the end!</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        /* Native: Use FlashList */
        <View style={{ flex: 1, height: height - 150 }} className="flex-1">
          <FlashList
            ref={listRef}
            data={posts}
            keyExtractor={(item, index) => `${activeFeed}-${item.post.uri}-${index}`}
            renderItem={({ item }) => (
              <PostCard
                item={item}
                onPress={() => handlePostPress(item.post)}
                onImagePress={handleImagePress}
              />
            )}
            estimatedItemSize={350}
            overrideItemLayout={(layout) => {
              layout.size = 280;
            }}
            drawDistance={300}
            onScroll={(e) => {
              scrollOffsets.current[activeFeed] = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor="#10B981"
                colors={['#10B981']}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-20">
                <Text className="text-text-muted text-center">
                  {activeFeed === 'feed'
                    ? 'No posts yet.\nThe feed is building up!'
                    : 'Your timeline is empty.\nFollow some people to see their posts!'}
                </Text>
              </View>
            }
            ListFooterComponent={
              hasMore && posts.length > 0 ? (
                <View className="py-4 items-center">
                  <ActivityIndicator size="small" color="#10B981" />
                </View>
              ) : posts.length > 0 ? (
                <View className="py-4 items-center">
                  <Text className="text-text-muted text-sm">You've reached the end!</Text>
                </View>
              ) : null
            }
          />
        </View>
      )}

      {/* Media Viewer */}
      <MediaViewer
        isVisible={mediaViewerVisible}
        images={mediaViewerImages}
        initialIndex={mediaViewerIndex}
        onClose={() => setMediaViewerVisible(false)}
      />
    </SafeAreaView>
  );
}
