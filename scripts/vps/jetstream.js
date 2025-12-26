/**
 * Jetstream Listener for Push Notifications
 * 
 * Connects to Bluesky's Jetstream firehose and watches for:
 * - Likes on posts by our users
 * - Replies to posts by our users
 * - Follows of our users
 * 
 * Triggers push notifications via local API.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Jetstream endpoint (Bluesky's public firehose - us-west works from this VPS)
const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe';

// Local push API
const PUSH_API = 'http://localhost:3000/api/push/send';

// Track subscribed users (load from DB)
let subscribedDids = new Set();

// Load subscribed DIDs from database
function loadSubscribedDids() {
  try {
    const initSqlJs = require('sql.js');
    const DB_PATH = path.join(__dirname, 'push.db');
    
    if (!fs.existsSync(DB_PATH)) {
      console.log('[Jetstream] No database yet, will retry...');
      return;
    }
    
    initSqlJs().then(SQL => {
      const buffer = fs.readFileSync(DB_PATH);
      const db = new SQL.Database(buffer);
      const result = db.exec('SELECT DISTINCT user_did FROM subscriptions');
      
      if (result.length > 0) {
        subscribedDids = new Set(result[0].values.map(row => row[0]));
        console.log(`[Jetstream] Loaded ${subscribedDids.size} subscribed users`);
      }
      
      db.close();
    });
  } catch (err) {
    console.error('[Jetstream] Error loading DIDs:', err.message);
  }
}

// Refresh DIDs every 5 minutes
setInterval(loadSubscribedDids, 5 * 60 * 1000);

// Send push notification
async function sendPush(userDid, title, body, url) {
  try {
    const response = await fetch(PUSH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userDid, title, body, url })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`[Push] Sent to ${userDid}: ${title} (${result.sent} delivered)`);
    }
  } catch (err) {
    console.error('[Push] Error:', err.message);
  }
}

// Extract post author DID from AT URI
function extractDid(uri) {
  if (!uri) return null;
  const match = uri.match(/at:\/\/(did:[^/]+)/);
  return match ? match[1] : null;
}

// Handle Jetstream events
function handleEvent(event) {
  if (!event.commit) return;
  
  const { collection, record, operation } = event.commit;
  const actorDid = event.did;
  
  // Only care about creates
  if (operation !== 'create') return;
  
  // Like
  if (collection === 'app.bsky.feed.like') {
    const targetDid = extractDid(record?.subject?.uri);
    if (targetDid && subscribedDids.has(targetDid) && targetDid !== actorDid) {
      sendPush(
        targetDid,
        'New Like ❤️',
        'Someone liked your post',
        'https://cannect.space/notifications'
      );
    }
  }
  
  // Reply
  if (collection === 'app.bsky.feed.post' && record?.reply) {
    const parentDid = extractDid(record.reply.parent?.uri);
    if (parentDid && subscribedDids.has(parentDid) && parentDid !== actorDid) {
      const previewText = record.text?.slice(0, 80) || 'Someone replied to your post';
      sendPush(
        parentDid,
        'New Reply 💬',
        previewText,
        'https://cannect.space/notifications'
      );
    }
  }
  
  // Follow
  if (collection === 'app.bsky.graph.follow') {
    const targetDid = record?.subject;
    if (targetDid && subscribedDids.has(targetDid) && targetDid !== actorDid) {
      sendPush(
        targetDid,
        'New Follower 👋',
        'Someone started following you',
        'https://cannect.space/notifications'
      );
    }
  }
}

// Connect to Jetstream
function connect() {
  console.log('[Jetstream] Connecting...');
  
  const ws = new WebSocket(JETSTREAM_URL, {
    headers: { 'User-Agent': 'Cannect-Push/1.0' }
  });
  
  ws.on('open', () => {
    console.log('[Jetstream] Connected to firehose');
  });
  
  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      handleEvent(event);
    } catch (err) {
      // Ignore parse errors
    }
  });
  
  ws.on('close', () => {
    console.log('[Jetstream] Disconnected, reconnecting in 5s...');
    setTimeout(connect, 5000);
  });
  
  ws.on('error', (err) => {
    console.error('[Jetstream] Error:', err.message);
    ws.close();
  });
}

// Start
console.log('[Jetstream] Starting Cannect Push Listener');
loadSubscribedDids();
setTimeout(connect, 2000); // Wait for initial DID load
