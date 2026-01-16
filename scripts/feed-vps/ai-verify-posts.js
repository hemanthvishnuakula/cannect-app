/**
 * AI Verification Script - Check existing posts for false positives
 *
 * Runs through all posts in the database and verifies them with Groq AI.
 * Reports false positives and optionally removes them.
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// Rate limiting - Groq free tier is 30 req/min
const REQUESTS_PER_MINUTE = 25;
const DELAY_MS = Math.ceil(60000 / REQUESTS_PER_MINUTE);

const SYSTEM_PROMPT = `You are a content classifier for a cannabis social media platform. Your job is to determine if a post is genuinely about cannabis/marijuana.

Answer ONLY "YES" or "NO" - nothing else.

Answer YES if the post is about:
- Cannabis, marijuana, weed, pot, ganja
- THC, CBD products, edibles, concentrates
- Dispensaries, cannabis stores, legal cannabis
- Growing/cultivating cannabis
- Cannabis culture, 420, stoner culture
- Specific strain names in cannabis context (OG Kush, Blue Dream, etc.)

Answer NO if the post is about:
- Cars/SUVs (even if they mention "hybrid" or brand names like "Kush")
- Sports (even if they mention "shatter records" or team names)
- Baking/cooking (cookies, brownies without cannabis context)
- Astronomy (Northern Lights aurora)
- Star Wars (Skywalker)
- Banking/finance (CBN = Central Bank of Nigeria)
- Music/entertainment (unless explicitly about cannabis)
- General slang that could be non-cannabis ("lit", "fire", "baked")

When in doubt, lean towards NO to avoid false positives.`;

async function verifyWithAI(text) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not set');
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Is this post about cannabis? "${text}"` },
      ],
      temperature: 0,
      max_tokens: 10,
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`API error ${response.status}: ${errorData}`);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content?.trim()?.toUpperCase();

  return answer === 'YES';
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = !process.argv.includes('--delete');
  const limit = parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0');

  console.log('='.repeat(60));
  console.log('AI Post Verification');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --delete to remove)' : 'DELETE MODE'}`);
  console.log(`Rate: ${REQUESTS_PER_MINUTE} requests/min (${DELAY_MS}ms delay)`);
  if (limit) console.log(`Limit: ${limit} posts`);
  console.log('='.repeat(60));

  // Open database
  const dbPath = path.join(__dirname, 'data', 'posts.db');
  const db = new Database(dbPath);

  // Get posts that need AI text (we need to fetch from network or have cached)
  // For now, we'll check posts that matched strain names or medium keywords
  // by looking at posts that don't have obvious high-confidence terms

  const HIGH_CONFIDENCE_TERMS = [
    'cannabis',
    'marijuana',
    'thc',
    'cbd',
    'dispensary',
    'budtender',
    'wake and bake',
    'stoner',
    '#cannabis',
    '#weed',
    '#420',
    'live rosin',
    'live resin',
    'dab rig',
    'bong hit',
    'medical marijuana',
    'legalize',
  ];

  // Get all posts
  let posts = db
    .prepare(
      `
    SELECT uri, cid, author_did, author_handle, indexed_at
    FROM posts
    ORDER BY indexed_at DESC
  `
    )
    .all();

  console.log(`\nTotal posts in database: ${posts.length}`);

  if (limit) {
    posts = posts.slice(0, limit);
    console.log(`Checking first ${limit} posts...\n`);
  }

  // We need to fetch post content from the network since we don't store text
  // For efficiency, let's use the Bluesky API

  const falsePositives = [];
  const truePositives = [];
  const errors = [];
  let checked = 0;

  for (const post of posts) {
    checked++;

    try {
      // Parse URI to get repo and rkey
      // Format: at://did:plc:xxx/app.bsky.feed.post/rkey
      const parts = post.uri.split('/');
      const did = parts[2];
      const rkey = parts[4];

      // Fetch post from Bluesky API
      const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(post.uri)}&depth=0`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        if (response.status === 400) {
          // Post was deleted
          console.log(`[${checked}/${posts.length}] DELETED: ${post.uri.substring(0, 60)}...`);
          if (!dryRun) {
            db.prepare('DELETE FROM posts WHERE uri = ?').run(post.uri);
          }
          falsePositives.push({ uri: post.uri, text: '[DELETED]', reason: 'deleted' });
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const text = data.thread?.post?.record?.text || '';

      if (!text) {
        console.log(`[${checked}/${posts.length}] NO TEXT: ${post.uri.substring(0, 60)}...`);
        continue;
      }

      // Skip Cannect users - they're always valid
      if (
        post.author_handle?.endsWith('.cannect.space') ||
        post.author_handle?.endsWith('.pds.cannect.space')
      ) {
        console.log(`[${checked}/${posts.length}] CANNECT USER: @${post.author_handle}`);
        truePositives.push({ uri: post.uri, text, reason: 'cannect_user' });
        continue;
      }

      // Check if post has obvious high-confidence terms (skip AI check)
      const textLower = text.toLowerCase();
      const hasHighConfidence = HIGH_CONFIDENCE_TERMS.some((term) => textLower.includes(term));

      if (hasHighConfidence) {
        console.log(`[${checked}/${posts.length}] HIGH CONF: ${text.substring(0, 50)}...`);
        truePositives.push({ uri: post.uri, text, reason: 'high_confidence' });
        continue;
      }

      // Verify with AI
      await sleep(DELAY_MS);
      const isCannabis = await verifyWithAI(text);

      if (isCannabis) {
        console.log(`[${checked}/${posts.length}] ✓ YES: ${text.substring(0, 50)}...`);
        truePositives.push({ uri: post.uri, text, reason: 'ai_verified' });
      } else {
        console.log(`[${checked}/${posts.length}] ✗ NO:  ${text.substring(0, 50)}...`);
        falsePositives.push({ uri: post.uri, text, reason: 'ai_rejected' });

        if (!dryRun) {
          db.prepare('DELETE FROM posts WHERE uri = ?').run(post.uri);
        }
      }
    } catch (err) {
      console.log(`[${checked}/${posts.length}] ERROR: ${err.message}`);
      errors.push({ uri: post.uri, error: err.message });

      // If rate limited, wait longer
      if (err.message.includes('429') || err.message.includes('rate')) {
        console.log('Rate limited, waiting 60s...');
        await sleep(60000);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Checked:         ${checked}`);
  console.log(`True Positives:  ${truePositives.length}`);
  console.log(`False Positives: ${falsePositives.length}`);
  console.log(`Errors:          ${errors.length}`);

  if (falsePositives.length > 0) {
    console.log('\n--- FALSE POSITIVES ---');
    for (const fp of falsePositives.slice(0, 20)) {
      console.log(`\n${fp.reason}: ${fp.text.substring(0, 100)}...`);
    }
    if (falsePositives.length > 20) {
      console.log(`\n... and ${falsePositives.length - 20} more`);
    }
  }

  if (dryRun && falsePositives.length > 0) {
    console.log(
      `\n⚠️  DRY RUN - No posts were deleted. Run with --delete to remove false positives.`
    );
  } else if (falsePositives.length > 0) {
    console.log(`\n✓ Removed ${falsePositives.length} false positives from database.`);
  }

  db.close();
}

main().catch(console.error);
