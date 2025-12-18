import { View, Text, TextInput, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Share, Alert } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Send, ArrowLeft, ArrowUpLeft } from "lucide-react-native";
import { useState } from "react";
import * as Haptics from "expo-haptics";

import { usePost, usePostReplies, useCreateReply, useLikePost, useUnlikePost, useDeletePost, useToggleRepost } from "@/lib/hooks";
import { SocialPost, ThreadComment, PostSkeleton, ReplyBar } from "@/components/social";
import { Avatar } from "@/components/ui";
import { useAuthStore } from "@/lib/stores";
import { BLURHASH_PLACEHOLDERS } from "@/lib/utils/assets";
import type { PostWithAuthor } from "@/lib/types/database";

export default function PostDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const [replyText, setReplyText] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null); // Track reply target for nested threading
  const [replyTargetUsername, setReplyTargetUsername] = useState<string | null>(null);
  
  const { data: post, isLoading: isPostLoading } = usePost(id ?? "");
  const { data: replies, isLoading: isRepliesLoading, refetch: refetchReplies } = usePostReplies(id ?? "");
  
  // ✅ Diamond Standard: Use optimistic reply hook
  const createReply = useCreateReply(replyTargetId || id || "");
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const deleteMutation = useDeletePost();
  const toggleRepostMutation = useToggleRepost();

  const handleReply = (text: string) => {
    if (!text.trim() || !id) return;
    
    // ✅ Diamond Standard: Haptic feedback on send
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    // Optimistic mutation - no await needed, UI updates instantly
    createReply.mutate(text);
    
    // Clear state immediately for snappy feel
    setReplyText("");
    setReplyTargetId(null);
    setReplyTargetUsername(null);
  };
  
  // Helper to start replying to a specific comment
  const startReplyToComment = (comment: { id: string; author?: { username?: string } }) => {
    setReplyTargetId(comment.id);
    setReplyTargetUsername(comment.author?.username || null);
    setReplyText(`@${comment.author?.username || 'user'} `);
  };
  
  // Cancel reply target and reset
  const cancelReplyTarget = () => {
    setReplyTargetId(null);
    setReplyTargetUsername(null);
    setReplyText("");
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
    // ✅ Fix: Prevent rapid clicking during mutation
    if (toggleRepostMutation.isPending) return;
    
    const isReposted = (post as any).is_reposted_by_me === true;
    
    // If already reposted, UNDO (toggle off) - no menu needed
    if (isReposted) {
      toggleRepostMutation.mutate({ post, undo: true });
      return;
    }
    
    // Full repost menu with Quote option
    if (Platform.OS === 'ios') {
      Alert.alert("Share Post", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post }) },
        { text: "Quote Post", onPress: () => router.push(`/compose/quote?postId=${post.id}` as any) }
      ]);
    } else if (Platform.OS === 'web') {
      const wantsQuote = window.confirm('Quote Post? (OK = Quote with comment, Cancel = Simple Repost)');
      if (wantsQuote) {
        router.push(`/compose/quote?postId=${post.id}` as any);
      } else {
        const confirmRepost = window.confirm('Repost this without comment?');
        if (confirmRepost) {
          toggleRepostMutation.mutate({ post });
        }
      }
    } else {
      Alert.alert("Share Post", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post }) },
        { text: "Quote Post", onPress: () => router.push(`/compose/quote?postId=${post.id}` as any) }
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
    
    // Full repost menu with Quote option
    if (Platform.OS === 'ios') {
      Alert.alert("Share Reply", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post: comment }) },
        { text: "Quote Post", onPress: () => router.push(`/compose/quote?postId=${comment.id}` as any) }
      ]);
    } else if (Platform.OS === 'web') {
      const wantsQuote = window.confirm('Quote this reply? (OK = Quote with comment, Cancel = Simple Repost)');
      if (wantsQuote) {
        router.push(`/compose/quote?postId=${comment.id}` as any);
      } else {
        const confirmRepost = window.confirm('Repost this reply without comment?');
        if (confirmRepost) {
          toggleRepostMutation.mutate({ post: comment });
        }
      }
    } else {
      Alert.alert("Share Reply", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post: comment }) },
        { text: "Quote Post", onPress: () => router.push(`/compose/quote?postId=${comment.id}` as any) }
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
        {/* ✅ Diamond Standard: Skeleton loading instead of spinner */}
        <PostSkeleton />
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
            keyExtractor={(item, index) => `${item.id}-${index}`}
            estimatedItemSize={100}
          
          // The Main Post is the Header
          ListHeaderComponent={
            <View>
              {/* ✅ 10/10 Diamond Standard: Ghost Parent Context */}
              {showViewParent && displayPost?.parent_post && (
                <Pressable 
                  onPress={() => router.push(`/post/${displayPost.reply_to_id}` as any)}
                  className="px-4 py-3 border-b border-border/30 bg-surface/30 active:bg-surface/50"
                >
                  <View className="flex-row items-center gap-2 mb-1.5">
                    <Image
                      source={{ 
                        uri: displayPost.parent_post?.author?.avatar_url || 
                          `https://ui-avatars.com/api/?name=${displayPost.parent_post?.author?.username || 'U'}&background=6B7280&color=fff`
                      }}
                      style={{ width: 20, height: 20, borderRadius: 10 }}
                      contentFit="cover"
                    />
                    <Text className="font-semibold text-xs text-text-muted">
                      @{displayPost.parent_post?.author?.username}
                    </Text>
                    <Text className="text-xs text-primary font-medium">
                      View context ↗
                    </Text>
                  </View>
                  <Text className="text-text-secondary text-sm opacity-70" numberOfLines={2}>
                    {/* Parent content would need to be fetched - showing placeholder */}
                    Replying to this post...
                  </Text>
                </Pressable>
              )}

              {/* Fallback: Simple link if no parent author data */}
              {showViewParent && !displayPost?.parent_post && (
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
                // ✅ Diamond Standard: Hide "Replying to" when parent context is shown above
                showThreadContext={!showViewParent}
              />
              
              {/* ✅ Diamond Standard: Thread connector line + reply count */}
              {(replies?.length || 0) > 0 && (
                <View className="flex-row items-center px-4 py-3 border-t border-border">
                  <View className="w-9 items-center">
                    <View className="w-[2px] h-4 bg-border rounded-full" />
                  </View>
                  <Text className="text-text-primary font-semibold ml-3">
                    {replies?.length} {replies?.length === 1 ? "Reply" : "Replies"}
                  </Text>
                </View>
              )}
              {(replies?.length || 0) === 0 && (
                <View className="border-t border-border px-4 py-3">
                  <Text className="text-text-muted">
                    No replies yet
                  </Text>
                </View>
              )}
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
                is_optimistic: (item as any).is_optimistic, // ✅ Diamond Standard: Ghost state
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

        {/* ✅ Diamond Standard: Sticky Reply Bar with haptics */}
        <ReplyBar
          onSend={handleReply}
          isPending={createReply.isPending}
          placeholder={replyTargetId && replyTargetId !== id ? "Reply to comment..." : "Post your reply..."}
          replyTargetUsername={replyTargetId && replyTargetId !== id ? replyTargetUsername : null}
          onCancelTarget={cancelReplyTarget}
          initialText={replyText}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
