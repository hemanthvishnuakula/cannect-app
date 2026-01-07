/**
 * Cleanup Script - Remove false positive posts using context-aware filtering
 *
 * This script:
 * 1. Reads all posts from the database
 * 2. Fetches post content from Bluesky public API
 * 3. Runs context-aware filter on each post
 * 4. Removes posts that fail the filter (false positives)
 *
 * Run: node cleanup-posts.js [--dry-run]
 */

const db = require('./db');
const { shouldIncludePost, getPostText } = require('./feed-logic');

const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
const BATCH_SIZE = 25; // Posts per API call
const DELAY_MS = 100; // Delay between batches to avoid rate limits

const DRY_RUN = process.argv.includes('--dry-run');

async function fetchPostContent(uris) {
  try {
    // Use getPosts to fetch multiple posts at once
    const params = uris.map((uri) => `uris=${encodeURIComponent(uri)}`).join('&');
    const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.feed.getPosts?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Cleanup] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.posts || [];
  } catch (err) {
    console.error(`[Cleanup] Fetch error:`, err.message);
    return [];
  }
}

async function cleanup() {
  console.log('='.repeat(60));
  console.log('Cannect Feed Cleanup - Context-Aware Filter');
  console.log(
    DRY_RUN ? '*** DRY RUN MODE - No deletions ***' : '*** LIVE MODE - Will delete posts ***'
  );
  console.log('='.repeat(60));

  // Get all posts from database
  const allPosts = db.getAllPosts();
  console.log(`[Cleanup] Total posts in DB: ${allPosts.length}`);

  const toRemove = [];
  const toKeep = [];
  const errors = [];
  const cannectUsers = [];

  // Process in batches
  for (let i = 0; i < allPosts.length; i += BATCH_SIZE) {
    const batch = allPosts.slice(i, i + BATCH_SIZE);
    const uris = batch.map((p) => p.uri);

    process.stdout.write(`\r[Cleanup] Processing ${i + batch.length}/${allPosts.length}...`);

    // Fetch post content
    const posts = await fetchPostContent(uris);

    // Create URI to content map
    const contentMap = new Map();
    for (const post of posts) {
      contentMap.set(post.uri, post);
    }

    // Check each post against the filter
    for (const dbPost of batch) {
      const post = contentMap.get(dbPost.uri);

      // If post not found (deleted?), mark for removal
      if (!post) {
        toRemove.push({ uri: dbPost.uri, reason: 'deleted_or_not_found' });
        continue;
      }

      const authorHandle = post.author?.handle || '';

      // Skip Cannect users - always keep
      if (authorHandle.endsWith('.cannect.space') || authorHandle.endsWith('.pds.cannect.space')) {
        cannectUsers.push(dbPost.uri);
        toKeep.push({ uri: dbPost.uri, reason: 'cannect_user' });
        continue;
      }

      const text = post.record?.text || '';
      const result = shouldIncludePost(authorHandle, text);

      if (result.include) {
        toKeep.push({ uri: dbPost.uri, reason: result.reason, score: result.contextScore });
      } else {
        toRemove.push({
          uri: dbPost.uri,
          reason: result.reason,
          score: result.contextScore,
          handle: authorHandle,
          text: text.substring(0, 100),
        });
      }
    }

    // Rate limit delay
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  console.log('\n');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Posts to KEEP: ${toKeep.length}`);
  console.log(`  - Cannect users: ${cannectUsers.length}`);
  console.log(`  - Passed filter: ${toKeep.length - cannectUsers.length}`);
  console.log(`Posts to REMOVE: ${toRemove.length}`);

  // Group removals by reason
  const byReason = {};
  for (const post of toRemove) {
    byReason[post.reason] = (byReason[post.reason] || 0) + 1;
  }
  console.log('Removal breakdown:');
  for (const [reason, count] of Object.entries(byReason)) {
    console.log(`  - ${reason}: ${count}`);
  }

  // Show sample of posts to remove
  console.log('\nSample posts to remove:');
  const samples = toRemove.slice(0, 10);
  for (const post of samples) {
    console.log(`  [@${post.handle}] ${post.reason} (score: ${post.score})`);
    console.log(`    "${post.text}..."`);
  }

  if (!DRY_RUN && toRemove.length > 0) {
    console.log('\n[Cleanup] Removing posts...');
    let removed = 0;
    for (const post of toRemove) {
      const success = db.removePost(post.uri);
      if (success) removed++;
    }
    console.log(`[Cleanup] Removed ${removed} posts from database`);
  }

  const finalCount = db.getCount();
  console.log('='.repeat(60));
  console.log(`Final post count: ${finalCount}`);
  console.log('='.repeat(60));

  db.close();
}

cleanup().catch((err) => {
  console.error('[Cleanup] Fatal error:', err);
  process.exit(1);
});
