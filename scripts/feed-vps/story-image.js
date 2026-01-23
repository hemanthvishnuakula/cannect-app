/**
 * Story Image Generator
 * 
 * Generates Instagram Story-sized images (1080x1920) for sharing posts.
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

// Load font once at startup
let interFont = null;
let interBoldFont = null;

async function loadFonts() {
  if (interFont && interBoldFont) return;
  
  try {
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
 * Truncate text to max length
 */
function truncateText(text, maxLength = 400) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
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
  const text = truncateText(record.text || '');
  const displayName = author.displayName || author.handle;
  const handle = `@${author.handle}`;
  const avatarUrl = getAvatarUrl(author);
  const isCannect = isCannectUser(author.handle);
  
  const satoriRender = await getSatori();
  
  // Simplified structure - Satori requires explicit display: flex on all containers with multiple children
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
              padding: 48,
              margin: 60,
              border: '2px solid #27272A',
              maxWidth: 960,
            },
            children: [
              // Author row
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 32,
                  },
                  children: [
                    {
                      type: 'img',
                      props: {
                        src: avatarUrl,
                        width: 80,
                        height: 80,
                        style: {
                          borderRadius: 40,
                        },
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          marginLeft: 20,
                        },
                        children: [
                          {
                            type: 'span',
                            props: {
                              style: {
                                color: '#FAFAFA',
                                fontSize: 32,
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
                                      fontSize: 24,
                                    },
                                    children: handle,
                                  },
                                },
                                {
                                  type: 'span',
                                  props: {
                                    style: {
                                      marginLeft: 12,
                                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                                      color: '#10B981',
                                      fontSize: 18,
                                      fontWeight: 600,
                                      padding: '4px 12px',
                                      borderRadius: 12,
                                    },
                                    children: 'cannect',
                                  },
                                },
                              ] : {
                                type: 'span',
                                props: {
                                  style: {
                                    color: '#71717A',
                                    fontSize: 24,
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
              // Post text
              {
                type: 'div',
                props: {
                  style: {
                    color: '#FAFAFA',
                    fontSize: 36,
                    lineHeight: 1.5,
                  },
                  children: text,
                },
              },
              // Bottom branding
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 40,
                    paddingTop: 32,
                    borderTop: '1px solid #27272A',
                  },
                  children: [
                    {
                      type: 'span',
                      props: {
                        style: {
                          fontSize: 28,
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
                          fontSize: 24,
                          fontWeight: 600,
                        },
                        children: 'cannect.space',
                      },
                    },
                  ],
                },
              },
            ],
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
  
  console.log(`[StoryImage] Generated image for ${uri.substring(0, 50)}...`);
  
  return pngBuffer;
}

module.exports = {
  generateStoryImage,
  loadFonts,
};
