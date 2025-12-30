# Cannect Feed Generator

Bluesky Feed Generator for the cannabis community.

## What It Does

Indexes posts that match:

1. **Cannect users** - Any post from `*.cannect.space` handles
2. **Cannabis keywords** - Posts containing cannabis-related terms

## Quick Deploy

```bash
# On your VPS

# 1. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 2. Create directory
mkdir -p /root/feed-generator
cd /root/feed-generator

# 3. Copy files (from local machine)
# scp -r scripts/feed-vps/* root@<your-vps-ip>:/root/feed-generator/

# 4. Create .env
cp .env.example .env
nano .env  # Fill in your credentials

# 5. Install dependencies
npm install

# 6. Register feed (once)
node register-feed.js
# Copy the DID and update .env

# 7. Start with PM2
npm install -g pm2
pm2 start index.js --name feed-generator
pm2 save
pm2 startup
```

## Nginx Config

```nginx
server {
    listen 443 ssl http2;
    server_name feed.cannect.space;

    ssl_certificate /etc/letsencrypt/live/feed.cannect.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feed.cannect.space/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name feed.cannect.space;
    return 301 https://$host$request_uri;
}
```

## SSL Setup

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d feed.cannect.space
```

## Monitoring

```bash
# View logs
pm2 logs feed-generator

# Check status
pm2 status

# Restart
pm2 restart feed-generator

# Check DB
sqlite3 data/posts.db "SELECT COUNT(*) FROM posts;"

# Health check
curl https://feed.cannect.space/health
```

## Files

```
/root/feed-generator/
├── index.js          # Main server
├── db.js             # SQLite database
├── feed-logic.js     # Inclusion rules
├── register-feed.js  # One-time feed registration
├── package.json      # Dependencies
├── .env              # Configuration
└── data/
    └── posts.db      # SQLite database file
```
