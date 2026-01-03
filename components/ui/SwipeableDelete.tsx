/**
 * SwipeableDelete - Reusable swipe-to-delete wrapper
 *
 * Wraps any content with swipe-to-delete functionality.
 * Falls back to regular content on web.
 */

import React, { useRef, ReactNode } from 'react';
import { Animated, Platform, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Trash2 } from 'lucide-react-native';
import { triggerImpact } from '@/lib/utils/haptics';

export interface SwipeableDeleteProps {
  children: ReactNode;
  onDelete: () => void;
  /** Whether swipe is enabled (default: true) */
  enabled?: boolean;
  /** Icon size (default: 20) */
  iconSize?: number;
  /** Background color class (default: bg-red-500) */
  bgColor?: string;
  /** Padding class (default: px-4) */
  padding?: string;
}

export function SwipeableDelete({
  children,
  onDelete,
  enabled = true,
  iconSize = 20,
  bgColor = 'bg-red-500',
  padding = 'px-4',
}: SwipeableDeleteProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const handleDelete = () => {
    triggerImpact('medium');
    swipeableRef.current?.close();
    onDelete();
  };

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-70, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <Pressable
        onPress={handleDelete}
        className={`${bgColor} justify-center items-center ${padding}`}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Trash2 size={iconSize} color="#FFFFFF" />
        </Animated.View>
      </Pressable>
    );
  };

  // On web or if disabled, just show the content
  if (Platform.OS === 'web' || !enabled) {
    return <>{children}</>;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}
