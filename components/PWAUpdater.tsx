import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import Animated, { 
  FadeInUp, 
  FadeOutDown, 
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { RefreshCw, AlertTriangle } from 'lucide-react-native';
import { logger } from '@/lib/utils/logger';

interface PWAUpdaterProps {
  /** Check for updates interval in milliseconds (default: 60000 = 1 minute) */
  checkInterval?: number;
}

/**
 * PWAUpdater - ABSOLUTE GOLD STANDARD Update Handler
 * 
 * Handles:
 * - Atomic cache updates (no Frankenstein state)
 * - Zombie tab cleanup
 * - Double reload prevention
 * - Force update for breaking changes
 * - Graceful degradation
 */
export function PWAUpdater({ checkInterval = 60000 }: PWAUpdaterProps) {
  // 💎 Prevent hydration mismatch - don't render on SSR
  const [isMounted, setIsMounted] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateType, setUpdateType] = useState<'normal' | 'critical'>('normal');
  
  // 💎 Guards against reload loops and race conditions
  const isRefreshingRef = useRef(false);
  const hasShownToastRef = useRef(false);
  
  // Animation for the refresh icon
  const rotation = useSharedValue(0);
  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // 💎 Mount check for hydration safety
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // =====================================================
  // Setup Service Worker Listeners
  // =====================================================
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) {
      logger.info('sw', 'no_support', 'serviceWorker not in navigator');
      return;
    }
    if (!isMounted) return;

    const setupServiceWorker = async () => {
      try {
        logger.info('sw', 'setup_start', 'PWAUpdater starting SW setup');
        
        // Get existing registration
        let reg = await navigator.serviceWorker.getRegistration();
        logger.info('sw', 'get_registration', `Existing registration: ${reg ? 'yes' : 'no'}`);
        
        // If no registration, register the SW
        if (!reg) {
          logger.info('sw', 'registering', 'No existing registration, registering /sw.js');
          reg = await navigator.serviceWorker.register('/sw.js', {
            scope: '/',
          });
          logger.info('sw', 'registered', 'Service Worker registered successfully');
          console.log('[PWAUpdater] Service Worker registered');
        }
        
        // Log SW states
        logger.info('sw', 'states', `active: ${!!reg.active}, installing: ${!!reg.installing}, waiting: ${!!reg.waiting}`);
        
        handleRegistration(reg);
      } catch (error: any) {
        logger.error('sw', 'setup_error', error);
        console.error('[PWAUpdater] Error:', error);
      }
    };

    setupServiceWorker();

    // 💎 THE CRITICAL FIX: controllerchange listener
    // This fires ONLY when a new SW has taken control
    const handleControllerChange = () => {
      if (isRefreshingRef.current) {
        console.log('[PWAUpdater] Reload already in progress, skipping');
        return;
      }
      isRefreshingRef.current = true;
      
      console.log('[PWAUpdater] New controller active - executing atomic reload');
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // 💎 Listen for SW_ACTIVATED messages (for logging/analytics)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_ACTIVATED') {
        console.log(`[PWAUpdater] SW activated: ${event.data.version}`);
      }
    };
    
    navigator.serviceWorker.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [isMounted]); // Re-run when mounted changes

  // =====================================================
  // Periodic Update Check
  // =====================================================
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!registration) return;

    // Check immediately on mount
    registration.update().catch(console.error);

    // Then check periodically
    const interval = setInterval(() => {
      console.log('[PWAUpdater] Checking for updates...');
      registration.update().catch(console.error);
    }, checkInterval);

    return () => clearInterval(interval);
  }, [registration, checkInterval]);

  // =====================================================
  // Handle Registration State
  // =====================================================
  const handleRegistration = useCallback((reg: ServiceWorkerRegistration) => {
    setRegistration(reg);

    // Check if there's already a waiting worker
    if (reg.waiting) {
      console.log('[PWAUpdater] Update already waiting');
      checkForForceUpdate(reg.waiting);
      return;
    }

    // Listen for new installations
    const handleUpdateFound = () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      console.log('[PWAUpdater] New worker installing...');

      const handleStateChange = () => {
        if (newWorker.state === 'installed') {
          // Only show toast if there's an existing controller (not first install)
          if (navigator.serviceWorker.controller) {
            console.log('[PWAUpdater] New version ready');
            checkForForceUpdate(newWorker);
          }
        }
      };

      newWorker.addEventListener('statechange', handleStateChange);
    };

    reg.addEventListener('updatefound', handleUpdateFound);
  }, []);

  // =====================================================
  // Check for Force Update
  // =====================================================
  const checkForForceUpdate = useCallback((worker: ServiceWorker) => {
    // Check if this is a critical update that should be forced
    const channel = new MessageChannel();
    
    channel.port1.onmessage = (event) => {
      if (event.data?.type === 'FORCE_UPDATE_RESULT') {
        if (event.data.shouldForce) {
          console.log('[PWAUpdater] CRITICAL UPDATE - forcing immediate update');
          setUpdateType('critical');
          // Immediately trigger update without user interaction
          worker.postMessage({ type: 'SKIP_WAITING' });
        } else {
          // Normal update - show toast
          if (!hasShownToastRef.current) {
            // Check if user dismissed in this session
            const dismissed = sessionStorage.getItem('pwa_update_dismissed');
            if (dismissed !== 'true') {
              setShowToast(true);
              hasShownToastRef.current = true;
            }
          }
        }
      }
    };
    
    worker.postMessage({ type: 'CHECK_FORCE_UPDATE' }, [channel.port2]);
  }, []);

  // =====================================================
  // Trigger Update
  // =====================================================
  const handleUpdate = useCallback(() => {
    if (!registration?.waiting) return;

    setIsUpdating(true);
    
    // Animate the refresh icon
    rotation.value = withSpring(rotation.value + 360, {
      damping: 10,
      stiffness: 100,
    });

    // Clear the dismissal flag since user is actively updating
    sessionStorage.removeItem('pwa_update_dismissed');

    // Tell the waiting worker to skip waiting and take control
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // The 'controllerchange' event will trigger a reload
  }, [registration, rotation]);

  // =====================================================
  // Dismiss Toast
  // =====================================================
  const handleDismiss = useCallback(() => {
    setShowToast(false);
    // Remember dismissal in session so we don't nag
    sessionStorage.setItem('pwa_update_dismissed', 'true');
  }, []);

  // Don't render on non-web platforms or during SSR
  if (Platform.OS !== 'web') return null;
  if (!isMounted) return null;
  if (!showToast) return null;

  const isCritical = updateType === 'critical';

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(15)}
      exiting={FadeOutDown.springify().damping(15)}
      style={styles.container}
    >
      <View style={[styles.toast, isCritical && styles.toastCritical]}>
        {/* Icon */}
        <Animated.View style={animatedIconStyle}>
          {isCritical ? (
            <AlertTriangle size={24} color="#EF4444" />
          ) : (
            <RefreshCw size={24} color="#10B981" />
          )}
        </Animated.View>

        {/* Text */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {isCritical ? 'Critical Update Required' : 'Update Available'}
          </Text>
          <Text style={styles.subtitle}>
            {isCritical 
              ? 'Please update now to continue using Cannect'
              : 'Tap to refresh and get the latest features'
            }
          </Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttonContainer}>
          {!isCritical && (
            <Pressable
              onPress={handleDismiss}
              style={styles.laterButton}
            >
              <Text style={styles.laterText}>Later</Text>
            </Pressable>
          )}
          
          <Pressable
            onPress={handleUpdate}
            disabled={isUpdating}
            style={[
              styles.updateButton, 
              isUpdating && styles.updateButtonDisabled,
              isCritical && styles.updateButtonCritical
            ]}
          >
            <Text style={styles.updateText}>
              {isUpdating ? 'Updating...' : 'Update'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    // @ts-ignore - boxShadow for web, elevation for native
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
    elevation: 8,
  },
  toastCritical: {
    borderColor: '#EF4444',
    borderWidth: 2,
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  title: {
    color: '#FAFAFA',
    fontWeight: '600',
    fontSize: 15,
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 13,
    marginTop: 2,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  laterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  laterText: {
    color: '#71717A',
    fontWeight: '500',
  },
  updateButton: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  updateButtonDisabled: {
    opacity: 0.7,
  },
  updateButtonCritical: {
    backgroundColor: '#EF4444',
  },
  updateText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});

export default PWAUpdater;
