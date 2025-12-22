import { View, Text, Platform, ActivityIndicator, Pressable } from "react-native";
import { useState, useCallback } from "react";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { RefreshCw } from "lucide-react-native";
import { useProfileByUsername, useUserPosts, useLikePost, useUnlikePost, useToggleRepost, useDeletePost, useFollowUser, useUnfollowUser, useIsFollowing, ProfileTab } from "@/lib/hooks";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { SocialPost, RepostMenu, PostOptionsMenu } from "@/components/social";
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
  
  // Repost menu state
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [repostMenuPost, setRepostMenuPost] = useState<any>(null);
  
  // Post options menu state
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [optionsMenuPost, setOptionsMenuPost] = useState<any>(null);

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
      // Pass DID for AT Protocol federation
      followMutation.mutate({ 
        targetUserId: profile.id, 
        targetDid: (profile as any).did 
      });
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
      // Pass AT fields for federation
      likeMutation.mutate({
        postId: targetId,
        subjectUri: post.at_uri,
        subjectCid: post.at_cid,
      });
    }
  };
  
  const handleRepost = (post: any) => {
    setRepostMenuPost(post);
    setRepostMenuVisible(true);
  };
  
  // Handlers for the repost menu
  const handleDoRepost = useCallback(() => {
    if (!repostMenuPost) return;
    
    const isReposted = repostMenuPost.is_reposted_by_me === true;
    
    if (isReposted) {
      toggleRepostMutation.mutate({ post: repostMenuPost, undo: true });
    } else {
      toggleRepostMutation.mutate({ 
        post: repostMenuPost, 
        subjectUri: repostMenuPost.at_uri, 
        subjectCid: repostMenuPost.at_cid 
      });
    }
  }, [repostMenuPost, toggleRepostMutation]);
  
  const handleDoQuotePost = useCallback(() => {
    if (!repostMenuPost) return;
    const quoteUrl = repostMenuPost.at_uri 
      ? `/compose/quote?postId=${repostMenuPost.id}&atUri=${encodeURIComponent(repostMenuPost.at_uri)}&atCid=${encodeURIComponent(repostMenuPost.at_cid || '')}`
      : `/compose/quote?postId=${repostMenuPost.id}`;
    router.push(quoteUrl as any);
  }, [repostMenuPost, router]);

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
          if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          setOptionsMenuPost(item);
          setOptionsMenuVisible(true);
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
  // If user not found and username looks like a Bluesky handle, redirect to federated page
  if (isProfileError || !profile) {
    // Bluesky handles contain a dot (e.g., bsky.app, user.bsky.social)
    const looksLikeBlueskyHandle = username?.includes('.');
    
    if (looksLikeBlueskyHandle) {
      // Redirect to federated profile page
      router.replace(`/federated/${username}` as any);
      return (
        <SafeAreaView className="flex-1 bg-background items-center justify-center" edges={["top"]}>
          <Stack.Screen options={{ title: "Profile", headerBackTitle: "Back" }} />
          <ActivityIndicator size="large" color="#10B981" />
          <Text className="text-text-muted mt-4">Loading Bluesky profile...</Text>
        </SafeAreaView>
      );
    }
    
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
      
      {/* Repost Menu */}
      <RepostMenu
        isVisible={repostMenuVisible}
        onClose={() => setRepostMenuVisible(false)}
        onRepost={handleDoRepost}
        onQuotePost={handleDoQuotePost}
        isReposted={repostMenuPost?.is_reposted_by_me === true}
      />
      
      {/* Post Options Menu */}
      <PostOptionsMenu
        isVisible={optionsMenuVisible}
        onClose={() => setOptionsMenuVisible(false)}
        onDelete={() => optionsMenuPost && deleteMutation.mutate(optionsMenuPost.id)}
        isOwnPost={optionsMenuPost?.user_id === currentUser?.id}
        postUrl={optionsMenuPost ? `https://cannect.app/post/${optionsMenuPost.id}` : undefined}
        isReply={!!optionsMenuPost?.thread_parent_id}
      />
    </SafeAreaView>
  );
}
