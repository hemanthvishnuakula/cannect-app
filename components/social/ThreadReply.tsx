/**
 * ThreadReply - A reply in the thread with inline nesting support
 * 
 * Features:
 * - Thread line connecting to parent
 * - Recursive inline children (up to MAX_INLINE_DEPTH)
 * - "Show more replies" for hidden content
 */

import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Repeat2, ChevronDown } from 'lucide-react-native';
import type { ThreadNode } from '@/lib/types/thread';
import { THREAD_RIBBON, THREAD_CONFIG } from '@/lib/types/thread';
import { formatDistanceToNow } from '@/lib/utils/date';

interface ThreadReplyProps {
  node: ThreadNode;
  depth: number;
  onPress: () => void;
  onLike: () => void;
  onReply: () => void;
  onRepost: () => void;
  onProfilePress: () => void;
  onShowMore: () => void;
}

export const ThreadReply = memo(function ThreadReply({
  node,
  depth,
  onPress,
  onLike,
  onReply,
  onRepost,
  onProfilePress,
  onShowMore,
}: ThreadReplyProps) {
  const { post, children, hasMoreReplies, replyCount } = node;
  
  // Calculate sizes based on depth
  const avatarSize = depth === 0 
    ? THREAD_RIBBON.AVATAR_SIZES.reply 
    : THREAD_RIBBON.AVATAR_SIZES.nested;
  const indent = depth * THREAD_RIBBON.INDENT_PER_LEVEL;
  const showInlineChildren = depth < THREAD_CONFIG.MAX_INLINE_DEPTH && children.length > 0;
  
  const handleLike = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onLike();
  }, [onLike]);

  const handleReply = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onReply();
  }, [onReply]);

  const handleRepost = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onRepost();
  }, [onRepost]);

  const handleShowMore = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    onShowMore();
  }, [onShowMore]);

  // Calculate remaining replies count
  const visibleChildren = children.slice(0, THREAD_CONFIG.INLINE_REPLIES_PER_LEVEL);
  const hiddenChildrenCount = children.length - visibleChildren.length;
  const totalHidden = hiddenChildrenCount + (hasMoreReplies ? replyCount - children.length : 0);

  return (
    <View style={[styles.wrapper, { marginLeft: indent }]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.container,
          pressed && styles.pressed,
        ]}
      >
        {/* Left: Avatar + Thread Line */}
        <View style={styles.leftColumn}>
          <Pressable onPress={onProfilePress}>
            <Image
              source={{ uri: post.author?.avatar_url }}
              style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}
              contentFit="cover"
            />
          </Pressable>
          {showInlineChildren && (
            <View style={styles.threadLine} />
          )}
        </View>

        {/* Right: Content */}
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.displayName, depth > 0 && styles.smallerText]} numberOfLines={1}>
              {post.author?.display_name || post.author?.username}
            </Text>
            <Text style={styles.handle}>@{post.author?.username}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>
              {formatDistanceToNow(new Date(post.created_at))}
            </Text>
          </View>

          {/* Text */}
          <Text style={[styles.text, depth > 0 && styles.smallerText]}>
            {post.content}
          </Text>

          {/* Action Row */}
          <View style={styles.actions}>
            <Pressable onPress={handleReply} style={styles.actionButton}>
              <MessageCircle size={16} color="#6B7280" />
              {post.comments_count > 0 && (
                <Text style={styles.actionCount}>{post.comments_count}</Text>
              )}
            </Pressable>
            <Pressable onPress={handleRepost} style={styles.actionButton}>
              <Repeat2 
                size={16} 
                color={(post as any).is_reposted_by_me ? '#10B981' : '#6B7280'} 
              />
              {post.reposts_count > 0 && (
                <Text style={[
                  styles.actionCount, 
                  (post as any).is_reposted_by_me && styles.repostedCount
                ]}>
                  {post.reposts_count}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={handleLike} style={styles.actionButton}>
              <Heart 
                size={16} 
                color={post.is_liked ? '#EF4444' : '#6B7280'} 
                fill={post.is_liked ? '#EF4444' : 'transparent'}
              />
              {post.likes_count > 0 && (
                <Text style={[styles.actionCount, post.is_liked && styles.likedCount]}>
                  {post.likes_count}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Pressable>

      {/* Inline Nested Replies */}
      {showInlineChildren && (
        <View style={styles.nestedReplies}>
          {visibleChildren.map((child) => (
            <ThreadReply
              key={child.post.id}
              node={child}
              depth={depth + 1}
              onPress={onPress}
              onLike={onLike}
              onReply={onReply}
              onRepost={onRepost}
              onProfilePress={onProfilePress}
              onShowMore={onShowMore}
            />
          ))}
          
          {/* "Show more" if there are hidden children or more replies */}
          {totalHidden > 0 && (
            <Pressable
              onPress={handleShowMore}
              style={[styles.showMoreButton, { marginLeft: THREAD_RIBBON.INDENT_PER_LEVEL }]}
            >
              <ChevronDown size={16} color="#10B981" />
              <Text style={styles.showMoreText}>
                Show {totalHidden} more {totalHidden === 1 ? 'reply' : 'replies'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Show more at max depth */}
      {depth >= THREAD_CONFIG.MAX_INLINE_DEPTH && (hasMoreReplies || children.length > 0) && (
        <Pressable
          onPress={handleShowMore}
          style={styles.showMoreButton}
        >
          <ChevronDown size={16} color="#10B981" />
          <Text style={styles.showMoreText}>
            Show {replyCount} more {replyCount === 1 ? 'reply' : 'replies'}
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#000',
  },
  container: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pressed: {
    backgroundColor: '#0A0A0A',
  },
  leftColumn: {
    alignItems: 'center',
    marginRight: 12,
  },
  avatar: {
    backgroundColor: '#1A1A1A',
  },
  threadLine: {
    flex: 1,
    width: THREAD_RIBBON.LINE_WIDTH,
    backgroundColor: '#2A2A2A',
    marginTop: 8,
    minHeight: 20,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  displayName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FAFAFA',
    maxWidth: 120,
  },
  smallerText: {
    fontSize: 13,
  },
  handle: {
    fontSize: 13,
    color: '#6B7280',
  },
  dot: {
    fontSize: 13,
    color: '#6B7280',
  },
  time: {
    fontSize: 13,
    color: '#6B7280',
  },
  text: {
    fontSize: 15,
    color: '#FAFAFA',
    marginTop: 4,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    fontSize: 12,
    color: '#6B7280',
  },
  likedCount: {
    color: '#EF4444',
  },
  repostedCount: {
    color: '#10B981',
  },
  nestedReplies: {
    // Nested replies container
  },
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  showMoreText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#10B981',
  },
});

export default ThreadReply;
