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

import { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Repeat2 } from 'lucide-react-native';
import { PostEmbeds } from './PostEmbeds';
import { PostActions } from './PostActions';
import { RichText } from './RichText';
import { FollowButton } from '../ui/FollowButton';
import { useAuthStore } from '../../lib/stores';
import { getOptimizedAvatarWithFallback } from '../../lib/utils/avatar';
import { useTrackPostView } from '../../lib/hooks/use-view-tracking';
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
  /** Hide the follow button (useful on profile pages where there's already one) */
  hideFollowButton?: boolean;
  /** Whether this post is boosted/promoted */
  isBoosted?: boolean;
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
  hideFollowButton = false,
  isBoosted = false,
}: PostCardProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const { did: currentUserDid } = useAuthStore();

  // Support both FeedViewPost (item) and raw PostView (post)
  const post = item?.post ?? rawPost;

  // Track post view when it becomes visible
  const viewTrackingRef = useTrackPostView(post?.uri, 'feed');

  // Guard: must have either item or post
  if (!post) {
    console.warn('PostCard: Neither item nor post provided');
    return null;
  }

  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author;

  // Extract embedded URL to hide from text (when link preview card is shown)
  const embeddedUrl = useMemo(() => {
    if (post.embed?.$type === 'app.bsky.embed.external#view') {
      return (post.embed as any).external?.uri;
    }
    return null;
  }, [post.embed]);

  // Check if text needs truncation (simple heuristic based on length)
  const textLength = record.text?.length || 0;
  const needsTruncation = textLength > TRUNCATION_THRESHOLD;
  const shouldTruncate = needsTruncation && !isExpanded;

  // Stop event propagation helper (works on web and native)
  // Note: Only stopPropagation is needed - preventDefault breaks click detection on web
  const stopEvent = useCallback((e: any) => {
    e?.stopPropagation?.();
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
      ref={viewTrackingRef as any}
      onPress={handlePress}
      className={`px-3 pt-2.5 pb-2 ${showBorder ? 'border-b border-neutral-800/50' : ''}`}
    >
      {/* Repost indicator */}
      {isRepost && repostBy && (
        <View className="flex-row items-center mb-1.5 pl-10">
          <Repeat2 size={12} color="#6B7280" />
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
          <Image
            source={{
              uri: getOptimizedAvatarWithFallback(
                author.avatar,
                author.displayName || author.handle,
                36
              ),
            }}
            className="w-9 h-9 rounded-full bg-neutral-900"
            contentFit="cover"
            transition={50}
            priority="high"
            cachePolicy="memory-disk"
            recyclingKey={author.avatar || author.did}
          />
        </Pressable>

        {/* Content */}
        <View className="flex-1 ml-2">
          {/* Header - Name @handle · time (grouped on left, X/Threads style) */}
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
              {/* Name - truncates first, max-width to leave room for handle/time */}
              <Text
                className="text-[15px] font-semibold text-text-primary flex-shrink"
                numberOfLines={1}
                style={{ maxWidth: '50%' }}
              >
                {author.displayName || author.handle?.split('.')[0]}
              </Text>
              {/* Only show handle if different from display name */}
              {author.displayName && author.displayName !== author.handle && (
                <Text
                  className="text-text-muted text-[14px] ml-1 flex-shrink"
                  numberOfLines={1}
                  style={{ maxWidth: '25%' }}
                >
                  @{author.handle?.split('.')[0]}
                </Text>
              )}
              <Text className="text-text-muted text-[14px] mx-1 flex-shrink-0">·</Text>
              <Text className="text-text-muted text-[13px] flex-shrink-0">
                {formatTime(record.createdAt)}
              </Text>
              {/* Boosted badge */}
              {isBoosted && (
                <View className="ml-2 px-2 py-0.5 rounded-full bg-amber-500/20 flex-shrink-0">
                  <Text className="text-amber-500 text-xs font-medium">boosted</Text>
                </View>
              )}
            </Pressable>
            {/* Follow button - show only if not following, not own post, and not hidden */}
            {!hideFollowButton && !author.viewer?.following && author.did !== currentUserDid && (
              <View className="ml-2 flex-shrink-0" onStartShouldSetResponder={() => true}>
                <FollowButton profile={author} size="small" variant="icon-only" />
              </View>
            )}
          </View>

          {/* Post text with facets (mentions, links, hashtags) */}
          <RichText
            text={record.text}
            facets={record.facets}
            className="mt-1.5 mb-1"
            numberOfLines={shouldTruncate ? MAX_TEXT_LINES : undefined}
            hideUrls={embeddedUrl ? [embeddedUrl] : undefined}
          />

          {/* Show more button for truncated text */}
          {shouldTruncate && (
            <Pressable
              onPressIn={stopEvent}
              onPress={handleShowMore}
              className="mt-0.5 mb-1 py-0.5 self-start"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Text className="text-primary text-sm font-medium">Show more</Text>
            </Pressable>
          )}

          {/* Embeds (images, video, link preview, quote) */}
          <PostEmbeds embed={post.embed} onImagePress={onImagePress} text={record.text} />

          {/* Action buttons with built-in optimistic mutations */}
          <PostActions post={post} variant="compact" />
        </View>
      </View>
    </Pressable>
  );
}
