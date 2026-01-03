import { Tabs, Redirect } from 'expo-router';
import { Home, Search, MessageCircle, Bell, User } from 'lucide-react-native';
import { View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useAuthStore } from '@/lib/stores';
import { useUnreadNotificationCount, useUnreadMessageCount, usePWA } from '@/lib/hooks';

export default function TabsLayout() {
  const { isLoading, isAuthenticated } = useAuthStore();
  const { data: unreadNotifCount } = useUnreadNotificationCount();
  const { data: unreadMsgCount } = useUnreadMessageCount();
  const { setBadge } = usePWA();

  // 💎 DIAMOND: Update app badge when unread count changes
  useEffect(() => {
    if (unreadNotifCount !== undefined) {
      setBadge(unreadNotifCount);
    }
  }, [unreadNotifCount, setBadge]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0A0A0A',
        }}
      >
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
          backgroundColor: '#141414',
          borderTopColor: '#2A2A2A',
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#10B981',
        tabBarInactiveTintColor: '#6B6B6B',
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
        name="messages"
        options={{
          tabBarIcon: ({ color, size }) => <MessageCircle size={size} color={color} />,
          tabBarBadge:
            unreadMsgCount && unreadMsgCount > 0 ? (unreadMsgCount > 99 ? '99+' : unreadMsgCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: '#10B981', fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          href: null, // Hide from tab bar (accessed via FAB)
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          tabBarIcon: ({ color, size }) => <Bell size={size} color={color} />,
          tabBarBadge:
            unreadNotifCount && unreadNotifCount > 0 ? (unreadNotifCount > 99 ? '99+' : unreadNotifCount) : undefined,
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
