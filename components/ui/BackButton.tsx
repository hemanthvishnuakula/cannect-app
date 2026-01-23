/**
 * BackButton - Unified back navigation button
 *
 * Handles all edge cases for navigation:
 * - Uses router.canGoBack() for reliable detection on both web and native
 * - Falls back to specified route or /feed when no history (refresh, deep link)
 *
 * Includes:
 * - Haptic feedback
 * - Consistent hitSlop for easy tapping
 * - Visual press feedback
 */

import { Pressable } from 'react-native';
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

    // Check if Expo Router can go back (works for both web and native)
    // This is more reliable than window.history on web after refresh
    if (router.canGoBack()) {
      router.back();
    } else {
      // No router history - either refreshed page or deep linked
      // Go to fallback route
      router.replace(fallbackRoute as any);
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
