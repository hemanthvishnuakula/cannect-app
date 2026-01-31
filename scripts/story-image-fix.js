/**
 * Story Image Generator
 *
 * Generates Instagram Story-sized images (1080x1920) for sharing posts.
 * Includes: avatar, author info, full post text with rich formatting, and post images.
 * Uses Satori for SVG generation and resvg for PNG conversion.
 *
 * Rich text support:
 * - Hashtags (#tag) - green color
 * - Mentions (@user) - green color
 * - Bold (**text**) - bold weight
 * - Italic (*text*) - italic style
 * - Bold+Italic (***text***) - both
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

// Colors
const COLORS = {
  text: '#FAFAFA',
  muted: '#71717A',
  green: '#10B981',
  background: '#0A0A0A',
  card: '#18181B',
  border: '#27272A',
};

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
 */
function emojiToTwemojiCode(emoji) {
  const codePoints = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp !== 0xfe0e && cp !== 0xfe0f) {
      codePoints.push(cp.toString(16));
    }
  }
  return codePoints.join('-');
}

/**
 * Fetch emoji as SVG from Twemoji CDN
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
    // Silently fail
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

  if (embed.$type === 'app.bsky.embed.images#view' && embed.images?.length > 0) {
    return embed.images[0].fullsize || embed.images[0].thumb;
  }

  if (embed.$type === 'app.bsky.embed.external#view' && embed.external?.thumb) {
    return embed.external.thumb;
  }

  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.$type === 'app.bsky.embed.images#view' && embed.media.images?.length > 0) {
      return embed.media.images[0].fullsize || embed.media.images[0].thumb;
    }
  }

  return null;
}

/**
 * Get quoted post from embeds
 */
function getQuotedPost(post) {
  const embed = post.embed;
  if (!embed) return null;

  if (embed.$type === 'app.bsky.embed.record#view' && embed.record) {
    const record = embed.record;
    if (record.$type === 'app.bsky.embed.record#viewRecord' && record.value) {
      return {
        author: record.author,
        text: record.value.text || '',
        facets: record.value.facets || [],
        hasImages: record.embeds?.some((e) => e.$type === 'app.bsky.embed.images#view'),
      };
    }
  }

  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.record?.record) {
    const record = embed.record.record;
    if (record.$type === 'app.bsky.embed.record#viewRecord' && record.value) {
      return {
        author: record.author,
        text: record.value.text || '',
        facets: record.value.facets || [],
        hasImages: record.embeds?.some((e) => e.$type === 'app.bsky.embed.images#view'),
      };
    }
  }

  return null;
}

/**
 * Parse markdown formatting (**bold**, *italic*, ***both***)
 */
function parseMarkdown(text) {
  const segments = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*([^*]+?)\*)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        color: COLORS.text,
        fontWeight: 400,
        fontStyle: 'normal',
      });
    }

    if (match[2]) {
      segments.push({
        text: match[2],
        color: COLORS.text,
        fontWeight: 700,
        fontStyle: 'italic',
      });
    } else if (match[3]) {
      segments.push({
        text: match[3],
        color: COLORS.text,
        fontWeight: 700,
        fontStyle: 'normal',
      });
    } else if (match[4]) {
      segments.push({
        text: match[4],
        color: COLORS.text,
        fontWeight: 400,
        fontStyle: 'italic',
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      color: COLORS.text,
      fontWeight: 400,
      fontStyle: 'normal',
    });
  }

  return segments.length > 0
    ? segments
    : [{ text, color: COLORS.text, fontWeight: 400, fontStyle: 'normal' }];
}

/**
 * Parse rich text with facets and markdown into segments
 */
function parseRichText(text, facets = []) {
  if (!text) return [];

  const facetSegments = [];
  let lastIndex = 0;

  const sortedFacets = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  function byteToCharIndex(byteIndex) {
    const slice = bytes.slice(0, byteIndex);
    const decoder = new TextDecoder();
    return decoder.decode(slice).length;
  }

  for (const facet of sortedFacets) {
    const start = byteToCharIndex(facet.index.byteStart);
    const end = byteToCharIndex(facet.index.byteEnd);

    if (start > lastIndex) {
      facetSegments.push({
        text: text.slice(lastIndex, start),
        isPlain: true,
      });
    }

    let isHashtag = false;
    let isMention = false;
    let isLink = false;

    for (const feature of facet.features || []) {
      if (feature.$type === 'app.bsky.richtext.facet#tag') {
        isHashtag = true;
      } else if (feature.$type === 'app.bsky.richtext.facet#mention') {
        isMention = true;
      } else if (feature.$type === 'app.bsky.richtext.facet#link') {
        isLink = true;
      }
    }

    facetSegments.push({
      text: text.slice(start, end),
      isHashtag,
      isMention,
      isLink,
    });

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    facetSegments.push({
      text: text.slice(lastIndex),
      isPlain: true,
    });
  }

  if (facetSegments.length === 0) {
    facetSegments.push({ text, isPlain: true });
  }

  const result = [];

  for (const segment of facetSegments) {
    if (!segment.isPlain) {
      result.push({
        text: segment.text,
        color: segment.isHashtag || segment.isMention ? COLORS.green : COLORS.text,
        fontWeight: 400,
        fontStyle: 'normal',
      });
    } else {
      const markdownParsed = parseMarkdown(segment.text);
      result.push(...markdownParsed);
    }
  }

  return result;
}

/**
 * Create Satori elements from parsed segments
 */
function createRichTextElements(segments, baseFontSize = 32) {
  return segments.map((segment, i) => ({
    type: 'span',
    props: {
      key: i,
      style: {
        color: segment.color,
        fontWeight: segment.fontWeight,
        fontStyle: segment.fontStyle,
        fontSize: baseFontSize,
      },
      children: segment.text,
    },
  }));
}

/**
 * Parse entire text with facets and create paragraphs
 */
function createRichTextFromPost(text, facets = [], baseFontSize = 32) {
  if (!text) return [];

  const allSegments = parseRichText(text, facets);

  const paragraphs = [];
  let currentParagraph = [];

  for (const segment of allSegments) {
    const parts = segment.text.split(/(\n+)/);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (/^\n+$/.test(part)) {
        if (currentParagraph.length > 0) {
          paragraphs.push([...currentParagraph]);
          currentParagraph = [];
        }
      } else if (part.trim()) {
        currentParagraph.push({
          ...segment,
          text: part,
        });
      }
    }
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph);
  }

  return paragraphs.map((paraSegments, pIdx) => ({
    type: 'div',
    props: {
      key: pIdx,
      style: {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        lineHeight: 1.5,
        marginBottom: 8,
      },
      children: createRichTextElements(paraSegments, baseFontSize),
    },
  }));
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

  const replyCount = post.replyCount || 0;
  const repostCount = post.repostCount || 0;
  const likeCount = post.likeCount || 0;

  const viewCount = db.updateEngagement(uri, likeCount, replyCount, repostCount);

  const formatCount = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
  };

  const satoriRender = await getSatori();

  const cardChildren = [
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
                            color: COLORS.text,
                            fontSize: 28,
                            fontWeight: 700,
                          },
                          children: displayName,
                        },
                      },
                      {
                        type: 'svg',
                        props: {
                          width: 26,
                          height: 26,
                          viewBox: '0 0 24 24',
                          fill: 'none',
                          style: { marginLeft: 10 },
                          children: {
                            type: 'path',
                            props: {
                              d: 'M20 6L9 17L4 12',
                              stroke: COLORS.green,
                              strokeWidth: 4,
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                            },
                          },
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
                                color: COLORS.muted,
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
                                color: COLORS.green,
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
                              color: COLORS.muted,
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

  if (text) {
    const fontSize = postImage ? 28 : 32;
    const richTextParagraphs = createRichTextFromPost(text, facets, fontSize);

    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginBottom: postImage || quotedPost ? 20 : 0,
        },
        children: richTextParagraphs,
      },
    });
  }

  if (quotedPost) {
    const quotedAuthor = quotedPost.author;
    const quotedDisplayName = quotedAuthor?.displayName || quotedAuthor?.handle || 'Unknown';
    const quotedHandle = quotedAuthor?.handle ? `@${quotedAuthor.handle}` : '';
    const quotedText = quotedPost.text || '';
    const quotedFacets = quotedPost.facets || [];
    const quotedAvatarUrl = quotedAuthor ? getAvatarUrl(quotedAuthor) : null;

    const maxQuoteLength = 200;
    const truncatedQuoteText =
      quotedText.length > maxQuoteLength
        ? quotedText.substring(0, maxQuoteLength) + '...'
        : quotedText;

    const quotedRichText = createRichTextFromPost(truncatedQuoteText, quotedFacets, 22);

    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: COLORS.border,
          borderRadius: 16,
          padding: 16,
          marginBottom: postImage ? 20 : 0,
          border: '1px solid #3F3F46',
        },
        children: [
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
                            color: COLORS.text,
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
                            color: COLORS.muted,
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
          truncatedQuoteText
            ? {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                  },
                  children: quotedRichText,
                },
              }
            : null,
        ].filter(Boolean),
      },
    });
  }

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
        borderTop: `1px solid ${COLORS.border}`,
        width: '100%',
      },
      children: [
        {
          type: 'span',
          props: {
            style: {
              color: COLORS.green,
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
              color: COLORS.muted,
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
          backgroundColor: COLORS.background,
          fontFamily: 'Inter',
        },
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: COLORS.card,
              borderRadius: 32,
              padding: 40,
              margin: 48,
              border: `2px solid ${COLORS.border}`,
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
    `[StoryImage] Generated image for ${uri.substring(0, 50)}... (hasImage: ${!!postImage}, hasFacets: ${facets.length > 0})`
  );

  return pngBuffer;
}

module.exports = {
  generateStoryImage,
  loadFonts,
};
