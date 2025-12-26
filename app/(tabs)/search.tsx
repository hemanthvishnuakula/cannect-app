/**
 * Search Screen - Unified Search with Official Bluesky APIs
 * 
 * - No query: Shows suggested users to follow (getSuggestions)
 * - With query: Shows both users and posts in unified results
 */

import { useState, useMemo, useCallback } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Image, Platform, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Search as SearchIcon, X, Users, Sparkles, UserPlus, Check, FileText } from "lucide-react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSearchUsers, useSuggestedUsers, useFollow, useSearchPosts } from "@/lib/hooks";
import { useDebounce } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";
import { useQueryClient } from "@tanstack/react-query";
import type { AppBskyActorDefs, AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

type ProfileView = AppBskyActorDefs.ProfileView;
type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type AnyProfileView = ProfileView | ProfileViewDetailed;

type SearchResultItem = 
  | { type: 'section'; title: string; icon: 'users' | 'posts' }
  | { type: 'user'; data: AnyProfileView }
  | { type: 'post'; data: AppBskyFeedDefs.PostView }
  | { type: 'empty'; section: 'users' | 'posts' };

function UserRow({ 
  user, 
  onPress, 
  onFollow,
  isFollowPending,
  showFollowButton = true,
  currentUserDid,
}: { 
  user: AnyProfileView; 
  onPress: () => void;
  onFollow?: () => void;
  isFollowPending?: boolean;
  showFollowButton?: boolean;
  currentUserDid?: string;
}) {
  const isFollowing = !!user.viewer?.following;
  const isSelf = user.did === currentUserDid;
  const canShowFollow = showFollowButton && !isFollowing && !isSelf && onFollow;

  return (
    <Pressable 
      onPress={onPress}
      className="flex-row items-center px-4 py-3 border-b border-border active:bg-surface-elevated"
    >
      {user.avatar ? (
        <Image source={{ uri: user.avatar }} className="w-12 h-12 rounded-full" />
      ) : (
        <View className="w-12 h-12 rounded-full bg-surface-elevated items-center justify-center">
          <Text className="text-text-muted text-lg">{user.handle[0].toUpperCase()}</Text>
        </View>
      )}
      <View className="flex-1 ml-3">
        <Text className="font-semibold text-text-primary">{user.displayName || user.handle}</Text>
        <Text className="text-text-muted">@{user.handle}</Text>
        {user.description && (
          <Text className="text-text-secondary text-sm mt-1" numberOfLines={2}>
            {user.description}
          </Text>
        )}
      </View>
      
      {/* Follow Button */}
      {canShowFollow && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onFollow();
          }}
          disabled={isFollowPending}
          className={`ml-2 px-4 py-2 rounded-full ${isFollowPending ? 'bg-primary/50' : 'bg-primary'}`}
        >
          {isFollowPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <View className="flex-row items-center gap-1">
              <UserPlus size={14} color="white" />
              <Text className="text-white font-semibold text-sm">Follow</Text>
            </View>
          )}
        </Pressable>
      )}
      
      {/* Already Following Badge */}
      {isFollowing && !isSelf && (
        <View className="ml-2 flex-row items-center gap-1 px-3 py-2 rounded-full bg-surface-elevated">
          <Check size={14} color="#10B981" />
          <Text className="text-primary text-sm font-medium">Following</Text>
        </View>
      )}
    </Pressable>
  );
}

function PostRow({ 
  post, 
  onPress,
  onAuthorPress,
}: { 
  post: AppBskyFeedDefs.PostView;
  onPress: () => void;
  onAuthorPress: () => void;
}) {
  const record = post.record as AppBskyFeedPost.Record;
  const author = post.author;

  // Get embed images if present
  const embedImages = post.embed?.$type === 'app.bsky.embed.images#view' 
    ? (post.embed as any).images 
    : [];

  return (
    <Pressable 
      onPress={onPress}
      className="px-4 py-3 border-b border-border active:bg-surface-elevated"
    >
      <View className="flex-row">
        {/* Avatar */}
        <Pressable onPress={onAuthorPress}>
          {author.avatar ? (
            <Image 
              source={{ uri: author.avatar }} 
              className="w-10 h-10 rounded-full bg-surface-elevated"
            />
          ) : (
            <View className="w-10 h-10 rounded-full bg-surface-elevated items-center justify-center">
              <Text className="text-text-muted text-lg">{author.handle[0].toUpperCase()}</Text>
            </View>
          )}
        </Pressable>

        {/* Content */}
        <View className="flex-1 ml-3">
          {/* Header */}
          <View className="flex-row items-center">
            <Text className="font-semibold text-text-primary flex-shrink" numberOfLines={1}>
              {author.displayName || author.handle}
            </Text>
            <Text className="text-text-muted mx-1">·</Text>
            <Text className="text-text-muted flex-shrink-0">
              {formatTime(record.createdAt)}
            </Text>
          </View>
          <Text className="text-text-muted text-sm" numberOfLines={1}>
            @{author.handle}
          </Text>

          {/* Post text */}
          <Text className="text-text-primary mt-1 leading-5" numberOfLines={4}>
            {record.text}
          </Text>

          {/* Images */}
          {embedImages.length > 0 && (
            <View className="mt-2 rounded-xl overflow-hidden">
              {embedImages.length === 1 ? (
                <Image 
                  source={{ uri: embedImages[0].thumb }} 
                  className="w-full h-48 rounded-xl"
                  resizeMode="cover"
                />
              ) : (
                <View className="flex-row flex-wrap gap-1">
                  {embedImages.slice(0, 4).map((img: any, idx: number) => (
                    <Image 
                      key={idx}
                      source={{ uri: img.thumb }} 
                      className="w-[48%] h-32 rounded-lg"
                      resizeMode="cover"
                    />
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: 'users' | 'posts' }) {
  return (
    <View className="flex-row items-center gap-2 px-4 py-3 bg-background border-b border-border">
      {icon === 'users' ? (
        <Users size={18} color="#10B981" />
      ) : (
        <FileText size={18} color="#10B981" />
      )}
      <Text className="text-text-primary font-semibold text-base">{title}</Text>
    </View>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  
  const debouncedQuery = useDebounce(query, 300);
  const hasQuery = debouncedQuery.trim().length >= 2;

  // Search queries - only run when we have a query
  const usersQuery = useSearchUsers(hasQuery ? debouncedQuery : "");
  const postsQuery = useSearchPosts(hasQuery ? debouncedQuery : "");
  
  // Suggested users - shown when no query
  const suggestedUsersQuery = useSuggestedUsers();
  
  const { did: currentUserDid } = useAuthStore();
  const followMutation = useFollow();
  const queryClient = useQueryClient();
  const [pendingFollows, setPendingFollows] = useState<Set<string>>(new Set());

  // Filter search results
  const searchUsers = useMemo(() => {
    const allUsers = usersQuery.data?.pages?.flatMap(page => page.actors) || [];
    return allUsers.filter(user => user.did !== currentUserDid);
  }, [usersQuery.data, currentUserDid]);

  const searchPosts = useMemo(() => {
    return postsQuery.data?.pages?.flatMap(page => page.posts) || [];
  }, [postsQuery.data]);

  // Suggested users when no query
  const suggestedUsers = useMemo(() => {
    const allUsers = suggestedUsersQuery.data || [];
    
    // Filter out invalid/test accounts
    const testPatterns = /^(test|demo|fake|dummy|sample|example|admin|bot|temp|tmp)/i;
    
    return allUsers.filter(user => {
      // Skip current user
      if (user.did === currentUserDid) return false;
      
      // Skip users we already follow
      if (user.viewer?.following) return false;
      
      // Skip accounts with no handle
      if (!user.handle) return false;
      
      // Skip test/invalid handles
      const handleName = user.handle.split('.')[0]; // Get the part before .cannect.space
      if (testPatterns.test(handleName)) return false;
      
      // Skip handles that are just numbers or very short
      if (/^\d+$/.test(handleName) || handleName.length < 3) return false;
      
      // Skip accounts with no display name AND no bio (likely incomplete)
      if (!user.displayName && !user.description) return false;
      
      return true;
    });
  }, [suggestedUsersQuery.data, currentUserDid]);

  // Build unified search results
  const searchResults: SearchResultItem[] = useMemo(() => {
    if (!hasQuery) return [];
    
    const results: SearchResultItem[] = [];
    
    // Users section
    results.push({ type: 'section', title: 'People', icon: 'users' });
    if (searchUsers.length > 0) {
      // Show top 5 users
      searchUsers.slice(0, 5).forEach(user => {
        results.push({ type: 'user', data: user });
      });
    } else if (!usersQuery.isLoading) {
      results.push({ type: 'empty', section: 'users' });
    }
    
    // Posts section
    results.push({ type: 'section', title: 'Posts', icon: 'posts' });
    if (searchPosts.length > 0) {
      searchPosts.forEach(post => {
        results.push({ type: 'post', data: post });
      });
    } else if (!postsQuery.isLoading) {
      results.push({ type: 'empty', section: 'posts' });
    }
    
    return results;
  }, [hasQuery, searchUsers, searchPosts, usersQuery.isLoading, postsQuery.isLoading]);

  const handleUserPress = (user: AnyProfileView) => {
    router.push(`/user/${user.handle}`);
  };

  const handlePostPress = (post: AppBskyFeedDefs.PostView) => {
    const parts = post.uri.split('/');
    const rkey = parts[parts.length - 1];
    router.push(`/post/${rkey}?did=${encodeURIComponent(post.author.did)}`);
  };

  const handleFollow = useCallback(async (user: AnyProfileView) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    
    setPendingFollows(prev => new Set(prev).add(user.did));
    
    try {
      await followMutation.mutateAsync(user.did);
      queryClient.invalidateQueries({ queryKey: ['searchUsers'] });
      queryClient.invalidateQueries({ queryKey: ['suggestedUsers'] });
    } catch (error) {
      console.error('Failed to follow:', error);
    } finally {
      setPendingFollows(prev => {
        const next = new Set(prev);
        next.delete(user.did);
        return next;
      });
    }
  }, [followMutation, queryClient]);

  const isSearching = hasQuery && (usersQuery.isLoading || postsQuery.isLoading);

  const renderItem = useCallback(({ item }: { item: SearchResultItem }) => {
    switch (item.type) {
      case 'section':
        return <SectionHeader title={item.title} icon={item.icon} />;
      case 'user':
        return (
          <UserRow 
            user={item.data} 
            onPress={() => handleUserPress(item.data)}
            onFollow={() => handleFollow(item.data)}
            isFollowPending={pendingFollows.has(item.data.did)}
            currentUserDid={currentUserDid || undefined}
          />
        );
      case 'post':
        return (
          <PostRow 
            post={item.data}
            onPress={() => handlePostPress(item.data)}
            onAuthorPress={() => router.push(`/user/${item.data.author.handle}`)}
          />
        );
      case 'empty':
        return (
          <View className="py-4 px-4">
            <Text className="text-text-muted text-center">
              {item.section === 'users' ? 'No users found' : 'No posts found'}
            </Text>
          </View>
        );
      default:
        return null;
    }
  }, [pendingFollows, currentUserDid, handleFollow, router]);

  const getItemType = (item: SearchResultItem) => item.type;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Search Header */}
      <View className="px-4 py-3 border-b border-border">
        <View className="flex-row items-center bg-surface-elevated rounded-xl px-4 py-2">
          <SearchIcon size={20} color="#6B7280" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search users and posts..."
            placeholderTextColor="#6B7280"
            className="flex-1 ml-2 text-text-primary text-base py-1"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <X size={20} color="#6B7280" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Content */}
      {!hasQuery ? (
        // No query - show suggested users
        <FlashList
          data={suggestedUsers}
          keyExtractor={(item) => item.did}
          estimatedItemSize={80}
          refreshControl={
            <RefreshControl
              refreshing={suggestedUsersQuery.isRefetching}
              onRefresh={() => suggestedUsersQuery.refetch()}
              tintColor="#10B981"
              colors={["#10B981"]}
            />
          }
          ListHeaderComponent={
            <View className="px-4 pt-4 pb-2">
              <View className="flex-row items-center gap-2 mb-3">
                <Sparkles size={18} color="#10B981" />
                <Text className="text-text-primary font-semibold text-lg">
                  Suggested for you
                </Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <UserRow 
              user={item} 
              onPress={() => handleUserPress(item)}
              onFollow={() => handleFollow(item)}
              isFollowPending={pendingFollows.has(item.did)}
              currentUserDid={currentUserDid || undefined}
            />
          )}
          ListEmptyComponent={
            suggestedUsersQuery.isLoading ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="large" color="#10B981" />
              </View>
            ) : (
              <View className="py-12 items-center px-6">
                <Users size={48} color="#6B7280" />
                <Text className="text-text-primary text-lg font-semibold mt-4">
                  No suggestions yet
                </Text>
                <Text className="text-text-muted text-center mt-2">
                  Start searching to discover users and posts!
                </Text>
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      ) : isSearching ? (
        // Loading search results
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
          <Text className="text-text-muted mt-3">Searching...</Text>
        </View>
      ) : (
        // Show unified search results
        <FlashList
          data={searchResults}
          keyExtractor={(item, index) => {
            if (item.type === 'section') return `section-${item.title}`;
            if (item.type === 'user') return `user-${item.data.did}`;
            if (item.type === 'post') return `post-${item.data.uri}`;
            if (item.type === 'empty') return `empty-${item.section}`;
            return `item-${index}`;
          }}
          getItemType={getItemType}
          estimatedItemSize={100}
          refreshControl={
            <RefreshControl
              refreshing={usersQuery.isRefetching || postsQuery.isRefetching}
              onRefresh={() => {
                usersQuery.refetch();
                postsQuery.refetch();
              }}
              tintColor="#10B981"
              colors={["#10B981"]}
            />
          }
          renderItem={renderItem}
          onEndReached={() => {
            // Load more posts when scrolling
            if (postsQuery.hasNextPage && !postsQuery.isFetchingNextPage) {
              postsQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            postsQuery.isFetchingNextPage ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#10B981" />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </SafeAreaView>
  );
}
