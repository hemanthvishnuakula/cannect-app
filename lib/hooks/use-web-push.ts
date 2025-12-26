/**
 * Web Push Notifications Hook
 * 
 * Handles web push subscription for browsers including iOS Safari 16.4+
 * iOS requires: PWA must be installed to home screen first
 * 
 * Sends subscription to Push VPS for server-initiated push notifications.
 */

import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/lib/stores/auth-store';

// Push VPS API endpoint for push subscriptions
const PUSH_API_URL = process.env.EXPO_PUBLIC_PUSH_API_URL || 'https://push.cannect.space';

// VAPID public key - fetched from server or fallback to env
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY || '';

const SUBSCRIPTION_KEY = 'cannect_web_push_subscription';

interface WebPushState {
  isSupported: boolean;
  isSubscribed: boolean;
  isIOSPWA: boolean;
  permission: NotificationPermission | 'unsupported';
  isLoading: boolean;
  error: string | null;
}

/**
 * Convert VAPID key from base64 to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if running as installed iOS PWA
 */
function isIOSInstalledPWA(): boolean {
  if (typeof window === 'undefined') return false;
  
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  
  return isIOS && isStandalone;
}

/**
 * Check if push is supported (including iOS 16.4+)
 */
function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (!('Notification' in window)) return false;
  
  return true;
}

export function useWebPush() {
  const { did } = useAuthStore();
  const [state, setState] = useState<WebPushState>({
    isSupported: false,
    isSubscribed: false,
    isIOSPWA: false,
    permission: 'unsupported',
    isLoading: false,
    error: null,
  });

  // Initialize state on mount
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const checkState = async () => {
      const supported = isPushSupported();
      const iosPWA = isIOSInstalledPWA();
      const permission = supported ? Notification.permission : 'unsupported';
      
      let isSubscribed = false;
      
      if (supported && permission === 'granted') {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          isSubscribed = !!subscription;
        } catch (e) {
          console.error('[WebPush] Error checking subscription:', e);
        }
      }

      setState({
        isSupported: supported,
        isSubscribed,
        isIOSPWA: iosPWA,
        permission,
        isLoading: false,
        error: null,
      });
    };

    checkState();
  }, []);

  /**
   * Request permission and subscribe to push notifications
   */
  const subscribe = useCallback(async () => {
    if (!state.isSupported) {
      setState(s => ({ ...s, error: 'Push notifications not supported' }));
      return false;
    }

    if (!VAPID_PUBLIC_KEY) {
      console.error('[WebPush] VAPID_PUBLIC_KEY not configured');
      setState(s => ({ ...s, error: 'Push notifications not configured' }));
      return false;
    }

    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      // Request permission
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        setState(s => ({ 
          ...s, 
          permission, 
          isLoading: false,
          error: permission === 'denied' ? 'Notifications blocked. Enable in browser settings.' : null
        }));
        return false;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Check for existing subscription
      let subscription = await registration.pushManager.getSubscription();

      // Create new subscription if needed
      if (!subscription) {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
        });
      }

      // Save subscription locally
      if (subscription) {
        const subscriptionJSON = subscription.toJSON();
        await AsyncStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(subscriptionJSON));
        console.log('[WebPush] Subscription saved locally');
        
        // Send subscription to Feed VPS for server-initiated push
        if (did) {
          try {
            const response = await fetch(`${PUSH_API_URL}/api/push/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userDid: did,
                subscription: subscriptionJSON,
              }),
            });
            
            if (response.ok) {
              console.log('[WebPush] Subscription registered with server');
            } else {
              console.error('[WebPush] Failed to register with server:', response.status);
            }
          } catch (err) {
            console.error('[WebPush] Server registration error:', err);
            // Continue - local subscription still works for testing
          }
        }
      }

      setState(s => ({ 
        ...s, 
        permission: 'granted',
        isSubscribed: true,
        isLoading: false,
        error: null,
      }));

      console.log('[WebPush] Successfully subscribed');
      return true;

    } catch (error: any) {
      console.error('[WebPush] Subscription error:', error);
      setState(s => ({ 
        ...s, 
        isLoading: false,
        error: error.message || 'Failed to enable notifications',
      }));
      return false;
    }
  }, [state.isSupported]);

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async () => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Notify server to remove subscription
        try {
          await fetch(`${PUSH_API_URL}/api/push/unsubscribe`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          console.log('[WebPush] Server notified of unsubscribe');
        } catch (err) {
          console.error('[WebPush] Failed to notify server:', err);
        }

        await subscription.unsubscribe();
      }

      // Remove local storage
      await AsyncStorage.removeItem(SUBSCRIPTION_KEY);

      setState(s => ({ 
        ...s, 
        isSubscribed: false,
        isLoading: false,
        error: null,
      }));

      console.log('[WebPush] Unsubscribed');
      return true;

    } catch (error: any) {
      console.error('[WebPush] Unsubscribe error:', error);
      setState(s => ({ 
        ...s, 
        isLoading: false,
        error: error.message || 'Failed to disable notifications',
      }));
      return false;
    }
  }, []);

  /**
   * Get the current subscription (for sending to backend)
   */
  const getSubscription = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(SUBSCRIPTION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    getSubscription,
  };
}

export default useWebPush;
