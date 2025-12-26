/**
 * Post Details Screen - Pure AT Protocol
 * 
 * Route: /post/[did]/[rkey]
 * Displays a single post thread using the DID and record key.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform, TextInput, KeyboardAvoidingView, LayoutChangeEvent } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Heart, MessageCircle, Repeat2, MoreHorizontal, Share, Send, ExternalLink } from "lucide-react-native";
import { Image } from "expo-image";
import { Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { VideoPlayer } from "@/components/ui/VideoPlayer";
import { PostOptionsMenu } from "@/components/social/PostOptionsMenu";
import { usePostThread, useLikePost, useUnlikePost, useRepost, useDeleteRepost, useCreatePost, useDeletePost } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
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

function ReplyPost({ 
  post,
  onLike,
  onRepost,
  onReply,
}: { 
  post: PostView;
  onLike: () => void;
  onRepost: () => void;
  onReply: () => void;
}) {
  const record = post.record as AppBskyFeedPost.Record;
  const router = useRouter();
  
  const handlePress = () => {
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.author.did}/${rkey}`);
  };

  const handleAuthorPress = () => {
    router.push(`/user/${post.author.handle}`);
  };
  
  return (
    <Pressable onPress={handlePress} className="px-4 py-3 border-b border-border active:bg-surface-elevated">
      <View className="flex-row">
        <Pressable onPress={handleAuthorPress}>
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
        </Pressable>
        <View className="flex-1 ml-3">
          <View className="flex-row items-center">
            <Text className="font-semibold text-text-primary">
              {post.author.displayName || post.author.handle}
            </Text>
            <Text className="text-text-muted ml-1">@{post.author.handle}</Text>
          </View>
          <Text className="text-text-primary mt-1 leading-5">{record.text}</Text>
          
          {/* Actions */}
          <View className="flex-row items-center mt-2 gap-5">
            <Pressable onPress={onReply} className="flex-row items-center">
              <MessageCircle size={16} color="#6B7280" />
              <Text className="text-text-muted text-xs ml-1">{post.replyCount || ''}</Text>
            </Pressable>
            <Pressable onPress={onRepost} className="flex-row items-center">
              <Repeat2 size={16} color={post.viewer?.repost ? "#10B981" : "#6B7280"} />
              <Text className={`text-xs ml-1 ${post.viewer?.repost ? 'text-primary' : 'text-text-muted'}`}>
                {post.repostCount || ''}
              </Text>
            </Pressable>
            <Pressable onPress={onLike} className="flex-row items-center">
              <Heart 
                size={16} 
                color={post.viewer?.like ? "#EF4444" : "#6B7280"}
                fill={post.viewer?.like ? "#EF4444" : "none"}
              />
              <Text className={`text-xs ml-1 ${post.viewer?.like ? 'text-red-500' : 'text-text-muted'}`}>
                {post.likeCount || ''}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Component for displaying parent/ancestor posts in the thread
 * Shows a connecting line to indicate thread hierarchy
 */
function ParentPost({ 
  post,
  isRoot = false,
}: { 
  post: PostView;
  isRoot?: boolean;
}) {
  const record = post.record as AppBskyFeedPost.Record;
  const router = useRouter();
  
  const handlePress = () => {
    const uriParts = post.uri.split('/');
    const rkey = uriParts[uriParts.length - 1];
    router.push(`/post/${post.author.did}/${rkey}`);
  };

  const handleAuthorPress = () => {
    router.push(`/user/${post.author.handle}`);
  };

  // Get embed images if present
  const embedImages = post.embed?.$type === 'app.bsky.embed.images#view' 
    ? (post.embed as any).images 
    : [];
  
  return (
    <Pressable onPress={handlePress} className="px-4 py-3 active:bg-surface-elevated">
      <View className="flex-row">
        {/* Avatar */}
        <Pressable onPress={handleAuthorPress}>
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
        </Pressable>
        
        <View className="flex-1 ml-3">
          <View className="flex-row items-center flex-wrap">
            <Text className="font-semibold text-text-primary">
              {post.author.displayName || post.author.handle}
            </Text>
            <Text className="text-text-muted ml-1">@{post.author.handle}</Text>
          </View>
          <Text className="text-text-primary mt-1 leading-5">{record.text}</Text>
          
          {/* Images in parent */}
          {embedImages.length > 0 && (
            <View className="mt-2 rounded-lg overflow-hidden">
              {embedImages.length === 1 ? (
                <Image 
                  source={{ uri: embedImages[0].thumb }} 
                  className="w-full h-32 rounded-lg"
                  contentFit="cover"
                />
              ) : (
                <View className="flex-row flex-wrap gap-1">
                  {embedImages.slice(0, 4).map((img: any, idx: number) => (
                    <Image 
                      key={idx}
                      source={{ uri: img.thumb }} 
                      className="w-[48%] h-24 rounded"
                      contentFit="cover"
                    />
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Recursively collect parent posts into a flat array (root first)
 */
function collectParents(thread: ThreadViewPost): PostView[] {
  const parents: PostView[] = [];
  
  let current = thread.parent;
  while (current && current.$type === 'app.bsky.feed.defs#threadViewPost') {
    const parentThread = current as ThreadViewPost;
    if (parentThread.post) {
      parents.unshift(parentThread.post); // Add to beginning (root first)
    }
    current = parentThread.parent;
  }
  
  return parents;
}

export default function PostDetailsScreen() {
  const { did, rkey } = useLocalSearchParams<{ did: string; rkey: string }>();
  const router = useRouter();
  const { profile, session, handle } = useAuthStore();
  
  // Scroll ref for auto-scrolling to main post
  const scrollViewRef = useRef<ScrollView>(null);
  const mainPostYRef = useRef<number>(0);
  const hasScrolledRef = useRef(false);
  
  // Reply state
  const [replyText, setReplyText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Construct AT URI from did and rkey
  const atUri = did && rkey ? `at://${did}/app.bsky.feed.post/${rkey}` : "";
  
  const { data: thread, isLoading, error, refetch } = usePostThread(atUri);
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();
  const createPostMutation = useCreatePost();
  const deleteMutation = useDeletePost();
  
  // Options menu state
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);

  // Auto-scroll to main post when thread loads (if there are parents)
  const handleMainPostLayout = useCallback((event: LayoutChangeEvent) => {
    mainPostYRef.current = event.nativeEvent.layout.y;
    
    // Scroll to main post after layout, but only once
    if (!hasScrolledRef.current && mainPostYRef.current > 0) {
      hasScrolledRef.current = true;
      // Small delay to ensure layout is complete
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ 
          y: mainPostYRef.current - 10, // Small offset for visual comfort
          animated: false 
        });
      }, 100);
    }
  }, []);
  
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
      unlikeMutation.mutate({ likeUri: post.viewer.like, postUri: post.uri });
    } else {
      likeMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  const handleRepost = () => {
    if (!thread?.post) return;
    const post = thread.post;
    triggerHaptic();
    
    if (post.viewer?.repost) {
      unrepostMutation.mutate({ repostUri: post.viewer.repost, postUri: post.uri });
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

  const handleQuickReply = useCallback(async () => {
    if (!thread?.post || !replyText.trim() || isSubmitting) return;
    
    const post = thread.post;
    triggerHaptic();
    setIsSubmitting(true);
    
    try {
      // Get the root of the thread
      const rootUri = (thread as any).parent?.post?.uri || post.uri;
      const rootCid = (thread as any).parent?.post?.cid || post.cid;
      
      await createPostMutation.mutateAsync({
        text: replyText.trim(),
        reply: {
          parent: { uri: post.uri, cid: post.cid },
          root: { uri: rootUri, cid: rootCid },
        },
      });
      
      setReplyText("");
      refetch(); // Refresh thread to show new reply
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error('Failed to post reply:', err);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [thread, replyText, isSubmitting, createPostMutation, refetch]);

  const handleAuthorPress = () => {
    if (thread?.post) {
      router.push(`/user/${thread.post.author.handle}`);
    }
  };

  // Options menu handlers
  const handleOptionsPress = () => {
    triggerHaptic();
    setOptionsMenuVisible(true);
  };

  const handleDelete = async () => {
    if (!thread?.post) return;
    try {
      await deleteMutation.mutateAsync(thread.post.uri);
      // Navigate back after successful delete
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/feed');
      }
    } catch (err) {
      console.error('Failed to delete post:', err);
    }
  };

  // Handlers for reply items
  const handleReplyLike = useCallback((replyPost: PostView) => {
    triggerHaptic();
    if (replyPost.viewer?.like) {
      unlikeMutation.mutate({ likeUri: replyPost.viewer.like, postUri: replyPost.uri });
    } else {
      likeMutation.mutate({ uri: replyPost.uri, cid: replyPost.cid });
    }
  }, [likeMutation, unlikeMutation]);

  const handleReplyRepost = useCallback((replyPost: PostView) => {
    triggerHaptic();
    if (replyPost.viewer?.repost) {
      unrepostMutation.mutate({ repostUri: replyPost.viewer.repost, postUri: replyPost.uri });
    } else {
      repostMutation.mutate({ uri: replyPost.uri, cid: replyPost.cid });
    }
  }, [repostMutation, unrepostMutation]);

  const handleReplyToReply = useCallback((replyPost: PostView) => {
    triggerHaptic();
    
    // For replies, the root is the original post, parent is this reply
    const rootUri = thread?.post?.uri || replyPost.uri;
    const rootCid = thread?.post?.cid || replyPost.cid;
    
    router.push({
      pathname: '/(tabs)/compose',
      params: {
        replyToUri: replyPost.uri,
        replyToCid: replyPost.cid,
        rootUri,
        rootCid,
      }
    });
  }, [router, thread]);

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
            contentStyle: { backgroundColor: "#0A0A0A" },
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
            contentStyle: { backgroundColor: "#0A0A0A" },
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
  
  // Collect parent posts (root first, then ancestors down to immediate parent)
  const parents = collectParents(thread);
  const hasParents = parents.length > 0;
  
  // Filter and type replies properly
  const replies = (thread.replies || [])
    .filter((r: any) => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
    .map((r: any) => r as ThreadViewPost);

  // Get embed content
  const embed = post.embed;
  const embedType = embed?.$type;
  
  // Images embed
  const embedImages = embedType === 'app.bsky.embed.images#view' 
    ? (embed as any).images 
    : [];
  
  // Link preview embed
  const linkPreview = embedType === 'app.bsky.embed.external#view'
    ? (embed as any).external
    : null;
  
  // Quote post embed
  const quotedPost = embedType === 'app.bsky.embed.record#view'
    ? (embed as any).record
    : null;
  
  // Video embed
  const videoEmbed = embedType === 'app.bsky.embed.video#view'
    ? embed as any
    : null;
  
  // Record with media (quote + images/video)
  const recordWithMedia = embedType === 'app.bsky.embed.recordWithMedia#view'
    ? embed as any
    : null;
  
  // Extract media from recordWithMedia
  const recordWithMediaImages = recordWithMedia?.media?.$type === 'app.bsky.embed.images#view'
    ? recordWithMedia.media.images
    : [];
  const recordWithMediaVideo = recordWithMedia?.media?.$type === 'app.bsky.embed.video#view'
    ? recordWithMedia.media
    : null;
  const recordWithMediaQuote = recordWithMedia?.record?.record;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: "Thread",
          headerStyle: { backgroundColor: "#0A0A0A" },
          headerTintColor: "#FAFAFA",
          contentStyle: { backgroundColor: "#0A0A0A" },
          headerLeft: () => (
            <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
              <ArrowLeft size={24} color="#FAFAFA" />
            </Pressable>
          ),
        }}
      />
      <ScrollView ref={scrollViewRef} className="flex-1">
        {/* Parent Posts (Thread Ancestors) */}
        {hasParents && (
          <View>
            {parents.map((parentPost, index) => (
              <ParentPost 
                key={parentPost.uri} 
                post={parentPost}
                isRoot={index === 0}
              />
            ))}
          </View>
        )}

        {/* Main Post */}
        <View 
          onLayout={hasParents ? handleMainPostLayout : undefined}
          className={`px-4 ${hasParents ? 'pt-2' : 'pt-3'} pb-3 border-b border-border`}
        >
          {/* Replying To indicator */}
          {hasParents && (
            <View className="flex-row items-center mb-2">
              <Text className="text-text-muted text-sm">
                Replying to <Text className="text-primary">@{parents[parents.length - 1].author.handle}</Text>
              </Text>
            </View>
          )}
          
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
            <Pressable onPress={handleOptionsPress} className="p-2 active:opacity-70">
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
          
          {/* Link Preview Card */}
          {linkPreview && (
            <Pressable 
              onPress={() => Linking.openURL(linkPreview.uri)}
              className="mt-3 border border-border rounded-xl overflow-hidden"
            >
              {linkPreview.thumb && (
                <Image 
                  source={{ uri: linkPreview.thumb }}
                  className="w-full h-40"
                  contentFit="cover"
                />
              )}
              <View className="p-3">
                <Text className="text-text-primary font-medium" numberOfLines={2}>
                  {linkPreview.title}
                </Text>
                {linkPreview.description && (
                  <Text className="text-text-muted text-sm mt-1" numberOfLines={2}>
                    {linkPreview.description}
                  </Text>
                )}
                <View className="flex-row items-center mt-2">
                  <ExternalLink size={12} color="#6B7280" />
                  <Text className="text-text-muted text-xs ml-1">
                    {new URL(linkPreview.uri).hostname}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
          
          {/* Quote Post */}
          {quotedPost && quotedPost.$type === 'app.bsky.embed.record#viewRecord' && (
            <Pressable 
              onPress={() => {
                const uriParts = quotedPost.uri.split('/');
                const qRkey = uriParts[uriParts.length - 1];
                const qDid = uriParts[2];
                router.push(`/post/${qDid}/${qRkey}`);
              }}
              className="mt-3 border border-border rounded-xl p-3"
            >
              <View className="flex-row items-center mb-2">
                {quotedPost.author?.avatar && (
                  <Image 
                    source={{ uri: quotedPost.author.avatar }}
                    className="w-5 h-5 rounded-full mr-2"
                    contentFit="cover"
                  />
                )}
                <Text className="text-text-primary font-medium text-sm">
                  {quotedPost.author?.displayName || quotedPost.author?.handle}
                </Text>
                <Text className="text-text-muted text-sm ml-1">
                  @{quotedPost.author?.handle}
                </Text>
              </View>
              <Text className="text-text-primary" numberOfLines={4}>
                {(quotedPost.value as any)?.text}
              </Text>
            </Pressable>
          )}
          
          {/* Video Embed */}
          {videoEmbed && (
            <View className="mt-3 rounded-xl overflow-hidden">
              <VideoPlayer
                url={videoEmbed.playlist}
                thumbnailUrl={videoEmbed.thumbnail}
                aspectRatio={videoEmbed.aspectRatio?.width && videoEmbed.aspectRatio?.height 
                  ? videoEmbed.aspectRatio.width / videoEmbed.aspectRatio.height 
                  : 16 / 9}
                autoLoad={true}
              />
            </View>
          )}
          
          {/* Record with Media (Quote + Images/Video) */}
          {recordWithMedia && (
            <>
              {/* Images from recordWithMedia */}
              {recordWithMediaImages.length > 0 && (
                <View className="mt-3 rounded-xl overflow-hidden">
                  {recordWithMediaImages.length === 1 ? (
                    <Image 
                      source={{ uri: recordWithMediaImages[0].fullsize || recordWithMediaImages[0].thumb }} 
                      className="w-full h-72"
                      contentFit="cover"
                    />
                  ) : (
                    <View className="flex-row flex-wrap">
                      {recordWithMediaImages.map((img: any, i: number) => (
                        <Image 
                          key={i}
                          source={{ uri: img.thumb }} 
                          className="w-1/2 h-40"
                          contentFit="cover"
                        />
                      ))}
                    </View>
                  )}
                </View>
              )}
              
              {/* Video from recordWithMedia */}
              {recordWithMediaVideo && (
                <View className="mt-3 rounded-xl overflow-hidden">
                  <VideoPlayer
                    url={recordWithMediaVideo.playlist}
                    thumbnailUrl={recordWithMediaVideo.thumbnail}
                    aspectRatio={recordWithMediaVideo.aspectRatio?.width && recordWithMediaVideo.aspectRatio?.height 
                      ? recordWithMediaVideo.aspectRatio.width / recordWithMediaVideo.aspectRatio.height 
                      : 16 / 9}
                    autoLoad={true}
                  />
                </View>
              )}
              
              {/* Quoted record from recordWithMedia */}
              {recordWithMediaQuote && recordWithMediaQuote.$type === 'app.bsky.embed.record#viewRecord' && (
                <Pressable 
                  onPress={() => {
                    const uriParts = recordWithMediaQuote.uri.split('/');
                    const qRkey = uriParts[uriParts.length - 1];
                    const qDid = uriParts[2];
                    router.push(`/post/${qDid}/${qRkey}`);
                  }}
                  className="mt-3 border border-border rounded-xl p-3"
                >
                  <View className="flex-row items-center mb-2">
                    {recordWithMediaQuote.author?.avatar && (
                      <Image 
                        source={{ uri: recordWithMediaQuote.author.avatar }}
                        className="w-5 h-5 rounded-full mr-2"
                        contentFit="cover"
                      />
                    )}
                    <Text className="text-text-primary font-medium text-sm">
                      {recordWithMediaQuote.author?.displayName || recordWithMediaQuote.author?.handle}
                    </Text>
                    <Text className="text-text-muted text-sm ml-1">
                      @{recordWithMediaQuote.author?.handle}
                    </Text>
                  </View>
                  <Text className="text-text-primary" numberOfLines={3}>
                    {(recordWithMediaQuote.value as any)?.text}
                  </Text>
                </Pressable>
              )}
            </>
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
              <ReplyPost 
                key={reply.post.uri} 
                post={reply.post}
                onLike={() => handleReplyLike(reply.post)}
                onRepost={() => handleReplyRepost(reply.post)}
                onReply={() => handleReplyToReply(reply.post)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Quick Reply Bar */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View className="flex-row items-center px-4 py-3 border-t border-border bg-background">
          {/* User Avatar */}
          {profile?.avatar ? (
            <Image 
              source={{ uri: profile.avatar }} 
              className="w-8 h-8 rounded-full"
              contentFit="cover"
            />
          ) : (
            <View className="w-8 h-8 rounded-full bg-primary items-center justify-center">
              <Text className="text-white text-sm font-semibold">
                {(handle || profile?.handle || 'U')[0].toUpperCase()}
              </Text>
            </View>
          )}
          
          {/* Input */}
          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Write a reply..."
            placeholderTextColor="#6B7280"
            className="flex-1 mx-3 py-2 px-3 rounded-full bg-surface-elevated text-text-primary"
            maxLength={300}
            editable={!isSubmitting}
          />
          
          {/* Send Button */}
          <Pressable 
            onPress={handleQuickReply}
            disabled={!replyText.trim() || isSubmitting}
            className={`p-2 rounded-full ${replyText.trim() && !isSubmitting ? 'bg-primary' : 'bg-surface-elevated'}`}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Send 
                size={18} 
                color={replyText.trim() ? "#fff" : "#6B7280"} 
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      
      {/* Post Options Menu */}
      <PostOptionsMenu
        isVisible={optionsMenuVisible}
        onClose={() => setOptionsMenuVisible(false)}
        onDelete={handleDelete}
        isOwnPost={post.author.did === did}
        postUrl={`https://bsky.app/profile/${post.author.handle}/post/${rkey}`}
        postText={record.text}
        authorHandle={post.author.handle}
      />
    </SafeAreaView>
  );
}
