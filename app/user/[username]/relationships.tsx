import { View, Text, ActivityIndicator, Pressable, Platform } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { RefreshCw } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useUserRelationships, useProfileByUsername } from "@/lib/hooks";
import { ProfileRow } from "@/components/Profile/ProfileRow";

export default function UserRelationshipsScreen() {
  const { username, type } = useLocalSearchParams<{ username: string; type: 'followers' | 'following' }>();
  const router = useRouter();
  
  // Look up profile by username to get the user ID
  const { data: profile } = useProfileByUsername(username!);
  
  // Fetch the relationship data with infinite scroll
  const { 
    data, 
    fetchNextPage, 
    hasNextPage, 
    isLoading,
    isError,
    isRefetching,
    refetch,
    isFetchingNextPage 
  } = useUserRelationships(profile?.id ?? "", type ?? 'followers');

  const handleRefresh = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    refetch();
  };

  const users = data?.pages.flat() || [];

  const title = type === 'followers' ? 'Followers' : 'Following';

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen 
        options={{ 
          title: title,
          headerBackTitle: "Back"
        }} 
      />
      
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <RefreshCw size={48} color="#6B7280" />
          <Text className="text-text-primary text-lg font-semibold mt-4">Failed to load</Text>
          <Text className="text-text-muted text-center mt-2">Something went wrong. Please try again.</Text>
          <Pressable 
            onPress={handleRefresh} 
            className="bg-primary px-6 py-3 rounded-full mt-4"
          >
            <Text className="text-white font-semibold">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1" style={{ flex: 1, minHeight: 2 }}>
          <FlashList
            data={users}
            estimatedItemSize={70}
            keyExtractor={(item, index) => `${type}-${item.id}-${index}`}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            renderItem={({ item }) => (
              <ProfileRow 
                profile={item} 
                showFollowButton={true}
                onPress={() => router.push(`/user/${item.username}` as any)}
              />
            )}
            onEndReached={() => hasNextPage && fetchNextPage()}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View className="py-4 items-center">
                  <ActivityIndicator size="small" color="#10B981" />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View className="py-20 items-center">
                <Text className="text-text-muted text-lg">
                  {type === 'followers' 
                    ? "No followers yet" 
                    : "Not following anyone yet"
                  }
                </Text>
                <Text className="text-text-secondary text-sm mt-2">
                  {type === 'followers'
                    ? "When people follow this account, they'll appear here."
                    : "When this account follows people, they'll appear here."
                  }
                </Text>
              </View>
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}
