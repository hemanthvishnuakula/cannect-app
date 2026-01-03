/**
 * Chat Screen - Full-screen conversation view
 *
 * Shows messages with the other user in a proper chat interface.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send } from 'lucide-react-native';
import {
  useConversation,
  useMessages,
  useSendMessage,
  useMarkConvoRead,
  useDeleteMessage,
  type ChatMessage,
} from '@/lib/hooks';
import { SwipeableMessage } from '@/components/messages';
import { getAvatarWithFallback } from '@/lib/utils/avatar';
import { triggerImpact } from '@/lib/utils/haptics';
import * as atproto from '@/lib/atproto/agent';

export default function ChatScreen() {
  const router = useRouter();
  const { convoId } = useLocalSearchParams<{ convoId: string }>();
  const [messageText, setMessageText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const { data: conversation, isLoading: isLoadingConvo } = useConversation(convoId);
  const { data: messagesData, isLoading: isLoadingMessages, refetch } = useMessages(convoId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutate: markRead } = useMarkConvoRead();
  const { mutate: deleteMessage } = useDeleteMessage();

  const session = atproto.getSession();

  // Get the OTHER member (not current user)
  const otherMember =
    conversation?.members?.find((m) => m.did !== session?.did) || conversation?.members?.[0];
  const displayName = otherMember?.displayName || otherMember?.handle || 'Loading...';
  const handle = otherMember?.handle || '';
  const avatar = otherMember?.avatar;

  // Messages come newest first from API, reverse for display (oldest at top)
  const messages: ChatMessage[] = React.useMemo(() => {
    const allMessages = messagesData?.pages?.flatMap((page: any) => page.messages || []) || [];
    return [...allMessages].reverse();
  }, [messagesData]);

  // Mark as read when opened
  useEffect(() => {
    if (convoId) {
      markRead(convoId);
    }
  }, [convoId, markRead]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleBack = useCallback(() => {
    triggerImpact('light');
    // Use canGoBack check to prevent stuck navigation
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/messages' as any);
    }
  }, [router]);

  const handleSend = useCallback(() => {
    if (!messageText.trim() || isSending || !convoId) return;

    triggerImpact('light');

    sendMessage(
      { convoId, text: messageText.trim() },
      {
        onSuccess: () => {
          setMessageText('');
          // Scroll to bottom after sending
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 200);
        },
      }
    );
  }, [convoId, messageText, sendMessage, isSending]);

  const handleProfilePress = useCallback(() => {
    if (otherMember?.handle) {
      router.push(`/user/${otherMember.handle}` as any);
    }
  }, [otherMember?.handle, router]);

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!convoId) return;
      deleteMessage({ convoId, messageId });
    },
    [convoId, deleteMessage]
  );

  const renderMessage = useCallback(
    ({ item: msg }: { item: ChatMessage }) => {
      return (
        <SwipeableMessage
          message={msg}
          currentUserDid={session?.did}
          onDelete={handleDeleteMessage}
        />
      );
    },
    [session?.did, handleDeleteMessage]
  );

  if (isLoadingConvo || isLoadingMessages) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ChatHeader
          displayName="Loading..."
          handle=""
          avatar={undefined}
          onBack={handleBack}
          onProfilePress={() => {}}
        />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <ChatHeader
        displayName={displayName}
        handle={handle}
        avatar={avatar}
        onBack={handleBack}
        onProfilePress={handleProfilePress}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 8,
            flexGrow: 1,
            justifyContent: messages.length === 0 ? 'center' : 'flex-end',
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-8">
              <View className="w-20 h-20 rounded-full bg-surface-elevated items-center justify-center mb-4">
                <Image
                  source={{ uri: getAvatarWithFallback(avatar, displayName) }}
                  style={{ width: 60, height: 60, borderRadius: 30 }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              </View>
              <Text className="text-text-primary text-lg font-semibold">{displayName}</Text>
              <Text className="text-text-muted text-sm">@{handle}</Text>
              <Text className="text-text-muted text-center mt-4 px-8">
                Send a message to start the conversation
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            if (messages.length > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
        />

        {/* Input Area */}
        <View className="flex-row items-end px-4 py-3 border-t border-border bg-background">
          <TextInput
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Message..."
            placeholderTextColor="#6B7280"
            className="flex-1 bg-surface border border-border rounded-3xl px-4 py-3 text-text-primary mr-3 max-h-32"
            multiline
            maxLength={1000}
            editable={!isSending}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={!messageText.trim() || isSending}
            className={`w-11 h-11 rounded-full items-center justify-center ${
              messageText.trim() ? 'bg-primary' : 'bg-gray-700'
            }`}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Send size={20} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================================
// CHAT HEADER
// ============================================================

function ChatHeader({
  displayName,
  handle,
  avatar,
  onBack,
  onProfilePress,
}: {
  displayName: string;
  handle: string;
  avatar?: string;
  onBack: () => void;
  onProfilePress: () => void;
}) {
  return (
    <View className="flex-row items-center px-4 py-2 border-b border-border">
      <Pressable onPress={onBack} className="p-2 -ml-2 mr-1">
        <ArrowLeft size={24} color="#FFFFFF" />
      </Pressable>

      <Pressable
        onPress={onProfilePress}
        className="flex-row items-center flex-1 active:opacity-70"
      >
        <Image
          source={{ uri: getAvatarWithFallback(avatar, displayName) }}
          style={{ width: 40, height: 40, borderRadius: 20 }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        <View className="ml-3 flex-1">
          <Text className="text-text-primary font-semibold" numberOfLines={1}>
            {displayName}
          </Text>
          {handle && (
            <Text className="text-text-muted text-sm" numberOfLines={1}>
              @{handle}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}
