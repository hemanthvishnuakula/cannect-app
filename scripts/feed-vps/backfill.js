/**
 * Backfill Script - Import old posts from Cannect users
 *
 * This script:
 * 1. Fetches all Cannect users from both PDSes
 * 2. For each user, fetches their recent posts
 * 3. Inserts them into the feed database (safe - uses INSERT OR REPLACE)
 *
 * Run once: node backfill.js
 */

const db = require('./db');

const CANNECT_PDS_URLS = ['https://cannect.space', 'https://pds.cannect.space'];
const POSTS_PER_USER = 100; // Max posts to fetch per user

async function getCannectUsers() {
  console.log('[Backfill] Fetching users from all Cannect PDSes...');

  const allUsers = [];

  for (const pdsUrl of CANNECT_PDS_URLS) {
    try {
      const response = await fetch(`${pdsUrl}/xrpc/com.atproto.sync.listRepos?limit=1000`);
      if (!response.ok) {
        console.warn(`[Backfill] Failed to fetch from ${pdsUrl}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      const users = data.repos || [];
      console.log(`[Backfill] Found ${users.length} users on ${pdsUrl}`);
      allUsers.push(...users);
    } catch (err) {
      console.warn(`[Backfill] Error fetching from ${pdsUrl}:`, err.message);
    }
  }

  console.log(`[Backfill] Total: ${allUsers.length} users`);
  return allUsers;
}

async function getUserPosts(did) {
  try {
    const url = `${CANNECT_PDS_URL}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=${POSTS_PER_USER}`;
    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.records || [];
  } catch (err) {
    console.error(`[Backfill] Error fetching posts for ${did}:`, err.message);
    return [];
  }
}

async function backfill() {
  console.log('='.repeat(60));
  console.log('Cannect Feed Backfill');
  console.log('='.repeat(60));

  const startCount = db.getCount();
  console.log(`[Backfill] Starting with ${startCount} posts in DB`);

  // Get all cannect.space users
  const users = await getCannectUsers();

  let totalPosts = 0;
  let insertedPosts = 0;

  // Process each user
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const did = user.did;

    process.stdout.write(
      `[Backfill] Processing user ${i + 1}/${users.length}: ${did.substring(0, 30)}...`
    );

    const posts = await getUserPosts(did);
    totalPosts += posts.length;

    for (const record of posts) {
      const uri = record.uri;
      const cid = record.cid;
      const indexedAt = record.value?.createdAt || new Date().toISOString();

      // Insert into database (safe - uses INSERT OR REPLACE)
      const success = db.addPost(uri, cid, did, 'cannect.space', indexedAt);
      if (success) {
        insertedPosts++;
      }
    }

    console.log(` ${posts.length} posts`);

    // Small delay to avoid overwhelming the PDS
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const endCount = db.getCount();

  console.log('='.repeat(60));
  console.log('[Backfill] Complete!');
  console.log(`  Users processed: ${users.length}`);
  console.log(`  Posts found: ${totalPosts}`);
  console.log(`  Posts in DB before: ${startCount}`);
  console.log(`  Posts in DB after: ${endCount}`);
  console.log(`  New posts added: ${endCount - startCount}`);
  console.log('='.repeat(60));

  db.close();
}

backfill().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
