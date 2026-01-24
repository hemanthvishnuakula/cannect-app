#!/bin/bash
# Safe Deploy Script for Cannect Feed
# ALWAYS backs up before deploying to prevent data loss

set -e

FEED_DIR="/root/feed"
DATA_DIR="/root/feed/data"
BACKUP_DIR="/root/backups/pre-deploy"
DATETIME=$(date +%Y-%m-%d_%H-%M-%S)

echo "=============================================="
echo "Cannect Feed - Safe Deploy"
echo "=============================================="

# 1. Verify data directory exists and has posts
if [ ! -f "$DATA_DIR/posts.db" ]; then
    echo "❌ ERROR: posts.db not found at $DATA_DIR/posts.db"
    echo "   This is unexpected. Aborting deploy."
    exit 1
fi

POST_COUNT=$(sqlite3 "$DATA_DIR/posts.db" "SELECT COUNT(*) FROM posts;" 2>/dev/null || echo "0")
echo "📊 Current posts in database: $POST_COUNT"

if [ "$POST_COUNT" -lt 1000 ]; then
    echo "⚠️  WARNING: Only $POST_COUNT posts found. Expected 10,000+"
    echo "   This might indicate a problem. Continue? (y/N)"
    read -r response
    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        echo "Aborting."
        exit 1
    fi
fi

# 2. Create pre-deploy backup
echo ""
echo "📦 Creating pre-deploy backup..."
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/posts-$DATETIME.db"
cp "$DATA_DIR/posts.db" "$BACKUP_FILE"
# Also backup WAL files if they exist
cp "$DATA_DIR/posts.db-wal" "$BACKUP_DIR/posts-$DATETIME.db-wal" 2>/dev/null || true
cp "$DATA_DIR/posts.db-shm" "$BACKUP_DIR/posts-$DATETIME.db-shm" 2>/dev/null || true

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# 3. Keep only last 10 pre-deploy backups
echo ""
echo "🧹 Cleaning old pre-deploy backups (keeping last 10)..."
ls -t "$BACKUP_DIR"/posts-*.db 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

# 4. Rebuild docker image
echo ""
echo "🔨 Building Docker image..."
cd "$FEED_DIR"
docker build -t cannect-feed .

# 5. Stop and remove old container
echo ""
echo "🛑 Stopping old container..."
docker stop cannect-feed 2>/dev/null || true
docker rm cannect-feed 2>/dev/null || true

# 6. Start new container with volume mount
echo ""
echo "🚀 Starting new container..."
docker run -d \
    --name cannect-feed \
    --restart unless-stopped \
    -p 3001:3000 \
    -v /root/feed/data:/app/data \
    --env-file /root/feed/.env \
    cannect-feed

# 7. Wait and verify
echo ""
echo "⏳ Waiting for container to start..."
sleep 5

# Check container is running
if ! docker ps | grep -q cannect-feed; then
    echo "❌ ERROR: Container failed to start!"
    echo "   Logs:"
    docker logs cannect-feed --tail 20
    exit 1
fi

# Check database is accessible inside container
CONTAINER_POSTS=$(docker exec cannect-feed sh -c 'wget -qO- http://localhost:3000/health' 2>/dev/null | grep -o '"posts":[0-9]*' | cut -d: -f2 || echo "0")
echo "📊 Posts reported by container: $CONTAINER_POSTS"

if [ "$CONTAINER_POSTS" -lt 1000 ]; then
    echo "❌ ERROR: Container has too few posts ($CONTAINER_POSTS)!"
    echo "   The volume mount may have failed."
    echo "   Restoring from backup..."
    docker stop cannect-feed
    docker rm cannect-feed
    cp "$BACKUP_FILE" "$DATA_DIR/posts.db"
    docker run -d --name cannect-feed --restart unless-stopped -p 3001:3000 -v /root/feed/data:/app/data --env-file /root/feed/.env cannect-feed
    echo "   Restored and restarted."
    exit 1
fi

echo ""
echo "=============================================="
echo "✅ Deploy successful!"
echo "   Posts: $CONTAINER_POSTS"
echo "   Backup: $BACKUP_FILE"
echo "=============================================="
docker logs cannect-feed --tail 10
