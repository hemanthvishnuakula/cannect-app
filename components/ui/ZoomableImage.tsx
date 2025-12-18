import React, { useState } from 'react';
import { StyleSheet, Dimensions, View, Text } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { ImageOff } from 'lucide-react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Zoom limits
const MIN_SCALE = 1;
const MAX_SCALE = 5;

interface ZoomableImageProps {
  uri: string;
  onSwipeDown?: () => void;
}

export function ZoomableImage({ uri, onSwipeDown }: ZoomableImageProps) {
  const [hasError, setHasError] = useState(false);
  // Scale values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  
  // Translation values for panning when zoomed
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Pinch gesture for zooming
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const newScale = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(newScale, MIN_SCALE * 0.5), MAX_SCALE);
    })
    .onEnd(() => {
      // Spring back if below minimum
      if (scale.value < MIN_SCALE) {
        scale.value = withTiming(MIN_SCALE);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
      // Clamp to maximum
      if (scale.value > MAX_SCALE) {
        scale.value = withTiming(MAX_SCALE);
      }
      savedScale.value = scale.value;
    });

  // Pan gesture for moving zoomed image with boundary limits
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // ✅ Fix: Add boundary constraints to prevent panning off-screen
        const maxTranslateX = (scale.value - 1) * SCREEN_WIDTH / 2;
        const maxTranslateY = (scale.value - 1) * SCREEN_HEIGHT / 2;
        
        translateX.value = Math.max(
          -maxTranslateX,
          Math.min(maxTranslateX, savedTranslateX.value + e.translationX)
        );
        translateY.value = Math.max(
          -maxTranslateY,
          Math.min(maxTranslateY, savedTranslateY.value + e.translationY)
        );
      } else if (e.translationY > 50 && Math.abs(e.translationX) < 50 && onSwipeDown) {
        // Swipe down to dismiss when not zoomed
        runOnJS(onSwipeDown)();
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Double tap to zoom in/out
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onStart((e) => {
      if (scale.value > 1) {
        // Zoom out
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Zoom in to 2.5x at tap point
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  // Compose gestures - pinch and pan work simultaneously
  const composedGesture = Gesture.Simultaneous(
    pinchGesture,
    Gesture.Race(doubleTapGesture, panGesture)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  // ✅ Error fallback for broken images
  if (hasError) {
    return (
      <View style={styles.errorContainer}>
        <ImageOff size={48} color="#6B7280" />
        <Text style={styles.errorText}>Image unavailable</Text>
      </View>
    );
  }

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.container, animatedStyle]}>
        <Image
          source={uri}
          style={styles.image}
          contentFit="contain"
          priority="high"
          transition={300}
          onError={() => setHasError(true)}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  errorContainer: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  errorText: {
    color: '#6B7280',
    fontSize: 14,
    marginTop: 12,
  },
});
