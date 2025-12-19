import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { Heart, MessageCircle, Repeat2, MoreHorizontal, ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "@/lib/utils/date";
import { BLURHASH_PLACEHOLDERS } from "@/lib/utils/assets";
import { PostCarousel } from "./PostCarousel";

// ✅ Diamond Standard: Design tokens for thread alignment
const THREAD_AVATAR_SIZE = 36;
const THREAD_LINE_OFFSET = THREAD_AVATAR_SIZE / 2; // 18px - centers line on avatar

interface Author {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  author: Author;
  likes_count?: number;
  replies_count?: number;
  reposts_count?: number; // ✅ Everything is a Post: Comments can be reposted
  is_liked?: boolean;
  is_reposted_by_me?: boolean;
  media_urls?: string[]; // ✅ Asset Guard: Support for media in replies
  is_optimistic?: boolean; // ✅ Diamond Standard: Optimistic update flag
}

interface ThreadCommentProps {
  comment: Comment;
  isLast?: boolean;
  isReply?: boolean;
  showLine?: boolean; // ✅ Diamond Standard: Control thread line visibility
  onReplyPress?: () => void;
  onLikePress?: () => void;
  onRepostPress?: () => void; // ✅ Everything is a Post: Repost promotes comment to top-level
  onProfilePress?: () => void;
  onPivot?: () => void; // Navigate to make this comment the main post
}

export function ThreadComment({ 
  comment, 
  isLast = false, 
  isReply = false,
  showLine = true,
  onReplyPress,
  onLikePress,
  onRepostPress,
  onProfilePress,
  onPivot
}: ThreadCommentProps) {
  const router = useRouter();
  const avatarUrl = comment.author?.avatar_url || 
    `https://ui-avatars.com/api/?name=${comment.author?.username || "U"}&background=10B981&color=fff`;

  // ✅ Diamond Standard: Optimistic "ghost" state
  const isSyncing = comment.is_optimistic === true;

  // Pivot: Navigate to this comment as the "main post" of a new thread view
  const handlePivot = () => {
    if (onPivot) {
      onPivot();
    } else {
      router.push(`/post/${comment.id}` as any);
    }
  };

  return (
    <Pressable 
      onPress={handlePivot}
      disabled={isSyncing}
      className={cn(
        "flex-row px-4 bg-background active:bg-surface/50", 
        isReply && "pl-8",
        isSyncing && "opacity-50" // Ghost state for optimistic updates
      )}
    >
      {/* Left Column: Avatar + Connector Line */}
      <View className="items-center mr-3">
        <Pressable onPress={onProfilePress}>
          <Image
            source={{ uri: avatarUrl }}
            style={{ 
              width: THREAD_AVATAR_SIZE, 
              height: THREAD_AVATAR_SIZE, 
              borderRadius: THREAD_AVATAR_SIZE / 2 
            }}
            contentFit="cover"
          />
        </Pressable>
        
        {/* The Connector Line - shows thread connection */}
        {showLine && !isLast && (
          <View className="flex-1 w-[2px] bg-border my-2 rounded-full" />
        )}
      </View>

      {/* Right Column: Content */}
      <View className={cn("flex-1 pb-4", !isLast && "border-b border-border/30")}>
        {/* Header */}
        <View className="flex-row justify-between items-center mb-1">
          <View className="flex-row items-center gap-2 flex-1">
            <Pressable onPress={onProfilePress}>
              <Text className="font-bold text-text-primary text-sm">
                {comment.author?.display_name || comment.author?.username || "Unknown"}
              </Text>
            </Pressable>
            <Text className="text-text-muted text-xs">
              @{comment.author?.username || "user"}
            </Text>
            {isSyncing ? (
              <Text className="text-[10px] text-primary font-bold ml-1">
                SENDING...
              </Text>
            ) : (
              <Text className="text-text-muted text-xs">
                ·{" "}
                <Text suppressHydrationWarning>
                  {formatDistanceToNow(new Date(comment.created_at))}
                </Text>
              </Text>
            )}
          </View>
          <Pressable className="p-1 active:opacity-70">
            <MoreHorizontal size={16} color="#6B7280" />
          </Pressable>
        </View>

        {/* Body */}
        <Text className="text-text-primary text-base leading-5 mb-3">
          {comment.content}
        </Text>

        {/* ✅ Diamond Standard: Dynamic aspect ratio carousel */}
        {comment.media_urls && comment.media_urls.length > 0 && (
          <View className="mb-3">
            <PostCarousel mediaUrls={comment.media_urls} />
          </View>
        )}

        {/* Actions */}
        <View className="flex-row gap-6">
          <Pressable 
            onPress={(e) => { e.stopPropagation(); onReplyPress?.(); }}
            className="flex-row items-center gap-1.5 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Reply"
          >
            <MessageCircle size={16} color="#6B7280" />
            {/* Show count next to reply icon */}
            {(comment.replies_count ?? 0) > 0 && (
              <Text className="text-xs font-medium text-text-muted">
                {comment.replies_count}
              </Text>
            )}
          </Pressable>

          {/* ✅ Everything is a Post: Repost promotes this comment to a top-level post */}
          <Pressable 
            onPress={(e) => { e.stopPropagation(); onRepostPress?.(); }}
            className="flex-row items-center gap-1.5 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Repost"
          >
            <Repeat2 
              size={16} 
              color={comment.is_reposted_by_me ? "#10B981" : "#6B7280"}
            />
            {(comment.reposts_count ?? 0) > 0 && (
              <Text className={cn(
                "text-xs font-medium",
                comment.is_reposted_by_me ? "text-primary" : "text-text-muted"
              )}>
                {comment.reposts_count}
              </Text>
            )}
          </Pressable>

          <Pressable 
            onPress={(e) => { e.stopPropagation(); onLikePress?.(); }}
            className="flex-row items-center gap-1.5 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Like"
          >
            <Heart 
              size={16} 
              color={comment.is_liked ? "#EF4444" : "#6B7280"}
              fill={comment.is_liked ? "#EF4444" : "transparent"}
            />
            {(comment.likes_count ?? 0) > 0 && (
              <Text className={cn(
                "text-xs font-medium",
                comment.is_liked ? "text-red-500" : "text-text-muted"
              )}>
                {comment.likes_count}
              </Text>
            )}
          </Pressable>

          {/* Gold Standard: View Thread pivot - portal into deeper replies */}
          {(comment.replies_count ?? 0) > 0 && (
            <Pressable 
              onPress={(e) => { e.stopPropagation(); handlePivot(); }}
              className="flex-1 items-end"
            >
              <View className="flex-row items-center gap-1 px-3 py-1 rounded-full bg-primary/10 active:bg-primary/20">
                <Text className="text-[10px] font-bold text-primary uppercase tracking-wider">View Thread</Text>
                <ChevronRight size={12} color="#10B981" />
              </View>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// Connector line component for between main post and comments
export function ThreadConnector() {
  return (
    <View className="px-4 py-2">
      <View 
        style={{ marginLeft: THREAD_LINE_OFFSET }} 
        className="w-[2px] h-4 bg-border rounded-full" 
      />
    </View>
  );
}
