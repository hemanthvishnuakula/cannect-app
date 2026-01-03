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
      className="absolute bottom-24 right-5 w-14 h-14 bg-primary rounded-full items-center justify-center shadow-lg active:scale-95"
      style={{
        // Shadow for iOS
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        // Shadow for Android
        elevation: 8,
      }}
    >
      <Plus size={28} color="#FFFFFF" strokeWidth={2.5} />
    </Pressable>
  );
}
