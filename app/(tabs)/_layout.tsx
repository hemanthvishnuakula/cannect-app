import { Tabs, Redirect, usePathname } from "expo-router";
import { Home, Search, PlusSquare, Bell, User } from "lucide-react-native";
import { View, ActivityIndicator } from "react-native";
import { useEffect } from "react";
import { useAuthStore } from "@/lib/stores";
import { useUnreadNotificationCount, usePWA } from "@/lib/hooks";
import { logger } from "@/lib/utils/logger";

export default function TabsLayout() {
  const { isLoading, isAuthenticated } = useAuthStore();
  const { data: unreadCount } = useUnreadNotificationCount();
  const { setBadge } = usePWA();
  const pathname = usePathname();

  // 💎 Log screen views when tab changes
  useEffect(() => {
    if (pathname && isAuthenticated) {
      logger.nav.screenView(pathname);
    }
  }, [pathname, isAuthenticated]);

export default function TabsLayout() {
  const { isLoading, isAuthenticated } = useAuthStore();
  const { data: unreadCount } = useUnreadNotificationCount();
  const { setBadge } = usePWA();

  // 💎 DIAMOND: Update app badge when unread count changes
  useEffect(() => {
    if (unreadCount !== undefined) {
      setBadge(unreadCount);
    }
  }, [unreadCount, setBadge]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A0A0A" }}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  // Redirect to welcome if not authenticated
  if (!isAuthenticated) {
    return <Redirect href="/(auth)/welcome" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#141414",
          borderTopColor: "#2A2A2A",
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 10,
        },
        tabBarActiveTintColor: "#10B981",
        tabBarInactiveTintColor: "#6B6B6B",
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          tabBarIcon: ({ color, size }) => <PlusSquare size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          tabBarIcon: ({ color, size }) => <Bell size={size} color={color} />,
          tabBarBadge: unreadCount && unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: '#EF4444', fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
