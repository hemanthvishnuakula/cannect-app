/**
 * Search Screen - Enhanced with AT Protocol Features
 *
 * Features:
 * - Trending topics when no query
 * - Sort toggle (Top/Latest)
 * - Typeahead suggestions
 * - Unified user + post results
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import {
  Search as SearchIcon,
  X,
  Users,
  Sparkles,
  FileText,
  TrendingUp,
  Hash,
  ArrowUpDown,
  Crown,
} from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  useSearchUsers,
  useSuggestedUsers,
  useSearchPosts,
  useTrendingTopics,
  useTopUsers,
  useSearchTypeahead,
  useDebounce,
} from '@/lib/hooks';
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

function SortToggle({ sort, onToggle }: { sort: 'top' | 'latest'; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center gap-1.5 px-3 py-1.5 bg-surface-elevated rounded-full"
    >
      <ArrowUpDown size={14} color="#10B981" />
      <Text className="text-text-primary text-sm font-medium capitalize">{sort}</Text>
    </Pressable>
  );
}

function TrendingTopicChip({ topic, onPress }: { topic: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 px-3 py-2 bg-surface-elevated rounded-full mr-2 mb-2"
    >
      <Hash size={14} color="#10B981" />
      <Text className="text-text-primary text-sm">{topic}</Text>
    </Pressable>
  );
}

function TypeaheadSuggestion({
  user,
  onPress,
}: {
  user: AppBskyActorDefs.ProfileViewBasic;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-2 border-b border-border"
    >
      <View className="w-8 h-8 rounded-full bg-surface-elevated items-center justify-center overflow-hidden">
        {user.avatar ? (
          <View className="w-full h-full bg-gray-600" />
        ) : (
          <Users size={16} color="#6B7280" />
        )}
      </View>
      <View className="flex-1">
        <Text className="text-text-primary text-sm font-medium" numberOfLines={1}>
          {user.displayName || user.handle}
        </Text>
        <Text className="text-text-muted text-xs" numberOfLines={1}>
          @{user.handle}
        </Text>
      </View>
    </Pressable>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q || '');
  const [sort, setSort] = useState<'top' | 'latest'>('latest');
  const [showTypeahead, setShowTypeahead] = useState(false);
  const suggestedListRef = useRef<FlashList<any>>(null);
  const searchListRef = useRef<FlashList<any>>(null);
  const inputRef = useRef<TextInput>(null);

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
      setShowTypeahead(false);
    }
  }, [q]);

  const debouncedQuery = useDebounce(query, 300);
  const typeaheadQuery = useDebounce(query, 150); // Faster for typeahead
  const hasQuery = debouncedQuery.trim().length >= 2;

  // Typeahead for user suggestions while typing
  const typeaheadResults = useSearchTypeahead(
    showTypeahead && typeaheadQuery.length >= 1 ? typeaheadQuery : ''
  );

  // Search queries - only run when we have a query and typeahead is closed
  const usersQuery = useSearchUsers(hasQuery && !showTypeahead ? debouncedQuery : '');
  const postsQuery = useSearchPosts(hasQuery && !showTypeahead ? debouncedQuery : '', sort);

  // Trending topics - shown when no query
  const trendingQuery = useTrendingTopics();

  // Top users in Cannect - shown when no query
  const topUsersQuery = useTopUsers(3);

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
      const handleName = user.handle.split('.')[0];
      if (testPatterns.test(handleName)) return false;

      // Skip handles that are just numbers or very short
      if (/^\d+$/.test(handleName) || handleName.length < 3) return false;

      // Skip accounts with no display name AND no bio
      if (!user.displayName && !user.description) return false;

      return true;
    });
  }, [suggestedUsersQuery.data, currentUserDid]);

  // Trending topics
  const trendingTopics = useMemo(() => {
    const topics = trendingQuery.data?.topics || [];
    const suggested = trendingQuery.data?.suggested || [];
    // Combine and dedupe
    const all = [...topics, ...suggested];
    const seen = new Set<string>();
    return all
      .filter((t) => {
        const topic = t.topic?.toLowerCase();
        if (!topic || seen.has(topic)) return false;
        seen.add(topic);
        return true;
      })
      .slice(0, 12);
  }, [trendingQuery.data]);

  // Build unified search results
  const searchResults: SearchResultItem[] = useMemo(() => {
    if (!hasQuery || showTypeahead) return [];

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
  }, [
    hasQuery,
    showTypeahead,
    searchUsers,
    searchPosts,
    usersQuery.isLoading,
    postsQuery.isLoading,
  ]);

  const handleUserPress = (user: AnyProfileView | AppBskyActorDefs.ProfileViewBasic) => {
    setShowTypeahead(false);
    inputRef.current?.blur();
    router.push(`/user/${user.handle}`);
  };

  const handleTopicPress = (topic: string) => {
    // Remove # if present
    const cleanTopic = topic.startsWith('#') ? topic.slice(1) : topic;
    setQuery(cleanTopic);
    setShowTypeahead(false);
  };

  const handleSubmitSearch = () => {
    setShowTypeahead(false);
    inputRef.current?.blur();
  };

  const isSearching = hasQuery && !showTypeahead && (usersQuery.isLoading || postsQuery.isLoading);

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

  // Top users data
  const topUsers = topUsersQuery.data || [];

  const renderTrendingSection = () => (
    <View className="px-4 pt-4 pb-2">
      {/* Trending Topics */}
      {trendingTopics.length > 0 && (
        <View className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <TrendingUp size={18} color="#10B981" />
            <Text className="text-text-primary font-semibold text-lg">Trending</Text>
          </View>
          <View className="flex-row flex-wrap">
            {trendingTopics.map((t, i) => (
              <TrendingTopicChip
                key={`${t.topic}-${i}`}
                topic={t.topic || ''}
                onPress={() => handleTopicPress(t.topic || '')}
              />
            ))}
          </View>
        </View>
      )}

      {/* Top Users in Cannect */}
      {topUsers.length > 0 && (
        <View className="mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <Crown size={18} color="#F59E0B" />
            <Text className="text-text-primary font-semibold text-lg">Top Users in Cannect</Text>
          </View>
          <View className="bg-surface-elevated rounded-xl overflow-hidden border border-border">
            {topUsers.map((user, index) => (
              <View key={user.did}>
                <UserRow
                  user={user}
                  onPress={() => handleUserPress(user)}
                  showFollowButton
                  showBio={false}
                  shortHandle
                />
                {index < topUsers.length - 1 && <View className="h-px bg-border" />}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Suggested for you - only show if there are suggestions */}
      {suggestedUsers.length > 0 && (
        <View className="flex-row items-center gap-2 mb-3">
          <Sparkles size={18} color="#10B981" />
          <Text className="text-text-primary font-semibold text-lg">Suggested for you</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Search Header */}
      <View className="px-4 py-3 border-b border-border">
        <View className="flex-row items-center gap-2">
          <View className="flex-1 flex-row items-center bg-surface-elevated rounded-xl px-4 py-2">
            <SearchIcon size={20} color="#6B7280" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setShowTypeahead(text.length >= 1);
              }}
              onFocus={() => {
                if (query.length >= 1) setShowTypeahead(true);
              }}
              onSubmitEditing={handleSubmitSearch}
              placeholder="Search users and posts..."
              placeholderTextColor="#6B7280"
              className="flex-1 ml-2 text-text-primary text-base py-1"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => {
                  setQuery('');
                  setShowTypeahead(false);
                }}
              >
                <X size={20} color="#6B7280" />
              </Pressable>
            )}
          </View>
          {/* Sort toggle - only show when searching */}
          {hasQuery && !showTypeahead && (
            <SortToggle
              sort={sort}
              onToggle={() => setSort((s) => (s === 'latest' ? 'top' : 'latest'))}
            />
          )}
        </View>
      </View>

      {/* Typeahead suggestions */}
      {showTypeahead && typeaheadResults.data && typeaheadResults.data.length > 0 && (
        <View className="bg-background border-b border-border">
          {typeaheadResults.data.slice(0, 5).map((user) => (
            <TypeaheadSuggestion key={user.did} user={user} onPress={() => handleUserPress(user)} />
          ))}
          <Pressable
            onPress={handleSubmitSearch}
            className="flex-row items-center gap-2 px-4 py-3 bg-surface-elevated"
          >
            <SearchIcon size={16} color="#10B981" />
            <Text className="text-primary text-sm font-medium">Search for "{query}"</Text>
          </Pressable>
        </View>
      )}

      {/* Content */}
      {!hasQuery ? (
        // No query - show trending + suggested users
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
              refreshing={suggestedUsersQuery.isRefetching || trendingQuery.isRefetching || topUsersQuery.isRefetching}
              onRefresh={() => {
                suggestedUsersQuery.refetch();
                trendingQuery.refetch();
                topUsersQuery.refetch();
              }}
              tintColor="#10B981"
              colors={['#10B981']}
            />
          }
          ListHeaderComponent={renderTrendingSection}
          renderItem={({ item }) => (
            <UserRow user={item} onPress={() => handleUserPress(item)} showFollowButton />
          )}
          ListEmptyComponent={
            suggestedUsersQuery.isLoading || topUsersQuery.isLoading ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="large" color="#10B981" />
              </View>
            ) : topUsers.length > 0 || trendingTopics.length > 0 ? (
              // Don't show empty state if we have top users or trending topics
              null
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
      ) : showTypeahead ? null : isSearching ? (
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
