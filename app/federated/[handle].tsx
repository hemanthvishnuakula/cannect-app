import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ArrowLeft, Globe2, Users, UserPlus } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { SocialPost } from "@/components/social";
import { useToggleRepost } from "@/lib/hooks";

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

  const posts = (postsRes.feed || []).map((item: any) => {
    const bskyPost = item.post;
    return {
      id: bskyPost.cid,
      user_id: bskyPost.author.did,
      content: bskyPost.record?.text || "",
      created_at: bskyPost.record?.createdAt || bskyPost.indexedAt,
      media_urls: bskyPost.embed?.images?.map((img: any) => img.fullsize) || [],
      likes_count: bskyPost.likeCount || 0,
      reposts_count: bskyPost.repostCount || 0,
      comments_count: bskyPost.replyCount || 0,
      is_federated: true,
      type: "post",
      author: {
        id: bskyPost.author.did,
        username: bskyPost.author.handle,
        display_name: bskyPost.author.displayName || bskyPost.author.handle,
        avatar_url: bskyPost.author.avatar,
        is_verified: false,
      },
    };
  });

  return { profile, posts };
}

export default function FederatedUserScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const toggleRepost = useToggleRepost();

  const { data, isLoading, error } = useQuery({
    queryKey: ["federated", "actor", handle],
    queryFn: () => fetchActorFeed(handle || ""),
    enabled: !!handle,
    staleTime: 1000 * 60 * 5,
  });

  const handleImportPost = (post: any) => {
    Alert.alert(
      "Import to Cannect",
      "Bring this post into Cannect so you and your community can discuss it?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Repost", onPress: () => toggleRepost.mutate({ post }) },
        { 
          text: "Quote", 
          onPress: () => router.push({
            pathname: "/compose/quote",
            params: { 
              postId: post.id,
              postContent: post.content,
              postAuthor: post.author?.display_name || post.author?.username,
              postAuthorHandle: post.author?.username,
              postAuthorAvatar: post.author?.avatar_url,
              isFederated: "true",
            }
          } as any)
        },
      ]
    );
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

  const { profile, posts } = data;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ flex: 1, minHeight: 2 }}>
        <FlashList
          data={posts}
          keyExtractor={(item: any, index) => `federated-${item.id}-${index}`}
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
                  <View className="flex-row gap-4">
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
                </View>
              </View>
            </View>

            {/* Info Banner */}
            <View className="mx-4 mb-4 p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <Text className="text-blue-500 text-sm font-medium">
                💡 Tap any post to import it into Cannect for discussion
              </Text>
            </View>

            {/* Posts Header */}
            <View className="px-4 py-2 border-b border-border">
              <Text className="text-text-primary font-bold">Recent Posts</Text>
            </View>
          </View>
        )}
        renderItem={({ item }: { item: any }) => (
          <Pressable onPress={() => handleImportPost(item)}>
            <SocialPost
              post={item}
              onRepost={() => handleImportPost(item)}
            />
          </Pressable>
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
