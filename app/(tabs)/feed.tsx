import { View, Text, RefreshControl, ActivityIndicator, Alert, Platform, ActionSheetIOS, Share, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Leaf, Globe2 } from "lucide-react-native";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFeed, useLikePost, useUnlikePost, useDeletePost, useRepost, useToggleRepost } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import { SocialPost } from "@/components/social";
import { getFederatedPosts } from "@/lib/services/bluesky";
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
  
  const { 
    data, isLoading, refetch, isRefetching, 
    fetchNextPage, hasNextPage, isFetchingNextPage,
    isError
  } = useFeed();
  
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
  const repostMutation = useRepost();
  const toggleRepostMutation = useToggleRepost();
  
  // Flatten infinite query pages into a single array
  const internalPosts = data?.pages?.flat() || [];
  
  // Get the appropriate posts based on active tab
  const posts = activeTab === "federated" 
    ? (federatedQuery.data || []) 
    : internalPosts;
  
  // Loading and error states based on active tab
  const isCurrentLoading = activeTab === "federated" ? federatedQuery.isLoading : isLoading;
  const isCurrentRefetching = activeTab === "federated" ? federatedQuery.isRefetching : isRefetching;
  const isCurrentError = activeTab === "federated" ? federatedQuery.isError : isError;
  const currentRefetch = activeTab === "federated" ? federatedQuery.refetch : refetch;

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

  const handleLike = (post: PostWithAuthor) => {
    if (post.is_liked) {
      unlikeMutation.mutate(post.id);
    } else {
      likeMutation.mutate(post.id);
    }
  };

  const handleProfilePress = (userId: string) => {
    router.push(`/user/${userId}` as any);
  };

  const handlePostPress = (postId: string) => {
    router.push(`/post/${postId}` as any);
  };

  const handleMore = (post: PostWithAuthor) => {
    const isOwnPost = post.user_id === user?.id;
    
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: isOwnPost 
            ? ['Cancel', 'Delete Post'] 
            : ['Cancel', 'Report Post'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            if (isOwnPost) {
              handleDelete(post.id);
            } else {
              Alert.alert("Reported", "Thank you for reporting this post.");
            }
          }
        }
      );
    } else if (Platform.OS === 'web') {
      // Web: Use browser confirm dialog
      if (isOwnPost) {
        if (window.confirm("Delete this post? This cannot be undone.")) {
          deleteMutation.mutate(post.id);
        }
      } else {
        if (window.confirm("Report this post?")) {
          window.alert("Thank you for reporting this post.");
        }
      }
    } else {
      // Android Alert Fallback
      Alert.alert(
        "Manage Post", 
        undefined, 
        isOwnPost 
          ? [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => handleDelete(post.id) }
            ]
          : [
              { text: "Cancel", style: "cancel" },
              { text: "Report", onPress: () => Alert.alert("Reported", "Thank you for reporting this post.") }
            ]
      );
    }
  };

  const handleDelete = (postId: string) => {
    Alert.alert(
      "Delete Post",
      "Are you sure you want to delete this post? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: () => deleteMutation.mutate(postId)
        }
      ]
    );
  };

  const handleRepost = (post: PostWithAuthor) => {
    const isFederated = (post as any).is_federated === true;
    const isReposted = (post as any).is_reposted_by_me === true;
    
    // If already reposted, UNDO (toggle off) - no menu needed
    if (isReposted) {
      toggleRepostMutation.mutate({ post, undo: true });
      return;
    }
    
    // For federated posts, we need to pass the data via URL params since they don't have a DB id
    const getQuoteUrl = () => {
      if (isFederated) {
        // Encode the essential post data for the quote screen
        const externalData = encodeURIComponent(JSON.stringify({
          id: post.id,
          content: post.content,
          created_at: post.created_at,
          media_urls: (post as any).media_urls,
          author: post.author,
          is_federated: true,
        }));
        return `/compose/quote?externalData=${externalData}`;
      }
      return `/compose/quote?postId=${post.id}`;
    };
    
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Repost', 'Quote Post'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            // Simple Repost - use toggle mutation
            toggleRepostMutation.mutate({ post });
          } else if (buttonIndex === 2) {
            // Quote Post - navigate to quote screen
            router.push(getQuoteUrl() as any);
          }
        }
      );
    } else if (Platform.OS === 'web') {
      // Web: Use custom prompt
      const choice = window.prompt("Enter '1' to Repost, '2' to Quote Post, or Cancel:");
      if (choice === '1') {
        toggleRepostMutation.mutate({ post });
      } else if (choice === '2') {
        router.push(getQuoteUrl() as any);
      }
    } else {
      // Android Alert Fallback
      Alert.alert("Share Post", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Repost", 
          onPress: () => toggleRepostMutation.mutate({ post })
        },
        { 
          text: "Quote Post", 
          onPress: () => router.push(getQuoteUrl() as any)
        },
      ]);
    }
  };

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

      {isCurrentLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlashList
            data={posts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              // Live Global = direct from Bluesky API (read-only except repost)
              const isLiveGlobal = (item as any).is_federated === true;
              // Cannect Repost of Global = stored in our DB (fully interactive!)
              const isCannectRepostOfGlobal = !!(item as any).external_id;
              
              // For Cannect reposts, interactions should target the Cannect post.id
              const interactionId = item.id;
              
              return (
                <SocialPost 
                  post={item}
                  onLike={() => handleLike(item)} // Component handles disabled state
                  onReply={() => handlePostPress(interactionId)} // Navigate to Cannect thread
                  onRepost={() => handleRepost(item)}
                  onProfilePress={() => {
                    // For Cannect reposts, navigate to reposter's profile
                    // For live global, no navigation
                    if (!isLiveGlobal || isCannectRepostOfGlobal) {
                      handleProfilePress(item.user_id);
                    }
                  }}
                  onPress={() => {
                    // For Cannect reposts, navigate to thread view
                    // For live global, no navigation
                    if (!isLiveGlobal || isCannectRepostOfGlobal) {
                      handlePostPress(interactionId);
                    }
                  }}
                  onMore={() => {
                    if (!isLiveGlobal || isCannectRepostOfGlobal) {
                      handleMore(item);
                    }
                  }}
                  onShare={() => handleShare(item)}
                />
              );
            }}
            estimatedItemSize={200}
            refreshControl={
              <RefreshControl 
                refreshing={isCurrentRefetching} 
                onRefresh={() => currentRefetch()} 
                tintColor="#10B981"
                colors={["#10B981"]} // Android
              />
            }
            onEndReached={() => {
              // Only paginate for internal feeds, not federated
              if (activeTab !== "federated" && hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center pt-24">
                <Text className="text-text-secondary text-base">
                  {activeTab === "federated" 
                    ? "No federated posts available." 
                    : "No posts yet. Be the first!"}
                </Text>
              </View>
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
    </SafeAreaView>
  );
}
