#!/usr/bin/env python3
"""
Cannect Customer Intelligence - Sync Service
Syncs posts from Legacy VPS SQLite to New VPS PostgreSQL.
"""

import os
import json
import logging
import sqlite3
import subprocess
from datetime import datetime
from typing import Optional

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
LEGACY_VPS = os.getenv('LEGACY_VPS_HOST', '72.62.129.232')
LEGACY_DB_PATH = '/root/feed/data/posts.db'
LOCAL_DB_COPY = '/tmp/posts_sync.db'


def get_pg_connection():
    """Get PostgreSQL connection."""
    return psycopg2.connect(
        host='localhost',
        port=5432,
        database='cannect_intel',
        user='cci',
        password='cci_secure_2026'
    )


def download_sqlite_db():
    """Download SQLite database from Legacy VPS."""
    logger.info(f'Downloading SQLite database from {LEGACY_VPS}...')
    
    result = subprocess.run([
        'scp', '-i', '/root/.ssh/id_ed25519',
        f'root@{LEGACY_VPS}:{LEGACY_DB_PATH}',
        LOCAL_DB_COPY
    ], capture_output=True, text=True)
    
    if result.returncode != 0:
        logger.error(f'Failed to download database: {result.stderr}')
        raise Exception('Database download failed')
    
    logger.info('Database downloaded successfully')


def get_last_sync_timestamp() -> Optional[datetime]:
    """Get the timestamp of the last synced post."""
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(indexed_at) FROM posts")
            result = cur.fetchone()[0]
            return result


def parse_timestamp(ts_str: str) -> datetime:
    """Parse timestamp from SQLite format."""
    if not ts_str:
        return datetime.now()
    try:
        # Try ISO format first
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
    except:
        try:
            # Try common SQLite format
            return datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
        except:
            return datetime.now()


def sync_posts():
    """Sync posts from SQLite to PostgreSQL."""
    download_sqlite_db()
    
    last_sync = get_last_sync_timestamp()
    logger.info(f'Last sync timestamp: {last_sync}')
    
    # Connect to SQLite
    sqlite_conn = sqlite3.connect(LOCAL_DB_COPY)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()
    
    # Get posts to sync
    if last_sync:
        sqlite_cur.execute("""
            SELECT uri, cid, author_did, author_handle, indexed_at, created_at,
                   text, facets, has_media, embed_type, langs
            FROM posts
            WHERE indexed_at > ?
            ORDER BY indexed_at ASC
        """, (last_sync.isoformat(),))
    else:
        sqlite_cur.execute("""
            SELECT uri, cid, author_did, author_handle, indexed_at, created_at,
                   text, facets, has_media, embed_type, langs
            FROM posts
            ORDER BY indexed_at ASC
        """)
    
    rows = sqlite_cur.fetchall()
    logger.info(f'Found {len(rows)} posts to sync')
    
    if not rows:
        logger.info('No new posts to sync')
        # Log sync
        with get_pg_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO sync_log (completed_at, posts_synced, last_indexed_at, status)
                    VALUES (NOW(), 0, %s, 'success')
                """, (last_sync,))
                conn.commit()
        return 0
    
    # Prepare data for PostgreSQL
    posts_data = []
    for row in rows:
        # Parse facets JSON if present
        facets = None
        if row['facets']:
            try:
                facets = json.loads(row['facets']) if isinstance(row['facets'], str) else row['facets']
            except:
                pass
        
        # Parse langs
        langs = None
        if row['langs']:
            try:
                langs = json.loads(row['langs']) if isinstance(row['langs'], str) else row['langs']
            except:
                langs = [row['langs']] if isinstance(row['langs'], str) else None
        
        posts_data.append((
            row['uri'],
            row['cid'],
            row['author_did'],
            row['author_handle'],
            parse_timestamp(row['created_at']),  # post_created_at
            parse_timestamp(row['indexed_at']),  # indexed_at
            row['text'],
            json.dumps(facets) if facets else None,
            langs,
            bool(row['has_media']) if row['has_media'] is not None else False,
            0,  # media_count (not in SQLite)
            row['embed_type'],
            None  # embed_data
        ))
    
    # Insert into PostgreSQL
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            execute_values(cur, """
                INSERT INTO posts (
                    uri, cid, author_did, author_handle, post_created_at, indexed_at,
                    text_content, facets, langs, has_media, media_count, embed_type, embed_data
                ) VALUES %s
                ON CONFLICT (uri) DO UPDATE SET
                    text_content = COALESCE(EXCLUDED.text_content, posts.text_content),
                    facets = COALESCE(EXCLUDED.facets, posts.facets),
                    langs = COALESCE(EXCLUDED.langs, posts.langs),
                    has_media = EXCLUDED.has_media,
                    embed_type = EXCLUDED.embed_type
            """, posts_data)
            
            # Get max indexed_at for sync log
            max_indexed = max(parse_timestamp(row['indexed_at']) for row in rows)
            
            # Log sync
            cur.execute("""
                INSERT INTO sync_log (completed_at, posts_synced, last_indexed_at, status)
                VALUES (NOW(), %s, %s, 'success')
            """, (len(rows), max_indexed))
            
            conn.commit()
    
    logger.info(f'Synced {len(rows)} posts successfully')
    
    # Cleanup
    sqlite_conn.close()
    os.remove(LOCAL_DB_COPY)
    
    return len(rows)


def get_sync_stats():
    """Get sync statistics."""
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    COUNT(*) as total_posts,
                    MIN(indexed_at) as earliest,
                    MAX(indexed_at) as latest,
                    COUNT(DISTINCT author_did) as unique_authors
                FROM posts
            """)
            stats = cur.fetchone()
            
            cur.execute("""
                SELECT started_at, completed_at, posts_synced, status
                FROM sync_log
                ORDER BY started_at DESC
                LIMIT 5
            """)
            recent_syncs = cur.fetchall()
            
            return {
                'total_posts': stats[0],
                'earliest': stats[1],
                'latest': stats[2],
                'unique_authors': stats[3],
                'recent_syncs': recent_syncs
            }


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='CCI Sync Service')
    parser.add_argument('--stats', action='store_true', help='Show stats only')
    parser.add_argument('--continuous', action='store_true', help='Run continuously every 5 minutes')
    
    args = parser.parse_args()
    
    if args.stats:
        stats = get_sync_stats()
        print(f'Total posts: {stats["total_posts"]}')
        print(f'Earliest: {stats["earliest"]}')
        print(f'Latest: {stats["latest"]}')
        print(f'Unique authors: {stats["unique_authors"]}')
        print('\nRecent syncs:')
        for sync in stats['recent_syncs']:
            print(f'  {sync[0]} - {sync[2]} posts - {sync[3]}')
    elif args.continuous:
        import time
        logger.info('Starting continuous sync (every 5 minutes)...')
        while True:
            try:
                sync_posts()
            except Exception as e:
                logger.error(f'Sync failed: {e}')
            time.sleep(300)  # 5 minutes
    else:
        sync_posts()
