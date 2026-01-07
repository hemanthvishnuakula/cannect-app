// =====================================================
// Cannect Service Worker v3.1 - DIAMOND POLISH
// Atomic Versioning + Cache Purging + Network Resilience
// =====================================================

// 💎 ATOMIC VERSIONING - INCREMENT THIS ON EVERY DEPLOY
const CACHE_VERSION = 'v2.0.0';
const CACHE_NAME = `cannect-atomic-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// 💎 Versions that require immediate force update (breaking changes)
const FORCE_UPDATE_VERSIONS = [];

// Core assets required for the app shell
const PRECACHE_ASSETS = [OFFLINE_URL, '/icon-192.png', '/icon-512.png', '/badge-72.png'];

// 💎 Domains to NEVER cache (APIs, external media)
const CACHE_BYPASS_PATTERNS = [
  '/xrpc/', // AT Protocol API
  'bsky.network',
  'bsky.app',
  'cannect.space/xrpc',
  'pds.cannect.space/xrpc',
  'cloudflare',
  'imagedelivery.net',
  'videodelivery.net',
  'customer-',
  '/api/',
  '.m3u8', // HLS video manifests
  'blob:',
];

// =====================================================
// Install Event - Build Atomic Cache
// =====================================================
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${CACHE_VERSION}`);

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        console.log('[SW] Pre-caching atomic assets');

        // 💎 Cache assets individually for graceful degradation
        const results = await Promise.allSettled(
          PRECACHE_ASSETS.map(async (url) => {
            try {
              // Force network fetch to avoid caching stale versions
              const response = await fetch(url, { cache: 'reload' });
              if (response.ok) {
                await cache.put(url, response);
                console.log(`[SW] Cached: ${url}`);
                return { url, success: true };
              }
              console.warn(`[SW] Failed to fetch ${url}: ${response.status}`);
              return { url, success: false };
            } catch (error) {
              console.warn(`[SW] Failed to fetch ${url}:`, error.message);
              return { url, success: false };
            }
          })
        );

        const successCount = results.filter(
          (r) => r.status === 'fulfilled' && r.value?.success
        ).length;
        console.log(`[SW] Pre-cached ${successCount}/${PRECACHE_ASSETS.length} assets`);

        // 💎 CRITICAL: Determine if we should auto-activate
        // Check if there's any controller (existing SW controlling pages)
        // If no controller exists, this is a fresh install and we should activate immediately
        const allClients = await self.clients.matchAll({ includeUncontrolled: true });
        const hasControlledClients = allClients.some((client) => {
          // Check if this client has a controller by sending a test
          return false; // Can't reliably check from SW, use different approach
        });

        // SIMPLER: Just always skipWaiting - the activate event will claim clients
        // This is safe because our activate event handles everything gracefully
        // PWAUpdater will handle showing the reload toast for updates
        console.log('[SW] Activating immediately via skipWaiting');
        self.skipWaiting();
      } catch (error) {
        console.error('[SW] Pre-cache failed:', error);
      }
    })()
  );
});

// =====================================================
// Activate Event - ATOMIC SLEDGEHAMMER CLEANUP
// =====================================================
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${CACHE_VERSION}`);

  event.waitUntil(
    (async () => {
      // 💎 ATOMIC PURGE: Delete ALL caches that aren't current version
      const cacheNames = await caches.keys();
      const deletionPromises = cacheNames
        .filter((name) => {
          // Delete any cache that:
          // 1. Starts with 'cannect-' but isn't current version
          // 2. Is an old cache from previous naming schemes
          const isOldCannectCache = name.startsWith('cannect-') && name !== CACHE_NAME;
          const isLegacyCache = name.includes('workbox') || name.includes('runtime');
          return isOldCannectCache || isLegacyCache;
        })
        .map((name) => {
          console.log(`[SW] 🔥 Atomic Purge: ${name}`);
          return caches.delete(name);
        });

      await Promise.all(deletionPromises);
      console.log(`[SW] Purged ${deletionPromises.length} old caches`);

      // 💎 Take control of ALL open tabs immediately
      await self.clients.claim();
      console.log('[SW] Now controlling all clients');

      // 💎 Notify all clients that a new version is active
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: CACHE_VERSION,
        });
      });
    })()
  );
});

// =====================================================
// Fetch Event - Smart Caching Strategy
// =====================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip non-http(s) requests
  if (!url.startsWith('http')) return;

  // 💎 BYPASS: Never cache these patterns
  const shouldBypass = CACHE_BYPASS_PATTERNS.some((pattern) => url.includes(pattern));
  if (shouldBypass) {
    return; // Let browser handle normally
  }

  // 💎 NAVIGATION: Network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Always try network first for navigation
          const networkResponse = await fetch(request);

          // Cache successful responses for offline fallback
          if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
          }

          return networkResponse;
        } catch (error) {
          // Network failed - try cache, then offline page
          console.log('[SW] Navigation failed, trying cache');
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          // Last resort: offline page
          const offlineResponse = await caches.match(OFFLINE_URL);
          return (
            offlineResponse ||
            new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable',
            })
          );
        }
      })()
    );
    return;
  }

  // 💎 STATIC ASSETS: Stale-while-revalidate with network preference
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);

      // Start network fetch immediately
      const networkPromise = fetch(request)
        .then((response) => {
          // Only cache successful, same-origin responses
          if (response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      // Return cached immediately if available, but update in background
      if (cachedResponse) {
        // Fire-and-forget background update
        networkPromise.catch(() => {});
        return cachedResponse;
      }

      // No cache - wait for network
      const networkResponse = await networkPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // Both failed
      return new Response('Resource unavailable', { status: 404 });
    })()
  );
});

// =====================================================
// Message Event - Update Control & Version Queries
// =====================================================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  const { type } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      console.log('[SW] Skip waiting triggered - activating immediately');
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports?.[0]?.postMessage({ version: CACHE_VERSION });
      break;

    case 'CHECK_FORCE_UPDATE':
      const shouldForce = FORCE_UPDATE_VERSIONS.includes(CACHE_VERSION);
      event.source?.postMessage({
        type: 'FORCE_UPDATE_RESULT',
        shouldForce,
        version: CACHE_VERSION,
      });
      break;

    case 'CLEAR_CACHE':
      // Emergency cache clear
      caches.keys().then((names) => {
        names.forEach((name) => caches.delete(name));
        console.log('[SW] All caches cleared');
      });
      break;
  }
});

// =====================================================
// Push Notification Handling
// =====================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = { title: 'Cannect', body: 'New notification' };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('[SW] Error parsing push data:', e);
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    tag: data.data?.notificationId || 'cannect-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// =====================================================
// Notification Click Handling
// =====================================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');

  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const data = event.notification.data;
  let url = '/';

  if (data?.type === 'follow' && data?.actorUsername) {
    url = `/user/${data.actorUsername}`;
  } else if (data?.postId) {
    url = `/post/${data.postId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus existing window
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// =====================================================
// Notification Close Handling
// =====================================================
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed');
});

// =====================================================
// 💎 DIAMOND: Background Sync - Process offline queue
// =====================================================
self.addEventListener('sync', (event) => {
  console.log(`[SW] Background sync triggered: ${event.tag}`);

  if (event.tag === 'cannect-sync') {
    event.waitUntil(processOfflineQueue());
  }
});

/**
 * Process all items in the offline sync queue
 */
async function processOfflineQueue() {
  console.log('[SW] Processing offline queue...');

  try {
    // Get queue from IndexedDB or localStorage via client
    const clients = await self.clients.matchAll({ type: 'window' });

    if (clients.length === 0) {
      console.log('[SW] No clients available to process queue');
      return;
    }

    // Request the client to process the queue
    // This keeps AT Protocol auth logic in the main thread
    const channel = new MessageChannel();

    const result = await new Promise((resolve) => {
      channel.port1.onmessage = (event) => {
        resolve(event.data);
      };

      clients[0].postMessage({ type: 'PROCESS_SYNC_QUEUE' }, [channel.port2]);

      // Timeout after 30 seconds
      setTimeout(() => resolve({ success: false, reason: 'timeout' }), 30000);
    });

    console.log('[SW] Queue processing result:', result);
  } catch (error) {
    console.error('[SW] Failed to process offline queue:', error);
    throw error; // Throw to retry sync
  }
}

// =====================================================
// 💎 DIAMOND: Periodic Background Sync - Keep feed fresh
// =====================================================
self.addEventListener('periodicsync', (event) => {
  console.log(`[SW] Periodic sync triggered: ${event.tag}`);

  if (event.tag === 'cannect-feed-refresh') {
    event.waitUntil(refreshFeedInBackground());
  }
});

/**
 * Refresh the feed cache in the background
 */
async function refreshFeedInBackground() {
  console.log('[SW] Refreshing feed in background...');

  try {
    // Notify clients to refresh their data
    const clients = await self.clients.matchAll({ type: 'window' });

    clients.forEach((client) => {
      client.postMessage({ type: 'BACKGROUND_REFRESH' });
    });

    console.log('[SW] Background refresh notification sent');
  } catch (error) {
    console.error('[SW] Background refresh failed:', error);
  }
}

console.log(`[SW] Service Worker loaded - Version ${CACHE_VERSION}`);
