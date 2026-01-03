/**
 * MessageBubble - Chat message with hover delete
 */

import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import type { ChatMessage } from '@/lib/hooks';

export interface MessageBubbleProps {
  message: ChatMessage;
  currentUserDid?: string;
  onDelete?: (messageId: string) => void;
}

export function MessageBubble({ message, currentUserDid, onDelete }: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isOwn = currentUserDid === message.sender?.did;

  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleDelete = (e: any) => {
    e?.stopPropagation?.();
    onDelete?.(message.id);
  };

  return (
    <Pressable
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      className={`mb-3 ${isOwn ? 'items-end' : 'items-start'}`}
    >
      <View className="flex-row items-center gap-2">
        {/* Delete button on left for own messages */}
        {isOwn && onDelete && isHovered && (
          <Pressable
            onPress={handleDelete}
            className="p-1.5 bg-red-500/10 rounded-full hover:bg-red-500/20"
          >
            <Trash2 size={14} color="#EF4444" />
          </Pressable>
        )}
        
        <View
          className={`max-w-[80%] px-4 py-2.5 ${
            isOwn
              ? 'bg-primary rounded-2xl rounded-br-md'
              : 'bg-surface-elevated rounded-2xl rounded-bl-md'
          }`}
        >
          <Text className={isOwn ? 'text-white' : 'text-text-primary'}>{message.text}</Text>
        </View>

        {/* Delete button on right for other's messages */}
        {!isOwn && onDelete && isHovered && (
          <Pressable
            onPress={handleDelete}
            className="p-1.5 bg-red-500/10 rounded-full hover:bg-red-500/20"
          >
            <Trash2 size={14} color="#EF4444" />
          </Pressable>
        )}
      </View>
      <Text className="text-text-muted text-xs mt-1 px-1">{time}</Text>
    </Pressable>
  );
}

// Keep SwipeableMessage as alias for backwards compatibility
export { MessageBubble as SwipeableMessage };
