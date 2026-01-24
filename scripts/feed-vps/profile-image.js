/**
 * Profile Image Generator
 *
 * Generates shareable profile card images (1080x1920) for sharing profiles.
 * Includes: large avatar, name, handle, bio, stats (posts, followers, reach).
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

// Image dimensions (same as story for consistency)
const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1920;

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

    console.log('[ProfileImage] Fonts loaded successfully');
  } catch (err) {
    console.error('[ProfileImage] Failed to load fonts:', err.message);
    throw err;
  }
}

/**
 * Fetch profile data from Bluesky
 */
async function fetchProfile(handle) {
  const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });

  try {
    const response = await agent.getProfile({ actor: handle });
    return response.data;
  } catch (err) {
    console.error('[ProfileImage] Failed to fetch profile:', err.message);
    return null;
  }
}

/**
 * Get avatar URL or generate initials fallback
 */
function getAvatarUrl(profile) {
  if (profile.avatar) {
    return profile.avatar;
  }
  const name = profile.displayName || profile.handle;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10B981&color=fff&size=256`;
}

/**
 * Check if user is a Cannect user
 */
function isCannectUser(handle) {
  return handle.endsWith('.cannect.space') || handle.endsWith('.pds.cannect.space');
}

/**
 * Format large numbers (e.g., 1234 -> 1.2K)
 */
function formatCount(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

/**
 * Generate profile image as PNG buffer
 */
async function generateProfileImage(handle, reach = 0) {
  await loadFonts();

  const profile = await fetchProfile(handle);
  if (!profile) {
    throw new Error('Profile not found');
  }

  const displayName = profile.displayName || profile.handle;
  const handleText = `@${profile.handle}`;
  const avatarUrl = getAvatarUrl(profile);
  const isCannect = isCannectUser(profile.handle);
  const bio = profile.description || '';

  // Stats
  const postsCount = profile.postsCount || 0;
  const followersCount = profile.followersCount || 0;

  const satoriRender = await getSatori();

  // Build card children
  const cardChildren = [];

  // Large centered avatar
  cardChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        justifyContent: 'center',
        marginBottom: 32,
      },
      children: {
        type: 'img',
        props: {
          src: avatarUrl,
          width: 200,
          height: 200,
          style: {
            borderRadius: 100,
            border: '4px solid #27272A',
          },
        },
      },
    },
  });

  // Name with checkmark
  cardChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
      },
      children: [
        {
          type: 'span',
          props: {
            style: {
              color: '#FAFAFA',
              fontSize: 42,
              fontWeight: 700,
              textAlign: 'center',
            },
            children: displayName,
          },
        },
        // Bold green checkmark
        {
          type: 'svg',
          props: {
            width: 32,
            height: 32,
            viewBox: '0 0 24 24',
            fill: 'none',
            style: { marginLeft: 12 },
            children: {
              type: 'path',
              props: {
                d: 'M20 6L9 17L4 12',
                stroke: '#10B981',
                strokeWidth: 4,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              },
            },
          },
        },
      ],
    },
  });

  // Handle with optional cannect badge
  cardChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
      },
      children: isCannect
        ? [
            {
              type: 'span',
              props: {
                style: {
                  color: '#71717A',
                  fontSize: 24,
                },
                children: handleText,
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
          ]
        : {
            type: 'span',
            props: {
              style: {
                color: '#71717A',
                fontSize: 24,
              },
              children: handleText,
            },
          },
    },
  });

  // Bio (if exists)
  if (bio) {
    // Truncate bio if too long
    const maxBioLength = 300;
    const truncatedBio = bio.length > maxBioLength ? bio.substring(0, maxBioLength) + '...' : bio;

    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 32,
        },
        children: {
          type: 'span',
          props: {
            style: {
              color: '#A1A1AA',
              fontSize: 26,
              lineHeight: 1.5,
              textAlign: 'center',
              maxWidth: 800,
            },
            children: truncatedBio,
          },
        },
      },
    });
  }

  // Stats row: Posts, Followers, Reach
  cardChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 48,
        marginTop: bio ? 0 : 16,
        paddingTop: 32,
        borderTop: '1px solid #27272A',
      },
      children: [
        // Posts
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            },
            children: [
              {
                type: 'span',
                props: {
                  style: {
                    color: '#FAFAFA',
                    fontSize: 36,
                    fontWeight: 700,
                  },
                  children: formatCount(postsCount),
                },
              },
              {
                type: 'span',
                props: {
                  style: {
                    color: '#71717A',
                    fontSize: 20,
                    marginTop: 4,
                  },
                  children: 'Posts',
                },
              },
            ],
          },
        },
        // Followers
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            },
            children: [
              {
                type: 'span',
                props: {
                  style: {
                    color: '#FAFAFA',
                    fontSize: 36,
                    fontWeight: 700,
                  },
                  children: formatCount(followersCount),
                },
              },
              {
                type: 'span',
                props: {
                  style: {
                    color: '#71717A',
                    fontSize: 20,
                    marginTop: 4,
                  },
                  children: 'Followers',
                },
              },
            ],
          },
        },
        // Reach
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            },
            children: [
              {
                type: 'span',
                props: {
                  style: {
                    color: '#FAFAFA',
                    fontSize: 36,
                    fontWeight: 700,
                  },
                  children: formatCount(reach),
                },
              },
              {
                type: 'span',
                props: {
                  style: {
                    color: '#71717A',
                    fontSize: 20,
                    marginTop: 4,
                  },
                  children: 'Reach',
                },
              },
            ],
          },
        },
      ],
    },
  });

  // Branding row (bottom)
  cardChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 'auto',
        paddingTop: 32,
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
              padding: 48,
              margin: 48,
              border: '2px solid #27272A',
              maxWidth: 984,
              width: 984,
            },
            children: cardChildren,
          },
        },
      },
    },
    {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
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
      value: IMAGE_WIDTH,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  console.log(`[ProfileImage] Generated image for @${handle}`);

  return pngBuffer;
}

module.exports = {
  generateProfileImage,
  loadFonts,
};
