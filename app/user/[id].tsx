import { View, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useProfile, useUserPosts, useLikePost, useUnlikePost, useToggleRepost, useDeletePost } from "@/lib/hooks";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { SocialPost } from "@/components/social/SocialPost";
import { useAuthStore } from "@/lib/stores";

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  
  const { data: profile, isLoading: isProfileLoading } = useProfile(id!);
  const { data: postsData, fetchNextPage, hasNextPage } = useUserPosts(id!);
  
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const toggleRepostMutation = useToggleRepost();
  const deleteMutation = useDeletePost();

  const posts = postsData?.pages.flat() || [];
  
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
    if (isReposted) {
      toggleRepostMutation.mutate({ post, undo: true });
    } else {
      Alert.alert("Repost", "Share with your followers?", [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepostMutation.mutate({ post }) }
      ]);
    }
  };

  if (isProfileLoading || !profile) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#10B981" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ title: `@${profile.username}`, headerBackTitle: "Back" }} />
      <FlashList
        data={posts}
        keyExtractor={(item) => item.id}
        estimatedItemSize={150}
        ListHeaderComponent={
          <ProfileHeader 
            profile={profile} 
            isCurrentUser={currentUser?.id === id} 
          />
        }
        renderItem={({ item }) => (
          <SocialPost 
            post={item}
            onLike={() => handleLike(item)}
            onRepost={() => handleRepost(item)}
            onReply={() => router.push(`/post/${item.id}` as any)}
            onPress={() => router.push(`/post/${item.id}` as any)}
            onProfilePress={() => router.push(`/user/${item.user_id}` as any)}
            onQuotedPostPress={(quotedPostId) => router.push(`/post/${quotedPostId}` as any)}
            onMore={() => {
              if (currentUser?.id === item.user_id) {
                Alert.alert("Delete Post", "Are you sure?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(item.id) }
                ]);
              }
            }}
          />
        )}
        onEndReached={() => hasNextPage && fetchNextPage()}
      />
    </SafeAreaView>
  );
}
