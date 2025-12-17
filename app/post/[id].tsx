import { View, Text, TextInput, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Share, Alert } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Send, ArrowLeft, ArrowUpLeft } from "lucide-react-native";
import { useState } from "react";

import { usePost, usePostReplies, useCreatePost, useLikePost, useUnlikePost, useDeletePost, useToggleRepost } from "@/lib/hooks";
import { SocialPost, ThreadComment } from "@/components/social";
import { useAuthStore } from "@/lib/stores";
import type { PostWithAuthor } from "@/lib/types/database";

export default function PostDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const [replyText, setReplyText] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null); // Track reply target for nested threading
  
  const { data: post, isLoading: isPostLoading } = usePost(id ?? "");
  const { data: replies, isLoading: isRepliesLoading, refetch: refetchReplies } = usePostReplies(id ?? "");
  const createReply = useCreatePost();
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const deleteMutation = useDeletePost();
  const toggleRepostMutation = useToggleRepost();

  const handleReply = async () => {
    if (!replyText.trim() || !id) return;
    
    try {
      // Use replyTargetId if set (replying to a comment), otherwise reply to main post
      await createReply.mutateAsync({ 
        content: replyText, 
        replyToId: replyTargetId || id
      });
      setReplyText("");
      setReplyTargetId(null); // Reset to main post
      refetchReplies();
    } catch (error) {
      console.error("Failed to reply", error);
    }
  };
  
  // Helper to start replying to a specific comment
  const startReplyToComment = (comment: { id: string; author?: { username?: string } }) => {
    setReplyTargetId(comment.id);
    setReplyText(`@${comment.author?.username || 'user'} `);
  };

  const handleLike = (targetPost: PostWithAuthor) => {
    // For simple reposts of internal posts, like the ORIGINAL post
    const isSimpleRepostOfInternal = (targetPost.type === 'repost' || targetPost.is_repost) && 
      targetPost.repost_of_id && 
      !(targetPost as any).external_id;
    
    const likeTargetId = isSimpleRepostOfInternal && targetPost.repost_of_id 
      ? targetPost.repost_of_id 
      : targetPost.id;
    
    if (targetPost.is_liked) {
      unlikeMutation.mutate(likeTargetId);
    } else {
      likeMutation.mutate(likeTargetId);
    }
  };

  const handleShare = async () => {
    if (!post) return;
    try {
      await Share.share({
        message: `Check out this post by @${post.author?.username}: ${post.content.substring(0, 100)}${post.content.length > 100 ? '...' : ''}`,
      });
    } catch (error) {
      // User cancelled
    }
  };

  const handleRepost = () => {
    if (!post) return;
    const isReposted = (post as any).is_reposted_by_me === true;
    
    if (isReposted) {
      // Undo repost
      toggleRepostMutation.mutate({ post, undo: true });
      return;
    }
    
    // Platform-aware repost confirmation
    if (Platform.OS === 'web') {
      const confirmRepost = window.confirm('Repost this to your followers?');
      if (confirmRepost) {
        toggleRepostMutation.mutate({ post });
      }
    } else {
      Alert.alert("Repost", "Share this with your followers?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post }) }
      ]);
    }
  };

  // ✅ Everything is a Post: Handle repost for comments (promotes to top-level)
  const handleCommentRepost = (comment: PostWithAuthor) => {
    const isReposted = (comment as any).is_reposted_by_me === true;
    
    if (isReposted) {
      toggleRepostMutation.mutate({ post: comment, undo: true });
      return;
    }
    
    // Platform-aware repost confirmation
    if (Platform.OS === 'web') {
      const confirmRepost = window.confirm('Repost this comment to your followers?');
      if (confirmRepost) {
        toggleRepostMutation.mutate({ post: comment });
      }
    } else {
      Alert.alert("Repost Comment", "Share this reply with your followers?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post: comment }) }
      ]);
    }
  };

  const handleMore = () => {
    if (!post || post.user_id !== user?.id) return;
    Alert.alert("Manage Post", "Delete this post?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        deleteMutation.mutate(post.id);
        router.back();
      }}
    ]);
  };

  if (isPostLoading || !post) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen 
          options={{ 
            headerShown: true,
            headerTitle: "Thread",
            headerStyle: { backgroundColor: "#0A0A0A" },
            headerTintColor: "#FAFAFA",
          }} 
        />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  // Gold Standard: "Look through" the repost to see the original content
  const displayPost = (post as any)?.quoted_post || post;
  const showViewParent = displayPost?.is_reply && displayPost?.reply_to_id;
  const isViewingRepost = post?.type === 'repost' && (post as any)?.quoted_post;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: displayPost?.is_reply ? "Reply" : "Thread",
          headerStyle: { backgroundColor: "#0A0A0A" },
          headerTintColor: "#FAFAFA",
        }} 
      />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        className="flex-1"
        style={{ flex: 1 }}
      >
        {/* FlashList needs explicit flex container on web */}
        <View style={{ flex: 1, minHeight: 2 }}>
          <FlashList
            data={replies || []}
            keyExtractor={(item) => item.id}
            estimatedItemSize={100}
          
          // The Main Post is the Header
          ListHeaderComponent={
            <View>
              {/* Gold Standard: View Parent anchor - "looks through" reposts to find the original's parent */}
              {showViewParent && (
                <Pressable 
                  onPress={() => router.push(`/post/${displayPost.reply_to_id}` as any)}
                  className="flex-row items-center px-4 py-3 bg-primary/5 border-b border-border active:bg-primary/10"
                >
                  <ArrowUpLeft size={16} color="#10B981" />
                  <Text className="ml-2 text-sm font-medium text-primary">
                    View Parent Post
                  </Text>
                </Pressable>
              )}
              
              {/* Main Post - Displayed Prominently */}
              <SocialPost 
                post={post}
                onLike={() => handleLike(post)}
                onReply={() => setReplyTargetId(id)} 
                onProfilePress={() => router.push(`/user/${post.author?.username}` as any)}
                onShare={handleShare}
                onRepost={handleRepost}
                onMore={handleMore}
              />
              
              {/* Divider with reply count */}
              <View className="border-t border-border px-4 py-3">
                <Text className="text-text-primary font-semibold">
                  {replies?.length || 0} {replies?.length === 1 ? "Reply" : "Replies"}
                </Text>
              </View>
            </View>
          }

          // Direct replies only (Infinite Pivot pattern)
          renderItem={({ item, index }) => (
            <ThreadComment 
              comment={{
                id: item.id,
                content: item.content,
                created_at: item.created_at,
                author: item.author,
                likes_count: item.likes_count,
                replies_count: item.comments_count,
                reposts_count: item.reposts_count,
                is_liked: item.is_liked,
                is_reposted_by_me: (item as any).is_reposted_by_me,
              }}
              isLast={index === (replies?.length ?? 0) - 1}
              onReplyPress={() => startReplyToComment({ id: item.id, author: item.author })}
              onLikePress={() => handleLike(item)}
              onRepostPress={() => handleCommentRepost(item)}
              onProfilePress={() => router.push(`/user/${item.author?.username}` as any)}
            />
          )}
          
          // Empty state for no replies
          ListEmptyComponent={
            !isRepliesLoading ? (
              <View className="py-12 items-center">
                <Text className="text-text-muted text-base">No replies yet</Text>
                <Text className="text-text-secondary text-sm mt-1">Be the first to reply!</Text>
              </View>
            ) : null
          }
          
          contentContainerStyle={{ paddingBottom: 100 }}
        />
        </View>

        {/* Sticky Reply Input */}
        <View className="border-t border-border bg-background">
          {/* Reply target indicator - shows when replying to a specific comment */}
          {replyTargetId && replyTargetId !== id && (
            <View className="flex-row items-center justify-between px-4 py-2 bg-surface/50">
              <Text className="text-xs text-text-muted">
                Replying to comment...
              </Text>
              <Pressable onPress={() => { setReplyTargetId(null); setReplyText(""); }}>
                <Text className="text-xs text-primary font-medium">Cancel</Text>
              </Pressable>
            </View>
          )}
          
          <View className="px-4 py-3 flex-row items-center gap-3">
            {/* User avatar */}
            <View className="w-8 h-8 rounded-full bg-primary items-center justify-center">
              <Text className="text-white text-sm font-semibold">
                {user?.email?.[0]?.toUpperCase() || "?"}
              </Text>
            </View>
            
            {/* Input field */}
            <TextInput
              className="flex-1 bg-surface rounded-2xl px-4 py-2.5 text-text-primary text-base"
              placeholder={replyTargetId && replyTargetId !== id ? "Reply to comment..." : "Post your reply..."}
              placeholderTextColor="#6B7280"
              value={replyText}
              onChangeText={setReplyText}
              multiline
              maxLength={280}
            />
            
            {/* Send button */}
            <Pressable 
              onPress={handleReply}
              disabled={!replyText.trim() || createReply.isPending}
              className={`p-2.5 rounded-full ${replyText.trim() ? 'bg-primary' : 'bg-surface'}`}
            >
              {createReply.isPending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Send size={18} color={replyText.trim() ? "white" : "#6B7280"} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
