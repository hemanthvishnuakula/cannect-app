import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import { BadgeCheck, Globe2 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Avatar } from "@/components/ui/Avatar";
import { useFollowUser, useUnfollowUser, useIsFollowing } from "@/lib/hooks";
import type { Profile } from "@/lib/types/database";

// Extended profile type with pre-enriched is_following
interface EnrichedProfile extends Profile {
  is_following?: boolean;
}

interface ProfileRowProps {
  profile: EnrichedProfile | any; // Allow federated profiles too
  showFollowButton?: boolean;
  isFederated?: boolean;
  onPress?: () => void;
}

export function ProfileRow({ 
  profile, 
  showFollowButton = true, 
  isFederated = false,
  onPress 
}: ProfileRowProps) {
  // ✅ Use pre-enriched is_following if available, fallback to query
  const hasEnrichedFollowStatus = profile.is_following !== undefined;
  const { data: queryIsFollowing } = useIsFollowing(
    hasEnrichedFollowStatus || isFederated ? "" : profile.id
  );
  const isFollowing = hasEnrichedFollowStatus ? profile.is_following : queryIsFollowing;
  
  const followUser = useFollowUser();
  const unfollowUser = useUnfollowUser();
  const isPending = followUser.isPending || unfollowUser.isPending;

  const handleFollow = () => {
    if (isFederated) return; // Can't follow federated users directly
    
    // ✅ Haptic feedback on follow/unfollow
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    if (isFollowing) {
      unfollowUser.mutate(profile.id);
    } else {
      followUser.mutate(profile.id);
    }
  };

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (!isFederated) {
      router.push(`/user/${profile.username}` as any);
    }
    // Federated profiles need custom handling via onPress
  };

  const displayName = profile.display_name || profile.username;
  const handle = profile.username || profile.handle;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 py-3 px-1 active:opacity-70"
    >
      <Avatar
        url={profile.avatar_url}
        name={displayName}
        size={48}
      />

      <View className="flex-1">
        <View className="flex-row items-center gap-1.5 flex-wrap">
          <Text className="text-text-primary font-semibold" numberOfLines={1}>
            {displayName}
          </Text>
          {profile.is_verified && (
            <BadgeCheck size={16} color="#10B981" fill="#10B981" />
          )}
          {isFederated && (
            <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full">
              <Globe2 size={10} color="#3B82F6" />
              <Text className="text-[10px] text-blue-500 font-medium">Global</Text>
            </View>
          )}
        </View>
        <Text className="text-text-muted">@{handle}</Text>
        {profile.bio && (
          <Text className="text-text-secondary text-sm mt-0.5" numberOfLines={2}>
            {profile.bio}
          </Text>
        )}
        {isFederated && (profile.followers_count > 0 || profile.following_count > 0) && (
          <Text className="text-text-muted text-xs mt-1">
            {profile.followers_count?.toLocaleString()} followers · {profile.following_count?.toLocaleString()} following
          </Text>
        )}
      </View>

      {showFollowButton && !isFederated && (
        <Pressable
          onPress={handleFollow}
          disabled={isPending}
          className={`px-4 py-2 rounded-full min-w-[90px] items-center justify-center ${
            isFollowing
              ? "border border-border"
              : "bg-primary"
          }`}
        >
          {isPending ? (
            <ActivityIndicator 
              size="small" 
              color={isFollowing ? "#6B7280" : "white"} 
            />
          ) : (
            <Text
              className={`font-medium ${
                isFollowing ? "text-text-primary" : "text-white"
              }`}
            >
              {isFollowing ? "Following" : "Follow"}
            </Text>
          )}
        </Pressable>
      )}

      {isFederated && (
        <View className="px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10">
          <Text className="text-xs font-medium text-blue-500">View</Text>
        </View>
      )}
    </Pressable>
  );
}
