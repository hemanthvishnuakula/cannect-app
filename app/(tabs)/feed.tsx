import { View, Text, RefreshControl, ActivityIndicator, Alert, Platform, ActionSheetIOS, Share, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Leaf, Globe2 } from "lucide-react-native";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFeed, useLikePost, useUnlikePost, useDeletePost, useRepost } from "@/lib/hooks";
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
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Repost', 'Quote Post'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            // Simple Repost
            repostMutation.mutate({ originalPost: post, content: "" });
          } else if (buttonIndex === 2) {
            // Quote Post - navigate to quote screen
            router.push(`/compose/quote?postId=${post.id}` as any);
          }
        }
      );
    } else if (Platform.OS === 'web') {
      // Web: Use custom prompt
      const choice = window.prompt("Enter '1' to Repost, '2' to Quote Post, or Cancel:");
      if (choice === '1') {
        repostMutation.mutate({ originalPost: post, content: "" });
      } else if (choice === '2') {
        router.push(`/compose/quote?postId=${post.id}` as any);
      }
    } else {
      // Android Alert Fallback
      Alert.alert("Share Post", "How would you like to share this?", [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Repost", 
          onPress: () => repostMutation.mutate({ originalPost: post, content: "" })
        },
        { 
          text: "Quote Post", 
          onPress: () => router.push(`/compose/quote?postId=${post.id}` as any)
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
              const isFederated = (item as any).is_federated === true;
              return (
                <SocialPost 
                  post={item}
                  onLike={() => !isFederated && handleLike(item)}
                  onReply={() => !isFederated && handlePostPress(item.id)}
                  onRepost={() => !isFederated && handleRepost(item)}
                  onProfilePress={() => !isFederated && handleProfilePress(item.user_id)}
                  onPress={() => !isFederated && handlePostPress(item.id)}
                  onMore={() => !isFederated && handleMore(item)}
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
