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
 * Remove emojis from text (Inter font doesn't support them)
 * Preserves regular text and punctuation
 */
function stripEmojis(text) {
  // Remove emoji characters (ranges covering most emojis)
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc symbols
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport/map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation selectors
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess, etc
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Extended-A
    .replace(/[\u{231A}-\u{231B}]/gu, '')   // Watch, hourglass
    .replace(/[\u{23E9}-\u{23F3}]/gu, '')   // Media controls
    .replace(/[\u{23F8}-\u{23FA}]/gu, '')   // More controls
    .replace(/[\u{25AA}-\u{25AB}]/gu, '')   // Squares
    .replace(/[\u{25B6}]/gu, '')            // Play button
    .replace(/[\u{25C0}]/gu, '')            // Reverse button
    .replace(/[\u{25FB}-\u{25FE}]/gu, '')   // Squares
    .replace(/[\u{2614}-\u{2615}]/gu, '')   // Umbrella, coffee
    .replace(/[\u{2648}-\u{2653}]/gu, '')   // Zodiac
    .replace(/[\u{267F}]/gu, '')            // Wheelchair
    .replace(/[\u{2693}]/gu, '')            // Anchor
    .replace(/[\u{26A1}]/gu, '')            // Lightning
    .replace(/[\u{26AA}-\u{26AB}]/gu, '')   // Circles
    .replace(/[\u{26BD}-\u{26BE}]/gu, '')   // Sports
    .replace(/[\u{26C4}-\u{26C5}]/gu, '')   // Weather
    .replace(/[\u{26CE}]/gu, '')            // Ophiuchus
    .replace(/[\u{26D4}]/gu, '')            // No entry
    .replace(/[\u{26EA}]/gu, '')            // Church
    .replace(/[\u{26F2}-\u{26F3}]/gu, '')   // Fountain, golf
    .replace(/[\u{26F5}]/gu, '')            // Sailboat
    .replace(/[\u{26FA}]/gu, '')            // Tent
    .replace(/[\u{26FD}]/gu, '')            // Fuel pump
    .replace(/[\u{2702}]/gu, '')            // Scissors
    .replace(/[\u{2705}]/gu, '')            // Check mark
    .replace(/[\u{2708}-\u{270D}]/gu, '')   // Plane, etc
    .replace(/[\u{270F}]/gu, '')            // Pencil
    .replace(/[\u{2712}]/gu, '')            // Black nib
    .replace(/[\u{2714}]/gu, '')            // Check mark
    .replace(/[\u{2716}]/gu, '')            // X mark
    .replace(/[\u{271D}]/gu, '')            // Cross
    .replace(/[\u{2721}]/gu, '')            // Star of David
    .replace(/[\u{2728}]/gu, '')            // Sparkles
    .replace(/[\u{2733}-\u{2734}]/gu, '')   // Stars
    .replace(/[\u{2744}]/gu, '')            // Snowflake
    .replace(/[\u{2747}]/gu, '')            // Sparkle
    .replace(/[\u{274C}]/gu, '')            // X
    .replace(/[\u{274E}]/gu, '')            // X
    .replace(/[\u{2753}-\u{2755}]/gu, '')   // Question marks
    .replace(/[\u{2757}]/gu, '')            // Exclamation
    .replace(/[\u{2763}-\u{2764}]/gu, '')   // Hearts
    .replace(/[\u{2795}-\u{2797}]/gu, '')   // Plus, minus, divide
    .replace(/[\u{27A1}]/gu, '')            // Right arrow
    .replace(/[\u{27B0}]/gu, '')            // Curly loop
    .replace(/[\u{27BF}]/gu, '')            // Double curly loop
    .replace(/[\u{2934}-\u{2935}]/gu, '')   // Arrows
    .replace(/[\u{2B05}-\u{2B07}]/gu, '')   // Arrows
    .replace(/[\u{2B1B}-\u{2B1C}]/gu, '')   // Squares
    .replace(/[\u{2B50}]/gu, '')            // Star
    .replace(/[\u{2B55}]/gu, '')            // Circle
    .replace(/[\u{3030}]/gu, '')            // Wavy dash
    .replace(/[\u{303D}]/gu, '')            // Part alternation
    .replace(/[\u{3297}]/gu, '')            // Circled ideograph
    .replace(/[\u{3299}]/gu, '')            // Circled ideograph
    .replace(/[\u{200D}]/gu, '')            // Zero-width joiner
    .replace(/\s+/g, ' ')                   // Collapse whitespace
    .trim();
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
  const rawText = record.text || '';
  const text = stripEmojis(rawText); // Remove emojis for font compatibility
  const displayName = stripEmojis(author.displayName || author.handle);
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
  if (text) {
    cardChildren.push({
      type: 'div',
      props: {
        style: {
          color: '#FAFAFA',
          fontSize: postImage ? 28 : 32,
          lineHeight: 1.4,
          marginBottom: postImage ? 20 : 0,
        },
        children: text,
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
