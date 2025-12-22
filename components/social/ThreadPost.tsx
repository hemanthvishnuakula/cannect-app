/**
 * ThreadPost - Unified post component matching Bluesky's official layout
 * 
 * Reference: bluesky-social/social-app ThreadItemPost.tsx
 * 
 * Layout:
 * - Parent reply line (12px height, line centered in avatar column)
 * - Avatar (42px) with child reply line extending down
 * - Content: name, handle, time, text, media, actions
 */

import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Heart, MessageCircle, Repeat2, MoreHorizontal, Share as ShareIcon } from 'lucide-react-native';
import type { PostWithAuthor } from '@/lib/types/database';
import { THREAD_DESIGN } from '@/lib/types/thread';
import { formatDistanceToNow, formatDateTime } from '@/lib/utils/date';
import { PostCarousel } from './PostCarousel';

interface ThreadPostProps {
  post: PostWithAuthor;
  /** Show vertical line going UP to parent */
  showParentLine?: boolean;
  /** Show vertical line going DOWN to child */
  showChildLine?: boolean;
  /** "Replying to @username" label */
  replyingTo?: string;
  /** Is this the focused/anchor post (larger text, full timestamp) */
  isFocused?: boolean;
  
  // Actions
  onPress?: () => void;
  onLike?: () => void;
  onReply?: () => void;
  onRepost?: () => void;
  onShare?: () => void;
  onProfilePress?: () => void;
  onMore?: () => void;
}

export const ThreadPost = memo(function ThreadPost({
  post,
  showParentLine = false,
  showChildLine = false,
  replyingTo,
  isFocused = false,
  onPress,
  onLike,
  onReply,
  onRepost,
  onShare,
  onProfilePress,
  onMore,
}: ThreadPostProps) {
  
  const handleLike = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onLike?.();
  }, [onLike]);

  const handleReply = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onReply?.();
  }, [onReply]);

  const handleRepost = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onRepost?.();
  }, [onRepost]);

  const handleMore = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onMore?.();
  }, [onMore]);

  const timestamp = isFocused 
    ? formatDateTime(new Date(post.created_at))
    : formatDistanceToNow(new Date(post.created_at));

  const content = (
    <View style={styles.container}>
      {/* Parent Reply Line - matches Bluesky ThreadItemPostParentReplyLine */}
      <View style={styles.parentLineContainer}>
        <View style={styles.parentLineColumn}>
          {showParentLine && <View style={styles.parentLine} />}
        </View>
      </View>

      {/* Main Post Content Row */}
      <View style={styles.mainRow}>
        {/* Left: Avatar + Child Line (matches Bluesky layout) */}
        <View style={styles.avatarColumn}>
          <Pressable onPress={onProfilePress}>
            <Image
              source={{ uri: post.author?.avatar_url }}
              style={styles.avatar}
              contentFit="cover"
            />
          </Pressable>
          {/* Child line extending down - uses flex to fill remaining space */}
          {showChildLine && <View style={styles.childLine} />}
        </View>

        {/* Right: Content */}
        <View style={styles.contentColumn}>
          {/* Replying to label */}
          {replyingTo && (
            <Text style={styles.replyingTo}>
              Replying to <Text style={styles.replyingToHandle}>@{replyingTo}</Text>
            </Text>
          )}

          {/* Header: Name, Handle, Time, More */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={[styles.displayName, isFocused && styles.displayNameFocused]} numberOfLines={1}>
                {post.author?.display_name || post.author?.username}
              </Text>
              <Text style={styles.handle}>@{post.author?.username}</Text>
              {!isFocused && (
                <>
                  <Text style={styles.dot}>·</Text>
                  <Text style={styles.time}>{timestamp}</Text>
                </>
              )}
            </View>
            {onMore && (
              <Pressable onPress={handleMore} hitSlop={8} style={styles.moreButton}>
                <MoreHorizontal size={18} color="#6B7280" />
              </Pressable>
            )}
          </View>

          {/* Text Content */}
          <Text style={[styles.text, isFocused && styles.textFocused]}>
            {post.content}
          </Text>

          {/* Media */}
          {post.media_urls && post.media_urls.length > 0 && (
            <View style={styles.mediaContainer}>
              <PostCarousel mediaUrls={post.media_urls} />
            </View>
          )}

          {/* Focused: Full timestamp on separate line */}
          {isFocused && (
            <Text style={styles.focusedTimestamp}>{timestamp}</Text>
          )}

          {/* Focused: Stats row */}
          {isFocused && (post.reposts_count > 0 || post.likes_count > 0) && (
            <View style={styles.statsRow}>
              {post.reposts_count > 0 && (
                <Text style={styles.stat}>
                  <Text style={styles.statCount}>{post.reposts_count}</Text> reposts
                </Text>
              )}
              {post.likes_count > 0 && (
                <Text style={styles.stat}>
                  <Text style={styles.statCount}>{post.likes_count}</Text> likes
                </Text>
              )}
            </View>
          )}

          {/* Action Row */}
          <View style={[styles.actions, isFocused && styles.actionsFocused]}>
            <Pressable onPress={handleReply} style={styles.actionButton}>
              <MessageCircle size={isFocused ? 22 : 18} color="#6B7280" />
              {!isFocused && (post.replies_count ?? 0) > 0 && (
                <Text style={styles.actionCount}>{post.replies_count}</Text>
              )}
            </Pressable>
            
            <Pressable onPress={handleRepost} style={styles.actionButton}>
              <Repeat2 
                size={isFocused ? 22 : 18} 
                color={(post as any).is_reposted_by_me ? '#10B981' : '#6B7280'} 
              />
              {!isFocused && post.reposts_count > 0 && (
                <Text style={[styles.actionCount, (post as any).is_reposted_by_me && styles.repostedCount]}>
                  {post.reposts_count}
                </Text>
              )}
            </Pressable>
            
            <Pressable onPress={handleLike} style={styles.actionButton}>
              <Heart 
                size={isFocused ? 22 : 18} 
                color={post.is_liked ? '#EF4444' : '#6B7280'} 
                fill={post.is_liked ? '#EF4444' : 'transparent'}
              />
              {!isFocused && post.likes_count > 0 && (
                <Text style={[styles.actionCount, post.is_liked && styles.likedCount]}>
                  {post.likes_count}
                </Text>
              )}
            </Pressable>

            {onShare && (
              <Pressable onPress={onShare} style={styles.actionButton}>
                <ShareIcon size={isFocused ? 22 : 18} color="#6B7280" />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );

  // Wrap in Pressable if onPress is provided (for non-focused posts)
  if (onPress && !isFocused) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {content}
      </Pressable>
    );
  }

  return content;
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
  },
  pressed: {
    backgroundColor: '#0A0A0A',
  },
  
  // Parent line container (matches ThreadItemPostParentReplyLine in Bluesky)
  parentLineContainer: {
    flexDirection: 'row',
    height: 12,
    paddingHorizontal: THREAD_DESIGN.OUTER_SPACE,
  },
  parentLineColumn: {
    width: THREAD_DESIGN.AVATAR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentLine: {
    width: THREAD_DESIGN.LINE_WIDTH,
    flex: 1,
    marginBottom: 4, // Bluesky uses a.mb_xs which is 4px
    backgroundColor: '#333',
  },
  
  // Main row
  mainRow: {
    flexDirection: 'row',
    paddingHorizontal: THREAD_DESIGN.OUTER_SPACE,
    paddingBottom: 12,
  },
  
  // Avatar column (matches Bluesky's avatar + child line layout)
  avatarColumn: {
    width: THREAD_DESIGN.AVATAR_SIZE,
    alignItems: 'center',
    marginRight: THREAD_DESIGN.AVATAR_GAP,
  },
  avatar: {
    width: THREAD_DESIGN.AVATAR_SIZE,
    height: THREAD_DESIGN.AVATAR_SIZE,
    borderRadius: THREAD_DESIGN.AVATAR_SIZE / 2,
    backgroundColor: '#1A1A1A',
  },
  childLine: {
    width: THREAD_DESIGN.LINE_WIDTH,
    flex: 1,
    marginTop: 4, // Bluesky uses a.mt_xs which is 4px
    backgroundColor: '#333',
  },
  
  // Content column
  contentColumn: {
    flex: 1,
  },
  
  // Replying to label
  replyingTo: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 2,
  },
  replyingToHandle: {
    color: '#10B981',
  },
  
  // Header
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
  displayName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FAFAFA',
    maxWidth: 140,
  },
  displayNameFocused: {
    fontSize: 17,
    fontWeight: '700',
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
  moreButton: {
    padding: 4,
  },
  
  // Text content
  text: {
    fontSize: 15,
    color: '#FAFAFA',
    lineHeight: 22,
    marginTop: 4,
  },
  textFocused: {
    fontSize: 17,
    lineHeight: 24,
  },
  
  // Media
  mediaContainer: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  
  // Focused post extras
  focusedTimestamp: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  stat: {
    fontSize: 14,
    color: '#6B7280',
  },
  statCount: {
    fontWeight: '700',
    color: '#FAFAFA',
  },
  
  // Actions
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 24,
  },
  actionsFocused: {
    justifyContent: 'space-around',
    gap: 0,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 4,
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

export default ThreadPost;
