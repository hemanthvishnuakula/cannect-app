/**
 * ConversationRow - Conversation list item with delete support
 *
 * Displays a conversation in the messages list with:
 * - Other user's avatar, name, handle
 * - Last message preview
 * - Timestamp
 * - Unread indicator
 * - Swipe left to delete (native) or delete button (web)
 */

import { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Trash2 } from 'lucide-react-native';
import { getAvatarWithFallback } from '@/lib/utils/avatar';
import { formatConversationTime } from '@/lib/utils/date';
import { SwipeableDelete } from '@/components/ui';
import * as atproto from '@/lib/atproto/agent';
import type { Conversation } from '@/lib/hooks';

export interface ConversationRowProps {
  conversation: Conversation;
  onPress: () => void;
  onDelete?: (convoId: string) => void;
}

export function ConversationRow({ conversation, onPress, onDelete }: ConversationRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const session = atproto.getSession();

  // Get the OTHER member (not current user)
  const otherMember =
    conversation.members?.find((m) => m.did !== session?.did) || conversation.members?.[0];

  const displayName = otherMember?.displayName || otherMember?.handle || 'Unknown';
  const handle = otherMember?.handle || '';
  const avatar = otherMember?.avatar;
  const lastMessage = conversation.lastMessage;
  const hasUnread = conversation.unreadCount > 0;

  const handleDelete = (e: any) => {
    e?.stopPropagation?.();
    onDelete?.(conversation.id);
  };

  const content = (
    <View className="border-b border-border">
      <Pressable
        onPress={onPress}
        onHoverIn={() => setIsHovered(true)}
        onHoverOut={() => setIsHovered(false)}
        className={`flex-row items-center px-4 py-3 bg-background ${hasUnread ? 'bg-primary/5' : ''}`}
      >
        <Image
          source={{ uri: getAvatarWithFallback(avatar, displayName) }}
          style={{ width: 52, height: 52, borderRadius: 26 }}
          contentFit="cover"
          cachePolicy="memory-disk"
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
              {formatConversationTime(lastMessage?.sentAt)}
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
        {/* Web: Show delete button on hover */}
        {Platform.OS === 'web' && onDelete && isHovered && (
          <Pressable
            onPress={handleDelete}
            className="ml-2 p-2 bg-red-500/10 rounded-full hover:bg-red-500/20"
          >
            <Trash2 size={18} color="#EF4444" />
          </Pressable>
        )}
      </Pressable>
    </View>
  );

  // On web, just return content with hover delete button
  if (Platform.OS === 'web') {
    return content;
  }

  // On native, wrap with swipeable
  if (!onDelete) {
    return content;
  }

  return (
    <SwipeableDelete onDelete={() => onDelete(conversation.id)} iconSize={24} padding="px-6">
      {content}
    </SwipeableDelete>
  );
}
