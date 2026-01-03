/**
 * Media Compression Utilities
 *
 * Unified compression for images to fit AT Protocol limits.
 * Used by Compose and Edit Profile screens.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

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
