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
  Upload,
  Pin,
  Rocket,
  Eye,
} from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { triggerImpact, triggerNotification } from '@/lib/utils/haptics';
import {
  useLikePost,
  useUnlikePost,
  useRepost,
  useDeleteRepost,
  useDeletePost,
  useIsPinnedPost,
  usePinPost,
  useUnpinPost,
  useIsPostBoosted,
  useBoostPost,
  useUnboostPost,
  usePostViewCount,
  formatViewCount,
} from '../../lib/hooks';
import { useAuthStore } from '../../lib/stores';
import * as atproto from '../../lib/atproto/agent';
import type { ReportReason } from '../../lib/atproto/agent';
import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';
import { ShareToDMModal } from '../messages';

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

// Haptic helper - uses the unified utility
const triggerHaptic = (style: 'light' | 'medium' | 'heavy' = 'light') => {
  triggerImpact(style);
};

// Stop event propagation helper (works on web and native)
// Note: Only stopPropagation is needed - preventDefault breaks click detection on web
const stopEvent = (e: any) => {
  e?.stopPropagation?.();
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
  const pinMutation = usePinPost();
  const unpinMutation = useUnpinPost();
  const boostMutation = useBoostPost();
  const unboostMutation = useUnboostPost();

  // Check if this post is pinned (only for own posts)
  const isOwnPost = post.author.did === currentUserDid;
  const { data: isPinned } = useIsPinnedPost(isOwnPost ? post.uri : undefined);
  const { data: boostStatus } = useIsPostBoosted(isOwnPost ? post.uri : undefined);
  const isBoosted = boostStatus?.boosted || false;

  // Fetch view count for this post
  const { data: viewStats } = usePostViewCount(post.uri);
  const viewCount = viewStats?.totalViews || 0;

  // Local state
  const [isLikeLoading, setIsLikeLoading] = useState(false);
  const [isRepostLoading, setIsRepostLoading] = useState(false);
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [shareToDMVisible, setShareToDMVisible] = useState(false);

  // Derived state
  const isLiked = !!post.viewer?.like;
  const isReposted = !!post.viewer?.repost;
  const likeCount = post.likeCount || 0;
  const repostCount = post.repostCount || 0;
  const replyCount = post.replyCount || 0;
  const record = post.record as AppBskyFeedPost.Record;

  // Build post URL
  const getPostUrl = useCallback(() => {
    const parts = post.uri.split('/');

    const rkey = parts[4];
    return `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
  }, [post]);

  // Handle like toggle
  const handleLike = useCallback(async () => {
    // Prevent double-tap: check both local and mutation pending state
    if (isLikeLoading || likeMutation.isPending || unlikeMutation.isPending) return;
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
    // Prevent double-tap: check both local and mutation pending state
    if (isRepostLoading || repostMutation.isPending || unrepostMutation.isPending) return;
    triggerHaptic('medium');
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

  // Handle reply - navigate to thread view where user can see context and reply
  const handleReply = useCallback(() => {
    triggerHaptic();
    const parts = post.uri.split('/');
    const did = parts[2];
    const rkey = parts[4];

    router.push(`/post/${did}/${rkey}`);
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

  // Open share to DM modal
  const handleSendToDM = useCallback(() => {
    triggerHaptic();
    setShareToDMVisible(true);
  }, []);

  // Copy link to clipboard
  const handleCopyLink = useCallback(async () => {
    triggerHaptic();
    const url = getPostUrl();
    await Clipboard.setStringAsync(url);
    setOptionsMenuVisible(false);
  }, [getPostUrl]);

  // Pin/Unpin post to profile
  const handlePinToggle = useCallback(async () => {
    triggerHaptic();
    setOptionsMenuVisible(false);

    try {
      if (isPinned) {
        await unpinMutation.mutateAsync();
        triggerNotification('success');
      } else {
        await pinMutation.mutateAsync(post.uri);
        triggerNotification('success');
      }
    } catch (error: any) {
      console.error('[Pin] Failed to pin/unpin post:', error);
      triggerNotification('error');
      const message = error?.message || 'Failed to update pinned post. Please try again.';
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Error', message);
      }
    }
  }, [isPinned, post.uri, pinMutation, unpinMutation]);

  // Boost/Unboost post for visibility
  const handleBoostToggle = useCallback(async () => {
    triggerHaptic();
    setOptionsMenuVisible(false);

    try {
      if (isBoosted) {
        const result = await unboostMutation.mutateAsync(post.uri);
        if (!result.success) {
          throw new Error(result.error);
        }
        triggerNotification('success');
      } else {
        const result = await boostMutation.mutateAsync(post.uri);
        if (!result.success) {
          throw new Error(result.error);
        }
        triggerNotification('success');
        // Show success message
        const message = 'Post boosted for 24 hours! It will appear more frequently in feeds.';
        if (Platform.OS === 'web') {
          window.alert(message);
        } else {
          Alert.alert('🚀 Post Boosted!', message);
        }
      }
    } catch (error: any) {
      console.error('[Boost] Failed to boost/unboost post:', error);
      triggerNotification('error');
      const message = error?.message || 'Failed to boost post. Please try again.';
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert('Error', message);
      }
    }
  }, [isBoosted, post.uri, boostMutation, unboostMutation]);

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

  // Delete post with confirmation
  const handleDelete = useCallback(() => {
    triggerHaptic('heavy');
    setOptionsMenuVisible(false);

    const performDelete = async () => {
      try {
        await deletePostMutation.mutateAsync(post.uri);
        triggerNotification('success');
      } catch (error: any) {
        console.error('[Delete] Failed to delete post:', error);
        const message = error?.message || 'Failed to delete post. Please try again.';
        triggerNotification('error');
        if (Platform.OS === 'web') {
          window.alert(message);
        } else {
          Alert.alert('Error', message);
        }
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Delete this post? This cannot be undone.')) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Delete Post',
        'Are you sure you want to delete this post? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: performDelete },
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

  // Icon sizes based on variant (smaller to not compete with author name)
  const iconSize = variant === 'compact' ? 18 : 20;
  const repostIconSize = variant === 'compact' ? 20 : 22; // Slightly larger for visual balance

  // Shared hitSlop for all buttons
  const buttonHitSlop = { top: 12, bottom: 12, left: 12, right: 12 };
  const mutedColor = '#6B7280';
  const likeColor = isLiked ? '#EF4444' : mutedColor;
  const repostColor = isReposted ? '#10B981' : mutedColor;
  const canUseNativeShare = canShare();

  // Action buttons JSX
  const actionButtons =
    variant === 'compact' ? (
      <View className="flex-row items-center justify-around mt-1 -mb-1">
        {/* Reply */}
        <Pressable
          onPressIn={stopEvent}
          onPress={(e) => {
            stopEvent(e);
            handleReply();
          }}
          className="flex-row items-center justify-center p-2 min-w-[44px] min-h-[44px]"
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <MessageCircle size={iconSize} color={mutedColor} strokeWidth={1.5} />
          {!hideReplyCounts && (
            <Text className="text-text-muted text-sm ml-1.5 min-w-[16px]">
              {replyCount > 0 ? replyCount : ''}
            </Text>
          )}
        </Pressable>

        {/* Repost */}
        <Pressable
          onPressIn={stopEvent}
          onPress={(e) => {
            stopEvent(e);
            handleRepostPress();
          }}
          className="flex-row items-center justify-center p-2 min-w-[44px] min-h-[44px]"
          disabled={isRepostLoading}
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Repeat2 size={repostIconSize} color={repostColor} strokeWidth={1.5} />
          <Text
            className={`text-sm ml-1.5 min-w-[16px] ${isReposted ? 'text-green-500' : 'text-text-muted'}`}
          >
            {repostCount > 0 ? repostCount : ''}
          </Text>
        </Pressable>

        {/* Like */}
        <Pressable
          onPressIn={stopEvent}
          onPress={(e) => {
            stopEvent(e);
            handleLike();
          }}
          className="flex-row items-center justify-center p-2 min-w-[44px] min-h-[44px]"
          disabled={isLikeLoading}
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Heart
            size={iconSize}
            color={likeColor}
            fill={isLiked ? '#EF4444' : 'none'}
            strokeWidth={1.5}
          />
          <Text
            className={`text-sm ml-1.5 min-w-[16px] ${isLiked ? 'text-red-500' : 'text-text-muted'}`}
          >
            {likeCount > 0 ? likeCount : ''}
          </Text>
        </Pressable>

        {/* View Count */}
        <View className="flex-row items-center justify-center p-2 min-w-[44px] min-h-[44px]">
          <Eye size={iconSize} color={mutedColor} strokeWidth={1.5} />
          <Text className="text-text-muted text-sm ml-1.5 min-w-[16px]">
            {viewCount > 0 ? formatViewCount(viewCount) : ''}
          </Text>
        </View>

        {/* Share */}
        <Pressable
          onPressIn={stopEvent}
          onPress={(e) => {
            stopEvent(e);
            handleSendToDM();
          }}
          className="flex-row items-center justify-center p-2 min-w-[44px] min-h-[44px]"
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Upload size={iconSize} color={mutedColor} strokeWidth={1.5} />
        </Pressable>

        {/* More Options (includes Share, Copy Link, Delete, Report) */}
        {!hideOptions && (
          <Pressable
            onPressIn={stopEvent}
            onPress={(e) => {
              stopEvent(e);
              handleOptionsPress();
            }}
            className="flex-row items-center justify-center p-2 min-w-[44px] min-h-[44px] -mr-2"
            hitSlop={buttonHitSlop}
            android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <MoreHorizontal size={iconSize} color={mutedColor} strokeWidth={1.5} />
          </Pressable>
        )}
      </View>
    ) : (
      // Expanded layout (for ThreadPost detail view) - with counts like compact
      <View className="flex-row justify-around py-2 mt-3">
        {/* Reply */}
        <Pressable
          onPressIn={stopEvent}
          onPress={handleReply}
          className="flex-row items-center justify-center p-3 min-w-[48px] min-h-[48px]"
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <MessageCircle size={iconSize} color={mutedColor} strokeWidth={1.5} />
          <Text className="text-text-muted text-sm ml-1.5 min-w-[16px]">
            {replyCount > 0 ? replyCount : ''}
          </Text>
        </Pressable>

        {/* Repost */}
        <Pressable
          onPressIn={stopEvent}
          onPress={handleRepostPress}
          className="flex-row items-center justify-center p-3 min-w-[48px] min-h-[48px]"
          disabled={isRepostLoading}
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Repeat2 size={repostIconSize} color={repostColor} strokeWidth={1.5} />
          <Text
            className={`text-sm ml-1.5 min-w-[16px] ${isReposted ? 'text-green-500' : 'text-text-muted'}`}
          >
            {repostCount > 0 ? repostCount : ''}
          </Text>
        </Pressable>

        {/* Like */}
        <Pressable
          onPressIn={stopEvent}
          onPress={handleLike}
          className="flex-row items-center justify-center p-3 min-w-[48px] min-h-[48px]"
          disabled={isLikeLoading}
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Heart
            size={iconSize}
            color={likeColor}
            fill={isLiked ? '#EF4444' : 'none'}
            strokeWidth={1.5}
          />
          <Text
            className={`text-sm ml-1.5 min-w-[16px] ${isLiked ? 'text-red-500' : 'text-text-muted'}`}
          >
            {likeCount > 0 ? likeCount : ''}
          </Text>
        </Pressable>

        {/* View Count */}
        <View className="flex-row items-center justify-center p-3 min-w-[48px] min-h-[48px]">
          <Eye size={iconSize} color={mutedColor} strokeWidth={1.5} />
          <Text className="text-text-muted text-sm ml-1.5 min-w-[16px]">
            {viewCount > 0 ? formatViewCount(viewCount) : ''}
          </Text>
        </View>

        {/* Share */}
        <Pressable
          onPressIn={stopEvent}
          onPress={handleSendToDM}
          className="flex-row items-center justify-center p-3 min-w-[48px] min-h-[48px]"
          hitSlop={buttonHitSlop}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Upload size={iconSize} color={mutedColor} strokeWidth={1.5} />
        </Pressable>

        {/* Options (includes Share, Copy Link, Delete, Report) */}
        {!hideOptions && (
          <Pressable
            onPressIn={stopEvent}
            onPress={handleOptionsPress}
            className="flex-row items-center justify-center p-3 min-w-[48px] min-h-[48px]"
            hitSlop={buttonHitSlop}
            android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <MoreHorizontal size={iconSize} color={mutedColor} strokeWidth={1.5} />
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

            {/* Pin/Unpin (own posts only) */}
            {isOwnPost && (
              <Pressable
                onPress={handlePinToggle}
                className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
              >
                <View
                  className={`w-11 h-11 rounded-full items-center justify-center ${isPinned ? 'bg-primary/20' : 'bg-zinc-800'}`}
                >
                  <Pin size={22} color={isPinned ? '#10B981' : '#FAFAFA'} />
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-lg font-semibold ${isPinned ? 'text-primary' : 'text-text-primary'}`}
                  >
                    {isPinned ? 'Unpin from Profile' : 'Pin to Profile'}
                  </Text>
                  <Text className="text-text-muted text-sm">
                    {isPinned ? 'Remove from top of your profile' : 'Show at top of your profile'}
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Boost Post (own posts only) */}
            {isOwnPost && (
              <Pressable
                onPress={handleBoostToggle}
                className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
              >
                <View
                  className={`w-11 h-11 rounded-full items-center justify-center ${isBoosted ? 'bg-orange-500/20' : 'bg-zinc-800'}`}
                >
                  <Rocket size={22} color={isBoosted ? '#F97316' : '#FAFAFA'} />
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-lg font-semibold ${isBoosted ? 'text-orange-500' : 'text-text-primary'}`}
                  >
                    {isBoosted ? 'Remove Boost' : 'Boost Post'}
                  </Text>
                  <Text className="text-text-muted text-sm">
                    {isBoosted ? 'Stop promoting this post' : 'Show more in feeds for 24 hours'}
                  </Text>
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

      {/* ========== SHARE TO DM MODAL ========== */}
      <ShareToDMModal
        visible={shareToDMVisible}
        onClose={() => setShareToDMVisible(false)}
        postUri={post.uri}
        postCid={post.cid}
        postText={record.text}
        authorHandle={post.author.handle}
      />
    </>
  );
});
