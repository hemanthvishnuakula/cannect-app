# Cannect Feed Generator

Official Bluesky Feed Generator for the Cannect cannabis community.

## How It Works

```
1. Your Server → Jetstream (firehose) → Store post URIs
2. Bluesky requests → /xrpc/app.bsky.feed.getFeedSkeleton → Return URIs
3. Bluesky AppView → Hydrates posts with full data + viewer state
4. User sees → Real-time feed with proper like/repost state ✅
```

## Feeds

| Feed | Description |
|------|-------------|
| `cannabis` | Cannabis content from 100+ curated Bluesky accounts |
| `cannect` | Posts from Cannect PDS users |

## Deployment

### 1. Deploy to VPS

```bash
# On your VPS
cd /opt
git clone <repo> cannect-feed
cd cannect-feed/scripts/feed-generator
npm install
```

### 2. Set Environment Variables

```bash
export FEED_GENERATOR_DID="did:plc:ubkp6dfvxif7rmexyat5np6e"
export PORT=3000
```

### 3. Run with PM2

```bash
pm2 start index.js --name feed-generator
pm2 save
```

### 4. Configure Nginx

```nginx
server {
    listen 443 ssl;
    server_name feed.cannect.space;

    ssl_certificate /etc/letsencrypt/live/feed.cannect.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feed.cannect.space/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 5. Register Feed with Bluesky

```bash
FEED_GENERATOR_HANDLE=hemanthvishnu.cannect.space \
FEED_GENERATOR_PASSWORD=your-app-password \
FEED_GENERATOR_HOSTNAME=feed.cannect.space \
node register-feed.mjs
```

## API Endpoints

### Feed Generator (AT Protocol)

| Endpoint | Description |
|----------|-------------|
| `GET /xrpc/app.bsky.feed.describeFeedGenerator` | Describe available feeds |
| `GET /xrpc/app.bsky.feed.getFeedSkeleton?feed=...&limit=50&cursor=...` | Get feed skeleton |
| `GET /.well-known/did.json` | DID document for did:web resolution |

### Admin

| Endpoint | Description |
|----------|-------------|
| `GET /admin/stats` | Feed statistics |
| `GET /admin/recent/:feed` | Recent posts in a feed |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Bluesky Network                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Relay     │───▶│  Jetstream  │───▶│   AppView   │         │
│  │  (firehose) │    │  (filtered) │    │  (hydrator) │         │
│  └─────────────┘    └──────┬──────┘    └──────▲──────┘         │
│                            │                   │                 │
└────────────────────────────┼───────────────────┼─────────────────┘
                             │                   │
                             ▼                   │
┌────────────────────────────────────────────────┼─────────────────┐
│                Feed Generator (VPS)            │                 │
│  ┌─────────────┐    ┌─────────────┐           │                 │
│  │  Jetstream  │───▶│   SQLite    │───────────┘                 │
│  │  Listener   │    │  (post URIs)│                             │
│  └─────────────┘    └─────────────┘                             │
│                            │                                     │
│  ┌─────────────────────────┼──────────────────────────┐         │
│  │      /xrpc/app.bsky.feed.getFeedSkeleton          │         │
│  │      Returns: { feed: [{ post: "at://..." }] }     │         │
│  └────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

## The Key Insight

**You only return post URIs.** Bluesky's AppView does the heavy lifting:
- Fetches full post content
- Adds author profiles
- Hydrates `viewer.like` and `viewer.repost` for the requesting user
- Returns everything the client needs

This is why optimistic updates work - Bluesky tells us the viewer state.
