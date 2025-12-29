import "../global.css";

import { useEffect, useState, type ReactNode } from "react";
import { LogBox, Platform, View, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";

// 📊 PostHog - Only import on client side to avoid SSR issues
// posthog-react-native uses window and React Navigation hooks that don't exist during static rendering
let PostHogProvider: React.ComponentType<{ apiKey: string; options: any; children: ReactNode }> | null = null;
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PostHogProvider = require('posthog-react-native').PostHogProvider;
}

// 🔒 Initialize Sentry for error tracking (before any other code runs)
Sentry.init({
  dsn: "https://1db8f227056f21591f183ff12ff39da0@o4510392298766336.ingest.us.sentry.io/4510616490606592",
  enabled: !__DEV__, // Only track errors in production
  environment: __DEV__ ? "development" : "production",
  // Performance monitoring (sample 20% of transactions)
  tracesSampleRate: 0.2,
  // Attach user info when available
  beforeSend(event) {
    // Scrub sensitive data if needed
    return event;
  },
});
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
      const state = document.visibilityState;
      console.log('[App] Visibility changed to:', state);
      
      if (state === "hidden") {
        lastHidden = Date.now();
        console.log('[App] 📱 App hidden at', new Date().toISOString());
      } else if (state === "visible") {
        const hiddenDuration = Date.now() - lastHidden;
        const fiveMinutes = 5 * 60 * 1000;
        
        console.log('[App] 📱 App visible after', Math.round(hiddenDuration/1000), 'seconds');
        
        if (lastHidden > 0 && hiddenDuration > fiveMinutes) {
          console.log('[App] ⏰ Hidden for 5+ mins, refreshing session...');
          
          try {
            // Try to refresh the session before invalidating queries
            // This ensures the access token is valid before making API calls
            await atproto.refreshSession();
            console.log('[App] ✅ Session refreshed, now refreshing data');
            queryClient.invalidateQueries();
          } catch (err: any) {
            console.warn('[App] ❌ Session refresh failed:', err?.message || err);
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

  // 💎 Gatekeeper: Skip hydration comparison by returning loading state during SSR
  // This prevents the "black screen" on first PWA launch
  if (Platform.OS === 'web' && !isMounted) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
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

export default Sentry.wrap(function RootLayout() {
  const { setSession, setLoading } = useAuthStore();

  useEffect(() => {
    // Initialize AT Protocol agent and restore session
    async function initAuth() {
      console.log('[RootLayout] 🚀 Starting auth initialization...');
      try {
        const agent = await atproto.initializeAgent();
        console.log('[RootLayout] Agent ready, session:', agent.session ? `did:${agent.session.did?.substring(8,20)}` : 'none');
        
        if (agent.session) {
          console.log('[RootLayout] ✅ Session found, setting in store');
          setSession(agent.session);
        } else {
          console.log('[RootLayout] ⚠️ No session found');
          setLoading(false);
        }
      } catch (err: any) {
        console.error("[RootLayout] ❌ Failed to initialize auth:", err?.message || err);
        setLoading(false);
      } finally {
        SplashScreen.hideAsync();
      }
    }

    initAuth();
  }, [setSession, setLoading]);

  // 📊 PostHog Provider - Only wrap on client side (SSR-safe)
  const content = (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AppContent />
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );

  // Wrap with PostHog only on client side (window exists)
  if (PostHogProvider) {
    return (
      <PostHogProvider 
        apiKey="phx_13pBobfwQwjDordNHORfTp1p2SVNjnbSK0MddbSQRT8NXBSH"
        options={{
          host: 'https://us.i.posthog.com',
          enableSessionReplay: true,
          disabled: __DEV__, // Only track in production
        }}
      >
        {content}
      </PostHogProvider>
    );
  }

  return content;
});