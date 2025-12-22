/**
 * ThreadControls - Bluesky-style Sort/View Controls
 * 
 * Based on: bluesky-social/social-app/src/screens/PostThread/ThreadOptions.tsx
 * 
 * Provides controls for:
 * - Sort: Hot / New / Old
 * - View: Linear / Tree (future)
 */

import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Flame, Clock, ArrowDown, ArrowUp, List, GitBranch } from 'lucide-react-native';
import type { ThreadSort, ThreadView } from '@/lib/hooks/use-thread-preferences';

interface ThreadControlsProps {
  sort: ThreadSort;
  onSortChange: (sort: ThreadSort) => void;
  view?: ThreadView;
  onViewChange?: (view: ThreadView) => void;
  /** Whether to show the view toggle (tree/linear) */
  showViewToggle?: boolean;
}

const SORT_OPTIONS: { value: ThreadSort; label: string; icon: React.ReactNode }[] = [
  { 
    value: 'hotness', 
    label: 'Hot', 
    icon: <Flame size={14} color="#FAFAFA" /> 
  },
  { 
    value: 'newest', 
    label: 'New', 
    icon: <ArrowDown size={14} color="#FAFAFA" /> 
  },
  { 
    value: 'oldest', 
    label: 'Old', 
    icon: <ArrowUp size={14} color="#FAFAFA" /> 
  },
];

export const ThreadControls = memo(function ThreadControls({
  sort,
  onSortChange,
  view = 'linear',
  onViewChange,
  showViewToggle = false,
}: ThreadControlsProps) {
  return (
    <View style={styles.container}>
      {/* Sort Controls */}
      <View style={styles.sortContainer}>
        <Text style={styles.label}>Sort</Text>
        <View style={styles.pillGroup}>
          {SORT_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => onSortChange(option.value)}
              style={[
                styles.pill,
                sort === option.value && styles.pillActive,
              ]}
            >
              {option.icon}
              <Text style={[
                styles.pillText,
                sort === option.value && styles.pillTextActive,
              ]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* View Controls (optional) */}
      {showViewToggle && onViewChange && (
        <View style={styles.viewContainer}>
          <Pressable
            onPress={() => onViewChange('linear')}
            style={[
              styles.viewButton,
              view === 'linear' && styles.viewButtonActive,
            ]}
          >
            <List size={16} color={view === 'linear' ? '#10B981' : '#888'} />
          </Pressable>
          <Pressable
            onPress={() => onViewChange('tree')}
            style={[
              styles.viewButton,
              view === 'tree' && styles.viewButtonActive,
            ]}
          >
            <GitBranch size={16} color={view === 'tree' ? '#10B981' : '#888'} />
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
    backgroundColor: '#000',
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  pillGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1A1A1A',
  },
  pillActive: {
    backgroundColor: '#10B981',
  },
  pillText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  pillTextActive: {
    color: '#FAFAFA',
  },
  viewContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  viewButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
  },
  viewButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
});

export default ThreadControls;
