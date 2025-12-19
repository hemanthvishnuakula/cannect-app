import { View, Text, Pressable, type ViewProps, Platform, Animated, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, BadgeCheck, Globe2, Loader2 } from "lucide-react-native";
import React, { useRef, memo, useCallback } from "react";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/utils/date";
import { ASSET_RATIOS, BLURHASH_PLACEHOLDERS } from "@/lib/utils/assets";
import { PostCarousel } from "./PostCarousel";
import { PostShareCard } from "./PostShareCard";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { useShareSnapshot } from "@/lib/hooks/use-share-snapshot";
import type { PostWithAuthor, isFederatedPost, hasExternalMetadata } from "@/lib/types/database";

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
  fill?: boolean; // Fill icon when active (for hearts)
  /** Accessibility label for screen readers */
  accessibilityLabel?: string;
}

const ActionButton = memo(function ActionButton({ 
  icon: Icon, 
  count, 
  active, 
  activeColor = "#EF4444", // red-500
  onPress,
  hapticStyle = "light",
  fill = false,
  accessibilityLabel,
}: ActionButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    // ✅ Diamond Standard: Haptic feedback
    if (Platform.OS !== "web") {
      if (hapticStyle === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (hapticStyle === "medium") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }

    // ✅ Diamond Standard: Micro bounce animation
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
// Main SocialPost Component
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
  /** Show "Replying to @username" context (useful for Replies tab in profile) */
  showThreadContext?: boolean;
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
}: SocialPostProps) {
  // =====================================================
  // SHARE SNAPSHOT HOOK
  // =====================================================
  const { shareRef, captureAndShare, isCapturing, shouldRenderCard } = useShareSnapshot();

  // Handle share - use snapshot share if no custom handler provided
  const handleShare = useCallback(() => {
    if (onShare) {
      onShare();
    } else {
      // Pass post info for web share fallback
      captureAndShare(
        post.id,
        post.author?.username,
        post.content || undefined
      );
    }
  }, [onShare, captureAndShare, post.id, post.author?.username, post.content]);

  // Check if quoted_post is valid (has actual data, not just an empty object from the join)
  const hasValidQuotedPost = post.quoted_post && post.quoted_post.id && post.quoted_post.content;
  
  // =====================================================
  // INTERACTION CAPTURE LOGIC (Type-safe)
  // =====================================================
  
  // 1. Live Global = Data fetched directly from Bluesky API (Read-only except repost)
  const isLiveGlobal = 'is_federated' in post && post.is_federated === true;
  
  // 2. Cannect Repost of Global = Data from Supabase referencing Bluesky (FULLY INTERACTIVE!)
  //    These have a real post.id in our database, so likes/comments work
  const isCannectRepostOfGlobal = 'external_id' in post && 'external_metadata' in post && !!post.external_metadata;
  const externalData = isCannectRepostOfGlobal ? (post as any).external_metadata : null;
  
  // Store type for later use (avoids TypeScript narrowing issues)
  const postType = post.type;
  
  // Handle Simple Repost: Only show repost UI when type is explicitly 'repost'
  // Quote posts (type='quote') have is_repost=true but should NOT show the "reposted" banner
  const isSimpleRepost = post.type === 'repost' && (hasValidQuotedPost || isCannectRepostOfGlobal);
  
  // For external reposts, construct a virtual quoted_post from the metadata
  const virtualQuotedPost = isCannectRepostOfGlobal && externalData ? {
    id: 'external_id' in post ? post.external_id : undefined,
    content: externalData?.content,
    created_at: externalData?.created_at,
    media_urls: externalData?.media_urls,
    author: externalData?.author,
    is_federated: true, // Mark as federated for badge display
  } : null;
  
  // If it's a simple repost, we effectively "swap" the post to be the quoted one,
  // but keep the "reposted by" context.
  // Note: displayPost can be the original post, quoted_post, or a virtual object,
  // so we use `any` here for flexibility with the complex union types
  const displayPost: any = isSimpleRepost 
    ? (virtualQuotedPost || post.quoted_post) 
    : post;
  const reposter = isSimpleRepost ? post.author : null;

  // Fix: Standardize fallback to match registration logic (using encoded display_name)
  const displayName = displayPost?.author?.display_name || displayPost?.author?.username || "User";
  const avatarUrl = displayPost?.author?.avatar_url || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff`;
  
  // Check if the displayed content is from an external source (for badge display)
  const displayedIsFederated = isLiveGlobal || (displayPost as any)?.is_federated === true;
  
  // =====================================================
  // INTERACTION RULES:
  // - isLiveGlobal: Only Repost enabled (to "capture" into Cannect)
  // - isCannectRepostOfGlobal: ALL interactions enabled (it's OUR data now!)
  // - Regular posts: ALL interactions enabled
  // =====================================================
  const interactionsDisabled = isLiveGlobal && !isCannectRepostOfGlobal;
  
  // =====================================================
  // RECURSIVE UI GUARD - renderQuotedContent()
  // Prevents infinite nesting by only rendering ONE level of quotes
  // =====================================================
  const renderQuotedContent = () => {
    // Live Global items don't show nested quotes in the feed
    if (isLiveGlobal) return null;
    
    // Simple reposts swap the display - quote already shown as main content
    if (isSimpleRepost) return null;
    
    // Shadow Repost of external content (Bluesky snapshot)
    if (isCannectRepostOfGlobal && externalData && postType === 'quote') {
      return (
        <QuoteContainer onPress={() => {}}>
          <View className="p-3 gap-2">
            <View className="flex-row items-center gap-2">
              <Image 
                source={{ uri: externalData.author?.avatar_url || `https://ui-avatars.com/api/?name=${externalData.author?.display_name || externalData.author?.handle || "U"}&background=3B82F6&color=fff` }} 
                style={{ width: 20, height: 20, borderRadius: 10 }} 
              />
              <Text className="font-bold text-sm text-text-primary" numberOfLines={1}>
                {externalData.author?.display_name || externalData.author?.handle || "Unknown"}
              </Text>
              <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
                <Globe2 size={10} color="#3B82F6" />
                <Text className="text-xs text-blue-500 font-medium">Global</Text>
              </View>
            </View>
            <Text className="text-sm text-text-primary">
              {externalData.content}
            </Text>
            {/* ✅ ASSET GUARD: Fixed ratio for quoted Global post media */}
            {externalData.media_urls && externalData.media_urls.length > 0 && (
              <View 
                className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-elevated"
                style={{ aspectRatio: ASSET_RATIOS.VIDEO }}
              >
                <Image
                  source={{ uri: externalData.media_urls[0] }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  transition={300}
                  placeholder={BLURHASH_PLACEHOLDERS.GLOBAL}
                  cachePolicy="memory-disk"
                />
              </View>
            )}
          </View>
        </QuoteContainer>
      );
    }
    
    // Internal Cannect quote post
    if (hasValidQuotedPost && displayPost === post) {
      return (
        <QuoteContainer onPress={() => {
          onQuotedPostPress?.(displayPost.quoted_post?.id);
        }}>
          <View className="p-3 gap-2">
            <View className="flex-row items-center gap-2">
              <Image 
                source={{ uri: displayPost.quoted_post.author?.avatar_url || `https://ui-avatars.com/api/?name=${displayPost.quoted_post.author?.username || "U"}&background=10B981&color=fff` }} 
                style={{ width: 20, height: 20, borderRadius: 10 }} 
              />
              <Text className="font-bold text-sm text-text-primary" numberOfLines={1}>
                {displayPost.quoted_post.author?.display_name || displayPost.quoted_post.author?.username || "Unknown"}
              </Text>
              {/* CIRCULAR REFERENCE GUARD: Show badge if quoted post is itself a quote */}
              {displayPost.quoted_post.quoted_post_id && (
                <Pressable 
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onQuotedPostPress?.(displayPost.quoted_post.id);
                  }}
                  className="bg-primary/20 px-1.5 py-0.5 rounded active:bg-primary/30"
                >
                  <Text className="text-xs text-primary font-medium">Quote ↗</Text>
                </Pressable>
              )}
              <Text className="text-text-muted text-xs">
                @{displayPost.quoted_post.author?.username || "user"}
              </Text>
            </View>
            {/* Only show quoted post's own content - NEVER render nested quoted_post */}
            <Text className="text-sm text-text-primary">
              {displayPost.quoted_post.content}
            </Text>
            {/* ✅ ASSET GUARD: Fixed ratio for quoted Cannect post media */}
            {displayPost.quoted_post.media_urls && displayPost.quoted_post.media_urls.length > 0 && (
              <View 
                className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-elevated"
                style={{ aspectRatio: ASSET_RATIOS.VIDEO }}
              >
                <Image
                  source={{ uri: displayPost.quoted_post.media_urls[0] }}
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
    }
    
    return null;
  };

  return (
    <Pressable onPress={onPress}>
      <PostRoot>
        {/* ✅ Edge Case: Repost of deleted post - show graceful fallback */}
        {isSimpleRepost && !displayPost && (
          <View className="p-4 opacity-60">
            <View className="flex-row items-center gap-2 mb-2">
              <Repeat2 size={14} color="#6B7280" />
              <Text className="text-xs font-medium text-text-muted">
                {post.author?.display_name || post.author?.username} reposted
              </Text>
            </View>
            <Text className="text-text-muted italic">
              This post is no longer available
            </Text>
          </View>
        )}

        {/* Normal post rendering - only when displayPost exists */}
        {displayPost && (
          <>
        {reposter && (
          <View className="flex-row items-center gap-2 mb-2 ml-[52px]">
            <Repeat2 size={14} color="#6B7280" />
            <Text className="text-xs font-medium text-text-muted">
              {reposter.id === 'me' ? 'You' : reposter.display_name || reposter.username} reposted
            </Text>
          </View>
        )}

        {/* ✅ Gold Standard: Thread Context - "Replying to @username" */}
        {showThreadContext && displayPost?.is_reply && displayPost?.parent_post?.author?.username && (
          <View className="flex-row items-center mb-1 ml-[52px]">
            <Text className="text-xs text-text-muted">
              Replying to{" "}
              <Text className="text-primary font-medium">
                @{displayPost.parent_post.author.username}
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
            accessibilityLabel={`View ${displayPost?.author?.display_name || displayPost?.author?.username || 'user'}'s profile`}
          >
            <Image
              source={{ uri: avatarUrl }}
              style={{ width: 40, height: 40, borderRadius: 20 }}
              contentFit="cover"
              transition={200}
            />
          </Pressable>

          {/* User Info & Meta */}
          <View className="flex-1 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-1.5 overflow-hidden">
              <Text className="font-bold text-base text-text-primary" numberOfLines={1}>
                {displayPost?.author?.display_name || displayPost?.author?.username || "Unknown"}
              </Text>
              {displayPost?.author?.is_verified && (
                <BadgeCheck size={16} color="#10B981" fill="#10B981" />
              )}
              {displayedIsFederated && (
                <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
                  <Globe2 size={12} color="#3B82F6" />
                  <Text className="text-xs text-blue-500 font-medium">Global</Text>
                </View>
              )}
              <Text className="text-text-muted text-sm flex-shrink" numberOfLines={1}>
                @{displayPost?.author?.username || "user"} ·{" "}
                <Text suppressHydrationWarning>
                  {formatDistanceToNow(new Date(displayPost?.created_at || new Date()))}
                </Text>
              </Text>
            </View>
            <Pressable className="p-1 active:opacity-70" onPress={onMore}>
              <MoreHorizontal size={16} color="#6B7280" />
            </Pressable>
          </View>
        </PostHeader>

        <PostContent>
          {/* Text Body */}
          {displayPost.content && (
            <Text className="text-base text-text-primary leading-6">
              {displayPost.content}
            </Text>
          )}

          {/* ✅ THE GUARDED QUOTE CARD - Uses renderQuotedContent() helper */}
          {renderQuotedContent()}

          {/* ✅ DIAMOND STANDARD: Dynamic aspect ratio carousel */}
          {!displayPost.quoted_post && displayPost.media_urls && displayPost.media_urls.length > 0 && (
            <PostCarousel 
              mediaUrls={displayPost.media_urls} 
              isFederated={displayedIsFederated}
            />
          )}

          {/* ✅ DIAMOND STANDARD: Video Player (Cloudflare Stream HLS) */}
          {!displayPost.quoted_post && displayPost.video_url && (
            <View className="mt-3">
              <VideoPlayer
                url={displayPost.video_url}
                thumbnailUrl={displayPost.video_thumbnail_url || undefined}
                aspectRatio={16/9}
              />
            </View>
          )}
        </PostContent>

        <PostFooter>
          {/* 
            INTERACTION CAPTURE:
            - Live Global posts: Reply/Like disabled, Repost enabled (to capture)
            - Cannect Reposts of Global: ALL enabled (we own the data now!)
            - Regular Cannect posts: ALL enabled
            
            For Cannect Reposts, interactions are on the CANNECT post.id, 
            not the original Bluesky CID. This creates "Shadow Threads".
          */}
          <ActionButton 
            icon={MessageCircle} 
            count={isCannectRepostOfGlobal ? post.comments_count : displayPost?.comments_count} 
            onPress={interactionsDisabled ? undefined : onReply}
            accessibilityLabel={`Reply. ${isCannectRepostOfGlobal ? post.comments_count : displayPost?.comments_count || 0} replies`}
          />
          <ActionButton 
            icon={Repeat2} 
            count={isCannectRepostOfGlobal ? post.reposts_count : displayPost?.reposts_count} 
            active={post.is_reposted_by_me === true} 
            activeColor="#10B981"
            onPress={onRepost} // Always enabled - allows shadow reposting
            hapticStyle="medium"
            accessibilityLabel={`${post.is_reposted_by_me ? 'Undo repost' : 'Repost'}. ${isCannectRepostOfGlobal ? post.reposts_count : displayPost?.reposts_count || 0} reposts`}
          />
          <ActionButton 
            icon={Heart} 
            count={isCannectRepostOfGlobal ? post.likes_count : displayPost?.likes_count} 
            active={isCannectRepostOfGlobal ? post.is_liked : displayPost?.is_liked} 
            activeColor="#EF4444"
            onPress={interactionsDisabled ? undefined : onLike}
            hapticStyle="light"
            fill={true}
            accessibilityLabel={`${(isCannectRepostOfGlobal ? post.is_liked : displayPost?.is_liked) ? 'Unlike' : 'Like'}. ${isCannectRepostOfGlobal ? post.likes_count : displayPost?.likes_count || 0} likes`}
          />
          {/* Share button with loading state */}
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
          </>
        )}
      </PostRoot>

      {/* =====================================================
          GHOST CONTAINER - Off-screen Share Card (Lazy Rendered)
          Only mounts when user taps Share to reduce memory pressure.
          This is captured by react-native-view-shot to create
          a beautiful Instagram Stories-ready share image.
          collapsable={false} prevents React Native from 
          optimizing this view away before capture.
          ===================================================== */}
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
  // Custom comparison for memo - only re-render when meaningful data changes
  return (
    prevProps.post.id === nextProps.post.id &&
    prevProps.post.is_liked === nextProps.post.is_liked &&
    prevProps.post.is_reposted_by_me === nextProps.post.is_reposted_by_me &&
    prevProps.post.likes_count === nextProps.post.likes_count &&
    prevProps.post.comments_count === nextProps.post.comments_count &&
    prevProps.post.reposts_count === nextProps.post.reposts_count
  );
});

// Export primitives for custom layouts
export { PostRoot, PostHeader, PostContent, PostFooter, ActionButton };
