import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Share, Link as LinkIcon, Calendar, Globe2, ExternalLink } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/date";
import type { Profile } from "@/lib/types/database";

interface ProfileHeaderProps {
  profile: Profile;
  isCurrentUser?: boolean;
  isFollowing?: boolean;
  isFollowPending?: boolean; // ✅ Loading state for follow button
  isExternal?: boolean; // ✅ External Bluesky user
  onEditPress?: () => void;
  onFollowPress?: () => void;
  onSharePress?: () => void;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

export function ProfileHeader({ 
  profile, 
  isCurrentUser,
  isFollowing,
  isFollowPending,
  isExternal,
  onEditPress,
  onFollowPress,
  onSharePress,
  onFollowersPress,
  onFollowingPress
}: ProfileHeaderProps) {
  // Federation-ready: Use banner_url instead of cover_url
  const coverUrl = profile.banner_url;

  return (
    <View className="bg-background border-b border-border pb-2">
      {/* Cover Image Area - shows custom cover or gradient fallback */}
      <View className="h-32 bg-surface w-full relative">
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={coverUrl}
          />
        ) : (
          <View className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-surface" />
        )}
        {/* Subtle gradient overlay for readability */}
        <View className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <View className="absolute bottom-2 right-4 flex-row gap-2">
          <Pressable 
            className="bg-black/50 p-2 rounded-full"
            onPress={onSharePress}
          >
            <Share size={16} color="white" />
          </Pressable>
        </View>
      </View>

      <View className="px-4">
        {/* Header Row: Avatar + Actions */}
        <View className="flex-row justify-between items-end -mt-10 mb-3">
          {/* ✅ Platinum: Stable Avatar with caching - prevents flicker */}
          <View className="rounded-full border-4 border-background bg-background overflow-hidden">
            <Avatar 
              url={profile.avatar_url ?? undefined} 
              name={profile.display_name || profile.username || ''} 
              size={80} 
            />
          </View>
          
          <View className="flex-row gap-2 pb-1">
            {isCurrentUser ? (
              <Button 
                variant="secondary" 
                size="sm"
                onPress={onEditPress}
              >
                Edit Profile
              </Button>
            ) : (
              <Button 
                variant={isFollowing ? "secondary" : "primary"}
                size="sm"
                onPress={onFollowPress}
                disabled={isFollowPending}
              >
                {isFollowPending ? (
                  <ActivityIndicator size="small" color={isFollowing ? "#6B7280" : "white"} />
                ) : (
                  isFollowing ? "Following" : "Follow"
                )}
              </Button>
            )}
          </View>
        </View>

        {/* Info Section */}
        <View className="gap-1 mb-4">
          <View className="flex-row items-center gap-2">
            <Text className="text-2xl font-bold text-text-primary">
              {profile.display_name || profile.username}
            </Text>
            {profile.is_verified && (
              <View className="bg-primary rounded-full p-0.5">
                <Text className="text-white text-xs">✓</Text>
              </View>
            )}
            {isExternal && (
              <View className="flex-row items-center gap-1 bg-blue-500/20 px-2 py-0.5 rounded-full">
                <Globe2 size={12} color="#3B82F6" />
                <Text className="text-xs text-blue-500 font-medium">Bluesky</Text>
              </View>
            )}
          </View>
          <Text className="text-text-muted text-base">
            @{(profile as any).handle || profile.username}
          </Text>
        </View>

        {/* Bio */}
        {profile.bio && (
          <Text className="text-text-primary text-base leading-5 mb-4">
            {profile.bio}
          </Text>
        )}

        {/* Metadata Row */}
        <View className="flex-row flex-wrap gap-x-4 gap-y-2 mb-4">
          {profile.website && (
            <View className="flex-row items-center gap-1">
              <LinkIcon size={14} color="#6B7280" />
              <Text className="text-primary text-sm">{profile.website}</Text>
            </View>
          )}
          <View className="flex-row items-center gap-1">
            <Calendar size={14} color="#6B7280" />
            <Text className="text-text-muted text-sm">
              Joined {formatDate(new Date(profile.created_at || Date.now()))}
            </Text>
          </View>
        </View>

        {/* Stats Row - ✅ Platinum: Now navigable */}
        <View className="flex-row gap-5 mb-2">
          <Pressable 
            onPress={onFollowingPress} 
            className="flex-row items-center gap-1 active:opacity-60"
          >
            <Text className="font-bold text-text-primary">{profile.following_count || 0}</Text>
            <Text className="text-text-muted">Following</Text>
            {isExternal && <ExternalLink size={12} color="#6B7280" />}
          </Pressable>
          <Pressable 
            onPress={onFollowersPress} 
            className="flex-row items-center gap-1 active:opacity-60"
          >
            <Text className="font-bold text-text-primary">{profile.followers_count || 0}</Text>
            <Text className="text-text-muted">Followers</Text>
            {isExternal && <ExternalLink size={12} color="#6B7280" />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Tabs Component - Exported for use by parent screens
interface ProfileTabsProps {
  activeTab: "posts" | "replies" | "media";
  onTabChange?: (tab: "posts" | "replies" | "media") => void;
}

function ProfileTabs({ activeTab, onTabChange }: ProfileTabsProps) {
  const tabs = [
    { key: "posts" as const, label: "Posts" },
    { key: "replies" as const, label: "Replies" },
    { key: "media" as const, label: "Media" },
  ];

  return (
    <View className="flex-row border-b border-border bg-background">
      {tabs.map((tab) => (
        <Pressable 
          key={tab.key}
          className={cn(
            "flex-1 items-center py-3",
            activeTab === tab.key && "border-b-2 border-primary"
          )}
          onPress={() => onTabChange?.(tab.key)}
        >
          <Text className={cn(
            "font-medium",
            activeTab === tab.key ? "text-text-primary font-bold" : "text-text-muted"
          )}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export { ProfileTabs };
