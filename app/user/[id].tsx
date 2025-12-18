import { View, Alert, Text, Platform, ActivityIndicator, Pressable } from "react-native";
import { useState } from "react";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { RefreshCw } from "lucide-react-native";
import { useProfileByUsername, useUserPosts, useLikePost, useUnlikePost, useToggleRepost, useDeletePost, useFollowUser, useUnfollowUser, useIsFollowing, ProfileTab } from "@/lib/hooks";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { SocialPost } from "@/components/social/SocialPost";
import { MediaGridItem } from "@/components/Profile";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { SkeletonProfile, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/lib/stores";

export default function UserProfileScreen() {
  // The route param is named 'id' but it's actually a username
  const { id: username } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  
  // Look up profile by username first
  const { 
    data: profile, 
    isLoading: isProfileLoading,
    isError: isProfileError,
    refetch: refetchProfile,
  } = useProfileByUsername(username!);
  // Then use the profile's actual UUID for posts with tab filtering
  const { 
    data: postsData, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage,
    refetch: refetchPosts,
    isRefetching,
  } = useUserPosts(profile?.id ?? "", activeTab);
  
  // ✅ Platinum: Follow state and mutations
  const { data: isFollowing } = useIsFollowing(profile?.id ?? "");
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const toggleRepostMutation = useToggleRepost();
  const deleteMutation = useDeletePost();

  const posts = postsData?.pages.flat() || [];
  
  // ✅ Platinum: Follow toggle with haptic feedback
  const handleFollowToggle = () => {
    if (!profile || currentUser?.id === profile.id) return;
    
    // Haptic feedback for satisfying "click"
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    if (isFollowing) {
      unfollowMutation.mutate(profile.id);
    } else {
      followMutation.mutate(profile.id);
    }
  };
  
  // Consistent handleLike that targets original post for reposts
  const handleLike = (post: any) => {
    const isSimpleRepostOfInternal = (post.type === 'repost' || post.is_repost) && 
      post.repost_of_id && !post.external_id;
    const targetId = isSimpleRepostOfInternal ? post.repost_of_id : post.id;
    
    if (post.is_liked) {
      unlikeMutation.mutate(targetId);
    } else {
      likeMutation.mutate(targetId);
    }
  };
  
  const handleRepost = (post: any) => {
    const isReposted = post.is_reposted_by_me === true;
    
    // If already reposted, UNDO (toggle off) - no menu needed
    if (isReposted) {
      toggleRepostMutation.mutate({ post, undo: true });
      return;
    }
    
    // Full repost menu with Quote option
    if (Platform.OS === 'ios') {
      Alert.alert("Share Post", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post }) },
        { text: "Quote Post", onPress: () => router.push(`/compose/quote?postId=${post.id}` as any) }
      ]);
    } else if (Platform.OS === 'web') {
      const wantsQuote = window.confirm('Quote Post? (OK = Quote with comment, Cancel = Simple Repost)');
      if (wantsQuote) {
        router.push(`/compose/quote?postId=${post.id}` as any);
      } else {
        const confirmRepost = window.confirm('Repost this without comment?');
        if (confirmRepost) {
          toggleRepostMutation.mutate({ post });
        }
      }
    } else {
      Alert.alert("Share Post", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post }) },
        { text: "Quote Post", onPress: () => router.push(`/compose/quote?postId=${post.id}` as any) }
      ]);
    }
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
        onLike={() => handleLike(item)}
        onRepost={() => handleRepost(item)}
        onReply={() => router.push(`/post/${item.id}` as any)}
        onPress={() => router.push(`/post/${item.id}` as any)}
        onProfilePress={() => router.push(`/user/${item.author?.username}` as any)}
        onQuotedPostPress={(quotedPostId) => router.push(`/post/${quotedPostId}` as any)}
        // Show thread context for replies tab
        showThreadContext={activeTab === 'replies'}
        onMore={() => {
          if (currentUser?.id === item.user_id) {
            Alert.alert("Delete Post", "Are you sure?", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(item.id) }
            ]);
          }
        }}
      />
    );
  };

  // ✅ Platinum Loading State: Skeleton Shimmer
  if (isProfileLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <Stack.Screen options={{ title: "Profile", headerBackTitle: "Back" }} />
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
        <Stack.Screen options={{ title: "Profile", headerBackTitle: "Back" }} />
        <Text className="text-text-primary text-lg font-semibold mb-2">
          User not found
        </Text>
        <Text className="text-text-muted text-center mb-6">
          This profile may not exist or has been removed.
        </Text>
        <Pressable 
          onPress={() => refetchProfile()}
          className="flex-row items-center gap-2 bg-primary px-6 py-3 rounded-full active:opacity-80"
        >
          <RefreshCw size={18} color="white" />
          <Text className="text-white font-semibold">Retry</Text>
        </Pressable>
        <Pressable 
          onPress={() => router.back()}
          className="mt-4 px-6 py-3"
        >
          <Text className="text-primary font-semibold">Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ title: `@${profile.username}`, headerBackTitle: "Back" }} />
      
      {/* ✅ Platinum: Header stays mounted, only list content changes */}
      <ProfileHeader 
        profile={profile!} 
        isCurrentUser={currentUser?.id === profile!.id}
        isFollowing={isFollowing ?? false}
        isFollowPending={followMutation.isPending || unfollowMutation.isPending}
        onFollowPress={handleFollowToggle}
        onFollowersPress={() => router.push({ 
          pathname: `/user/${username}/relationships` as any,
          params: { type: 'followers' }
        })}
        onFollowingPress={() => router.push({ 
          pathname: `/user/${username}/relationships` as any,
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
          onEndReached={() => hasNextPage && fetchNextPage()}
          
          // ✅ Pull-to-refresh
          refreshing={isRefetching}
          onRefresh={handleRefresh}
          
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#10B981" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View className="py-20 items-center px-8">
              <Text className="text-text-muted text-center text-lg font-medium">
                {activeTab === 'posts' && "This user hasn't posted anything yet."}
                {activeTab === 'replies' && "No conversations found for this user."}
                {activeTab === 'media' && "No photos or videos shared yet."}
              </Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}
