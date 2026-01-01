/**
 * Post Details Screen - Pure AT Protocol
 *
 * Route: /post/[did]/[rkey]
 * Displays a single post thread using the DID and record key.
 *
 * Uses unified components:
 * - ThreadPost for the main expanded post
 * - PostCard for parent posts and replies
 */

import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Send } from 'lucide-react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { ThreadPost, PostCard } from '@/components/Post';
import { usePostThread, useCreatePost } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';
import { getOptimizedAvatarUrl } from '@/lib/utils/avatar';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;
type ThreadViewPost = AppBskyFeedDefs.ThreadViewPost;

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
  const { profile, handle } = useAuthStore();

  // Scroll ref for auto-scrolling to main post
  const scrollViewRef = useRef<ScrollView>(null);
  const mainPostYRef = useRef<number>(0);
  const hasScrolledRef = useRef(false);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Construct AT URI from did and rkey
  const atUri = did && rkey ? `at://${did}/app.bsky.feed.post/${rkey}` : '';

  const { data: thread, isLoading, error, refetch } = usePostThread(atUri);
  const createPostMutation = useCreatePost();

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
          animated: false,
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

      setReplyText('');
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

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: 'Thread',
            headerStyle: { backgroundColor: '#0A0A0A' },
            headerTintColor: '#FAFAFA',
            contentStyle: { backgroundColor: '#0A0A0A' },
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
            headerTitle: 'Thread',
            headerStyle: { backgroundColor: '#0A0A0A' },
            headerTintColor: '#FAFAFA',
            contentStyle: { backgroundColor: '#0A0A0A' },
            headerLeft: () => (
              <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
            ),
          }}
        />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-muted text-center">
            {error?.message || 'Post not found or has been deleted'}
          </Text>
          <Pressable onPress={() => refetch()} className="mt-4 px-4 py-2 bg-primary rounded-lg">
            <Text className="text-white font-medium">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const post = thread.post;
  const _record = post.record as AppBskyFeedPost.Record;

  // Collect parent posts (root first, then ancestors down to immediate parent)
  const parents = collectParents(thread);
  const hasParents = parents.length > 0;

  // Filter and type replies properly
  const replies = (thread.replies || [])
    .filter((r: any) => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
    .map((r: any) => r as ThreadViewPost);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Thread',
          headerStyle: { backgroundColor: '#0A0A0A' },
          headerTintColor: '#FAFAFA',
          contentStyle: { backgroundColor: '#0A0A0A' },
          headerLeft: () => (
            <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
              <ArrowLeft size={24} color="#FAFAFA" />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        ref={scrollViewRef}
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => refetch()}
            tintColor="#10B981"
            colors={['#10B981']}
          />
        }
      >
        {/* Parent Posts (Thread Ancestors) - Using PostCard */}
        {hasParents && (
          <View>
            {parents.map((parentPost) => (
              <PostCard key={parentPost.uri} post={parentPost} showBorder={false} />
            ))}
          </View>
        )}

        {/* Main Post - Using ThreadPost component */}
        <View
          onLayout={hasParents ? handleMainPostLayout : undefined}
          className={`${hasParents ? 'pt-2' : 'pt-3'} pb-3 border-b border-border`}
        >
          {/* Replying To indicator */}
          {hasParents && (
            <View className="flex-row items-center mb-2 px-4">
              <Text className="text-text-muted text-sm">
                Replying to{' '}
                <Text className="text-primary">@{parents[parents.length - 1].author.handle}</Text>
              </Text>
            </View>
          )}

          <ThreadPost post={post} />
        </View>

        {/* Replies - Using PostCard component */}
        {replies.length > 0 && (
          <View className="border-t border-border">
            {replies.map((reply) => (
              <PostCard key={reply.post.uri} post={reply.post} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Quick Reply Bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View className="flex-row items-center px-4 py-3 border-t border-border bg-background">
          {/* User Avatar */}
          {profile?.avatar ? (
            <Image
              source={{ uri: getOptimizedAvatarUrl(profile.avatar, 32) }}
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
              <Send size={18} color={replyText.trim() ? '#fff' : '#6B7280'} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
