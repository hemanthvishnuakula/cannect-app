/**
 * SwipeableMessage - Chat message bubble with swipe to delete
 */

import { useRef } from 'react';
import { View, Text, Animated, Platform, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { ChatMessage } from '@/lib/hooks';

export interface SwipeableMessageProps {
  message: ChatMessage;
  currentUserDid?: string;
  onDelete?: (messageId: string) => void;
}

export function SwipeableMessage({ message, currentUserDid, onDelete }: SwipeableMessageProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const isOwn = currentUserDid === message.sender?.did;

  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleDelete = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    swipeableRef.current?.close();
    onDelete?.(message.id);
  };

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-60, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <Pressable
        onPress={handleDelete}
        className="bg-red-500 justify-center items-center px-4 rounded-xl ml-2"
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Trash2 size={18} color="#FFFFFF" />
        </Animated.View>
      </Pressable>
    );
  };

  const bubble = (
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

  // On web, just show the bubble (no swipe)
  if (Platform.OS === 'web') {
    return bubble;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
    >
      {bubble}
    </Swipeable>
  );
}
