import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// VAPID public key from environment
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * Convert base64 VAPID key to Uint8Array for Web Push API
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
 * Check if Web Push is supported in this browser
 */
export function isWebPushSupported(): boolean {
  if (Platform.OS !== 'web') return false;
  
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Get current notification permission status
 */
export function getWebPushPermission(): NotificationPermission | 'unsupported' {
  if (!isWebPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Request notification permission
 */
export async function requestWebPushPermission(): Promise<NotificationPermission> {
  if (!isWebPushSupported()) {
    console.log('Web Push not supported');
    return 'denied';
  }
  
  return await Notification.requestPermission();
}

/**
 * Register for Web Push notifications and save subscription to Supabase
 */
export async function registerWebPushNotifications(userId: string): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) {
    console.log('Web Push not supported in this browser');
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.error('VAPID public key not configured');
    return null;
  }

  try {
    // Request permission if not granted
    const permission = await requestWebPushPermission();
    if (permission !== 'granted') {
      console.log('Web Push permission denied');
      return null;
    }

    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });
    
    console.log('Service Worker registered:', registration);

    // Wait for service worker to be ready
    await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    // If no subscription, create one
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('New Web Push subscription created:', subscription);
    } else {
      console.log('Existing Web Push subscription found:', subscription);
      
      // 💎 Check if subscription is about to expire (within 7 days)
      const expirationTime = (subscription as any).expirationTime;
      if (expirationTime) {
        const sevenDaysFromNow = Date.now() + (7 * 24 * 60 * 60 * 1000);
        if (expirationTime < sevenDaysFromNow) {
          console.log('[WebPush] Subscription expiring soon, refreshing...');
          await subscription.unsubscribe();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
          console.log('[WebPush] Subscription refreshed');
        }
      }
    }

    // Save subscription to Supabase
    const { error } = await supabase
      .from('profiles')
      .update({ 
        web_push_subscription: subscription.toJSON() as any
      })
      .eq('id', userId);

    if (error) {
      console.error('Failed to save Web Push subscription:', error);
    } else {
      console.log('Web Push subscription saved to Supabase');
    }

    return subscription;
  } catch (error) {
    console.error('Web Push registration failed:', error);
    return null;
  }
}

/**
 * Unregister Web Push notifications
 */
export async function unregisterWebPushNotifications(userId: string): Promise<void> {
  if (!isWebPushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        console.log('Web Push unsubscribed');
      }
    }

    // Clear subscription from Supabase
    await supabase
      .from('profiles')
      .update({ web_push_subscription: null })
      .eq('id', userId);

  } catch (error) {
    console.error('Web Push unregistration failed:', error);
  }
}

/**
 * Check if user has an active Web Push subscription
 */
export async function hasWebPushSubscription(): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;

    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}
