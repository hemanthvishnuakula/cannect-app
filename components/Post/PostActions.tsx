/**
 * PostActions - Unified action buttons with built-in optimistic mutations
 *
 * Single source of truth for ALL post interactions:
 * - Like/Unlike (with optimistic updates)
 * - Repost/Unrepost (with menu for quote option)
 * - Quote Post (navigate to compose)
 * - Reply (navigate to compose)
 * - Share (platform-aware)
 * - Options Menu (delete, report, copy link)
 *
 * Built-in:
 * - RepostMenu integrated
 * - OptionsMenu integrated (delete, report, copy link, share)
 * - Optimistic updates via mutation hooks
 * - Toggle logic (like → unlike, repost → unrepost)
 * - Visual feedback for active states
 * - Haptic feedback on native
 */

import { View, Text, Pressable, Share as RNShare, Platform, Modal, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  MoreHorizontal,
  Quote,
  Trash2,
  Flag,
  Link,
  Share2,
} from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import {
  useLikePost,
  useUnlikePost,
  useRepost,
  useDeleteRepost,
  useDeletePost,
} from '../../lib/hooks';
import { useAuthStore } from '../../lib/stores';
import * as atproto from '../../lib/atproto/agent';
import type { ReportReason } from '../../lib/atproto/agent';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;

interface PostActionsProps {
  /** The post to show actions for */
  post: PostView;
  /** Visual variant: compact for feed, expanded for thread detail */
  variant?: 'compact' | 'expanded';
  /** Hide reply count (for some layouts) */
  hideReplyCounts?: boolean;
  /** Hide the options button entirely */
  hideOptions?: boolean;
}

// Haptic helper
const triggerHaptic = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(style);
  }
};

// Stop event propagation helper (works on web and native)
const stopEvent = (e: any) => {
  e?.stopPropagation?.();
  e?.preventDefault?.();
};

// Check if web share API is available
const canShare = () => {
  if (Platform.OS !== 'web') return false;
  return typeof navigator !== 'undefined' && !!navigator.share;
};

export const PostActions = memo(function PostActions({
  post,
  variant = 'compact',
  hideReplyCounts = false,
  hideOptions = false,
}: PostActionsProps) {
  const router = useRouter();
  const { did: currentUserDid } = useAuthStore();

  // Mutation hooks with optimistic updates
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();
  const deletePostMutation = useDeletePost();

  // Local state
  const [isLikeLoading, setIsLikeLoading] = useState(false);
  const [isRepostLoading, setIsRepostLoading] = useState(false);
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);

  // Derived state
  const isLiked = !!post.viewer?.like;
  const isReposted = !!post.viewer?.repost;
  const likeCount = post.likeCount || 0;
  const repostCount = post.repostCount || 0;
  const replyCount = post.replyCount || 0;
  const isOwnPost = post.author.did === currentUserDid;
  const record = post.record as AppBskyFeedPost.Record;

  // Build post URL
  const getPostUrl = useCallback(() => {
    const parts = post.uri.split('/');
    const rkey = parts[4];
    return `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
  }, [post]);

  // Handle like toggle
  const handleLike = useCallback(async () => {
    if (isLikeLoading) return;
    triggerHaptic();
    setIsLikeLoading(true);

    try {
      if (isLiked && post.viewer?.like) {
        await unlikeMutation.mutateAsync({
          likeUri: post.viewer.like,
          postUri: post.uri,
        });
      } else {
        await likeMutation.mutateAsync({
          uri: post.uri,
          cid: post.cid,
        });
      }
    } catch (error) {
      console.error('Like action failed:', error);
    } finally {
      setIsLikeLoading(false);
    }
  }, [isLiked, isLikeLoading, post, likeMutation, unlikeMutation]);

  // Open repost menu
  const handleRepostPress = useCallback(() => {
    triggerHaptic();
    setRepostMenuVisible(true);
  }, []);

  // Perform repost/unrepost action
  const handleRepost = useCallback(async () => {
    if (isRepostLoading) return;
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    setIsRepostLoading(true);
    setRepostMenuVisible(false);

    try {
      if (isReposted && post.viewer?.repost) {
        await unrepostMutation.mutateAsync({
          repostUri: post.viewer.repost,
          postUri: post.uri,
        });
      } else {
        await repostMutation.mutateAsync({
          uri: post.uri,
          cid: post.cid,
        });
      }
    } catch (error) {
      console.error('Repost action failed:', error);
    } finally {
      setIsRepostLoading(false);
    }
  }, [isReposted, isRepostLoading, post, repostMutation, unrepostMutation]);

  // Handle quote post - navigate to compose
  const handleQuotePost = useCallback(() => {
    triggerHaptic();
    setRepostMenuVisible(false);

    router.push({
      pathname: '/compose',
      params: {
        quoteUri: post.uri,
        quoteCid: post.cid,
      },
    } as any);
  }, [post, router]);

  // Handle reply - navigate to compose with reply context
  const handleReply = useCallback(() => {
    triggerHaptic();
    const parts = post.uri.split('/');
    const did = parts[2];
    const rkey = parts[4];

    router.push({
      pathname: '/compose',
      params: {
        replyTo: post.uri,
        replyToDid: did,
        replyToRkey: rkey,
      },
    } as any);
  }, [post.uri, router]);

  // Handle share (action bar button)
  const handleShare = useCallback(async () => {
    triggerHaptic();
    const url = getPostUrl();

    try {
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(url);
      } else {
        await RNShare.share({
          message: url,
          url: url,
        });
      }
    } catch (error) {
      console.error('Share failed:', error);
    }
  }, [getPostUrl]);

  // Open options menu
  const handleOptionsPress = useCallback(() => {
    triggerHaptic();
    setOptionsMenuVisible(true);
  }, []);

  // Copy link to clipboard
  const handleCopyLink = useCallback(async () => {
    triggerHaptic();
    const url = getPostUrl();
    await Clipboard.setStringAsync(url);
    setOptionsMenuVisible(false);
  }, [getPostUrl]);

  // Native share (web only with Share API)
  const handleNativeShare = useCallback(async () => {
    triggerHaptic();
    const url = getPostUrl();

    try {
      await navigator.share({
        title: `Post by @${post.author.handle}`,
        text: record.text?.substring(0, 280) || '',
        url: url,
      });
    } catch {
      // User cancelled or share failed
    }
    setOptionsMenuVisible(false);
  }, [getPostUrl, post.author.handle, record.text]);

  // Delete post
  const handleDelete = useCallback(async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
    setOptionsMenuVisible(false);

    const confirmDelete = () => {
      deletePostMutation.mutate(post.uri);
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Delete this post? This cannot be undone.')) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'Delete Post',
        'Are you sure you want to delete this post? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  }, [post.uri, deletePostMutation]);

  // Report post
  const handleReport = useCallback(() => {
    triggerHaptic();
    setOptionsMenuVisible(false);

    const reportReasons: { label: string; value: ReportReason }[] = [
      { label: 'Sexual Content', value: 'sexual' },
      { label: 'Spam', value: 'spam' },
      { label: 'Harassment/Rude', value: 'rude' },
      { label: 'Misleading', value: 'misleading' },
      { label: 'Violation of Terms', value: 'violation' },
      { label: 'Other', value: 'other' },
    ];

    const submitReport = async (reason: ReportReason) => {
      try {
        await atproto.reportPost(post.uri, post.cid, reason);
        if (Platform.OS === 'web') {
          window.alert('Report submitted. Thank you for helping keep Cannect safe.');
        } else {
          Alert.alert('Report Submitted', 'Thank you for helping keep Cannect safe.');
        }
      } catch (error) {
        console.error('Failed to submit report:', error);
        if (Platform.OS === 'web') {
          window.alert('Failed to submit report. Please try again.');
        } else {
          Alert.alert('Error', 'Failed to submit report. Please try again.');
        }
      }
    };

    if (Platform.OS === 'web') {
      const reason = window.prompt(
        'Report this post?\n\nReasons:\n1. Sexual Content\n2. Spam\n3. Harassment\n4. Misleading\n5. Violation\n6. Other\n\nEnter number (1-6):'
      );

      if (reason) {
        const reasonMap: Record<string, ReportReason> = {
          '1': 'sexual',
          '2': 'spam',
          '3': 'rude',
          '4': 'misleading',
          '5': 'violation',
          '6': 'other',
        };
        const selectedReason = reasonMap[reason];
        if (selectedReason) {
          submitReport(selectedReason);
        }
      }
    } else {
      Alert.alert('Report Post', 'Why are you reporting this content?', [
        ...reportReasons.map((r) => ({
          text: r.label,
          onPress: () => submitReport(r.value),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [post.uri, post.cid]);

  // Icon sizes based on variant
  const iconSize = variant === 'compact' ? 18 : 22;
  const mutedColor = '#6B7280';
  const likeColor = isLiked ? '#EF4444' : mutedColor;
  const repostColor = isReposted ? '#10B981' : mutedColor;
  const canUseNativeShare = canShare();

  // Action buttons JSX
  const actionButtons =
    variant === 'compact' ? (
      <View className="flex-row items-center justify-between mt-3 pr-4">
        {/* Reply */}
        <Pressable
          onPress={(e) => {
            stopEvent(e);
            handleReply();
          }}
          className="flex-row items-center py-1"
          hitSlop={8}
        >
          <MessageCircle size={iconSize} color={mutedColor} />
          {!hideReplyCounts && replyCount > 0 && (
            <Text className="text-text-muted text-sm ml-1.5">{replyCount}</Text>
          )}
        </Pressable>

        {/* Repost */}
        <Pressable
          onPress={(e) => {
            stopEvent(e);
            handleRepostPress();
          }}
          className="flex-row items-center py-1"
          disabled={isRepostLoading}
          hitSlop={8}
        >
          <Repeat2 size={iconSize} color={repostColor} />
          {repostCount > 0 && (
            <Text className={`text-sm ml-1.5 ${isReposted ? 'text-green-500' : 'text-text-muted'}`}>
              {repostCount}
            </Text>
          )}
        </Pressable>

        {/* Like */}
        <Pressable
          onPress={(e) => {
            stopEvent(e);
            handleLike();
          }}
          className="flex-row items-center py-1"
          disabled={isLikeLoading}
          hitSlop={8}
        >
          <Heart size={iconSize} color={likeColor} fill={isLiked ? '#EF4444' : 'none'} />
          {likeCount > 0 && (
            <Text className={`text-sm ml-1.5 ${isLiked ? 'text-red-500' : 'text-text-muted'}`}>
              {likeCount}
            </Text>
          )}
        </Pressable>

        {/* Share */}
        <Pressable
          onPress={(e) => {
            stopEvent(e);
            handleShare();
          }}
          className="flex-row items-center py-1"
          hitSlop={8}
        >
          <Share size={iconSize} color={mutedColor} />
        </Pressable>

        {/* More Options */}
        {!hideOptions && (
          <Pressable
            onPress={(e) => {
              stopEvent(e);
              handleOptionsPress();
            }}
            className="flex-row items-center py-1"
            hitSlop={8}
          >
            <MoreHorizontal size={iconSize} color={mutedColor} />
          </Pressable>
        )}
      </View>
    ) : (
      // Expanded layout (for ThreadPost detail view)
      <View className="flex-row justify-around py-2 border-b border-border mb-4">
        {/* Reply */}
        <Pressable onPress={handleReply} className="flex-row items-center p-2" hitSlop={8}>
          <MessageCircle size={iconSize} color={mutedColor} />
        </Pressable>

        {/* Repost */}
        <Pressable
          onPress={handleRepostPress}
          className="flex-row items-center p-2"
          disabled={isRepostLoading}
          hitSlop={8}
        >
          <Repeat2 size={iconSize} color={repostColor} />
        </Pressable>

        {/* Like */}
        <Pressable
          onPress={handleLike}
          className="flex-row items-center p-2"
          disabled={isLikeLoading}
          hitSlop={8}
        >
          <Heart size={iconSize} color={likeColor} fill={isLiked ? '#EF4444' : 'transparent'} />
        </Pressable>

        {/* Share */}
        <Pressable onPress={handleShare} className="flex-row items-center p-2" hitSlop={8}>
          <Share size={iconSize} color={mutedColor} />
        </Pressable>

        {/* Options */}
        {!hideOptions && (
          <Pressable onPress={handleOptionsPress} className="flex-row items-center p-2" hitSlop={8}>
            <MoreHorizontal size={iconSize} color={mutedColor} />
          </Pressable>
        )}
      </View>
    );

  return (
    <>
      {actionButtons}

      {/* ========== REPOST MENU MODAL ========== */}
      <Modal
        visible={repostMenuVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setRepostMenuVisible(false)}
      >
        <Pressable className="flex-1 bg-black/50" onPress={() => setRepostMenuVisible(false)} />

        <View className="bg-surface-elevated rounded-t-3xl pb-8 pt-2">
          <View className="items-center py-3">
            <View className="w-10 h-1 bg-zinc-600 rounded-full" />
          </View>

          <View className="px-4 pb-4">
            {/* Repost Option */}
            <Pressable
              onPress={handleRepost}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View
                className={`w-11 h-11 rounded-full items-center justify-center ${isReposted ? 'bg-primary/20' : 'bg-zinc-800'}`}
              >
                <Repeat2 size={22} color={isReposted ? '#10B981' : '#FAFAFA'} />
              </View>
              <View className="flex-1">
                <Text
                  className={`text-lg font-semibold ${isReposted ? 'text-primary' : 'text-text-primary'}`}
                >
                  {isReposted ? 'Undo Repost' : 'Repost'}
                </Text>
                <Text className="text-text-muted text-sm">
                  {isReposted ? 'Remove from your profile' : 'Share to your followers instantly'}
                </Text>
              </View>
            </Pressable>

            {/* Quote Post */}
            {!isReposted && (
              <Pressable
                onPress={handleQuotePost}
                className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
              >
                <View className="w-11 h-11 rounded-full bg-zinc-800 items-center justify-center">
                  <Quote size={22} color="#FAFAFA" />
                </View>
                <View className="flex-1">
                  <Text className="text-text-primary text-lg font-semibold">Quote Post</Text>
                  <Text className="text-text-muted text-sm">
                    Add your thoughts with the original post
                  </Text>
                </View>
              </Pressable>
            )}
          </View>

          <View className="px-4">
            <Pressable
              onPress={() => setRepostMenuVisible(false)}
              className="py-4 rounded-xl bg-zinc-800 items-center active:bg-zinc-700"
            >
              <Text className="text-text-primary font-semibold text-base">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ========== OPTIONS MENU MODAL ========== */}
      <Modal
        visible={optionsMenuVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setOptionsMenuVisible(false)}
      >
        <Pressable className="flex-1 bg-black/50" onPress={() => setOptionsMenuVisible(false)} />

        <View className="bg-surface-elevated rounded-t-3xl pb-8 pt-2">
          <View className="items-center py-3">
            <View className="w-10 h-1 bg-zinc-600 rounded-full" />
          </View>

          <View className="px-4 pb-4">
            {/* Native Share (Web only with Share API) */}
            {canUseNativeShare && (
              <Pressable
                onPress={handleNativeShare}
                className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
              >
                <View className="w-11 h-11 rounded-full bg-emerald-500/20 items-center justify-center">
                  <Share2 size={22} color="#10B981" />
                </View>
                <View className="flex-1">
                  <Text className="text-text-primary text-lg font-semibold">Share</Text>
                  <Text className="text-text-muted text-sm">Share via apps on your device</Text>
                </View>
              </Pressable>
            )}

            {/* Copy Link */}
            <Pressable
              onPress={handleCopyLink}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View className="w-11 h-11 rounded-full bg-zinc-800 items-center justify-center">
                <Link size={22} color="#FAFAFA" />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary text-lg font-semibold">Copy Link</Text>
                <Text className="text-text-muted text-sm">Copy post link to clipboard</Text>
              </View>
            </Pressable>

            {/* Delete (own posts only) */}
            {isOwnPost && (
              <Pressable
                onPress={handleDelete}
                className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
              >
                <View className="w-11 h-11 rounded-full bg-red-500/20 items-center justify-center">
                  <Trash2 size={22} color="#EF4444" />
                </View>
                <View className="flex-1">
                  <Text className="text-red-500 text-lg font-semibold">Delete Post</Text>
                  <Text className="text-text-muted text-sm">Permanently remove this post</Text>
                </View>
              </Pressable>
            )}

            {/* Report (other's posts only) */}
            {!isOwnPost && (
              <Pressable
                onPress={handleReport}
                className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
              >
                <View className="w-11 h-11 rounded-full bg-zinc-800 items-center justify-center">
                  <Flag size={22} color="#FAFAFA" />
                </View>
                <View className="flex-1">
                  <Text className="text-text-primary text-lg font-semibold">Report Post</Text>
                  <Text className="text-text-muted text-sm">Report inappropriate content</Text>
                </View>
              </Pressable>
            )}
          </View>

          <View className="px-4">
            <Pressable
              onPress={() => setOptionsMenuVisible(false)}
              className="py-4 rounded-xl bg-zinc-800 items-center active:bg-zinc-700"
            >
              <Text className="text-text-primary font-semibold text-base">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
});
