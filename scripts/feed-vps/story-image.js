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
    const isLink = facet.features?.some((f) => f.$type === 'app.bsky.richtext.facet#link');

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

  // === MODERN X-LIKE DESIGN ===
  // Dark background, white card, clean minimal layout
  // Card is narrower for more vertical look
  
  const cardWidth = 900; // Narrower card (was 1016)
  const cardMargin = (1080 - cardWidth) / 2;

  // Build card content
  const cardContent = [];

  // 1. IMAGE AT TOP (if exists) - full width, rounded top corners
  if (postImage) {
    cardContent.push({
      type: 'img',
      props: {
        src: postImage,
        style: {
          width: '100%',
          height: 340,
          objectFit: 'cover',
          borderRadius: '24px 24px 0 0',
        },
      },
    });
  }

  // 2. EXTERNAL LINK PREVIEW (if exists and no post image)
  if (externalEmbed && !postImage) {
    const embedElements = [];
    
    // Thumbnail
    if (externalEmbed.thumb) {
      embedElements.push({
        type: 'img',
        props: {
          src: externalEmbed.thumb,
          style: {
            width: '100%',
            height: 200,
            objectFit: 'cover',
            borderRadius: '24px 24px 0 0',
          },
        },
      });
    }
    
    // Title overlay at bottom of image
    embedElements.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          padding: 20,
          backgroundColor: '#F9FAFB',
        },
        children: [
          externalEmbed.title ? {
            type: 'span',
            props: {
              style: {
                color: '#0F172A',
                fontSize: 22,
                fontWeight: 600,
                marginBottom: 6,
              },
              children: externalEmbed.title.length > 80 
                ? externalEmbed.title.substring(0, 80) + '...' 
                : externalEmbed.title,
            },
          } : null,
          {
            type: 'span',
            props: {
              style: {
                color: '#6B7280',
                fontSize: 16,
              },
              children: (() => {
                try { 
                  return new URL(externalEmbed.uri).hostname.replace(/^www\./, ''); 
                } catch { return externalEmbed.uri; }
              })(),
            },
          },
        ].filter(Boolean),
      },
    });
    
    cardContent.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
        },
        children: embedElements,
      },
    });
  }

  // 3. CONTENT SECTION
  // Parse text with facets for link highlighting and newlines
  const fontSize = postImage || externalEmbed ? 24 : 28;
  const textElements = [];
  
  if (text) {
    const lines = text.split('\n');
    let byteOffset = 0;
    const encoder = new TextEncoder();
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineBytes = encoder.encode(line).length;
      
      // Find facets for this line
      const lineFacets = facets
        .filter((f) => f.index.byteStart >= byteOffset && f.index.byteStart < byteOffset + lineBytes)
        .map((f) => ({
          ...f,
          index: {
            byteStart: f.index.byteStart - byteOffset,
            byteEnd: Math.min(f.index.byteEnd - byteOffset, lineBytes),
          },
        }));
      
      // Parse line with facets
      const lineSegments = parseTextWithFacets(line, lineFacets);
      
      // Create spans for this line (strip https://www. and trailing paths/params from link text)
      const lineSpans = lineSegments.map((segment, idx) => {
        let displayText = segment.text;
        if (segment.isLink) {
          // Remove protocol and www
          displayText = displayText.replace(/^https?:\/\/(www\.)?/, '');
          // Remove trailing slash
          displayText = displayText.replace(/\/$/, '');
          // Remove query params and fragments (keep just domain + path)
          displayText = displayText.split('?')[0].split('#')[0];
          // If it's just a domain with a long path, truncate intelligently
          const parts = displayText.split('/');
          if (parts.length > 2) {
            // Keep domain and first path segment, indicate more with ...
            displayText = parts[0] + '/' + parts[1] + (parts.length > 2 ? '/...' : '');
          }
        }
        return {
          type: 'span',
          props: {
            key: `${lineIdx}-${idx}`,
            style: {
              color: segment.isLink ? '#10B981' : '#1F2937',
              fontSize,
              lineHeight: 1.6,
              fontWeight: 400,
            },
            children: displayText,
          },
        };
      });
      
      // Add line div
      if (line.trim() || lineIdx < lines.length - 1) {
        textElements.push({
          type: 'div',
          props: {
            key: `line-${lineIdx}`,
            style: {
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              minHeight: line.trim() ? fontSize * 1.8 : fontSize * 0.8,
            },
            children: lineSpans.length > 0 ? lineSpans : null,
          },
        });
      }
      
      byteOffset += lineBytes + 1;
    }
  }

  cardContent.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 32px',
      },
      children: [
        // Top row: Author info + Logo in top right
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 20,
            },
            children: [
              // Author row with checkmark
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                  },
                  children: [
              // Avatar
              {
                type: 'img',
                props: {
                  src: avatarUrl,
                  width: 52,
                  height: 52,
                  style: {
                    borderRadius: 26,
                  },
                },
              },
              // Name column with checkmark inline
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    marginLeft: 14,
                  },
                  children: [
                    // Name row with checkmark
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
                                color: '#0F172A',
                                fontSize: 24,
                                fontWeight: 700,
                              },
                              children: displayName,
                            },
                          },
                          // Checkmark RIGHT AFTER name
                          {
                            type: 'svg',
                            props: {
                              width: 20,
                              height: 20,
                              viewBox: '0 0 24 24',
                              style: { marginLeft: 6 },
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
                    // Handle (hide .cannect.space)
                    {
                      type: 'span',
                      props: {
                        style: {
                          color: '#6B7280',
                          fontSize: 17,
                          marginTop: 2,
                        },
                        children: handle.replace('.cannect.space', ''),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // Logo top right
        {
          type: 'img',
          props: {
            src: 'https://cannect.net/favicon.png',
            width: 32,
            height: 32,
            style: {
              borderRadius: 8,
            },
          },
        },
      ],
    },
  },
        // Post text with links and newlines
        textElements.length > 0 ? {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            },
            children: textElements,
          },
        } : null,
      ].filter(Boolean),
    },
  });

  // 4. BOTTOM ROW: Metrics left, cannect.net right (like X)
  const hasMetrics = viewCount > 0 || likeCount > 0 || replyCount > 0 || repostCount > 0;
  
  cardContent.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px 24px 32px',
        borderTop: '1px solid #F3F4F6',
      },
      children: [
        // Metrics on left (thin grey text)
        hasMetrics ? {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              gap: 16,
            },
            children: [
              viewCount > 0 ? {
                type: 'span',
                props: {
                  style: {
                    color: '#9CA3AF',
                    fontSize: 15,
                    fontWeight: 400,
                  },
                  children: `${formatCount(viewCount)} views`,
                },
              } : null,
              likeCount > 0 ? {
                type: 'span',
                props: {
                  style: {
                    color: '#9CA3AF',
                    fontSize: 15,
                    fontWeight: 400,
                  },
                  children: `${formatCount(likeCount)} likes`,
                },
              } : null,
              replyCount > 0 ? {
                type: 'span',
                props: {
                  style: {
                    color: '#9CA3AF',
                    fontSize: 15,
                    fontWeight: 400,
                  },
                  children: `${formatCount(replyCount)} replies`,
                },
              } : null,
              repostCount > 0 ? {
                type: 'span',
                props: {
                  style: {
                    color: '#9CA3AF',
                    fontSize: 15,
                    fontWeight: 400,
                  },
                  children: `${formatCount(repostCount)} reposts`,
                },
              } : null,
            ].filter(Boolean),
          },
        } : {
          type: 'div',
          props: { children: null },
        },
        // cannect.net on right (thin grey text)
        {
          type: 'span',
          props: {
            style: {
              color: '#9CA3AF',
              fontSize: 15,
              fontWeight: 400,
            },
            children: 'cannect.net',
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
          backgroundColor: '#0F0F0F',
          fontFamily: 'Inter',
          paddingTop: 180,
          paddingBottom: 180,
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#FFFFFF',
              borderRadius: 24,
              marginLeft: cardMargin,
              marginRight: cardMargin,
              width: cardWidth,
              maxHeight: 1400,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            },
            children: cardContent,
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
