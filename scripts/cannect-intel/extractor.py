#!/usr/bin/env python3
"""
Cannect Intelligence - Post Insights Extractor
Extracts structured insights from Cannect posts using Qwen2.5 via Ollama
"""

import sqlite3
import json
import requests
import time
import os
from datetime import datetime

# Configuration
OLLAMA_URL = 'http://localhost:11434/api/generate'
MODEL = 'qwen2.5:7b'
INSIGHTS_DB = '/root/cannect-intel/insights.db'
BATCH_SIZE = 50  # Posts per batch
MAX_CPU_PERCENT = 70  # Pause if system CPU goes above this

# Extraction prompt - using $TEXT$ as placeholder to avoid JSON brace conflicts
EXTRACTION_PROMPT = '''Extract structured information from this cannabis community social media post.
Return ONLY valid JSON with these fields (use null if not found):

{
  "product": "strain name, product type, or brand mentioned (e.g., 'Blue Dream', 'gummies', 'Cookies')",
  "location": "any location hints - dispensary, city, state, or region",
  "mood": "overall sentiment or emotion (positive/negative/neutral/excited/relaxed/etc)",
  "type": "post type: review, question, recommendation, story, photo, announcement, other",
  "keywords": ["list", "of", "relevant", "keywords"]
}

POST TEXT:
$TEXT$

JSON OUTPUT:'''


def init_db():
    """Initialize the insights database"""
    conn = sqlite3.connect(INSIGHTS_DB)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS insights (
            uri TEXT PRIMARY KEY,
            post_text TEXT,
            product TEXT,
            location TEXT,
            mood TEXT,
            post_type TEXT,
            keywords TEXT,
            extracted_at TEXT,
            model_version TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS extraction_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT,
            ended_at TEXT,
            posts_processed INTEGER,
            errors INTEGER
        )
    ''')
    conn.commit()
    conn.close()
    print(f'[OK] Initialized database at {INSIGHTS_DB}')


def fetch_post_text(uri):
    """Fetch post text via AT Protocol public API"""
    try:
        # Use public Bluesky API to get post
        url = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread'
        params = {'uri': uri, 'depth': 0}
        
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            post = data.get('thread', {}).get('post', {}).get('record', {})
            return post.get('text', '')
        return None
    except Exception as e:
        print(f'  Error fetching {uri}: {e}')
        return None


def extract_insights(text):
    """Send text to Ollama for extraction"""
    prompt = EXTRACTION_PROMPT.replace('$TEXT$', text)
    
    try:
        resp = requests.post(OLLAMA_URL, json={
            'model': MODEL,
            'prompt': prompt,
            'stream': False,
            'options': {
                'temperature': 0.1,  # Low for consistent extraction
                'num_predict': 300
            }
        }, timeout=120)
        
        if resp.status_code == 200:
            result = resp.json().get('response', '')
            # Try to parse JSON from response
            try:
                # Find JSON in response
                start = result.find('{')
                end = result.rfind('}') + 1
                if start >= 0 and end > start:
                    return json.loads(result[start:end])
            except json.JSONDecodeError:
                pass
        return None
    except Exception as e:
        print(f'  Ollama error: {e}')
        return None


def save_insight(uri, text, insights):
    """Save extracted insights to database"""
    conn = sqlite3.connect(INSIGHTS_DB)
    c = conn.cursor()
    
    keywords = json.dumps(insights.get('keywords', [])) if insights.get('keywords') else None
    
    c.execute('''
        INSERT OR REPLACE INTO insights 
        (uri, post_text, product, location, mood, post_type, keywords, extracted_at, model_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        uri,
        text,
        insights.get('product'),
        insights.get('location'),
        insights.get('mood'),
        insights.get('type'),
        keywords,
        datetime.now().isoformat(),
        MODEL
    ))
    conn.commit()
    conn.close()


def get_processed_uris():
    """Get set of already processed URIs"""
    conn = sqlite3.connect(INSIGHTS_DB)
    c = conn.cursor()
    c.execute('SELECT uri FROM insights')
    uris = set(row[0] for row in c.fetchall())
    conn.close()
    return uris


def get_processed_count():
    """Get count of already processed posts"""
    conn = sqlite3.connect(INSIGHTS_DB)
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM insights')
    count = c.fetchone()[0]
    conn.close()
    return count


def run_test():
    """Test the extraction on a sample post"""
    print('\n=== Testing Extraction ===')
    
    test_text = 'Just picked up some Blue Dream from the dispensary in Denver. This batch is incredible - super relaxed and creative vibes. Highly recommend!'
    
    print(f'Test post: {test_text[:80]}...')
    print('Sending to Qwen2.5...')
    
    start = time.time()
    result = extract_insights(test_text)
    elapsed = time.time() - start
    
    if result:
        print(f'\n[SUCCESS] Extraction completed in {elapsed:.1f}s')
        print('Result:')
        print(json.dumps(result, indent=2))
        return True
    else:
        print('[FAILED] Could not extract insights')
        return False


def process_batch(uris, processed_set):
    """Process a batch of post URIs"""
    success = 0
    errors = 0
    
    for i, uri in enumerate(uris):
        if uri in processed_set:
            continue
            
        print(f'  [{i+1}/{len(uris)}] Processing: {uri[:60]}...')
        
        # Fetch post text
        text = fetch_post_text(uri)
        if not text:
            errors += 1
            continue
        
        # Extract insights
        insights = extract_insights(text)
        if insights:
            save_insight(uri, text, insights)
            success += 1
            print(f'    -> {insights.get("mood", "?")} | {insights.get("product", "no product")}')
        else:
            errors += 1
        
        # Small delay between posts
        time.sleep(0.5)
    
    return success, errors


if __name__ == '__main__':
    import sys
    
    init_db()
    
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        run_test()
    else:
        print('Usage: python extractor.py test')
        print('       (Full batch processing coming next)')
        print(f'\nProcessed so far: {get_processed_count()} posts')
