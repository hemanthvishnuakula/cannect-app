/**
 * Story Image Generator
 * 
 * Generates Instagram Story-sized images (1080x1920) for sharing posts.
 * Includes: avatar, author info, full post text, and post images.
 * Uses Satori for SVG generation and resvg for PNG conversion.
 */

const { Resvg } = require('@resvg/resvg-js');
const { BskyAgent } = require('@atproto/api');

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
    const regularRes = await fetch('https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff');
    interFont = await regularRes.arrayBuffer();
    
    const boldRes = await fetch('https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hjp-Ek-_EeA.woff');
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
    if (cp !== 0xFE0E && cp !== 0xFE0F) {
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
  
  // External embed with thumb
  if (embed.$type === 'app.bsky.embed.external#view' && embed.external?.thumb) {
    return embed.external.thumb;
  }
  
  // Record with media
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.$type === 'app.bsky.embed.images#view' && embed.media.images?.length > 0) {
      return embed.media.images[0].fullsize || embed.media.images[0].thumb;
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
  const displayName = author.displayName || author.handle;
  const handle = `@${author.handle}`;
  const avatarUrl = getAvatarUrl(author);
  const isCannect = isCannectUser(author.handle);
  const postImage = getPostImage(post);
  
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
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginTop: 4,
                    },
                    children: isCannect ? [
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
                    ] : {
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
  
  // Add post text if exists
  // Split by newlines to preserve paragraph formatting
  if (text) {
    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    
    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginBottom: postImage ? 20 : 0,
        },
        children: paragraphs.map(paragraph => ({
          type: 'div',
          props: {
            style: {
              color: '#FAFAFA',
              fontSize: postImage ? 28 : 32,
              lineHeight: 1.5,
            },
            children: paragraph,
          },
        })),
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
        marginTop: 32,
        paddingTop: 24,
        borderTop: '1px solid #27272A',
      },
      children: [
        {
          type: 'span',
          props: {
            style: {
              fontSize: 24,
              marginRight: 8,
            },
            children: '🌿',
          },
        },
        {
          type: 'span',
          props: {
            style: {
              color: '#10B981',
              fontSize: 22,
              fontWeight: 600,
            },
            children: 'cannect.space',
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
  
  console.log(`[StoryImage] Generated image for ${uri.substring(0, 50)}... (hasImage: ${!!postImage})`);
  
  return pngBuffer;
}

module.exports = {
  generateStoryImage,
  loadFonts,
};
