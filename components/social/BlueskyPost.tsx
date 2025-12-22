/**
 * BlueskyPost.tsx - Post component for external Bluesky posts
 * 
 * Similar to SocialPost but designed for posts that don't exist
 * in our local database. Uses AT Protocol URIs for interactions.
 */

import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Heart, MessageCircle, Repeat2, Share } from "lucide-react-native";
import { formatDistanceToNow } from "@/lib/utils/date";
import { 
  useHasLikedBlueskyPost, 
  useLikeBlueskyPost, 
  useUnlikeBlueskyPost,
  useHasRepostedBlueskyPost,
  useRepostBlueskyPost,
  useUnrepostBlueskyPost,
} from "@/lib/hooks/use-posts";
import { cn } from "@/lib/utils";

export interface BlueskyPostData {
  uri: string;      // AT Protocol URI
  cid: string;      // Content ID
  content: string;
  createdAt: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  images?: string[];
}

interface BlueskyPostProps {
  post: BlueskyPostData;
  onReply?: () => void;
  onShare?: () => void;
  showInteractions?: boolean;
}

export function BlueskyPost({ 
  post, 
  onReply, 
  onShare,
  showInteractions = true,
}: BlueskyPostProps) {
  const router = useRouter();
  
  // Interaction state
  const { data: isLiked } = useHasLikedBlueskyPost(post.uri);
  const { data: isReposted } = useHasRepostedBlueskyPost(post.uri);
  
  // Mutations
  const likeMutation = useLikeBlueskyPost();
  const unlikeMutation = useUnlikeBlueskyPost();
  const repostMutation = useRepostBlueskyPost();
  const unrepostMutation = useUnrepostBlueskyPost();

  const handleLike = () => {
    if (isLiked) {
      unlikeMutation.mutate(post.uri);
    } else {
      likeMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  const handleRepost = () => {
    if (isReposted) {
      unrepostMutation.mutate(post.uri);
    } else {
      repostMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  const handleAuthorPress = () => {
    router.push(`/federated/${post.author.handle}` as any);
  };

  const handleReply = () => {
    // Navigate to compose with reply context
    router.push({
      pathname: "/compose",
      params: {
        replyToUri: post.uri,
        replyToCid: post.cid,
        replyToAuthor: post.author.displayName || post.author.handle,
        replyToHandle: post.author.handle,
        replyToContent: post.content.slice(0, 100),
      }
    } as any);
  };

  const timeAgo = formatDistanceToNow(new Date(post.createdAt));

  return (
    <View className="px-4 py-3 border-b border-border">
      {/* Author Row */}
      <Pressable onPress={handleAuthorPress} className="flex-row items-center gap-3 mb-2">
        <Image
          source={{ uri: post.author.avatar || `https://ui-avatars.com/api/?name=${post.author.displayName || post.author.handle}&background=3B82F6&color=fff` }}
          style={{ width: 44, height: 44, borderRadius: 22 }}
          contentFit="cover"
        />
        <View className="flex-1">
          <Text className="text-text-primary font-semibold">
            {post.author.displayName || post.author.handle}
          </Text>
          <Text className="text-text-muted text-sm">
            @{post.author.handle} · {timeAgo}
          </Text>
        </View>
      </Pressable>

      {/* Content */}
      <Text className="text-text-primary text-base mb-2 leading-5">
        {post.content}
      </Text>

      {/* Images */}
      {post.images && post.images.length > 0 && (
        <View className="mb-2 rounded-xl overflow-hidden">
          {post.images.length === 1 ? (
            <Image
              source={{ uri: post.images[0] }}
              style={{ width: "100%", height: 200 }}
              contentFit="cover"
            />
          ) : (
            <View className="flex-row flex-wrap gap-1">
              {post.images.slice(0, 4).map((img, i) => (
                <Image
                  key={i}
                  source={{ uri: img }}
                  style={{ width: "48%", height: 120 }}
                  contentFit="cover"
                />
              ))}
            </View>
          )}
        </View>
      )}

      {/* Interactions */}
      {showInteractions && (
        <View className="flex-row items-center justify-between mt-2 pt-2">
          {/* Reply */}
          <Pressable 
            onPress={onReply || handleReply}
            className="flex-row items-center gap-1.5"
          >
            <MessageCircle size={18} color="#6B7280" />
            <Text className="text-text-muted text-sm">
              {post.replyCount || 0}
            </Text>
          </Pressable>

          {/* Repost */}
          <Pressable 
            onPress={handleRepost}
            disabled={repostMutation.isPending || unrepostMutation.isPending}
            className="flex-row items-center gap-1.5"
          >
            <Repeat2 
              size={18} 
              color={isReposted ? "#10B981" : "#6B7280"} 
            />
            <Text className={cn(
              "text-sm",
              isReposted ? "text-primary font-medium" : "text-text-muted"
            )}>
              {(post.repostCount || 0) + (isReposted ? 1 : 0)}
            </Text>
          </Pressable>

          {/* Like */}
          <Pressable 
            onPress={handleLike}
            disabled={likeMutation.isPending || unlikeMutation.isPending}
            className="flex-row items-center gap-1.5"
          >
            <Heart 
              size={18} 
              color={isLiked ? "#EF4444" : "#6B7280"} 
              fill={isLiked ? "#EF4444" : "transparent"}
            />
            <Text className={cn(
              "text-sm",
              isLiked ? "text-red-500 font-medium" : "text-text-muted"
            )}>
              {(post.likeCount || 0) + (isLiked ? 1 : 0)}
            </Text>
          </Pressable>

          {/* Share */}
          <Pressable 
            onPress={onShare}
            className="flex-row items-center gap-1.5"
          >
            <Share size={18} color="#6B7280" />
          </Pressable>
        </View>
      )}
    </View>
  );
}
