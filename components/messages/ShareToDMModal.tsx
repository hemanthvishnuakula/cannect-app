/**
 * ShareToDMModal - Modal to share a post to a DM conversation
 *
 * Features:
 * - Search/filter existing conversations
 * - Start new conversation with a user
 * - Optional message to accompany the shared post
 * - Sends post as embedded record
 */

import { useState, useMemo, useCallback } from 'react';
import { View, Text, Pressable, Modal, TextInput, FlatList, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { X, Search, Send, Check } from 'lucide-react-native';
import { useConversations, useSendMessage, useStartConversation } from '@/lib/hooks/use-atp-chat';
import { getOptimizedAvatarWithFallback, getFallbackAvatarUrl } from '@/lib/utils/avatar';
import * as atproto from '@/lib/atproto/agent';
import { triggerImpact } from '@/lib/utils/haptics';
import type { Conversation } from '@/lib/hooks/use-atp-chat';

interface ShareToDMModalProps {
  visible: boolean;
  onClose: () => void;
  postUri: string;
  postCid: string;
  postText?: string;
  authorHandle?: string;
}

export function ShareToDMModal({
  visible,
  onClose,
  postUri,
  postCid,
  postText,
  authorHandle,
}: ShareToDMModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentConvoIds, setSentConvoIds] = useState<Set<string>>(new Set());

  const { data: convosData, isLoading: isLoadingConvos } = useConversations();
  const sendMessage = useSendMessage();
  const startConversation = useStartConversation();

  const session = atproto.getSession();

  // Extract conversations from paginated data
  const conversations: Conversation[] = useMemo(() => {
    return convosData?.pages?.flatMap((page: any) => page.convos || []) || [];
  }, [convosData]);

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    if (!conversations.length) return [];
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter((convo: Conversation) => {
      const otherMember = convo.members?.find((m) => m.did !== session?.did);
      if (!otherMember) return false;

      return (
        otherMember.displayName?.toLowerCase().includes(query) ||
        otherMember.handle?.toLowerCase().includes(query)
      );
    });
  }, [conversations, searchQuery, session?.did]);

  // Handle sending to a conversation
  const handleSend = useCallback(
    async (convo: Conversation) => {
      if (isSending || sentConvoIds.has(convo.id)) return;

      triggerImpact('medium');
      setIsSending(true);

      try {
        // Build the message text
        const messageText = message.trim() || `Check out this post by @${authorHandle || 'someone'}`;

        await sendMessage.mutateAsync({
          convoId: convo.id,
          text: messageText,
          embed: { uri: postUri, cid: postCid },
        });

        // Mark as sent
        setSentConvoIds((prev) => new Set(prev).add(convo.id));

        // Clear message after successful send
        setMessage('');

        // If just sent to the selected convo, close modal after a brief delay
        if (selectedConvo?.id === convo.id) {
          setTimeout(() => {
            onClose();
          }, 500);
        }
      } catch (error) {
        console.error('Failed to share post to DM:', error);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, sentConvoIds, message, authorHandle, postUri, postCid, sendMessage, selectedConvo, onClose]
  );

  // Handle close and reset state
  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSelectedConvo(null);
    setMessage('');
    setSentConvoIds(new Set());
    onClose();
  }, [onClose]);

  // Render a conversation row
  const renderConversation = useCallback(
    ({ item: convo }: { item: Conversation }) => {
      const otherMember = convo.members?.find((m) => m.did !== session?.did) || convo.members?.[0];
      const displayName = otherMember?.displayName || otherMember?.handle || 'Unknown';
      const handle = otherMember?.handle || '';
      const avatar = otherMember?.avatar;
      const isSent = sentConvoIds.has(convo.id);

      return (
        <Pressable
          onPress={() => {
            if (!isSent) {
              handleSend(convo);
            }
          }}
          className={`flex-row items-center px-4 py-3 border-b border-border ${
            isSent ? 'bg-green-500/10' : 'active:bg-zinc-800'
          }`}
          disabled={isSent || isSending}
        >
          <ConversationAvatar avatar={avatar} displayName={displayName} />
          <View className="flex-1 ml-3">
            <Text className="text-text-primary font-semibold" numberOfLines={1}>
              {displayName}
            </Text>
            <Text className="text-text-muted text-sm" numberOfLines={1}>
              @{handle}
            </Text>
          </View>
          {isSent ? (
            <View className="bg-green-500 w-8 h-8 rounded-full items-center justify-center">
              <Check size={18} color="#fff" />
            </View>
          ) : isSending ? (
            <ActivityIndicator size="small" color="#10b981" />
          ) : (
            <Send size={20} color="#888" />
          )}
        </Pressable>
      );
    },
    [session?.did, sentConvoIds, isSending, handleSend]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* Backdrop */}
      <Pressable className="flex-1 bg-black/50" onPress={handleClose} />

      {/* Modal Content */}
      <View className="bg-surface-elevated rounded-t-3xl" style={{ maxHeight: '80%' }}>
        {/* Handle bar */}
        <View className="items-center py-3">
          <View className="w-10 h-1 bg-zinc-600 rounded-full" />
        </View>

        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pb-3 border-b border-border">
          <Text className="text-text-primary text-lg font-bold">Send to</Text>
          <Pressable onPress={handleClose} className="p-2">
            <X size={24} color="#888" />
          </Pressable>
        </View>

        {/* Search bar */}
        <View className="px-4 py-3">
          <View className="flex-row items-center bg-zinc-800 rounded-xl px-3 py-2">
            <Search size={18} color="#888" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search conversations..."
              placeholderTextColor="#888"
              className="flex-1 ml-2 text-text-primary text-base"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Optional message input */}
        <View className="px-4 pb-3">
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Add a message (optional)..."
            placeholderTextColor="#666"
            className="bg-zinc-800 rounded-xl px-3 py-3 text-text-primary text-base"
            multiline
            maxLength={300}
          />
        </View>

        {/* Post preview */}
        {postText && (
          <View className="px-4 pb-3">
            <View className="bg-zinc-800/50 rounded-xl p-3 border border-border">
              <Text className="text-text-muted text-xs mb-1">Sharing post by @{authorHandle}</Text>
              <Text className="text-text-primary text-sm" numberOfLines={2}>
                {postText}
              </Text>
            </View>
          </View>
        )}

        {/* Conversation list */}
        {isLoadingConvos ? (
          <View className="py-8 items-center">
            <ActivityIndicator size="large" color="#10b981" />
          </View>
        ) : filteredConversations.length === 0 ? (
          <View className="py-8 items-center">
            <Text className="text-text-muted">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredConversations}
            renderItem={renderConversation}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 300 }}
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}

        {/* Bottom safe area */}
        <View className="h-6" />
      </View>
    </Modal>
  );
}

// Avatar component with error handling
function ConversationAvatar({
  avatar,
  displayName,
}: {
  avatar?: string;
  displayName: string;
}) {
  const [avatarError, setAvatarError] = useState(false);

  const avatarUrl = avatarError
    ? getFallbackAvatarUrl(displayName)
    : getOptimizedAvatarWithFallback(avatar, displayName, 44);

  return (
    <Image
      source={{ uri: avatarUrl }}
      style={{ width: 44, height: 44, borderRadius: 22 }}
      contentFit="cover"
      cachePolicy="memory-disk"
      onError={() => setAvatarError(true)}
    />
  );
}
