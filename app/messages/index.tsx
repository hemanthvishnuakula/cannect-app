/**
 * Messages List Screen
 *
 * Shows all conversations. Tap to open full-screen chat.
 * Includes user search to start new conversations.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useConversations, useStartConversation, type Conversation } from '@/lib/hooks';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { getAvatarUrl } from '@/lib/utils/avatar';
import * as atproto from '@/lib/atproto/agent';

export default function MessagesListScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debouncedQuery = useDebounce(searchQuery, 300);

  const { data: convosData, isLoading, refetch, isRefetching } = useConversations();
  const { mutate: startConversation, isPending: isStartingConvo } = useStartConversation();

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

  const handleBack = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Use replace to go to feed instead of back() which can get stuck
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/feed' as any);
    }
  }, [router]);

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

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const renderConversation = useCallback(
    ({ item: convo }: { item: Conversation }) => {
      return <ConversationRow conversation={convo} onPress={() => openChat(convo)} />;
    },
    [openChat]
  );

  const renderSearchResult = useCallback(
    ({ item: user }: { item: any }) => {
      return (
        <UserSearchRow
          user={user}
          onPress={() => startChatWithUser(user)}
          isLoading={isStartingConvo}
        />
      );
    },
    [startChatWithUser, isStartingConvo]
  );

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Header onBack={handleBack} />
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
      <Header onBack={handleBack} />

      {/* Search Bar */}
      <View className="px-4 py-2 border-b border-border">
        <View className="flex-row items-center bg-surface rounded-full px-4 py-2">
          <Search size={18} color="#6B7280" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search users to message..."
            placeholderTextColor="#6B7280"
            className="flex-1 ml-2 text-text-primary"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={clearSearch} className="p-1">
              <X size={18} color="#6B7280" />
            </Pressable>
          )}
        </View>
      </View>

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
              <Text className="text-text-primary text-lg font-semibold mb-2">No messages yet</Text>
              <Text className="text-text-muted text-center">
                Search for a user above or visit someone's profile and tap Message.
              </Text>
            </View>
          }
          contentContainerStyle={conversations.length === 0 ? { flex: 1 } : undefined}
        />
      )}
    </SafeAreaView>
  );
}

// ============================================================
// HEADER
// ============================================================

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-border">
      <Pressable onPress={onBack} className="p-2 -ml-2 mr-2">
        <ArrowLeft size={24} color="#FFFFFF" />
      </Pressable>
      <Text className="text-xl font-bold text-text-primary flex-1">Messages</Text>
    </View>
  );
}

// ============================================================
// USER SEARCH ROW
// ============================================================

function UserSearchRow({
  user,
  onPress,
  isLoading,
}: {
  user: any;
  onPress: () => void;
  isLoading: boolean;
}) {
  const displayName = user.displayName || user.handle || 'Unknown';

  return (
    <Pressable
      onPress={onPress}
      disabled={isLoading}
      className="flex-row items-center px-4 py-3 border-b border-border active:bg-surface"
    >
      <Image
        source={{
          uri:
            getAvatarUrl(user.avatar, 'thumb') ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff`,
        }}
        style={{ width: 48, height: 48, borderRadius: 24 }}
        contentFit="cover"
      />
      <View className="flex-1 ml-3">
        <Text className="text-text-primary font-semibold" numberOfLines={1}>
          {displayName}
        </Text>
        <Text className="text-text-muted text-sm" numberOfLines={1}>
          @{user.handle}
        </Text>
      </View>
      {isLoading && <ActivityIndicator size="small" color="#10B981" />}
    </Pressable>
  );
}

// ============================================================
// CONVERSATION ROW
// ============================================================

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: Conversation;
  onPress: () => void;
}) {
  const session = atproto.getSession();

  // Get the OTHER member (not current user)
  const otherMember =
    conversation.members?.find((m) => m.did !== session?.did) || conversation.members?.[0];

  const displayName = otherMember?.displayName || otherMember?.handle || 'Unknown';
  const handle = otherMember?.handle || '';
  const avatar = otherMember?.avatar;
  const lastMessage = conversation.lastMessage;
  const hasUnread = conversation.unreadCount > 0;

  // Format time
  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-4 py-3 border-b border-border active:bg-surface ${hasUnread ? 'bg-primary/5' : ''}`}
    >
      <Image
        source={{
          uri:
            getAvatarUrl(avatar, 'thumb') ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff`,
        }}
        style={{ width: 52, height: 52, borderRadius: 26 }}
        contentFit="cover"
      />
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <Text
            className={`text-text-primary ${hasUnread ? 'font-bold' : 'font-semibold'}`}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {displayName}
          </Text>
          <Text className="text-text-muted text-xs ml-2">{formatTime(lastMessage?.sentAt)}</Text>
        </View>
        <Text className="text-text-muted text-sm" numberOfLines={1}>
          @{handle}
        </Text>
        {lastMessage && (
          <Text
            className={`text-sm mt-0.5 ${hasUnread ? 'text-text-primary font-medium' : 'text-text-muted'}`}
            numberOfLines={1}
          >
            {lastMessage.text}
          </Text>
        )}
      </View>
      {hasUnread && (
        <View className="ml-2 bg-primary w-6 h-6 rounded-full items-center justify-center">
          <Text className="text-white text-xs font-bold">{conversation.unreadCount}</Text>
        </View>
      )}
    </Pressable>
  );
}
