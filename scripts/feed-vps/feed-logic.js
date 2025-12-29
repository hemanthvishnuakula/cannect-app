/**
 * Feed Logic - Determines which posts to include
 *
 * Simple rules:
 * 1. All posts from cannect.space users
 * 2. Posts containing cannabis-related keywords (HIGH CONFIDENCE ONLY)
 *
 * We use a tiered approach:
 * - Tier 1: Unmistakable cannabis terms (single match = include)
 * - Tier 2: Ambiguous terms that need context (require 2+ matches or supporting context)
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
  
  // Strains (specific names)
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
  'legalization',
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
  '#420',
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
];

// =============================================================================
// TIER 2: MEDIUM CONFIDENCE - Need additional context
// These could be false positives, so require 2+ matches
// =============================================================================
const MEDIUM_CONFIDENCE_KEYWORDS = [
  'weed',       // Could be garden weed
  'kush',       // Could be name/slang
  'indica',     // Need context
  'sativa',     // Need context
  'hybrid',     // Very generic
  'terpenes',   // Could be perfume/essential oils
  'terps',      // Slang, need context
  'edibles',    // Could be any food
  'blunt',      // Could be "blunt statement"
  'joint',      // Could be "joint effort"
  'bong',       // Need context
  'dabs',       // Could be dance move
  'stoner',     // Need context
  'stoned',     // Could be biblical
  'baked',      // Could be cooking
  'high',       // Very generic
  '420',        // Could be just a number
  'flower',     // Very generic (gardening)
  'nug',        // Need context
  'nugs',       // Need context
  'strain',     // Could be music/stress
  'pre-roll',   // Need context
  'preroll',    // Need context
  'hash',       // Could be hashtag or data
  'bowl',       // Very generic
  'pipe',       // Very generic
  'grinder',    // Could be coffee
];

// Build regex for high confidence (single match)
const highConfidencePatterns = HIGH_CONFIDENCE_KEYWORDS.map((kw) => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped;
});
const HIGH_CONFIDENCE_REGEX = new RegExp(
  '\\b(' + highConfidencePatterns.join('|') + ')\\b',
  'i'
);

// Build regex for medium confidence (need 2+ matches)
const mediumConfidencePatterns = MEDIUM_CONFIDENCE_KEYWORDS.map((kw) => {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped;
});
const MEDIUM_CONFIDENCE_REGEX = new RegExp(
  '\\b(' + mediumConfidencePatterns.join('|') + ')\\b',
  'gi' // global flag to count matches
);

/**
 * Check if a post should be included in the feed
 *
 * @param {string} authorHandle - Author's handle (e.g., "user.cannect.space")
 * @param {string} text - Post text content
 * @returns {{ include: boolean, reason: string }}
 */
function shouldIncludePost(authorHandle, text) {
  // Rule 1: Always include cannect.space users
  if (authorHandle && authorHandle.endsWith('.cannect.space')) {
    return { include: true, reason: 'cannect_user' };
  }

  if (!text) {
    return { include: false, reason: 'no_text' };
  }

  // Rule 2a: High confidence keywords (single match = include)
  if (HIGH_CONFIDENCE_REGEX.test(text)) {
    return { include: true, reason: 'high_confidence_keyword' };
  }

  // Rule 2b: Medium confidence keywords (need 2+ different matches)
  const mediumMatches = text.match(MEDIUM_CONFIDENCE_REGEX);
  if (mediumMatches) {
    // Get unique matches (case-insensitive)
    const uniqueMatches = [...new Set(mediumMatches.map(m => m.toLowerCase()))];
    
    if (uniqueMatches.length >= 2) {
      return { include: true, reason: 'multiple_medium_keywords' };
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
  HIGH_CONFIDENCE_KEYWORDS,
  MEDIUM_CONFIDENCE_KEYWORDS,
};
