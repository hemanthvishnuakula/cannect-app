/**
 * Compose Screen - Pure AT Protocol
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image as RNImage,
  ScrollView,
  Modal,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Image as ImageIcon,
  Video as VideoIcon,
  Quote,
  Trash2,
  Bold,
  Italic,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { RichText } from '@atproto/api';
import { useCreatePost } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';
import * as atproto from '@/lib/atproto/agent';
import { getOptimizedAvatarUrl } from '@/lib/utils/avatar';
import { compressImageForPost } from '@/lib/utils/media-compression';
import { MentionSuggestions } from '@/components/ui/MentionSuggestions';
import { triggerImpact } from '@/lib/utils/haptics';

const MAX_LENGTH = 300; // Bluesky character limit

// OG API endpoint for link previews
const OG_API_URL = 'https://api.cannect.space';

// URL regex pattern
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Link preview data
interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  loading?: boolean;
  error?: string;
}

// Quoted post preview data
interface QuotedPost {
  uri: string;
  cid: string;
  author: {
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  text: string;
}

export default function ComposeScreen() {
  const { replyToUri, replyToCid, rootUri, rootCid, quoteUri, quoteCid } = useLocalSearchParams<{
    replyToUri?: string;
    replyToCid?: string;
    rootUri?: string;
    rootCid?: string;
    quoteUri?: string;
    quoteCid?: string;
  }>();

  const isReply = !!(replyToUri && replyToCid);
  const isQuote = !!(quoteUri && quoteCid);

  const [content, setContent] = useState('');
  const [images, setImages] = useState<{ uri: string; mimeType: string }[]>([]);
  const [video, setVideo] = useState<{
    uri: string;
    mimeType: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotedPost, setQuotedPost] = useState<QuotedPost | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [discardMenuVisible, setDiscardMenuVisible] = useState(false);

  // Link preview state
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const linkPreviewFetchedRef = useRef<string | null>(null);

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionVisible, setMentionVisible] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const mentionStartRef = useRef<number>(-1);
  const textInputRef = useRef<TextInput>(null);

  // Video file input ref for web
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const createPostMutation = useCreatePost();
  const { isAuthenticated, profile, handle } = useAuthStore();

  // Detect URLs in content and fetch link preview
  useEffect(() => {
    // Don't fetch link preview if we already have media or quote
    if (images.length > 0 || video || isQuote) {
      setLinkPreview(null);
      return;
    }

    const urls = content.match(URL_REGEX);
    const firstUrl = urls?.[0];

    // If no URL found, clear preview
    if (!firstUrl) {
      setLinkPreview(null);
      linkPreviewFetchedRef.current = null;
      return;
    }

    // Don't refetch if we already fetched this URL
    if (linkPreviewFetchedRef.current === firstUrl) {
      return;
    }

    // Debounce: wait for user to stop typing
    const timeoutId = setTimeout(async () => {
      linkPreviewFetchedRef.current = firstUrl;
      setLinkPreview({ url: firstUrl, loading: true });

      try {
        console.log('[Compose] Fetching OG for:', firstUrl);
        const response = await fetch(`${OG_API_URL}/og?url=${encodeURIComponent(firstUrl)}`);
        const data = await response.json();
        console.log('[Compose] OG response:', data);

        if (data.error) {
          setLinkPreview({ url: firstUrl, error: data.error });
        } else {
          setLinkPreview({
            url: data.url || firstUrl,
            title: data.title,
            description: data.description,
            image: data.image,
          });
          console.log('[Compose] Link preview set:', data.title);
        }
      } catch (err) {
        console.error('[Compose] Failed to fetch link preview:', err);
        setLinkPreview({ url: firstUrl, error: 'Failed to load preview' });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [content, images.length, video, isQuote]);

  // Fetch quoted post data for preview
  useEffect(() => {
    if (isQuote && quoteUri && quoteCid) {
      setIsLoadingQuote(true);
      atproto
        .getPost(quoteUri)
        .then((result) => {
          const post = result.data.thread.post as any;
          setQuotedPost({
            uri: quoteUri,
            cid: quoteCid,
            author: {
              handle: post.author.handle,
              displayName: post.author.displayName,
              avatar: post.author.avatar,
            },
            text: post.record?.text || '',
          });
        })
        .catch((err) => {
          console.error('[Compose] Failed to fetch quoted post:', err);
        })
        .finally(() => {
          setIsLoadingQuote(false);
        });
    }
  }, [isQuote, quoteUri, quoteCid]);

  // Use RichText for accurate grapheme counting (matches AT Protocol's 300 grapheme limit)
  const graphemeLength = useMemo(() => {
    const rt = new RichText({ text: content });
    return rt.graphemeLength;
  }, [content]);

  const remainingChars = MAX_LENGTH - graphemeLength;
  const isOverLimit = remainingChars < 0;
  const canPost =
    content.trim().length > 0 && !isOverLimit && !createPostMutation.isPending && !isUploading;
  const _hasMedia = images.length > 0 || video !== null;

  const handlePickImage = async () => {
    if (images.length >= 4 || video) return; // Can't add images if video exists

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 4 - images.length,
      quality: 0.8,
    });

    if (!result.canceled) {
      const newImages = result.assets.map((asset) => ({
        uri: asset.uri,
        mimeType: asset.mimeType || 'image/jpeg',
      }));
      setImages([...images, ...newImages].slice(0, 4));
    }
  };

  // Handle video file selection from web input
  const handleVideoFileChange = useCallback((e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (100MB limit)
    if (file.size > 100 * 1024 * 1024) {
      setError('Video must be under 100MB');
      return;
    }

    // Create object URL for the video
    const uri = URL.createObjectURL(file);

    // Get video dimensions using HTML video element
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      // Check duration (60 second limit)
      if (videoEl.duration > 60) {
        setError('Video must be under 60 seconds');
        URL.revokeObjectURL(uri);
        return;
      }

      setVideo({
        uri,
        mimeType: file.type || 'video/mp4',
        width: videoEl.videoWidth,
        height: videoEl.videoHeight,
      });
    };
    videoEl.onerror = () => {
      setError('Failed to load video');
      URL.revokeObjectURL(uri);
    };
    videoEl.src = uri;

    // Reset input so same file can be selected again
    e.target.value = '';
  }, []);

  const handlePickVideo = async () => {
    if (images.length > 0 || video) return; // Can't add video if images exist or video already selected

    // On web, trigger the hidden file input
    if (Platform.OS === 'web' && videoInputRef.current) {
      videoInputRef.current.click();
      return;
    }

    // Native: use expo-image-picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];

      // Check duration if available
      if (asset.duration && asset.duration > 60000) {
        setError('Video must be under 60 seconds');
        return;
      }

      setVideo({
        uri: asset.uri,
        mimeType: asset.mimeType || 'video/mp4',
        width: asset.width,
        height: asset.height,
      });
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const removeVideo = () => {
    setVideo(null);
  };

  // Handle text change and detect @mentions
  const handleTextChange = useCallback(
    (text: string) => {
      setContent(text);

      // Find if we're currently typing a mention
      const textBeforeCursor = text.slice(0, cursorPosition + (text.length - content.length));

      // Look for @ that starts a mention (after space, newline, or at start)
      const mentionMatch = textBeforeCursor.match(/(?:^|[\s])@([a-zA-Z0-9._-]*)$/);

      if (mentionMatch) {
        const query = mentionMatch[1];
        // Store the position where @ starts
        mentionStartRef.current =
          textBeforeCursor.length -
          mentionMatch[0].length +
          (mentionMatch[0].startsWith('@') ? 0 : 1);
        setMentionQuery(query);
        setMentionVisible(true);
      } else {
        setMentionVisible(false);
        setMentionQuery('');
      }
    },
    [content, cursorPosition]
  );

  // Handle cursor position change
  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { start, end } = e.nativeEvent.selection;
      setCursorPosition(end);
      setSelectionStart(start);
      setSelectionEnd(end);
    },
    []
  );

  // Toggle states for bold and italic
  const [isBoldActive, setIsBoldActive] = useState(false);
  const [isItalicActive, setIsItalicActive] = useState(false);

  // Toggle bold mode - inserts ** markers at cursor
  const handleBold = useCallback(() => {
    const pos = cursorPosition;
    const before = content.slice(0, pos);
    const after = content.slice(pos);

    if (isBoldActive) {
      // Closing bold - insert **
      setContent(before + '**' + after);
      setIsBoldActive(false);
    } else {
      // Opening bold - insert **
      setContent(before + '**' + after);
      setIsBoldActive(true);
    }

    triggerImpact('light');
  }, [content, cursorPosition, isBoldActive]);

  // Toggle italic mode - inserts * markers at cursor
  const handleItalic = useCallback(() => {
    const pos = cursorPosition;
    const before = content.slice(0, pos);
    const after = content.slice(pos);

    if (isItalicActive) {
      // Closing italic - insert *
      setContent(before + '*' + after);
      setIsItalicActive(false);
    } else {
      // Opening italic - insert *
      setContent(before + '*' + after);
      setIsItalicActive(true);
    }

    triggerImpact('light');
  }, [content, cursorPosition, isItalicActive]);

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (handle: string) => {
      if (mentionStartRef.current === -1) return;

      // Replace the partial mention with the full handle
      const beforeMention = content.slice(0, mentionStartRef.current);
      const afterCursor = content.slice(cursorPosition);

      // Insert @handle followed by a space
      const newContent = `${beforeMention}@${handle} ${afterCursor}`;
      setContent(newContent);

      // Hide the suggestions
      setMentionVisible(false);
      setMentionQuery('');
      mentionStartRef.current = -1;

      // Haptic feedback
      triggerImpact('light');
    },
    [content, cursorPosition]
  );

  const handlePost = useCallback(async () => {
    if (!canPost) return;
    if (!isAuthenticated) {
      setError('You must be logged in to post');
      return;
    }

    setError(null);
    const mediaCount = video ? 1 : images.length;
    console.log('[Compose] Creating post with', mediaCount, 'media items');

    try {
      let embed;
      setIsUploading(true);

      // Upload video if any (video takes priority, can't have both)
      if (video) {
        // Fetch the video data as ArrayBuffer
        const response = await fetch(video.uri);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        console.log(
          '[Compose] Video size:',
          arrayBuffer.byteLength,
          'bytes, mimeType:',
          video.mimeType
        );

        // Upload to Bluesky with fallback to PDS
        const uploadStart = Date.now();
        setUploadStatus('Uploading video...');

        const uploadResult = await atproto.uploadVideoWithFallback(
          arrayBuffer,
          video.mimeType || 'video/mp4',
          (stage, progress) => {
            if (stage === 'uploading') {
              setUploadStatus(`Uploading video... ${Math.round(progress)}%`);
            } else {
              setUploadStatus(`Processing video... ${Math.round(progress)}%`);
            }
          }
        );

        setUploadStatus(null);
        console.log('[Compose] Video ready in', Date.now() - uploadStart, 'ms');

        const width = video.width;
        const height = video.height;

        embed = {
          $type: 'app.bsky.embed.video',
          video: uploadResult.blob,
          ...(width &&
            height && {
              aspectRatio: { width, height },
            }),
        };
      }
      // Upload images if any
      else if (images.length > 0) {
        const uploadStart = Date.now();
        const uploadedImages = [];

        for (const image of images) {
          // Compress image to fit AT Protocol limits
          const compressed = await compressImageForPost(image.uri);

          // Fetch the compressed image data
          const response = await fetch(compressed.uri);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          // Upload to Bluesky
          const uploadResult = await atproto.uploadBlob(uint8Array, compressed.mimeType);
          uploadedImages.push({
            alt: '',
            image: uploadResult.data.blob,
          });
        }

        console.log(
          '[Compose]',
          images.length,
          'images uploaded in',
          Date.now() - uploadStart,
          'ms'
        );

        embed = {
          $type: 'app.bsky.embed.images',
          images: uploadedImages,
        };
      }

      // Handle quote post embed
      if (isQuote && quotedPost) {
        const quoteEmbed = {
          $type: 'app.bsky.embed.record',
          record: {
            uri: quotedPost.uri,
            cid: quotedPost.cid,
          },
        };

        // If we have media + quote, use recordWithMedia
        if (embed) {
          embed = {
            $type: 'app.bsky.embed.recordWithMedia',
            record: quoteEmbed,
            media: embed,
          };
        } else {
          embed = quoteEmbed;
        }
      }

      // Handle link preview embed (only if no other embed)
      console.log('[Compose] Checking link preview:', { 
        hasEmbed: !!embed, 
        linkPreview: linkPreview ? { url: linkPreview.url, title: linkPreview.title, loading: linkPreview.loading, error: linkPreview.error } : null 
      });
      
      if (
        !embed &&
        linkPreview &&
        linkPreview.title &&
        !linkPreview.loading &&
        !linkPreview.error
      ) {
        console.log('[Compose] Creating external embed for:', linkPreview.url);
        let thumbBlob = undefined;

        // Upload thumbnail if available
        if (linkPreview.image) {
          try {
            setUploadStatus('Uploading link thumbnail...');
            const thumbResponse = await fetch(linkPreview.image, { mode: 'cors' });
            
            if (!thumbResponse.ok) {
              console.log('[Compose] Thumbnail fetch failed:', thumbResponse.status);
            } else {
              const thumbData = await thumbResponse.blob();
              
              // Skip if image is too large (> 1MB)
              if (thumbData.size > 1000000) {
                console.log('[Compose] Thumbnail too large, skipping:', thumbData.size);
              } else {
                const thumbArrayBuffer = await thumbData.arrayBuffer();
                const thumbUint8Array = new Uint8Array(thumbArrayBuffer);
                const thumbMimeType = thumbResponse.headers.get('content-type') || 'image/jpeg';
                
                const uploadResult = await atproto.uploadBlob(thumbUint8Array, thumbMimeType);
                thumbBlob = uploadResult.data.blob;
                console.log('[Compose] Thumbnail uploaded');
              }
            }
          } catch (thumbErr) {
            // Silently continue without thumbnail - it's optional
            console.log('[Compose] Thumbnail skipped:', (thumbErr as Error).message);
          }
        }

        embed = {
          $type: 'app.bsky.embed.external',
          external: {
            uri: linkPreview.url,
            title: linkPreview.title || '',
            description: linkPreview.description || '',
            ...(thumbBlob && { thumb: thumbBlob }),
          },
        };
        console.log('[Compose] External embed created:', embed);
      }

      setIsUploading(false);

      // Build reply reference if this is a reply
      const reply = isReply
        ? {
            parent: { uri: replyToUri!, cid: replyToCid! },
            root: { uri: rootUri || replyToUri!, cid: rootCid || replyToCid! },
          }
        : undefined;

      const result = await createPostMutation.mutateAsync({
        text: content.trim(),
        reply,
        embed,
      });

      console.log('[Compose] Post created:', result?.uri);

      // Success feedback
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setContent('');
      setImages([]);
      setVideo(null);
      setLinkPreview(null);
      linkPreviewFetchedRef.current = '';
      router.back();
    } catch (err: any) {
      console.error('[Compose] Post creation error:', err.message);
      setError(err.message || 'Failed to create post');
      setIsUploading(false);
      setUploadStatus(null);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  }, [
    content,
    images,
    video,
    isAuthenticated,
    isReply,
    isQuote,
    quotedPost,
    replyToUri,
    replyToCid,
    rootUri,
    rootCid,
    createPostMutation,
    canPost,
    linkPreview,
  ]);

  const hasDraft = content.trim() || images.length > 0 || video;

  const handleClose = () => {
    if (hasDraft) {
      setDiscardMenuVisible(true);
    } else {
      router.back();
    }
  };

  const handleDiscard = () => {
    setContent('');
    setImages([]);
    setVideo(null);
    setQuotedPost(null);
    setLinkPreview(null);
    linkPreviewFetchedRef.current = '';
    setDiscardMenuVisible(false);
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Hidden video file input for web */}
      {Platform.OS === 'web' && (
        <input
          ref={videoInputRef as any}
          type="file"
          accept="video/*"
          onChange={handleVideoFileChange}
          style={{ display: 'none' }}
        />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Pressable onPress={handleClose} className="w-10 h-10 items-center justify-center">
            <X size={24} color="#FAFAFA" />
          </Pressable>

          <Pressable
            onPress={handlePost}
            disabled={!canPost}
            className={`px-5 py-2 rounded-full ${canPost ? 'bg-primary' : 'bg-surface-elevated'}`}
          >
            {createPostMutation.isPending || isUploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className={`font-semibold ${canPost ? 'text-white' : 'text-text-muted'}`}>
                {isReply ? 'Reply' : isQuote ? 'Quote' : 'Post'}
              </Text>
            )}
          </Pressable>
        </View>

        {/* Error */}
        {error && (
          <View className="bg-accent-error/20 px-4 py-2">
            <Text className="text-accent-error text-center">{error}</Text>
          </View>
        )}

        {/* Video Upload Status */}
        {uploadStatus && (
          <View className="bg-primary/20 px-4 py-2 flex-row items-center justify-center gap-2">
            <ActivityIndicator size="small" color="#10B981" />
            <Text className="text-primary text-center">{uploadStatus}</Text>
          </View>
        )}

        {/* Compose Area */}
        <View className="flex-1 px-4 pt-4">
          <View className="flex-row">
            {/* Avatar */}
            {profile?.avatar ? (
              <Image
                source={{ uri: getOptimizedAvatarUrl(profile.avatar, 40) }}
                className="w-10 h-10 rounded-full"
                cachePolicy="memory-disk"
              />
            ) : (
              <View className="w-10 h-10 rounded-full bg-surface-elevated items-center justify-center">
                <Text className="text-text-muted text-lg">
                  {(profile?.handle || handle || 'U')[0].toUpperCase()}
                </Text>
              </View>
            )}

            {/* Text Input */}
            <TextInput
              value={content}
              onChangeText={handleTextChange}
              onSelectionChange={handleSelectionChange}
              placeholder={
                isReply
                  ? 'Write your reply...'
                  : isQuote
                    ? 'Add your comment...'
                    : "What's happening?"
              }
              placeholderTextColor="#6B7280"
              multiline
              autoFocus
              blurOnSubmit={false}
              submitBehavior="newline"
              className="flex-1 ml-3 text-text-primary text-lg leading-6 outline-none"
              style={{ textAlignVertical: 'top', minHeight: 180 }}
            />
          </View>

          {/* Mention Suggestions - Shows when typing @username */}
          {mentionVisible && (
            <View className="ml-13 mt-2">
              <MentionSuggestions
                query={mentionQuery}
                onSelect={handleMentionSelect}
                visible={mentionVisible}
              />
            </View>
          )}

          {/* Inline Toolbar - Below Text */}
          <View className="flex-row items-center justify-between ml-13 mt-3 pb-3 border-b border-border">
            <View className="flex-row gap-4 items-center">
              {/* Bold button - toggle mode */}
              <Pressable
                onPress={handleBold}
                className={`p-1.5 rounded ${isBoldActive ? 'bg-accent-primary' : 'bg-surface-elevated'}`}
              >
                <Bold size={20} color={isBoldActive ? '#FFFFFF' : '#10B981'} />
              </Pressable>
              {/* Italic button - toggle mode */}
              <Pressable
                onPress={handleItalic}
                className={`p-1.5 rounded ${isItalicActive ? 'bg-accent-primary' : 'bg-surface-elevated'}`}
              >
                <Italic size={20} color={isItalicActive ? '#FFFFFF' : '#10B981'} />
              </Pressable>
              {/* Divider */}
              <View className="w-px h-5 bg-border mx-1" />
              <Pressable
                onPress={handlePickImage}
                disabled={images.length >= 4 || video !== null}
                className={images.length >= 4 || video !== null ? 'opacity-50' : ''}
              >
                <ImageIcon size={22} color="#10B981" />
              </Pressable>
              <Pressable
                onPress={handlePickVideo}
                disabled={images.length > 0 || video !== null}
                className={images.length > 0 || video !== null ? 'opacity-50' : ''}
              >
                <VideoIcon size={22} color="#3B82F6" />
              </Pressable>
            </View>
            <Text
              className={`font-medium ${isOverLimit ? 'text-accent-error' : remainingChars < 50 ? 'text-yellow-500' : 'text-text-muted'}`}
            >
              {remainingChars}
            </Text>
          </View>

          {/* Images Preview */}
          {images.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-4 ml-13">
              {images.map((image, index) => (
                <View key={index} className="relative">
                  <Image
                    source={{ uri: image.uri }}
                    className="w-20 h-20 rounded-lg"
                    resizeMode="cover"
                  />
                  <Pressable
                    onPress={() => removeImage(index)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-black/70 rounded-full items-center justify-center"
                  >
                    <X size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* Video Preview */}
          {video && (
            <View className="mt-4 ml-13 relative">
              <View className="w-40 h-24 rounded-lg bg-surface-elevated items-center justify-center border border-border">
                <VideoIcon size={32} color="#10B981" />
                <Text className="text-text-muted text-xs mt-1">Video selected</Text>
              </View>
              <Pressable
                onPress={removeVideo}
                className="absolute -top-2 -right-2 w-6 h-6 bg-black/70 rounded-full items-center justify-center"
              >
                <X size={14} color="#fff" />
              </Pressable>
            </View>
          )}

          {/* Link Preview */}
          {linkPreview && !images.length && !video && (
            <View className="mt-4 ml-13 relative">
              <View className="bg-surface-elevated rounded-xl border border-border overflow-hidden">
                {linkPreview.image && (
                  <Image
                    source={{ uri: linkPreview.image }}
                    className="w-full h-32"
                    contentFit="cover"
                  />
                )}
                <View className="p-3">
                  {linkPreview.title && (
                    <Text className="text-text-primary font-medium text-sm" numberOfLines={2}>
                      {linkPreview.title}
                    </Text>
                  )}
                  {linkPreview.description && (
                    <Text className="text-text-muted text-xs mt-1" numberOfLines={2}>
                      {linkPreview.description}
                    </Text>
                  )}
                  <Text className="text-text-muted text-xs mt-1" numberOfLines={1}>
                    {new URL(linkPreview.url).hostname}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  setLinkPreview(null);
                  linkPreviewFetchedRef.current = '';
                }}
                className="absolute -top-2 -right-2 w-6 h-6 bg-black/70 rounded-full items-center justify-center"
              >
                <X size={14} color="#fff" />
              </Pressable>
            </View>
          )}

          {/* Quote Post Preview */}
          {isQuote && (
            <View className="mt-4 ml-13">
              {isLoadingQuote ? (
                <View className="bg-surface-elevated rounded-xl p-4 border border-border flex-row items-center">
                  <ActivityIndicator size="small" color="#10B981" />
                  <Text className="text-text-muted ml-3">Loading quoted post...</Text>
                </View>
              ) : quotedPost ? (
                <View className="bg-surface-elevated rounded-xl p-3 border border-border">
                  <View className="flex-row items-center mb-2">
                    <Quote size={14} color="#8B5CF6" />
                    <Text className="text-text-muted text-xs ml-1">Quoting</Text>
                  </View>
                  <View className="flex-row items-center">
                    {quotedPost.author.avatar ? (
                      <Image
                        source={{ uri: getOptimizedAvatarUrl(quotedPost.author.avatar, 20) }}
                        className="w-5 h-5 rounded-full"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View className="w-5 h-5 rounded-full bg-primary/20 items-center justify-center">
                        <Text className="text-primary text-xs">
                          {quotedPost.author.handle[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text className="text-text-primary font-medium ml-2 text-sm">
                      {quotedPost.author.displayName || quotedPost.author.handle}
                    </Text>
                    <Text className="text-text-muted text-xs ml-1">
                      @{quotedPost.author.handle}
                    </Text>
                  </View>
                  <Text className="text-text-secondary text-sm mt-2" numberOfLines={3}>
                    {quotedPost.text}
                  </Text>
                </View>
              ) : (
                <View className="bg-surface-elevated rounded-xl p-4 border border-border">
                  <Text className="text-text-muted text-sm">Failed to load quoted post</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Discard Draft Confirmation */}
      <Modal
        visible={discardMenuVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setDiscardMenuVisible(false)}
      >
        <Pressable className="flex-1 bg-black/50" onPress={() => setDiscardMenuVisible(false)} />

        <View className="bg-surface-elevated rounded-t-3xl pb-8 pt-2">
          <View className="items-center py-3">
            <View className="w-10 h-1 bg-zinc-600 rounded-full" />
          </View>

          <View className="px-4 pb-4">
            <Pressable
              onPress={handleDiscard}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View className="w-11 h-11 rounded-full bg-red-500/20 items-center justify-center">
                <Trash2 size={22} color="#EF4444" />
              </View>
              <View className="flex-1">
                <Text className="text-red-500 text-lg font-semibold">Discard Draft</Text>
                <Text className="text-text-muted text-sm">Your text and media will be deleted</Text>
              </View>
            </Pressable>
          </View>

          <View className="px-4">
            <Pressable
              onPress={() => setDiscardMenuVisible(false)}
              className="py-4 rounded-xl bg-zinc-800 items-center active:bg-zinc-700"
            >
              <Text className="text-text-primary font-semibold text-base">Keep Editing</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
