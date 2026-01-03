/**
 * Media Compression Utilities
 *
 * Unified compression for images to fit AT Protocol limits.
 * Used by Compose and Edit Profile screens.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

// Conditional import for react-native-compressor (native only)
let VideoCompressor: typeof import('react-native-compressor').Video | null = null;
let getVideoMetaData: typeof import('react-native-compressor').getVideoMetaData | null = null;

if (Platform.OS !== 'web') {
  try {
    const compressor = require('react-native-compressor');
    VideoCompressor = compressor.Video;
    getVideoMetaData = compressor.getVideoMetaData;
  } catch (e) {
    console.warn('[Compress] react-native-compressor not available');
  }
}

// AT Protocol limits - using 950KB to have safety margin
export const MAX_IMAGE_SIZE_BYTES = 950000; // ~950KB (server limit is ~976KB)
export const MAX_AVATAR_SIZE_BYTES = 950000;

/**
 * Compress image using Canvas API (Web fallback)
 */
async function compressWithCanvas(
  uri: string,
  maxDimension: number,
  quality: number
): Promise<{ uri: string; size: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Calculate new dimensions maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ uri: dataUrl, size: blob.size });
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = uri;
  });
}

/**
 * Compress an image for post embeds
 * Silently resizes and reduces quality until under limit
 *
 * @param uri - Local URI of the image
 * @returns Compressed image URI and mimeType
 */
export async function compressImageForPost(
  uri: string
): Promise<{ uri: string; mimeType: string }> {
  console.log('[Compress] Starting compression for post image');

  // Use Canvas API directly on web for reliable compression
  if (Platform.OS === 'web') {
    let maxDimension = 1500;
    let quality = 0.85;

    try {
      let result = await compressWithCanvas(uri, maxDimension, quality);
      console.log('[Compress] Web initial: quality=', quality, 'size=', result.size);

      // Reduce quality until under limit
      while (result.size > MAX_IMAGE_SIZE_BYTES && quality > 0.1) {
        quality -= 0.1;
        result = await compressWithCanvas(uri, maxDimension, quality);
        console.log('[Compress] Web retry: quality=', quality.toFixed(1), 'size=', result.size);
      }

      // If still too large, also reduce dimensions
      while (result.size > MAX_IMAGE_SIZE_BYTES && maxDimension > 500) {
        maxDimension -= 200;
        quality = 0.7;
        result = await compressWithCanvas(uri, maxDimension, quality);
        console.log('[Compress] Web resize: dim=', maxDimension, 'size=', result.size);
      }

      console.log('[Compress] Web final size:', result.size, 'bytes');
      return { uri: result.uri, mimeType: 'image/jpeg' };
    } catch (error) {
      console.error('[Compress] Web compression failed:', error);
      // Fall through to ImageManipulator as backup
    }
  }

  // Native: use expo-image-manipulator
  const maxDimension = 1500;
  let quality = 0.85;

  // First pass: resize to max dimension (only width to maintain aspect ratio)
  let result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: maxDimension } }], {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // Check file size and reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();
  console.log('[Compress] Native initial: quality=', quality, 'size=', blob.size);

  while (blob.size > MAX_IMAGE_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1;
    result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: maxDimension } }], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    response = await fetch(result.uri);
    blob = await response.blob();
    console.log('[Compress] Native retry: quality=', quality.toFixed(1), 'size=', blob.size);
  }

  console.log('[Compress] Native final size:', blob.size, 'bytes');
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
  console.log('[Compress] Starting avatar compression');

  // Web: use Canvas API with square crop
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        // Calculate square crop
        const size = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - size) / 2);
        const sy = Math.floor((img.height - size) / 2);

        const maxDim = 800;
        const canvas = document.createElement('canvas');
        canvas.width = maxDim;
        canvas.height = maxDim;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw cropped square, scaled to maxDim
        ctx.drawImage(img, sx, sy, size, size, 0, 0, maxDim, maxDim);

        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let blob = await (await fetch(dataUrl)).blob();

        while (blob.size > MAX_AVATAR_SIZE_BYTES && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          blob = await (await fetch(dataUrl)).blob();
          console.log('[Compress] Avatar retry: quality=', quality.toFixed(1), 'size=', blob.size);
        }

        console.log('[Compress] Avatar final size:', blob.size, 'bytes');
        resolve({ uri: dataUrl, mimeType: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = uri;
    });
  }

  // Native: use expo-image-manipulator
  const maxDimension = 800;
  let quality = 0.85;

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
  actions.push({ resize: { width: maxDimension } });

  // First pass
  let result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // Check file size and reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();
  console.log('[Compress] Avatar initial: quality=', quality, 'size=', blob.size);

  while (blob.size > MAX_AVATAR_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1;
    result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    response = await fetch(result.uri);
    blob = await response.blob();
  }

  console.log('[Compress] Avatar final size:', blob.size, 'bytes');
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/**
 * Compress a banner image (wide aspect ratio)
 *
 * @param uri - Local URI of the image
 * @returns Compressed image URI and mimeType
 */
export async function compressBanner(uri: string): Promise<{ uri: string; mimeType: string }> {
  console.log('[Compress] Starting banner compression');

  // Web: use Canvas API
  if (Platform.OS === 'web') {
    let maxWidth = 1500;
    let quality = 0.85;

    try {
      let result = await compressWithCanvas(uri, maxWidth, quality);

      while (result.size > MAX_AVATAR_SIZE_BYTES && quality > 0.1) {
        quality -= 0.1;
        result = await compressWithCanvas(uri, maxWidth, quality);
        console.log('[Compress] Banner retry: quality=', quality.toFixed(1), 'size=', result.size);
      }

      // If still too large, reduce dimensions
      while (result.size > MAX_AVATAR_SIZE_BYTES && maxWidth > 800) {
        maxWidth -= 200;
        quality = 0.7;
        result = await compressWithCanvas(uri, maxWidth, quality);
      }

      console.log('[Compress] Banner final size:', result.size, 'bytes');
      return { uri: result.uri, mimeType: 'image/jpeg' };
    } catch (error) {
      console.error('[Compress] Banner web compression failed:', error);
    }
  }

  // Native: use expo-image-manipulator
  const maxWidth = 1500;
  let quality = 0.85;

  // First pass: resize
  let result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: maxWidth } }], {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // Check file size and reduce quality if needed
  let response = await fetch(result.uri);
  let blob = await response.blob();
  console.log('[Compress] Banner initial: quality=', quality, 'size=', blob.size);

  while (blob.size > MAX_AVATAR_SIZE_BYTES && quality > 0.1) {
    quality -= 0.1;
    result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: maxWidth } }], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    response = await fetch(result.uri);
    blob = await response.blob();
  }

  console.log('[Compress] Banner final size:', blob.size, 'bytes');
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

// ============================================================
// VIDEO COMPRESSION
// ============================================================

// Bluesky video limits
export const MAX_VIDEO_DURATION_SECONDS = 60;
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB practical limit

/**
 * Compress a video for posting
 * Uses WhatsApp-style compression for optimal quality/size balance
 *
 * @param uri - Local URI of the video
 * @param onProgress - Optional callback for compression progress (0-1)
 * @returns Compressed video URI and metadata
 */
export async function compressVideoForPost(
  uri: string,
  onProgress?: (progress: number) => void
): Promise<{
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
}> {
  console.log('[Compress] Starting video compression');

  // Web doesn't support video compression - return as-is
  if (Platform.OS === 'web') {
    console.log('[Compress] Web platform - skipping video compression');
    return { uri, mimeType: 'video/mp4' };
  }

  // Check if compressor is available
  if (!VideoCompressor || !getVideoMetaData) {
    console.log('[Compress] Video compressor not available - skipping');
    return { uri, mimeType: 'video/mp4' };
  }

  try {
    // Get original video metadata
    const metadata = await getVideoMetaData(uri);
    console.log('[Compress] Original video:', {
      size: `${(metadata.size / 1024 / 1024).toFixed(2)}MB`,
      duration: `${metadata.duration?.toFixed(1)}s`,
      dimensions: `${metadata.width}x${metadata.height}`,
    });

    // Check duration limit
    if (metadata.duration && metadata.duration > MAX_VIDEO_DURATION_SECONDS) {
      throw new Error(`Video is too long. Maximum is ${MAX_VIDEO_DURATION_SECONDS} seconds.`);
    }

    // Compress using WhatsApp-style auto compression
    const compressedUri = await VideoCompressor.compress(
      uri,
      {
        compressionMethod: 'auto', // WhatsApp-style compression
        minimumFileSizeForCompress: 5, // Only compress if > 5MB
      },
      (progress: number) => {
        console.log('[Compress] Video progress:', Math.round(progress * 100) + '%');
        onProgress?.(progress);
      }
    );

    // Get compressed video metadata
    const compressedMetadata = await getVideoMetaData(compressedUri);
    const savings = ((1 - compressedMetadata.size / metadata.size) * 100).toFixed(1);
    console.log('[Compress] Compressed video:', {
      size: `${(compressedMetadata.size / 1024 / 1024).toFixed(2)}MB`,
      dimensions: `${compressedMetadata.width}x${compressedMetadata.height}`,
      savings: `${savings}%`,
    });

    return {
      uri: compressedUri,
      mimeType: 'video/mp4',
      width: compressedMetadata.width,
      height: compressedMetadata.height,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Compress] Video compression failed:', errorMessage);

    // If it's a duration error, re-throw it
    if (errorMessage.includes('too long')) {
      throw error;
    }

    // Otherwise return original video
    console.log('[Compress] Falling back to original video');
    return { uri, mimeType: 'video/mp4' };
  }
}
