// AI-based content filtering using OpenAI API
// Uses gpt-4o-mini for cannabis content classification

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

// Rate limiting - be gentle, no hard limits but good practice
const MIN_DELAY_MS = 100; // 100ms between requests
let lastRequestTime = 0;

const SYSTEM_PROMPT = `You are a content curator for Cannect, a premium cannabis social network.
Your job: Decide if a post belongs in our cannabis community feed.

Answer ONLY: YES or NO

=== INCLUDE (YES) - Quality cannabis content ===
• Personal experiences: "Just tried Blue Dream, amazing for anxiety"
• Growing/cultivation: photos, tips, harvest updates
• Strain reviews, product recommendations, dispensary visits
• Cannabis news, legalization updates, industry insights
• 420 culture, stoner humor, community vibes
• Medical cannabis experiences, CBD benefits
• Cooking with cannabis, DIY edibles
• Cannabis art, photography, lifestyle content

=== EXCLUDE (NO) ===

1. FALSE POSITIVES (not about cannabis):
   • "high" = tall, emotional, temperature, scores, prices, medication
   • "baked" = tired, cooking, sunburn
   • "joint" = venture, body part, committee
   • "green" = eco, money, envy, golf
   • "hash" = hashtag, food, crypto
   • "pot" = cooking, pottery, jackpot
   • "weed" = garden weeds, "weed out"
   • Prescription meds: "high on painkillers/medication"
   • Product names with "High" (High Sierra, High Noon, boots)

2. LOW QUALITY SPAM (even if cannabis-related):
   • Affiliate links, product spam, "buy online" posts
   • Repetitive promotions, crypto/NFT spam
   • Engagement bait: "Like if you smoke!"
   • Generic reposted content with no value

3. HARMFUL CONTENT:
   • Illegal sales/sourcing, underage references
   • Driving while high, hard drug combos

=== CONTEXT RULES ===
• "I'm so high" + weed context = YES
• "I'm so high" + rollercoaster/emotions/meds = NO
• Cannabis arrest/law news = YES
• Generic news with "high" = NO
• Stoner memes = YES, random memes = NO`;


/**
 * Wait for rate limit if needed
 */
async function waitForRateLimit() {
  const now = Date.now();
  
  // Ensure minimum delay between requests
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastRequest));
  }
  
  lastRequestTime = Date.now();
}

/**
 * Verify if a post is genuinely about cannabis using OpenAI
 * @param {string} text - The post text to analyze
 * @returns {Promise<{isCannabis: boolean, error: boolean}>}
 */
async function verifyWithAI(text) {
  if (!OPENAI_API_KEY) {
    console.error('[AI-Filter] OPENAI_API_KEY not set');
    return { isCannabis: false, error: true };
  }

  try {
    // Wait for rate limit
    await waitForRateLimit();
    
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Should this post appear in our cannabis community feed?\n\n"""\n${text}\n"""` }
        ],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[AI-Filter] API error ${response.status}:`, errorData);
      return { isCannabis: false, error: true };
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim()?.toUpperCase();
    
    const isCannabis = answer === 'YES';
    console.log(`[AI-Filter] "${text.substring(0, 50)}..." → ${answer}`);
    
    return { isCannabis, error: false };
  } catch (error) {
    console.error('[AI-Filter] Request failed:', error.message);
    return { isCannabis: false, error: true };
  }
}

/**
 * Batch verify multiple posts (for future optimization)
 * @param {string[]} texts - Array of post texts
 * @returns {Promise<{results: boolean[], error: boolean}>}
 */
async function verifyBatchWithAI(texts) {
  // For now, just process sequentially with small delay to avoid rate limits
  const results = [];
  for (const text of texts) {
    const result = await verifyWithAI(text);
    results.push(result.isCannabis);
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { results, error: false };
}

module.exports = {
  verifyWithAI,
  verifyBatchWithAI,
};
