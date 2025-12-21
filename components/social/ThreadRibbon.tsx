/**
 * ThreadRibbon - The main thread view orchestrator
 * 
 * Renders the complete Post Ribbon pattern:
 * - Ancestor chain (root → parent → focused)
 * - Hero focused post
 * - Reply divider
 * - Nested descendants
 */

import React, { memo, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import type { ThreadView, ThreadListItem } from '@/lib/types/thread';
import type { PostWithAuthor } from '@/lib/types/database';
import { flattenThreadToList } from '@/lib/types/thread';
import { useAuthStore } from '@/lib/stores';
import { AncestorPost } from './AncestorPost';
import { FocusedPost } from './FocusedPost';
import { ThreadReply } from './ThreadReply';

interface ThreadRibbonProps {
  thread: ThreadView;
  isLoading?: boolean;
  onLike: (post: PostWithAuthor) => void;
  onReply: (post: PostWithAuthor, username?: string) => void;
  onRepost: (post: PostWithAuthor) => void;
  onMore?: (post: PostWithAuthor) => void;
  onLoadMoreReplies?: (parentId: string) => void;
  isLoadingMoreReplies?: boolean;
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
  onLoadMoreReplies,
  isLoadingMoreReplies,
  ListHeaderComponent,
  ListFooterComponent,
}: ThreadRibbonProps) {
  const router = useRouter();
  const { user } = useAuthStore();

  // Flatten thread into renderable list
  const items = useMemo(() => flattenThreadToList(thread), [thread]);

  // Navigation handlers
  const navigateToPost = useCallback((postId: string) => {
    router.push(`/post/${postId}`);
  }, [router]);

  const navigateToProfile = useCallback((userId: string) => {
    router.push(`/user/${userId}`);
  }, [router]);

  // Render individual items
  const renderItem: ListRenderItem<ThreadListItem> = useCallback(({ item }) => {
    switch (item.type) {
      case 'ancestor':
        return (
          <AncestorPost
            post={item.post}
            isLast={item.isLast}
            onPress={() => navigateToPost(item.post.id)}
            onProfilePress={() => navigateToProfile(item.post.author?.id || '')}
          />
        );

      case 'focused':
        return (
          <FocusedPost
            post={item.post}
            onLike={() => onLike(item.post)}
            onReply={() => onReply(item.post, item.post.author?.username)}
            onRepost={() => onRepost(item.post)}
            onShare={() => {}}
            onProfilePress={() => navigateToProfile(item.post.author?.id || '')}
            onMorePress={onMore ? () => onMore(item.post) : undefined}
          />
        );

      case 'reply-divider':
        return (
          <View style={styles.replyDivider}>
            <Text style={styles.replyDividerText}>
              {item.count} {item.count === 1 ? 'Reply' : 'Replies'}
            </Text>
          </View>
        );

      case 'reply':
        return (
          <ThreadReply
            node={item.node}
            depth={item.depth}
            onPress={() => navigateToPost(item.node.post.id)}
            onLike={() => onLike(item.node.post)}
            onReply={() => onReply(item.node.post, item.node.post.author?.username)}
            onRepost={() => onRepost(item.node.post)}
            onProfilePress={() => navigateToProfile(item.node.post.author?.id || '')}
            onShowMore={() => onLoadMoreReplies?.(item.node.post.id)}
            onMore={onMore ? () => onMore(item.node.post) : undefined}
            isOwnPost={item.node.post.user_id === user?.id}
          />
        );

      case 'show-more':
        // This is handled inside ThreadReply for now
        return null;

      default:
        return null;
    }
  }, [navigateToPost, navigateToProfile, onLike, onReply, onRepost, onMore, onLoadMoreReplies]);

  // Key extractor
  const keyExtractor = useCallback((item: ThreadListItem, index: number) => {
    switch (item.type) {
      case 'ancestor':
      case 'focused':
        return `${item.type}-${item.post.id}`;
      case 'reply':
        return `reply-${item.node.post.id}`;
      case 'reply-divider':
        return 'reply-divider';
      case 'show-more':
        return `show-more-${item.parentId}`;
      default:
        return `item-${index}`;
    }
  }, []);

  // Estimate item sizes for FlashList performance
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
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={100}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: '#000',
  },
  replyDividerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FAFAFA',
  },
});

export default ThreadRibbon;
