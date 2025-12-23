import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ArrowLeft, Globe2, Users, UserPlus, Check } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { UnifiedFeedItem } from "@/components/social";
import type { BlueskyPostData } from "@/components/social/BlueskyPost";
import { useIsFollowingDid, useFollowBlueskyUser, useUnfollowBlueskyUser } from "@/lib/hooks";
import { fromBlueskyPost, type UnifiedPost } from "@/lib/types/unified-post";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// Common headers for edge function calls
const getProxyHeaders = () => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "apikey": SUPABASE_ANON_KEY,
});

/**
 * Fetch a Bluesky actor's profile and recent posts
 */
async function fetchActorFeed(handle: string) {
  // Get profile
  const profileUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=getProfile&handle=${encodeURIComponent(handle)}`;
  const postsUrl = `${SUPABASE_URL}/functions/v1/bluesky-proxy?action=getAuthorFeed&handle=${encodeURIComponent(handle)}&limit=20`;

  const [profileRes, postsRes] = await Promise.all([
    fetch(profileUrl, { headers: getProxyHeaders() }).then(r => r.json()).catch(() => null),
    fetch(postsUrl, { headers: getProxyHeaders() }).then(r => r.json()).catch(() => ({ feed: [] })),
  ]);

  const profile = profileRes ? {
    id: profileRes.did,
    username: profileRes.handle,
    display_name: profileRes.displayName || profileRes.handle,
    avatar_url: profileRes.avatar,
    bio: profileRes.description,
    followers_count: profileRes.followersCount || 0,
    following_count: profileRes.followsCount || 0,
    posts_count: profileRes.postsCount || 0,
  } : null;

  // Map to BlueskyPostData format
  const posts: BlueskyPostData[] = (postsRes.feed || []).map((item: any) => {
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
      // Use thumb for feed performance, fullsize available if needed
      images: bskyPost.embed?.images?.map((img: any) => img.thumb || img.fullsize) || [],
    };
  });

  return { profile, posts };
}

export default function FederatedUserScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["federated", "actor", handle],
    queryFn: () => fetchActorFeed(handle || ""),
    enabled: !!handle,
    staleTime: 1000 * 60 * 5,
  });

  // Follow state for this external user
  const targetDid = data?.profile?.id || "";
  const { data: isFollowing, isLoading: isFollowLoading } = useIsFollowingDid(targetDid);
  const followMutation = useFollowBlueskyUser();
  const unfollowMutation = useUnfollowBlueskyUser();

  const handleToggleFollow = () => {
    if (!data?.profile) return;
    
    const profile = data.profile;
    if (isFollowing) {
      unfollowMutation.mutate(profile.id);
    } else {
      followMutation.mutate({
        did: profile.id,
        handle: profile.username,
        displayName: profile.display_name,
        avatar: profile.avatar_url,
      });
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text className="text-text-muted mt-4">Loading @{handle}...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data?.profile) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-primary text-lg font-bold mb-2">User not found</Text>
          <Text className="text-text-muted text-center mb-4">
            Could not find @{handle} in the global network
          </Text>
          <Pressable onPress={() => router.back()} className="bg-primary px-6 py-3 rounded-full">
            <Text className="text-white font-medium">Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { profile, posts: rawPosts } = data;
  
  // Convert to UnifiedPost format
  const posts: UnifiedPost[] = rawPosts.map((post: BlueskyPostData) => fromBlueskyPost(post));

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ flex: 1, minHeight: 100 }}>
        <FlashList
          data={posts}
          keyExtractor={(item: any, index) => item.uri || `federated-${index}`}
          estimatedItemSize={200}
          ListHeaderComponent={() => (
          <View>
            {/* Header Bar */}
            <View className="flex-row items-center px-4 py-3">
              <Pressable onPress={() => router.back()} className="p-2 -ml-2">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
              <View className="flex-1 ml-2">
                <View className="flex-row items-center gap-2">
                  <Text className="text-xl font-bold text-text-primary">{profile.display_name}</Text>
                  <View className="flex-row items-center gap-1 bg-blue-500/20 px-2 py-0.5 rounded-full">
                    <Globe2 size={12} color="#3B82F6" />
                    <Text className="text-xs text-blue-500 font-medium">Global</Text>
                  </View>
                </View>
                <Text className="text-text-muted text-sm">@{profile.username}</Text>
              </View>
            </View>

            {/* Profile Card */}
            <View className="px-4 pb-4">
              <View className="flex-row items-start gap-4">
                <Image
                  source={{ uri: profile.avatar_url || `https://ui-avatars.com/api/?name=${profile.display_name}&background=3B82F6&color=fff` }}
                  style={{ width: 80, height: 80, borderRadius: 40 }}
                  contentFit="cover"
                />
                <View className="flex-1">
                  {profile.bio && (
                    <Text className="text-text-primary text-sm mb-3">{profile.bio}</Text>
                  )}
                  <View className="flex-row gap-4 mb-3">
                    <View className="flex-row items-center gap-1">
                      <Users size={14} color="#6B7280" />
                      <Text className="text-text-muted text-sm">
                        <Text className="font-bold text-text-primary">{profile.followers_count.toLocaleString()}</Text> followers
                      </Text>
                    </View>
                    <Text className="text-text-muted text-sm">
                      <Text className="font-bold text-text-primary">{profile.following_count.toLocaleString()}</Text> following
                    </Text>
                  </View>
                  
                  {/* Follow Button */}
                  <Pressable
                    onPress={handleToggleFollow}
                    disabled={followMutation.isPending || unfollowMutation.isPending || isFollowLoading}
                    className={`flex-row items-center justify-center gap-2 px-4 py-2 rounded-full ${
                      isFollowing 
                        ? "bg-surface border border-border" 
                        : "bg-blue-500"
                    }`}
                  >
                    {(followMutation.isPending || unfollowMutation.isPending) ? (
                      <ActivityIndicator size="small" color={isFollowing ? "#FAFAFA" : "#FFFFFF"} />
                    ) : isFollowing ? (
                      <>
                        <Check size={16} color="#10B981" />
                        <Text className="text-text-primary font-medium">Following</Text>
                      </>
                    ) : (
                      <>
                        <UserPlus size={16} color="#FFFFFF" />
                        <Text className="text-white font-medium">Follow</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Posts Header */}
            <View className="px-4 py-2 border-b border-border">
              <Text className="text-text-primary font-bold">Recent Posts</Text>
            </View>
          </View>
        )}
        renderItem={({ item }: { item: UnifiedPost }) => (
          <UnifiedFeedItem post={item} />
        )}
        ListEmptyComponent={() => (
          <View className="py-12 items-center">
            <Text className="text-text-muted">No posts found</Text>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
      </View>
    </SafeAreaView>
  );
}