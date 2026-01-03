import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Pressable,
  Text,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Image as RNImage,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus, Audio } from 'expo-av';
import { Play, Pause, Volume2, VolumeX, Maximize2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface VideoPlayerProps {
  url: string;
  thumbnailUrl?: string;
  aspectRatio?: number;
  shouldPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  onFullscreen?: () => void;
  /** If true, video loads immediately. If false (default), shows thumbnail until tapped. */
  autoLoad?: boolean;
}

export function VideoPlayer({
  url,
  thumbnailUrl,
  aspectRatio = 16 / 9,
  shouldPlay: _shouldPlay = false,
  muted: initialMuted = true,
  loop = true,
  onFullscreen,
  autoLoad = false, // Default to NOT loading video until user taps
}: VideoPlayerProps) {
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState<AVPlaybackStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Video still processing
  const [showControls, setShowControls] = useState(true);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [isMounted, setIsMounted] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(autoLoad); // Only load video when user taps

  // Derived state (moved before hooks that depend on them)
  const isPlaying = status?.isLoaded && status.isPlaying;
  const progress = status?.isLoaded
    ? (status.positionMillis / (status.durationMillis || 1)) * 100
    : 0;
  const duration = status?.isLoaded ? status.durationMillis || 0 : 0;
  const position = status?.isLoaded ? status.positionMillis || 0 : 0;

  // Progress bar animation - ALL HOOKS MUST BE CALLED BEFORE ANY RETURN
  const progressWidth = useSharedValue(0);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  // =====================================================
  // ALL HOOKS MUST BE BEFORE ANY EARLY RETURNS
  // =====================================================

  // ✅ Fix hydration mismatch - Reanimated hooks cause SSR issues
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Enable audio in silent mode (standard social media behavior)
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  }, []);

  useEffect(() => {
    progressWidth.value = withTiming(progress, { duration: 100 });
  }, [progress]);

  // Auto-hide controls after 3 seconds of playing
  useEffect(() => {
    if (isPlaying && showControls) {
      const timer = setTimeout(() => setShowControls(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isPlaying, showControls]);

  // Handlers (useCallback hooks must also be before early returns)
  const handlePlayPause = useCallback(async () => {
    if (!videoRef.current) return;

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
  }, [isPlaying]);

  const handleMuteToggle = useCallback(async () => {
    if (!videoRef.current) return;

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const newMuted = !isMuted;
    setIsMuted(newMuted);
    await videoRef.current.setIsMutedAsync(newMuted);
  }, [isMuted]);

  const handlePress = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  // Handler to load video on first tap (lazy loading)
  const handleLoadVideo = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setIsVideoLoaded(true);
  }, []);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // =====================================================
  // EARLY RETURNS (after all hooks)
  // =====================================================

  // Return static fallback during SSR to prevent hydration mismatch
  if (Platform.OS === 'web' && !isMounted) {
    return (
      <View
        className="relative rounded-xl overflow-hidden bg-black items-center justify-center"
        style={{ aspectRatio }}
      >
        {thumbnailUrl && (
          <RNImage
            source={{ uri: thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <Play size={48} color="#FFFFFF" />
        </View>
      </View>
    );
  }

  // =====================================================
  // Render
  // =====================================================

  if (hasError) {
    return (
      <View className="bg-surface items-center justify-center rounded-xl" style={{ aspectRatio }}>
        <Text className="text-text-muted">Failed to load video</Text>
      </View>
    );
  }

  if (isProcessing) {
    return (
      <View className="bg-surface items-center justify-center rounded-xl" style={{ aspectRatio }}>
        <ActivityIndicator size="small" color="#10B981" />
        <Text className="text-text-muted mt-2">Video is processing...</Text>
      </View>
    );
  }

  // Stop event propagation to prevent parent PostCard from intercepting taps
  const stopEvent = (e: { stopPropagation: () => void }) => e.stopPropagation();

  // Show thumbnail with play button until user taps (lazy loading to save resources)
  if (!isVideoLoaded) {
    return (
      <Pressable
        onPress={handleLoadVideo}
        onPressIn={stopEvent}
        className="relative rounded-xl overflow-hidden bg-black items-center justify-center"
        style={{ aspectRatio }}
      >
        {thumbnailUrl && (
          <RNImage
            source={{ uri: thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
        <View className="absolute inset-0 items-center justify-center bg-black/40">
          <View className="bg-black/60 rounded-full p-4">
            <Play size={32} color="white" fill="white" />
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={stopEvent}
      className="relative rounded-xl overflow-hidden bg-black"
      style={{ aspectRatio }}
    >
      {/* Video - autoplay since user explicitly tapped to load */}
      <Video
        ref={videoRef}
        source={{ uri: url }}
        posterSource={thumbnailUrl ? { uri: thumbnailUrl } : undefined}
        usePoster={!!thumbnailUrl}
        posterStyle={{ resizeMode: 'cover' }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={true} // Autoplay since user tapped to load
        isMuted={isMuted}
        isLooping={loop}
        onPlaybackStatusUpdate={(s) => {
          setStatus(s);
          if (s.isLoaded) setIsLoading(false);
        }}
        onError={(error) => {
          console.log('[VideoPlayer] HLS not ready, video is processing');
          // HLS not available yet = video still processing
          setIsProcessing(true);
        }}
      />

      {/* Loading Spinner */}
      {isLoading && (
        <View className="absolute inset-0 items-center justify-center bg-black/20">
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      )}

      {/* Controls Overlay */}
      {showControls && !isLoading && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          className="absolute inset-0"
        >
          {/* Gradient overlay */}
          <View className="absolute inset-0 bg-black/20" />

          {/* Center Play/Pause */}
          <Pressable
            onPress={handlePlayPause}
            className="absolute inset-0 items-center justify-center"
          >
            <View className="bg-black/60 rounded-full p-4">
              {isPlaying ? (
                <Pause size={32} color="white" fill="white" />
              ) : (
                <Play size={32} color="white" fill="white" />
              )}
            </View>
          </Pressable>

          {/* Bottom Controls */}
          <View className="absolute bottom-0 left-0 right-0 px-3 pb-3">
            {/* Progress Bar */}
            <View className="h-1 bg-white/30 rounded-full mb-2 overflow-hidden">
              <Animated.View className="h-full bg-primary rounded-full" style={progressStyle} />
            </View>

            {/* Controls Row */}
            <View className="flex-row items-center justify-between">
              {/* Time */}
              <Text className="text-white text-xs font-medium">
                {formatTime(position)} / {formatTime(duration)}
              </Text>

              {/* Right Controls */}
              <View className="flex-row items-center gap-3">
                {/* Mute Toggle */}
                <Pressable onPress={handleMuteToggle} hitSlop={8}>
                  {isMuted ? (
                    <VolumeX size={18} color="white" />
                  ) : (
                    <Volume2 size={18} color="white" />
                  )}
                </Pressable>

                {/* Fullscreen */}
                {onFullscreen && (
                  <Pressable onPress={onFullscreen} hitSlop={8}>
                    <Maximize2 size={18} color="white" />
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}
