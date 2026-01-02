/**
 * PostCard - Universal post component for all list views
 *
 * Uses expo-image for fast cached images
 * Handles all embed types via PostEmbeds
 *
 * Variable height - text truncated to 4 lines max with "Show more" button
 *
 * Used in:
 * - Feed tabs (Global, Local, Following)
 * - Profile tabs (Posts, Reposts, Replies, Likes)
 * - Search results
 * - Thread replies
 */

import { useState, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Repeat2 } from 'lucide-react-native';
import { PostEmbeds } from './PostEmbeds';
import { PostActions } from './PostActions';
import { RichText } from './RichText';
import { getOptimizedAvatarUrl } from '../../lib/utils/avatar';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

// Maximum lines of text before truncation
const MAX_TEXT_LINES = 4;
// Approximate characters that fit in 4 lines (conservative estimate)
const TRUNCATION_THRESHOLD = 200;

interface PostCardProps {
  /** The feed item (includes reason for reposts) - preferred */
  item?: FeedViewPost;
  /** Raw post view for thread replies and other simple cases */
  post?: PostView;
  /** Called when the post card is tapped */
  onPress?: () => void;
  /** Called when an image is pressed for fullscreen viewing */
  onImagePress?: (images: string[], index: number) => void;
  /** Show border at bottom (default: true) */
  showBorder?: boolean;
}

// Format relative time
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

export function PostCard({
  item,
  post: rawPost,
  onPress,
  onImagePress,
  showBorder = true,
}: PostCardProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);

  // Support both FeedViewPost (item) and raw PostView (post)
  const post = item?.post ?? rawPost;

  // Guard: must have either item or post
  if (!post) {
    console.warn('PostCard: Neither item nor post provided');
    return null;
  }

  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author;

  // Check if text needs truncation (simple heuristic based on length)
  const textLength = record.text?.length || 0;
  const needsTruncation = textLength > TRUNCATION_THRESHOLD;
  const shouldTruncate = needsTruncation && !isExpanded;

  // Stop event propagation helper (works on web and native)
  const stopEvent = useCallback((e: any) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
  }, []);

  // Handle "Show more" tap
  const handleShowMore = useCallback(
    (e: any) => {
      stopEvent(e);
      setIsExpanded(true);
    },
    [stopEvent]
  );

  // Check if this is a repost (only possible with FeedViewPost)
  const isRepost = !!item?.reason && item.reason.$type === 'app.bsky.feed.defs#reasonRepost';
  const repostBy = isRepost ? (item!.reason as any).by : null;

  // Default navigation handler
  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      // Default: navigate to post detail
      const uriParts = post.uri.split('/');
      const rkey = uriParts[uriParts.length - 1];
      router.push(`/post/${post.author.did}/${rkey}`);
    }
  };

  // Navigate to author profile
  const handleAuthorPress = () => {
    router.push(`/user/${author.handle}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      className={`px-4 pt-4 pb-2 ${showBorder ? 'border-b border-border' : ''}`}
    >
      {/* Repost indicator */}
      {isRepost && repostBy && (
        <View className="flex-row items-center mb-2 pl-10">
          <Repeat2 size={14} color="#6B7280" />
          <Text className="text-text-muted text-xs ml-1 flex-1" numberOfLines={1}>
            Reposted by {repostBy.displayName || repostBy.handle}
          </Text>
        </View>
      )}

      <View className="flex-row">
        {/* Avatar - using expo-image for caching */}
        <Pressable
          onPressIn={stopEvent}
          onPress={(e) => {
            stopEvent(e);
            handleAuthorPress();
          }}
          className="self-start"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {author.avatar ? (
            <Image
              source={{ uri: getOptimizedAvatarUrl(author.avatar, 44) }}
              className="w-11 h-11 rounded-full bg-surface-elevated"
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
              recyclingKey={author.avatar}
            />
          ) : (
            <View className="w-11 h-11 rounded-full bg-surface-elevated items-center justify-center">
              <Text className="text-text-muted text-lg">{author.handle[0].toUpperCase()}</Text>
            </View>
          )}
        </Pressable>

        {/* Content */}
        <View className="flex-1 ml-3">
          {/* Header - Name, Badge, and Time (single line, name truncates only if needed) */}
          <View className="flex-row items-center">
            <Pressable
              onPressIn={stopEvent}
              onPress={(e) => {
                stopEvent(e);
                handleAuthorPress();
              }}
              className="flex-row items-center flex-1 mr-2"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text className="font-semibold text-text-primary flex-shrink" numberOfLines={1}>
                {author.displayName || author.handle}
              </Text>
              {/* Network badge - cannect (green) or global */}
              {author.handle.endsWith('.cannect.space') ? (
                <View className="ml-2 px-2 py-0.5 rounded-full bg-primary/20 flex-shrink-0">
                  <Text className="text-primary text-xs font-medium">cannect</Text>
                </View>
              ) : (
                <View className="ml-2 px-2 py-0.5 rounded-full bg-surface-elevated flex-shrink-0">
                  <Text className="text-text-muted text-xs font-medium">global</Text>
                </View>
              )}
            </Pressable>
            <Text className="text-text-muted flex-shrink-0">{formatTime(record.createdAt)}</Text>
          </View>

          {/* Post text with facets (mentions, links, hashtags) */}
          <RichText
            text={record.text}
            facets={record.facets}
            className="mt-2"
            numberOfLines={shouldTruncate ? MAX_TEXT_LINES : undefined}
          />

          {/* Show more button for truncated text */}
          {shouldTruncate && (
            <Pressable
              onPressIn={stopEvent}
              onPress={handleShowMore}
              className="mt-2 py-1 self-start"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text className="text-primary font-medium">Show more</Text>
            </Pressable>
          )}

          {/* Embeds (images, video, link preview, quote) */}
          <PostEmbeds embed={post.embed} onImagePress={onImagePress} />

          {/* Action buttons with built-in optimistic mutations */}
          <PostActions post={post} variant="compact" />
        </View>
      </View>
    </Pressable>
  );
}
