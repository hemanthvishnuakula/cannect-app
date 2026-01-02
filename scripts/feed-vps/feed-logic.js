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
  'cbn',
  'cbd oil',
  'cbd gummies',
  'full spectrum cbd',

  // Consumption methods (specific)
  'dispensary',
  'dispensaries',
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

  // Products (specific)
  'live rosin',
  'live resin',
  'cannabis oil',
  'weed edibles',
  'thc edibles',
  'cannabis edibles',
  'moon rocks',
  'moonrocks',
  'shatter',
  'cannabis wax',
  'thc wax',
  'cannabis concentrate',
  'thc concentrate',
  'hash rosin',
  'bubble hash',
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
  'hybrid', // Very generic
  'terpenes', // Could be perfume/essential oils
  'terps', // Slang, need context
  'edibles', // Could be any food
  'blunt', // Could be "blunt statement"
  'joint', // Could be "joint effort"
  'bong', // Need context
  'dabs', // Could be dance move
  'stoner', // Need context
  'stoned', // Could be biblical
  'baked', // Could be cooking
  'high', // Very generic
  '420', // Could be just a number
  'flower', // Very generic (gardening)
  'nug', // Need context
  'nugs', // Need context
  'strain', // Could be music/stress
  'pre-roll', // Need context
  'preroll', // Need context
  'hash', // Could be hashtag or data
  'bowl', // Very generic
  'pipe', // Very generic
  'grinder', // Could be coffee
];

// =============================================================================
// TIER 3: STRAIN NAMES - Require positive context (could be false positives)
// These are strain names that could match non-cannabis content
// =============================================================================
const STRAIN_NAMES = [
  'og kush',
  'purple haze',
  'blue dream',
  'girl scout cookies',
  'gsc strain',
  'gorilla glue',
  'gg4',
  'white widow',
  'northern lights',
  'sour diesel',
  'jack herer',
  'pineapple express',
  'gelato strain',
  'zkittlez',
  'wedding cake strain',
  'runtz',
  'granddaddy purple',
  'gdp strain',
  'green crack',
  'super lemon haze',
  'trainwreck',
  'headband',
  'cherry pie',
  'cookies',
  'sherbert',
  'sunset sherbert',
];

// =============================================================================
// CONTEXT SIGNALS - Used for context-aware filtering
// =============================================================================

// Positive signals: Terms that confirm cannabis context
const POSITIVE_CONTEXT_SIGNALS = [
  // Core terms
  'cannabis', 'marijuana', 'weed', 'thc', 'cbd', 'dispensary',
  // Consumption
  'smoke', 'smoked', 'smoking', 'vape', 'edible', 'edibles', 'dab',
  // Types
  'indica', 'sativa', 'hybrid', 'strain',
  // Growing
  'grow', 'harvest', 'trichome', 'flowering', 'cultivar',
  // Culture
  'stoner', 'baked', 'high', 'blazed', '420',
  // Hashtags
  '#cannabis', '#weed', '#420', '#stoner', '#thc', '#cbd', '#mmj',
  '#cannabiscommunity', '#growmie', '#homegrow',
];

// Negative signals: Terms that indicate false positive
const NEGATIVE_CONTEXT_SIGNALS = [
  // Astronomy (northern lights false positive)
  { pattern: /\b(nasa|astronomy|aurora|borealis|space|constellation|nebula|observatory)\b/i, weight: -5 },
  // Games (420 score false positive)
  { pattern: /\b(wordle|puzzle|score|game|trivia|quiz)\b/i, weight: -4 },
  // Gardening (weed false positive)
  { pattern: /\b(garden|lawn|pull\s+weed|weed\s+out|weeding|invasive)\b/i, weight: -4 },
  // Music (purple haze = Jimi Hendrix)
  { pattern: /\b(jimi|hendrix|guitar|song|album|concert|band)\b/i, weight: -3 },
  // Products/Commerce spam
  { pattern: /\b(led\s+light|bathroom|mirror|homedecor|vanity|amazon|ebay)\b/i, weight: -4 },
  // Cooking (baked false positive)
  { pattern: /\b(recipe|oven|baking\s+soda|flour|cake\s+recipe|cookie\s+recipe)\b/i, weight: -3 },
  // Idioms
  { pattern: /\bweed\s+out\b/i, weight: -5 },
  { pattern: /\bjoint\s+(effort|venture|statement|custody)\b/i, weight: -5 },
  { pattern: /\bpipe\s+dream\b/i, weight: -4 },
  { pattern: /\bhigh\s+(school|court|five|road|way|level|quality|priority)\b/i, weight: -5 },
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
const POSITIVE_CONTEXT_REGEX = new RegExp('\\b(' + positiveContextPatterns.join('|') + ')\\b', 'gi');

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
 * @param {string} authorHandle - Author's handle (e.g., "user.cannect.space")
 * @param {string} text - Post text content
 * @returns {{ include: boolean, reason: string, contextScore?: number }}
 */
function shouldIncludePost(authorHandle, text) {
  // Rule 1: Always include cannect.space users
  if (authorHandle && authorHandle.endsWith('.cannect.space')) {
    return { include: true, reason: 'cannect_user' };
  }

  if (!text) {
    return { include: false, reason: 'no_text' };
  }

  // Calculate context score for context-aware decisions
  const contextScore = calculateContextScore(text);

  // Rule 2a: High confidence keywords (single match = include)
  // But check for strong negative context that could indicate false positive
  if (HIGH_CONFIDENCE_REGEX.test(text)) {
    // If context score is very negative, it's likely a false positive
    if (contextScore < -3) {
      return { include: false, reason: 'false_positive_context', contextScore };
    }
    return { include: true, reason: 'high_confidence_keyword', contextScore };
  }

  // Rule 2b: Strain names - require positive context to avoid false positives
  // (e.g., "northern lights" could be aurora, "purple haze" could be Hendrix)
  if (STRAIN_NAME_REGEX.test(text)) {
    // Need positive context score to include strain name matches
    if (contextScore >= 2) {
      return { include: true, reason: 'strain_with_context', contextScore };
    }
    // If neutral or negative context, skip (likely false positive)
    return { include: false, reason: 'strain_no_context', contextScore };
  }

  // Rule 2c: Medium confidence keywords (need 2+ different matches)
  const mediumMatches = text.match(MEDIUM_CONFIDENCE_REGEX);
  if (mediumMatches) {
    // Get unique matches (case-insensitive)
    const uniqueMatches = [...new Set(mediumMatches.map((m) => m.toLowerCase()))];

    if (uniqueMatches.length >= 2) {
      // Even with 2+ matches, check for negative context
      if (contextScore < -2) {
        return { include: false, reason: 'medium_false_positive', contextScore };
      }
      return { include: true, reason: 'multiple_medium_keywords', contextScore };
    }
  }

  return { include: false, reason: 'no_match' };
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
