/**
 * Search Screen - Unified Search with Official Bluesky APIs
 *
 * - No query: Shows suggested users to follow (getSuggestions)
 * - With query: Shows both users and posts in unified results
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Search as SearchIcon, X, Users, Sparkles, FileText } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSearchUsers, useSuggestedUsers, useSearchPosts, useDebounce } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';
import { PostCard } from '@/components/Post';
import { UserRow } from '@/components/Profile';
import { ComposeFAB } from '@/components/ui';
import { scrollToTop } from '@/lib/utils/scroll-to-top';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';

type ProfileView = AppBskyActorDefs.ProfileView;
type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type AnyProfileView = ProfileView | ProfileViewDetailed;

type SearchResultItem =
  | { type: 'section'; title: string; icon: 'users' | 'posts' }
  | { type: 'user'; data: AnyProfileView }
  | { type: 'post'; data: AppBskyFeedDefs.PostView }
  | { type: 'empty'; section: 'users' | 'posts' };

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
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q || '');
  const suggestedListRef = useRef<FlashList<any>>(null);
  const searchListRef = useRef<FlashList<any>>(null);

  // Scroll to top when tab is pressed
  useEffect(() => {
    return scrollToTop.subscribe('search', () => {
      suggestedListRef.current?.scrollToOffset({ offset: 0, animated: true });
      searchListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, []);

  // Update query when URL param changes (e.g., clicking hashtag)
  useEffect(() => {
    if (q && q !== query) {
      setQuery(q);
    }
  }, [q]);

  const debouncedQuery = useDebounce(query, 300);
  const hasQuery = debouncedQuery.trim().length >= 2;

  // Search queries - only run when we have a query
  const usersQuery = useSearchUsers(hasQuery ? debouncedQuery : '');
  const postsQuery = useSearchPosts(hasQuery ? debouncedQuery : '');

  // Suggested users - shown when no query
  const suggestedUsersQuery = useSuggestedUsers();

  const { did: currentUserDid } = useAuthStore();

  // Filter search results
  const searchUsers = useMemo(() => {
    const allUsers = usersQuery.data?.pages?.flatMap((page) => page.actors) || [];
    return allUsers.filter((user) => user.did !== currentUserDid);
  }, [usersQuery.data, currentUserDid]);

  const searchPosts = useMemo(() => {
    return postsQuery.data?.pages?.flatMap((page) => page.posts) || [];
  }, [postsQuery.data]);

  // Suggested users when no query
  const suggestedUsers = useMemo(() => {
    const allUsers = suggestedUsersQuery.data || [];

    // Filter out invalid/test accounts
    const testPatterns = /^(test|demo|fake|dummy|sample|example|admin|bot|temp|tmp)/i;

    return allUsers.filter((user) => {
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
      searchUsers.slice(0, 5).forEach((user) => {
        results.push({ type: 'user', data: user });
      });
    } else if (!usersQuery.isLoading) {
      results.push({ type: 'empty', section: 'users' });
    }

    // Posts section
    results.push({ type: 'section', title: 'Posts', icon: 'posts' });
    if (searchPosts.length > 0) {
      searchPosts.forEach((post) => {
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

  const isSearching = hasQuery && (usersQuery.isLoading || postsQuery.isLoading);

  const renderItem = useCallback(
    ({ item }: { item: SearchResultItem }) => {
      switch (item.type) {
        case 'section':
          return <SectionHeader title={item.title} icon={item.icon} />;
        case 'user':
          return (
            <UserRow
              user={item.data}
              onPress={() => handleUserPress(item.data)}
              showFollowButton={item.data.did !== currentUserDid}
            />
          );
        case 'post':
          return <PostCard post={item.data} />;
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
    },
    [currentUserDid, router]
  );

  const getItemType = (item: SearchResultItem) => item.type;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
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
            <Pressable onPress={() => setQuery('')}>
              <X size={20} color="#6B7280" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Content */}
      {!hasQuery ? (
        // No query - show suggested users
        <FlashList
          ref={suggestedListRef}
          data={suggestedUsers}
          keyExtractor={(item) => item.did}
          estimatedItemSize={80}
          overrideItemLayout={(layout) => {
            layout.size = 80;
          }}
          refreshControl={
            <RefreshControl
              refreshing={suggestedUsersQuery.isRefetching}
              onRefresh={() => suggestedUsersQuery.refetch()}
              tintColor="#10B981"
              colors={['#10B981']}
            />
          }
          ListHeaderComponent={
            <View className="px-4 pt-4 pb-2">
              <View className="flex-row items-center gap-2 mb-3">
                <Sparkles size={18} color="#10B981" />
                <Text className="text-text-primary font-semibold text-lg">Suggested for you</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <UserRow user={item} onPress={() => handleUserPress(item)} showFollowButton />
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
          ref={searchListRef}
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
          overrideItemLayout={(layout, item) => {
            // Different sizes for different item types
            if (item.type === 'section') layout.size = 50;
            else if (item.type === 'user') layout.size = 80;
            else if (item.type === 'post') layout.size = 280;
            else layout.size = 100;
          }}
          refreshControl={
            <RefreshControl
              refreshing={usersQuery.isRefetching || postsQuery.isRefetching}
              onRefresh={() => {
                usersQuery.refetch();
                postsQuery.refetch();
              }}
              tintColor="#10B981"
              colors={['#10B981']}
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

      {/* Floating Compose Button */}
      <ComposeFAB />
    </SafeAreaView>
  );
}
