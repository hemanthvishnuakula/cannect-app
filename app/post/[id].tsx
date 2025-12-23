import { View, Text, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { useState, useCallback } from "react";
import * as Haptics from "expo-haptics";

import { useThread, useThreadReply, useThreadDelete, useLikePost, useUnlikePost, useToggleRepost, useLoadMoreReplies } from "@/lib/hooks";
import { ThreadRibbon, ThreadSkeleton, ReplyBar, RepostMenu, PostOptionsMenu, ThreadControls } from "@/components/social";
import { useAuthStore } from "@/lib/stores";
import type { PostWithAuthor } from "@/lib/types/database";

export default function PostDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const [replyText, setReplyText] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyTargetUsername, setReplyTargetUsername] = useState<string | null>(null);
  
  // ✅ Gold Standard: Use the new thread hook with state/actions pattern
  const thread = useThread(id ?? "");
  
  // Destructure for convenience
  const { data: threadData, isLoading, error, state, actions } = thread;
  
  // ✅ Diamond Standard: Custom back handler for direct URL access
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed');
    }
  };
  
  // ✅ Use the thread-aware hooks
  const createReply = useThreadReply(id ?? "");
  const deleteReply = useThreadDelete(id ?? "");
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const toggleRepostMutation = useToggleRepost();
  
  // Repost menu state
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [repostMenuPost, setRepostMenuPost] = useState<PostWithAuthor | null>(null);
  
  // Post options menu state
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [optionsMenuPost, setOptionsMenuPost] = useState<PostWithAuthor | null>(null);

  const handleReply = (text: string) => {
    if (!text.trim() || !id) return;
    
    // ✅ Diamond Standard: Haptic feedback on send
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    // Optimistic mutation - replies to the focused post (or nested target)
    createReply.mutate({ 
      content: text, 
      parentId: replyTargetId || id,
    });
    
    // Clear state immediately for snappy feel
    setReplyText("");
    setReplyTargetId(null);
    setReplyTargetUsername(null);
  };
  
  // Helper to start replying to a specific comment
  const startReplyToComment = (postId: string, username?: string) => {
    setReplyTargetId(postId);
    setReplyTargetUsername(username || null);
    setReplyText(username ? `@${username} ` : "");
  };
  
  // Cancel reply target and reset
  const cancelReplyTarget = () => {
    setReplyTargetId(null);
    setReplyTargetUsername(null);
    setReplyText("");
  };

  const handleLike = (targetPost: PostWithAuthor) => {
    // For quote posts of internal posts, like the QUOTED post
    // Simple reposts are now in separate table, so we only check for quotes here
    const isQuoteOfInternal = targetPost.type === 'quote' && 
      targetPost.repost_of_id && 
      !(targetPost as any).external_id;
    
    const likeTargetId = isQuoteOfInternal && targetPost.repost_of_id 
      ? targetPost.repost_of_id 
      : targetPost.id;
    
    if (targetPost.is_liked) {
      unlikeMutation.mutate({ postId: likeTargetId, subjectUri: (targetPost as any).at_uri });
    } else {
      // Pass AT fields for federation
      likeMutation.mutate({
        postId: likeTargetId,
        subjectUri: (targetPost as any).at_uri,
        subjectCid: (targetPost as any).at_cid,
      });
    }
  };

  const handleRepost = (post: PostWithAuthor) => {
    // ✅ Fix: Prevent rapid clicking during mutation
    if (toggleRepostMutation.isPending) return;
    
    setRepostMenuPost(post);
    setRepostMenuVisible(true);
  };
  
  // Handlers for the repost menu
  const handleDoRepost = useCallback(() => {
    if (!repostMenuPost) return;
    
    const isReposted = (repostMenuPost as any).is_reposted_by_me === true;
    
    if (isReposted) {
      toggleRepostMutation.mutate({ post: repostMenuPost, undo: true });
    } else {
      toggleRepostMutation.mutate({ 
        post: repostMenuPost, 
        subjectUri: (repostMenuPost as any).at_uri, 
        subjectCid: (repostMenuPost as any).at_cid 
      });
    }
  }, [repostMenuPost, toggleRepostMutation]);
  
  const handleDoQuotePost = useCallback(() => {
    if (!repostMenuPost) return;
    const quoteUrl = (repostMenuPost as any).at_uri 
      ? `/compose/quote?postId=${repostMenuPost.id}&atUri=${encodeURIComponent((repostMenuPost as any).at_uri)}&atCid=${encodeURIComponent((repostMenuPost as any).at_cid || '')}`
      : `/compose/quote?postId=${repostMenuPost.id}`;
    router.push(quoteUrl as any);
  }, [repostMenuPost, router]);

  const handleMore = (post: PostWithAuthor) => {
    setOptionsMenuPost(post);
    setOptionsMenuVisible(true);
  };
  
  const handleDoDelete = useCallback(() => {
    if (!optionsMenuPost) return;
    
    const isFocusedPost = optionsMenuPost.id === id;
    
    if (isFocusedPost) {
      // Deleting the main focused post - go back after delete
      deleteReply.mutate(optionsMenuPost.id, {
        onSuccess: () => router.back(),
      });
    } else {
      // Deleting a reply - optimistic update, stay on page
      deleteReply.mutate(optionsMenuPost.id);
    }
  }, [optionsMenuPost, id, deleteReply, router]);

  // Loading state
  if (isLoading || !threadData) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen 
          options={{ 
            headerShown: true,
            headerTitle: "Thread",
            headerStyle: { backgroundColor: "#0A0A0A" },
            headerTintColor: "#FAFAFA",
            headerLeft: () => (
              <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
            ),
          }} 
        />
        <ThreadSkeleton />
      </SafeAreaView>
    );
  }

  // Determine if focused post is a reply for header title
  const isReply = threadData.focusedPost.is_reply || threadData.ancestors.length > 0;
  
  // Whether to show sort controls (only if there are replies)
  const hasReplies = threadData.replies.length > 0 || threadData.totalReplies > 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: isReply ? "Reply" : "Thread",
          headerStyle: { backgroundColor: "#0A0A0A" },
          headerTintColor: "#FAFAFA",
          headerLeft: () => (
            <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
              <ArrowLeft size={24} color="#FAFAFA" />
            </Pressable>
          ),
        }} 
      />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        className="flex-1"
        style={{ flex: 1 }}
      >
        {/* ✅ Gold Standard: Thread Controls (sort) */}
        {hasReplies && (
          <ThreadControls
            sort={state.sort}
            onSortChange={actions.setSort}
          />
        )}
        
        {/* ✅ Gold Standard: Complete thread visualization */}
        <ThreadRibbon
          thread={threadData}
          onLike={handleLike}
          onRepost={handleRepost}
          onReply={(post, username) => startReplyToComment(post.id, username)}
          onMore={handleMore}
          sort={state.sort}
          view={state.view}
        />

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
      
      {/* Repost Menu */}
      <RepostMenu
        isVisible={repostMenuVisible}
        onClose={() => setRepostMenuVisible(false)}
        onRepost={handleDoRepost}
        onQuotePost={handleDoQuotePost}
        isReposted={(repostMenuPost as any)?.is_reposted_by_me === true}
      />
      
      {/* Post Options Menu (Delete, Copy Link, Report) */}
      <PostOptionsMenu
        isVisible={optionsMenuVisible}
        onClose={() => setOptionsMenuVisible(false)}
        onDelete={handleDoDelete}
        isOwnPost={optionsMenuPost?.user_id === user?.id}
        postUrl={optionsMenuPost ? `https://cannect.app/post/${optionsMenuPost.id}` : undefined}
        isReply={!!optionsMenuPost?.thread_parent_id}
      />
    </SafeAreaView>
  );
}
