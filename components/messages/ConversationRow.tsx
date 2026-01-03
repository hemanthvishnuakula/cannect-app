/**
 * ConversationRow - Conversation list item
 *
 * Displays a conversation in the messages list with:
 * - Other user's avatar, name, handle
 * - Last message preview
 * - Timestamp
 * - Unread indicator
 */

import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useState } from 'react';
import { getOptimizedAvatarWithFallback, getFallbackAvatarUrl } from '@/lib/utils/avatar';
import { formatConversationTime } from '@/lib/utils/date';
import * as atproto from '@/lib/atproto/agent';
import type { Conversation } from '@/lib/hooks';

export interface ConversationRowProps {
  conversation: Conversation;
  onPress: () => void;
}

export function ConversationRow({ conversation, onPress }: ConversationRowProps) {
  const session = atproto.getSession();
  const [avatarError, setAvatarError] = useState(false);

  // Get the OTHER member (not current user)
  const otherMember =
    conversation.members?.find((m) => m.did !== session?.did) || conversation.members?.[0];

  const displayName = otherMember?.displayName || otherMember?.handle || 'Unknown';
  const handle = otherMember?.handle || '';
  const avatar = otherMember?.avatar;
  const lastMessage = conversation.lastMessage;
  const hasUnread = conversation.unreadCount > 0;

  // Use fallback if avatar fails to load or is missing
  const avatarUrl = avatarError
    ? getFallbackAvatarUrl(displayName)
    : getOptimizedAvatarWithFallback(avatar, displayName, 52);

  return (
    <View className="border-b border-border">
      <Pressable
        onPress={onPress}
        className={`flex-row items-center px-4 py-3 bg-background ${hasUnread ? 'bg-primary/5' : ''}`}
      >
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: 52, height: 52, borderRadius: 26 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setAvatarError(true)}
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
      </Pressable>
    </View>
  );
}
