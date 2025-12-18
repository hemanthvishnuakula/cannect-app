import { View, Text, ActivityIndicator, Pressable, Platform } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { RefreshCw } from "lucide-react-native";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/lib/stores";
import { useProfile, useUserPosts, useSignOut, ProfileTab } from "@/lib/hooks";
import { ProfileHeader } from "@/components/social";
import { SocialPost } from "@/components/social";
import { MediaGridItem } from "@/components/Profile";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { SkeletonProfile, SkeletonCard } from "@/components/ui/Skeleton";

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const signOut = useSignOut();
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');

  // Fetch Profile & Posts with tab filtering
  const { 
    data: profile, 
    isLoading: isProfileLoading,
    isError: isProfileError,
    refetch: refetchProfile,
  } = useProfile(user?.id ?? "");
  const { 
    data: postsData, 
    isLoading: isPostsLoading, 
    fetchNextPage, 
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchPosts,
    isRefetching,
  } = useUserPosts(user?.id ?? "", activeTab);

  const posts = postsData?.pages?.flat() || [];

  const handleSignOut = async () => {
    await signOut.mutateAsync();
    router.replace("/(auth)/welcome");
  };

  const handleEditProfile = () => {
    router.push("/settings/edit-profile" as any);
  };

  // ✅ Pull-to-refresh handler with haptic feedback
  const handleRefresh = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    refetchProfile();
    refetchPosts();
  };

  // Render item based on active tab
  const renderItem = ({ item }: { item: any }) => {
    if (activeTab === 'media') {
      return <MediaGridItem item={item} />;
    }
    
    return (
      <SocialPost 
        post={item}
        onPress={() => router.push(`/post/${item.id}` as any)}
        onProfilePress={() => {}} // Already on profile
        showThreadContext={activeTab === 'replies'}
      />
    );
  };

  // ✅ Platinum Loading State: Skeleton Shimmer
  if (isProfileLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <SkeletonProfile />
        <SkeletonCard />
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  // ✅ Error State with Retry
  if (isProfileError || !profile) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-6" edges={["top"]}>
        <Text className="text-text-primary text-lg font-semibold mb-2">
          Failed to load profile
        </Text>
        <Text className="text-text-muted text-center mb-6">
          Please check your connection and try again.
        </Text>
        <Pressable 
          onPress={() => refetchProfile()}
          className="flex-row items-center gap-2 bg-primary px-6 py-3 rounded-full active:opacity-80"
        >
          <RefreshCw size={18} color="white" />
          <Text className="text-white font-semibold">Retry</Text>
        </Pressable>
        <View className="mt-8">
          <Button variant="ghost" onPress={handleSignOut}>
            <Text className="text-accent-error">Sign Out</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* ✅ Platinum: Header stays mounted, only list content changes */}
      <ProfileHeader 
        profile={profile!} 
        isCurrentUser={true}
        onEditPress={handleEditProfile}
        onFollowersPress={() => router.push({ 
          pathname: `/user/${profile!.username}/relationships` as any,
          params: { type: 'followers' }
        })}
        onFollowingPress={() => router.push({ 
          pathname: `/user/${profile!.username}/relationships` as any,
          params: { type: 'following' }
        })}
      />
      
      {/* ✅ Platinum Tab Bar - outside FlashList for stability */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProfileTab)}>
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="replies">Replies</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
        </TabsList>
      </Tabs>
      
      <View style={{ flex: 1, minHeight: 2 }}>
        <FlashList
          key={activeTab === 'media' ? 'grid' : 'list'}
          data={posts}
          keyExtractor={(item, index) => {
            // Create truly unique key for reposts vs originals
            const isRepost = item.type === 'repost' || item.is_repost;
            const reposterId = isRepost ? item.user_id : null;
            return `${activeTab}-${item.id}-${reposterId || 'orig'}-${index}`;
          }}
          numColumns={activeTab === 'media' ? 3 : 1}
          estimatedItemSize={activeTab === 'media' ? 120 : 200}
          renderItem={renderItem}
          
          // ✅ Pull-to-refresh
          refreshing={isRefetching}
          onRefresh={handleRefresh}

          // Empty State
          ListEmptyComponent={
            <View className="py-20 items-center px-10 gap-4">
              <Text className="text-text-muted text-center text-lg font-medium">
                {activeTab === 'posts' && "You haven't shared your first post yet!"}
                {activeTab === 'replies' && "You haven't replied to anyone yet."}
                {activeTab === 'media' && "Your shared media will appear here."}
              </Text>
              {activeTab === 'posts' && (
                <Text className="text-text-secondary text-sm text-center">
                  Share your first thought with the community!
                </Text>
              )}
              <View className="mt-8">
                <Button variant="ghost" onPress={handleSignOut}>
                  <Text className="text-accent-error">Sign Out</Text>
                </Button>
              </View>
            </View>
          }

          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#10B981" />
              </View>
            ) : null
          }

          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      </View>
    </SafeAreaView>
  );
}
