#!/usr/bin/env python3
"""
Cannect Intelligence - Batch Processor
Fetches posts from Legacy VPS and processes them through the extractor
"""

import sqlite3
import subprocess
import json
import os
import sys
from datetime import datetime
import time
from extractor import (
    init_db, fetch_post_text, extract_insights, 
    save_insight, get_processed_uris, INSIGHTS_DB
)

# Configuration
POSTS_DB_PATH = "/root/cannect-intel/posts.db"  # Local copy of posts database
BATCH_SIZE = 100  # Posts per session
DELAY_BETWEEN_POSTS = 1  # seconds

def fetch_posts_from_db(limit=50000):
    """Fetch post URIs from local posts database"""
    print(f"Fetching posts from local database...")
    
    # Get already processed URIs
    processed = get_processed_uris()
    print(f"  Already processed: {len(processed)} posts")
    
    try:
        conn = sqlite3.connect(POSTS_DB_PATH)
        c = conn.cursor()
        c.execute('SELECT uri FROM posts ORDER BY indexed_at DESC LIMIT ?', (limit,))
        uris = [row[0] for row in c.fetchall()]
        conn.close()
        
        print(f"  Found {len(uris)} posts in database")
        
        # Filter out already processed
        new_uris = [uri for uri in uris if uri not in processed]
        print(f"  New posts to process: {len(new_uris)}")
        
        return new_uris
    except Exception as e:
        print(f"  Error: {e}")
        return []


def process_posts(uris, max_posts=BATCH_SIZE):
    """Process a batch of posts"""
    print(f"\n=== Processing up to {max_posts} posts ===")
    
    success = 0
    errors = 0
    skipped = 0
    
    start_time = datetime.now()
    
    for i, uri in enumerate(uris[:max_posts]):
        print(f"\n[{i+1}/{min(len(uris), max_posts)}] {uri[:70]}...")
        
        # Fetch post text from AT Protocol
        text = fetch_post_text(uri)
        if not text:
            print("  -> Skipped (no text)")
            skipped += 1
            continue
        
        if len(text) < 10:
            print(f"  -> Skipped (too short: '{text}')")
            skipped += 1
            continue
        
        print(f"  Text: {text[:60]}...")
        
        # Extract insights
        extract_start = time.time()
        insights = extract_insights(text)
        extract_time = time.time() - extract_start
        
        if insights:
            save_insight(uri, text, insights)
            success += 1
            product = insights.get('product') or 'no product'
            mood = insights.get('mood') or '?'
            print(f"  -> OK ({extract_time:.1f}s): {mood} | {product}")
        else:
            errors += 1
            print(f"  -> FAILED ({extract_time:.1f}s)")
        
        # Delay between posts
        time.sleep(DELAY_BETWEEN_POSTS)
    
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    
    print(f"\n=== Session Complete ===")
    print(f"Duration: {duration/60:.1f} minutes")
    print(f"Processed: {success} successful, {errors} errors, {skipped} skipped")
    print(f"Rate: {success/(duration/60):.1f} posts/minute")
    
    return success, errors, skipped


def show_stats():
    """Show current processing statistics"""
    conn = sqlite3.connect(INSIGHTS_DB)
    c = conn.cursor()
    
    # Total processed
    c.execute('SELECT COUNT(*) FROM insights')
    total = c.fetchone()[0]
    
    # By mood
    c.execute('SELECT mood, COUNT(*) FROM insights WHERE mood IS NOT NULL GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 10')
    moods = c.fetchall()
    
    # By product (non-null)
    c.execute('SELECT product, COUNT(*) FROM insights WHERE product IS NOT NULL AND product != "null" GROUP BY product ORDER BY COUNT(*) DESC LIMIT 10')
    products = c.fetchall()
    
    # By location
    c.execute('SELECT location, COUNT(*) FROM insights WHERE location IS NOT NULL AND location != "null" GROUP BY location ORDER BY COUNT(*) DESC LIMIT 10')
    locations = c.fetchall()
    
    conn.close()
    
    print(f"\n=== Cannect Intelligence Stats ===")
    print(f"Total posts analyzed: {total}")
    
    if moods:
        print(f"\nTop Moods:")
        for mood, count in moods:
            print(f"  {mood}: {count}")
    
    if products:
        print(f"\nTop Products Mentioned:")
        for product, count in products:
            print(f"  {product}: {count}")
    
    if locations:
        print(f"\nTop Locations:")
        for loc, count in locations:
            print(f"  {loc}: {count}")


if __name__ == '__main__':
    init_db()
    
    if len(sys.argv) > 1:
        if sys.argv[1] == 'stats':
            show_stats()
        elif sys.argv[1] == 'run':
            batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else BATCH_SIZE
            uris = fetch_posts_from_db(limit=5000)
            if uris:
                process_posts(uris, max_posts=batch_size)
                show_stats()
            else:
                print("No posts to process")
        else:
            print(f"Unknown command: {sys.argv[1]}")
    else:
        print("Usage:")
        print("  python batch.py stats     - Show current statistics")
        print("  python batch.py run [N]   - Process N posts (default 100)")
        print(f"\nCurrent stats:")
        show_stats()
