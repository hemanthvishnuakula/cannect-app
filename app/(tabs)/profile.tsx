import { View, Text, ActivityIndicator, Pressable, Platform } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { RefreshCw } from "lucide-react-native";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/lib/stores";
import { useProfile, useUserPosts, useSignOut, ProfileTab } from "@/lib/hooks";
import { ProfileHeader, UnifiedFeedItem, RepostMenu, PostOptionsMenu } from "@/components/social";
import { MediaGridItem } from "@/components/Profile";
import { fromLocalPost, type UnifiedPost } from "@/lib/types/unified-post";
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

  const rawPosts = postsData?.pages?.flat() || [];
  
  // Convert posts to UnifiedPost format
  const posts = rawPosts.map((post: any) => fromLocalPost(post, user?.id));

  // Menu state
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [repostMenuPost, setRepostMenuPost] = useState<UnifiedPost | null>(null);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [optionsMenuPost, setOptionsMenuPost] = useState<UnifiedPost | null>(null);

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
      // For media tab, item is raw post, not UnifiedPost
      const rawPost = rawPosts.find((p: any) => p.id === item.localId) || item;
      return <MediaGridItem item={rawPost} />;
    }
    
    return (
      <UnifiedFeedItem 
        post={item}
        onRepostMenu={(post) => {
          setRepostMenuPost(post);
          setRepostMenuVisible(true);
        }}
        onMoreMenu={(post) => {
          if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setOptionsMenuPost(post);
          setOptionsMenuVisible(true);
        }}
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
          data={activeTab === 'media' ? rawPosts : posts}
          keyExtractor={(item: any, index) => {
            // For media tab, use raw post ID; for others use unified post uri
            if (activeTab === 'media') {
              return `media-${item.id}-${index}`;
            }
            return `${activeTab}-${item.uri}-${index}`;
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
      
      {/* Repost Menu */}
      <RepostMenu
        isVisible={repostMenuVisible}
        onClose={() => setRepostMenuVisible(false)}
        onRepost={() => {}}
        onQuotePost={() => {
          if (repostMenuPost?.localId) {
            router.push(`/compose/quote?postId=${repostMenuPost.localId}` as any);
          }
        }}
        isReposted={repostMenuPost?.viewer?.isReposted === true}
      />
      
      {/* Post Options Menu */}
      <PostOptionsMenu
        isVisible={optionsMenuVisible}
        onClose={() => setOptionsMenuVisible(false)}
        onDelete={() => {}}
        isOwnPost={true}
        postUrl={optionsMenuPost?.localId ? `https://cannect.app/post/${optionsMenuPost.localId}` : undefined}
        isReply={optionsMenuPost?.type === "reply"}
      />
    </SafeAreaView>
  );
}
