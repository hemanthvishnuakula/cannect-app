import "../global.css";

import { useEffect, useState } from "react";
import { LogBox, Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/lib/stores";
import * as atproto from "@/lib/atproto/agent";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PWAUpdater } from "@/components/PWAUpdater";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { WhatsNewToast } from "@/components/WhatsNewToast";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ToastProvider } from "@/components/ui/Toast";
import { logger, setupGlobalErrorHandlers, perf } from "@/lib/utils/logger";

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// 🔇 Silence the "useLayoutEffect" warning on Web (React Navigation SSR limitation)
if (Platform.OS === "web") {
  LogBox.ignoreLogs([
    "Warning: useLayoutEffect does nothing on the server",
  ]);
}

// Inner component that uses hooks requiring QueryClient
function AppContent() {
  // 💎 Hydration Gate - Prevent SSR/client mismatch on web
  const [isMounted, setIsMounted] = useState(false);

  // 💎 Set mounted after first render to gate hydration
  useEffect(() => {
    setIsMounted(true);
    // Setup global error handlers for logging
    if (Platform.OS === 'web') {
      setupGlobalErrorHandlers();
      // Track performance metrics and Core Web Vitals
      perf.appStart();
      perf.trackWebVitals();
    }
  }, []);

  // 💎 bfcache handling - Invalidate stale queries when page restored from back/forward cache
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const handlePageShow = (event: PageTransitionEvent) => {
      // persisted = true means page was restored from bfcache
      if (event.persisted) {
        console.log('[bfcache] Page restored from cache, invalidating queries');
        queryClient.invalidateQueries();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // 💎 Visibility change handler - Refresh data when app wakes from background
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof document === "undefined") return;

    let lastHidden = 0;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
      } else if (document.visibilityState === "visible") {
        // If hidden for more than 5 minutes, refresh session first, then data
        const hiddenDuration = Date.now() - lastHidden;
        const fiveMinutes = 5 * 60 * 1000;
        
        if (lastHidden > 0 && hiddenDuration > fiveMinutes) {
          console.log('[App] Woke from background after 5+ mins, refreshing session...');
          
          try {
            // Try to refresh the session before invalidating queries
            // This ensures the access token is valid before making API calls
            await atproto.refreshSession();
            console.log('[App] Session refreshed, now refreshing data');
            queryClient.invalidateQueries();
          } catch (err) {
            console.warn('[App] Session refresh failed:', err);
            // Session refresh failed - queries will trigger auth error handling
            queryClient.invalidateQueries();
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // 💎 DIAMOND: Service Worker message handler for background sync
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      const { type } = event.data || {};

      switch (type) {
        case "PROCESS_SYNC_QUEUE":
          // Process offline queue items
          console.log("[App] Processing sync queue from SW");
          // TODO: Implement queue processing with AT Protocol
          event.ports?.[0]?.postMessage({ success: true, processed: 0 });
          break;

        case "BACKGROUND_REFRESH":
          // Periodic background sync refreshed data
          console.log("[App] Background refresh triggered");
          queryClient.invalidateQueries({ queryKey: ["timeline"] });
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
          break;
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  // 💎 Gatekeeper: Skip hydration comparison by returning null during SSR
  if (Platform.OS === 'web' && !isMounted) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A' }} />
    );
  }

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <StatusBar style="light" />
        
        {/* 💎 Global Offline Banner - Shows on all screens when offline */}
        <OfflineBanner />
        
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#0A0A0A" },
            animation: "slide_from_right",
            // Disable automatic safe area insets - we handle them manually
            headerShadowVisible: false,
          }}
        />
        
        {/* 💎 PWA Update Toast - Shows when new version is available */}
        <PWAUpdater checkInterval={60000} />
        
        {/* 💎 iOS Install Prompt - Guides Safari users to install */}
        <IOSInstallPrompt />
        
        {/* 💎 What's New Toast - Shows after app updates */}
        <WhatsNewToast />
      </ToastProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    // Initialize AT Protocol agent and restore session
    async function initAuth() {
      try {
        const agent = await atproto.initializeAgent();
        if (agent.session) {
          setSession(agent.session);
          logger.auth.sessionRestore(agent.session.did);
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        console.error("[RootLayout] Failed to initialize auth:", err);
        logger.auth.sessionRestoreError(err?.message || 'Unknown error');
        setLoading(false);
      } finally {
        SplashScreen.hideAsync();
      }
    }

    initAuth();
  }, [setSession, setLoading]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AppContent />
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
