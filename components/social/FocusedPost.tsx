/**
 * FocusedPost - Hero layout for the main thread post
 * 
 * Features:
 * - Larger avatar and typography
 * - Full timestamp (not relative)
 * - Separate stats row (X Reposts · Y Likes)
 * - Full-width media
 */

import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { formatDateTime } from '@/lib/utils/date';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Repeat2, Share as ShareIcon, MoreHorizontal } from 'lucide-react-native';
import type { PostWithAuthor } from '@/lib/types/database';
import { PostCarousel } from './PostCarousel';
import { THREAD_DESIGN } from '@/lib/types/thread';

interface FocusedPostProps {
  post: PostWithAuthor;
  onLike: () => void;
  onReply: () => void;
  onRepost: () => void;
  onShare: () => void;
  onProfilePress: () => void;
  onMorePress?: () => void;
}

export const FocusedPost = memo(function FocusedPost({
  post,
  onLike,
  onReply,
  onRepost,
  onShare,
  onProfilePress,
  onMorePress,
}: FocusedPostProps) {
  const handleLike = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onRepost();
  }, [onRepost]);

  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onShare();
  }, [onShare]);

  const formattedDate = formatDateTime(new Date(post.created_at));

  return (
    <View style={styles.container}>
      {/* Author Section - Larger */}
      <View style={styles.authorSection}>
        <Pressable onPress={onProfilePress}>
          <Image
            source={{ uri: post.author?.avatar_url }}
            style={styles.avatar}
            contentFit="cover"
          />
        </Pressable>
        <View style={styles.authorInfo}>
          <Text style={styles.displayName}>
            {post.author?.display_name || post.author?.username}
          </Text>
          <Text style={styles.handle}>@{post.author?.username}</Text>
        </View>
        {onMorePress && (
          <Pressable onPress={onMorePress} style={styles.moreButton}>
            <MoreHorizontal size={20} color="#6B7280" />
          </Pressable>
        )}
      </View>

      {/* Content - Full Width */}
      <View style={styles.contentSection}>
        <Text style={styles.content}>{post.content}</Text>
        
        {/* Full-width Media */}
        {post.media_urls && post.media_urls.length > 0 && (
          <View style={styles.mediaContainer}>
            <PostCarousel mediaUrls={post.media_urls} />
          </View>
        )}
      </View>

      {/* Full Timestamp */}
      <View style={styles.timestampSection}>
        <Text style={styles.timestamp}>{formattedDate}</Text>
      </View>

      {/* Stats Row */}
      {(post.reposts_count > 0 || post.likes_count > 0 || (post as any).quotes_count > 0) && (
        <View style={styles.statsRow}>
          {post.reposts_count > 0 && (
            <Pressable style={styles.statItem}>
              <Text style={styles.statCount}>{post.reposts_count}</Text>
              <Text style={styles.statLabel}>Reposts</Text>
            </Pressable>
          )}
          {post.likes_count > 0 && (
            <Pressable style={styles.statItem}>
              <Text style={styles.statCount}>{post.likes_count}</Text>
              <Text style={styles.statLabel}>Likes</Text>
            </Pressable>
          )}
          {(post as any).quotes_count > 0 && (
            <Pressable style={styles.statItem}>
              <Text style={styles.statCount}>{(post as any).quotes_count}</Text>
              <Text style={styles.statLabel}>Quotes</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Action Bar */}
      <View style={styles.actionBar}>
        <Pressable onPress={handleReply} style={styles.actionButton}>
          <MessageCircle size={22} color="#6B7280" />
        </Pressable>
        <Pressable onPress={handleRepost} style={styles.actionButton}>
          <Repeat2 
            size={22} 
            color={(post as any).is_reposted ? '#10B981' : '#6B7280'} 
          />
        </Pressable>
        <Pressable onPress={handleLike} style={styles.actionButton}>
          <Heart 
            size={22} 
            color={post.is_liked ? '#EF4444' : '#6B7280'} 
            fill={post.is_liked ? '#EF4444' : 'transparent'}
          />
        </Pressable>
        <Pressable onPress={handleShare} style={styles.actionButton}>
          <ShareIcon size={22} color="#6B7280" />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
  },
  authorSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  avatar: {
    width: THREAD_DESIGN.AVATAR_SIZES.focused,
    height: THREAD_DESIGN.AVATAR_SIZES.focused,
    borderRadius: THREAD_DESIGN.AVATAR_SIZES.focused / 2,
    backgroundColor: '#1A1A1A',
  },
  authorInfo: {
    marginLeft: 12,
    flex: 1,
  },
  displayName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  handle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 1,
  },
  moreButton: {
    padding: 8,
  },
  contentSection: {
    paddingHorizontal: 16,
  },
  content: {
    fontSize: 18,
    color: '#FAFAFA',
    lineHeight: 26,
  },
  mediaContainer: {
    marginTop: 12,
    marginHorizontal: -16,
  },
  timestampSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  timestamp: {
    fontSize: 14,
    color: '#6B7280',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
  },
  actionButton: {
    padding: 8,
  },
});

export default FocusedPost;
