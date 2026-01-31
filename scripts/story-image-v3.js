/**
 * Story Image Generator v3
 * Fixed: Italic font loading, hashtag spacing
 */

const { Resvg } = require('@resvg/resvg-js');
const { BskyAgent } = require('@atproto/api');
const db = require('./db');

let satori = null;
async function getSatori() {
  if (!satori) {
    const module = await import('satori');
    satori = module.default;
  }
  return satori;
}

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

const COLORS = {
  text: '#FAFAFA',
  muted: '#71717A',
  green: '#10B981',
  background: '#0A0A0A',
  card: '#18181B',
  border: '#27272A',
};

let interRegular = null;
let interBold = null;
let interItalic = null;
let interBoldItalic = null;

async function loadFonts() {
  if (interRegular && interBold && interItalic && interBoldItalic) return;

  try {
    console.log('[StoryImage] Loading fonts...');

    // Regular - Using Open Sans which has proper italic variants
    const regularRes = await fetch(
      'https://fonts.gstatic.com/s/opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0C4n.ttf'
    );
    if (!regularRes.ok) throw new Error(`Regular font failed: ${regularRes.status}`);
    interRegular = await regularRes.arrayBuffer();
    console.log(`[StoryImage] Regular font: ${interRegular.byteLength} bytes`);

    // Bold
    const boldRes = await fetch(
      'https://fonts.gstatic.com/s/opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsg-1y4n.ttf'
    );
    if (!boldRes.ok) throw new Error(`Bold font failed: ${boldRes.status}`);
    interBold = await boldRes.arrayBuffer();
    console.log(`[StoryImage] Bold font: ${interBold.byteLength} bytes`);

    // Italic
    const italicRes = await fetch(
      'https://fonts.gstatic.com/s/opensans/v44/memQYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8tWZ0Pw86hd0Rk8ZkaVc.ttf'
    );
    if (!italicRes.ok) throw new Error(`Italic font failed: ${italicRes.status}`);
    interItalic = await italicRes.arrayBuffer();
    console.log(`[StoryImage] Italic font: ${interItalic.byteLength} bytes`);

    // Bold Italic
    const boldItalicRes = await fetch(
      'https://fonts.gstatic.com/s/opensans/v44/memQYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8tWZ0Pw86hd0RkyFjaVc.ttf'
    );
    if (!boldItalicRes.ok) throw new Error(`BoldItalic font failed: ${boldItalicRes.status}`);
    interBoldItalic = await boldItalicRes.arrayBuffer();
    console.log(`[StoryImage] BoldItalic font: ${interBoldItalic.byteLength} bytes`);

    console.log('[StoryImage] All fonts loaded successfully');
  } catch (err) {
    console.error('[StoryImage] Failed to load fonts:', err.message);
    throw err;
  }
}

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

async function fetchTwemoji(emoji) {
  const code = emojiToTwemojiCode(emoji);
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const svg = await res.text();
      return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }
  } catch (e) {}
  return null;
}

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

function getAvatarUrl(author) {
  if (author.avatar) return author.avatar;
  const name = author.displayName || author.handle;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10B981&color=fff&size=128`;
}

function isCannectUser(handle) {
  return handle.endsWith('.cannect.space') || handle.endsWith('.pds.cannect.space');
}

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
      };
    }
  }
  return null;
}

/**
 * Parse markdown: ***bold+italic***, **bold**, *italic*
 */
function parseMarkdown(text) {
  if (!text) return [];

  const segments = [];
  let remaining = text;
  const pattern = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*)/;

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);

    if (!match) {
      if (remaining.length > 0) {
        segments.push({ text: remaining, bold: false, italic: false });
      }
      break;
    }

    if (match.index > 0) {
      segments.push({ text: remaining.slice(0, match.index), bold: false, italic: false });
    }

    if (match[2]) {
      // ***bold+italic***
      segments.push({ text: match[2], bold: true, italic: true });
    } else if (match[3]) {
      // **bold**
      segments.push({ text: match[3], bold: true, italic: false });
    } else if (match[4]) {
      // *italic*
      segments.push({ text: match[4], bold: false, italic: true });
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return segments;
}

/**
 * Process facets and markdown
 */
function parseRichText(text, facets = []) {
  if (!text) return [];

  if (!facets || facets.length === 0) {
    const mdSegments = parseMarkdown(text);
    return mdSegments.map((seg) => ({
      text: seg.text,
      color: COLORS.text,
      fontWeight: seg.bold ? 700 : 400,
      fontStyle: seg.italic ? 'italic' : 'normal',
      isHashtag: false,
      isMention: false,
    }));
  }

  const sortedFacets = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  function byteToCharIndex(byteIndex) {
    const slice = bytes.slice(0, Math.min(byteIndex, bytes.length));
    const decoder = new TextDecoder();
    return decoder.decode(slice).length;
  }

  const segments = [];
  let lastCharIndex = 0;

  for (const facet of sortedFacets) {
    const startChar = byteToCharIndex(facet.index.byteStart);
    const endChar = byteToCharIndex(facet.index.byteEnd);

    // Plain text before facet - apply markdown
    if (startChar > lastCharIndex) {
      const plainText = text.slice(lastCharIndex, startChar);
      const mdSegments = parseMarkdown(plainText);
      for (const seg of mdSegments) {
        segments.push({
          text: seg.text,
          color: COLORS.text,
          fontWeight: seg.bold ? 700 : 400,
          fontStyle: seg.italic ? 'italic' : 'normal',
          isHashtag: false,
          isMention: false,
        });
      }
    }

    let isHashtag = false;
    let isMention = false;

    for (const feature of facet.features || []) {
      if (feature.$type === 'app.bsky.richtext.facet#tag') isHashtag = true;
      if (feature.$type === 'app.bsky.richtext.facet#mention') isMention = true;
    }

    const facetText = text.slice(startChar, endChar);
    segments.push({
      text: facetText,
      color: isHashtag || isMention ? COLORS.green : COLORS.text,
      fontWeight: 400,
      fontStyle: 'normal',
      isHashtag,
      isMention,
    });

    lastCharIndex = endChar;
  }

  // Remaining text after last facet
  if (lastCharIndex < text.length) {
    const remainingText = text.slice(lastCharIndex);
    const mdSegments = parseMarkdown(remainingText);
    for (const seg of mdSegments) {
      segments.push({
        text: seg.text,
        color: COLORS.text,
        fontWeight: seg.bold ? 700 : 400,
        fontStyle: seg.italic ? 'italic' : 'normal',
        isHashtag: false,
        isMention: false,
      });
    }
  }

  return segments;
}

/**
 * Add space between adjacent hashtags
 */
function addHashtagSpacing(segments) {
  const result = [];

  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    result.push(current);

    // Check if we need space after this segment
    const next = segments[i + 1];
    if (current.isHashtag && next && next.isHashtag) {
      if (!current.text.endsWith(' ') && !next.text.startsWith(' ')) {
        result.push({
          text: ' ',
          color: COLORS.text,
          fontWeight: 400,
          fontStyle: 'normal',
          isHashtag: false,
          isMention: false,
        });
      }
    }
  }

  return result;
}

/**
 * Create span elements
 */
function createTextSpans(segments, baseFontSize = 32) {
  return segments.map((segment, i) => ({
    type: 'span',
    props: {
      key: `span-${i}`,
      style: {
        color: segment.color,
        fontWeight: segment.fontWeight,
        fontStyle: segment.fontStyle,
        fontSize: baseFontSize,
        fontFamily: 'Inter',
        whiteSpace: 'pre-wrap',
      },
      children: segment.text,
    },
  }));
}

/**
 * Create paragraphs from rich text
 */
function createRichTextParagraphs(text, facets = [], baseFontSize = 32) {
  if (!text) return [];

  let segments = parseRichText(text, facets);

  // Debug: log segments before spacing
  console.log(`[StoryImage] Before spacing: ${segments.length} segments`);
  segments.forEach((s, i) => {
    if (s.isHashtag || (i > 0 && segments[i - 1].isHashtag)) {
      console.log(
        `[StoryImage]   Seg ${i}: "${s.text.replace(/\n/g, '\\n')}" isHashtag=${s.isHashtag}`
      );
    }
  });

  segments = addHashtagSpacing(segments);

  // Debug log
  const hashtagCount = segments.filter((s) => s.isHashtag).length;
  const italicCount = segments.filter((s) => s.fontStyle === 'italic').length;
  const boldCount = segments.filter((s) => s.fontWeight === 700).length;
  console.log(
    `[StoryImage] Parsed: ${segments.length} segments, ${hashtagCount} hashtags, ${boldCount} bold, ${italicCount} italic`
  );

  const paragraphs = [];
  let currentParagraph = [];

  for (const segment of segments) {
    const parts = segment.text.split(/(\n+)/);
    for (const part of parts) {
      if (/^\n+$/.test(part)) {
        if (currentParagraph.length > 0) {
          paragraphs.push([...currentParagraph]);
          currentParagraph = [];
        }
        const newlineCount = part.length - 1;
        for (let i = 0; i < newlineCount; i++) {
          paragraphs.push([]);
        }
      } else if (part.length > 0) {
        currentParagraph.push({ ...segment, text: part });
      }
    }
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph);
  }

  return paragraphs.map((paraSegments, pIdx) => ({
    type: 'div',
    props: {
      key: `para-${pIdx}`,
      style: {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        lineHeight: 1.5,
        marginBottom: paraSegments.length > 0 ? 8 : 16,
        minHeight: paraSegments.length === 0 ? 16 : 0,
      },
      children: paraSegments.length > 0 ? createTextSpans(paraSegments, baseFontSize) : null,
    },
  }));
}

async function generateStoryImage(uri) {
  await loadFonts();

  const post = await fetchPost(uri);
  if (!post) throw new Error('Post not found');

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
  db.updateEngagement(uri, likeCount, replyCount, repostCount);

  const satoriRender = await getSatori();
  const cardChildren = [];

  // Author header
  cardChildren.push({
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
      children: [
        {
          type: 'img',
          props: { src: avatarUrl, width: 64, height: 64, style: { borderRadius: 32 } },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', marginLeft: 16 },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
                  children: [
                    {
                      type: 'span',
                      props: {
                        style: {
                          color: COLORS.text,
                          fontSize: 28,
                          fontWeight: 700,
                          fontFamily: 'Inter',
                        },
                        children: displayName,
                      },
                    },
                    {
                      type: 'svg',
                      props: {
                        width: 24,
                        height: 24,
                        viewBox: '0 0 24 24',
                        style: { marginLeft: 8 },
                        children: [
                          { type: 'circle', props: { cx: 12, cy: 12, r: 10, fill: COLORS.green } },
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
                            style: { color: COLORS.muted, fontSize: 20, fontFamily: 'Inter' },
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
                              fontFamily: 'Inter',
                            },
                            children: 'cannect',
                          },
                        },
                      ]
                    : {
                        type: 'span',
                        props: {
                          style: { color: COLORS.muted, fontSize: 20, fontFamily: 'Inter' },
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
  });

  // Post text
  if (text) {
    const fontSize = postImage ? 28 : 32;
    const richTextParagraphs = createRichTextParagraphs(text, facets, fontSize);
    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          marginBottom: postImage || quotedPost ? 20 : 0,
        },
        children: richTextParagraphs,
      },
    });
  }

  // Quoted post
  if (quotedPost) {
    const qAuthor = quotedPost.author;
    const qDisplayName = qAuthor?.displayName || qAuthor?.handle || 'Unknown';
    const qHandle = qAuthor?.handle ? `@${qAuthor.handle}` : '';
    const qText = quotedPost.text || '';
    const qFacets = quotedPost.facets || [];
    const qAvatarUrl = qAuthor ? getAvatarUrl(qAuthor) : null;
    const maxLen = 200;
    const truncatedText = qText.length > maxLen ? qText.substring(0, maxLen) + '...' : qText;
    const quotedRichText = createRichTextParagraphs(truncatedText, qFacets, 22);

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
                qAvatarUrl
                  ? {
                      type: 'img',
                      props: {
                        src: qAvatarUrl,
                        style: { width: 32, height: 32, borderRadius: 16, marginRight: 10 },
                      },
                    }
                  : null,
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column' },
                    children: [
                      {
                        type: 'span',
                        props: {
                          style: {
                            color: COLORS.text,
                            fontSize: 18,
                            fontWeight: 600,
                            fontFamily: 'Inter',
                          },
                          children: qDisplayName,
                        },
                      },
                      {
                        type: 'span',
                        props: {
                          style: { color: COLORS.muted, fontSize: 16, fontFamily: 'Inter' },
                          children: qHandle,
                        },
                      },
                    ],
                  },
                },
              ].filter(Boolean),
            },
          },
          truncatedText
            ? {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column' },
                  children: quotedRichText,
                },
              }
            : null,
        ].filter(Boolean),
      },
    });
  }

  // Post image
  if (postImage) {
    cardChildren.push({
      type: 'img',
      props: {
        src: postImage,
        style: { width: '100%', maxHeight: 600, borderRadius: 16, objectFit: 'cover' },
      },
    });
  }

  // Footer
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
            style: { color: COLORS.green, fontSize: 22, fontWeight: 600, fontFamily: 'Inter' },
            children: 'cannect.net',
          },
        },
        {
          type: 'span',
          props: {
            style: { color: COLORS.muted, fontSize: 18, fontWeight: 500, fontFamily: 'Inter' },
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
        { name: 'Inter', data: interRegular, weight: 400, style: 'normal' },
        { name: 'Inter', data: interBold, weight: 700, style: 'normal' },
        { name: 'Inter', data: interItalic, weight: 400, style: 'italic' },
        { name: 'Inter', data: interBoldItalic, weight: 700, style: 'italic' },
      ],
      loadAdditionalAsset: async (code, segment) => {
        if (code === 'emoji') return fetchTwemoji(segment);
        return null;
      },
    }
  );

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: STORY_WIDTH } });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  console.log(
    `[StoryImage] Generated for ${uri.substring(0, 50)}... (hasImage: ${!!postImage}, hasFacets: ${facets.length > 0})`
  );
  return pngBuffer;
}

module.exports = { generateStoryImage, loadFonts };
