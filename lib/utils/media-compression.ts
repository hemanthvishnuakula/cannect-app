/**
 * Media Compression Utilities
 *
 * Unified compression for images to fit AT Protocol limits.
 * Used by Compose and Edit Profile screens.
 */

import * as ImageManipulator from 'expo-image-manipulator';

// AT Protocol limits
export const MAX_IMAGE_SIZE_BYTES = 1000000; // 1MB per image
export const MAX_AVATAR_SIZE_BYTES = 1000000; // 1MB for avatar/banner

/**
 * Compress an image for post embeds
 * Silently resizes and reduces quality until under 1MB
 *
 * @param uri - Local URI of the image
 * @returns Compressed image URI and mimeType
 */
export async function compressImageForPost(uri: string): Promise<{ uri: string; mimeType: string }> {
  const maxDimension = 1500;
  let quality = 0.9;

  // First pass: resize to max dimension
  let result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxDimension, height: maxDimension } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Check file size and reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();

  while (blob.size > MAX_IMAGE_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1;
    result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxDimension, height: maxDimension } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );
    response = await fetch(result.uri);
    blob = await response.blob();
  }

  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/**
 * Compress an avatar image (square, smaller dimensions)
 * Center-crops to square, then resizes and compresses
 *
 * @param uri - Local URI of the image
 * @param originalWidth - Original image width
 * @param originalHeight - Original image height
 * @returns Compressed image URI and mimeType
 */
export async function compressAvatar(
  uri: string,
  originalWidth?: number,
  originalHeight?: number
): Promise<{ uri: string; mimeType: string }> {
  const maxDimension = 800;
  let quality = 0.9;

  const actions: ImageManipulator.Action[] = [];

  // Center-crop to square if dimensions provided
  if (originalWidth && originalHeight) {
    const size = Math.min(originalWidth, originalHeight);
    const originX = Math.floor((originalWidth - size) / 2);
    const originY = Math.floor((originalHeight - size) / 2);

    actions.push({
      crop: {
        originX,
        originY,
        width: size,
        height: size,
      },
    });
  }

  // Resize
  actions.push({ resize: { width: maxDimension, height: maxDimension } });

  // First pass
  let result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // Check file size and reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();

  while (blob.size > MAX_AVATAR_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1;
    result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    response = await fetch(result.uri);
    blob = await response.blob();
  }

  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/**
 * Compress a banner image (wide aspect ratio)
 *
 * @param uri - Local URI of the image
 * @returns Compressed image URI and mimeType
 */
export async function compressBanner(uri: string): Promise<{ uri: string; mimeType: string }> {
  const maxWidth = 1500;
  let quality = 0.9;

  // First pass: resize
  let result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Check file size and reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();

  while (blob.size > MAX_AVATAR_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1;
    result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxWidth } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );
    response = await fetch(result.uri);
    blob = await response.blob();
  }

  return { uri: result.uri, mimeType: 'image/jpeg' };
}
