/**
 * ThreadSkeleton - Loading skeleton for thread view
 * 
 * Shows:
 * - Ancestor placeholders
 * - Focused post placeholder
 * - Reply placeholders
 */

import React, { memo, useState, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, { 
  useAnimatedStyle, 
  withRepeat, 
  withTiming,
  useSharedValue,
  withDelay,
} from 'react-native-reanimated';

const SkeletonBox = memo(function SkeletonBox({ 
  width, 
  height, 
  borderRadius = 4,
  delay = 0,
  isMounted = true,
}: { 
  width: number | string; 
  height: number; 
  borderRadius?: number;
  delay?: number;
  isMounted?: boolean;
}) {
  const opacity = useSharedValue(0.3);

  // All hooks must be called unconditionally before any returns
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  useEffect(() => {
    if (!isMounted) return;
    opacity.value = withDelay(
      delay,
      withRepeat(
        withTiming(0.7, { duration: 800 }),
        -1,
        true
      )
    );
  }, [isMounted, delay, opacity]);

  // Static fallback for SSR/hydration
  if (!isMounted) {
    return (
      <View
        style={[
          styles.skeleton,
          { 
            width: width as any, 
            height, 
            borderRadius,
            opacity: 0.3,
          },
        ]}
      />
    );
  }

  return (
    <Animated.View
      style={[
        styles.skeleton,
        animatedStyle,
        { 
          width: width as any, 
          height, 
          borderRadius,
        },
      ]}
    />
  );
});

const AncestorSkeleton = memo(function AncestorSkeleton({ delay, isMounted }: { delay: number; isMounted: boolean }) {
  return (
    <View style={styles.ancestorContainer}>
      <View style={styles.leftColumn}>
        <SkeletonBox width={32} height={32} borderRadius={16} delay={delay} isMounted={isMounted} />
        <View style={styles.skeletonLine} />
      </View>
      <View style={styles.ancestorContent}>
        <View style={styles.headerRow}>
          <SkeletonBox width={100} height={14} delay={delay + 50} isMounted={isMounted} />
          <SkeletonBox width={60} height={12} delay={delay + 100} isMounted={isMounted} />
        </View>
        <SkeletonBox width="90%" height={14} delay={delay + 150} isMounted={isMounted} />
      </View>
    </View>
  );
});

const FocusedSkeleton = memo(function FocusedSkeleton({ isMounted }: { isMounted: boolean }) {
  return (
    <View style={styles.focusedContainer}>
      {/* Author */}
      <View style={styles.focusedAuthor}>
        <SkeletonBox width={48} height={48} borderRadius={24} delay={200} isMounted={isMounted} />
        <View style={styles.focusedAuthorInfo}>
          <SkeletonBox width={120} height={17} delay={250} isMounted={isMounted} />
          <SkeletonBox width={80} height={14} delay={300} isMounted={isMounted} />
        </View>
      </View>

      {/* Content */}
      <View style={styles.focusedContent}>
        <SkeletonBox width="100%" height={18} delay={350} isMounted={isMounted} />
        <SkeletonBox width="85%" height={18} delay={400} isMounted={isMounted} />
        <SkeletonBox width="60%" height={18} delay={450} isMounted={isMounted} />
      </View>

      {/* Timestamp */}
      <View style={styles.focusedTimestamp}>
        <SkeletonBox width={150} height={14} delay={500} isMounted={isMounted} />
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <SkeletonBox width={60} height={14} delay={550} isMounted={isMounted} />
        <SkeletonBox width={50} height={14} delay={600} isMounted={isMounted} />
      </View>

      {/* Actions */}
      <View style={styles.actionRow}>
        <SkeletonBox width={24} height={24} borderRadius={12} delay={650} isMounted={isMounted} />
        <SkeletonBox width={24} height={24} borderRadius={12} delay={700} isMounted={isMounted} />
        <SkeletonBox width={24} height={24} borderRadius={12} delay={750} isMounted={isMounted} />
        <SkeletonBox width={24} height={24} borderRadius={12} delay={800} isMounted={isMounted} />
      </View>
    </View>
  );
});

const ReplySkeleton = memo(function ReplySkeleton({ delay, isMounted }: { delay: number; isMounted: boolean }) {
  return (
    <View style={styles.replyContainer}>
      <SkeletonBox width={36} height={36} borderRadius={18} delay={delay} isMounted={isMounted} />
      <View style={styles.replyContent}>
        <View style={styles.headerRow}>
          <SkeletonBox width={80} height={14} delay={delay + 50} isMounted={isMounted} />
          <SkeletonBox width={50} height={12} delay={delay + 100} isMounted={isMounted} />
        </View>
        <SkeletonBox width="95%" height={15} delay={delay + 150} isMounted={isMounted} />
        <SkeletonBox width="70%" height={15} delay={delay + 200} isMounted={isMounted} />
        <View style={styles.replyActions}>
          <SkeletonBox width={40} height={12} delay={delay + 250} isMounted={isMounted} />
          <SkeletonBox width={40} height={12} delay={delay + 300} isMounted={isMounted} />
          <SkeletonBox width={40} height={12} delay={delay + 350} isMounted={isMounted} />
        </View>
      </View>
    </View>
  );
});

export const ThreadSkeleton = memo(function ThreadSkeleton() {
  // Hydration safety: don't animate until mounted on client
  const [isMounted, setIsMounted] = useState(Platform.OS !== 'web');
  
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsMounted(true);
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Ancestors */}
      <AncestorSkeleton delay={0} isMounted={isMounted} />
      <AncestorSkeleton delay={100} isMounted={isMounted} />

      {/* Focused Post */}
      <FocusedSkeleton isMounted={isMounted} />

      {/* Reply Divider */}
      <View style={styles.divider}>
        <SkeletonBox width={80} height={15} delay={850} isMounted={isMounted} />
      </View>

      {/* Replies */}
      <ReplySkeleton delay={900} isMounted={isMounted} />
      <ReplySkeleton delay={1000} isMounted={isMounted} />
      <ReplySkeleton delay={1100} isMounted={isMounted} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  skeleton: {
    backgroundColor: '#1A1A1A',
  },
  // Ancestor
  ancestorContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  leftColumn: {
    alignItems: 'center',
    marginRight: 12,
  },
  skeletonLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#1A1A1A',
    marginTop: 8,
    minHeight: 20,
  },
  ancestorContent: {
    flex: 1,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Focused
  focusedContainer: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    paddingBottom: 12,
  },
  focusedAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  focusedAuthorInfo: {
    marginLeft: 12,
    gap: 4,
  },
  focusedContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  focusedTimestamp: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    gap: 16,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
  },
  // Divider
  divider: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
  },
  // Reply
  replyContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  replyContent: {
    flex: 1,
    marginLeft: 12,
    gap: 6,
  },
  replyActions: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 8,
  },
});

export default ThreadSkeleton;
