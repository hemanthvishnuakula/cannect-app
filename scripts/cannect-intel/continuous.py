#!/usr/bin/env python3
"""
Cannect Intelligence - Continuous Runner
Processes all posts until complete, with automatic batching and progress tracking
"""

import subprocess
import time
import sqlite3
from datetime import datetime
import sys

INSIGHTS_DB = '/root/cannect-intel/insights.db'
POSTS_DB = '/root/cannect-intel/posts.db'
BATCH_SIZE = 500
DELAY_BETWEEN_BATCHES = 60  # 1 minute cooldown between batches

def get_counts():
    """Get processed and total counts"""
    # Get processed count
    conn = sqlite3.connect(INSIGHTS_DB)
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM insights')
    processed = c.fetchone()[0]
    conn.close()
    
    # Get total posts
    conn = sqlite3.connect(POSTS_DB)
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM posts')
    total = c.fetchone()[0]
    conn.close()
    
    return processed, total

def run_batch():
    """Run a single batch"""
    result = subprocess.run(
        ['/root/cannect-intel/venv/bin/python', '-u', '/root/cannect-intel/batch.py', 'run', str(BATCH_SIZE)],
        capture_output=False,  # Let output go to stdout
        cwd='/root/cannect-intel'
    )
    return result.returncode == 0

def main():
    print("=" * 60)
    print("CANNECT INTELLIGENCE - CONTINUOUS PROCESSOR")
    print("=" * 60)
    print(f"Started at: {datetime.now()}")
    print(f"Batch size: {BATCH_SIZE}")
    print()
    
    batch_num = 0
    
    while True:
        processed, total = get_counts()
        remaining = total - processed
        
        print(f"\n{'='*60}")
        print(f"BATCH #{batch_num + 1} | {datetime.now()}")
        print(f"Progress: {processed}/{total} ({100*processed/total:.1f}%)")
        print(f"Remaining: ~{remaining} posts")
        print(f"{'='*60}\n")
        
        if remaining <= 0:
            print("\n🎉 ALL POSTS PROCESSED!")
            break
        
        # Run batch
        success = run_batch()
        batch_num += 1
        
        if not success:
            print(f"\n⚠️ Batch failed, waiting {DELAY_BETWEEN_BATCHES}s before retry...")
        
        # Check new progress
        new_processed, _ = get_counts()
        posts_this_batch = new_processed - processed
        
        print(f"\nBatch #{batch_num} complete: +{posts_this_batch} posts")
        
        if posts_this_batch == 0:
            print("No new posts processed - may be done or all remaining posts have no text")
            # Continue anyway, there might be more
        
        print(f"Cooling down for {DELAY_BETWEEN_BATCHES}s...")
        time.sleep(DELAY_BETWEEN_BATCHES)
    
    # Final stats
    print("\n" + "=" * 60)
    print("FINAL STATISTICS")
    print("=" * 60)
    subprocess.run(
        ['/root/cannect-intel/venv/bin/python', '/root/cannect-intel/batch.py', 'stats'],
        cwd='/root/cannect-intel'
    )

if __name__ == '__main__':
    main()
