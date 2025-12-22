import { View, Text, RefreshControl, ActivityIndicator, Platform, Share, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Leaf, Globe2 } from "lucide-react-native";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useFeed, useFollowingFeed, useLikePost, useUnlikePost, useDeletePost, useToggleRepost, useProfile } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import { SocialPost, RepostMenu, PostOptionsMenu, BlueskyPost } from "@/components/social";
import { EmptyFeedState } from "@/components/social/EmptyFeedState";
import { DiscoveryModal, useDiscoveryModal } from "@/components/social/DiscoveryModal";
import { getFederatedPosts, type FederatedPost } from "@/lib/services/bluesky";
import { OfflineBanner } from "@/components/OfflineBanner";
import { FeedSkeleton } from "@/components/Skeleton";
import type { PostWithAuthor } from "@/lib/types/database";

type FeedTab = "for-you" | "following" | "federated";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "for-you", label: "Cannect" },
  { id: "following", label: "Following" },
  { id: "federated", label: "Global" },
];

export default function FeedScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<FeedTab>("for-you");
  
  // Get current user's profile for discovery modal logic
  const { data: myProfile } = useProfile(user?.id ?? "");
  
  // Discovery modal for new users with 0 following
  const { showDiscovery, closeDiscovery } = useDiscoveryModal(myProfile?.following_count);
  
  // Repost menu state
  const [repostMenuVisible, setRepostMenuVisible] = useState(false);
  const [repostMenuPost, setRepostMenuPost] = useState<PostWithAuthor | null>(null);
  
  // Post options menu state
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [optionsMenuPost, setOptionsMenuPost] = useState<PostWithAuthor | null>(null);
  
  // Cannect (For You) feed - all posts
  const forYouQuery = useFeed();
  
  // Following feed - only posts from followed users
  const followingQuery = useFollowingFeed();
  
  // Federated feed from Bluesky
  const federatedQuery = useQuery({
    queryKey: ["federated-feed"],
    queryFn: () => getFederatedPosts(50),
    enabled: activeTab === "federated",
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const deleteMutation = useDeletePost();
  const toggleRepostMutation = useToggleRepost();
  
  // Select the appropriate query based on active tab
  const getCurrentQuery = () => {
    switch (activeTab) {
      case "for-you":
        return forYouQuery;
      case "following":
        return followingQuery;
      case "federated":
        // Wrap federatedQuery to match infinite query shape
        return {
          data: { pages: [federatedQuery.data || []] },
          isLoading: federatedQuery.isLoading,
          isError: federatedQuery.isError,
          isRefetching: federatedQuery.isRefetching,
          refetch: federatedQuery.refetch,
          fetchNextPage: () => {},
          hasNextPage: false,
          isFetchingNextPage: false,
        };
    }
  };
  
  const currentQuery = getCurrentQuery();
  const posts = currentQuery.data?.pages?.flat() || [];
  
  // Loading and error states based on active tab
  const isCurrentLoading = currentQuery.isLoading;
  const isCurrentRefetching = currentQuery.isRefetching;
  const isCurrentError = currentQuery.isError;
  const currentRefetch = currentQuery.refetch;
  const fetchNextPage = 'fetchNextPage' in currentQuery ? currentQuery.fetchNextPage : () => {};
  const hasNextPage = 'hasNextPage' in currentQuery ? currentQuery.hasNextPage : false;
  const isFetchingNextPage = 'isFetchingNextPage' in currentQuery ? currentQuery.isFetchingNextPage : false;
  
  // Haptic feedback on pull-to-refresh
  const handleRefresh = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    currentRefetch();
  };

  if (isCurrentError) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-text-primary text-lg font-semibold mb-2">Failed to load feed</Text>
        <Pressable onPress={() => currentRefetch()} className="bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-bold">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Handlers - Clean, no "import" logic needed anymore!
  // ---------------------------------------------------------------------------

  const handleLike = useCallback((post: PostWithAuthor) => {
    if (!user) {
      router.push("/auth/login" as any);
      return;
    }

    if (post.is_liked) {
      unlikeMutation.mutate(post.id);
    } else {
      // Pass AT Protocol fields for federation
      likeMutation.mutate({
        postId: post.id,
        subjectUri: (post as any).at_uri,
        subjectCid: (post as any).at_cid,
      });
    }
  }, [user, likeMutation, unlikeMutation, router]);

  const handleProfilePress = (username: string, handle?: string) => {
    // For federated profiles, navigate to federated profile page
    if (handle && !handle.includes('cannect.space')) {
      router.push(`/federated/${encodeURIComponent(handle)}` as any);
    } else {
      router.push(`/user/${username}` as any);
    }
  };

  const handlePostPress = (postId: string) => {
    router.push(`/post/${postId}` as any);
  };

  const handleMore = (post: PostWithAuthor) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setOptionsMenuPost(post);
    setOptionsMenuVisible(true);
  };

  const handleOptionsDelete = () => {
    if (optionsMenuPost) {
      deleteMutation.mutate(optionsMenuPost.id);
    }
  };

  const handleRepost = useCallback((post: PostWithAuthor) => {
    if (!user) {
      router.push("/auth/login" as any);
      return;
    }

    if (toggleRepostMutation.isPending) return;
    
    const isReposted = post.is_reposted_by_me === true;
    
    // If already reposted, show menu for undo option
    // Otherwise show menu for repost/quote options
    setRepostMenuPost(post);
    setRepostMenuVisible(true);
  }, [user, toggleRepostMutation, router]);
  
  // Handlers for the repost menu
  const handleDoRepost = useCallback(() => {
    if (!repostMenuPost) return;
    
    const isReposted = repostMenuPost.is_reposted_by_me === true;
    const subjectUri = (repostMenuPost as any).at_uri;
    const subjectCid = (repostMenuPost as any).at_cid;
    
    if (isReposted) {
      toggleRepostMutation.mutate({ post: repostMenuPost, undo: true });
    } else {
      toggleRepostMutation.mutate({ post: repostMenuPost, subjectUri, subjectCid });
    }
  }, [repostMenuPost, toggleRepostMutation]);
  
  const handleDoQuotePost = useCallback(() => {
    if (!repostMenuPost) return;
    router.push(`/compose/quote?postId=${repostMenuPost.id}` as any);
  }, [repostMenuPost, router]);

  const handleShare = async (post: PostWithAuthor) => {
    try {
      await Share.share({
        message: `Check out this post by @${post.author?.username}: ${post.content}`,
      });
    } catch (error) {
      // User cancelled or error
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4 border-b border-border">
        <Leaf size={28} color="#10B981" />
        <Text className="text-2xl font-bold text-text-primary ml-3">Cannect</Text>
      </View>

      {/* Tab Bar */}
      <View className="flex-row border-b border-border">
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 items-center ${
              activeTab === tab.id ? "border-b-2 border-primary" : ""
            }`}
          >
            <View className="flex-row items-center gap-1.5">
              {tab.id === "federated" && <Globe2 size={14} color={activeTab === tab.id ? "#10B981" : "#6B7280"} />}
              <Text
                className={`font-semibold ${
                  activeTab === tab.id ? "text-primary" : "text-text-muted"
                }`}
              >
                {tab.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* Offline Banner */}
      <OfflineBanner />

      {isCurrentLoading ? (
        <FeedSkeleton />
      ) : (
        <View style={{ flex: 1, minHeight: 2 }}>
          <FlashList
            data={posts}
            keyExtractor={(item, index) => `${activeTab}-${item.id}-${index}`}
            renderItem={({ item }) => {
              const isFederated = (item as any).is_federated === true;
              
              // Use BlueskyPost for federated posts
              if (isFederated && activeTab === "federated") {
                const federatedItem = item as FederatedPost;
                return (
                  <BlueskyPost
                    post={{
                      uri: federatedItem.uri,
                      cid: federatedItem.cid,
                      content: federatedItem.content,
                      createdAt: federatedItem.created_at,
                      author: {
                        did: federatedItem.author.did,
                        handle: federatedItem.author.handle,
                        displayName: federatedItem.author.display_name,
                        avatar: federatedItem.author.avatar_url || undefined,
                      },
                      likeCount: federatedItem.likes_count,
                      repostCount: federatedItem.reposts_count,
                      replyCount: federatedItem.replies_count,
                      images: federatedItem.media_urls,
                    }}
                    onShare={() => {
                      Share.share({
                        message: `Check out this post by @${federatedItem.author.handle}: ${federatedItem.content?.slice(0, 100)}`,
                      });
                    }}
                  />
                );
              }
              
              // Use SocialPost for Cannect posts
              return (
                <SocialPost 
                  post={item}
                  onLike={() => handleLike(item)}
                  onReply={() => handlePostPress(item.id)}
                  onRepost={() => handleRepost(item)}
                  onProfilePress={() => {
                    const handle = (item as any).author?.handle || (item as any).author?.username;
                    handleProfilePress(item.author?.username || '', isFederated ? handle : undefined);
                  }}
                  onRepostedByPress={(username) => handleProfilePress(username)}
                  onPress={() => handlePostPress(item.id)}
                  onQuotedPostPress={(quotedPostId) => router.push(`/post/${quotedPostId}` as any)}
                  onMore={() => handleMore(item)}
                  onShare={() => handleShare(item)}
                />
              );
            }}
            estimatedItemSize={200}
            refreshControl={
              <RefreshControl 
                refreshing={isCurrentRefetching} 
                onRefresh={handleRefresh} 
                tintColor="#10B981"
                colors={["#10B981"]}
              />
            }
            onEndReached={() => {
              if (activeTab !== "federated" && hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <EmptyFeedState 
                type={activeTab} 
                isLoading={isCurrentLoading}
                onRetry={handleRefresh}
              />
            }
            ListFooterComponent={
              isFetchingNextPage && activeTab !== "federated" ? (
                <View className="py-4 items-center">
                  <ActivityIndicator size="small" color="#10B981" />
                </View>
              ) : null
            }
          />
        </View>
      )}
      
      {/* Discovery Modal for new users */}
      <DiscoveryModal 
        isVisible={showDiscovery && activeTab === "following"} 
        onClose={closeDiscovery} 
      />
      
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
        onDelete={handleOptionsDelete}
        isOwnPost={optionsMenuPost?.user_id === user?.id}
        postUrl={optionsMenuPost ? `https://cannect.app/post/${optionsMenuPost.id}` : undefined}
        isReply={!!optionsMenuPost?.thread_parent_id}
      />
    </SafeAreaView>
  );
}
