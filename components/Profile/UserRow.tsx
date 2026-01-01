/**
 * UserRow - Shared User List Item Component
 *
 * Displays a user/profile in horizontal row format for lists.
 * Used in: Search results, Followers, Following, Suggestions
 *
 * Features:
 * - Avatar with fallback
 * - Display name and handle
 * - Bio preview (2 lines)
 * - Optional FollowButton
 * - Pressable for navigation
 */

import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { FollowButton, FollowingBadge } from '@/components/ui/FollowButton';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
import { getOptimizedAvatarUrl } from '@/lib/utils/avatar';
import type { AppBskyActorDefs } from '@atproto/api';

type ProfileView = AppBskyActorDefs.ProfileView;
type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type AnyProfileView = ProfileView | ProfileViewDetailed;

export interface UserRowProps {
  /** The user profile to display */
  user: AnyProfileView;
  /** Callback when the row is pressed */
  onPress: () => void;
  /** Show follow button (default: true) */
  showFollowButton?: boolean;
  /** Callback after successful follow */
  onFollow?: () => void;
  /** Callback after successful unfollow */
  onUnfollow?: () => void;
  /** Show bio/description (default: true) */
  showBio?: boolean;
  /** Custom right element (replaces follow button) */
  rightElement?: React.ReactNode;
}

export function UserRow({
  user,
  onPress,
  showFollowButton = true,
  onFollow,
  onUnfollow,
  showBio = true,
  rightElement,
}: UserRowProps) {
  const { did: currentUserDid } = useAuthStore();

  const isFollowing = !!user.viewer?.following;
  const isSelf = user.did === currentUserDid;
  const isBlocked = !!user.viewer?.blocking || !!user.viewer?.blockedBy;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 80, opacity: pressed ? 0.7 : 1 })}
      className="flex-row items-center px-4 py-3 min-h-[80px] border-b border-border"
      hitSlop={4}
    >
      {/* Avatar */}
      {user.avatar ? (
        <Image
          source={{ uri: getOptimizedAvatarUrl(user.avatar, 48) }}
          className="w-12 h-12 rounded-full"
          contentFit="cover"
        />
      ) : (
        <View className="w-12 h-12 rounded-full bg-surface-elevated items-center justify-center">
          <Text className="text-text-muted text-lg">{(user.handle || '?')[0].toUpperCase()}</Text>
        </View>
      )}

      {/* User Info */}
      <View className="flex-1 ml-3">
        <Text className="font-semibold text-text-primary" numberOfLines={1}>
          {user.displayName || user.handle}
        </Text>
        <Text className="text-text-muted" numberOfLines={1}>
          @{user.handle}
        </Text>
        {showBio && user.description && (
          <Text className="text-text-secondary text-sm mt-1" numberOfLines={2}>
            {user.description}
          </Text>
        )}
      </View>

      {/* Right Side: Follow Button or Custom Element */}
      <View className="ml-2">
        {rightElement ? (
          rightElement
        ) : showFollowButton && !isSelf && !isBlocked ? (
          <FollowButton profile={user} size="small" onFollow={onFollow} onUnfollow={onUnfollow} />
        ) : isFollowing && !isSelf ? (
          <FollowingBadge size="small" />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Compact UserRow variant for tighter lists
 */
export function UserRowCompact({
  user,
  onPress,
  showFollowButton = true,
  onFollow,
}: Omit<UserRowProps, 'showBio'>) {
  return (
    <UserRow
      user={user}
      onPress={onPress}
      showFollowButton={showFollowButton}
      onFollow={onFollow}
      showBio={false}
    />
  );
}

export default UserRow;
