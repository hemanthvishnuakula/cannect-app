/**
 * ConversationRow - Swipeable conversation list item
 *
 * Displays a conversation in the messages list with:
 * - Other user's avatar, name, handle
 * - Last message preview
 * - Timestamp
 * - Unread indicator
 * - Swipe left to delete
 */

import { useRef } from 'react';
import { View, Text, Pressable, Animated, Platform } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getAvatarUrl } from '@/lib/utils/avatar';
import { formatConversationTime } from '@/lib/utils/date';
import * as atproto from '@/lib/atproto/agent';
import type { Conversation } from '@/lib/hooks';

export interface ConversationRowProps {
  conversation: Conversation;
  onPress: () => void;
  onDelete?: (convoId: string) => void;
}

export function ConversationRow({ conversation, onPress, onDelete }: ConversationRowProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const session = atproto.getSession();

  // Get the OTHER member (not current user)
  const otherMember =
    conversation.members?.find((m) => m.did !== session?.did) || conversation.members?.[0];

  const displayName = otherMember?.displayName || otherMember?.handle || 'Unknown';
  const handle = otherMember?.handle || '';
  const avatar = otherMember?.avatar;
  const lastMessage = conversation.lastMessage;
  const hasUnread = conversation.unreadCount > 0;

  const handleDelete = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    swipeableRef.current?.close();
    onDelete?.(conversation.id);
  };

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <Pressable
        onPress={handleDelete}
        className="bg-red-500 justify-center items-center px-6"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Trash2 size={24} color="#FFFFFF" />
        </Animated.View>
      </Pressable>
    );
  };

  const content = (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-4 py-3 bg-background ${hasUnread ? 'bg-primary/5' : ''}`}
    >
      <Image
        source={{
          uri:
            getAvatarUrl(avatar, 'thumb') ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=10B981&color=fff`,
        }}
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
    </Pressable>
  );

  // On web, swipeable doesn't work well - just show the row
  if (Platform.OS === 'web') {
    return <View className="border-b border-border">{content}</View>;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
    >
      <View className="border-b border-border">{content}</View>
    </Swipeable>
  );
}
