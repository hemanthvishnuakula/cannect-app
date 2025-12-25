/**
 * Edit Profile Screen - Pure AT Protocol
 */

import { useState, useEffect } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Camera } from "lucide-react-native";
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useMyProfile, useUpdateProfile } from "@/lib/hooks";
import { useAuthStore } from "@/lib/stores";

export default function EditProfileScreen() {
  const { handle } = useAuthStore();
  const profileQuery = useMyProfile();
  const updateProfileMutation = useUpdateProfile();
  
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState<{ uri: string; mimeType: string } | null>(null);
  const [banner, setBanner] = useState<{ uri: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize form with current profile data
  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.displayName || "");
      setDescription(profileQuery.data.description || "");
    }
  }, [profileQuery.data]);

  const handlePickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatar({
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType || 'image/jpeg',
      });
    }
  };

  const handlePickBanner = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setBanner({
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType || 'image/jpeg',
      });
    }
  };

  const handleSave = async () => {
    setError(null);
    
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

      await updateProfileMutation.mutateAsync(update);

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      router.back();
    } catch (err: any) {
      setError(err.message || "Failed to update profile");
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  };

  const canSave = !updateProfileMutation.isPending;
  const currentAvatar = avatar?.uri || profileQuery.data?.avatar;
  const currentBanner = banner?.uri || profileQuery.data?.banner;

  if (profileQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#10B981" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"} 
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Pressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center">
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
            <View className="absolute inset-0 items-center justify-center bg-black/30">
              <Camera size={24} color="#fff" />
            </View>
          </Pressable>

          {/* Avatar */}
          <View className="px-4 -mt-12">
            <Pressable onPress={handlePickAvatar} className="relative">
              {currentAvatar ? (
                <Image 
                  source={{ uri: currentAvatar }} 
                  className="w-24 h-24 rounded-full border-4 border-background"
                />
              ) : (
                <View className="w-24 h-24 rounded-full border-4 border-background bg-surface-elevated items-center justify-center">
                  <Text className="text-text-muted text-3xl">
                    {(handle || '?')[0].toUpperCase()}
                  </Text>
                </View>
              )}
              <View className="absolute inset-0 items-center justify-center bg-black/30 rounded-full">
                <Camera size={20} color="#fff" />
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
              <Text className="text-text-muted text-xs mt-1">
                Handle cannot be changed
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
