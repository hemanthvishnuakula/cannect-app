/**
 * FollowButton - Shared Follow/Unfollow Button Component
 *
 * Based on official Bluesky design patterns.
 * Features:
 * - Follow / Unfollow / Follow back states
 * - Block check (hides button if blocked)
 * - Toast confirmations
 * - Haptic feedback
 * - Loading state
 */

import { useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Platform } from 'react-native';
import { UserPlus, UserMinus, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useFollow, useUnfollow } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
import type { AppBskyActorDefs } from '@atproto/api';

type ProfileView = AppBskyActorDefs.ProfileView;
type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type AnyProfileView = ProfileView | ProfileViewDetailed;

export interface FollowButtonProps {
  /** The user profile to follow/unfollow */
  profile: AnyProfileView;
  /** Button size variant */
  size?: 'small' | 'medium' | 'large';
  /** Show full text or just icon */
  variant?: 'full' | 'icon-only';
  /** Callback after successful follow */
  onFollow?: () => void;
  /** Callback after successful unfollow */
  onUnfollow?: () => void;
}

const triggerHaptic = () => {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
};

export function FollowButton({
  profile,
  size = 'medium',
  variant = 'full',
  onFollow,
  onUnfollow,
}: FollowButtonProps) {
  const { did: currentUserDid } = useAuthStore();
  const queryClient = useQueryClient();
  const followMutation = useFollow();
  const unfollowMutation = useUnfollow();

  const isFollowing = !!profile.viewer?.following;
  const isFollowedBy = !!profile.viewer?.followedBy;
  const isBlocked = !!profile.viewer?.blocking || !!profile.viewer?.blockedBy;
  const isSelf = profile.did === currentUserDid;
  const isPending = followMutation.isPending || unfollowMutation.isPending;

  const handlePress = useCallback(async () => {
    triggerHaptic();

    try {
      if (isFollowing && profile.viewer?.following) {
        await unfollowMutation.mutateAsync(profile.viewer.following);
        onUnfollow?.();
      } else {
        await followMutation.mutateAsync(profile.did);
        onFollow?.();
      }
      
      // Wait a moment for Bluesky to propagate, then refresh profile data
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['profile', profile.handle] });
        queryClient.invalidateQueries({ queryKey: ['profile', profile.did] });
      }, 500);
    } catch (error) {
      console.error('Follow action failed:', error);
    }
  }, [
    isFollowing,
    profile.did,
    profile.handle,
    profile.viewer?.following,
    followMutation,
    unfollowMutation,
    queryClient,
    onFollow,
    onUnfollow,
  ]);

  // Don't render if it's the current user or blocked
  if (isSelf || isBlocked) {
    return null;
  }

  // Size styles
  const sizeStyles = {
    small: 'px-3 py-1.5',
    medium: 'px-4 py-2',
    large: 'px-5 py-2.5',
  };

  const iconSize = {
    small: 14,
    medium: 16,
    large: 18,
  };

  const textSize = {
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-base',
  };

  // Determine button state and styling
  const getButtonContent = () => {
    if (isPending) {
      return (
        <ActivityIndicator
          size="small"
          color={isFollowing ? '#6B7280' : '#FFFFFF'}
        />
      );
    }

    if (isFollowing) {
      // Following state - secondary style
      return (
        <>
          {variant === 'full' ? (
            <UserMinus size={iconSize[size]} color="#6B7280" />
          ) : (
            <Check size={iconSize[size]} color="#10B981" />
          )}
          {variant === 'full' && (
            <Text className={`ml-1 font-semibold text-text-muted ${textSize[size]}`}>
              Following
            </Text>
          )}
        </>
      );
    }

    // Follow state - primary style
    return (
      <>
        <UserPlus size={iconSize[size]} color="#FFFFFF" />
        {variant === 'full' && (
          <Text className={`ml-1 font-semibold text-white ${textSize[size]}`}>
            {isFollowedBy ? 'Follow back' : 'Follow'}
          </Text>
        )}
      </>
    );
  };

  const buttonClass = isFollowing
    ? `bg-surface-elevated border border-border ${sizeStyles[size]} rounded-full flex-row items-center`
    : `bg-primary ${sizeStyles[size]} rounded-full flex-row items-center`;

  return (
    <Pressable
      onPress={handlePress}
      disabled={isPending}
      className={`${buttonClass} ${isPending ? 'opacity-50' : ''} active:opacity-70`}
    >
      {getButtonContent()}
    </Pressable>
  );
}

/**
 * Compact "Following" badge (read-only, no action)
 */
export function FollowingBadge({ size = 'small' }: { size?: 'small' | 'medium' }) {
  const iconSize = size === 'small' ? 12 : 14;
  const textClass = size === 'small' ? 'text-xs' : 'text-sm';
  const paddingClass = size === 'small' ? 'px-2 py-1' : 'px-3 py-1.5';

  return (
    <View className={`flex-row items-center gap-1 ${paddingClass} rounded-full bg-surface-elevated`}>
      <Check size={iconSize} color="#10B981" />
      <Text className={`text-primary font-medium ${textClass}`}>Following</Text>
    </View>
  );
}

export default FollowButton;
