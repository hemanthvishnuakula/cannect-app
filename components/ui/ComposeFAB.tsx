/**
 * Floating Action Button (FAB) for Compose
 *
 * Twitter/Instagram-style floating button for creating new posts.
 * Positioned bottom-right, above the tab bar.
 */

import React from 'react';
import { Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

export function ComposeFAB() {
  const router = useRouter();

  const handlePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    router.push('/(tabs)/compose' as any);
  };

  return (
    <Pressable
      onPress={handlePress}
      className="absolute bottom-20 right-4 w-12 h-12 bg-primary rounded-full items-center justify-center active:scale-95 active:opacity-90"
      style={{
        // Subtle shadow for iOS
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        // Shadow for Android
        elevation: 4,
      }}
    >
      <Plus size={24} color="#FFFFFF" strokeWidth={2.5} />
    </Pressable>
  );
}
