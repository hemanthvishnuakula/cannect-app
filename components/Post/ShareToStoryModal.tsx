/**
 * ShareToStoryModal - Modal for sharing posts to Instagram Stories
 *
 * Uses server-generated images for consistent rendering.
 * Flow:
 * 1. Show loading while fetching image from server
 * 2. Preview the generated image
 * 3. One button: "Save & Share"
 */

import { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, Modal, Platform, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { X, Share2, Download, RefreshCw } from 'lucide-react-native';
import { triggerImpact, triggerNotification } from '@/lib/utils/haptics';
import type { AppBskyFeedDefs } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;

// Server endpoint for story images
const STORY_IMAGE_API = 'https://feed.cannect.space/api/story-image';

interface ShareToStoryModalProps {
  visible: boolean;
  onClose: () => void;
  post: PostView;
}

export function ShareToStoryModal({ visible, onClose, post }: ShareToStoryModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  // Generate the story image URL
  const storyImageUrl = `${STORY_IMAGE_API}?uri=${encodeURIComponent(post.uri)}`;

  // Load image when modal opens
  useEffect(() => {
    if (visible) {
      setIsLoading(true);
      setError(null);
      setImageUrl(storyImageUrl);
    } else {
      setImageUrl(null);
    }
  }, [visible, storyImageUrl]);

  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setError('Failed to generate image');
  }, []);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    // Add cache buster
    setImageUrl(`${storyImageUrl}&t=${Date.now()}`);
  }, [storyImageUrl]);

  const handleSaveAndShare = useCallback(async () => {
    if (!imageUrl) return;

    setIsSharing(true);
    triggerImpact('medium');

    try {
      if (Platform.OS === 'web') {
        // Web: Fetch image as blob and download directly
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error('Failed to fetch image');
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `cannect-post-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up blob URL
        URL.revokeObjectURL(blobUrl);

        triggerNotification('success');
        onClose();
      } else {
        // Mobile: Download to temp file and share
        const filename = `cannect-story-${Date.now()}.png`;
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;

        // Download the image
        const downloadResult = await FileSystem.downloadAsync(imageUrl, fileUri);

        if (downloadResult.status !== 200) {
          throw new Error('Failed to download image');
        }

        // Check if sharing is available
        const isAvailable = await Sharing.isAvailableAsync();

        if (isAvailable) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share to Instagram Stories',
            UTI: 'public.png',
          });
          triggerNotification('success');
        } else {
          Alert.alert('Sharing not available', 'Please take a screenshot to share manually.');
        }

        onClose();
      }
    } catch (err) {
      console.error('[ShareToStory] Share failed:', err);
      triggerNotification('error');
      if (Platform.OS === 'web') {
        window.alert('Failed to download image. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to share image. Please try again.');
      }
    } finally {
      setIsSharing(false);
    }
  }, [imageUrl, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/90 justify-center items-center px-4">
        {/* Close button */}
        <Pressable
          onPress={onClose}
          className="absolute top-12 right-4 w-10 h-10 items-center justify-center rounded-full bg-zinc-800"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <X size={24} color="#FAFAFA" />
        </Pressable>

        {/* Title */}
        <Text className="text-text-primary text-lg font-semibold mb-4">Share to Stories</Text>

        {/* Image Preview */}
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            width: 270,
            height: 480,
            shadowColor: '#10B981',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
            elevation: 10,
            backgroundColor: '#18181B',
          }}
        >
          {error ? (
            <View className="flex-1 items-center justify-center px-4">
              <Text className="text-red-400 text-center mb-4">{error}</Text>
              <Pressable
                onPress={handleRetry}
                className="flex-row items-center px-4 py-2 bg-zinc-700 rounded-full"
              >
                <RefreshCw size={16} color="#FAFAFA" />
                <Text className="text-white ml-2">Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {imageUrl && (
                <Image
                  source={{ uri: imageUrl }}
                  style={{ width: 270, height: 480 }}
                  contentFit="contain"
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              )}
              {isLoading && (
                <View className="absolute inset-0 items-center justify-center bg-zinc-900">
                  <ActivityIndicator size="large" color="#10B981" />
                  <Text className="text-text-muted mt-3">Generating image...</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Action Button */}
        {!error && !isLoading && (
          <Pressable
            onPress={handleSaveAndShare}
            disabled={isSharing}
            className="mt-6 flex-row items-center justify-center px-8 py-4 rounded-full"
            style={{
              backgroundColor: isSharing ? '#3f3f46' : '#10B981',
              minWidth: 200,
            }}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#FAFAFA" />
            ) : (
              <>
                {Platform.OS === 'web' ? (
                  <Download size={20} color="#FAFAFA" />
                ) : (
                  <Share2 size={20} color="#FAFAFA" />
                )}
                <Text className="text-white text-base font-semibold ml-2">
                  {Platform.OS === 'web' ? 'Download Image' : 'Save & Share'}
                </Text>
              </>
            )}
          </Pressable>
        )}

        {/* Helper text */}
        {!error && !isLoading && (
          <Text className="text-text-muted text-xs mt-4 text-center">
            {Platform.OS === 'web'
              ? 'Image will download, then upload to Instagram Stories'
              : 'Opens share menu to post to Instagram Stories'}
          </Text>
        )}
      </View>
    </Modal>
  );
}
