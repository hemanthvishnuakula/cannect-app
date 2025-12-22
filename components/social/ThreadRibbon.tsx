/**
 * ThreadRibbon - Bluesky-style Thread View
 * 
 * Uses unified ThreadPost component for all post types.
 * Thread lines connect posts vertically through avatar centers.
 * Auto-scrolls to focused post when ancestors are present.
 */

import React, { memo, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import type { ThreadView, ThreadListItem } from '@/lib/types/thread';
import type { PostWithAuthor } from '@/lib/types/database';
import { flattenThreadToList, THREAD_DESIGN } from '@/lib/types/thread';
import { useAuthStore } from '@/lib/stores';
import { ThreadPost } from './ThreadPost';

interface ThreadRibbonProps {
  thread: ThreadView;
  isLoading?: boolean;
  onLike: (post: PostWithAuthor) => void;
  onReply: (post: PostWithAuthor, username?: string) => void;
  onRepost: (post: PostWithAuthor) => void;
  onMore?: (post: PostWithAuthor) => void;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  ListHeaderComponent?: React.ReactElement;
  ListFooterComponent?: React.ReactElement;
}

export const ThreadRibbon = memo(function ThreadRibbon({
  thread,
  isLoading,
  onLike,
  onReply,
  onRepost,
  onMore,
  onLoadMore,
  isLoadingMore,
  ListHeaderComponent,
  ListFooterComponent,
}: ThreadRibbonProps) {
  const router = useRouter();
  const { user } = useAuthStore();

  // Flatten thread into renderable list
  const items = useMemo(() => flattenThreadToList(thread), [thread]);

  // Ref for FlashList to enable scrolling
  const listRef = useRef<FlashList<ThreadListItem>>(null);
  
  // Track if we've scrolled for this thread (to avoid re-scrolling on re-renders)
  const hasScrolledRef = useRef<string | null>(null);
  const focusedPostId = thread.focusedPost.id;

  // Find the index of the focused post for auto-scroll
  const focusedIndex = useMemo(() => 
    items.findIndex(item => item.type === 'focused'), 
    [items]
  );

  // Auto-scroll to focused post when ancestors are present
  useEffect(() => {
    // Only scroll if we have ancestors and haven't scrolled for this post yet
    if (focusedIndex > 0 && listRef.current && hasScrolledRef.current !== focusedPostId) {
      hasScrolledRef.current = focusedPostId;
      
      // Use multiple attempts to ensure scroll happens after render
      const attemptScroll = (attempt: number) => {
        if (attempt > 3) return; // Give up after 3 attempts
        
        setTimeout(() => {
          try {
            listRef.current?.scrollToIndex({
              index: focusedIndex,
              animated: false,
              viewPosition: 0, // Put focused post at top
            });
          } catch (e) {
            // If scroll fails, try again
            attemptScroll(attempt + 1);
          }
        }, attempt * 150); // 150ms, 300ms, 450ms
      };
      
      attemptScroll(1);
    }
  }, [focusedIndex, focusedPostId]);

  // Navigation handlers
  const navigateToPost = useCallback((postId: string) => {
    router.push({ pathname: '/post/[id]', params: { id: postId } });
  }, [router]);

  const navigateToProfile = useCallback((userId: string) => {
    router.push({ pathname: '/user/[id]', params: { id: userId } });
  }, [router]);

  // Render individual items - uses index to determine connector lines
  const renderItem: ListRenderItem<ThreadListItem> = useCallback(({ item, index }) => {
    // Count ancestors to determine line connections
    const ancestorCount = items.filter(i => i.type === 'ancestor').length;
    const hasAncestors = ancestorCount > 0;
    
    switch (item.type) {
      case 'ancestor':
        // Find ancestor index (0-based among ancestors)
        const ancestorIndex = index; // ancestors are first in list
        const isFirstAncestor = ancestorIndex === 0;
        
        return (
          <ThreadPost
            post={item.post}
            isAncestor
            showParentLine={!isFirstAncestor} // Show line from above (except first)
            showChildLine={true} // Always show line to next post
            onPress={() => navigateToPost(item.post.id)}
            onLike={() => onLike(item.post)}
            onReply={() => onReply(item.post, item.post.author?.username)}
            onRepost={() => onRepost(item.post)}
            onProfilePress={() => navigateToProfile(item.post.author?.id || '')}
            onMore={onMore ? () => onMore(item.post) : undefined}
          />
        );

      case 'focused':
        return (
          <ThreadPost
            post={item.post}
            isFocused
            showParentLine={hasAncestors} // Show line from last ancestor
            showChildLine={false} // No line to replies
            onLike={() => onLike(item.post)}
            onReply={() => onReply(item.post, item.post.author?.username)}
            onRepost={() => onRepost(item.post)}
            onShare={() => {}}
            onProfilePress={() => navigateToProfile(item.post.author?.id || '')}
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
          <ThreadPost
            post={item.reply.post}
            replyingTo={item.reply.replyingTo}
            onPress={() => navigateToPost(item.reply.post.id)}
            onLike={() => onLike(item.reply.post)}
            onReply={() => onReply(item.reply.post, item.reply.post.author?.username)}
            onRepost={() => onRepost(item.reply.post)}
            onProfilePress={() => navigateToProfile(item.reply.post.author?.id || '')}
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
  }, [items, navigateToPost, navigateToProfile, onLike, onReply, onRepost, onMore, onLoadMore, isLoadingMore]);

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
