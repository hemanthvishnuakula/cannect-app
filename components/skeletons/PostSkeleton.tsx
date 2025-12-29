/**
 * Post Skeletons
 *
 * Loading placeholders for posts and feed lists.
 */

import { View } from 'react-native';
import { Skeleton, SkeletonAvatar } from './Skeleton';

/**
 * PostSkeleton - Animated loading placeholder matching PostCard layout
 * 
 * Uses minHeight: 120 to match PostCard's fixed minimum height.
 */
export function PostSkeleton() {
  return (
    <View style={{ minHeight: 120 }} className="px-4 py-3 border-b border-border">
      <View className="flex-row">
        {/* Avatar skeleton */}
        <Skeleton width={40} height={40} radius="full" />
        <View className="flex-1 ml-3">
          {/* Header skeleton - name + time */}
          <View className="flex-row items-center mb-1">
            <Skeleton width={96} height={16} radius="sm" />
            <View className="mx-2">
              <Skeleton width={12} height={12} radius="full" />
            </View>
            <Skeleton width={32} height={12} radius="sm" />
          </View>
          {/* Handle skeleton */}
          <Skeleton width={128} height={12} radius="sm" className="mb-2" />
          {/* Text content skeleton - 2-3 lines */}
          <Skeleton width="100%" height={16} radius="sm" className="mb-1" />
          <Skeleton width="92%" height={16} radius="sm" className="mb-1" />
          <Skeleton width="75%" height={16} radius="sm" className="mb-3" />
          {/* Action bar skeleton */}
          <View className="flex-row justify-between pr-8 mt-1">
            <Skeleton width={40} height={20} radius="sm" />
            <Skeleton width={40} height={20} radius="sm" />
            <Skeleton width={40} height={20} radius="sm" />
            <Skeleton width={20} height={20} radius="sm" />
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * FeedSkeleton - Multiple PostSkeletons for initial feed loading
 */
export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <PostSkeleton key={i} />
      ))}
    </View>
  );
}

/**
 * ThreadPostSkeleton - Loading state for thread main post
 */
export function ThreadPostSkeleton() {
  return (
    <View className="px-4">
      {/* Author skeleton */}
      <View className="flex-row items-center mb-4">
        <SkeletonAvatar size={48} />
        <View className="ml-3 flex-1">
          <Skeleton width={128} height={16} radius="sm" className="mb-1" />
          <Skeleton width={96} height={12} radius="sm" />
        </View>
      </View>

      {/* Content skeleton */}
      <Skeleton width="100%" height={20} radius="sm" className="mb-2" />
      <Skeleton width="100%" height={20} radius="sm" className="mb-2" />
      <Skeleton width="75%" height={20} radius="sm" className="mb-4" />

      {/* Image skeleton */}
      <Skeleton width="100%" height={192} radius="xl" className="mb-4" />

      {/* Timestamp skeleton */}
      <Skeleton width={160} height={12} radius="sm" className="mb-4" />

      {/* Stats skeleton */}
      <View className="flex-row border-t border-b border-border py-3 mb-4">
        <Skeleton width={80} height={16} radius="sm" className="mr-4" />
        <Skeleton width={64} height={16} radius="sm" className="mr-4" />
        <Skeleton width={64} height={16} radius="sm" />
      </View>

      {/* Actions skeleton */}
      <View className="flex-row justify-around py-2 border-b border-border mb-4">
        <Skeleton width={24} height={24} radius="sm" />
        <Skeleton width={24} height={24} radius="sm" />
        <Skeleton width={24} height={24} radius="sm" />
        <Skeleton width={24} height={24} radius="sm" />
      </View>
    </View>
  );
}
