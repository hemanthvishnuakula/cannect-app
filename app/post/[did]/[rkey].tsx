/**
 * Post Details Screen - Pure AT Protocol
 * 
 * Route: /post/[did]/[rkey]
 * Displays a single post thread using the DID and record key.
 */

import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Heart, MessageCircle, Repeat2, MoreHorizontal, Share } from "lucide-react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { usePostThread, useLikePost, useUnlikePost, useRepost, useDeleteRepost } from "@/lib/hooks";
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;
type ThreadViewPost = AppBskyFeedDefs.ThreadViewPost;

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatNumber(num: number | undefined): string {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function ReplyPost({ post }: { post: PostView }) {
  const record = post.record as AppBskyFeedPost.Record;
  const router = useRouter();
  
  const handlePress = () => {
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.author.did}/${rkey}`);
  };
  
  return (
    <Pressable onPress={handlePress} className="px-4 py-3 border-b border-border active:bg-surface-elevated">
      <View className="flex-row">
        {post.author.avatar ? (
          <Image 
            source={{ uri: post.author.avatar }} 
            className="w-10 h-10 rounded-full"
            contentFit="cover"
          />
        ) : (
          <View className="w-10 h-10 rounded-full bg-surface-elevated items-center justify-center">
            <Text className="text-text-muted text-lg">{post.author.handle[0].toUpperCase()}</Text>
          </View>
        )}
        <View className="flex-1 ml-3">
          <View className="flex-row items-center">
            <Text className="font-semibold text-text-primary">
              {post.author.displayName || post.author.handle}
            </Text>
            <Text className="text-text-muted ml-1">@{post.author.handle}</Text>
          </View>
          <Text className="text-text-primary mt-1 leading-5">{record.text}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function PostDetailsScreen() {
  const { did, rkey } = useLocalSearchParams<{ did: string; rkey: string }>();
  const router = useRouter();
  
  // Construct AT URI from did and rkey
  const atUri = did && rkey ? `at://${did}/app.bsky.feed.post/${rkey}` : "";
  
  const { data: thread, isLoading, error, refetch } = usePostThread(atUri);
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed');
    }
  };

  const triggerHaptic = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleLike = () => {
    if (!thread?.post) return;
    const post = thread.post;
    triggerHaptic();
    
    if (post.viewer?.like) {
      unlikeMutation.mutate(post.viewer.like);
    } else {
      likeMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  const handleRepost = () => {
    if (!thread?.post) return;
    const post = thread.post;
    triggerHaptic();
    
    if (post.viewer?.repost) {
      unrepostMutation.mutate(post.viewer.repost);
    } else {
      repostMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  const handleReply = () => {
    if (!thread?.post) return;
    const post = thread.post;
    triggerHaptic();
    
    // Get the root of the thread
    const rootUri = (thread as any).parent?.post?.uri || post.uri;
    const rootCid = (thread as any).parent?.post?.cid || post.cid;
    
    router.push({
      pathname: '/(tabs)/compose',
      params: {
        replyToUri: post.uri,
        replyToCid: post.cid,
        rootUri,
        rootCid,
      }
    });
  };

  const handleAuthorPress = () => {
    if (thread?.post) {
      router.push(`/user/${thread.post.author.handle}`);
    }
  };

  // Loading state
  if (isLoading) {
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
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !thread?.post) {
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
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-muted text-center">
            {error?.message || "Post not found or has been deleted"}
          </Text>
          <Pressable onPress={() => refetch()} className="mt-4 px-4 py-2 bg-primary rounded-lg">
            <Text className="text-white font-medium">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const post = thread.post;
  const record = post.record as AppBskyFeedPost.Record;
  
  // Filter and type replies properly
  const replies = (thread.replies || [])
    .filter((r: any) => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
    .map((r: any) => r as ThreadViewPost);

  // Get embed images
  const embedImages = post.embed?.$type === 'app.bsky.embed.images#view' 
    ? (post.embed as any).images 
    : [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
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
      
      <ScrollView className="flex-1">
        {/* Main Post */}
        <View className="px-4 pt-4 pb-3 border-b border-border">
          {/* Author Row */}
          <Pressable onPress={handleAuthorPress} className="flex-row items-center">
            {post.author.avatar ? (
              <Image 
                source={{ uri: post.author.avatar }} 
                className="w-12 h-12 rounded-full"
                contentFit="cover"
              />
            ) : (
              <View className="w-12 h-12 rounded-full bg-surface-elevated items-center justify-center">
                <Text className="text-text-muted text-xl">{post.author.handle[0].toUpperCase()}</Text>
              </View>
            )}
            <View className="flex-1 ml-3">
              <Text className="font-bold text-text-primary text-base">
                {post.author.displayName || post.author.handle}
              </Text>
              <Text className="text-text-muted">@{post.author.handle}</Text>
            </View>
            <Pressable className="p-2 active:opacity-70">
              <MoreHorizontal size={20} color="#6B7280" />
            </Pressable>
          </Pressable>

          {/* Post Content */}
          <Text className="text-text-primary text-lg leading-6 mt-4">
            {record.text}
          </Text>

          {/* Images */}
          {embedImages.length > 0 && (
            <View className="mt-3 rounded-xl overflow-hidden">
              {embedImages.length === 1 ? (
                <Image 
                  source={{ uri: embedImages[0].fullsize }} 
                  className="w-full h-72"
                  contentFit="cover"
                />
              ) : (
                <View className="flex-row flex-wrap">
                  {embedImages.map((img: any, i: number) => (
                    <Image 
                      key={i}
                      source={{ uri: img.thumb }} 
                      className={`${embedImages.length === 2 ? 'w-1/2' : 'w-1/2'} h-40`}
                      contentFit="cover"
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Timestamp */}
          <Text className="text-text-muted mt-4">{formatTime(record.createdAt)}</Text>

          {/* Engagement Stats */}
          <View className="flex-row mt-4 pt-3 border-t border-border">
            <Text className="text-text-muted">
              <Text className="font-bold text-text-primary">{formatNumber(post.repostCount)}</Text> reposts
            </Text>
            <Text className="text-text-muted ml-4">
              <Text className="font-bold text-text-primary">{formatNumber(post.likeCount)}</Text> likes
            </Text>
          </View>

          {/* Actions */}
          <View className="flex-row justify-around mt-4 pt-3 border-t border-border">
            <Pressable onPress={handleReply} className="flex-row items-center p-2 active:opacity-70">
              <MessageCircle size={22} color="#6B7280" />
            </Pressable>
            <Pressable onPress={handleRepost} className="flex-row items-center p-2 active:opacity-70">
              <Repeat2 size={22} color={post.viewer?.repost ? "#10B981" : "#6B7280"} />
            </Pressable>
            <Pressable onPress={handleLike} className="flex-row items-center p-2 active:opacity-70">
              <Heart 
                size={22} 
                color={post.viewer?.like ? "#EF4444" : "#6B7280"} 
                fill={post.viewer?.like ? "#EF4444" : "transparent"}
              />
            </Pressable>
            <Pressable className="flex-row items-center p-2 active:opacity-70">
              <Share size={22} color="#6B7280" />
            </Pressable>
          </View>
        </View>

        {/* Replies */}
        {replies.length > 0 && (
          <View>
            <Text className="text-text-muted text-sm font-medium px-4 py-3 border-b border-border">
              Replies
            </Text>
            {replies.map((reply) => (
              <ReplyPost key={reply.post.uri} post={reply.post} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
