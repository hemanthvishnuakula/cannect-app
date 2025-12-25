/**
 * Backfill Feed Generator Database
 * 
 * Fetches all posts from Cannect PDS users and inserts them into
 * the feed generator's SQLite database.
 */

import Database from 'better-sqlite3';

const CANNECT_PDS = 'https://cannect.space';
const BSKY_API = 'https://public.api.bsky.app';
const DB_PATH = '/opt/cannect-feed/db.sqlite';

interface Repo {
  did: string;
}

interface Post {
  uri: string;
  cid: string;
  indexedAt: string;
}

async function getCannectDids(): Promise<string[]> {
  console.log('Fetching Cannect user DIDs...');
  const response = await fetch(`${CANNECT_PDS}/xrpc/com.atproto.sync.listRepos?limit=1000`);
  const data = await response.json() as { repos?: Repo[] };
  const dids = data.repos?.map(r => r.did) || [];
  console.log(`Found ${dids.length} users`);
  return dids;
}

async function getAuthorPosts(did: string): Promise<Post[]> {
  try {
    const response = await fetch(
      `${BSKY_API}/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=100&filter=posts_no_replies`
    );
    
    if (!response.ok) {
      console.log(`  Skipping ${did}: ${response.status}`);
      return [];
    }
    
    const data = await response.json() as { feed?: { post: { uri: string; cid: string; indexedAt: string } }[] };
    
    return (data.feed || []).map(item => ({
      uri: item.post.uri,
      cid: item.post.cid,
      indexedAt: item.post.indexedAt,
    }));
  } catch (error) {
    console.log(`  Error fetching ${did}:`, error);
    return [];
  }
}

async function main() {
  console.log('=== Backfilling Cannect Feed Database ===\n');
  
  // Get all Cannect users
  const dids = await getCannectDids();
  
  // Open database
  const db = new Database(DB_PATH);
  
  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS post (
      uri TEXT PRIMARY KEY,
      cid TEXT NOT NULL,
      indexedAt TEXT NOT NULL
    )
  `);
  
  // Prepare insert statement
  const insert = db.prepare(`
    INSERT OR IGNORE INTO post (uri, cid, indexedAt) VALUES (?, ?, ?)
  `);
  
  let totalPosts = 0;
  let insertedPosts = 0;
  
  // Fetch posts for each user
  for (const did of dids) {
    console.log(`Fetching posts for ${did}...`);
    const posts = await getAuthorPosts(did);
    
    for (const post of posts) {
      totalPosts++;
      const result = insert.run(post.uri, post.cid, post.indexedAt);
      if (result.changes > 0) {
        insertedPosts++;
      }
    }
    
    console.log(`  Found ${posts.length} posts`);
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  db.close();
  
  console.log('\n=== Backfill Complete ===');
  console.log(`Total posts found: ${totalPosts}`);
  console.log(`New posts inserted: ${insertedPosts}`);
}

main().catch(console.error);
