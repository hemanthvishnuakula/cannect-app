/**
 * Messages Screen - Direct Messages
 *
 * Simple conversation list with inline chat.
 * Tap conversation to expand and see messages + reply input.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send, ChevronDown, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  useConversations,
  useMessages,
  useSendMessage,
  useMarkConvoRead,
  type Conversation,
  type ChatMessage,
} from '@/lib/hooks';
import { getAvatarUrl } from '@/lib/utils/avatar';
import * as atproto from '@/lib/atproto/agent';

export default function MessagesScreen() {
  const router = useRouter();
  const { convoId: initialConvoId } = useLocalSearchParams<{ convoId?: string }>();
  const [expandedConvoId, setExpandedConvoId] = useState<string | null>(initialConvoId || null);

  const { data: convosData, isLoading, refetch, isRefetching } = useConversations();
  const conversations: Conversation[] =
    convosData?.pages?.flatMap((page: any) => page.convos || []) || [];

  const handleBack = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.back();
  }, [router]);

  const toggleConversation = useCallback((convoId: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedConvoId((prev) => (prev === convoId ? null : convoId));
  }, []);

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
      <Header onBack={handleBack} isRefreshing={isRefetching} onRefresh={refetch} />

      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        {conversations.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20 px-6">
            <Text className="text-text-primary text-lg font-semibold mb-2">No messages yet</Text>
            <Text className="text-text-muted text-center">
              Start a conversation by visiting someone's profile and tapping Message.
            </Text>
          </View>
        ) : (
          conversations.map((convo) => (
            <ConversationItem
              key={convo.id}
              conversation={convo}
              isExpanded={expandedConvoId === convo.id}
              onToggle={() => toggleConversation(convo.id)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================
// HEADER
// ============================================================

function Header({
  onBack,
  isRefreshing,
  onRefresh,
}: {
  onBack: () => void;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-border">
      <Pressable onPress={onBack} className="p-2 -ml-2 mr-2">
        <ArrowLeft size={24} color="#FFFFFF" />
      </Pressable>
      <Text className="text-xl font-bold text-text-primary flex-1">Messages</Text>
      {isRefreshing && <ActivityIndicator size="small" color="#10B981" />}
    </View>
  );
}

// ============================================================
// CONVERSATION ITEM
// ============================================================

function ConversationItem({
  conversation,
  isExpanded,
  onToggle,
}: {
  conversation: Conversation;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Get the other member (not current user)
  const otherMember = conversation.members?.[0]; // Bluesky returns only other members
  const displayName = otherMember?.displayName || otherMember?.handle || 'Unknown';
  const handle = otherMember?.handle || '';
  const avatar = otherMember?.avatar;
  const lastMessage = conversation.lastMessage;
  const hasUnread = conversation.unreadCount > 0;

  return (
    <View className="border-b border-border">
      {/* Conversation Header (tap to expand) */}
      <Pressable
        onPress={onToggle}
        className={`flex-row items-center px-4 py-3 ${hasUnread ? 'bg-primary/5' : ''}`}
      >
        <Image
          source={{ uri: getAvatarUrl(avatar, 'thumb') || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff` }}
          style={{ width: 48, height: 48, borderRadius: 24 }}
          contentFit="cover"
        />
        <View className="flex-1 ml-3">
          <View className="flex-row items-center">
            <Text
              className={`text-text-primary font-semibold ${hasUnread ? 'font-bold' : ''}`}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {hasUnread && (
              <View className="ml-2 bg-primary px-2 py-0.5 rounded-full">
                <Text className="text-white text-xs font-bold">{conversation.unreadCount}</Text>
              </View>
            )}
          </View>
          <Text className="text-text-muted text-sm" numberOfLines={1}>
            @{handle}
          </Text>
          {lastMessage && (
            <Text className="text-text-muted text-sm mt-1" numberOfLines={1}>
              {lastMessage.text}
            </Text>
          )}
        </View>
        {isExpanded ? (
          <ChevronDown size={20} color="#6B7280" />
        ) : (
          <ChevronRight size={20} color="#6B7280" />
        )}
      </Pressable>

      {/* Expanded Chat */}
      {isExpanded && <ChatView convoId={conversation.id} />}
    </View>
  );
}

// ============================================================
// CHAT VIEW (Messages + Input)
// ============================================================

function ChatView({ convoId }: { convoId: string }) {
  const [messageText, setMessageText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);

  const { data: messagesData, isLoading } = useMessages(convoId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutate: markRead } = useMarkConvoRead();

  // Messages come newest first, reverse for display
  const messages: ChatMessage[] = [
    ...(messagesData?.pages?.flatMap((page: any) => page.messages || []) || []),
  ].reverse();

  // Mark as read when opened
  useEffect(() => {
    markRead(convoId);
  }, [convoId, markRead]);

  // Scroll to bottom on new messages
  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages.length]);

  const handleSend = useCallback(() => {
    if (!messageText.trim() || isSending) return;

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    sendMessage(
      { convoId, text: messageText.trim() },
      {
        onSuccess: () => {
          setMessageText('');
        },
      }
    );
  }, [convoId, messageText, sendMessage, isSending]);

  if (isLoading) {
    return (
      <View className="py-8 items-center">
        <ActivityIndicator size="small" color="#10B981" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="bg-surface"
    >
      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        className="max-h-64 px-4 py-2"
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 ? (
          <Text className="text-text-muted text-center py-4">No messages yet</Text>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </ScrollView>

      {/* Input */}
      <View className="flex-row items-center px-4 py-3 border-t border-border">
        <TextInput
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a message..."
          placeholderTextColor="#6B7280"
          className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-text-primary mr-2"
          multiline
          maxLength={1000}
          editable={!isSending}
        />
        <Pressable
          onPress={handleSend}
          disabled={!messageText.trim() || isSending}
          className={`p-3 rounded-full ${messageText.trim() ? 'bg-primary' : 'bg-gray-700'}`}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Send size={20} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ============================================================
// MESSAGE BUBBLE
// ============================================================

function MessageBubble({ message }: { message: ChatMessage }) {
  const session = atproto.getSession();
  const isOwn = session?.did === message.sender?.did;

  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View className={`mb-2 ${isOwn ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[80%] px-4 py-2 rounded-2xl ${
          isOwn ? 'bg-primary rounded-br-sm' : 'bg-surface-elevated rounded-bl-sm'
        }`}
      >
        <Text className={isOwn ? 'text-white' : 'text-text-primary'}>{message.text}</Text>
      </View>
      <Text className="text-text-muted text-xs mt-1">{time}</Text>
    </View>
  );
}
