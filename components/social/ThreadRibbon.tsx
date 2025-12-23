/**
 * ThreadRibbon - Bluesky Gold Standard Thread View
 * 
 * Uses UnifiedThreadItem component for all post types.
 * Thread lines connect posts vertically through avatar centers.
 * 
 * Gold Standard Features (matching Bluesky):
 * - deferParents: Initially renders focused post first
 * - prepareForParamsUpdate: Resets state when sort/view changes
 * - onContentSizeChange: Web scroll handling for anchor positioning
 * - maintainVisibleContentPosition: Native anchor positioning
 * - onEndReached: Pagination for loading more replies
 */

import React, { memo, useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Platform, LayoutChangeEvent } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import type { ThreadView, ThreadListItem, ThreadItemUI } from '@/lib/types/thread';
import type { PostWithAuthor } from '@/lib/types/database';
import { flattenThreadToList, THREAD_DESIGN } from '@/lib/types/thread';
import type { ThreadSort, ThreadView as ThreadViewOption } from '@/lib/hooks/use-thread-preferences';
import { useAuthStore } from '@/lib/stores';
import { UnifiedThreadItem } from './UnifiedThreadItem';

interface ThreadRibbonProps {
  thread: ThreadView;
  isLoading?: boolean;
  onLike: (post: PostWithAuthor) => void;
  onReply: (post: PostWithAuthor, username?: string) => void;
  onRepost: (post: PostWithAuthor) => void;
  onMore?: (post: PostWithAuthor) => void;
  onLoadMore?: () => void;
  onEndReached?: () => void;
  isLoadingMore?: boolean;
  ListHeaderComponent?: React.ReactElement;
  ListFooterComponent?: React.ReactElement;
  /** Current sort preference - used to detect param changes */
  sort?: ThreadSort;
  /** Current view preference - used to detect param changes */
  view?: ThreadViewOption;
}

export const ThreadRibbon = memo(function ThreadRibbon({
  thread,
  isLoading,
  onLike,
  onReply,
  onRepost,
  onMore,
  onLoadMore,
  onEndReached,
  isLoadingMore,
  ListHeaderComponent,
  ListFooterComponent,
  sort,
  view,
}: ThreadRibbonProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  
  // Track which post we're deferring parents for
  const currentPostIdRef = useRef<string | null>(null);
  const focusedPostId = thread.focusedPost.id;
  
  // Track previous sort/view for prepareForParamsUpdate
  const prevSortRef = useRef(sort);
  const prevViewRef = useRef(view);
  
  // Bluesky-style: defer rendering parents initially
  const [deferParents, setDeferParents] = useState(true);
  
  // Bluesky-style: flag for scroll handling
  const shouldHandleScroll = useRef(true);
  
  // Refs for web scroll handling
  const listRef = useRef<FlashList<ThreadListItem>>(null);
  const anchorRef = useRef<View>(null);
  const headerRef = useRef<View>(null);
  
  /**
   * Bluesky's prepareForParamsUpdate pattern
   * Called when sort/view changes to reset scroll state
   */
  const prepareForParamsUpdate = useCallback(() => {
    setDeferParents(true);
    shouldHandleScroll.current = true;
    
    // Reset scroll to top (anchor post)
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  
  // Detect sort/view changes and call prepareForParamsUpdate
  useEffect(() => {
    if (prevSortRef.current !== sort || prevViewRef.current !== view) {
      prevSortRef.current = sort;
      prevViewRef.current = view;
      prepareForParamsUpdate();
    }
  }, [sort, view, prepareForParamsUpdate]);
  
  // Reset deferParents when focused post changes (navigating to new thread)
  useEffect(() => {
    if (currentPostIdRef.current !== focusedPostId) {
      currentPostIdRef.current = focusedPostId;
      setDeferParents(true);
      shouldHandleScroll.current = true;
    }
  }, [focusedPostId]);

  // Flatten thread into renderable list
  const allItems = useMemo(() => flattenThreadToList(thread), [thread]);
  
  // Filter items based on deferParents state
  const items = useMemo(() => {
    if (deferParents) {
      // Hide ancestors initially - start with focused post
      return allItems.filter(item => item.type !== 'ancestor');
    }
    return allItems;
  }, [allItems, deferParents]);
  
  // Check if we have ancestors to show
  const hasAncestors = allItems.some(item => item.type === 'ancestor');

  // After initial render stabilizes, show the parents
  useEffect(() => {
    if (deferParents && hasAncestors) {
      // Small delay to let initial render complete, then show ancestors
      const timer = setTimeout(() => {
        setDeferParents(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [deferParents, hasAncestors]);
  
  /**
   * Bluesky's onContentSizeChange pattern for web
   * Handles scroll positioning when content changes (parents prepended)
   */
  const onContentSizeChange = useCallback((width: number, height: number) => {
    // Only needed on web where maintainVisibleContentPosition isn't supported
    if (Platform.OS !== 'web') return;
    if (!shouldHandleScroll.current) return;
    
    // When deferParents becomes false, ancestors are added above
    // We need to scroll to keep the focused post in view
    if (!deferParents && hasAncestors) {
      // Find focused post index and scroll to it
      const focusedIndex = items.findIndex(item => item.type === 'focused');
      if (focusedIndex > 0) {
        listRef.current?.scrollToIndex({
          index: focusedIndex,
          animated: false,
          viewPosition: 0,
        });
      }
      shouldHandleScroll.current = false;
    }
  }, [deferParents, hasAncestors, items]);

  // Navigation handlers
  const navigateToPost = useCallback((postId: string) => {
    router.push({ pathname: '/post/[id]', params: { id: postId } });
  }, [router]);

  const navigateToProfile = useCallback((userId: string) => {
    router.push({ pathname: '/user/[id]', params: { id: userId } });
  }, [router]);

  /**
   * Render individual items using UnifiedThreadItem
   * UI state is pre-computed in flattenThreadToList
   */
  const renderItem: ListRenderItem<ThreadListItem> = useCallback(({ item, index }) => {
    switch (item.type) {
      case 'ancestor':
        return (
          <UnifiedThreadItem
            post={item.post}
            ui={item.ui}
            viewMode={view === 'tree' ? 'tree' : 'linear'}
            onPress={() => navigateToPost(item.post.id)}
            onLike={() => onLike(item.post)}
            onReply={() => onReply(item.post, item.post.author?.username ?? undefined)}
            onRepost={() => onRepost(item.post)}
            onProfilePress={() => navigateToProfile(item.post.author?.id ?? '')}
            onMore={onMore ? () => onMore(item.post) : undefined}
          />
        );

      case 'focused':
        return (
          <UnifiedThreadItem
            post={item.post}
            ui={item.ui}
            viewMode={view === 'tree' ? 'tree' : 'linear'}
            onLike={() => onLike(item.post)}
            onReply={() => onReply(item.post, item.post.author?.username ?? undefined)}
            onRepost={() => onRepost(item.post)}
            onShare={() => {}}
            onProfilePress={() => navigateToProfile(item.post.author?.id ?? '')}
            onMore={onMore ? () => onMore(item.post) : undefined}
          />
        );

      case 'reply-divider':
        return (
          <View style={styles.replyDivider}>
            <Text style={styles.replyDividerText}>
              Replies
            </Text>
          </View>
        );

      case 'reply':
        return (
          <UnifiedThreadItem
            post={item.reply.post}
            ui={item.ui}
            replyingTo={item.reply.replyingTo}
            viewMode={view === 'tree' ? 'tree' : 'linear'}
            onPress={() => navigateToPost(item.reply.post.id)}
            onLike={() => onLike(item.reply.post)}
            onReply={() => onReply(item.reply.post, item.reply.post.author?.username ?? undefined)}
            onRepost={() => onRepost(item.reply.post)}
            onProfilePress={() => navigateToProfile(item.reply.post.author?.id ?? '')}
            onMore={onMore ? () => onMore(item.reply.post) : undefined}
          />
        );

      case 'load-more':
        return (
          <Pressable
            onPress={onLoadMore}
            style={styles.loadMoreButton}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <ActivityIndicator size="small" color="#10B981" />
            ) : (
              <Text style={styles.loadMoreText}>
                Load {item.count} more {item.count === 1 ? 'reply' : 'replies'}
              </Text>
            )}
          </Pressable>
        );

      default:
        return null;
    }
  }, [view, navigateToPost, navigateToProfile, onLike, onReply, onRepost, onMore, onLoadMore, isLoadingMore]);

  // Key extractor
  const keyExtractor = useCallback((item: ThreadListItem, index: number) => {
    switch (item.type) {
      case 'ancestor':
      case 'focused':
        return `${item.type}-${item.post.id}`;
      case 'reply':
        return `reply-${item.reply.post.id}`;
      case 'reply-divider':
        return 'reply-divider';
      case 'load-more':
        return 'load-more';
      default:
        return `item-${index}`;
    }
  }, []);

  // Get item type for FlashList performance
  const getItemType = useCallback((item: ThreadListItem) => item.type, []);
  
  /**
   * Bluesky's onEndReached pattern for pagination
   */
  const handleEndReached = useCallback(() => {
    if (onEndReached && !isLoadingMore && thread.hasMoreReplies) {
      onEndReached();
    }
  }, [onEndReached, isLoadingMore, thread.hasMoreReplies]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <View style={styles.listContainer}>
      <FlashList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={120}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        // Keep focused post in place when ancestors are prepended (native only)
        maintainVisibleContentPosition={
          hasAncestors ? { minIndexForVisible: 0 } : undefined
        }
        // Web scroll handling
        onContentSizeChange={Platform.OS === 'web' ? onContentSizeChange : undefined}
        // Pagination
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  listContainer: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 100, // Space for reply bar
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  replyDivider: {
    paddingHorizontal: THREAD_DESIGN.OUTER_SPACE,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
    backgroundColor: '#000',
  },
  replyDividerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FAFAFA',
  },
  loadMoreButton: {
    paddingVertical: 16,
    paddingHorizontal: THREAD_DESIGN.OUTER_SPACE,
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#10B981',
  },
});

export default ThreadRibbon;
