/**
 * Profile Screen - Own Profile (Tab)
 *
 * Uses unified ProfileView component
 */

import { useEffect, useState } from 'react';
import { Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { useMyProfile, useLogout } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';
import { ProfileView } from '@/components/Profile/ProfileView';
import { ProfileSkeleton } from '@/components/skeletons';
import { scrollToTop } from '@/lib/utils/scroll-to-top';

export default function ProfileScreen() {
  const router = useRouter();
  const { did } = useAuthStore();
  const logoutMutation = useLogout();
  const [scrollTrigger, setScrollTrigger] = useState(0);

  const profileQuery = useMyProfile();

  // Listen for scroll-to-top events
  useEffect(() => {
    return scrollToTop.subscribe('profile', () => {
      setScrollTrigger((prev) => prev + 1);
    });
  }, []);

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    router.replace('/(auth)/welcome');
  };

  const handleEditProfile = () => {
    router.push('/settings/edit-profile' as any);
  };

  if (profileQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <SafeAreaView
        className="flex-1 bg-background items-center justify-center px-6"
        edges={['top']}
      >
        <RefreshCw size={48} color="#6B7280" />
        <Text className="text-text-primary text-lg font-semibold mt-4">Failed to load profile</Text>
        <Pressable
          onPress={() => profileQuery.refetch()}
          className="bg-primary px-6 py-3 rounded-full mt-4"
        >
          <Text className="text-white font-semibold">Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ProfileView
        profileData={profileQuery.data}
        isOwnProfile={true}
        currentUserDid={did || undefined}
        isRefreshing={profileQuery.isRefetching}
        onRefresh={() => profileQuery.refetch()}
        onEditProfile={handleEditProfile}
        onLogout={handleLogout}
        scrollToTopTrigger={scrollTrigger}
      />
    </SafeAreaView>
  );
}
