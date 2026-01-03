/**
 * Chat Screen - Full-screen conversation view
 *
 * Features:
 * - Chat with user
 * - Select mode to delete messages
 * - Delete conversation button
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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send, Trash2, CheckSquare, Square, X, MoreVertical } from 'lucide-react-native';
import {
  useConversation,
  useMessages,
  useSendMessage,
  useMarkConvoRead,
  useLeaveConversation,
  useDeleteMessage,
  type ChatMessage,
} from '@/lib/hooks';
import { MessageRichText } from '@/components/messages';
import { getOptimizedAvatarWithFallback } from '@/lib/utils/avatar';
import { triggerImpact } from '@/lib/utils/haptics';
import * as atproto from '@/lib/atproto/agent';

export default function ChatScreen() {
  const router = useRouter();
  const { convoId } = useLocalSearchParams<{ convoId: string }>();
  const [messageText, setMessageText] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const { data: conversation, isLoading: isLoadingConvo } = useConversation(convoId);
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(convoId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutate: markRead } = useMarkConvoRead();
  const { mutate: leaveConversation, isPending: isLeavingConvo } = useLeaveConversation();
  const { mutate: deleteMessage, isPending: isDeletingMessages } = useDeleteMessage();

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

  // Helper to format date for separators
  const getDateLabel = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }, []);

  // Helper to check if we should show date separator
  const shouldShowDateSeparator = useCallback(
    (currentMsg: ChatMessage, prevMsg: ChatMessage | undefined) => {
      if (!prevMsg) return true;
      const currentDate = new Date(currentMsg.sentAt).toDateString();
      const prevDate = new Date(prevMsg.sentAt).toDateString();
      return currentDate !== prevDate;
    },
    []
  );

  // Helper to check if messages are grouped (same sender, within 2 minutes)
  const isGroupedWithPrev = useCallback(
    (currentMsg: ChatMessage, prevMsg: ChatMessage | undefined) => {
      if (!prevMsg) return false;
      if (currentMsg.sender?.did !== prevMsg.sender?.did) return false;
      const timeDiff = new Date(currentMsg.sentAt).getTime() - new Date(prevMsg.sentAt).getTime();
      return timeDiff < 2 * 60 * 1000; // 2 minutes
    },
    []
  );

  const isGroupedWithNext = useCallback(
    (currentMsg: ChatMessage, nextMsg: ChatMessage | undefined) => {
      if (!nextMsg) return false;
      if (currentMsg.sender?.did !== nextMsg.sender?.did) return false;
      const timeDiff = new Date(nextMsg.sentAt).getTime() - new Date(currentMsg.sentAt).getTime();
      return timeDiff < 2 * 60 * 1000; // 2 minutes
    },
    []
  );

  // Load older messages
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      triggerImpact('light');
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Mark as read when opened
  useEffect(() => {
    if (convoId) {
      markRead(convoId);
    }
  }, [convoId, markRead]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0 && !isSelectMode) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, isSelectMode]);

  const handleBack = useCallback(() => {
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedMessages(new Set());
      return;
    }
    triggerImpact('light');
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/messages' as any);
    }
  }, [router, isSelectMode]);

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

  const handleEnterSelectMode = useCallback(() => {
    triggerImpact('light');
    setShowMenu(false);
    setIsSelectMode(true);
    setSelectedMessages(new Set());
  }, []);

  const handleExitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedMessages(new Set());
  }, []);

  const handleToggleSelect = useCallback((messageId: string) => {
    triggerImpact('light');
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!convoId || selectedMessages.size === 0) return;

    const confirmDelete = () => {
      triggerImpact('medium');
      // Delete each selected message sequentially
      const messageIds = Array.from(selectedMessages);
      messageIds.forEach((messageId) => {
        deleteMessage({ convoId, messageId });
      });
      setSelectedMessages(new Set());
      setIsSelectMode(false);
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${selectedMessages.size} message(s)?`)) {
        confirmDelete();
      }
    } else {
      Alert.alert('Delete Messages', `Delete ${selectedMessages.size} message(s)?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ]);
    }
  }, [convoId, selectedMessages, deleteMessage]);

  const handleDeleteConversation = useCallback(() => {
    if (!convoId) return;

    const confirmDelete = () => {
      triggerImpact('medium');
      setShowMenu(false);
      leaveConversation(convoId, {
        onSuccess: () => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/messages' as any);
          }
        },
      });
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Delete this conversation? This cannot be undone.')) {
        confirmDelete();
      }
    } else {
      Alert.alert('Delete Conversation', 'Delete this conversation? This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ]);
    }
  }, [convoId, leaveConversation, router]);

  const renderMessage = useCallback(
    ({ item: msg, index }: { item: ChatMessage; index: number }) => {
      const isOwn = session?.did === msg.sender?.did;
      const isSelected = selectedMessages.has(msg.id);
      const time = new Date(msg.sentAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      const prevMsg = index > 0 ? messages[index - 1] : undefined;
      const nextMsg = index < messages.length - 1 ? messages[index + 1] : undefined;
      const showDateSeparator = shouldShowDateSeparator(msg, prevMsg);
      const groupedWithPrev = isGroupedWithPrev(msg, prevMsg);
      const groupedWithNext = isGroupedWithNext(msg, nextMsg);

      // Bubble tail: show only on last message of a group
      const showTail = !groupedWithNext;

      return (
        <View>
          {/* Date Separator */}
          {showDateSeparator && (
            <View style={{ alignItems: 'center', marginVertical: 16 }}>
              <View
                style={{
                  backgroundColor: '#374151',
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: '#9CA3AF', fontSize: 12, fontWeight: '500' }}>
                  {getDateLabel(msg.sentAt)}
                </Text>
              </View>
            </View>
          )}

          <Pressable
            onPress={() => isSelectMode && handleToggleSelect(msg.id)}
            style={{
              alignItems: isOwn ? 'flex-end' : 'flex-start',
              marginBottom: groupedWithNext ? 2 : 8,
              marginTop: groupedWithPrev ? 0 : 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', maxWidth: '85%' }}>
              {/* Checkbox in select mode - left side */}
              {isSelectMode && !isOwn && (
                <Pressable
                  onPress={() => handleToggleSelect(msg.id)}
                  style={{ padding: 4, marginRight: 8 }}
                >
                  {isSelected ? (
                    <CheckSquare size={20} color="#10B981" />
                  ) : (
                    <Square size={20} color="#6B7280" />
                  )}
                </Pressable>
              )}

              {/* Message Bubble */}
              <View
                style={{
                  backgroundColor: isOwn ? '#10B981' : '#1F2937',
                  paddingHorizontal: 12,
                  paddingTop: 8,
                  paddingBottom: 6,
                  borderRadius: 16,
                  // Tail styling
                  borderTopLeftRadius: !isOwn && !groupedWithPrev ? 4 : 16,
                  borderTopRightRadius: isOwn && !groupedWithPrev ? 4 : 16,
                  borderBottomLeftRadius: !isOwn && showTail ? 4 : 16,
                  borderBottomRightRadius: isOwn && showTail ? 4 : 16,
                  minWidth: 60,
                }}
              >
                {/* Message text + inline timestamp */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <MessageRichText text={msg.text} facets={msg.facets} isOwn={isOwn} />
                  <Text
                    style={{
                      color: isOwn ? 'rgba(255,255,255,0.7)' : '#9CA3AF',
                      fontSize: 11,
                      marginLeft: 'auto',
                      alignSelf: 'flex-end',
                      marginBottom: 1,
                    }}
                  >
                    {time}
                  </Text>
                </View>
              </View>

              {/* Checkbox in select mode - right side for own messages */}
              {isSelectMode && isOwn && (
                <Pressable
                  onPress={() => handleToggleSelect(msg.id)}
                  style={{ padding: 4, marginLeft: 8 }}
                >
                  {isSelected ? (
                    <CheckSquare size={20} color="#10B981" />
                  ) : (
                    <Square size={20} color="#6B7280" />
                  )}
                </Pressable>
              )}
            </View>
          </Pressable>
        </View>
      );
    },
    [
      session?.did,
      isSelectMode,
      selectedMessages,
      handleToggleSelect,
      messages,
      shouldShowDateSeparator,
      isGroupedWithPrev,
      isGroupedWithNext,
      getDateLabel,
    ]
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
          onMenuPress={() => {}}
          isSelectMode={false}
        />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      {/* Header */}
      {isSelectMode ? (
        <View className="flex-row items-center justify-between px-4 py-2 border-b border-border">
          <Pressable onPress={handleExitSelectMode} className="p-2 -ml-2">
            <X size={24} color="#FFFFFF" />
          </Pressable>
          <Text className="text-text-primary font-semibold">{selectedMessages.size} selected</Text>
          <Pressable
            onPress={handleDeleteSelected}
            disabled={selectedMessages.size === 0 || isDeletingMessages}
            className={`p-2 -mr-2 ${selectedMessages.size === 0 ? 'opacity-40' : ''}`}
          >
            {isDeletingMessages ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Trash2 size={24} color="#EF4444" />
            )}
          </Pressable>
        </View>
      ) : (
        <ChatHeader
          displayName={displayName}
          handle={handle}
          avatar={avatar}
          onBack={handleBack}
          onProfilePress={handleProfilePress}
          onMenuPress={() => setShowMenu(!showMenu)}
          isSelectMode={false}
        />
      )}

      {/* Dropdown Menu */}
      {showMenu && !isSelectMode && (
        <View className="absolute right-4 top-14 z-50 bg-surface-elevated border border-border rounded-xl shadow-lg overflow-hidden">
          <Pressable
            onPress={handleEnterSelectMode}
            className="flex-row items-center px-4 py-3 active:bg-surface"
          >
            <CheckSquare size={18} color="#FAFAFA" />
            <Text className="text-text-primary ml-3">Select Messages</Text>
          </Pressable>
          <View className="h-px bg-border" />
          <Pressable
            onPress={handleDeleteConversation}
            disabled={isLeavingConvo}
            className="flex-row items-center px-4 py-3 active:bg-surface"
          >
            {isLeavingConvo ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Trash2 size={18} color="#EF4444" />
            )}
            <Text className="text-red-500 ml-3">Delete Conversation</Text>
          </Pressable>
        </View>
      )}

      {/* Tap outside to close menu */}
      {showMenu && (
        <Pressable
          onPress={() => setShowMenu(false)}
          className="absolute inset-0 z-40"
          style={{ backgroundColor: 'transparent' }}
        />
      )}

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
          ListHeaderComponent={
            hasNextPage ? (
              <Pressable
                onPress={handleLoadMore}
                disabled={isFetchingNextPage}
                className="items-center py-4 mb-2"
              >
                {isFetchingNextPage ? (
                  <ActivityIndicator size="small" color="#10B981" />
                ) : (
                  <View className="bg-surface-elevated px-4 py-2 rounded-full">
                    <Text className="text-text-muted text-sm">Load older messages</Text>
                  </View>
                )}
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View className="items-center justify-center py-8">
              <View className="w-20 h-20 rounded-full bg-surface-elevated items-center justify-center mb-4">
                <Image
                  source={{ uri: getOptimizedAvatarWithFallback(avatar, displayName, 60) }}
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
            if (messages.length > 0 && !isSelectMode) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
        />

        {/* Input Area - hidden in select mode */}
        {!isSelectMode && (
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
        )}
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
  onMenuPress,
  isSelectMode,
}: {
  displayName: string;
  handle: string;
  avatar?: string;
  onBack: () => void;
  onProfilePress: () => void;
  onMenuPress: () => void;
  isSelectMode: boolean;
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
          source={{ uri: getOptimizedAvatarWithFallback(avatar, displayName, 40) }}
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

      {!isSelectMode && (
        <Pressable onPress={onMenuPress} className="p-2 -mr-2">
          <MoreVertical size={24} color="#FFFFFF" />
        </Pressable>
      )}
    </View>
  );
}
