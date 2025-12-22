/**
 * ThreadReplyFlat - A flat reply in Bluesky style
 * 
 * Features:
 * - "Replying to @user" label (no indentation)
 * - Tap to navigate to reply's thread
 * - Same engagement actions as feed posts
 */

import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Repeat2, MoreHorizontal } from 'lucide-react-native';
import type { ThreadReply as ThreadReplyType } from '@/lib/types/thread';
import { THREAD_DESIGN } from '@/lib/types/thread';
import { formatDistanceToNow } from '@/lib/utils/date';

interface ThreadReplyProps {
  reply: ThreadReplyType;
  onPress: () => void;
  onLike: () => void;
  onReply: () => void;
  onRepost: () => void;
  onProfilePress: () => void;
  onMore?: () => void;
  isOwnPost?: boolean;
}

export const ThreadReply = memo(function ThreadReply({
  reply,
  onPress,
  onLike,
  onReply,
  onRepost,
  onProfilePress,
  onMore,
  isOwnPost,
}: ThreadReplyProps) {
  const { post, replyingTo } = reply;
  
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

  const handleMore = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onMore?.();
  }, [onMore]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
    >
      {/* Left: Avatar */}
      <Pressable onPress={onProfilePress} style={styles.avatarContainer}>
        <Image
          source={{ uri: post.author?.avatar_url }}
          style={styles.avatar}
          contentFit="cover"
        />
      </Pressable>

      {/* Right: Content */}
      <View style={styles.content}>
        {/* "Replying to @username" label - Bluesky style */}
        {replyingTo && (
          <Text style={styles.replyingTo}>
            Replying to <Text style={styles.replyingToHandle}>@{replyingTo}</Text>
          </Text>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.displayName} numberOfLines={1}>
              {post.author?.display_name || post.author?.username}
            </Text>
            <Text style={styles.handle}>@{post.author?.username}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>
              {formatDistanceToNow(new Date(post.created_at))}
            </Text>
          </View>
          {onMore && (
            <Pressable onPress={handleMore} hitSlop={8} style={styles.moreButton}>
              <MoreHorizontal size={16} color="#6B7280" />
            </Pressable>
          )}
        </View>

        {/* Text Content */}
        <Text style={styles.text}>{post.content}</Text>

        {/* Action Row */}
        <View style={styles.actions}>
          <Pressable onPress={handleReply} style={styles.actionButton}>
            <MessageCircle size={18} color="#6B7280" />
            {(post.replies_count ?? 0) > 0 && (
              <Text style={styles.actionCount}>{post.replies_count}</Text>
            )}
          </Pressable>
          
          <Pressable onPress={handleRepost} style={styles.actionButton}>
            <Repeat2 
              size={18} 
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
              size={18} 
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
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#000',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  pressed: {
    backgroundColor: '#0A0A0A',
  },
  avatarContainer: {
    width: 48,
    alignItems: 'center',
    marginRight: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1A1A1A',
  },
  content: {
    flex: 1,
  },
  replyingTo: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 2,
  },
  replyingToHandle: {
    color: '#10B981',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    flex: 1,
  },
  moreButton: {
    padding: 4,
  },
  displayName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FAFAFA',
    maxWidth: 140,
  },
  handle: {
    fontSize: 14,
    color: '#6B7280',
  },
  dot: {
    fontSize: 14,
    color: '#6B7280',
  },
  time: {
    fontSize: 14,
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
    marginTop: 12,
    gap: 32,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontSize: 13,
    color: '#6B7280',
  },
  likedCount: {
    color: '#EF4444',
  },
  repostedCount: {
    color: '#10B981',
  },
});

export default ThreadReply;
