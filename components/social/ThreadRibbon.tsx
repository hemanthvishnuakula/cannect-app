/**
 * ThreadRibbon - Bluesky Flat Style Thread View
 * 
 * Renders the complete thread in Bluesky's flat style:
 * - Ancestor chain (root → parent → focused)
 * - Hero focused post
 * - Reply divider
 * - FLAT list of replies with "Replying to @user" labels
 */

import React, { memo, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import type { ThreadView, ThreadListItem, ThreadReply as ThreadReplyType } from '@/lib/types/thread';
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

  // Navigation handlers
  const navigateToPost = useCallback((postId: string) => {
    router.push({ pathname: '/post/[id]', params: { id: postId } });
  }, [router]);

  const navigateToProfile = useCallback((userId: string) => {
    router.push({ pathname: '/user/[id]', params: { id: userId } });
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
            reply={item.reply}
            onPress={() => navigateToPost(item.reply.post.id)}
            onLike={() => onLike(item.reply.post)}
            onReply={() => onReply(item.reply.post, item.reply.post.author?.username)}
            onRepost={() => onRepost(item.reply.post)}
            onProfilePress={() => navigateToProfile(item.reply.post.author?.id || '')}
            onMore={onMore ? () => onMore(item.reply.post) : undefined}
            isOwnPost={item.reply.post.user_id === user?.id}
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
  }, [navigateToPost, navigateToProfile, onLike, onReply, onRepost, onMore, onLoadMore, isLoadingMore, user?.id]);

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
  loadMoreButton: {
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#000',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2A2A',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#10B981',
  },
});

export default ThreadRibbon;
