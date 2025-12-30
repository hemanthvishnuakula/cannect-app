/**
 * Cannect Push Notification Server
 *
 * Handles web push notifications for the Cannect PWA.
 * Listens to Jetstream for likes, replies, follows, mentions.
 *
 * Features:
 * - Jetstream WebSocket for real-time event monitoring
 * - Web push notifications via VAPID
 * - SQLite for subscription storage
 *
 * Endpoints:
 * - POST /subscribe - Register push subscription
 * - POST /unsubscribe - Remove push subscription
 * - POST /send - Send notification to a user (internal)
 * - GET /health - Health check
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const path = require('path');

// ============================================
// Configuration
// ============================================

const PORT = process.env.PORT || 3001;

// VAPID keys for web push (generate with: npx web-push generate-vapid-keys)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@cannect.space';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ Missing VAPID keys. Generate with: npx web-push generate-vapid-keys');
  console.error('   Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ============================================
// Database Setup
// ============================================

const db = new Database(path.join(__dirname, 'subscriptions.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    did TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used TEXT DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_subscriptions_did ON subscriptions(did);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_endpoint ON subscriptions(endpoint);
`);

console.log('[DB] Database initialized');

// ============================================
// Express App
// ============================================

const app = express();
const rateLimit = require('express-rate-limit');

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute (for subscribe/unsubscribe)
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

app.use(
  cors({
    origin: [
      'https://cannect.net',
      'https://www.cannect.net',
      'https://cannect.nexus',
      'https://www.cannect.nexus',
      'https://cannect-app.vercel.app',
      'https://cannect.space',
      'http://localhost:8081',
      'http://localhost:19006',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// ============================================
// Routes
// ============================================

// Health check
app.get('/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM subscriptions').get();
  res.json({
    status: 'ok',
    subscriptions: count.count,
    vapidPublicKey: VAPID_PUBLIC_KEY,
  });
});

// Get VAPID public key
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
app.post('/subscribe', strictLimiter, (req, res) => {
  try {
    const { did, subscription } = req.body;

    if (!did || !subscription?.endpoint || !subscription?.keys) {
      return res.status(400).json({ error: 'Missing did or subscription' });
    }

    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;

    // Upsert subscription
    const stmt = db.prepare(`
      INSERT INTO subscriptions (did, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        did = excluded.did,
        keys_p256dh = excluded.keys_p256dh,
        keys_auth = excluded.keys_auth,
        last_used = CURRENT_TIMESTAMP
    `);

    stmt.run(did, endpoint, p256dh, auth);

    console.log(`[Subscribe] ${did} registered`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Subscribe] Error:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from push notifications
app.post('/unsubscribe', strictLimiter, (req, res) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint' });
    }

    const stmt = db.prepare('DELETE FROM subscriptions WHERE endpoint = ?');
    const result = stmt.run(endpoint);

    console.log(`[Unsubscribe] Removed ${result.changes} subscription(s)`);
    res.json({ success: true, removed: result.changes });
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Send notification to a user (internal endpoint - localhost only)
app.post('/send', async (req, res) => {
  try {
    // Only allow internal calls (Jetstream handler on same server)
    const ip = req.ip || req.connection.remoteAddress;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return res.status(403).json({ error: 'Internal only' });
    }

    const { did, title, body, icon, url, tag } = req.body;

    if (!did) {
      return res.status(400).json({ error: 'Missing did' });
    }

    const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE did = ?').all(did);

    if (subscriptions.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No subscriptions for user' });
    }

    const payload = JSON.stringify({
      title: title || 'Cannect',
      body: body || 'You have a new notification',
      icon: icon || '/icon-192.png',
      badge: '/badge-72.png',
      url: url || '/',
      tag: tag || 'default',
    });

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys_p256dh,
          auth: sub.keys_auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;

        // Update last used timestamp
        db.prepare('UPDATE subscriptions SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(
          sub.id
        );
      } catch (error) {
        failed++;

        // Remove expired/invalid subscriptions
        if (error.statusCode === 404 || error.statusCode === 410) {
          db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.id);
          console.log(`[Send] Removed expired subscription for ${did}`);
        } else {
          console.error(`[Send] Failed to send to ${did}:`, error.message);
        }
      }
    }

    console.log(`[Send] ${did}: sent=${sent}, failed=${failed}`);
    res.json({ success: true, sent, failed });
  } catch (error) {
    console.error('[Send] Error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// Broadcast notification to all users (admin only)
app.post('/broadcast', async (req, res) => {
  try {
    const { title, body, icon, url, adminKey } = req.body;

    // Simple admin key check (set ADMIN_KEY env var)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const subscriptions = db.prepare('SELECT * FROM subscriptions').all();

    const payload = JSON.stringify({
      title: title || 'Cannect',
      body: body || 'New announcement',
      icon: icon || '/icon-192.png',
      badge: '/badge-72.png',
      url: url || '/',
      tag: 'broadcast',
    });

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys_p256dh,
          auth: sub.keys_auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (error) {
        failed++;
        if (error.statusCode === 404 || error.statusCode === 410) {
          db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.id);
        }
      }
    }

    console.log(`[Broadcast] sent=${sent}, failed=${failed}`);
    res.json({ success: true, sent, failed });
  } catch (error) {
    console.error('[Broadcast] Error:', error);
    res.status(500).json({ error: 'Failed to broadcast' });
  }
});

// ============================================
// Jetstream - Real-time Notification Triggers
// ============================================

// Jetstream URL - subscribe to likes, reposts, follows, and posts (for replies/mentions)
const JETSTREAM_URL =
  'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.like&wantedCollections=app.bsky.feed.repost&wantedCollections=app.bsky.graph.follow&wantedCollections=app.bsky.feed.post';

let ws = null;
let reconnectAttempts = 0;
let stats = { processed: 0, notified: 0 };

// Get all subscribed DIDs for quick lookup
function getSubscribedDIDs() {
  const rows = db.prepare('SELECT DISTINCT did FROM subscriptions').all();
  return new Set(rows.map((r) => r.did));
}

// Send push notification to a user
async function sendPushToUser(did, title, body, url, tag) {
  const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE did = ?').all(did);

  if (subscriptions.length === 0) return 0;

  const payload = JSON.stringify({
    title,
    body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    url: url || '/',
    tag: tag || 'notification',
  });

  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        payload
      );
      sent++;
      db.prepare('UPDATE subscriptions SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(sub.id);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.id);
        console.log(`[Push] Removed expired subscription for ${did.substring(0, 20)}...`);
      }
    }
  }
  return sent;
}

// Extract DID from AT URI (at://did:plc:xxx/collection/rkey)
function extractDIDFromURI(uri) {
  if (!uri || !uri.startsWith('at://')) return null;
  const parts = uri.split('/');
  return parts[2] || null;
}

// Handle Jetstream events
async function handleJetstreamEvent(event) {
  if (event.kind !== 'commit') return;

  const { commit, did: actorDid } = event;
  if (!commit || commit.operation !== 'create') return;

  stats.processed++;

  // Get set of subscribed users (cache could be added for performance)
  const subscribedDIDs = getSubscribedDIDs();

  // Handle likes
  if (commit.collection === 'app.bsky.feed.like') {
    const subjectUri = commit.record?.subject?.uri;
    const targetDid = extractDIDFromURI(subjectUri);

    // Check if the post author is subscribed
    if (targetDid && subscribedDIDs.has(targetDid) && targetDid !== actorDid) {
      const sent = await sendPushToUser(
        targetDid,
        '❤️ New Like',
        'Someone liked your post',
        `/post/${encodeURIComponent(subjectUri)}`,
        `like-${actorDid}`
      );
      if (sent > 0) {
        stats.notified++;
        console.log(`[Push] Like notification sent to ${targetDid.substring(0, 25)}...`);
      }
    }
  }

  // Handle reposts
  if (commit.collection === 'app.bsky.feed.repost') {
    const subjectUri = commit.record?.subject?.uri;
    const targetDid = extractDIDFromURI(subjectUri);

    if (targetDid && subscribedDIDs.has(targetDid) && targetDid !== actorDid) {
      const sent = await sendPushToUser(
        targetDid,
        '🔁 New Repost',
        'Someone reposted your post',
        `/post/${encodeURIComponent(subjectUri)}`,
        `repost-${actorDid}`
      );
      if (sent > 0) {
        stats.notified++;
        console.log(`[Push] Repost notification sent to ${targetDid.substring(0, 25)}...`);
      }
    }
  }

  // Handle follows
  if (commit.collection === 'app.bsky.graph.follow') {
    const targetDid = commit.record?.subject;

    if (targetDid && subscribedDIDs.has(targetDid) && targetDid !== actorDid) {
      const sent = await sendPushToUser(
        targetDid,
        '👤 New Follower',
        'Someone started following you',
        '/notifications',
        `follow-${actorDid}`
      );
      if (sent > 0) {
        stats.notified++;
        console.log(`[Push] Follow notification sent to ${targetDid.substring(0, 25)}...`);
      }
    }
  }

  // Handle replies
  if (commit.collection === 'app.bsky.feed.post') {
    const record = commit.record;

    // Check if this is a reply
    if (record?.reply?.parent?.uri) {
      const parentUri = record.reply.parent.uri;
      const targetDid = extractDIDFromURI(parentUri);

      if (targetDid && subscribedDIDs.has(targetDid) && targetDid !== actorDid) {
        const postUri = `at://${actorDid}/${commit.collection}/${commit.rkey}`;
        const sent = await sendPushToUser(
          targetDid,
          '💬 New Reply',
          record.text?.substring(0, 100) || 'Someone replied to your post',
          `/post/${encodeURIComponent(postUri)}`,
          `reply-${actorDid}-${commit.rkey}`
        );
        if (sent > 0) {
          stats.notified++;
          console.log(`[Push] Reply notification sent to ${targetDid.substring(0, 25)}...`);
        }
      }
    }

    // Check for mentions in facets
    if (record?.facets) {
      for (const facet of record.facets) {
        for (const feature of facet.features || []) {
          if (feature.$type === 'app.bsky.richtext.facet#mention') {
            const mentionedDid = feature.did;

            if (mentionedDid && subscribedDIDs.has(mentionedDid) && mentionedDid !== actorDid) {
              const postUri = `at://${actorDid}/${commit.collection}/${commit.rkey}`;
              const sent = await sendPushToUser(
                mentionedDid,
                '📣 You were mentioned',
                record.text?.substring(0, 100) || 'Someone mentioned you',
                `/post/${encodeURIComponent(postUri)}`,
                `mention-${actorDid}-${commit.rkey}`
              );
              if (sent > 0) {
                stats.notified++;
                console.log(
                  `[Push] Mention notification sent to ${mentionedDid.substring(0, 25)}...`
                );
              }
            }
          }
        }
      }
    }
  }

  // Log stats periodically
  if (stats.processed % 10000 === 0) {
    console.log(`[Stats] Processed: ${stats.processed}, Notified: ${stats.notified}`);
  }
}

function connectJetstream() {
  console.log('[Jetstream] Connecting...');

  ws = new WebSocket(JETSTREAM_URL);

  ws.on('open', () => {
    console.log('[Jetstream] Connected!');
    reconnectAttempts = 0;
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());
      handleJetstreamEvent(event);
    } catch (err) {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log('[Jetstream] Connection closed, reconnecting...');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[Jetstream] Error:', err.message);
  });
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  console.log(`[Jetstream] Reconnecting in ${delay}ms...`);
  setTimeout(connectJetstream, delay);
}

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`[Server] Push server running on port ${PORT}`);
  console.log(`[Server] VAPID public key: ${VAPID_PUBLIC_KEY.substring(0, 20)}...`);

  // Start Jetstream connection
  connectJetstream();
});
