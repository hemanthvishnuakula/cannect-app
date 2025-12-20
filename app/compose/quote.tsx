import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { X, Globe2 } from "lucide-react-native";
import { Image } from "expo-image";

import { useAuthStore } from "@/lib/stores";
import { useRepost, usePost } from "@/lib/hooks";

export default function QuotePostScreen() {
  const router = useRouter();
  const { postId, externalData } = useLocalSearchParams<{ postId?: string; externalData?: string }>();
  const [content, setContent] = useState("");
  const { user } = useAuthStore();
  const repostMutation = useRepost();
  
  // For internal posts, fetch from Supabase
  const { data: internalPost, isLoading: isLoadingPost } = usePost(postId || "");
  
  // For external (Global) posts, parse from URL params
  const externalPost = externalData ? JSON.parse(decodeURIComponent(externalData)) : null;
  
  // Use whichever post we have
  const originalPost = externalPost || internalPost;
  const isLoading = !externalPost && isLoadingPost;
  const isFederated = !!externalPost || originalPost?.is_federated;

  const charCount = content.length;
  const maxChars = 300; // Bluesky uses 300 graphemes
  const isOverLimit = charCount > maxChars;

  const handleQuote = async () => {
    if (!originalPost) return;
    
    try {
      await repostMutation.mutateAsync({ 
        originalPost, 
        content: content.trim() 
      });
      router.back();
    } catch (error) {
      console.error("Failed to quote post:", error);
    }
  };

  const avatarUrl = originalPost?.author?.avatar_url || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(originalPost?.author?.username || originalPost?.author?.display_name || "U")}&background=10B981&color=fff`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"} 
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row justify-between items-center px-4 py-3 border-b border-border">
          <Pressable onPress={() => router.back()} className="p-2">
            <X size={24} color="#FAFAFA" />
          </Pressable>
          <Pressable
            onPress={handleQuote}
            disabled={isOverLimit || repostMutation.isPending || !originalPost}
            className={`bg-primary px-5 py-2.5 rounded-full ${isOverLimit ? 'opacity-50' : ''}`}
          >
            {repostMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white font-semibold text-base">
                {isFederated ? "Import & Quote" : "Quote"}
              </Text>
            )}
          </Pressable>
        </View>

        {/* Compose Area */}
        <View className="flex-1 px-4 pt-4">
          {/* User Input */}
          <View className="flex-row mb-4">
            <View className="w-11 h-11 rounded-full bg-primary items-center justify-center">
              <Text className="text-white text-lg font-semibold">
                {user?.email?.[0]?.toUpperCase() || "U"}
              </Text>
            </View>
            <TextInput
              placeholder="Add your thoughts..."
              placeholderTextColor="#6B6B6B"
              value={content}
              onChangeText={setContent}
              multiline
              className="flex-1 ml-3 text-lg text-text-primary"
              style={{ textAlignVertical: "top", minHeight: 80 }}
              autoFocus
            />
          </View>

          {/* Embedded Original Post */}
          {isLoading ? (
            <View className="bg-surface-elevated border border-border rounded-xl p-4 items-center justify-center h-32">
              <ActivityIndicator color="#10B981" />
            </View>
          ) : originalPost ? (
            <View className="bg-surface-elevated border border-border rounded-xl p-4">
              {/* Original Author with Federated Badge */}
              <View className="flex-row items-center gap-2 mb-2">
                <Image 
                  source={{ uri: avatarUrl }} 
                  style={{ width: 24, height: 24, borderRadius: 12 }} 
                />
                <Text className="font-semibold text-sm text-text-primary">
                  {originalPost.author?.display_name || originalPost.author?.username}
                </Text>
                <Text className="text-text-muted text-sm">
                  @{originalPost.author?.username}
                </Text>
                {isFederated && (
                  <View className="flex-row items-center gap-1 bg-blue-500/20 px-1.5 py-0.5 rounded-full ml-auto">
                    <Globe2 size={10} color="#3B82F6" />
                    <Text className="text-xs text-blue-500 font-medium">Global</Text>
                  </View>
                )}
              </View>
              
              {/* Original Content */}
              <Text className="text-text-primary text-base leading-5" numberOfLines={4}>
                {originalPost.content}
              </Text>

              {/* Original Media Preview */}
              {originalPost.media_urls && originalPost.media_urls.length > 0 && (
                <View className="mt-3 rounded-lg overflow-hidden border border-border">
                  <Image
                    source={{ uri: originalPost.media_urls[0] }}
                    style={{ width: "100%", height: 120 }}
                    contentFit="cover"
                  />
                </View>
              )}
            </View>
          ) : (
            <View className="bg-surface-elevated border border-border rounded-xl p-4 items-center">
              <Text className="text-text-muted">Post not found</Text>
            </View>
          )}
          
          {/* Info text for federated quotes */}
          {isFederated && (
            <Text className="text-text-muted text-xs mt-3 text-center">
              Your quote will be visible on both Cannect and Bluesky.
            </Text>
          )}
        </View>

        {/* Footer */}
        <View className="flex-row justify-end items-center px-4 py-3 border-t border-border">
          <Text className={`text-sm ${isOverLimit ? 'text-accent-error' : 'text-text-muted'}`}>
            {charCount}/{maxChars}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
