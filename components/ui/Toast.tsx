/**
 * Toast.tsx - Lightweight toast notification system
 *
 * Features:
 * - Auto-dismiss after timeout
 * - Success, error, and info variants
 * - Animated entrance/exit
 * - Safe area aware
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, CheckCircle, AlertCircle, Info, RefreshCw } from 'lucide-react-native';
import { triggerImpact } from '@/lib/utils/haptics';
import { onFederationError, type FederationError } from '@/lib/utils/federation-events';

// ============================================================================
// Types
// ============================================================================

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  onRetry?: () => void;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  hideToast: (id: string) => void;
  hideAll: () => void;
}

// ============================================================================
// Context
// ============================================================================

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ============================================================================
// Single Toast Component
// ============================================================================

const toastStyles = {
  success: {
    bg: 'bg-emerald-900/95',
    border: 'border-emerald-600',
    icon: CheckCircle,
    iconColor: '#10B981',
  },
  error: {
    bg: 'bg-red-900/95',
    border: 'border-red-600',
    icon: AlertCircle,
    iconColor: '#EF4444',
  },
  info: {
    bg: 'bg-blue-900/95',
    border: 'border-blue-600',
    icon: Info,
    iconColor: '#3B82F6',
  },
};

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const style = toastStyles[toast.type];
  const Icon = style.icon;

  useEffect(() => {
    const duration = toast.duration ?? 4000;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  const handleRetry = useCallback(() => {
    triggerImpact('medium');
    toast.onRetry?.();
    onDismiss();
  }, [toast.onRetry, onDismiss]);

  return (
    <Animated.View
      entering={SlideInUp.springify().damping(15)}
      exiting={SlideOutUp.springify().damping(15)}
      className={`${style.bg} border ${style.border} rounded-2xl mx-4 mb-2 overflow-hidden`}
    >
      <View className="flex-row items-start p-4 gap-3">
        {/* Icon */}
        <Icon size={20} color={style.iconColor} style={{ marginTop: 2 }} />

        {/* Content */}
        <View className="flex-1">
          <Text className="text-white font-semibold text-base">{toast.title}</Text>
          {toast.message && <Text className="text-white/80 text-sm mt-0.5">{toast.message}</Text>}
        </View>

        {/* Actions */}
        <View className="flex-row items-center gap-2">
          {toast.onRetry && (
            <Pressable onPress={handleRetry} className="p-2 -m-2 active:opacity-70" hitSlop={8}>
              <RefreshCw size={18} color="#FFFFFF" />
            </Pressable>
          )}
          <Pressable onPress={onDismiss} className="p-2 -m-2 active:opacity-70" hitSlop={8}>
            <X size={18} color="#FFFFFF80" />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ============================================================================
// Toast Provider
// ============================================================================

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const insets = useSafeAreaInsets();
  const idCounter = useRef(0);

  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${++idCounter.current}`;

    // Haptic feedback based on type
    if (Platform.OS !== 'web') {
      if (toast.type === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (toast.type === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }

    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const hideAll = useCallback(() => {
    setToasts([]);
  }, []);

  // Listen for federation errors from hooks
  useEffect(() => {
    const unsubscribe = onFederationError((error: FederationError) => {
      showToast({
        type: 'error',
        title: `Failed to ${error.action}`,
        message: error.retry ? 'Tap to retry' : 'Please try again later',
        duration: 5000,
        onRetry: error.retry,
      });
    });
    return unsubscribe;
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, hideToast, hideAll }}>
      {children}

      {/* Toast Container */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 8,
          left: 0,
          right: 0,
          zIndex: 9999,
          pointerEvents: 'box-none',
        }}
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => hideToast(toast.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// ============================================================================
// Convenience hooks for common patterns
// ============================================================================

/**
 * Hook that returns toast functions for federation errors
 * Use this in hooks that interact with PDS
 */
export function useFederationToast() {
  const { showToast } = useToast();

  const showFederationError = useCallback(
    (action: string, onRetry?: () => void) => {
      showToast({
        type: 'error',
        title: `Failed to ${action}`,
        message: 'Could not sync with Bluesky. Tap to retry.',
        duration: 6000,
        onRetry,
      });
    },
    [showToast]
  );

  const showFederationSuccess = useCallback(
    (action: string) => {
      showToast({
        type: 'success',
        title: action,
        duration: 2000,
      });
    },
    [showToast]
  );

  return { showFederationError, showFederationSuccess };
}
