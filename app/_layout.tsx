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
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/lib/stores";
import { usePushNotifications } from "@/lib/hooks";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PWAUpdater } from "@/components/PWAUpdater";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { WhatsNewToast } from "@/components/WhatsNewToast";
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

  // Initialize push notifications (registers token when authenticated)
  usePushNotifications();

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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
      } else if (document.visibilityState === "visible") {
        // If hidden for more than 5 minutes, refresh data
        const hiddenDuration = Date.now() - lastHidden;
        const fiveMinutes = 5 * 60 * 1000;
        
        if (lastHidden > 0 && hiddenDuration > fiveMinutes) {
          console.log('[App] Woke from background after 5+ mins, refreshing data');
          queryClient.invalidateQueries();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
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
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#0A0A0A" },
            animation: "slide_from_right",
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
  const { setSession, setProfile, setLoading } = useAuthStore();

  useEffect(() => {
    // Helper to fetch profile when user is authenticated
    const fetchProfile = async (userId: string) => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
        
        if (!error && data) {
          setProfile(data);
        }
      } catch (err) {
        console.error("[RootLayout] Failed to fetch profile:", err);
      }
    };

    // Single listener to sync Supabase Auth with Zustand Store
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id);
      }
      SplashScreen.hideAsync();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user?.id) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setProfile]);

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
