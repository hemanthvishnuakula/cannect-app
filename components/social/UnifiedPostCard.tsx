/**
 * UnifiedPostCard - Single post component for all post types
 * 
 * Follows Bluesky's official app layout pattern:
 * - Avatar row with author meta
 * - Content with rich text
 * - Embed (images/video/quote)
 * - Action bar (reply/repost/like/share)
 * 
 * Works with both local Cannect posts and external Bluesky posts.
 */

import React, { memo, useCallback, useRef } from "react";
import { View, Text, Pressable, Animated, Platform, ActivityIndicator, type ViewProps } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { 
  Heart, 
  MessageCircle, 
  Repeat2, 
  Share, 
  MoreHorizontal, 
  BadgeCheck, 
  Globe2 
} from "lucide-react-native";

import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/utils/date";
import { ASSET_RATIOS, BLURHASH_PLACEHOLDERS } from "@/lib/utils/assets";
import type { 
  UnifiedPost, 
  UnifiedAuthor, 
  UnifiedEmbed, 
  UnifiedQuote,
  RepostInfo,
  ParentInfo,
} from "@/lib/types/unified-post";
import { PostCarousel } from "./PostCarousel";
import { VideoPlayer } from "@/components/ui/VideoPlayer";

// =====================================================
// Layout Primitives (following Bluesky's pattern)
// =====================================================

const LINEAR_AVI_WIDTH = 40;
const AVATAR_MARGIN = 12;
const CONTENT_OFFSET = LINEAR_AVI_WIDTH + AVATAR_MARGIN; // 52px

interface PostOuterProps extends ViewProps {
  children: React.ReactNode;
}

const PostOuter = memo(function PostOuter({ children, className, ...props }: PostOuterProps & { className?: string }) {
  return (
    <View 
      className={cn("border-b border-border bg-background px-4 py-3", className)} 
      {...props}
    >
      {children}
    </View>
  );
});

// =====================================================
// Action Button Component
// =====================================================

interface ActionButtonProps {
  icon: React.ComponentType<any>;
  count?: number;
  active?: boolean;
  activeColor?: string;
  onPress?: () => void;
  hapticStyle?: "light" | "medium" | "success";
  fill?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

const ActionButton = memo(function ActionButton({ 
  icon: Icon, 
  count, 
  active, 
  activeColor = "#EF4444",
  onPress,
  hapticStyle = "light",
  fill = false,
  disabled = false,
  accessibilityLabel,
}: ActionButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    if (disabled) return;
    
    if (Platform.OS !== "web") {
      if (hapticStyle === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (hapticStyle === "medium") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }

    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1.3,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start();

    onPress?.();
  }, [onPress, hapticStyle, scaleAnim, disabled]);

  return (
    <Pressable 
      onPress={handlePress} 
      disabled={disabled}
      className={cn(
        "flex-row items-center gap-1.5 p-1 -ml-2",
        disabled ? "opacity-50" : "active:opacity-70"
      )}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Icon 
          size={18} 
          color={active ? activeColor : "#6B7280"} 
          strokeWidth={2}
          fill={fill && active ? activeColor : "transparent"}
        />
      </Animated.View>
      {count !== undefined && (
        <Text 
          className="text-sm font-medium" 
          style={{ color: active ? activeColor : "#6B7280" }}
        >
          {count}
        </Text>
      )}
    </Pressable>
  );
});

// =====================================================
// Post Meta Row (Avatar + Author Info)
// =====================================================

interface PostMetaProps {
  author: UnifiedAuthor;
  createdAt: string;
  isExternal: boolean;
  source: "cannect" | "bluesky";
  onAuthorPress?: () => void;
  onMorePress?: () => void;
}

const PostMeta = memo(function PostMeta({
  author,
  createdAt,
  isExternal,
  source,
  onAuthorPress,
  onMorePress,
}: PostMetaProps) {
  const timeAgo = formatDistanceToNow(new Date(createdAt));

  return (
    <View className="flex-row items-start gap-3">
      {/* Avatar */}
      <Pressable 
        onPress={onAuthorPress} 
        className="active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel={`View ${author.displayName}'s profile`}
      >
        <Image
          source={{ uri: author.avatarUrl }}
          placeholder={BLURHASH_PLACEHOLDERS.NEUTRAL}
          placeholderContentFit="cover"
          style={{ width: LINEAR_AVI_WIDTH, height: LINEAR_AVI_WIDTH, borderRadius: LINEAR_AVI_WIDTH / 2 }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={author.id}
        />
      </Pressable>

      {/* Author Info */}
      <View className="flex-1 flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-1.5 overflow-hidden">
          <Text className="font-bold text-base text-text-primary" numberOfLines={1}>
            {author.displayName}
          </Text>
          
          {author.isVerified && (
            <BadgeCheck size={16} color="#10B981" fill="#10B981" />
          )}
          
          {isExternal && (
            <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
              <Globe2 size={12} color="#3B82F6" />
              <Text className="text-xs text-blue-500 font-medium">Bluesky</Text>
            </View>
          )}
          
          <Text className="text-text-muted text-sm flex-shrink" numberOfLines={1}>
            @{author.handle} · {timeAgo}
          </Text>
        </View>

        <Pressable className="p-1 active:opacity-70" onPress={onMorePress}>
          <MoreHorizontal size={16} color="#6B7280" />
        </Pressable>
      </View>
    </View>
  );
});

// =====================================================
// Repost Header
// =====================================================

interface RepostHeaderProps {
  repostedBy: RepostInfo;
  onPress?: () => void;
}

const RepostHeader = memo(function RepostHeader({ repostedBy, onPress }: RepostHeaderProps) {
  return (
    <Pressable 
      onPress={onPress}
      disabled={repostedBy.isOwnRepost}
      className="flex-row items-center mb-2 active:opacity-70"
      style={{ marginLeft: CONTENT_OFFSET }}
    >
      <Repeat2 size={14} color="#6B7280" />
      <Text className="text-xs text-text-muted ml-1.5">
        Reposted by{" "}
        <Text className="font-medium">
          {repostedBy.isOwnRepost ? "you" : repostedBy.displayName}
        </Text>
      </Text>
    </Pressable>
  );
});

// =====================================================
// Reply Context
// =====================================================

interface ReplyContextProps {
  parent: ParentInfo;
}

const ReplyContext = memo(function ReplyContext({ parent }: ReplyContextProps) {
  return (
    <View className="flex-row items-center mb-1" style={{ marginLeft: CONTENT_OFFSET }}>
      <Text className="text-xs text-text-muted">
        Replying to{" "}
        <Text className="text-primary font-medium">
          @{parent.handle}
        </Text>
      </Text>
    </View>
  );
});

// =====================================================
// Post Content
// =====================================================

interface PostContentProps {
  content: string;
}

const PostContent = memo(function PostContent({ content }: PostContentProps) {
  if (!content) return null;
  
  return (
    <Text className="text-base text-text-primary leading-6">
      {content}
    </Text>
  );
});

// =====================================================
// Quoted Post Embed
// =====================================================

interface QuoteEmbedProps {
  quote: UnifiedQuote;
  onPress?: () => void;
}

const QuoteEmbed = memo(function QuoteEmbed({ quote, onPress }: QuoteEmbedProps) {
  return (
    <Pressable 
      onPress={onPress}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-muted/5 active:bg-muted/10"
    >
      <View className="p-3 gap-2">
        {/* Quoted Author */}
        <View className="flex-row items-center gap-2">
          <Image 
            source={{ uri: quote.author.avatarUrl }} 
            style={{ width: 20, height: 20, borderRadius: 10 }} 
            contentFit="cover"
          />
          <Text className="font-bold text-sm text-text-primary" numberOfLines={1}>
            {quote.author.displayName}
          </Text>
          
          {quote.isExternal && (
            <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
              <Globe2 size={10} color="#3B82F6" />
              <Text className="text-xs text-blue-500 font-medium">Bluesky</Text>
            </View>
          )}
          
          <Text className="text-text-muted text-xs">
            @{quote.author.handle}
          </Text>
        </View>
        
        {/* Quoted Content */}
        <Text className="text-sm text-text-primary" numberOfLines={4}>
          {quote.content}
        </Text>
        
        {/* Quoted Images */}
        {quote.images && quote.images.length > 0 && (
          <View 
            className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-elevated"
            style={{ aspectRatio: ASSET_RATIOS.VIDEO }}
          >
            <Image
              source={{ uri: quote.images[0] }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={300}
              placeholder={BLURHASH_PLACEHOLDERS.NEUTRAL}
              cachePolicy="memory-disk"
            />
          </View>
        )}
      </View>
    </Pressable>
  );
});

// =====================================================
// Embed Renderer
// =====================================================

interface EmbedRendererProps {
  embed: UnifiedEmbed;
  postUri: string;
  isExternal: boolean;
  onQuotePress?: () => void;
}

const EmbedRenderer = memo(function EmbedRenderer({ 
  embed, 
  postUri,
  isExternal,
  onQuotePress,
}: EmbedRendererProps) {
  switch (embed.type) {
    case "images":
      return embed.images && embed.images.length > 0 ? (
        <PostCarousel 
          mediaUrls={embed.images} 
          isFederated={isExternal}
        />
      ) : null;

    case "video":
      return embed.videoUrl ? (
        <View className="mt-3">
          <VideoPlayer
            url={embed.videoUrl}
            thumbnailUrl={embed.videoThumbnail}
            aspectRatio={16/9}
          />
        </View>
      ) : null;

    case "quote":
      return embed.quote ? (
        <QuoteEmbed quote={embed.quote} onPress={onQuotePress} />
      ) : null;

    case "external":
      // External link card
      return embed.externalUrl ? (
        <Pressable 
          className="mt-3 overflow-hidden rounded-xl border border-border bg-muted/5"
        >
          {embed.externalThumb && (
            <Image
              source={{ uri: embed.externalThumb }}
              style={{ width: "100%", height: 150 }}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          )}
          <View className="p-3">
            <Text className="text-sm font-semibold text-text-primary" numberOfLines={2}>
              {embed.externalTitle}
            </Text>
            {embed.externalDescription && (
              <Text className="text-xs text-text-muted mt-1" numberOfLines={2}>
                {embed.externalDescription}
              </Text>
            )}
            <Text className="text-xs text-text-muted mt-1">
              {new URL(embed.externalUrl).hostname}
            </Text>
          </View>
        </Pressable>
      ) : null;

    default:
      return null;
  }
});

// =====================================================
// Post Controls (Action Bar)
// =====================================================

interface PostControlsProps {
  post: UnifiedPost;
  onReply?: () => void;
  onRepost?: () => void;
  onLike?: () => void;
  onShare?: () => void;
  isLikeLoading?: boolean;
  isRepostLoading?: boolean;
}

const PostControls = memo(function PostControls({
  post,
  onReply,
  onRepost,
  onLike,
  onShare,
  isLikeLoading,
  isRepostLoading,
}: PostControlsProps) {
  const totalReposts = post.repostCount + post.quoteCount;
  const isActive = post.viewer.isReposted || post.viewer.isQuoted;

  return (
    <View 
      className="flex-row items-center justify-between mt-3 pr-4"
      style={{ marginLeft: CONTENT_OFFSET }}
    >
      {/* Reply */}
      <ActionButton 
        icon={MessageCircle} 
        count={post.replyCount} 
        onPress={onReply}
        accessibilityLabel={`Reply. ${post.replyCount} replies`}
      />
      
      {/* Repost */}
      <ActionButton 
        icon={Repeat2} 
        count={totalReposts} 
        active={isActive} 
        activeColor="#10B981"
        onPress={onRepost}
        hapticStyle="medium"
        disabled={isRepostLoading}
        accessibilityLabel={`${isActive ? "Undo repost" : "Repost"}. ${totalReposts} reposts`}
      />
      
      {/* Like */}
      <ActionButton 
        icon={Heart} 
        count={post.likeCount} 
        active={post.viewer.isLiked} 
        activeColor="#EF4444"
        onPress={onLike}
        hapticStyle="light"
        fill={true}
        disabled={isLikeLoading}
        accessibilityLabel={`${post.viewer.isLiked ? "Unlike" : "Like"}. ${post.likeCount} likes`}
      />
      
      {/* Share */}
      <ActionButton 
        icon={Share} 
        onPress={onShare}
        accessibilityLabel="Share post"
      />
    </View>
  );
});

// =====================================================
// Main UnifiedPostCard Component
// =====================================================

export interface UnifiedPostCardProps {
  post: UnifiedPost;
  onPress?: () => void;
  onAuthorPress?: () => void;
  onReply?: () => void;
  onRepost?: () => void;
  onLike?: () => void;
  onShare?: () => void;
  onMore?: () => void;
  onQuotePress?: (quoteUri: string) => void;
  onRepostedByPress?: (handle: string) => void;
  showReplyContext?: boolean;
  isLikeLoading?: boolean;
  isRepostLoading?: boolean;
}

export const UnifiedPostCard = memo(function UnifiedPostCard({
  post,
  onPress,
  onAuthorPress,
  onReply,
  onRepost,
  onLike,
  onShare,
  onMore,
  onQuotePress,
  onRepostedByPress,
  showReplyContext = true,
  isLikeLoading = false,
  isRepostLoading = false,
}: UnifiedPostCardProps) {
  const router = useRouter();

  // Default navigation handlers
  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    } else if (post.isExternal) {
      router.push({
        pathname: "/federated/post",
        params: { uri: post.uri }
      } as any);
    } else if (post.localId) {
      router.push(`/post/${post.localId}` as any);
    }
  }, [onPress, post.uri, post.localId, post.isExternal, router]);

  const handleAuthorPress = useCallback(() => {
    if (onAuthorPress) {
      onAuthorPress();
    } else {
      // Use unified profile routing
      router.push(`/user/${post.author.handle}` as any);
    }
  }, [onAuthorPress, post.author.handle, router]);

  const handleQuotePress = useCallback(() => {
    const quote = post.embed?.quote;
    if (!quote) return;
    
    if (onQuotePress) {
      onQuotePress(quote.uri);
    } else if (quote.isExternal) {
      router.push({
        pathname: "/federated/post",
        params: { uri: quote.uri }
      } as any);
    } else {
      // Extract local ID from cannect:// URI
      const localId = quote.uri.replace("cannect://post/", "");
      router.push(`/post/${localId}` as any);
    }
  }, [post.embed?.quote, onQuotePress, router]);

  const handleRepostedByPress = useCallback(() => {
    if (!post.repostedBy || post.repostedBy.isOwnRepost) return;
    
    if (onRepostedByPress) {
      onRepostedByPress(post.repostedBy.handle);
    } else {
      router.push(`/user/${post.repostedBy.handle}` as any);
    }
  }, [post.repostedBy, onRepostedByPress, router]);

  return (
    <Pressable onPress={handlePress}>
      <PostOuter>
        {/* Repost Header */}
        {post.repostedBy && (
          <RepostHeader 
            repostedBy={post.repostedBy} 
            onPress={handleRepostedByPress}
          />
        )}

        {/* Reply Context */}
        {showReplyContext && post.parent && (
          <ReplyContext parent={post.parent} />
        )}

        {/* Meta Row (Avatar + Author) */}
        <PostMeta
          author={post.author}
          createdAt={post.createdAt}
          isExternal={post.isExternal}
          source={post.source}
          onAuthorPress={handleAuthorPress}
          onMorePress={onMore}
        />

        {/* Content Area */}
        <View style={{ marginLeft: CONTENT_OFFSET, marginTop: 4 }}>
          <PostContent content={post.content} />
          
          {/* Embed (images/video/quote) */}
          {post.embed && (
            <EmbedRenderer
              embed={post.embed}
              postUri={post.uri}
              isExternal={post.isExternal}
              onQuotePress={handleQuotePress}
            />
          )}
        </View>

        {/* Action Bar */}
        <PostControls
          post={post}
          onReply={onReply}
          onRepost={onRepost}
          onLike={onLike}
          onShare={onShare}
          isLikeLoading={isLikeLoading}
          isRepostLoading={isRepostLoading}
        />
      </PostOuter>
    </Pressable>
  );
}, (prevProps, nextProps) => {
  // Optimized comparison for re-renders
  return (
    prevProps.post.uri === nextProps.post.uri &&
    prevProps.post.viewer.isLiked === nextProps.post.viewer.isLiked &&
    prevProps.post.viewer.isReposted === nextProps.post.viewer.isReposted &&
    prevProps.post.viewer.isQuoted === nextProps.post.viewer.isQuoted &&
    prevProps.post.likeCount === nextProps.post.likeCount &&
    prevProps.post.replyCount === nextProps.post.replyCount &&
    prevProps.post.repostCount === nextProps.post.repostCount &&
    prevProps.post.quoteCount === nextProps.post.quoteCount &&
    prevProps.isLikeLoading === nextProps.isLikeLoading &&
    prevProps.isRepostLoading === nextProps.isRepostLoading
  );
});

// Sub-components kept internal to avoid conflicts with SocialPost exports
