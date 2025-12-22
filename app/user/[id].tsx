import { View, Text, Platform, ActivityIndicator, Pressable, Linking } from "react-native";
import { useState, useCallback } from "react";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { RefreshCw, Globe2 } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { useResolveProfile, useUserPosts, useLikePost, useUnlikePost, useToggleRepost, useDeletePost, useFollowUser, useUnfollowUser, useIsFollowing, useFollowBlueskyUser, useUnfollowBlueskyUser, useIsFollowingDid, ProfileTab } from "@/lib/hooks";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { SocialPost, RepostMenu, PostOptionsMenu, BlueskyPost, type BlueskyPostData } from "@/components/social";
import { MediaGridItem } from "@/components/Profile";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { SkeletonProfile, SkeletonCard } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/lib/stores";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// External profile tab type - posts_with_replies includes replies
type ExternalProfileTab = 'posts' | 'replies' | 'media';

// Fetch external user's posts from Bluesky API with filter support
async function fetchExternalPosts(handle: string, filter: 'posts_no_replies' | 'posts_with_replies' | 'posts_with_media' = 'posts_no_replies'): Promise<BlueskyPostData[]> {
  if (!handle) return [];
  
  // Bluesky API filter values:
  // - posts_no_replies: Only posts, no replies
  // - posts_with_replies: Posts and replies  
  // - posts_with_media: Only posts with images/video
  const url = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=getAuthorFeed&handle=${encodeURIComponent(handle)}&limit=30&filter=${filter}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
  });
  
  const data = await res.json();
  
  return (data.feed || []).map((item: any) => {
    const bskyPost = item.post;
    return {
      uri: bskyPost.uri,
      cid: bskyPost.cid,
      content: bskyPost.record?.text || "",
      createdAt: bskyPost.record?.createdAt || bskyPost.indexedAt,
      author: {
        did: bskyPost.author.did,
        handle: bskyPost.author.handle,
        displayName: bskyPost.author.displayName || bskyPost.author.handle,
        avatar: bskyPost.author.avatar,
      },
      likeCount: bskyPost.likeCount || 0,
      repostCount: bskyPost.repostCount || 0,
      replyCount: bskyPost.replyCount || 0,
      images: bskyPost.embed?.images?.map((img: any) => img.fullsize) || [],
      // Include reply info for showing thread context
      replyParent: bskyPost.record?.reply?.parent ? {
        uri: bskyPost.record.reply.parent.uri,
        cid: bskyPost.record.reply.parent.cid,
      } : undefined,
    };
  });
}

export default function UserProfileScreen() {
  // The route param is named 'id' but it's actually a handle or username
  const { id: handleOrUsername } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  
  // Unified profile resolver - works for both local and external users
  const { 
    data: profile, 
    isLoading: isProfileLoading,
    isError: isProfileError,
    refetch: refetchProfile,
  } = useResolveProfile(handleOrUsername!);
  
  // Check if this is an external (Bluesky) user - ensure boolean
  const isExternalUser = !!(profile && profile.is_local === false);
  
  // For local users: fetch posts from our database
  const { 
    data: localPostsData, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage,
    refetch: refetchLocalPosts,
    isRefetching: isLocalPostsRefetching,
  } = useUserPosts(
    (!isExternalUser && profile?.id) ? profile.id : "", 
    activeTab
  );
  
  // For external users: fetch posts from Bluesky API with tab-based filtering
  const externalFilter = activeTab === 'posts' ? 'posts_no_replies' 
    : activeTab === 'replies' ? 'posts_with_replies' 
    : 'posts_with_media';
  
  const {
    data: externalPosts,
    refetch: refetchExternalPosts,
    isRefetching: isExternalPostsRefetching,
    isLoading: isExternalPostsLoading,
  } = useQuery({
    queryKey: ["external-posts", profile?.handle, activeTab],
    queryFn: () => fetchExternalPosts(profile?.handle || "", externalFilter),
    enabled: !!isExternalUser && !!profile?.handle,
    staleTime: 1000 * 60 * 5,
  });
  
  // Follow state for local users
  const { data: isFollowingLocal } = useIsFollowing(
    (!isExternalUser && profile?.id) ? profile.id : ""
  );
  const followLocalMutation = useFollowUser();
  const unfollowLocalMutation = useUnfollowUser();
  
  // Follow state for external users (by DID)
  const { data: isFollowingExternal } = useIsFollowingDid(
    isExternalUser ? (profile as any)?.did : ""
  );
  const followExternalMutation = useFollowBlueskyUser();
  const unfollowExternalMutation = useUnfollowBlueskyUser();
  
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

  // Unified posts: local or external depending on user type
  const localPosts = localPostsData?.pages.flat() || [];
  const posts = isExternalUser ? (externalPosts || []) : localPosts;
  const isRefetching = isExternalUser ? isExternalPostsRefetching : isLocalPostsRefetching;
  
  // Unified follow state
  const isFollowing = isExternalUser ? isFollowingExternal : isFollowingLocal;
  const isFollowPending = isExternalUser 
    ? (followExternalMutation.isPending || unfollowExternalMutation.isPending)
    : (followLocalMutation.isPending || unfollowLocalMutation.isPending);
  
  // ✅ Unified Follow toggle with haptic feedback
  const handleFollowToggle = () => {
    if (!profile || currentUser?.id === profile.id) return;
    
    // Haptic feedback for satisfying "click"
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    if (isExternalUser) {
      // External user - use Bluesky follow mutations
      if (isFollowing) {
        unfollowExternalMutation.mutate((profile as any).did);
      } else {
        followExternalMutation.mutate({
          did: (profile as any).did,
          handle: profile.handle || profile.username,
          displayName: profile.display_name,
          avatar: profile.avatar_url,
        });
      }
    } else {
      // Local user - use regular follow mutations
      if (isFollowing) {
        unfollowLocalMutation.mutate(profile.id);
      } else {
        followLocalMutation.mutate({ 
          targetUserId: profile.id, 
          targetDid: (profile as any).did 
        });
      }
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
    if (isExternalUser) {
      refetchExternalPosts();
    } else {
      refetchLocalPosts();
    }
  };

  // Render item based on active tab and user type
  const renderItem = ({ item }: { item: any }) => {
    // External users: render BlueskyPost component (works for all tabs)
    if (isExternalUser) {
      // For media tab with external users, only show posts with images
      if (activeTab === 'media' && (!item.images || item.images.length === 0)) {
        return null; // Will be filtered out
      }
      return <BlueskyPost post={item as BlueskyPostData} />;
    }
    
    // Local users: render based on tab
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
        onProfilePress={() => {
          const identifier = (item as any).author?.handle || item.author?.username || item.author?.id;
          if (identifier) router.push(`/user/${identifier}` as any);
        }}
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
  // useResolveProfile now handles both local and Bluesky users
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

  // Helper to open external profile on Bluesky web
  const openBlueskyProfile = (tab?: 'followers' | 'following') => {
    const handle = profile?.handle || '';
    const baseUrl = `https://bsky.app/profile/${handle}`;
    const url = tab ? `${baseUrl}/${tab}` : baseUrl;
    Linking.openURL(url);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ title: `@${profile.handle || profile.username}`, headerBackTitle: "Back" }} />
      
      {/* ✅ Platinum: Header stays mounted, only list content changes */}
      <ProfileHeader 
        profile={profile!} 
        isCurrentUser={!isExternalUser && currentUser?.id === profile!.id}
        isFollowing={isFollowing ?? false}
        isFollowPending={isFollowPending}
        onFollowPress={handleFollowToggle}
        onFollowersPress={() => {
          if (isExternalUser) {
            openBlueskyProfile('followers');
          } else {
            router.push({ 
              pathname: `/user/${handleOrUsername}/relationships` as any,
              params: { type: 'followers' }
            });
          }
        }}
        onFollowingPress={() => {
          if (isExternalUser) {
            openBlueskyProfile('following');
          } else {
            router.push({ 
              pathname: `/user/${handleOrUsername}/relationships` as any,
              params: { type: 'following' }
            });
          }
        }}
        isExternal={isExternalUser}
      />
      
      {/* ✅ Tabs - now shown for both local and external users */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProfileTab)}>
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="replies">Replies</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
        </TabsList>
      </Tabs>
      
      {/* External user badge/header */}
      {isExternalUser && (
        <View className="flex-row items-center gap-2 px-4 py-2 bg-blue-500/10 border-b border-border">
          <Globe2 size={14} color="#3B82F6" />
          <Text className="text-blue-500 text-sm font-medium">
            Bluesky User • Posts from the global network
          </Text>
        </View>
      )}
      
      <View style={{ flex: 1, minHeight: 2 }}>
        <FlashList
          key={isExternalUser ? 'external' : (activeTab === 'media' ? 'grid' : 'list')}
          data={posts}
          keyExtractor={(item: any, index) => {
            // External posts use URI, local posts use ID
            if (isExternalUser) {
              return item.uri || `external-${index}`;
            }
            const isRepost = item.type === 'repost' || item.is_repost;
            const reposterId = isRepost ? item.user_id : null;
            return `${activeTab}-${item.id}-${reposterId || 'orig'}-${index}`;
          }}
          numColumns={activeTab === 'media' && !isExternalUser ? 3 : 1}
          estimatedItemSize={activeTab === 'media' && !isExternalUser ? 120 : 200}
          renderItem={renderItem}
          onEndReached={() => !isExternalUser && hasNextPage && fetchNextPage()}
          
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
