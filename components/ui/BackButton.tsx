/**
 * BackButton - Unified back navigation button
 *
 * Handles all edge cases for navigation:
 * - Web: Uses window.history.length for reliable back detection
 * - Native: Uses router.canGoBack()
 * - Falls back to specified route or /feed
 *
 * Includes:
 * - Haptic feedback
 * - Consistent hitSlop for easy tapping
 * - Visual press feedback
 */

import { Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback } from 'react';
import { triggerImpact } from '@/lib/utils/haptics';

interface BackButtonProps {
  /** Fallback route if can't go back (default: /feed) */
  fallbackRoute?: string;
  /** Icon color (default: #FAFAFA) */
  color?: string;
  /** Icon size (default: 24) */
  size?: number;
  /** Custom onPress handler (overrides default behavior) */
  onPress?: () => void;
}

export function BackButton({
  fallbackRoute = '/feed',
  color = '#FAFAFA',
  size = 24,
  onPress,
}: BackButtonProps) {
  const router = useRouter();

  const handleBack = useCallback(() => {
    triggerImpact('light');

    // If custom handler provided, use it
    if (onPress) {
      onPress();
      return;
    }

    // On web, check history length directly for more reliability
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
      } else {
        router.replace(fallbackRoute as any);
      }
    } else {
      // Native - use router.canGoBack()
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace(fallbackRoute as any);
      }
    }
  }, [router, fallbackRoute, onPress]);

  return (
    <Pressable
      onPress={handleBack}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        padding: 8,
        marginLeft: -8,
      })}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ArrowLeft size={size} color={color} />
    </Pressable>
  );
}
