/**
 * Messages List Screen
 *
 * Shows all conversations. Tap to open full-screen chat.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  useConversations,
  type Conversation,
} from '@/lib/hooks';
import { getAvatarUrl } from '@/lib/utils/avatar';
import * as atproto from '@/lib/atproto/agent';

export default function MessagesListScreen() {
  const router = useRouter();
  const { data: convosData, isLoading, refetch, isRefetching } = useConversations();
  
  const conversations: Conversation[] =
    convosData?.pages?.flatMap((page: any) => page.convos || []) || [];

  const handleBack = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.back();
  }, [router]);

  const openChat = useCallback((convo: Conversation) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push(`/messages/${convo.id}` as any);
  }, [router]);

  const renderConversation = useCallback(({ item: convo }: { item: Conversation }) => {
    return <ConversationRow conversation={convo} onPress={() => openChat(convo)} />;
  }, [openChat]);

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

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <Header onBack={handleBack} />

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
              Start a conversation by visiting someone's profile and tapping Message.
            </Text>
          </View>
        }
        contentContainerStyle={conversations.length === 0 ? { flex: 1 } : undefined}
      />
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
  // Bluesky may return all members, so filter out ourselves
  const otherMember = conversation.members?.find((m) => m.did !== session?.did) || conversation.members?.[0];
  
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
        source={{ uri: getAvatarUrl(avatar, 'thumb') || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff` }}
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
          <Text className="text-text-muted text-xs ml-2">
            {formatTime(lastMessage?.sentAt)}
          </Text>
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
