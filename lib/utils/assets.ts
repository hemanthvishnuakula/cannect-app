/**
 * ✅ Gold Standard Asset Guard
 * Standardizes aspect ratios to prevent layout shifting.
 * Ensures vertical connector lines in Infinite Pivot threads stay aligned.
 */

export const ASSET_RATIOS = {
  SQUARE: 1,
  VIDEO: 16 / 9,
  PORTRAIT: 4 / 5,
  WIDE: 2.35 / 1,
} as const;

/**
 * BlurHash placeholder STRINGS for contexts that need raw values.
 * Use BLURHASH_PLACEHOLDERS for expo-image placeholder prop.
 */
export const BLURHASH_STRINGS = {
  NEUTRAL: "L00000fQfQfQfQfQfQfQfQfQfQfQ",
  GLOBAL: "L03+~pfQfQfQfQfQfQfQfQfQfQfQ",
  CANNECT: "L02rs:fQfQfQfQfQfQfQfQfQfQfQ",
} as const;

/**
 * BlurHash placeholders for expo-image's placeholder prop.
 * These are objects ready to be passed directly - no wrapping needed!
 * 
 * Usage: <Image placeholder={BLURHASH_PLACEHOLDERS.NEUTRAL} />
 */
export const BLURHASH_PLACEHOLDERS = {
  // Neutral dark gray gradient - works with any content (matches #0A0A0A background)
  NEUTRAL: { blurhash: BLURHASH_STRINGS.NEUTRAL },
  // Slightly blue tint - ideal for Global federated content
  GLOBAL: { blurhash: BLURHASH_STRINGS.GLOBAL },
  // Greenish tint - matches Cannect branding (#10B981)
  CANNECT: { blurhash: BLURHASH_STRINGS.CANNECT },
} as const;

/**
 * Determines optimal aspect ratio based on media count.
 * Single images get 16:9 (VIDEO), multiple get 1:1 (SQUARE) for grid layout.
 */
export function getOptimalRatio(mediaCount: number = 0): number {
  if (mediaCount >= 2) return ASSET_RATIOS.SQUARE; // Grid style for multiple images
  return ASSET_RATIOS.VIDEO; // Default for single images/previews
}

/**
 * Selects appropriate blurhash placeholder based on content origin.
 * Returns object ready for expo-image placeholder prop.
 */
export function getPlaceholder(isFederated: boolean = false) {
  return isFederated ? BLURHASH_PLACEHOLDERS.GLOBAL : BLURHASH_PLACEHOLDERS.NEUTRAL;
}
