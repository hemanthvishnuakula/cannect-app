/**
 * Federated Post Detail Screen
 * 
 * Displays a Bluesky post with its thread/replies.
 * Uses URI passed via query params or global search params.
 */

import { useState, useCallback, memo } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, Share, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, ExternalLink } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";

import { getBlueskyPostThread, type FederatedPost } from "@/lib/services/bluesky";
import { UnifiedFeedItem } from "@/components/social/UnifiedFeedItem";
import { ReplyBar } from "@/components/social/ReplyBar";
import { fromBlueskyPost, type UnifiedPost } from "@/lib/types/unified-post";
import { useReplyToBlueskyPost, useEnrichedPost } from "@/lib/hooks";
import type { BlueskyPostData } from "@/components/social/BlueskyPost";

// Convert FederatedPost to BlueskyPostData format for the adapter
function toBlueskyPostData(post: FederatedPost): BlueskyPostData {
  return {
    uri: post.uri,
    cid: post.cid,
    content: post.content,
    createdAt: post.created_at,
    author: {
      did: post.author.did,
      handle: post.author.handle,
      displayName: post.author.display_name,
      avatar: post.author.avatar_url || undefined,
    },
    likeCount: post.likes_count,
    repostCount: post.reposts_count,
    replyCount: post.replies_count,
    images: post.media_urls,
  };
}

/**
 * Wrapper component that converts FederatedPost to UnifiedPost for UnifiedFeedItem.
 * UnifiedFeedItem provides both state enrichment AND action handlers (like, repost, etc.)
 */
interface FederatedPostItemProps {
  federatedPost: FederatedPost;
}

const FederatedPostItem = memo(function FederatedPostItem({ federatedPost }: FederatedPostItemProps) {
  // Convert to unified format - UnifiedFeedItem will handle state enrichment and actions
  const post = fromBlueskyPost(toBlueskyPostData(federatedPost));
  
  // UnifiedFeedItem provides: toggleLike, toggleRepost, reply, share, etc.
  return <UnifiedFeedItem post={post} />;
});

export default function FederatedPostScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const router = useRouter();

  // Reply mutation for Bluesky posts
  const replyMutation = useReplyToBlueskyPost();

  // Fetch the thread from Bluesky
  const { data: thread, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ["bluesky-thread", uri],
    queryFn: () => getBlueskyPostThread(uri ?? ""),
    enabled: !!uri,
    staleTime: 30000, // 30 seconds
  });

  // Handle sending a reply
  const handleReply = useCallback(async (text: string) => {
    if (!thread?.post || !text.trim()) return;
    
    try {
      await replyMutation.mutateAsync({
        content: text.trim(),
        parent: {
          parentUri: thread.post.uri,
          parentCid: thread.post.cid,
        },
      });
      // Refetch thread to show the new reply
      refetch();
    } catch (err) {
      console.error("Failed to reply:", err);
    }
  }, [thread?.post, replyMutation, refetch]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed');
    }
  };

  const handleShare = async () => {
    if (!thread?.post) return;
    
    // Convert AT URI to Bluesky web URL
    // at://did:plc:xxx/app.bsky.feed.post/abc -> https://bsky.app/profile/handle/post/abc
    const parts = thread.post.uri.split("/");
    const rkey = parts[parts.length - 1];
    const webUrl = `https://bsky.app/profile/${thread.post.author.handle}/post/${rkey}`;
    
    try {
      await Share.share({
        message: `Check out this post by @${thread.post.author.handle}: ${webUrl}`,
        url: webUrl,
      });
    } catch (e) {
      // User cancelled
    }
  };

  const handleOpenInBluesky = () => {
    if (!thread?.post) return;
    
    const parts = thread.post.uri.split("/");
    const rkey = parts[parts.length - 1];
    const webUrl = `https://bsky.app/profile/${thread.post.author.handle}/post/${rkey}`;
    
    // Open in browser
    if (typeof window !== "undefined") {
      window.open(webUrl, "_blank");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
        <Pressable
          onPress={handleBack}
          className="p-2 -ml-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={24} color="#6B7280" />
        </Pressable>
        <Text className="text-lg font-semibold text-text-primary">Post</Text>
        <Pressable
          onPress={handleOpenInBluesky}
          className="p-2 -mr-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ExternalLink size={20} color="#6B7280" />
        </Pressable>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        className="flex-1"
        style={{ flex: 1 }}
      >
        {/* Content */}
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#10B981" />
            <Text className="text-text-muted mt-4">Loading post...</Text>
          </View>
        ) : error || !thread ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-text-muted text-center">
              Failed to load this post. It may have been deleted or is unavailable.
            </Text>
            <Pressable
              onPress={() => refetch()}
              className="mt-4 px-4 py-2 bg-primary rounded-lg"
            >
              <Text className="text-white font-medium">Try Again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView
              refreshControl={
                <RefreshControl
                  refreshing={isRefetching}
                  onRefresh={refetch}
                  tintColor="#10B981"
                  colors={["#10B981"]}
                />
              }
              contentContainerStyle={{ paddingBottom: 20 }}
            >
          {/* Parent post (if replying to something) */}
          {thread.parent && (
            <View className="opacity-70">
              <FederatedPostItem federatedPost={thread.parent} />
              <View className="h-4 ml-8 w-0.5 bg-border" />
            </View>
          )}

          {/* Main post */}
          <FederatedPostItem federatedPost={thread.post} />

          {/* Replies section */}
          {thread.replies.length > 0 && (
            <>
              <View className="border-t border-border mt-2">
                <View className="px-4 py-3">
                  <Text className="text-sm font-medium text-text-muted">
                    {thread.replies.length} {thread.replies.length === 1 ? 'Reply' : 'Replies'}
                  </Text>
                </View>
              </View>

              {thread.replies.map((reply) => (
                <View key={reply.uri} className="border-t border-border/50">
                  <FederatedPostItem federatedPost={reply} />
                </View>
              ))}
            </>
          )}

          {/* No replies state */}
          {thread.replies.length === 0 && (
            <View className="border-t border-border py-8 px-4">
              <Text className="text-center text-text-muted">
                No replies yet. Be the first to respond!
              </Text>
            </View>
          )}
            </ScrollView>

            {/* Reply Bar */}
            <ReplyBar
              onSend={handleReply}
              isPending={replyMutation.isPending}
              placeholder="Reply to this post..."
            />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
