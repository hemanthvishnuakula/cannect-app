/**
 * Backfill Post Content
 *
 * Fetches full content for posts that only have URIs stored.
 * Uses public API - no authentication required.
 *
 * Safe rate limiting: 5 requests/second with exponential backoff.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const DELAY_MS = 200; // 200ms = 5 requests/second
const BATCH_SIZE = 100; // Process in batches for progress reporting
const APPVIEW_URL = 'https://public.api.bsky.app';

// Open database
const db = new Database(path.join(__dirname, 'data', 'posts.db'));

// Prepared statements
const getPostsToBackfill = db.prepare(`
  SELECT uri FROM posts 
  WHERE text IS NULL 
  ORDER BY indexed_at DESC
`);

const updatePostContent = db.prepare(`
  UPDATE posts 
  SET text = ?, facets = ?, has_media = ?, embed_type = ?, langs = ?
  WHERE uri = ?
`);

/**
 * Parse AT URI to get repo and rkey
 */
function parseAtUri(uri) {
  // at://did:plc:xxx/app.bsky.feed.post/rkey
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { repo: match[1], collection: match[2], rkey: match[3] };
}

/**
 * Fetch a post record from the public API
 */
async function fetchPost(uri) {
  const parsed = parseAtUri(uri);
  if (!parsed) return null;

  const url = `${APPVIEW_URL}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(parsed.repo)}&collection=${encodeURIComponent(parsed.collection)}&rkey=${encodeURIComponent(parsed.rkey)}`;

  const response = await fetch(url);

  if (response.status === 429) {
    // Rate limited - throw special error
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    // Post might be deleted
    return null;
  }

  const data = await response.json();
  return data.value;
}

/**
 * Extract content from a post record
 */
function extractContent(record) {
  if (!record) return null;

  let embedType = null;
  let hasMedia = 0;

  if (record.embed) {
    const type = record.embed.$type || '';
    if (type.includes('images')) {
      embedType = 'images';
      hasMedia = 1;
    } else if (type.includes('video')) {
      embedType = 'video';
      hasMedia = 1;
    } else if (type.includes('external')) {
      embedType = 'external';
    } else if (type.includes('recordWithMedia')) {
      embedType = 'quote_with_media';
      hasMedia = 1;
    } else if (type.includes('record')) {
      embedType = 'quote';
    }
  }

  return {
    text: record.text || null,
    facets: record.facets ? JSON.stringify(record.facets) : null,
    hasMedia,
    embedType,
    langs: record.langs ? JSON.stringify(record.langs) : null,
  };
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main backfill function
 */
async function backfill() {
  console.log('='.repeat(60));
  console.log('Post Content Backfill');
  console.log('='.repeat(60));

  // Get all posts needing backfill
  const posts = getPostsToBackfill.all();
  console.log(`Found ${posts.length} posts to backfill\n`);

  if (posts.length === 0) {
    console.log('Nothing to do!');
    return;
  }

  let processed = 0;
  let updated = 0;
  let deleted = 0;
  let errors = 0;
  let rateLimitWaits = 0;

  const startTime = Date.now();

  for (const post of posts) {
    try {
      const record = await fetchPost(post.uri);

      if (record) {
        const content = extractContent(record);
        if (content && content.text) {
          updatePostContent.run(
            content.text,
            content.facets,
            content.hasMedia,
            content.embedType,
            content.langs,
            post.uri
          );
          updated++;
        }
      } else {
        deleted++;
      }

      processed++;

      // Progress update every batch
      if (processed % BATCH_SIZE === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (posts.length - processed) / rate;
        console.log(
          `Progress: ${processed}/${posts.length} (${((processed / posts.length) * 100).toFixed(1)}%) | Updated: ${updated} | Deleted: ${deleted} | ${rate.toFixed(1)} req/s | ETA: ${Math.round(remaining / 60)}m`
        );
      }

      // Rate limiting delay
      await sleep(DELAY_MS);
    } catch (err) {
      if (err.message === 'RATE_LIMITED') {
        // Exponential backoff
        rateLimitWaits++;
        const waitTime = Math.min(30000, 1000 * Math.pow(2, rateLimitWaits));
        console.log(`\n⚠️  Rate limited! Waiting ${waitTime / 1000}s...`);
        await sleep(waitTime);
        // Retry this post
        processed--;
      } else {
        errors++;
        if (errors < 10) {
          console.error(`Error fetching ${post.uri}: ${err.message}`);
        }
      }
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log('Backfill Complete!');
  console.log('='.repeat(60));
  console.log(`Total processed: ${processed}`);
  console.log(`Updated with content: ${updated}`);
  console.log(`Deleted posts (skipped): ${deleted}`);
  console.log(`Errors: ${errors}`);
  console.log(`Rate limit waits: ${rateLimitWaits}`);
  console.log(`Total time: ${Math.round(totalTime / 60)} minutes`);
  console.log('='.repeat(60));

  db.close();
}

// Run it
backfill().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
