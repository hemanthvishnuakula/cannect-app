import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Heart, MessageCircle, Repeat2 } from "lucide-react-native";
import { Image } from "expo-image";
import { usePostThread, useLikePost, useUnlikePost, useRepost, useDeleteRepost } from "@/lib/hooks";

export default function PostDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  
  // The id param is actually the AT URI for this post
  const { data: thread, isLoading, error } = usePostThread(id ?? "");
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const repostMutation = useRepost();
  const unrepostMutation = useDeleteRepost();
  
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/feed');
    }
  };

  const handleLike = () => {
    if (!thread?.post) return;
    const post = thread.post;
    
    if (post.viewer?.like) {
      unlikeMutation.mutate({ likeUri: post.viewer.like, postUri: post.uri });
    } else {
      likeMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  const handleRepost = () => {
    if (!thread?.post) return;
    const post = thread.post;
    
    if (post.viewer?.repost) {
      unrepostMutation.mutate({ repostUri: post.viewer.repost, postUri: post.uri });
    } else {
      repostMutation.mutate({ uri: post.uri, cid: post.cid });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen 
          options={{ 
            headerShown: true,
            headerTitle: "Thread",
            headerStyle: { backgroundColor: "#0A0A0A" },
            headerTintColor: "#FAFAFA",
            contentStyle: { backgroundColor: "#0A0A0A" },
            headerLeft: () => (
              <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
            ),
          }} 
        />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !thread?.post) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Stack.Screen 
          options={{ 
            headerShown: true,
            headerTitle: "Thread",
            headerStyle: { backgroundColor: "#0A0A0A" },
            headerTintColor: "#FAFAFA",
            contentStyle: { backgroundColor: "#0A0A0A" },
            headerLeft: () => (
              <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
                <ArrowLeft size={24} color="#FAFAFA" />
              </Pressable>
            ),
          }} 
        />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-text-secondary text-center">
            {error?.message || "Post not found"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const post = thread.post;
  const author = post.author;
  const record = post.record as { text?: string; createdAt?: string };
  const isLiked = !!post.viewer?.like;
  const isReposted = !!post.viewer?.repost;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: "Thread",
          headerStyle: { backgroundColor: "#0A0A0A" },
          headerTintColor: "#FAFAFA",
          contentStyle: { backgroundColor: "#0A0A0A" },
          headerLeft: () => (
            <Pressable onPress={handleBack} className="p-2 -ml-2 active:opacity-70">
              <ArrowLeft size={24} color="#FAFAFA" />
            </Pressable>
          ),
        }} 
      />
      
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {/* Author info */}
        <View className="flex-row items-center mb-4">
          <Image
            source={{ uri: author.avatar }}
            style={{ width: 48, height: 48, borderRadius: 24 }}
            contentFit="cover"
          />
          <View className="ml-3 flex-1">
            <Text className="text-text-primary font-semibold">{author.displayName || author.handle}</Text>
            <Text className="text-text-muted text-sm">@{author.handle}</Text>
          </View>
        </View>
        
        {/* Post content */}
        <Text className="text-text-primary text-lg mb-4">{record?.text}</Text>
        
        {/* Timestamp */}
        <Text className="text-text-muted text-sm mb-4">
          {record?.createdAt ? new Date(record.createdAt).toLocaleString() : ''}
        </Text>
        
        {/* Stats */}
        <View className="flex-row border-t border-b border-border py-3 mb-4">
          <Text className="text-text-secondary mr-4">
            <Text className="text-text-primary font-semibold">{post.repostCount || 0}</Text> Reposts
          </Text>
          <Text className="text-text-secondary mr-4">
            <Text className="text-text-primary font-semibold">{post.likeCount || 0}</Text> Likes
          </Text>
          <Text className="text-text-secondary">
            <Text className="text-text-primary font-semibold">{post.replyCount || 0}</Text> Replies
          </Text>
        </View>
        
        {/* Action buttons */}
        <View className="flex-row justify-around py-2 border-b border-border mb-4">
          <Pressable className="flex-row items-center" onPress={() => {}}>
            <MessageCircle size={22} color="#6B6B6B" />
          </Pressable>
          
          <Pressable className="flex-row items-center" onPress={handleRepost}>
            <Repeat2 size={22} color={isReposted ? "#10B981" : "#6B6B6B"} />
          </Pressable>
          
          <Pressable className="flex-row items-center" onPress={handleLike}>
            <Heart 
              size={22} 
              color={isLiked ? "#EF4444" : "#6B6B6B"} 
              fill={isLiked ? "#EF4444" : "transparent"} 
            />
          </Pressable>
        </View>
        
        {/* Replies */}
        {thread.replies && thread.replies.length > 0 && (
          <View>
            <Text className="text-text-primary font-semibold mb-4">Replies</Text>
            {thread.replies.map((reply: any, index: number) => {
              if (reply.$type === 'app.bsky.feed.defs#blockedPost' || 
                  reply.$type === 'app.bsky.feed.defs#notFoundPost') {
                return null;
              }
              
              const replyPost = reply.post;
              const replyAuthor = replyPost?.author;
              const replyRecord = replyPost?.record as { text?: string };
              
              if (!replyPost || !replyAuthor) return null;
              
              return (
                <View key={replyPost.uri || index} className="mb-4 pb-4 border-b border-border">
                  <View className="flex-row items-start">
                    <Image
                      source={{ uri: replyAuthor.avatar }}
                      style={{ width: 36, height: 36, borderRadius: 18 }}
                      contentFit="cover"
                    />
                    <View className="ml-3 flex-1">
                      <View className="flex-row items-center mb-1">
                        <Text className="text-text-primary font-semibold">
                          {replyAuthor.displayName || replyAuthor.handle}
                        </Text>
                        <Text className="text-text-muted text-sm ml-2">@{replyAuthor.handle}</Text>
                      </View>
                      <Text className="text-text-primary">{replyRecord?.text}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
