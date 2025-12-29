# Cannect Push Notification Server

Web push notification server for the Cannect PWA.

## Setup

### 1. Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

Save the output - you'll need both keys.

### 2. Deploy to VPS

```bash
# SSH to your VPS
ssh root@your-vps-ip

# Create directory
mkdir -p /root/push-server
cd /root/push-server

# Copy files (from local machine)
scp scripts/push-vps/* root@your-vps-ip:/root/push-server/

# Install dependencies
npm install

# Set environment variables
export VAPID_PUBLIC_KEY="your-public-key"
export VAPID_PRIVATE_KEY="your-private-key"
export VAPID_SUBJECT="mailto:admin@cannect.space"
export ADMIN_KEY="your-secret-admin-key"

# Start with pm2
pm2 start server.js --name push-server
pm2 save
pm2 startup
```

### 3. Configure Nginx

```nginx
server {
    listen 80;
    server_name push.cannect.space;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then get SSL:
```bash
certbot --nginx -d push.cannect.space
```

### 4. Update Client

Set environment variable in Vercel:
```
EXPO_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
EXPO_PUBLIC_PUSH_API_URL=https://push.cannect.space
```

## API Endpoints

### GET /health
Health check, returns subscription count.

### GET /vapid-public-key
Returns the VAPID public key for client subscription.

### POST /subscribe
Register a push subscription.
```json
{
  "did": "did:plc:xxx",
  "subscription": {
    "endpoint": "https://...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

### POST /unsubscribe
Remove a push subscription.
```json
{
  "endpoint": "https://..."
}
```

### POST /send
Send notification to a user (internal).
```json
{
  "did": "did:plc:xxx",
  "title": "New Like",
  "body": "Someone liked your post",
  "url": "/notifications"
}
```

### POST /broadcast
Send notification to all users (requires ADMIN_KEY).
```json
{
  "adminKey": "your-admin-key",
  "title": "Announcement",
  "body": "New feature available!"
}
```
