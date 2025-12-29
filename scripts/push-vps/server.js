/**
 * Cannect Push Notification Server
 * 
 * Handles web push notifications for the Cannect PWA.
 * Receives subscription registrations and sends push notifications.
 * 
 * Endpoints:
 * - POST /subscribe - Register push subscription
 * - POST /unsubscribe - Remove push subscription
 * - POST /send - Send notification to a user (internal)
 * - GET /health - Health check
 */

const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
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

app.use(cors({
  origin: ['https://cannect.app', 'https://cannect.space', 'http://localhost:8081'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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
    vapidPublicKey: VAPID_PUBLIC_KEY 
  });
});

// Get VAPID public key
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
app.post('/subscribe', (req, res) => {
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
app.post('/unsubscribe', (req, res) => {
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

// Send notification to a user (internal endpoint)
app.post('/send', async (req, res) => {
  try {
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
        db.prepare('UPDATE subscriptions SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(sub.id);
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
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`[Server] Push server running on port ${PORT}`);
  console.log(`[Server] VAPID public key: ${VAPID_PUBLIC_KEY.substring(0, 20)}...`);
});
