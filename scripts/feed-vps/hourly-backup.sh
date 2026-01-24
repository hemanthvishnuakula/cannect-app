#!/bin/bash
# Cannect Hourly Backup Script
# Runs every hour, retains 72 hours (3 days)

set -e

BACKUP_ROOT="/root/backups/hourly"
RETENTION_HOURS=72
DATETIME=$(date +%Y-%m-%d_%H)
BACKUP_DIR="$BACKUP_ROOT/$DATETIME"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Hourly backup starting..."

# Backup Feed Generator database
docker cp cannect-feed:/app/data/posts.db "$BACKUP_DIR/posts.db" 2>/dev/null && echo "✓ Feed DB backed up" || echo "⚠ Feed DB not found"

# Backup Push Server database  
docker cp push-server:/app/subscriptions.db "$BACKUP_DIR/subscriptions.db" 2>/dev/null && echo "✓ Push DB backed up" || true

# Clean up old hourly backups (older than 72 hours)
find "$BACKUP_ROOT" -maxdepth 1 -type d -name "20*" -mmin +$((RETENTION_HOURS * 60)) -exec rm -rf {} \; 2>/dev/null

# Show stats
TOTAL=$(ls -d "$BACKUP_ROOT"/20* 2>/dev/null | wc -l)
SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
echo "[$(date)] ✅ Hourly backup complete. Total: $TOTAL backups, Size: $SIZE"
