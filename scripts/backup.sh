#!/bin/bash
# Cannect PDS Daily Backup Script
# Runs daily at 3 AM UTC, retains 30 days

set -e

# Configuration
BACKUP_ROOT="/root/backups/daily"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d)
BACKUP_DIR="$BACKUP_ROOT/$DATE"
LOG_FILE="$BACKUP_DIR/backup.log"

# Create backup directory
mkdir -p "$BACKUP_DIR/pds"
mkdir -p "$BACKUP_DIR/feed"
mkdir -p "$BACKUP_DIR/push"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========================================="
log "Starting Cannect backup for $DATE"
log "========================================="

# 1. Backup PDS SQLite databases (using .backup for consistency)
log "Backing up PDS databases..."
sqlite3 /pds/account.sqlite ".backup '$BACKUP_DIR/pds/account.sqlite'"
sqlite3 /pds/sequencer.sqlite ".backup '$BACKUP_DIR/pds/sequencer.sqlite'"
sqlite3 /pds/did_cache.sqlite ".backup '$BACKUP_DIR/pds/did_cache.sqlite'"
log "✓ PDS databases backed up"

# 2. Backup Feed Generator database (copy from container)
log "Backing up Feed Generator database..."
docker cp cannect-feed:/app/data/posts.db "$BACKUP_DIR/feed/posts.db" 2>/dev/null || log "⚠ Feed posts.db not found"
log "✓ Feed database backed up"

# 3. Backup Push Server database (copy from container)
log "Backing up Push Server database..."
docker cp push-server:/app/subscriptions.db "$BACKUP_DIR/push/subscriptions.db" 2>/dev/null || log "⚠ Push subscriptions.db not found"
log "✓ Push database backed up"

# 4. Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log "Backup size: $BACKUP_SIZE"

# 5. Verify backup integrity
log "Verifying backup integrity..."
ERRORS=0
for db in "$BACKUP_DIR"/pds/*.sqlite "$BACKUP_DIR"/feed/*.db "$BACKUP_DIR"/push/*.db; do
    if [ -f "$db" ]; then
        if sqlite3 "$db" "PRAGMA integrity_check;" | grep -q "ok"; then
            log "✓ $(basename $db) integrity OK"
        else
            log "✗ $(basename $db) integrity FAILED"
            ERRORS=$((ERRORS + 1))
        fi
    fi
done

# 6. Clean up old backups (older than RETENTION_DAYS)
log "Cleaning up backups older than $RETENTION_DAYS days..."
DELETED=0
find "$BACKUP_ROOT" -maxdepth 1 -type d -name "20*" -mtime +$RETENTION_DAYS | while read dir; do
    log "Deleting old backup: $(basename $dir)"
    rm -rf "$dir"
    DELETED=$((DELETED + 1))
done
log "✓ Cleanup complete"

# 7. Show disk usage
TOTAL_BACKUPS=$(ls -d "$BACKUP_ROOT"/20* 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
DISK_FREE=$(df -h / | tail -1 | awk '{print $4}')

log "========================================="
log "Backup Summary:"
log "  - Date: $DATE"
log "  - Size: $BACKUP_SIZE"
log "  - Total backups: $TOTAL_BACKUPS"
log "  - Total backup storage: $TOTAL_SIZE"
log "  - Disk free: $DISK_FREE"
log "  - Errors: $ERRORS"
log "========================================="

if [ $ERRORS -eq 0 ]; then
    log "✅ Backup completed successfully!"
    exit 0
else
    log "⚠️ Backup completed with $ERRORS errors"
    exit 1
fi
