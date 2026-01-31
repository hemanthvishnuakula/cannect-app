#!/usr/bin/env python3
"""
Cannect Customer Intelligence - User Profile Builder
Aggregates post classifications into user profiles.
"""

import os
import json
import logging
from collections import Counter
from typing import Dict, List, Any

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_db_connection():
    """Get PostgreSQL connection."""
    return psycopg2.connect(
        host='localhost',
        port=5432,
        database='cannect_intel',
        user='cci',
        password='cci_secure_2026'
    )


def get_users_with_posts(min_posts: int = 1) -> List[Dict]:
    """Get all users with classified posts."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    p.author_did,
                    MAX(p.author_handle) as author_handle,
                    COUNT(1) as post_count,
                    MIN(p.post_created_at) as first_post,
                    MAX(p.post_created_at) as last_post
                FROM posts p
                JOIN post_classifications pc ON p.id = pc.post_id
                GROUP BY p.author_did
                HAVING COUNT(1) >= %s
                ORDER BY COUNT(1) DESC
            """, (min_posts,))
            return cur.fetchall()


def get_user_classifications(author_did: str) -> List[Dict]:
    """Get all classifications for a user."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT pc.*, p.post_created_at
                FROM posts p
                JOIN post_classifications pc ON p.id = pc.post_id
                WHERE p.author_did = %s
                ORDER BY p.post_created_at DESC
            """, (author_did,))
            return cur.fetchall()


def most_common(items: List, default='unknown') -> str:
    """Get most common item from list, filtering nulls and unknowns."""
    filtered = [i for i in items if i and i != 'unknown']
    if not filtered:
        return default
    counter = Counter(filtered)
    return counter.most_common(1)[0][0]


def flatten_arrays(classifications: List[Dict], field: str) -> List[str]:
    """Flatten array field from all classifications."""
    result = []
    for c in classifications:
        if c.get(field):
            result.extend(c[field])
    return [x for x in result if x]  # Filter empty strings


def calculate_posting_frequency(first_post, last_post, post_count: int) -> str:
    """Calculate posting frequency category."""
    if not first_post or not last_post:
        return 'unknown'
    
    days = (last_post - first_post).days
    if days == 0:
        return 'burst'
    
    posts_per_week = (post_count / days) * 7
    
    if posts_per_week >= 7:
        return 'daily'
    elif posts_per_week >= 3:
        return 'several_weekly'
    elif posts_per_week >= 1:
        return 'weekly'
    elif posts_per_week >= 0.25:
        return 'monthly'
    else:
        return 'occasional'


def build_user_profile(user: Dict, classifications: List[Dict]) -> Dict:
    """Build aggregated user profile from classifications."""
    
    # Extract lists
    consumer_types = [c['consumer_type'] for c in classifications]
    experience_levels = [c['experience_level'] for c in classifications]
    product_categories = [c['product_category'] for c in classifications]
    sentiments = [c['sentiment'] for c in classifications]
    sentiment_scores = [c['sentiment_score'] for c in classifications if c['sentiment_score'] is not None]
    purchase_intents = [c['purchase_intent'] for c in classifications if c['purchase_intent'] is not None]
    
    # Flatten arrays
    effects = flatten_arrays(classifications, 'effects_mentioned')
    effects_desired = flatten_arrays(classifications, 'effects_desired')
    lifestyle_tags = flatten_arrays(classifications, 'lifestyle_tags')
    frustrations = flatten_arrays(classifications, 'frustrations')
    emotions = flatten_arrays(classifications, 'emotions')
    occasions = [c['occasion'] for c in classifications if c.get('occasion')]
    
    # Calculate scores
    avg_sentiment = sum(sentiment_scores) / len(sentiment_scores) if sentiment_scores else 0
    avg_purchase_intent = sum(purchase_intents) / len(purchase_intents) if purchase_intents else 0
    high_intent_count = len([p for p in purchase_intents if p >= 50])
    
    # Get top items
    top_effects = [x[0] for x in Counter(effects).most_common(5)]
    top_frustrations = [x[0] for x in Counter(frustrations).most_common(3)]
    top_lifestyle = [x[0] for x in Counter(lifestyle_tags).most_common(5)]
    top_occasions = [x[0] for x in Counter(occasions).most_common(3)]
    
    # Calculate targeting scores (0-100)
    dispensary_score = min(100, int(
        (avg_purchase_intent * 0.5) + 
        (high_intent_count * 10) + 
        (user['post_count'] * 2)
    ))
    
    wellness_score = min(100, int(
        (50 if most_common(consumer_types) in ['wellness', 'medical'] else 0) +
        (len([e for e in effects if e in ['relaxed', 'calm', 'sleep', 'pain_relief']]) * 10)
    ))
    
    premium_score = min(100, int(
        (50 if most_common(consumer_types) == 'connoisseur' else 0) +
        (30 if most_common(experience_levels) in ['expert', 'daily'] else 0) +
        (user['post_count'] * 1)
    ))
    
    return {
        'author_did': user['author_did'],
        'author_handle': user.get('author_handle'),
        'first_seen_at': user['first_post'],
        'last_seen_at': user['last_post'],
        'posts_analyzed': user['post_count'],
        
        'primary_consumer_type': most_common(consumer_types),
        'secondary_consumer_type': Counter([c for c in consumer_types if c and c != 'unknown']).most_common(2)[1][0] if len(set(consumer_types)) > 1 else None,
        'experience_level': most_common(experience_levels),
        
        'preferred_products': list(set([p for p in product_categories if p and p != 'unknown']))[:3],
        'preferred_effects': top_effects,
        'typical_occasions': top_occasions,
        'lifestyle_tags': top_lifestyle,
        
        'avg_sentiment': round(avg_sentiment, 2),
        'posting_frequency': calculate_posting_frequency(user['first_post'], user['last_post'], user['post_count']),
        
        'frustrations': top_frustrations,
        
        'dispensary_target_score': dispensary_score,
        'wellness_brand_target_score': wellness_score,
        'premium_product_target_score': premium_score,
        'accessory_target_score': min(100, user['post_count'] * 3),
        
        'stats_json': {
            'sentiment_distribution': dict(Counter(sentiments)),
            'consumer_type_distribution': dict(Counter(consumer_types)),
            'all_effects': dict(Counter(effects)),
            'all_emotions': dict(Counter(emotions)),
            'avg_purchase_intent': round(avg_purchase_intent, 1),
            'high_intent_posts': high_intent_count
        }
    }


def save_user_profile(profile: Dict):
    """Save or update user profile in database."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_profiles (
                    author_did, author_handle, first_seen_at, last_seen_at, posts_analyzed,
                    primary_consumer_type, secondary_consumer_type, experience_level,
                    preferred_products, preferred_effects, typical_occasions, lifestyle_tags,
                    avg_sentiment, posting_frequency, frustrations,
                    dispensary_target_score, wellness_brand_target_score, 
                    premium_product_target_score, accessory_target_score,
                    stats_json, profile_updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, NOW()
                )
                ON CONFLICT (author_did) DO UPDATE SET
                    author_handle = EXCLUDED.author_handle,
                    last_seen_at = EXCLUDED.last_seen_at,
                    posts_analyzed = EXCLUDED.posts_analyzed,
                    primary_consumer_type = EXCLUDED.primary_consumer_type,
                    secondary_consumer_type = EXCLUDED.secondary_consumer_type,
                    experience_level = EXCLUDED.experience_level,
                    preferred_products = EXCLUDED.preferred_products,
                    preferred_effects = EXCLUDED.preferred_effects,
                    typical_occasions = EXCLUDED.typical_occasions,
                    lifestyle_tags = EXCLUDED.lifestyle_tags,
                    avg_sentiment = EXCLUDED.avg_sentiment,
                    posting_frequency = EXCLUDED.posting_frequency,
                    frustrations = EXCLUDED.frustrations,
                    dispensary_target_score = EXCLUDED.dispensary_target_score,
                    wellness_brand_target_score = EXCLUDED.wellness_brand_target_score,
                    premium_product_target_score = EXCLUDED.premium_product_target_score,
                    accessory_target_score = EXCLUDED.accessory_target_score,
                    stats_json = EXCLUDED.stats_json,
                    profile_updated_at = NOW()
            """, (
                profile['author_did'],
                profile['author_handle'],
                profile['first_seen_at'],
                profile['last_seen_at'],
                profile['posts_analyzed'],
                profile['primary_consumer_type'],
                profile.get('secondary_consumer_type'),
                profile['experience_level'],
                profile['preferred_products'],
                profile['preferred_effects'],
                profile['typical_occasions'],
                profile['lifestyle_tags'],
                profile['avg_sentiment'],
                profile['posting_frequency'],
                profile['frustrations'],
                profile['dispensary_target_score'],
                profile['wellness_brand_target_score'],
                profile['premium_product_target_score'],
                profile['accessory_target_score'],
                json.dumps(profile['stats_json'])
            ))
            conn.commit()


def build_all_profiles(min_posts: int = 1):
    """Build profiles for all users."""
    users = get_users_with_posts(min_posts)
    logger.info(f'Building profiles for {len(users)} users with >= {min_posts} posts...')
    
    for i, user in enumerate(users):
        try:
            classifications = get_user_classifications(user['author_did'])
            profile = build_user_profile(user, classifications)
            save_user_profile(profile)
            
            if (i + 1) % 100 == 0:
                logger.info(f'Built {i + 1}/{len(users)} profiles')
                
        except Exception as e:
            logger.error(f'Error building profile for {user["author_did"]}: {e}')
    
    logger.info(f'Completed building {len(users)} user profiles')


def get_profile_stats():
    """Get profile statistics."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COUNT(1) as total_profiles,
                    ROUND(AVG(posts_analyzed), 1) as avg_posts,
                    ROUND(AVG(avg_sentiment), 1) as avg_sentiment,
                    ROUND(AVG(dispensary_target_score), 1) as avg_dispensary_score,
                    COUNT(1) FILTER (WHERE dispensary_target_score >= 50) as high_intent_users
                FROM user_profiles
            """)
            return cur.fetchone()


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='CCI User Profile Builder')
    parser.add_argument('--min-posts', type=int, default=1, help='Minimum posts to create profile')
    parser.add_argument('--stats', action='store_true', help='Show stats only')
    
    args = parser.parse_args()
    
    if args.stats:
        stats = get_profile_stats()
        if stats and stats['total_profiles']:
            print(f'Total profiles: {stats["total_profiles"]}')
            print(f'Avg posts per user: {stats["avg_posts"]}')
            print(f'Avg sentiment: {stats["avg_sentiment"]}')
            print(f'Avg dispensary score: {stats["avg_dispensary_score"]}')
            print(f'High-intent users (score >= 50): {stats["high_intent_users"]}')
        else:
            print('No profiles built yet. Run without --stats first.')
    else:
        build_all_profiles(args.min_posts)
