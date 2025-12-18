import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Search as SearchIcon, X, Users } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSearch, useTrendingActors, useActiveCannectUsers } from "@/lib/hooks";
import { ProfileRow } from "@/components/Profile/ProfileRow";
import { TrendingDiscovery } from "@/components/Search";
import { cn } from "@/lib/utils";

type SearchTab = "local" | "global";

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("local");
  
  const { data: searchResults, isLoading: isSearching } = useSearch(query);
  const { data: trendingActors, isLoading: isTrendingLoading } = useTrendingActors();
  const { data: activeUsers, isLoading: isActiveLoading } = useActiveCannectUsers();

  const hasQuery = query.trim().length >= 2;
  const showDiscovery = !hasQuery;

  // Handle tapping a global Bluesky user - navigate to their profile/feed preview
  const handleGlobalUserPress = (actor: any) => {
    // Navigate to a federated user profile view
    // For now, we'll show their handle - can expand later
    router.push(`/federated/${actor.username}` as any);
  };

  // Render search results based on active tab
  const renderSearchResults = () => {
    if (!hasQuery) return null;

    const data = activeTab === "local" ? searchResults?.local : searchResults?.global;
    const isEmpty = !data || data.length === 0;

    if (isSearching) {
      return (
        <View className="flex-1 items-center justify-center py-20">
          <ActivityIndicator color="#10B981" size="large" />
        </View>
      );
    }

    if (isEmpty) {
      return (
        <View className="flex-1 items-center justify-center py-20">
          <Text className="text-text-muted text-base">
            {activeTab === "local" 
              ? "No Cannect users found" 
              : "No Bluesky users found"}
          </Text>
          {activeTab === "local" && (
            <Pressable onPress={() => setActiveTab("global")} className="mt-3">
              <Text className="text-primary font-medium">Try searching globally →</Text>
            </Pressable>
          )}
        </View>
      );
    }

    return (
      <FlashList
        data={data}
        keyExtractor={(item: any, index) => `${activeTab}-${item.id}-${index}`}
        estimatedItemSize={72}
        renderItem={({ item }: { item: any }) => (
          <View className="px-4">
            <ProfileRow
              profile={item}
              showFollowButton={activeTab === "local"}
              isFederated={activeTab === "global"}
              onPress={activeTab === "global" ? () => handleGlobalUserPress(item) : undefined}
            />
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    );
  };

  // Handle trending topic tap - search for that topic
  const handleTopicPress = (topic: string) => {
    setQuery(topic);
    setActiveTab("global");
  };

  // Render discovery state (no search query)
  const renderDiscovery = () => {
    return (
      <FlashList
        data={[{ type: "header" }]}
        keyExtractor={(item, index) => `discovery-${index}`}
        estimatedItemSize={500}
        renderItem={() => (
          <View>
            {/* Trending Topics from Bluesky */}
            <TrendingDiscovery onTopicPress={handleTopicPress} />

            <View className="px-4 mt-6">
              {/* Active Cannect Users Section */}
              <View className="mb-6">
                <View className="flex-row items-center gap-2 mb-3">
                  <Users size={18} color="#10B981" />
                  <Text className="text-lg font-bold text-text-primary">Active on Cannect</Text>
                </View>
                {isActiveLoading ? (
                  <ActivityIndicator color="#10B981" />
                ) : activeUsers && activeUsers.length > 0 ? (
                  activeUsers.map((user: any) => (
                    <ProfileRow key={user.id} profile={user} showFollowButton />
                  ))
                ) : (
                  <Text className="text-text-muted text-sm">No active users yet</Text>
                )}
              </View>

              {/* Suggested Bluesky Actors Section */}
              <View className="mb-6">
                <View className="flex-row items-center gap-2 mb-3">
                  <Users size={18} color="#3B82F6" />
                  <Text className="text-lg font-bold text-text-primary">Discover Globally</Text>
                </View>
                {isTrendingLoading ? (
                  <ActivityIndicator color="#3B82F6" />
                ) : trendingActors && trendingActors.length > 0 ? (
                  trendingActors.slice(0, 5).map((actor: any) => (
                    <ProfileRow
                      key={actor.id}
                      profile={actor}
                      isFederated
                      showFollowButton={false}
                      onPress={() => handleGlobalUserPress(actor)}
                    />
                  ))
                ) : (
                  <Text className="text-text-muted text-sm">Unable to load suggestions</Text>
                )}
              </View>
            </View>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="px-5 py-4">
        <Text className="text-3xl font-bold text-text-primary">Search</Text>
      </View>

      {/* Search Input */}
      <View className="flex-row items-center bg-surface-elevated mx-5 px-4 rounded-xl mb-2">
        <SearchIcon size={20} color="#6B6B6B" />
        <TextInput
          placeholder="Search people or @bluesky.handle..."
          placeholderTextColor="#6B6B6B"
          value={query}
          onChangeText={setQuery}
          className="flex-1 py-3.5 px-3 text-text-primary text-base"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")}>
            <X size={20} color="#6B6B6B" />
          </Pressable>
        )}
      </View>

      {/* Tabs (only show when searching) */}
      {hasQuery && (
        <View className="flex-row border-b border-border mx-4">
          <Pressable
            onPress={() => setActiveTab("local")}
            className={cn(
              "flex-1 py-3 items-center",
              activeTab === "local" && "border-b-2 border-primary"
            )}
          >
            <View className="flex-row items-center gap-1.5">
              <Text
                className={cn(
                  "font-bold",
                  activeTab === "local" ? "text-primary" : "text-text-muted"
                )}
              >
                Cannect
              </Text>
              {searchResults?.local && searchResults.local.length > 0 && (
                <View className="bg-primary/20 px-1.5 py-0.5 rounded-full">
                  <Text className="text-[10px] font-bold text-primary">
                    {searchResults.local.length}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("global")}
            className={cn(
              "flex-1 py-3 items-center",
              activeTab === "global" && "border-b-2 border-blue-500"
            )}
          >
            <View className="flex-row items-center gap-1.5">
              <Text
                className={cn(
                  "font-bold",
                  activeTab === "global" ? "text-blue-500" : "text-text-muted"
                )}
              >
                Global
              </Text>
              {searchResults?.global && searchResults.global.length > 0 && (
                <View className="bg-blue-500/20 px-1.5 py-0.5 rounded-full">
                  <Text className="text-[10px] font-bold text-blue-500">
                    {searchResults.global.length}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        </View>
      )}

      {/* Content */}
      <View style={{ flex: 1, minHeight: 2 }}>
        {showDiscovery ? renderDiscovery() : renderSearchResults()}
      </View>
    </SafeAreaView>
  );
}
