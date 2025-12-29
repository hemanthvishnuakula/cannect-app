#!/usr/bin/env node
/**
 * Register Feed Generator with Bluesky
 * 
 * This script registers your feed generator so users can subscribe to it.
 * Run once after deploying your feed generator server.
 * 
 * Usage:
 *   FEED_GENERATOR_HANDLE=yourhandle.bsky.social \
 *   FEED_GENERATOR_PASSWORD=your-app-password \
 *   FEED_GENERATOR_HOSTNAME=feed.cannect.space \
 *   node register-feed.mjs
 */

import { BskyAgent } from '@atproto/api';

const HANDLE = process.env.FEED_GENERATOR_HANDLE;
const PASSWORD = process.env.FEED_GENERATOR_PASSWORD;
const HOSTNAME = process.env.FEED_GENERATOR_HOSTNAME || 'feed.cannect.space';

// Feed definitions to register
const FEEDS = [
  {
    shortname: 'cannabis',
    displayName: '🌿 Cannabis Community',
    description: 'Cannabis news, culture, and community from 100+ curated accounts. Powered by Cannect.',
  },
  {
    shortname: 'cannect',
    displayName: '🔗 Cannect Network',
    description: 'Posts from Cannect PDS users. Join the cannabis social network.',
  },
];

async function main() {
  if (!HANDLE || !PASSWORD) {
    console.error('❌ Missing environment variables:');
    console.error('   FEED_GENERATOR_HANDLE - Your Bluesky handle');
    console.error('   FEED_GENERATOR_PASSWORD - Your app password');
    process.exit(1);
  }

  const agent = new BskyAgent({ service: 'https://bsky.social' });

  console.log(`🔐 Logging in as ${HANDLE}...`);
  await agent.login({ identifier: HANDLE, password: PASSWORD });
  console.log(`✅ Logged in as ${agent.session.did}`);

  for (const feed of FEEDS) {
    console.log(`\n📝 Registering feed: ${feed.shortname}...`);

    const record = {
      repo: agent.session.did,
      collection: 'app.bsky.feed.generator',
      rkey: feed.shortname,
      record: {
        did: `did:web:${HOSTNAME}`,
        displayName: feed.displayName,
        description: feed.description,
        createdAt: new Date().toISOString(),
      },
    };

    try {
      await agent.api.com.atproto.repo.putRecord(record);
      console.log(`✅ Registered: at://${agent.session.did}/app.bsky.feed.generator/${feed.shortname}`);
    } catch (error) {
      if (error.message?.includes('already exists')) {
        console.log(`⚠️  Feed already exists, updating...`);
        await agent.api.com.atproto.repo.putRecord(record);
        console.log(`✅ Updated: at://${agent.session.did}/app.bsky.feed.generator/${feed.shortname}`);
      } else {
        console.error(`❌ Failed to register ${feed.shortname}:`, error.message);
      }
    }
  }

  console.log('\n🎉 Done! Your feeds are now available on Bluesky.');
  console.log('\nFeed URIs:');
  for (const feed of FEEDS) {
    console.log(`  at://${agent.session.did}/app.bsky.feed.generator/${feed.shortname}`);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
