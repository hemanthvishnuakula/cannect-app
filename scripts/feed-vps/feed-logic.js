/**
 * Feed Logic - Determines which posts to include
 *
 * Simple rules:
 * 1. All posts from cannect.space users
 * 2. Posts containing cannabis-related keywords with context validation
 *
 * We use a tiered approach:
 * - Tier 1: Unmistakable cannabis terms (single match = include)
 * - Tier 2: Ambiguous terms that need context (require 2+ matches or supporting context)
 * - Tier 3: Strain names that could be false positives (require positive context signals)
 *
 * Context Awareness:
 * - Positive signals: cannabis-related terms that confirm intent
 * - Negative signals: terms that indicate false positive (NASA, Wordle, gardening, etc.)
 */

// =============================================================================
// TIER 1: HIGH CONFIDENCE - Single match is enough
// These words are almost never used outside cannabis context
// =============================================================================
const HIGH_CONFIDENCE_KEYWORDS = [
  // Core cannabis terms (unmistakable)
  'cannabis',
  'marijuana',
  'marihuana',
  'cannabinoid',
  'cannabinoids',

  // THC/CBD specific
  'thc',
  'delta-8',
  'delta-9',
  'delta 8',
  'delta 9',
  'delta8',
  'delta9',
  'thca',
  'cbda',
  'cbg',
  // Note: 'cbn' removed - matches 'Central Bank of Nigeria'
  'cbd oil',
  'cbd gummies',
  'full spectrum cbd',

  // Consumption methods (specific)
  'dispensary',
  'dispensaries',
  'cannabis dispensary',
  'weed dispensary',
  'marijuana dispensary',
  'budtender',
  'dab rig',
  'dabbing',
  'dab pen',
  'bong rip',
  'bong hit',
  'smoking weed',
  'smoke weed',
  'smoked weed',
  'vape cart',
  'vape cartridge',
  'thc vape',
  'cannabis vape',
  'rolling a joint',
  'rolled a joint',
  'wake and bake',
  'wake n bake',

  // Culture (very specific)
  '420 friendly',
  '420friendly',
  'stoner culture',
  'pothead',
  'cannabis community',
  'weed community',
  'blazing up',
  'blaze up',
  'getting baked',
  'got baked',
  'so baked',
  'im baked',
  "i'm baked",
  'super baked',
  'getting stoned',
  'got stoned',
  'so stoned',
  'super stoned',
  'high af',
  'stoned af',
  'baked af',

  // "High" in cannabis context (moved from medium)
  'getting high',
  'got high',
  'so high',
  'im high',
  "i'm high",
  'super high',
  'too high',
  'high rn',
  'high right now',
  'high as fuck',
  'high as hell',
  'this high',
  'that high',

  // Products (specific)
  'live rosin',
  'live resin',
  'cannabis oil',
  'weed edibles',
  'thc edibles',
  'cannabis edibles',
  'moon rocks',
  'moonrocks',
  'thc shatter',
  'dab shatter',
  'cannabis shatter',
  'cannabis wax',
  'thc wax',
  'cannabis concentrate',
  'thc concentrate',
  'hashish',
  'hash oil',
  'dry sift',

  // Industry (specific)
  'cannabis industry',
  'cannabis business',
  'cannabusiness',
  'cannabis company',
  'cannabis brand',
  'weed brand',
  'cannabis startup',
  'legalize cannabis',
  'legalize marijuana',
  'legalize weed',
  'decriminalize',
  'decriminalization',

  // Medical (specific)
  'medical marijuana',
  'medical cannabis',
  'mmj',
  'medical card',
  'cannabis patient',
  'marijuana patient',

  // Growing (specific)
  'grow tent',
  'growing cannabis',
  'growing weed',
  'cannabis plant',
  'marijuana plant',
  'weed plant',
  'cannabis cultivation',
  'cannabis grower',
  'homegrow',
  'home grow',

  // Hashtags (very specific)
  '#cannabis',
  '#weed',
  '#stoner',
  '#cannabiscommunity',
  '#weedlife',
  '#stonernation',
  '#cannabisculture',
  '#marijuana',
  '#thc',
  '#cbd',
  '#dispensary',
  '#growmie',
];

// =============================================================================
// TIER 2: MEDIUM CONFIDENCE - Need additional context
// These could be false positives, so require 2+ matches
// =============================================================================
const MEDIUM_CONFIDENCE_KEYWORDS = [
  'weed', // Could be garden weed
  'kush', // Could be name/slang
  'indica', // Need context
  'sativa', // Need context
  // 'hybrid', // REMOVED - too generic, triggers on cars
  'terpenes', // Could be perfume/essential oils
  'terps', // Slang, need context
  'edibles', // Could be any food
  'blunt', // Could be "blunt statement"
  'joint', // Could be "joint effort"
  // 'bong', // REMOVED - Filipino politician name "Bong Revilla"
  'dabs', // Could be dance move
  'stoner', // Need context
  'stoned', // Could be biblical
  'baked', // Could be cooking
  // 'high', // REMOVED - too many false positives (weather, prices, scores)
  // '420', // REMOVED - Japanese yen (420万), scores, dates
  'flower', // Very generic (gardening)
  'nug', // Need context
  'nugs', // Need context
  'strain', // Could be music/stress
  'pre-roll', // Need context
  'preroll', // Need context
  // Note: 'hash' removed - matches 'hash browns', 'hashtag', etc.
  // 'bowl', // REMOVED - too generic (food, sports)
  // 'pipe', // REMOVED - too generic (plumbing)
  'grinder', // Could be coffee
];

// =============================================================================
// TIER 3: STRAIN NAMES - Require positive context (could be false positives)
// These are strain names that could match non-cannabis content
// Note: Removed overly generic terms like "cookies", "skywalker", "headband"
// =============================================================================
const STRAIN_NAMES = [
  'og kush',
  'purple haze strain',
  'blue dream',
  'girl scout cookies strain',
  'gsc strain',
  'gorilla glue strain',
  'gg4',
  'white widow',
  'northern lights strain',
  'sour diesel',
  'jack herer',
  'pineapple express strain',
  'gelato strain',
  'zkittlez',
  'wedding cake strain',
  'runtz strain',
  'granddaddy purple',
  'gdp strain',
  'green crack',
  'super lemon haze',
  'trainwreck strain',
  'headband strain',
  'cherry pie strain',
  'cookies strain',
  'sherbert strain',
  'sunset sherbert',
  // Additional strains
  'chemdawg',
  'chem dawg',
  'chemdog',
  'chem dog',
  'sunshine diesel',
  'bubba kush',
  'skywalker og',
  'skywalker kush',
  'ak-47 strain',
  'durban poison',
  'lemon haze',
  'strawberry cough',
  'amnesia haze',
  'bruce banner strain',
  'cereal milk strain',
  'mac 1 strain',
  'gmo cookies',
  'gary payton strain',
  'ice cream cake strain',
  'banana kush',
  'mimosa strain',
  'dosidos',
  'do-si-dos',
  'animal mints',
  'slurricane',
];

// =============================================================================
// CONTEXT SIGNALS - Used for context-aware filtering
// =============================================================================

// Positive signals: Terms that confirm cannabis context
const POSITIVE_CONTEXT_SIGNALS = [
  // Core terms
  'cannabis',
  'marijuana',
  'weed',
  'thc',
  'cbd',
  'dispensary',
  // Consumption
  'smoke',
  'smoked',
  'smoking',
  'vape',
  'edible',
  'edibles',
  'dab',
  'blunt',
  'joint',
  'bong',
  // Types
  'indica',
  'sativa',
  'hybrid',
  'strain',
  // Growing
  'grow',
  'growing',
  'harvest',
  'trichome',
  'trichomes',
  'flowering',
  'cultivar',
  'tent',
  'grow tent',
  'homegrow',
  'home grow',
  'autoflower',
  'photoperiod',
  // Culture
  'stoner',
  'baked',
  'high',
  'blazed',
  '420',
  'nug',
  'nugs',
  'dank',
  'fire',
  // Hashtags
  '#cannabis',
  '#weed',
  '#420',
  '#stoner',
  '#thc',
  '#cbd',
  '#mmj',
  '#cannabiscommunity',
  '#growmie',
  '#homegrow',
  '#growyourown',
];

// Negative signals: Terms that indicate false positive
const NEGATIVE_CONTEXT_SIGNALS = [
  // Weather bots (High: XX Low: XX pattern)
  { pattern: /\bHigh:\s*\d+.*Low:\s*\d+/i, weight: -10 },
  { pattern: /\bHigh\s+\w+\s+Advisory/i, weight: -10 },
  { pattern: /\bClimate:\s*High/i, weight: -10 },
  // Product spam (Amazon-style descriptions)
  { pattern: /\b(inches|inch)\s*[-–]\s*(high|tall|wide)/i, weight: -8 },
  { pattern: /\b(for|with)\s+(dogs?|cats?|pets?)\b/i, weight: -6 },
  { pattern: /\b(mattress|chair|desk|table|lamp|mirror|cabinet)\b/i, weight: -6 },
  // Astronomy (northern lights false positive)
  {
    pattern: /\b(nasa|astronomy|aurora|borealis|space|constellation|nebula|observatory)\b/i,
    weight: -5,
  },
  // Games (420 score false positive)
  { pattern: /\b(wordle|puzzle|score|game|trivia|quiz)\b/i, weight: -4 },
  // Gardening (weed false positive)
  { pattern: /\b(garden|lawn|pull\s+weed|weed\s+out|weeding|invasive)\b/i, weight: -4 },
  // Music (purple haze = Jimi Hendrix)
  { pattern: /\b(jimi|hendrix|guitar|song|album|concert|band)\b/i, weight: -3 },
  // Products/Commerce spam
  { pattern: /\b(led\s+light|bathroom|mirror|homedecor|vanity|amazon|ebay)\b/i, weight: -4 },
  // Cooking (baked false positive)
  {
    pattern: /\b(recipe|oven|baking\s+soda|flour|cake\s+recipe|cookie\s+recipe|hash\s*browns?)\b/i,
    weight: -3,
  },
  // Sports/Records (shatter records)
  {
    pattern: /\b(nba|nfl|mlb|warriors|lakers|basketball|football|season|record|points|assists)\b/i,
    weight: -4,
  },
  // Glass/Art metaphors (shatter)
  { pattern: /\b(glass|illusions?|dreams?|mirror|window|crystal)\b/i, weight: -3 },
  // Finance/Banking (CBN = Central Bank)
  { pattern: /\b(bank|banking|central\s+bank|monetary|financial|economy|fiscal)\b/i, weight: -5 },
  // Star Wars (skywalker)
  { pattern: /\b(luke|star\s*wars|jedi|vader|yoda|force\s+awakens)\b/i, weight: -5 },
  // Historical buildings
  {
    pattern: /\b(victorian|heritage|listed|refurbishment|railway|swimming\s+pool|baths)\b/i,
    weight: -4,
  },
  // Automotive (hybrid SUV, joint venture)
  {
    pattern:
      /\b(suv|sedan|vehicle|car|automotive|huawei|tesla|toyota|honda|ford|plug-in|electric\s+vehicle|ev)\b/i,
    weight: -5,
  },
  // Idioms
  { pattern: /\bweed\s+out\b/i, weight: -5 },
  { pattern: /\bjoint\s+(effort|venture|statement|custody|series)\b/i, weight: -5 },
  { pattern: /\bpipe\s+dream\b/i, weight: -4 },
  { pattern: /\bhigh\s+(school|court|five|road|way|level|quality|priority)\b/i, weight: -5 },
  // Fibromyalgia/medical typos
  { pattern: /\b(fibromyalgia|chronic\s+pain|arthritis)\b/i, weight: -2 },
];

// Build regex for high confidence (single match)
const highConfidencePatterns = HIGH_CONFIDENCE_KEYWORDS.map((kw) => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped;
});
const HIGH_CONFIDENCE_REGEX = new RegExp('\\b(' + highConfidencePatterns.join('|') + ')\\b', 'i');

// Build regex for medium confidence (need 2+ matches)
const mediumConfidencePatterns = MEDIUM_CONFIDENCE_KEYWORDS.map((kw) => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped;
});
const MEDIUM_CONFIDENCE_REGEX = new RegExp(
  '\\b(' + mediumConfidencePatterns.join('|') + ')\\b',
  'gi' // global flag to count matches
);

// Build regex for strain names (require context validation)
const strainNamePatterns = STRAIN_NAMES.map((kw) => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped;
});
const STRAIN_NAME_REGEX = new RegExp('\\b(' + strainNamePatterns.join('|') + ')\\b', 'i');

// Build regex for positive context signals
const positiveContextPatterns = POSITIVE_CONTEXT_SIGNALS.map((kw) => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped;
});
const POSITIVE_CONTEXT_REGEX = new RegExp(
  '\\b(' + positiveContextPatterns.join('|') + ')\\b',
  'gi'
);

/**
 * Calculate context score for a post
 * Positive score = likely cannabis content
 * Negative score = likely false positive
 *
 * @param {string} text - Post text
 * @returns {number} Context score
 */
function calculateContextScore(text) {
  if (!text) return 0;

  let score = 0;

  // Count positive signals
  const positiveMatches = text.match(POSITIVE_CONTEXT_REGEX);
  if (positiveMatches) {
    // Unique matches to avoid counting same word multiple times
    const uniquePositive = [...new Set(positiveMatches.map((m) => m.toLowerCase()))];
    score += uniquePositive.length * 2;
  }

  // Check negative signals
  for (const signal of NEGATIVE_CONTEXT_SIGNALS) {
    if (signal.pattern.test(text)) {
      score += signal.weight; // weight is negative
    }
  }

  return score;
}

/**
 * Check if a post should be included in the feed
 *
 * SIMPLIFIED FLOW (with DeepSeek AI):
 * 1. Cannect.space users → Include directly (trusted)
 * 2. High confidence keywords → Send to AI (catches false positives like "dispensary" in historical building)
 * 3. Strain names → Send to AI (most false positives)
 * 4. 2+ medium keywords → Send to AI
 * 5. Single medium + positive context → Send to AI
 * 6. No match / single medium alone → Reject
 *
 * Keywords act as pre-filter (reduces millions to hundreds)
 * AI acts as quality filter (ensures ~99% accuracy)
 *
 * @param {string} authorHandle - Author's handle (e.g., "user.cannect.space")
 * @param {string} text - Post text content
 * @returns {{ include: boolean, reason: string, needsAI?: boolean }}
 */
function shouldIncludePost(authorHandle, text) {
  // Rule 1: Always include Cannect users (no AI needed - trusted users)
  if (
    authorHandle &&
    (authorHandle.endsWith('.cannect.space') || authorHandle.endsWith('.pds.cannect.space'))
  ) {
    return { include: true, reason: 'cannect_user', needsAI: false };
  }

  if (!text) {
    return { include: false, reason: 'no_text', needsAI: false };
  }

  // Calculate context for medium keyword decisions
  const contextScore = calculateContextScore(text);

  // Rule 2: High confidence keywords → AI verification
  // Skip AI if strongly negative context (obvious false positive)
  if (HIGH_CONFIDENCE_REGEX.test(text)) {
    if (contextScore < -5) {
      return { include: false, reason: 'high_conf_negative_ctx', needsAI: false };
    }
    return { include: false, reason: 'high_confidence', needsAI: true };
  }

  // Rule 3: Strain names → AI verification
  if (STRAIN_NAME_REGEX.test(text)) {
    return { include: false, reason: 'strain_match', needsAI: true };
  }

  // Rule 4: Medium confidence keywords
  const mediumMatches = text.match(MEDIUM_CONFIDENCE_REGEX);
  if (mediumMatches) {
    const uniqueMatches = [...new Set(mediumMatches.map((m) => m.toLowerCase()))];

    // Skip AI entirely if context is clearly negative (false positive signals present)
    if (contextScore < -3) {
      return { include: false, reason: 'negative_context', needsAI: false };
    }

    // 2+ different medium keywords + not negative context → AI verification
    if (uniqueMatches.length >= 2 && contextScore >= 0) {
      return { include: false, reason: 'multi_medium', needsAI: true };
    }

    // Single medium + STRONG positive context (3+) → AI verification
    // Raised threshold from 0 to 3 to reduce false positives
    if (uniqueMatches.length === 1 && contextScore >= 3) {
      return { include: false, reason: 'medium_with_context', needsAI: true };
    }
  }

  // Rule 5: No keyword match or weak context → Reject
  return { include: false, reason: 'no_match', needsAI: false };
}

/**
 * Extract text content from a post record
 */
function getPostText(record) {
  if (!record) return '';

  // Main text
  let text = record.text || '';

  // Also check embeds for quoted posts
  if (record.embed?.record?.value?.text) {
    text += ' ' + record.embed.record.value.text;
  }

  return text;
}

module.exports = {
  shouldIncludePost,
  getPostText,
  calculateContextScore,
  HIGH_CONFIDENCE_KEYWORDS,
  MEDIUM_CONFIDENCE_KEYWORDS,
  STRAIN_NAMES,
  POSITIVE_CONTEXT_SIGNALS,
  NEGATIVE_CONTEXT_SIGNALS,
};
