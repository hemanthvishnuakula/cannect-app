/**
 * Feed Screen - v3.0 Simplified Architecture
 *
 * Displays three feeds:
 * - Global: Cannabis content (server-managed via feed.cannect.space)
 * - Local: Posts from cannect.space users (DIRECT from PDS - no VPS!)
 * - Following: Posts from users you follow (direct Bluesky API)
 *
 * v3.0: Local feed now direct from PDS - simpler, faster, real-time
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
import { useTimeline, useLocalFeed } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';
import { OfflineBanner } from '@/components/OfflineBanner';
import { MediaViewer } from '@/components/ui/MediaViewer';
import { PostCard, FeedSkeleton } from '@/components/Post';
import type { AppBskyFeedDefs } from '@atproto/api';

type FeedType = 'global' | 'local' | 'following';
type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

const FEED_SERVICE_URL = 'https://feed.cannect.space';

export default function FeedScreen() {
  const router = useRouter();
  const { did: _did, isAuthenticated } = useAuthStore();
  const { height } = useWindowDimensions();
  const [activeFeed, setActiveFeed] = useState<FeedType>('global');
  const listRef = useRef<FlashList<FeedViewPost>>(null);

  // === SCROLL POSITION PRESERVATION ===
  // Store scroll offset per feed to restore when coming back from post detail
  const scrollOffsets = useRef<Record<FeedType, number>>({ global: 0, local: 0, following: 0 });

  // Prevent infinite scroll spam - track if we're currently loading more
  const isLoadingMoreRef = useRef(false);

  // Restore scroll position when screen regains focus
  useFocusEffect(
    useCallback(() => {
      // Small delay to ensure FlashList is ready
      const timer = setTimeout(() => {
        const savedOffset = scrollOffsets.current[activeFeed];
        if (savedOffset > 0 && listRef.current) {
          listRef.current.scrollToOffset({ offset: savedOffset, animated: false });
        }
      }, 50);
      return () => clearTimeout(timer);
    }, [activeFeed])
  );

  // === GLOBAL FEED (VPS - server-managed for curated cannabis content) ===
  const [globalPosts, setGlobalPosts] = useState<FeedViewPost[]>([]);
  const [globalSession, setGlobalSession] = useState<string | null>(null);
  const [globalHasMore, setGlobalHasMore] = useState(true);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // === LOCAL FEED (Direct from Cannect PDS - no VPS!) ===
  const localQuery = useLocalFeed();

  // === FOLLOWING FEED (Direct Bluesky API) ===
  const followingQuery = useTimeline();

  // === GLOBAL FEED API CALLS ===

  // Convert server post format to FeedViewPost
  const convertPost = (p: any): FeedViewPost => ({
    post: {
      uri: p.uri,
      cid: p.cid,
      author: p.author,
      record: p.record,
      embed: p.embed,
      likeCount: p.likeCount || 0,
      repostCount: p.repostCount || 0,
      replyCount: p.replyCount || 0,
      indexedAt: p.indexedAt,
      viewer: {},
      labels: [],
    },
  });

  // Load initial global feed
  const loadGlobalFeed = useCallback(async () => {
    if (globalLoading) return;
    setGlobalLoading(true);
    setGlobalError(null);

    try {
      const res = await fetch(`${FEED_SERVICE_URL}/feed/global`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setGlobalPosts(data.posts.map(convertPost));
      setGlobalSession(data.session);
      setGlobalHasMore(data.hasMore);
      console.log('[Feed] Global feed loaded:', data.posts.length, 'posts');
    } catch (err: any) {
      setGlobalError(err.message);
      console.error('[Feed] Global feed error:', err.message);
    } finally {
      setGlobalLoading(false);
    }
  }, [globalLoading]);

  // Load more global posts
  const loadMoreGlobal = useCallback(async () => {
    // Use ref to prevent race condition from FlashList's rapid onEndReached calls
    if (isLoadingMoreRef.current || globalLoading || !globalHasMore || !globalSession) return;
    isLoadingMoreRef.current = true;
    setGlobalLoading(true);

    try {
      const res = await fetch(`${FEED_SERVICE_URL}/feed/global/more`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session': globalSession,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setGlobalPosts((prev) => [...prev, ...data.posts.map(convertPost)]);
      setGlobalHasMore(data.hasMore);
      console.log('[Feed] Global feed more:', data.posts.length, 'posts loaded');
    } catch (err: any) {
      console.error('[Feed] Load more error:', err);
    } finally {
      setGlobalLoading(false);
      isLoadingMoreRef.current = false;
    }
  }, [globalLoading, globalHasMore, globalSession]);

  // Refresh global feed
  const refreshGlobal = useCallback(async () => {
    setGlobalLoading(true);

    try {
      const res = await fetch(`${FEED_SERVICE_URL}/feed/global/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(globalSession && { 'X-Session': globalSession }),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setGlobalPosts(data.posts.map(convertPost)); // Replace, not append
      setGlobalSession(data.session);
      setGlobalHasMore(data.hasMore);
    } catch (err: any) {
      console.error('[Feed] Refresh error:', err);
    } finally {
      setGlobalLoading(false);
    }
  }, [globalSession]);

  // Load initial global feed on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadGlobalFeed();
      // localQuery and followingQuery auto-fetch via React Query
    }
  }, [isAuthenticated]);

  // === DERIVED STATE ===

  // Flatten local feed pages into array
  const localPosts = useMemo(
    () => localQuery.data?.pages?.flatMap((page) => page.feed) || [],
    [localQuery.data]
  );

  const posts = useMemo(() => {
    if (activeFeed === 'global') return globalPosts;
    if (activeFeed === 'local') return localPosts;
    // Following uses React Query
    return followingQuery.data?.pages?.flatMap((page) => page.feed) || [];
  }, [activeFeed, globalPosts, localPosts, followingQuery.data]);

  const isLoading = useMemo(() => {
    if (activeFeed === 'global') return globalLoading && globalPosts.length === 0;
    if (activeFeed === 'local') return localQuery.isLoading && localPosts.length === 0;
    return followingQuery.isLoading && posts.length === 0;
  }, [
    activeFeed,
    globalLoading,
    globalPosts.length,
    localQuery.isLoading,
    localPosts.length,
    followingQuery.isLoading,
    posts.length,
  ]);

  const isRefreshing = useMemo(() => {
    if (activeFeed === 'global') return globalLoading && globalPosts.length > 0;
    if (activeFeed === 'local') return localQuery.isRefetching;
    return followingQuery.isRefetching;
  }, [
    activeFeed,
    globalLoading,
    globalPosts.length,
    localQuery.isRefetching,
    followingQuery.isRefetching,
  ]);

  const hasMore = useMemo(() => {
    if (activeFeed === 'global') return globalHasMore;
    if (activeFeed === 'local') return localQuery.hasNextPage;
    return followingQuery.hasNextPage;
  }, [activeFeed, globalHasMore, localQuery.hasNextPage, followingQuery.hasNextPage]);

  const feedError = useMemo(() => {
    if (activeFeed === 'global') return globalError;
    if (activeFeed === 'local') return localQuery.isError ? 'Failed to load' : null;
    return followingQuery.isError ? 'Failed to load' : null;
  }, [activeFeed, globalError, localQuery.isError, followingQuery.isError]);

  // === HANDLERS ===

  const handleTabChange = useCallback((feed: FeedType) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setActiveFeed(feed);
    // Restore scroll position for the new tab (or start at top if never scrolled)
    setTimeout(() => {
      const savedOffset = scrollOffsets.current[feed];
      listRef.current?.scrollToOffset({ offset: savedOffset, animated: false });
    }, 50);
  }, []);

  const handleRefresh = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (activeFeed === 'global') refreshGlobal();
    else if (activeFeed === 'local') localQuery.refetch();
    else followingQuery.refetch();
  }, [activeFeed, refreshGlobal, localQuery, followingQuery]);

  const handleLoadMore = useCallback(() => {
    if (activeFeed === 'global') loadMoreGlobal();
    else if (activeFeed === 'local' && localQuery.hasNextPage && !localQuery.isFetchingNextPage) {
      localQuery.fetchNextPage();
    } else if (followingQuery.hasNextPage && !followingQuery.isFetchingNextPage) {
      followingQuery.fetchNextPage();
    }
  }, [activeFeed, loadMoreGlobal, localQuery, followingQuery]);

  // Media viewer state
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [mediaViewerImages, setMediaViewerImages] = useState<string[]>([]);
  const [mediaViewerIndex, setMediaViewerIndex] = useState(0);

  // Web refresh indicator - auto-hides after 3 seconds
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  const refreshHintTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-hide refresh hint after 3 seconds
  useEffect(() => {
    if (showRefreshHint && Platform.OS === 'web') {
      // Clear any existing timeout
      if (refreshHintTimeoutRef.current) {
        clearTimeout(refreshHintTimeoutRef.current);
      }
      // Set new timeout to hide
      refreshHintTimeoutRef.current = setTimeout(() => {
        setShowRefreshHint(false);
      }, 3000);
    }
    return () => {
      if (refreshHintTimeoutRef.current) {
        clearTimeout(refreshHintTimeoutRef.current);
      }
    };
  }, [showRefreshHint]);

  // Open image viewer
  const handleImagePress = useCallback((images: string[], index: number) => {
    setMediaViewerImages(images);
    setMediaViewerIndex(index);
    setMediaViewerVisible(true);
  }, []);

  const handlePostPress = useCallback(
    (post: PostView) => {
      // Navigate to thread view using DID and rkey
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

      {/* Feed Tabs */}
      <View className="flex-row border-b border-border">
        <Pressable
          onPress={() => handleTabChange('global')}
          className={`flex-1 py-3 items-center ${activeFeed === 'global' ? 'border-b-2 border-primary' : ''}`}
        >
          <Text
            className={`font-semibold ${activeFeed === 'global' ? 'text-primary' : 'text-text-muted'}`}
          >
            Global
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleTabChange('local')}
          className={`flex-1 py-3 items-center ${activeFeed === 'local' ? 'border-b-2 border-primary' : ''}`}
        >
          <Text
            className={`font-semibold ${activeFeed === 'local' ? 'text-primary' : 'text-text-muted'}`}
          >
            Local
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
        /* Web: Use ScrollView for smooth rendering without FlashList measurement issues */
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
            
            // Infinite scroll for web
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const isNearEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - 500;
            if (isNearEnd && !isLoadingMoreRef.current) {
              handleLoadMore();
            }
          }}
          scrollEventThrottle={16}
        >
          {/* Refresh hint for web */}
          {showRefreshHint && (
            <Pressable onPress={handleRefresh} className="py-3 items-center border-b border-border">
              <Text className="text-text-muted text-sm">Pull to refresh</Text>
            </Pressable>
          )}
          
          {/* Posts */}
          {posts.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <Text className="text-text-muted text-center">
                {activeFeed === 'global'
                  ? 'No cannabis content found.\nCheck back later!'
                  : activeFeed === 'local'
                    ? 'No posts from Cannect users yet.\nBe the first to post!'
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
          
          {/* Footer */}
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
        /* Native: Use FlashList for performance */
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
            estimatedItemSize={280}
            overrideItemLayout={(layout) => {
              layout.size = 280;
            }}
            drawDistance={300}
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              scrollOffsets.current[activeFeed] = y;
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
                  {activeFeed === 'global'
                    ? 'No cannabis content found.\nCheck back later!'
                    : activeFeed === 'local'
                      ? 'No posts from Cannect users yet.\nBe the first to post!'
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
