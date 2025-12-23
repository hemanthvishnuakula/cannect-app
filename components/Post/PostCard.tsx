import { View, Text, Pressable } from "react-native";
import { Link, router } from "expo-router";
import { Image } from "expo-image";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  MoreHorizontal,
  BadgeCheck,
} from "lucide-react-native";
import { Avatar } from "@/components/ui/Avatar";
import { formatDistanceToNow } from "@/lib/utils/date";
import { useLikePost, useUnlikePost } from "@/lib/hooks";
import type { PostWithAuthor } from "@/lib/types/database";

interface PostCardProps {
  post: PostWithAuthor;
  showBorder?: boolean;
}

export function PostCard({ post, showBorder = false }: PostCardProps) {
  const likePost = useLikePost();
  const unlikePost = useUnlikePost();

  const handleLike = () => {
    if (post.is_liked) {
      unlikePost.mutate({ postId: post.id, subjectUri: (post as any).at_uri });
    } else {
      likePost.mutate({ postId: post.id, subjectUri: (post as any).at_uri, subjectCid: (post as any).at_cid });
    }
  };

  const handlePress = () => {
    router.push(`/post/${post.id}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      className={`px-4 py-3 active:bg-surface/50 ${
        showBorder ? "border-b border-border" : ""
      }`}
    >
      <View className="flex-row gap-3">
        {/* Avatar */}
        <Pressable
          onPress={() => {
            const identifier = (post.author as any).handle || post.author.username || post.author.id;
            if (identifier) router.push(`/user/${identifier}` as any);
          }}
        >
          <Avatar
            url={post.author.avatar_url ?? undefined}
            name={post.author.display_name || post.author.username || ''}
            size={44}
          />
        </Pressable>

        {/* Content */}
        <View className="flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1 flex-1">
              <Text
                className="text-text-primary font-semibold"
                numberOfLines={1}
              >
                {post.author.display_name}
              </Text>
              {post.author.is_verified && (
                <BadgeCheck size={16} color="#10B981" fill="#10B981" />
              )}
              <Text className="text-text-muted" numberOfLines={1}>
                @{post.author.username}
              </Text>
              <Text className="text-text-muted">·</Text>
              <Text className="text-text-muted text-sm">
                {formatDistanceToNow(new Date(post.created_at))}
              </Text>
            </View>

            <Pressable className="p-1">
              <MoreHorizontal size={18} color="#6B6B6B" />
            </Pressable>
          </View>

          {/* Post Content */}
          <Text className="text-text-primary mt-1 leading-5">
            {post.content}
          </Text>

          {/* Media */}
          {post.media_urls && post.media_urls.length > 0 && (
            <View className="mt-3 rounded-2xl overflow-hidden">
              <Image
                source={{ uri: post.media_urls[0] }}
                style={{ width: "100%", aspectRatio: 16 / 9 }}
                contentFit="cover"
                transition={200}
              />
            </View>
          )}

          {/* Actions */}
          <View className="flex-row items-center justify-between mt-3 -ml-2">
            {/* Reply */}
            <Pressable className="flex-row items-center gap-1 py-1 px-2">
              <MessageCircle size={18} color="#6B6B6B" />
              <Text className="text-text-muted text-sm">
                {(post.replies_count ?? 0) > 0 ? post.replies_count : ""}
              </Text>
            </Pressable>

            {/* Repost */}
            <Pressable className="flex-row items-center gap-1 py-1 px-2">
              <Repeat2 size={18} color="#6B6B6B" />
              <Text className="text-text-muted text-sm">
                {post.reposts_count > 0 ? post.reposts_count : ""}
              </Text>
            </Pressable>

            {/* Like */}
            <Pressable
              onPress={handleLike}
              className="flex-row items-center gap-1 py-1 px-2"
            >
              <Heart
                size={18}
                color={post.is_liked ? "#EF4444" : "#6B6B6B"}
                fill={post.is_liked ? "#EF4444" : "transparent"}
              />
              <Text
                className={`text-sm ${
                  post.is_liked ? "text-accent-error" : "text-text-muted"
                }`}
              >
                {post.likes_count > 0 ? post.likes_count : ""}
              </Text>
            </Pressable>

            {/* Share */}
            <Pressable className="py-1 px-2">
              <Share size={18} color="#6B6B6B" />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
