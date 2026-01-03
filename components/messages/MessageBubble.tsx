/**
 * MessageBubble - Chat message bubble
 */

import { View, Text } from 'react-native';
import type { ChatMessage } from '@/lib/hooks';

export interface MessageBubbleProps {
  message: ChatMessage;
  currentUserDid?: string;
}

export function MessageBubble({ message, currentUserDid }: MessageBubbleProps) {
  const isOwn = currentUserDid === message.sender?.did;

  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View className={`mb-3 ${isOwn ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[80%] px-4 py-2.5 ${
          isOwn
            ? 'bg-primary rounded-2xl rounded-br-md'
            : 'bg-surface-elevated rounded-2xl rounded-bl-md'
        }`}
      >
        <Text className={isOwn ? 'text-white' : 'text-text-primary'}>{message.text}</Text>
      </View>
      <Text className="text-text-muted text-xs mt-1 px-1">{time}</Text>
    </View>
  );
}
