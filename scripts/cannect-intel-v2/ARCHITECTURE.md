# Cannect Intelligence v2 - Complete Architecture

## Overview

A B2B cannabis consumer intelligence platform that extracts maximum value from every post using DeepSeek API for classification, PostgreSQL for scalable storage, and a REST API for data access.

---

## Infrastructure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        LEGACY VPS (72.62.129.232)                        │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ Jetstream       │───▶│ Feed Generator  │───▶│ posts.db        │     │
│  │ (Real-time)     │    │ (AI Filter)     │    │ (SQLite)        │     │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘     │
└────────────────────────────────────────────────────────────────────────┘
                                                          │ Sync (every 5 min)
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NEW VPS (72.62.163.135)                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ Sync Service    │───▶│ DeepSeek        │───▶│ PostgreSQL      │     │
│  │ (Fetches new)   │    │ Classifier      │    │ (Intelligence)  │     │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘     │
│                                                          │              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────▼────────┐     │
│  │ REST API        │◀───│ Query Engine    │◀───│ Materialized    │     │
│  │ /api/v1/        │    │ (Analytics)     │    │ Views           │     │
│  └────────┬────────┘    └─────────────────┘    └─────────────────┘     │
└───────────┼─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Dashboard   │  │ API Access  │  │ Webhooks    │  │ Reports     │    │
│  │ (Web App)   │  │ (B2B)       │  │ (Alerts)    │  │ (Email)     │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Design (PostgreSQL)

### Why PostgreSQL over SQLite?

- **Horizontal scaling**: Read replicas, partitioning
- **Vertical scaling**: Better use of multi-core
- **Time-series**: Native timestamp handling, BRIN indexes
- **JSON**: Native JSONB for flexible fields
- **Full-text search**: Built-in tsvector
- **Materialized views**: Pre-computed aggregations
- **Extensions**: TimescaleDB for time-series if needed

---

## Core Tables

### 1. `posts` - Raw Post Data (Source of Truth)

```sql
CREATE TABLE posts (
    -- Primary identification
    id              BIGSERIAL PRIMARY KEY,
    uri             TEXT UNIQUE NOT NULL,
    cid             TEXT NOT NULL,

    -- Author info
    author_did      TEXT NOT NULL,
    author_handle   TEXT,

    -- Timestamps (CRITICAL for time analysis)
    post_created_at TIMESTAMPTZ NOT NULL,      -- When user posted (from record)
    indexed_at      TIMESTAMPTZ NOT NULL,      -- When we indexed it
    processed_at    TIMESTAMPTZ,               -- When AI classified it

    -- Raw content
    text_content    TEXT,
    facets          JSONB,                     -- Links, mentions, hashtags
    langs           TEXT[],                    -- Language array

    -- Media
    has_media       BOOLEAN DEFAULT FALSE,
    media_count     SMALLINT DEFAULT 0,
    embed_type      TEXT,                      -- images, video, external, quote
    embed_data      JSONB,                     -- Full embed metadata

    -- Engagement (updated periodically)
    like_count      INTEGER DEFAULT 0,
    reply_count     INTEGER DEFAULT 0,
    repost_count    INTEGER DEFAULT 0,
    engagement_updated_at TIMESTAMPTZ,

    -- Processing status
    classification_version INTEGER DEFAULT 0,  -- For re-processing
    processing_error TEXT,

    -- Partitioning key
    created_date    DATE GENERATED ALWAYS AS (DATE(post_created_at)) STORED
);

-- Indexes for common queries
CREATE INDEX idx_posts_author ON posts(author_did);
CREATE INDEX idx_posts_created ON posts(post_created_at DESC);
CREATE INDEX idx_posts_indexed ON posts(indexed_at DESC);
CREATE INDEX idx_posts_unprocessed ON posts(id) WHERE processed_at IS NULL;
CREATE INDEX idx_posts_date ON posts(created_date);

-- Full-text search
CREATE INDEX idx_posts_text_search ON posts USING GIN(to_tsvector('english', text_content));

-- Partition by month for scalability (optional, enable when > 1M posts)
-- CREATE TABLE posts PARTITION BY RANGE (created_date);
```

### 2. `post_classifications` - AI-Extracted Intelligence

```sql
CREATE TABLE post_classifications (
    id              BIGSERIAL PRIMARY KEY,
    post_id         BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,

    -- Classification metadata
    classified_at   TIMESTAMPTZ DEFAULT NOW(),
    model_version   TEXT NOT NULL,             -- 'deepseek-v3-20260131'
    confidence      SMALLINT CHECK (confidence BETWEEN 0 AND 100),
    processing_ms   INTEGER,                   -- How long classification took

    -- === CONSUMER PROFILE ===
    experience_level    TEXT CHECK (experience_level IN
        ('curious', 'newbie', 'casual', 'regular', 'daily', 'expert', 'unknown')),
    consumer_type       TEXT CHECK (consumer_type IN
        ('wellness', 'recreational', 'medical', 'social', 'connoisseur', 'spiritual', 'unknown')),
    lifestyle_tags      TEXT[],                -- ['active', 'creative', 'professional']

    -- === CONSUMPTION CONTEXT ===
    occasion            TEXT,                  -- 'wake_bake', 'after_work', 'weekend', etc.
    setting             TEXT,                  -- 'home', 'outdoors', 'social', etc.
    mood_before         TEXT,
    mood_after          TEXT,
    time_of_day         TEXT CHECK (time_of_day IN
        ('morning', 'afternoon', 'evening', 'night', 'late_night', 'unknown')),
    is_ritual           BOOLEAN DEFAULT FALSE,

    -- === INTENT SIGNALS ===
    intent_type         TEXT CHECK (intent_type IN
        ('sharing', 'asking', 'recommending', 'complaining', 'celebrating', 'informing', 'venting', 'unknown')),
    purchase_intent     SMALLINT CHECK (purchase_intent BETWEEN 0 AND 100),
    purchase_stage      TEXT CHECK (purchase_stage IN
        ('unaware', 'considering', 'shopping', 'post_purchase', 'loyal', 'unknown')),

    -- === PRODUCT INTELLIGENCE ===
    product_category    TEXT,                  -- 'flower', 'edible', 'vape', etc.
    effects_mentioned   TEXT[],                -- ['relaxed', 'sleepy', 'creative']
    effects_desired     TEXT[],
    quality_perception  TEXT CHECK (quality_perception IN
        ('premium', 'good', 'average', 'poor', 'unknown')),
    dosage_pattern      TEXT CHECK (dosage_pattern IN
        ('microdose', 'light', 'moderate', 'heavy', 'unknown')),

    -- === CONTENT TYPE ===
    post_type           TEXT CHECK (post_type IN
        ('experience', 'review', 'question', 'recommendation', 'announcement',
         'meme', 'photo', 'vent', 'celebration', 'education', 'news', 'other')),
    media_type          TEXT,                  -- 'selfie', 'product_photo', 'nature', 'meme'

    -- === SENTIMENT ===
    sentiment           TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
    sentiment_score     SMALLINT CHECK (sentiment_score BETWEEN -100 AND 100),
    emotions            TEXT[],                -- ['joy', 'relief', 'excitement']

    -- === COMMERCIAL SIGNALS ===
    brand_mentioned     TEXT,
    strain_mentioned    TEXT,
    dispensary_mentioned TEXT,
    price_mentioned     BOOLEAN DEFAULT FALSE,
    price_sentiment     TEXT CHECK (price_sentiment IN ('fair', 'expensive', 'cheap', 'deal')),

    -- === PAIN POINTS ===
    frustrations        TEXT[],                -- ['price', 'availability', 'quality']

    -- === LOCATION ===
    region_hint         TEXT,                  -- 'California', 'Florida', etc.
    legal_context       TEXT CHECK (legal_context IN ('legal', 'medical_only', 'illegal', 'unknown')),

    -- === BUSINESS VALUE ===
    data_richness       SMALLINT CHECK (data_richness BETWEEN 1 AND 10),
    business_value      TEXT CHECK (business_value IN ('high', 'medium', 'low')),
    audience_segments   TEXT[],                -- ['dispensary_target', 'brand_target']

    -- Unique constraint - one classification per post per version
    UNIQUE(post_id, model_version)
);

-- Indexes for analytics queries
CREATE INDEX idx_class_purchase_intent ON post_classifications(purchase_intent DESC)
    WHERE purchase_intent >= 70;
CREATE INDEX idx_class_consumer_type ON post_classifications(consumer_type);
CREATE INDEX idx_class_product ON post_classifications(product_category);
CREATE INDEX idx_class_sentiment ON post_classifications(sentiment);
CREATE INDEX idx_class_experience ON post_classifications(experience_level);
CREATE INDEX idx_class_effects ON post_classifications USING GIN(effects_mentioned);
CREATE INDEX idx_class_lifestyle ON post_classifications USING GIN(lifestyle_tags);
CREATE INDEX idx_class_brand ON post_classifications(brand_mentioned) WHERE brand_mentioned IS NOT NULL;
CREATE INDEX idx_class_strain ON post_classifications(strain_mentioned) WHERE strain_mentioned IS NOT NULL;
```

### 3. `user_profiles` - Aggregated User Intelligence

```sql
CREATE TABLE user_profiles (
    id                  BIGSERIAL PRIMARY KEY,
    author_did          TEXT UNIQUE NOT NULL,
    author_handle       TEXT,

    -- Profile metadata
    first_seen_at       TIMESTAMPTZ NOT NULL,
    last_seen_at        TIMESTAMPTZ NOT NULL,
    posts_analyzed      INTEGER DEFAULT 0,

    -- Aggregated consumer profile (computed from posts)
    primary_consumer_type   TEXT,
    secondary_consumer_type TEXT,
    experience_level        TEXT,

    -- Preferences (aggregated)
    preferred_products      TEXT[],            -- ['flower', 'edibles']
    preferred_effects       TEXT[],            -- ['relaxed', 'creative']
    typical_occasions       TEXT[],            -- ['after_work', 'weekend']
    lifestyle_tags          TEXT[],            -- ['active', 'professional']

    -- Behavioral patterns
    avg_sentiment           NUMERIC(5,2),      -- -1.0 to 1.0
    posting_frequency       TEXT,              -- 'daily', 'weekly', 'monthly'
    typical_time_of_day     TEXT,              -- When they usually post

    -- Commercial value
    purchase_frequency      TEXT,              -- 'weekly', 'biweekly', 'monthly'
    estimated_monthly_spend TEXT,              -- '$50-100', '$100-200', etc.
    frustrations            TEXT[],            -- Common complaints

    -- Location
    likely_region           TEXT,
    legal_market            BOOLEAN,

    -- B2B targeting scores (0-100)
    dispensary_target_score     SMALLINT DEFAULT 0,
    wellness_brand_target_score SMALLINT DEFAULT 0,
    premium_product_target_score SMALLINT DEFAULT 0,
    accessory_target_score      SMALLINT DEFAULT 0,

    -- Timestamps
    profile_updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Raw stats for recomputation
    stats_json              JSONB              -- Detailed stats blob
);

CREATE INDEX idx_profiles_consumer_type ON user_profiles(primary_consumer_type);
CREATE INDEX idx_profiles_experience ON user_profiles(experience_level);
CREATE INDEX idx_profiles_dispensary_score ON user_profiles(dispensary_target_score DESC);
CREATE INDEX idx_profiles_region ON user_profiles(likely_region);
```

### 4. `time_series_aggregates` - Pre-computed Time Analytics

```sql
CREATE TABLE time_series_aggregates (
    id              BIGSERIAL PRIMARY KEY,
    period_type     TEXT NOT NULL CHECK (period_type IN ('hour', 'day', 'week', 'month')),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,

    -- Volume metrics
    total_posts         INTEGER DEFAULT 0,
    unique_authors      INTEGER DEFAULT 0,
    posts_with_media    INTEGER DEFAULT 0,

    -- Sentiment distribution
    positive_count      INTEGER DEFAULT 0,
    negative_count      INTEGER DEFAULT 0,
    neutral_count       INTEGER DEFAULT 0,
    avg_sentiment_score NUMERIC(5,2),

    -- Consumer type distribution
    consumer_type_dist  JSONB,     -- {"wellness": 150, "recreational": 200, ...}

    -- Product distribution
    product_dist        JSONB,     -- {"flower": 300, "edibles": 150, ...}

    -- Effects trending
    effects_dist        JSONB,     -- {"relaxed": 400, "creative": 200, ...}

    -- Intent metrics
    avg_purchase_intent NUMERIC(5,2),
    high_intent_count   INTEGER DEFAULT 0,   -- purchase_intent >= 70

    -- Top items
    top_strains         JSONB,     -- [{"name": "Blue Dream", "count": 50}, ...]
    top_brands          JSONB,
    top_frustrations    JSONB,
    top_emotions        JSONB,

    -- Computed at
    computed_at         TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(period_type, period_start)
);

CREATE INDEX idx_timeseries_period ON time_series_aggregates(period_type, period_start DESC);
```

### 5. `brands` & `strains` - Entity Reference Tables

```sql
CREATE TABLE brands (
    id              SERIAL PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    normalized_name TEXT NOT NULL,             -- Lowercase, no spaces
    aliases         TEXT[],                    -- ['Cookies', 'Cookies SF', 'CookiesSF']
    category        TEXT,                      -- 'dispensary', 'product', 'accessory'
    website         TEXT,
    is_verified     BOOLEAN DEFAULT FALSE,
    mention_count   INTEGER DEFAULT 0,
    avg_sentiment   NUMERIC(5,2),
    first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ
);

CREATE TABLE strains (
    id              SERIAL PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    normalized_name TEXT NOT NULL,
    aliases         TEXT[],
    strain_type     TEXT CHECK (strain_type IN ('indica', 'sativa', 'hybrid', 'unknown')),
    mention_count   INTEGER DEFAULT 0,
    avg_sentiment   NUMERIC(5,2),
    common_effects  TEXT[],                    -- Aggregated from posts
    first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ
);

CREATE INDEX idx_brands_normalized ON brands(normalized_name);
CREATE INDEX idx_strains_normalized ON strains(normalized_name);
```

### 6. `api_clients` & `api_usage` - B2B Access Control

```sql
CREATE TABLE api_clients (
    id              SERIAL PRIMARY KEY,
    client_name     TEXT NOT NULL,
    api_key         TEXT UNIQUE NOT NULL,
    api_secret_hash TEXT NOT NULL,

    -- Subscription
    tier            TEXT CHECK (tier IN ('starter', 'growth', 'enterprise', 'custom')),
    monthly_quota   INTEGER,                   -- API calls per month

    -- Access control
    allowed_endpoints TEXT[],                  -- ['/segments', '/trends', '/intents']
    rate_limit_per_min INTEGER DEFAULT 60,

    -- Tracking
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ
);

CREATE TABLE api_usage (
    id              BIGSERIAL PRIMARY KEY,
    client_id       INTEGER REFERENCES api_clients(id),
    endpoint        TEXT NOT NULL,
    method          TEXT NOT NULL,
    status_code     SMALLINT,
    response_time_ms INTEGER,
    called_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Partition by month for high volume
CREATE INDEX idx_api_usage_client ON api_usage(client_id, called_at DESC);
```

---

## Materialized Views (Pre-computed Analytics)

```sql
-- Current consumer segments (refresh every hour)
CREATE MATERIALIZED VIEW mv_consumer_segments AS
SELECT
    pc.consumer_type,
    pc.experience_level,
    COUNT(DISTINCT p.author_did) as user_count,
    COUNT(*) as post_count,
    AVG(pc.sentiment_score) as avg_sentiment,
    AVG(pc.purchase_intent) as avg_intent,
    array_agg(DISTINCT unnest(pc.lifestyle_tags)) as common_lifestyles
FROM posts p
JOIN post_classifications pc ON p.id = pc.post_id
WHERE p.post_created_at > NOW() - INTERVAL '30 days'
GROUP BY pc.consumer_type, pc.experience_level;

CREATE UNIQUE INDEX ON mv_consumer_segments(consumer_type, experience_level);

-- Trending effects (refresh every hour)
CREATE MATERIALIZED VIEW mv_trending_effects AS
SELECT
    effect,
    COUNT(*) as mention_count,
    AVG(pc.sentiment_score) as avg_sentiment,
    DATE_TRUNC('day', p.post_created_at) as day
FROM posts p
JOIN post_classifications pc ON p.id = pc.post_id
CROSS JOIN LATERAL unnest(pc.effects_mentioned) as effect
WHERE p.post_created_at > NOW() - INTERVAL '7 days'
GROUP BY effect, DATE_TRUNC('day', p.post_created_at);

-- High-intent users (refresh every 15 min)
CREATE MATERIALIZED VIEW mv_high_intent_users AS
SELECT
    p.author_did,
    p.author_handle,
    p.uri,
    p.text_content,
    pc.purchase_intent,
    pc.purchase_stage,
    pc.product_category,
    pc.region_hint,
    p.post_created_at
FROM posts p
JOIN post_classifications pc ON p.id = pc.post_id
WHERE pc.purchase_intent >= 70
  AND p.post_created_at > NOW() - INTERVAL '24 hours'
ORDER BY pc.purchase_intent DESC, p.post_created_at DESC;
```

---

## Time-Based Analysis Capabilities

With proper timestamps, we can answer:

| Question                           | Query Uses                             |
| ---------------------------------- | -------------------------------------- |
| What times do people consume most? | `time_of_day` + `post_created_at` hour |
| Weekend vs weekday patterns?       | `post_created_at` day of week          |
| Is "functional high" trending up?  | Time-series on effects over weeks      |
| Seasonal trends?                   | Monthly aggregations                   |
| Real-time purchase intent?         | Last 24h high-intent posts             |
| When do people complain most?      | Frustration mentions by hour/day       |
| Brand sentiment over time?         | Weekly brand mention sentiment         |

---

## Scaling Strategy

### Vertical (Single Node)

- PostgreSQL can handle 10M+ posts on a 16GB VPS
- BRIN indexes for time-series data
- Materialized views for expensive queries
- Connection pooling (PgBouncer)

### Horizontal (Multi-Node)

- Read replicas for API queries
- Table partitioning by month/year
- TimescaleDB extension for time-series
- Separate write/read VPS eventually

---

## What We Need

### On New VPS (72.62.163.135)

1. **PostgreSQL 16** - Main database
2. **Python 3.11** - Classifier service
3. **Node.js 20** - REST API (optional, could use Python FastAPI)
4. **Redis** - Caching & rate limiting
5. **Caddy** - Already have, for HTTPS

### External Services

1. **DeepSeek API Key** - For classification
2. **Stripe** - For B2B billing (later)
3. **Resend/Sendgrid** - For email reports (later)

### Environment Variables

```bash
# DeepSeek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat  # or deepseek-reasoner

# PostgreSQL
DATABASE_URL=postgresql://intel:password@localhost:5432/cannect_intel

# Legacy VPS (for sync)
LEGACY_VPS_HOST=72.62.129.232
LEGACY_VPS_SSH_KEY=/root/.ssh/id_ed25519

# API
API_PORT=3002
API_SECRET=...

# Redis
REDIS_URL=redis://localhost:6379
```

---

## Implementation Phases

### Phase 1: Foundation (Today)

- [ ] Install PostgreSQL on New VPS
- [ ] Create database schema
- [ ] Set up DeepSeek API client
- [ ] Build classifier service
- [ ] Initial sync from Legacy VPS

### Phase 2: Classification (Day 2)

- [ ] Process all 14K posts through DeepSeek
- [ ] Build user profile aggregation
- [ ] Create materialized views
- [ ] Verify data quality

### Phase 3: API (Day 3)

- [ ] REST API endpoints
- [ ] Authentication (API keys)
- [ ] Rate limiting
- [ ] Basic dashboard

### Phase 4: Continuous (Day 4+)

- [ ] Real-time sync from Legacy VPS
- [ ] Incremental classification
- [ ] Webhook alerts for high-intent
- [ ] Scheduled report generation

---

## Cost Estimate

| Item                            | Cost               |
| ------------------------------- | ------------------ |
| DeepSeek API (14K posts)        | ~$2                |
| DeepSeek API (ongoing, 100/day) | ~$0.10/day         |
| PostgreSQL                      | Free (self-hosted) |
| VPS (already have)              | $0                 |
| **Total Setup**                 | **~$2**            |
| **Monthly Ongoing**             | **~$3**            |
