/**
 * Avatar URL utilities
 *
 * Bluesky CDN supports thumbnail URLs for optimized loading.
 * Instead of loading full-size avatars, we can request smaller versions.
 */

/**
 * Get optimized avatar URL for display size
 *
 * Bluesky CDN patterns:
 * - Full: https://cdn.bsky.app/img/avatar/plain/{did}/{cid}@jpeg
 * - Thumb: https://cdn.bsky.app/img/avatar_thumbnail/plain/{did}/{cid}@jpeg
 *
 * @param avatarUrl - Original avatar URL from API
 * @param size - Display size in pixels (for deciding quality)
 * @returns Optimized URL or original if not a Bluesky CDN URL
 */
export function getAvatarUrl(
  avatarUrl: string | undefined,
  size: 'thumb' | 'full' = 'thumb'
): string | undefined {
  if (!avatarUrl) return undefined;

  // Check if it's a Bluesky CDN URL
  if (avatarUrl.includes('cdn.bsky.app/img/avatar/')) {
    if (size === 'thumb') {
      // Convert to thumbnail URL
      return avatarUrl.replace('/img/avatar/', '/img/avatar_thumbnail/');
    }
  }

  return avatarUrl;
}

/**
 * Get avatar URL based on display size in pixels
 * Uses thumbnail for small sizes, full for large
 *
 * @param avatarUrl - Original avatar URL
 * @param displaySize - Size avatar will be displayed at (in pixels)
 * @returns Optimized URL or undefined if no avatar
 */
export function getOptimizedAvatarUrl(
  avatarUrl: string | undefined,
  displaySize: number
): string | undefined {
  // Use thumbnail for avatars displayed at <= 64px
  // Use full for larger displays (profile headers, etc.)
  const quality = displaySize <= 64 ? 'thumb' : 'full';
  return getAvatarUrl(avatarUrl, quality);
}

/**
 * Get optimized avatar URL with automatic fallback
 * Always returns a valid URL - never undefined
 *
 * @param avatarUrl - Original avatar URL (may be undefined)
 * @param displayName - Name to use for fallback initials
 * @param displaySize - Size avatar will be displayed at (in pixels)
 * @returns Always returns a valid avatar URL
 */
export function getOptimizedAvatarWithFallback(
  avatarUrl: string | undefined,
  displayName: string,
  displaySize: number
): string {
  const quality = displaySize <= 64 ? 'thumb' : 'full';
  return getAvatarUrl(avatarUrl, quality) || getFallbackAvatarUrl(displayName);
}

/**
 * Get fallback avatar URL using ui-avatars.com
 * Used when user has no avatar set
 *
 * @param name - Display name or handle to generate initials from
 * @param bgColor - Background color hex (without #), defaults to primary green
 * @returns Fallback avatar URL
 */
export function getFallbackAvatarUrl(name: string, bgColor: string = '10B981'): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=${bgColor}&color=fff`;
}

/**
 * Get avatar URL with automatic fallback
 * Combines getAvatarUrl with getFallbackAvatarUrl
 *
 * @param avatarUrl - Avatar URL from API (may be undefined)
 * @param displayName - Name to use for fallback
 * @param size - Size variant
 * @returns Avatar URL (always returns a valid URL)
 */
export function getAvatarWithFallback(
  avatarUrl: string | undefined,
  displayName: string,
  size: 'thumb' | 'full' = 'thumb'
): string {
  return getAvatarUrl(avatarUrl, size) || getFallbackAvatarUrl(displayName);
}
