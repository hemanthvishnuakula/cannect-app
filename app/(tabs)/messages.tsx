/**
 * Messages Tab Screen
 *
 * This is the tab bar entry point for messages.
 * Renders the messages list directly with user search.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, ActivityIndicator, FlatList, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useConversations, useStartConversation, useLeaveConversation, type Conversation } from '@/lib/hooks';
import { useDebounce } from '@/lib/hooks/use-debounce';
import * as atproto from '@/lib/atproto/agent';
import { ComposeFAB, SearchBar } from '@/components/ui';
import { UserRow } from '@/components/Profile';
import { ConversationRow } from '@/components/messages';

export default function MessagesTabScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debouncedQuery = useDebounce(searchQuery, 300);

  const { data: convosData, isLoading, refetch, isRefetching } = useConversations();
  const { mutate: startConversation, isPending: isStartingConvo } = useStartConversation();
  const { mutate: leaveConversation } = useLeaveConversation();

  const conversations: Conversation[] =
    convosData?.pages?.flatMap((page: any) => page.convos || []) || [];

  // Search for users when query changes
  React.useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      try {
        const result = await atproto.searchActorsTypeahead(debouncedQuery, 10);
        setSearchResults(result.data.actors || []);
      } catch (error) {
        console.error('[Search] Error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    search();
  }, [debouncedQuery]);

  const openChat = useCallback(
    (convo: Conversation) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.push(`/messages/${convo.id}` as any);
    },
    [router]
  );

  const startChatWithUser = useCallback(
    (user: any) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      startConversation(user.did, {
        onSuccess: (convo) => {
          setSearchQuery('');
          setSearchResults([]);
          router.push(`/messages/${convo.id}` as any);
        },
        onError: (error) => {
          console.error('[Chat] Failed to start conversation:', error);
        },
      });
    },
    [startConversation, router]
  );

  const handleClearSearch = useCallback(() => {
    setSearchResults([]);
  }, []);

  const handleDeleteConversation = useCallback(
    (convoId: string) => {
      leaveConversation(convoId);
    },
    [leaveConversation]
  );

  const renderConversation = useCallback(
    ({ item: convo }: { item: Conversation }) => {
      return (
        <ConversationRow
          conversation={convo}
          onPress={() => openChat(convo)}
          onDelete={handleDeleteConversation}
        />
      );
    },
    [openChat, handleDeleteConversation]
  );

  const renderSearchResult = useCallback(
    ({ item: user }: { item: any }) => {
      return (
        <UserRow
          user={user}
          onPress={() => startChatWithUser(user)}
          showFollowButton={false}
          showBio={false}
          rightElement={
            isStartingConvo ? <ActivityIndicator size="small" color="#10B981" /> : undefined
          }
        />
      );
    },
    [startChatWithUser, isStartingConvo]
  );

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Header />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
          <Text className="text-text-muted mt-4">Loading messages...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const showSearchResults = searchQuery.length >= 2;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <Header />

      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        onClear={handleClearSearch}
        placeholder="Search users to message..."
      />

      {/* Search Results or Conversations */}
      {showSearchResults ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.did}
          renderItem={renderSearchResult}
          ListHeaderComponent={
            isSearching ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#10B981" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !isSearching ? (
              <View className="py-8 items-center">
                <Text className="text-text-muted">
                  {debouncedQuery.length >= 2 ? 'No users found' : 'Type to search users'}
                </Text>
              </View>
            ) : null
          }
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#10B981"
              colors={['#10B981']}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20 px-6">
              <MessageCircle size={48} color="#6B7280" />
              <Text className="text-text-primary text-lg font-semibold mb-2 mt-4">
                No messages yet
              </Text>
              <Text className="text-text-muted text-center">
                Search for a user above or visit someone's profile and tap Message.
              </Text>
            </View>
          }
          contentContainerStyle={conversations.length === 0 ? { flex: 1 } : undefined}
        />
      )}

      <ComposeFAB />
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View className="flex-row items-center justify-center px-4 py-3 border-b border-border">
      <Text className="text-xl font-bold text-text-primary">Messages</Text>
      <View className="ml-2 bg-primary/20 px-2 py-0.5 rounded-full">
        <Text className="text-primary text-xs font-semibold">Beta</Text>
      </View>
    </View>
  );
}
