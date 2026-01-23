/**
 * ShareToStoryCard - Instagram Stories compatible share card
 *
 * Creates a visually appealing card for sharing posts to Instagram Stories.
 * Similar to X/Twitter's "Share to Instagram Stories" feature.
 *
 * Design:
 * - Story-friendly aspect ratio (9:16)
 * - Cannect branding (logo + cannect.space)
 * - Post content with author info
 * - Dark theme matching app aesthetic
 */

import { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Leaf } from 'lucide-react-native';
import { getOptimizedAvatarWithFallback } from '@/lib/utils/avatar';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;

interface ShareToStoryCardProps {
  post: PostView;
}

/**
 * This component renders the shareable card.
 * Use with react-native-view-shot to capture as an image.
 */
export const ShareToStoryCard = forwardRef<View, ShareToStoryCardProps>(({ post }, ref) => {
  const author = post.author;
  const record = post.record as AppBskyFeedPost.Record;
  const avatarUrl = getOptimizedAvatarWithFallback(author.avatar, author.displayName || author.handle, 48);
  
  // Truncate text for story card (max ~280 chars)
  const displayText = record.text?.length > 280 
    ? record.text.substring(0, 277) + '...' 
    : record.text || '';

  // Check if cannect user
  const isCannectUser = 
    author.handle.endsWith('.cannect.space') || 
    author.handle.endsWith('.pds.cannect.space');

  return (
    <View ref={ref} style={styles.container} collapsable={false}>
      {/* Background gradient effect */}
      <View style={styles.background}>
        {/* Top branding */}
        <View style={styles.topBranding}>
          <View style={styles.logoContainer}>
            <Leaf size={20} color="#10B981" />
            <Text style={styles.logoText}>Cannect</Text>
          </View>
        </View>

        {/* Main content card */}
        <View style={styles.card}>
          {/* Author info */}
          <View style={styles.authorRow}>
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              contentFit="cover"
            />
            <View style={styles.authorInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {author.displayName || author.handle}
                </Text>
                {isCannectUser && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>cannect</Text>
                  </View>
                )}
              </View>
              <Text style={styles.handle}>@{author.handle}</Text>
            </View>
          </View>

          {/* Post text */}
          <Text style={styles.postText}>{displayText}</Text>

          {/* Engagement hint */}
          <View style={styles.engagementHint}>
            <Text style={styles.hintText}>Tap to see full post</Text>
          </View>
        </View>

        {/* Bottom branding */}
        <View style={styles.bottomBranding}>
          <Text style={styles.urlText}>cannect.space</Text>
        </View>
      </View>
    </View>
  );
});

ShareToStoryCard.displayName = 'ShareToStoryCard';

const styles = StyleSheet.create({
  container: {
    width: 360,
    height: 640,
    backgroundColor: '#0A0A0A',
  },
  background: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    paddingHorizontal: 20,
    paddingVertical: 40,
    justifyContent: 'space-between',
  },
  topBranding: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  logoText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  card: {
    backgroundColor: '#18181B',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#27272A',
  },
  authorInfo: {
    flex: 1,
    marginLeft: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  badge: {
    marginLeft: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
  },
  handle: {
    color: '#71717A',
    fontSize: 14,
    marginTop: 2,
  },
  postText: {
    color: '#FAFAFA',
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '400',
  },
  engagementHint: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    alignItems: 'center',
  },
  hintText: {
    color: '#52525B',
    fontSize: 13,
  },
  bottomBranding: {
    alignItems: 'center',
  },
  urlText: {
    color: '#52525B',
    fontSize: 14,
    fontWeight: '500',
  },
});
