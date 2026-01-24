/**
 * ThreadPost - Expanded view for the main post in thread detail
 *
 * Shows:
 * - Larger avatar
 * - Full timestamp
 * - Stats row (likes, reposts, replies count)
 * - Full action bar
 */

import { useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { PostEmbeds } from './PostEmbeds';
import { PostActions } from './PostActions';
import { RichText } from './RichText';
import { getOptimizedAvatarWithFallback } from '../../lib/utils/avatar';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;

// Format relative time (matching PostCard)
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

interface ThreadPostProps {
  post: PostView;
  onImagePress?: (images: string[], index: number) => void;
  isBoosted?: boolean;
}

export function ThreadPost({ post, onImagePress, isBoosted = false }: ThreadPostProps) {
  const router = useRouter();
  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author;

  // Stop event propagation helper
  // Note: Only stopPropagation is needed - preventDefault breaks click detection on web
  const stopEvent = useCallback((e: any) => {
    e?.stopPropagation?.();
  }, []);

  const handleAuthorPress = () => {
    router.push(`/user/${author.handle}`);
  };

  // Truncate long handles
  const displayHandle =
    author.handle.length > 25 ? `@${author.handle.slice(0, 25)}…` : `@${author.handle}`;

  return (
    <View className="px-4">
      {/* Author info - larger for thread view */}
      <Pressable
        onPressIn={stopEvent}
        onPress={handleAuthorPress}
        className="flex-row items-center mb-3"
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Image
          source={{
            uri: getOptimizedAvatarWithFallback(
              author.avatar,
              author.displayName || author.handle,
              48
            ),
          }}
          style={{ width: 48, height: 48, borderRadius: 24 }}
          contentFit="cover"
          transition={50}
          priority="high"
          cachePolicy="memory-disk"
          recyclingKey={author.avatar || author.did}
        />
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text className="text-text-primary text-[15px] font-bold flex-shrink" numberOfLines={1}>
              {author.displayName || author.handle}
            </Text>

            {/* Boosted badge */}
            {isBoosted && (
              <View className="ml-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 flex-shrink-0">
                <Text className="text-amber-500 text-xs font-medium">boosted</Text>
              </View>
            )}
            <View className="flex-1" />
            <Text className="text-text-muted text-[13px] flex-shrink-0">
              {formatTime(record.createdAt)}
            </Text>
          </View>
          <Text className="text-text-muted text-[13px]">{displayHandle}</Text>
        </View>
      </Pressable>

      {/* Post content - larger text with facets */}
      <RichText
        text={record.text}
        facets={record.facets}
        className="text-[17px] leading-relaxed mb-3"
      />

      {/* Embeds */}
      <PostEmbeds embed={post.embed} onImagePress={onImagePress} text={record.text} />

      {/* Action buttons with counts */}
      <PostActions post={post} variant="expanded" />
    </View>
  );
}
