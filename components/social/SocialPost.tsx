import { View, Text, Pressable, type ViewProps, Platform, Animated, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, BadgeCheck, Globe2 } from "lucide-react-native";
import React, { useRef, memo, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/utils/date";
import { ASSET_RATIOS, BLURHASH_PLACEHOLDERS } from "@/lib/utils/assets";
import { PostCarousel } from "./PostCarousel";
import { PostShareCard } from "./PostShareCard";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { HydrationSafeText } from "@/components/ui/HydrationSafeText";
import { useShareSnapshot } from "@/lib/hooks/use-share-snapshot";
import { useAuthStore } from "@/lib/stores";
import type { PostWithAuthor } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Primitive Slots (Reusable Building Blocks)
// ---------------------------------------------------------------------------

const PostRoot = ({ className, ...props }: ViewProps) => (
  <View className={cn("border-b border-border bg-background px-4 py-3", className)} {...props} />
);

const PostHeader = ({ className, ...props }: ViewProps) => (
  <View className={cn("flex-row items-start gap-3", className)} {...props} />
);

const PostContent = ({ className, ...props }: ViewProps) => (
  <View className={cn("ml-[52px] mt-1", className)} {...props} />
);

const QuoteContainer = ({ children, onPress }: { children: React.ReactNode, onPress?: () => void }) => (
  <Pressable 
    onPress={onPress}
    className="mt-3 overflow-hidden rounded-2xl border border-border bg-muted/5 active:bg-muted/10"
  >
    {children}
  </Pressable>
);

const PostFooter = ({ className, ...props }: ViewProps) => (
  <View className={cn("ml-[52px] mt-3 flex-row items-center justify-between pr-4", className)} {...props} />
);

interface ActionButtonProps {
  icon: React.ComponentType<any>;
  count?: number;
  active?: boolean;
  activeColor?: string;
  onPress?: () => void;
  hapticStyle?: "light" | "medium" | "success";
  fill?: boolean;
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
  accessibilityLabel,
}: ActionButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
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
  }, [onPress, hapticStyle, scaleAnim]);

  return (
    <Pressable 
      onPress={handlePress} 
      className="flex-row items-center gap-1.5 p-1 -ml-2 active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Icon 
          size={18} 
          color={active ? activeColor : "#6B7280"} 
          strokeWidth={2}
          fill={fill && active ? activeColor : "transparent"}
        />
      </Animated.View>
      {count !== undefined && count > 0 && (
        <Text className="text-sm font-medium" style={{ color: active ? activeColor : "#6B7280" }}>
          {count}
        </Text>
      )}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Main SocialPost Component (CLEANED UP - No Import Logic)
// ---------------------------------------------------------------------------

interface SocialPostProps {
  post: PostWithAuthor;
  onLike?: () => void;
  onReply?: () => void;
  onRepost?: () => void;
  onProfilePress?: () => void;
  onPress?: () => void;
  onMore?: () => void;
  onShare?: () => void;
  onQuotedPostPress?: (quotedPostId: string) => void;
  showThreadContext?: boolean;
  onRepostedByPress?: (username: string) => void;
}

export const SocialPost = memo(function SocialPost({ 
  post, 
  onLike, 
  onReply, 
  onRepost, 
  onProfilePress,
  onPress,
  onMore,
  onShare,
  onQuotedPostPress,
  showThreadContext = true,
  onRepostedByPress,
}: SocialPostProps) {
  const { shareRef, captureAndShare, isCapturing, shouldRenderCard } = useShareSnapshot();
  const { user } = useAuthStore();

  // Check if the reposter is the current user
  const isOwnRepost = (post as any).reposted_by?.id === user?.id;

  const handleShare = useCallback(() => {
    if (onShare) {
      onShare();
    } else {
      captureAndShare(
        post.id,
        post.author?.username ?? undefined,
        post.content ?? undefined
      );
    }
  }, [onShare, captureAndShare, post.id, post.author?.username, post.content]);

  // Check if post is from federated source (has at_uri from external network)
  const isFederated = !!(post as any).at_uri && !(post as any).at_uri?.includes('cannect.space');
  
  // Check for valid quoted post
  const hasQuotedPost = post.type === 'quote' && post.quoted_post?.id && post.quoted_post?.content;

  // Author info with fallbacks
  const displayName = post.author?.display_name || post.author?.username || "User";
  const avatarUrl = post.author?.avatar_url || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff`;

  // ---------------------------------------------------------------------------
  // Render Quoted Post (if this is a quote)
  // ---------------------------------------------------------------------------
  const renderQuotedContent = () => {
    if (!hasQuotedPost) return null;

    const quoted = post.quoted_post!;
    const quotedIsFederated = !!(quoted as any).at_uri && !(quoted as any).at_uri?.includes('cannect.space');

    return (
      <QuoteContainer onPress={() => onQuotedPostPress?.(quoted.id)}>
        <View className="p-3 gap-2">
          <View className="flex-row items-center gap-2">
            <Image 
              source={{ uri: quoted.author?.avatar_url || `https://ui-avatars.com/api/?name=${quoted.author?.username || "U"}&background=10B981&color=fff` }} 
              style={{ width: 20, height: 20, borderRadius: 10 }} 
            />
            <Text className="font-bold text-sm text-text-primary" numberOfLines={1}>
              {quoted.author?.display_name || quoted.author?.username || "Unknown"}
            </Text>
            {quotedIsFederated && (
              <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
                <Globe2 size={10} color="#3B82F6" />
                <Text className="text-xs text-blue-500 font-medium">Bluesky</Text>
              </View>
            )}
            <Text className="text-text-muted text-xs">
              @{quoted.author?.username || "user"}
            </Text>
          </View>
          
          <Text className="text-sm text-text-primary" numberOfLines={4}>
            {quoted.content}
          </Text>
          
          {quoted.media_urls && quoted.media_urls.length > 0 && (
            <View 
              className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-elevated"
              style={{ aspectRatio: ASSET_RATIOS.VIDEO }}
            >
              <Image
                source={{ uri: quoted.media_urls[0] }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={300}
                placeholder={BLURHASH_PLACEHOLDERS.NEUTRAL}
                cachePolicy="memory-disk"
              />
            </View>
          )}
        </View>
      </QuoteContainer>
    );
  };

  return (
    <Pressable onPress={onPress}>
      <PostRoot>
        {/* Reposted by header */}
        {(post as any).reposted_by && (
          <Pressable 
            onPress={() => !isOwnRepost && onRepostedByPress?.((post as any).reposted_by?.username || '')}
            className="flex-row items-center mb-2 ml-[52px] active:opacity-70"
          >
            <Repeat2 size={14} color="#6B7280" />
            <Text className="text-xs text-text-muted ml-1.5">
              Reposted by{" "}
              <Text className="font-medium">
                {isOwnRepost ? 'you' : ((post as any).reposted_by.display_name || `@${(post as any).reposted_by.username}`)}
              </Text>
            </Text>
          </Pressable>
        )}

        {/* Thread Context */}
        {showThreadContext && post.is_reply && post.parent_post?.author?.username && (
          <View className="flex-row items-center mb-1 ml-[52px]">
            <Text className="text-xs text-text-muted">
              Replying to{" "}
              <Text className="text-primary font-medium">
                @{post.parent_post.author.username}
              </Text>
            </Text>
          </View>
        )}

        <PostHeader>
          {/* Avatar */}
          <Pressable 
            onPress={onProfilePress} 
            className="active:opacity-80"
            accessibilityRole="button"
            accessibilityLabel={`View ${displayName}'s profile`}
          >
            <Image
              source={{ uri: avatarUrl }}
              style={{ width: 40, height: 40, borderRadius: 20 }}
              contentFit="cover"
              transition={200}
            />
          </Pressable>

          {/* User Info */}
          <View className="flex-1 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-1.5 overflow-hidden">
              <Text className="font-bold text-base text-text-primary" numberOfLines={1}>
                {displayName}
              </Text>
              {post.author?.is_verified && (
                <BadgeCheck size={16} color="#10B981" fill="#10B981" />
              )}
              {isFederated && (
                <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
                  <Globe2 size={12} color="#3B82F6" />
                  <Text className="text-xs text-blue-500 font-medium">Bluesky</Text>
                </View>
              )}
              <Text className="text-text-muted text-sm flex-shrink" numberOfLines={1}>
                @{post.author?.username || "user"} ·{" "}
                <HydrationSafeText fallback="...">
                  {formatDistanceToNow(new Date(post.created_at))}
                </HydrationSafeText>
              </Text>
            </View>
            <Pressable className="p-1 active:opacity-70" onPress={onMore}>
              <MoreHorizontal size={16} color="#6B7280" />
            </Pressable>
          </View>
        </PostHeader>

        <PostContent>
          {/* Text Content */}
          {post.content && (
            <Text className="text-base text-text-primary leading-6">
              {post.content}
            </Text>
          )}

          {/* Quoted Post */}
          {renderQuotedContent()}

          {/* Media Carousel */}
          {!hasQuotedPost && post.media_urls && post.media_urls.length > 0 && (
            <PostCarousel 
              mediaUrls={post.media_urls} 
              isFederated={isFederated}
            />
          )}

          {/* Video Player */}
          {!hasQuotedPost && post.video_url && (
            <View className="mt-3">
              <VideoPlayer
                url={post.video_url}
                thumbnailUrl={post.video_thumbnail_url || undefined}
                aspectRatio={16/9}
              />
            </View>
          )}
        </PostContent>

        {/* Action Bar - ALL INTERACTIONS ALWAYS ENABLED */}
        <PostFooter>
          <ActionButton 
            icon={MessageCircle} 
            count={post.replies_count} 
            onPress={onReply}
            accessibilityLabel={`Reply. ${post.replies_count || 0} replies`}
          />
          <ActionButton 
            icon={Repeat2} 
            count={(post.reposts_count || 0) + ((post as any).quotes_count || 0)} 
            active={post.is_reposted_by_me === true || (post as any).is_quoted_by_me === true} 
            activeColor="#10B981"
            onPress={onRepost}
            hapticStyle="medium"
            accessibilityLabel={`${post.is_reposted_by_me || (post as any).is_quoted_by_me ? 'Undo repost' : 'Repost'}. ${(post.reposts_count || 0) + ((post as any).quotes_count || 0)} reposts`}
          />
          <ActionButton 
            icon={Heart} 
            count={post.likes_count} 
            active={post.is_liked} 
            activeColor="#EF4444"
            onPress={onLike}
            hapticStyle="light"
            fill={true}
            accessibilityLabel={`${post.is_liked ? 'Unlike' : 'Like'}. ${post.likes_count || 0} likes`}
          />
          {isCapturing ? (
            <View className="flex-row items-center gap-1.5 p-1 -ml-2">
              <ActivityIndicator size="small" color="#6B7280" />
            </View>
          ) : (
            <ActionButton 
              icon={Share} 
              onPress={handleShare}
              accessibilityLabel="Share post"
            />
          )}
        </PostFooter>
      </PostRoot>

      {/* Share Card (off-screen for capture) */}
      {shouldRenderCard && Platform.OS !== 'web' && (
        <View 
          collapsable={false} 
          style={{ position: 'absolute', top: -9999, left: -9999 }}
          pointerEvents="none"
        >
          <View ref={shareRef} collapsable={false}>
            <PostShareCard post={post} />
          </View>
        </View>
      )}
    </Pressable>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.post.id === nextProps.post.id &&
    prevProps.post.is_liked === nextProps.post.is_liked &&
    prevProps.post.is_reposted_by_me === nextProps.post.is_reposted_by_me &&
    (prevProps.post as any).is_quoted_by_me === (nextProps.post as any).is_quoted_by_me &&
    prevProps.post.likes_count === nextProps.post.likes_count &&
    prevProps.post.replies_count === nextProps.post.replies_count &&
    prevProps.post.reposts_count === nextProps.post.reposts_count &&
    (prevProps.post as any).quotes_count === (nextProps.post as any).quotes_count
  );
});

export { PostRoot, PostHeader, PostContent, PostFooter, ActionButton };
