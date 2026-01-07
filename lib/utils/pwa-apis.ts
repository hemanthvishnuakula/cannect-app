/**
 * PWA Diamond Standard APIs
 *
 * Advanced PWA capabilities for a native-like experience:
 * - App Badging API (unread count on app icon)
 * - Persistent Storage API (prevent cache eviction)
 * - Web Share API (native share sheets)
 * - Background Sync Queue (offline-first actions)
 */

import { Platform } from 'react-native';

// =====================================================
// App Badging API - Show unread count on app icon
// =====================================================

/**
 * Set the app badge count (unread notifications)
 * Works on installed PWAs on Android/iOS/Desktop
 */
export async function setAppBadge(count: number): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined') return false;

  try {
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        await (navigator as any).setAppBadge(count);
      } else {
        await (navigator as any).clearAppBadge();
      }
      console.log(`[PWA] Badge set to ${count}`);
      return true;
    }
  } catch (error) {
    console.warn('[PWA] Badging API not supported:', error);
  }
  return false;
}

/**
 * Clear the app badge
 */
export async function clearAppBadge(): Promise<boolean> {
  return setAppBadge(0);
}

// =====================================================
// Persistent Storage API - Prevent cache eviction
// =====================================================

/**
 * Request persistent storage to prevent browser from evicting cache
 * Critical for PWAs that need reliable offline support
 */
export async function requestPersistentStorage(): Promise<{
  granted: boolean;
  persisted: boolean;
}> {
  if (Platform.OS !== 'web') return { granted: false, persisted: false };
  if (typeof navigator === 'undefined') return { granted: false, persisted: false };

  try {
    if (navigator.storage && navigator.storage.persist) {
      // Check if already persisted
      const persisted = await navigator.storage.persisted();
      if (persisted) {
        console.log('[PWA] Storage already persistent');
        return { granted: true, persisted: true };
      }

      // Request persistence
      const granted = await navigator.storage.persist();
      console.log(`[PWA] Persistent storage ${granted ? 'granted' : 'denied'}`);
      return { granted, persisted: granted };
    }
  } catch (error) {
    console.warn('[PWA] Persistent Storage API not supported:', error);
  }
  return { granted: false, persisted: false };
}

/**
 * Get storage quota and usage information
 */
export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
  percent: number;
} | null> {
  if (Platform.OS !== 'web') return null;
  if (typeof navigator === 'undefined') return null;

  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;

      console.log(
        `[PWA] Storage: ${(usage / 1024 / 1024).toFixed(2)}MB / ${(quota / 1024 / 1024).toFixed(2)}MB (${percent.toFixed(1)}%)`
      );
      return { usage, quota, percent };
    }
  } catch (error) {
    console.warn('[PWA] Storage estimate not available:', error);
  }
  return null;
}

// =====================================================
// Web Share API - Native share sheets
// =====================================================

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

/**
 * Check if Web Share API is available
 */
export function canShare(data?: ShareData): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined') return false;

  if (!navigator.share) return false;

  // Check if specific data can be shared (e.g., files)
  if (data && navigator.canShare) {
    return navigator.canShare(data);
  }

  return true;
}

/**
 * Share content using native share sheet
 */
export async function share(data: ShareData): Promise<boolean> {
  if (!canShare(data)) {
    console.warn('[PWA] Web Share API not available');
    return false;
  }

  try {
    await navigator.share(data);
    console.log('[PWA] Content shared successfully');
    return true;
  } catch (error: any) {
    // User cancelled share - not an error
    if (error.name === 'AbortError') {
      console.log('[PWA] Share cancelled by user');
      return false;
    }
    console.error('[PWA] Share failed:', error);
    return false;
  }
}

/**
 * Share a post from Cannect
 */
export async function sharePost(post: {
  text: string;
  uri: string;
  authorHandle: string;
}): Promise<boolean> {
  // Use appropriate domain based on user's PDS
  const domain = post.authorHandle.endsWith('.pds.cannect.space')
    ? 'pds.cannect.space'
    : 'cannect.space';
  const postUrl = `https://${domain}/post/${post.uri.split('/').pop()}`;

  return share({
    title: `Post by @${post.authorHandle}`,
    text: post.text.substring(0, 280),
    url: postUrl,
  });
}

// =====================================================
// Background Sync Queue - Offline-first actions
// =====================================================

const SYNC_QUEUE_KEY = 'cannect_sync_queue';

export interface SyncQueueItem {
  id: string;
  type: 'post' | 'like' | 'repost' | 'follow' | 'unfollow';
  payload: any;
  createdAt: number;
  retryCount: number;
}

/**
 * Add an action to the sync queue (for when offline)
 */
export function queueForSync(item: Omit<SyncQueueItem, 'id' | 'createdAt' | 'retryCount'>): void {
  if (Platform.OS !== 'web') return;

  try {
    const queue = getSyncQueue();
    const newItem: SyncQueueItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      retryCount: 0,
    };

    queue.push(newItem);
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));

    console.log(`[PWA] Queued ${item.type} for sync (${queue.length} items in queue)`);

    // Request a background sync if available
    requestBackgroundSync();
  } catch (error) {
    console.error('[PWA] Failed to queue for sync:', error);
  }
}

/**
 * Get all items in the sync queue
 */
export function getSyncQueue(): SyncQueueItem[] {
  if (Platform.OS !== 'web') return [];

  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Remove an item from the sync queue (after successful sync)
 */
export function removeFromSyncQueue(id: string): void {
  if (Platform.OS !== 'web') return;

  try {
    const queue = getSyncQueue().filter((item) => item.id !== id);
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    console.log(`[PWA] Removed ${id} from sync queue (${queue.length} remaining)`);
  } catch (error) {
    console.error('[PWA] Failed to remove from sync queue:', error);
  }
}

/**
 * Clear all items from the sync queue
 */
export function clearSyncQueue(): void {
  if (Platform.OS !== 'web') return;
  localStorage.removeItem(SYNC_QUEUE_KEY);
  console.log('[PWA] Sync queue cleared');
}

/**
 * Request a background sync (will run when online)
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined') return false;

  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration && 'sync' in registration) {
      await (registration as any).sync.register('cannect-sync');
      console.log('[PWA] Background sync registered');
      return true;
    }
  } catch (error) {
    console.warn('[PWA] Background sync not available:', error);
  }
  return false;
}

// =====================================================
// Display Mode Detection
// =====================================================

/**
 * Check if app is running as installed PWA
 */
export function isInstalledPWA(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;

  // Check display-mode media query
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  // iOS Safari check
  const isIOSStandalone = (navigator as any).standalone === true;

  // Check URL parameter (set in manifest start_url)
  const urlParams = new URLSearchParams(window.location.search);
  const fromPWA = urlParams.get('source') === 'pwa';

  return isStandalone || isIOSStandalone || fromPWA;
}

/**
 * Get the current display mode
 */
export function getDisplayMode(): 'browser' | 'standalone' | 'minimal-ui' | 'fullscreen' {
  if (Platform.OS !== 'web') return 'browser';
  if (typeof window === 'undefined') return 'browser';

  const modes: ('fullscreen' | 'standalone' | 'minimal-ui' | 'browser')[] = [
    'fullscreen',
    'standalone',
    'minimal-ui',
    'browser',
  ];

  for (const mode of modes) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) {
      return mode;
    }
  }

  return 'browser';
}

// =====================================================
// Install Prompt Handling
// =====================================================

let deferredInstallPrompt: any = null;

/**
 * Initialize install prompt capture (call once in app root)
 */
export function initInstallPrompt(): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome from showing its own prompt
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[PWA] Install prompt captured');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    console.log('[PWA] App installed successfully');
  });
}

/**
 * Check if we can show an install prompt
 */
export function canShowInstallPrompt(): boolean {
  return deferredInstallPrompt !== null;
}

/**
 * Trigger the install prompt
 */
export async function showInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredInstallPrompt) {
    return 'unavailable';
  }

  try {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`[PWA] Install prompt outcome: ${outcome}`);
    deferredInstallPrompt = null;
    return outcome;
  } catch (error) {
    console.error('[PWA] Install prompt failed:', error);
    return 'unavailable';
  }
}

// =====================================================
// Wake Lock API - Prevent screen sleep during video
// =====================================================

let wakeLock: any = null;

/**
 * Request a wake lock (prevent screen sleep)
 * Useful for video playback
 */
export async function requestWakeLock(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined') return false;

  try {
    if ('wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log('[PWA] Wake lock acquired');

      // Handle release on visibility change
      wakeLock.addEventListener('release', () => {
        console.log('[PWA] Wake lock released');
        wakeLock = null;
      });

      return true;
    }
  } catch (error) {
    console.warn('[PWA] Wake lock failed:', error);
  }
  return false;
}

/**
 * Release the wake lock
 */
export async function releaseWakeLock(): Promise<void> {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}

// =====================================================
// Vibration API - Haptic feedback
// =====================================================

/**
 * Trigger haptic feedback
 */
export function hapticFeedback(pattern: number | number[] = 50): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined') return false;

  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
      return true;
    }
  } catch {
    // Vibration not available
  }
  return false;
}

/**
 * Haptic patterns for different interactions
 */
export const HapticPatterns = {
  light: 10,
  medium: 50,
  heavy: 100,
  success: [50, 50, 50] as number[],
  error: [100, 50, 100, 50, 100] as number[],
  notification: [100, 50, 100] as number[],
};
