/**
 * Edit Profile Screen - Pure AT Protocol
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Camera, Bell, BellOff } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { triggerNotification } from '@/lib/utils/haptics';
import { router } from 'expo-router';
import { useMyProfile, useUpdateProfile, useWebPush } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';

// AT Protocol max blob size is ~1MB, aim for 900KB to be safe
const MAX_IMAGE_SIZE_BYTES = 900 * 1024;

/**
 * Push Notification Toggle Component (Web only)
 * Shows on web platforms, handles iOS PWA detection
 */
function PushNotificationToggle() {
  const webPush = useWebPush();

  // Only show on web
  if (Platform.OS !== 'web') return null;

  // Wait for initialization
  if (!webPush.isInitialized || webPush.isLoading) {
    return (
      <View className="px-4 mt-6 mb-4">
        <View className="border-t border-border pt-6">
          <Text className="text-text-muted text-sm mb-3">Notifications</Text>
          <View className="bg-surface-elevated rounded-xl p-4 flex-row items-center">
            <ActivityIndicator size="small" color="#10B981" />
            <Text className="text-text-muted text-sm ml-3">Checking push support...</Text>
          </View>
        </View>
      </View>
    );
  }

  // Not supported on this browser
  if (!webPush.isSupported) {
    return (
      <View className="px-4 mt-6 mb-4">
        <View className="border-t border-border pt-6">
          <Text className="text-text-muted text-sm mb-3">Notifications</Text>
          <View className="bg-surface-elevated rounded-xl p-4 flex-row items-center">
            <BellOff size={20} color="#6B7280" />
            <View className="flex-1 ml-3">
              <Text className="text-text-muted text-sm">Push notifications not supported</Text>
              <Text className="text-text-muted text-xs mt-1">
                {webPush.isIOSPWA
                  ? 'Requires iOS 16.4+'
                  : "Your browser doesn't support push notifications"}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // iOS but not installed as PWA
  const isIOSSafari =
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !webPush.isIOSPWA;

  if (isIOSSafari) {
    return (
      <View className="px-4 mt-6 mb-4">
        <View className="border-t border-border pt-6">
          <Text className="text-text-muted text-sm mb-3">Notifications</Text>
          <View className="bg-surface-elevated rounded-xl p-4 flex-row items-center">
            <Bell size={20} color="#6B7280" />
            <View className="flex-1 ml-3">
              <Text className="text-text-muted text-sm">Add to Home Screen first</Text>
              <Text className="text-text-muted text-xs mt-1">
                Install Cannect as an app to enable push notifications
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Permission denied
  if (webPush.permission === 'denied') {
    return (
      <View className="px-4 mt-6 mb-4">
        <View className="border-t border-border pt-6">
          <Text className="text-text-muted text-sm mb-3">Notifications</Text>
          <View className="bg-surface-elevated rounded-xl p-4 flex-row items-center">
            <BellOff size={20} color="#EF4444" />
            <View className="flex-1 ml-3">
              <Text className="text-text-muted text-sm">Notifications blocked</Text>
              <Text className="text-text-muted text-xs mt-1">
                Enable in your browser/device settings
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const handleToggle = async () => {
    if (Platform.OS !== 'web') return;

    if (webPush.isSubscribed) {
      await webPush.unsubscribe();
      triggerNotification('success');
    } else {
      const success = await webPush.subscribe();
      if (success) {
        triggerNotification('success');
      } else {
        triggerNotification('error');
      }
    }
  };

  return (
    <View className="px-4 mt-6 mb-4">
      <View className="border-t border-border pt-6">
        <Text className="text-text-muted text-sm mb-3">Notifications</Text>
        <View className="bg-surface-elevated rounded-xl p-4 flex-row items-center">
          {webPush.isSubscribed ? (
            <Bell size={20} color="#10B981" />
          ) : (
            <BellOff size={20} color="#6B7280" />
          )}
          <View className="flex-1 ml-3">
            <Text className="text-text-primary text-sm">Push Notifications</Text>
            <Text className="text-text-muted text-xs mt-1">
              {webPush.isSubscribed
                ? 'Receive notifications for likes, replies, and follows'
                : 'Get notified when someone interacts with your posts'}
            </Text>
            {webPush.error && (
              <Text className="text-accent-error text-xs mt-1">{webPush.error}</Text>
            )}
          </View>
          {webPush.isLoading ? (
            <ActivityIndicator size="small" color="#10B981" />
          ) : (
            <Switch
              value={webPush.isSubscribed}
              onValueChange={handleToggle}
              trackColor={{ false: '#3A3A3A', true: '#10B981' }}
              thumbColor="#FAFAFA"
            />
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * Compress and resize image to fit within size limit
 * For avatars: center-crops to square first, then resizes
 * Uses progressive quality reduction until under limit
 */
async function compressImage(
  uri: string,
  maxSize: number = MAX_IMAGE_SIZE_BYTES,
  isAvatar: boolean = false,
  originalWidth?: number,
  originalHeight?: number
): Promise<{ uri: string; mimeType: string }> {
  // Start with reasonable dimensions
  const maxDimension = isAvatar ? 800 : 1500; // Avatar smaller, banner wider
  let quality = 0.9;

  // Build the manipulation actions
  const actions: ImageManipulator.Action[] = [];

  // For avatars, we need to center-crop to square first
  if (isAvatar && originalWidth && originalHeight) {
    // Calculate center square crop
    const size = Math.min(originalWidth, originalHeight);
    const originX = Math.floor((originalWidth - size) / 2);
    const originY = Math.floor((originalHeight - size) / 2);

    console.log(`[Compress] Original: ${originalWidth}x${originalHeight}, cropping to ${size}x${size} square`);

    // Add crop action first
    actions.push({
      crop: {
        originX,
        originY,
        width: size,
        height: size,
      },
    });
  }

  // Then resize
  actions.push({ resize: { width: maxDimension, height: maxDimension } });

  // First manipulation pass
  let result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // Check file size and progressively reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();

  while (blob.size > maxSize && quality > 0.1) {
    quality -= 0.1;
    console.log(
      `[Compress] Size ${(blob.size / 1024).toFixed(0)}KB > ${(maxSize / 1024).toFixed(0)}KB, reducing quality to ${(quality * 100).toFixed(0)}%`
    );

    result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    response = await fetch(result.uri);
    blob = await response.blob();
  }

  console.log(
    `[Compress] Final size: ${(blob.size / 1024).toFixed(0)}KB at ${(quality * 100).toFixed(0)}% quality`
  );

  return {
    uri: result.uri,
    mimeType: 'image/jpeg',
  };
}

export default function EditProfileScreen() {
  const { handle } = useAuthStore();
  const profileQuery = useMyProfile();
  const updateProfileMutation = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<{ uri: string; mimeType: string } | null>(null);
  const [banner, setBanner] = useState<{ uri: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form with current profile data
  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.displayName || '');
      setDescription(profileQuery.data.description || '');
    }
  }, [profileQuery.data]);

  const handlePickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1, // Get full quality, we'll compress ourselves
    });

    if (!result.canceled && result.assets[0]) {
      setIsCompressing(true);
      try {
        const asset = result.assets[0];
        const compressed = await compressImage(
          asset.uri,
          MAX_IMAGE_SIZE_BYTES,
          true,
          asset.width,
          asset.height
        );
        setAvatar(compressed);
      } catch (err) {
        console.error('Failed to compress avatar:', err);
        setError('Failed to process image');
      } finally {
        setIsCompressing(false);
      }
    }
  };

  const handlePickBanner = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 1],
      quality: 1, // Get full quality, we'll compress ourselves
    });

    if (!result.canceled && result.assets[0]) {
      setIsCompressing(true);
      try {
        const compressed = await compressImage(result.assets[0].uri, MAX_IMAGE_SIZE_BYTES, false);
        setBanner(compressed);
      } catch (err) {
        console.error('Failed to compress banner:', err);
        setError('Failed to process image');
      } finally {
        setIsCompressing(false);
      }
    }
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);

    try {
      const update: any = {
        displayName: displayName.trim(),
        description: description.trim(),
      };

      // Convert avatar to Uint8Array if new one selected
      if (avatar) {
        const response = await fetch(avatar.uri);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        update.avatar = new Uint8Array(arrayBuffer);
        update.avatarMimeType = avatar.mimeType;
      }

      // Convert banner to Uint8Array if new one selected
      if (banner) {
        const response = await fetch(banner.uri);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        update.banner = new Uint8Array(arrayBuffer);
        update.bannerMimeType = banner.mimeType;
      }

      // Wait for mutation to complete BEFORE navigating
      // This ensures the update finishes on Android PWA where background work is killed
      await updateProfileMutation.mutateAsync(update);

      triggerNotification('success');
      
      // Navigate back after successful save
      router.back();
    } catch (err: any) {
      setIsSaving(false);
      setError(err.message || 'Failed to update profile');
      triggerNotification('error');
    }
  };

  const canSave = !updateProfileMutation.isPending && !isCompressing && !isSaving;
  const currentAvatar = avatar?.uri || profileQuery.data?.avatar;
  const currentBanner = banner?.uri || profileQuery.data?.banner;

  // Show full-screen loader during initial load, compression, or saving
  if (profileQuery.isLoading || isCompressing || isSaving) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#10B981" />
        <Text className="text-text-muted mt-2">
          {isCompressing ? 'Optimizing image...' : isSaving ? 'Saving...' : 'Loading...'}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center"
          >
            <ArrowLeft size={24} color="#FAFAFA" />
          </Pressable>

          <Text className="text-text-primary text-lg font-semibold">Edit Profile</Text>

          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            className={`px-4 py-2 rounded-full ${canSave ? 'bg-primary' : 'bg-surface-elevated'}`}
          >
            {updateProfileMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className={`font-semibold ${canSave ? 'text-white' : 'text-text-muted'}`}>
                Save
              </Text>
            )}
          </Pressable>
        </View>

        {/* Error */}
        {error && (
          <View className="bg-accent-error/20 px-4 py-2">
            <Text className="text-accent-error text-center">{error}</Text>
          </View>
        )}

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {/* Banner */}
          <Pressable onPress={handlePickBanner} className="relative">
            {currentBanner ? (
              <Image source={{ uri: currentBanner }} className="w-full h-32" resizeMode="cover" />
            ) : (
              <View className="w-full h-32 bg-primary/20" />
            )}
            {/* Camera badge - bottom right corner */}
            <View className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-primary items-center justify-center border-2 border-background">
              <Camera size={16} color="#fff" />
            </View>
          </Pressable>

          {/* Avatar */}
          <View className="px-4 -mt-12">
            <Pressable onPress={handlePickAvatar} className="relative w-24 h-24">
              {currentAvatar ? (
                <Image
                  source={{ uri: currentAvatar }}
                  className="w-24 h-24 rounded-full border-4 border-background"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-24 h-24 rounded-full border-4 border-background bg-surface-elevated items-center justify-center">
                  <Text className="text-text-muted text-3xl">
                    {(handle || '?')[0].toUpperCase()}
                  </Text>
                </View>
              )}
              {/* Camera badge - bottom right corner */}
              <View className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary items-center justify-center border-2 border-background">
                <Camera size={14} color="#fff" />
              </View>
            </Pressable>
          </View>

          {/* Form */}
          <View className="px-4 mt-6 gap-4">
            {/* Display Name */}
            <View>
              <Text className="text-text-muted text-sm mb-2">Display Name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your display name"
                placeholderTextColor="#6B7280"
                maxLength={64}
                className="bg-surface-elevated text-text-primary px-4 py-3 rounded-xl"
              />
            </View>

            {/* Bio */}
            <View>
              <Text className="text-text-muted text-sm mb-2">Bio</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Tell us about yourself"
                placeholderTextColor="#6B7280"
                multiline
                numberOfLines={4}
                maxLength={256}
                className="bg-surface-elevated text-text-primary px-4 py-3 rounded-xl"
                style={{ textAlignVertical: 'top', minHeight: 100 }}
              />
              <Text className="text-text-muted text-sm mt-1 text-right">
                {description.length}/256
              </Text>
            </View>

            {/* Handle (read-only) */}
            <View>
              <Text className="text-text-muted text-sm mb-2">Handle</Text>
              <View className="bg-surface-elevated px-4 py-3 rounded-xl opacity-50">
                <Text className="text-text-muted">@{profileQuery.data?.handle || handle}</Text>
              </View>
              <Text className="text-text-muted text-xs mt-1">Handle cannot be changed</Text>
            </View>
          </View>

          {/* Push Notifications Section - Web only */}
          <PushNotificationToggle />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
