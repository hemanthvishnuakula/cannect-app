#!/usr/bin/env python3
"""
Cannect Customer Intelligence - DeepSeek Classifier (Parallel Version)
Extracts consumer intelligence from cannabis social posts using concurrent API calls.
"""

import os
import json
import time
import logging
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any, List

import psycopg2
from psycopg2.extras import RealDictCursor
from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# DeepSeek API client (Async version)
client = AsyncOpenAI(
    api_key=os.getenv('DEEPSEEK_API_KEY'),
    base_url='https://api.deepseek.com'
)

MODEL_VERSION = 'deepseek-chat-20260131'

# Concurrency settings
MAX_CONCURRENT = 10  # Number of parallel API calls
RATE_LIMIT_DELAY = 0.1  # Small delay between starting requests

# Classification prompt
CLASSIFICATION_PROMPT = """You are a cannabis consumer intelligence analyst. Analyze this social media post and extract consumer insights.

Post:
\"\"\"{text}\"\"\"

Metadata:
- Has media: {has_media}
- Embed type: {embed_type}
- Languages: {langs}
- Posted at: {created_at}

Extract the following information. Use null for unknown/not applicable fields.

Return ONLY valid JSON with this exact structure:
{{
  "experience_level": "curious|newbie|casual|regular|daily|expert|unknown",
  "consumer_type": "wellness|recreational|medical|social|connoisseur|spiritual|unknown",
  "lifestyle_tags": ["tag1", "tag2"],
  
  "occasion": "wake_bake|morning_sesh|lunch_break|after_work|evening|weekend|special_event|unknown",
  "setting": "home|outdoors|social|work|travel|unknown",
  "mood_before": "stressed|anxious|tired|pain|happy|neutral|unknown",
  "mood_after": "relaxed|euphoric|creative|sleepy|energized|focused|unknown",
  "time_of_day": "morning|afternoon|evening|night|late_night|unknown",
  "is_ritual": false,
  
  "intent_type": "sharing|asking|recommending|complaining|celebrating|informing|venting|unknown",
  "purchase_intent": 0,
  "purchase_stage": "unaware|considering|shopping|post_purchase|loyal|unknown",
  
  "product_category": "flower|edible|vape|concentrate|tincture|topical|preroll|accessory|unknown",
  "effects_mentioned": ["effect1", "effect2"],
  "effects_desired": ["effect1", "effect2"],
  "quality_perception": "premium|good|average|poor|unknown",
  "dosage_pattern": "microdose|light|moderate|heavy|unknown",
  
  "post_type": "experience|review|question|recommendation|announcement|meme|photo|vent|celebration|education|news|other",
  "media_type": "selfie|product_photo|nature|meme|video|unknown",
  
  "sentiment": "positive|negative|neutral|mixed",
  "sentiment_score": 0,
  "emotions": ["emotion1", "emotion2"],
  
  "brand_mentioned": null,
  "strain_mentioned": null,
  "dispensary_mentioned": null,
  "price_mentioned": false,
  "price_sentiment": null,
  
  "frustrations": [],
  
  "region_hint": null,
  "legal_context": "legal|medical_only|illegal|unknown",
  
  "data_richness": 5,
  "business_value": "high|medium|low",
  "audience_segments": ["dispensary_target", "wellness_brand_target", "premium_target"]
}}

IMPORTANT:
- purchase_intent should be 0-100 (0=no intent, 100=ready to buy now)
- sentiment_score should be -100 to 100 (-100=very negative, 100=very positive)
- data_richness should be 1-10 based on how much useful info is in the post
- Return empty arrays [] for fields with no applicable values
- Return null for text fields that are unknown/not applicable"""


def get_db_connection():
    """Get PostgreSQL connection."""
    return psycopg2.connect(
        host='localhost',
        port=5432,
        database='cannect_intel',
        user='cci',
        password='cci_secure_2026'
    )


def get_unprocessed_posts(limit: int = 100) -> list:
    """Get posts that haven't been classified yet."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, uri, text_content, has_media, embed_type, langs, post_created_at
                FROM posts
                WHERE processed_at IS NULL
                  AND text_content IS NOT NULL
                  AND text_content != ''
                ORDER BY post_created_at DESC
                LIMIT %s
            """, (limit,))
            return cur.fetchall()


async def classify_post_async(post: Dict[str, Any], semaphore: asyncio.Semaphore) -> tuple:
    """Classify a single post using DeepSeek API with semaphore for rate limiting."""
    async with semaphore:
        try:
            start_time = time.time()
            
            prompt = CLASSIFICATION_PROMPT.format(
                text=post['text_content'][:2000],
                has_media=post.get('has_media', False),
                embed_type=post.get('embed_type', 'none'),
                langs=post.get('langs', ['en']),
                created_at=post.get('post_created_at', 'unknown')
            )
            
            # Small delay to spread out requests
            await asyncio.sleep(RATE_LIMIT_DELAY)
            
            response = await client.chat.completions.create(
                model='deepseek-chat',
                messages=[
                    {'role': 'system', 'content': 'You are a cannabis consumer intelligence analyst. Return only valid JSON.'},
                    {'role': 'user', 'content': prompt}
                ],
                temperature=0.1,
                max_tokens=1000,
                response_format={'type': 'json_object'}
            )
            
            processing_ms = int((time.time() - start_time) * 1000)
            result = json.loads(response.choices[0].message.content)
            result['processing_ms'] = processing_ms
            result['model_version'] = MODEL_VERSION
            
            return (post['id'], result, None)
            
        except json.JSONDecodeError as e:
            logger.error(f'JSON decode error for post {post["id"]}: {e}')
            return (post['id'], None, str(e))
        except Exception as e:
            logger.error(f'Classification error for post {post["id"]}: {e}')
            return (post['id'], None, str(e))


def save_classification(post_id: int, classification: Dict):
    """Save classification to database."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO post_classifications (
                    post_id, model_version, confidence, processing_ms,
                    experience_level, consumer_type, lifestyle_tags,
                    occasion, setting, mood_before, mood_after, time_of_day, is_ritual,
                    intent_type, purchase_intent, purchase_stage,
                    product_category, effects_mentioned, effects_desired, quality_perception, dosage_pattern,
                    post_type, media_type,
                    sentiment, sentiment_score, emotions,
                    brand_mentioned, strain_mentioned, dispensary_mentioned, price_mentioned, price_sentiment,
                    frustrations, region_hint, legal_context,
                    data_richness, business_value, audience_segments,
                    raw_response
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s
                )
                ON CONFLICT (post_id, model_version) DO UPDATE SET
                    confidence = EXCLUDED.confidence,
                    processing_ms = EXCLUDED.processing_ms,
                    classified_at = NOW()
            """, (
                post_id, 
                classification.get('model_version', MODEL_VERSION),
                classification.get('confidence', 80),
                classification.get('processing_ms'),
                classification.get('experience_level'),
                classification.get('consumer_type'),
                classification.get('lifestyle_tags'),
                classification.get('occasion'),
                classification.get('setting'),
                classification.get('mood_before'),
                classification.get('mood_after'),
                classification.get('time_of_day'),
                classification.get('is_ritual', False),
                classification.get('intent_type'),
                classification.get('purchase_intent'),
                classification.get('purchase_stage'),
                classification.get('product_category'),
                classification.get('effects_mentioned'),
                classification.get('effects_desired'),
                classification.get('quality_perception'),
                classification.get('dosage_pattern'),
                classification.get('post_type'),
                classification.get('media_type'),
                classification.get('sentiment'),
                classification.get('sentiment_score'),
                classification.get('emotions'),
                classification.get('brand_mentioned'),
                classification.get('strain_mentioned'),
                classification.get('dispensary_mentioned'),
                classification.get('price_mentioned', False),
                classification.get('price_sentiment'),
                classification.get('frustrations'),
                classification.get('region_hint'),
                classification.get('legal_context'),
                classification.get('data_richness'),
                classification.get('business_value'),
                classification.get('audience_segments'),
                json.dumps(classification)
            ))
            
            cur.execute("""
                UPDATE posts SET processed_at = NOW(), classification_version = 1
                WHERE id = %s
            """, (post_id,))
            
            conn.commit()


async def process_batch_async(batch_size: int = 100):
    """Process a batch of unprocessed posts concurrently."""
    posts = get_unprocessed_posts(batch_size)
    
    if not posts:
        logger.info('No unprocessed posts found')
        return 0
    
    logger.info(f'Processing {len(posts)} posts with {MAX_CONCURRENT} concurrent workers...')
    
    # Create semaphore to limit concurrent requests
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    
    # Create tasks for all posts
    tasks = [classify_post_async(post, semaphore) for post in posts]
    
    # Process all concurrently
    start_time = time.time()
    results = await asyncio.gather(*tasks)
    
    # Save results
    processed = 0
    errors = 0
    
    for post_id, classification, error in results:
        if classification:
            save_classification(post_id, classification)
            processed += 1
        else:
            errors += 1
    
    elapsed = time.time() - start_time
    rate = processed / elapsed if elapsed > 0 else 0
    
    logger.info(f'Batch complete: {processed} processed, {errors} errors in {elapsed:.1f}s ({rate:.1f} posts/sec)')
    return processed


def get_stats():
    """Get processing statistics."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COUNT(*) as total_posts,
                    COUNT(processed_at) as processed,
                    COUNT(*) - COUNT(processed_at) as pending,
                    COUNT(text_content) as with_text
                FROM posts
            """)
            return cur.fetchone()


async def main_continuous(batch_size: int):
    """Run continuous processing."""
    logger.info(f'Starting continuous processing with {MAX_CONCURRENT} concurrent workers...')
    while True:
        processed = await process_batch_async(batch_size)
        if processed == 0:
            logger.info('No posts to process, sleeping 60s...')
            await asyncio.sleep(60)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='CCI DeepSeek Classifier (Parallel)')
    parser.add_argument('--batch', type=int, default=100, help='Batch size')
    parser.add_argument('--workers', type=int, default=10, help='Concurrent workers')
    parser.add_argument('--continuous', action='store_true', help='Run continuously')
    parser.add_argument('--stats', action='store_true', help='Show stats only')
    
    args = parser.parse_args()
    
    MAX_CONCURRENT = args.workers
    
    if args.stats:
        stats = get_stats()
        print(f'Total posts: {stats["total_posts"]}')
        print(f'Processed: {stats["processed"]}')
        print(f'Pending: {stats["pending"]}')
        print(f'With text: {stats["with_text"]}')
    elif args.continuous:
        asyncio.run(main_continuous(args.batch))
    else:
        asyncio.run(process_batch_async(args.batch))
