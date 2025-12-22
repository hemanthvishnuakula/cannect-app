/**
 * AncestorPost - Compact post in the ancestor ribbon
 * 
 * Shows a condensed version of parent posts leading to the focused post
 * with a continuous thread line connecting them.
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import type { PostWithAuthor } from '@/lib/types/database';
import { formatDistanceToNow } from '@/lib/utils/date';
import { THREAD_DESIGN } from '@/lib/types/thread';

interface AncestorPostProps {
  post: PostWithAuthor;
  isLast: boolean;
  onPress: () => void;
  onProfilePress: () => void;
}

export const AncestorPost = memo(function AncestorPost({
  post,
  isLast,
  onPress,
  onProfilePress,
}: AncestorPostProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
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
            style={styles.avatar}
            contentFit="cover"
          />
        </Pressable>
        {/* Continuous line connecting ancestors */}
        <View style={[styles.threadLine, isLast && styles.threadLineLast]} />
      </View>

      {/* Right: Content */}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.displayName} numberOfLines={1}>
            {post.author?.display_name || post.author?.username}
          </Text>
          <Text style={styles.handle}>
            @{post.author?.username}
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.time}>
            {formatDistanceToNow(new Date(post.created_at))}
          </Text>
        </View>
        <Text style={styles.text} numberOfLines={2}>
          {post.content}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#000',
  },
  pressed: {
    backgroundColor: '#0A0A0A',
  },
  leftColumn: {
    alignItems: 'center',
    marginRight: 12,
    width: THREAD_DESIGN.AVATAR_SIZES.ancestor,
  },
  avatar: {
    width: THREAD_DESIGN.AVATAR_SIZES.ancestor,
    height: THREAD_DESIGN.AVATAR_SIZES.ancestor,
    borderRadius: THREAD_DESIGN.AVATAR_SIZES.ancestor / 2,
    backgroundColor: '#1A1A1A',
  },
  threadLine: {
    flex: 1,
    width: THREAD_DESIGN.LINE_WIDTH,
    backgroundColor: '#2A2A2A',
    marginTop: 8,
    minHeight: 16,
  },
  threadLineLast: {
    backgroundColor: '#10B981', // Emerald for connection to focused
  },
  content: {
    flex: 1,
    paddingBottom: 4,
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
    fontSize: 14,
    color: '#A1A1A1',
    marginTop: 4,
    lineHeight: 20,
  },
});

export default AncestorPost;
