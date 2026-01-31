/**
 * Story Image Generator
 *
 * Generates Instagram Story-sized images (1080x1920) for sharing posts.
 * Includes: avatar, author info, full post text, and post images.
 * Uses Satori for SVG generation and resvg for PNG conversion.
 */

const { Resvg } = require('@resvg/resvg-js');
const { BskyAgent } = require('@atproto/api');
const db = require('./db');

// Satori is ESM-only, need dynamic import
let satori = null;
async function getSatori() {
  if (!satori) {
    const module = await import('satori');
    satori = module.default;
  }
  return satori;
}

// Story dimensions (Instagram Stories)
const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

// Load fonts once at startup
let interFont = null;
let interBoldFont = null;

async function loadFonts() {
  if (interFont && interBoldFont) return;

  try {
    // Load Inter fonts
    const regularRes = await fetch(
      'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff'
    );
    interFont = await regularRes.arrayBuffer();

    const boldRes = await fetch(
      'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hjp-Ek-_EeA.woff'
    );
    interBoldFont = await boldRes.arrayBuffer();

    console.log('[StoryImage] Fonts loaded successfully');
  } catch (err) {
    console.error('[StoryImage] Failed to load fonts:', err.message);
    throw err;
  }
}

/**
 * Convert emoji to Twemoji code points format
 * Handles compound emojis (skin tones, ZWJ sequences, etc.)
 */
function emojiToTwemojiCode(emoji) {
  const codePoints = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    // Skip variation selectors (FE0E, FE0F)
    if (cp !== 0xfe0e && cp !== 0xfe0f) {
      codePoints.push(cp.toString(16));
    }
  }
  return codePoints.join('-');
}

/**
 * Fetch emoji as SVG from Twemoji CDN
 * Returns data URI for use in Satori
 */
async function fetchTwemoji(emoji) {
  const code = emojiToTwemojiCode(emoji);
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const svg = await res.text();
      return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }
  } catch (e) {
    // Silently fail for emojis we can't fetch
  }
  return null;
}

/**
 * Fetch post data from Bluesky
 */
async function fetchPost(uri) {
  const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });

  try {
    const response = await agent.getPosts({ uris: [uri] });
    if (response.data.posts && response.data.posts.length > 0) {
      return response.data.posts[0];
    }
    return null;
  } catch (err) {
    console.error('[StoryImage] Failed to fetch post:', err.message);
    return null;
  }
}

/**
 * Get avatar URL or generate initials fallback
 */
function getAvatarUrl(author) {
  if (author.avatar) {
    return author.avatar;
  }
  const name = author.displayName || author.handle;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10B981&color=fff&size=128`;
}

/**
 * Check if user is a Cannect user
 */
function isCannectUser(handle) {
  return handle.endsWith('.cannect.space') || handle.endsWith('.pds.cannect.space');
}

/**
 * Get first image from post embeds
 */
function getPostImage(post) {
  const embed = post.embed;
  if (!embed) return null;

  // Images embed
  if (embed.$type === 'app.bsky.embed.images#view' && embed.images?.length > 0) {
    return embed.images[0].fullsize || embed.images[0].thumb;
  }

  // Record with media - check media for images
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.$type === 'app.bsky.embed.images#view' && embed.media.images?.length > 0) {
      return embed.media.images[0].fullsize || embed.media.images[0].thumb;
    }
  }

  return null;
}

/**
 * Get external embed (link preview) from post
 */
function getExternalEmbed(post) {
  const embed = post.embed;
  if (!embed) return null;

  // Direct external embed
  if (embed.$type === 'app.bsky.embed.external#view' && embed.external) {
    return {
      uri: embed.external.uri,
      title: embed.external.title,
      description: embed.external.description,
      thumb: embed.external.thumb,
    };
  }

  return null;
}

/**
 * Parse post text with facets to identify links
 * Returns array of text segments with their styling
 */
function parseTextWithFacets(text, facets) {
  if (!facets || facets.length === 0) {
    return [{ text, isLink: false }];
  }

  const segments = [];
  let lastIndex = 0;

  // Sort facets by byte start
  const sortedFacets = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);

  // Convert string to bytes for proper slicing
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);

  for (const facet of sortedFacets) {
    const { byteStart, byteEnd } = facet.index;
    
    // Check if this facet is a link
    const isLink = facet.features?.some(
      (f) => f.$type === 'app.bsky.richtext.facet#link'
    );

    // Add text before this facet
    if (byteStart > lastIndex) {
      const beforeBytes = bytes.slice(lastIndex, byteStart);
      segments.push({ text: decoder.decode(beforeBytes), isLink: false });
    }

    // Add the facet text
    const facetBytes = bytes.slice(byteStart, byteEnd);
    segments.push({ text: decoder.decode(facetBytes), isLink });

    lastIndex = byteEnd;
  }

  // Add remaining text after last facet
  if (lastIndex < bytes.length) {
    const remainingBytes = bytes.slice(lastIndex);
    segments.push({ text: decoder.decode(remainingBytes), isLink: false });
  }

  return segments;
}

/**
 * Get quoted post from embeds (for quote posts)
 */
function getQuotedPost(post) {
  const embed = post.embed;
  if (!embed) return null;

  // Direct record embed (quote post without media)
  if (embed.$type === 'app.bsky.embed.record#view' && embed.record) {
    const record = embed.record;
    // Check if it's a valid post record
    if (record.$type === 'app.bsky.embed.record#viewRecord' && record.value) {
      return {
        author: record.author,
        text: record.value.text || '',
        hasImages: record.embeds?.some((e) => e.$type === 'app.bsky.embed.images#view'),
      };
    }
  }

  // Record with media (quote post with additional media)
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.record?.record) {
    const record = embed.record.record;
    if (record.$type === 'app.bsky.embed.record#viewRecord' && record.value) {
      return {
        author: record.author,
        text: record.value.text || '',
        hasImages: record.embeds?.some((e) => e.$type === 'app.bsky.embed.images#view'),
      };
    }
  }

  return null;
}

/**
 * Generate story image as PNG buffer
 */
async function generateStoryImage(uri) {
  await loadFonts();

  const post = await fetchPost(uri);
  if (!post) {
    throw new Error('Post not found');
  }

  const author = post.author;
  const record = post.record;
  const text = record.text || '';
  const facets = record.facets || [];
  const displayName = author.displayName || author.handle;
  const handle = `@${author.handle}`;
  const avatarUrl = getAvatarUrl(author);
  const isCannect = isCannectUser(author.handle);
  const postImage = getPostImage(post);
  const quotedPost = getQuotedPost(post);
  const externalEmbed = getExternalEmbed(post);

  // Engagement stats
  const replyCount = post.replyCount || 0;
  const repostCount = post.repostCount || 0;
  const likeCount = post.likeCount || 0;

  // Get view count (tracked + engagement-based, same as app)
  // First update engagement to ensure we have latest data
  const viewCount = db.updateEngagement(uri, likeCount, replyCount, repostCount);

  // Format large numbers (e.g., 1234 -> 1.2K)
  const formatCount = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
  };

  const satoriRender = await getSatori();

  // Build children array for the card
  const cardChildren = [
    // Author row
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 24,
        },
        children: [
          {
            type: 'img',
            props: {
              src: avatarUrl,
              width: 64,
              height: 64,
              style: {
                borderRadius: 32,
              },
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                marginLeft: 16,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                    },
                    children: [
                      {
                        type: 'span',
                        props: {
                          style: {
                            color: '#FAFAFA',
                            fontSize: 28,
                            fontWeight: 700,
                          },
                          children: displayName,
                        },
                      },
                      // Filled green circle with white checkmark
                      {
                        type: 'svg',
                        props: {
                          width: 26,
                          height: 26,
                          viewBox: '0 0 24 24',
                          style: { marginLeft: 10 },
                          children: [
                            { type: 'circle', props: { cx: 12, cy: 12, r: 10, fill: '#10B981' } },
                            {
                              type: 'path',
                              props: {
                                d: 'M8 12l2.5 2.5L16 9',
                                stroke: '#FFFFFF',
                                strokeWidth: 2.5,
                                strokeLinecap: 'round',
                                strokeLinejoin: 'round',
                                fill: 'none',
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginTop: 4,
                    },
                    children: isCannect
                      ? [
                          {
                            type: 'span',
                            props: {
                              style: {
                                color: '#71717A',
                                fontSize: 20,
                              },
                              children: handle,
                            },
                          },
                          {
                            type: 'span',
                            props: {
                              style: {
                                marginLeft: 10,
                                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                                color: '#10B981',
                                fontSize: 16,
                                fontWeight: 600,
                                padding: '3px 10px',
                                borderRadius: 10,
                              },
                              children: 'cannect',
                            },
                          },
                        ]
                      : {
                          type: 'span',
                          props: {
                            style: {
                              color: '#71717A',
                              fontSize: 20,
                            },
                            children: handle,
                          },
                        },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ];

  // Add post text if exists with link highlighting and proper line breaks
  if (text) {
    const fontSize = postImage || externalEmbed ? 28 : 32;
    
    // Split text by newlines to preserve paragraph formatting
    const lines = text.split('\n');
    const lineElements = [];
    
    // Track byte position for facet matching
    let byteOffset = 0;
    const encoder = new TextEncoder();
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineBytes = encoder.encode(line).length;
      
      // Find facets that apply to this line
      const lineFacets = facets.filter(f => {
        const start = f.index.byteStart;
        const end = f.index.byteEnd;
        return start >= byteOffset && start < byteOffset + lineBytes;
      }).map(f => ({
        ...f,
        index: {
          byteStart: f.index.byteStart - byteOffset,
          byteEnd: Math.min(f.index.byteEnd - byteOffset, lineBytes),
        }
      }));
      
      // Parse this line with its facets
      const lineSegments = parseTextWithFacets(line, lineFacets);
      
      // Create spans for this line
      const lineSpans = lineSegments.map((segment, idx) => ({
        type: 'span',
        props: {
          key: `${lineIdx}-${idx}`,
          style: {
            color: segment.isLink ? '#10B981' : '#FAFAFA',
            fontSize,
            lineHeight: 1.5,
            fontWeight: segment.isLink ? 600 : 400,
          },
          children: segment.text,
        },
      }));
      
      // Add line as a div (for proper line break)
      if (line.trim() || lineIdx < lines.length - 1) {
        lineElements.push({
          type: 'div',
          props: {
            key: `line-${lineIdx}`,
            style: {
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              minHeight: line.trim() ? 'auto' : fontSize * 0.5, // Empty lines get half height
            },
            children: lineSpans.length > 0 ? lineSpans : null,
          },
        });
      }
      
      // Update byte offset (+1 for the newline character)
      byteOffset += lineBytes + 1;
    }

    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          marginBottom: postImage || quotedPost || externalEmbed ? 20 : 0,
        },
        children: lineElements,
      },
    });
  }

  // Add external embed (link preview) if exists
  if (externalEmbed) {
    const embedChildren = [];

    // Add thumbnail if available
    if (externalEmbed.thumb) {
      embedChildren.push({
        type: 'img',
        props: {
          src: externalEmbed.thumb,
          style: {
            width: '100%',
            height: 180,
            borderRadius: '12px 12px 0 0',
            objectFit: 'cover',
          },
        },
      });
    }

    // Add title and description
    embedChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
        },
        children: [
          // Title
          externalEmbed.title ? {
            type: 'span',
            props: {
              style: {
                color: '#FAFAFA',
                fontSize: 22,
                fontWeight: 600,
                marginBottom: 6,
              },
              children: externalEmbed.title.length > 60 
                ? externalEmbed.title.substring(0, 60) + '...'
                : externalEmbed.title,
            },
          } : null,
          // Description
          externalEmbed.description ? {
            type: 'span',
            props: {
              style: {
                color: '#A1A1AA',
                fontSize: 18,
                lineHeight: 1.4,
                marginBottom: 8,
              },
              children: externalEmbed.description.length > 100
                ? externalEmbed.description.substring(0, 100) + '...'
                : externalEmbed.description,
            },
          } : null,
          // Domain
          {
            type: 'span',
            props: {
              style: {
                color: '#71717A',
                fontSize: 16,
              },
              children: (() => {
                try {
                  return new URL(externalEmbed.uri).hostname;
                } catch {
                  return externalEmbed.uri;
                }
              })(),
            },
          },
        ].filter(Boolean),
      },
    });

    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#27272A',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid #3F3F46',
          marginBottom: postImage ? 20 : 0,
        },
        children: embedChildren,
      },
    });
  }

  // Add quoted post if exists
  if (quotedPost) {
    const quotedAuthor = quotedPost.author;
    const quotedDisplayName = quotedAuthor?.displayName || quotedAuthor?.handle || 'Unknown';
    const quotedHandle = quotedAuthor?.handle ? `@${quotedAuthor.handle}` : '';
    const quotedText = quotedPost.text || '';
    const quotedAvatarUrl = quotedAuthor ? getAvatarUrl(quotedAuthor) : null;

    // Truncate quoted text if too long
    const maxQuoteLength = 200;
    const truncatedQuoteText =
      quotedText.length > maxQuoteLength
        ? quotedText.substring(0, maxQuoteLength) + '...'
        : quotedText;

    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#27272A',
          borderRadius: 16,
          padding: 16,
          marginBottom: postImage ? 20 : 0,
          border: '1px solid #3F3F46',
        },
        children: [
          // Quoted post author row
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 10,
              },
              children: [
                // Avatar
                quotedAvatarUrl
                  ? {
                      type: 'img',
                      props: {
                        src: quotedAvatarUrl,
                        style: {
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          marginRight: 10,
                        },
                      },
                    }
                  : null,
                // Name and handle
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                    },
                    children: [
                      {
                        type: 'span',
                        props: {
                          style: {
                            color: '#FAFAFA',
                            fontSize: 18,
                            fontWeight: 600,
                          },
                          children: quotedDisplayName,
                        },
                      },
                      {
                        type: 'span',
                        props: {
                          style: {
                            color: '#71717A',
                            fontSize: 16,
                          },
                          children: quotedHandle,
                        },
                      },
                    ],
                  },
                },
              ].filter(Boolean),
            },
          },
          // Quoted post text
          truncatedQuoteText
            ? {
                type: 'div',
                props: {
                  style: {
                    color: '#A1A1AA',
                    fontSize: 22,
                    lineHeight: 1.4,
                  },
                  children: truncatedQuoteText,
                },
              }
            : null,
        ].filter(Boolean),
      },
    });
  }

  // Add post image if exists
  if (postImage) {
    cardChildren.push({
      type: 'img',
      props: {
        src: postImage,
        style: {
          width: '100%',
          maxHeight: 600,
          borderRadius: 16,
          objectFit: 'cover',
        },
      },
    });
  }

  // Add branding at bottom
  cardChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 24,
        paddingTop: 24,
        borderTop: '1px solid #27272A',
        width: '100%',
      },
      children: [
        {
          type: 'span',
          props: {
            style: {
              color: '#10B981',
              fontSize: 22,
              fontWeight: 600,
            },
            children: 'cannect.net',
          },
        },
        {
          type: 'span',
          props: {
            style: {
              color: '#71717A',
              fontSize: 18,
              fontWeight: 500,
            },
            children: 'Connect. Share. Grow.',
          },
        },
      ],
    },
  });

  const svg = await satoriRender(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0A0A0A',
          fontFamily: 'Inter',
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#18181B',
              borderRadius: 32,
              padding: 40,
              margin: 48,
              border: '2px solid #27272A',
              maxWidth: 984,
              width: 984,
              maxHeight: 1800,
              overflow: 'hidden',
            },
            children: cardChildren,
          },
        },
      },
    },
    {
      width: STORY_WIDTH,
      height: STORY_HEIGHT,
      fonts: [
        {
          name: 'Inter',
          data: interFont,
          weight: 400,
          style: 'normal',
        },
        {
          name: 'Inter',
          data: interBoldFont,
          weight: 700,
          style: 'normal',
        },
      ],
      // Load emojis dynamically from Twemoji CDN
      loadAdditionalAsset: async (code, segment) => {
        if (code === 'emoji') {
          return fetchTwemoji(segment);
        }
        return null;
      },
    }
  );

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: STORY_WIDTH,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  console.log(
    `[StoryImage] Generated image for ${uri.substring(0, 50)}... (hasImage: ${!!postImage})`
  );

  return pngBuffer;
}

module.exports = {
  generateStoryImage,
  loadFonts,
};
