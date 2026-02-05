// AI-based content filtering using OpenAI API
// Quality scoring for cannabis business intelligence

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

// Rate limiting
const MIN_DELAY_MS = 100;
let lastRequestTime = 0;

// Token usage tracking
const tokenStats = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  lastResetTime: Date.now(),
};

// Quality threshold - posts below this score are filtered out
const QUALITY_THRESHOLD = 5;

// Optimized prompt (~350 tokens vs original ~580 tokens, -40% cost)
const SYSTEM_PROMPT = `Cannabis business content curator. Score 1-10 for professional value.
JSON only: {"score":N,"category":"X","reason":"Y"}

SCORES:
9-10: Regulatory news, market data, M&A, funding, compliance updates
7-8: Business tips, detailed product reviews, trade events, education
5-6: Personal industry experiences, dispensary visits, community opinions
3-4: Basic consumption posts ("smoking rn"), low-effort stoner content
1-2: Spam, not cannabis related, harmful content

CATEGORIES: regulatory|market|cultivation|retail|science|lifestyle|spam

False positives: "high/baked/joint/green/pot" often non-cannabis → score 1, category spam`;

/**
 * Wait for rate limit if needed
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
}

/**
 * Score a post for quality and relevance
 * @param {string} text - The post text to analyze
 * @returns {Promise<{score: number, category: string, reason: string, isCannabis: boolean, error: boolean}>}
 */
async function scorePost(text) {
  if (!OPENAI_API_KEY) {
    console.error('[AI-Filter] OPENAI_API_KEY not set');
    return {
      score: 0,
      category: 'error',
      reason: 'API key missing',
      isCannabis: false,
      error: true,
    };
  }

  try {
    await waitForRateLimit();

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Score this post for cannabis business professionals:\n\n"""\n${text}\n"""`,
          },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[AI-Filter] API error ${response.status}:`, errorData);
      return { score: 0, category: 'error', reason: 'API error', isCannabis: false, error: true };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    // Track token usage
    if (data.usage) {
      tokenStats.totalPromptTokens += data.usage.prompt_tokens || 0;
      tokenStats.totalCompletionTokens += data.usage.completion_tokens || 0;
      tokenStats.totalTokens += data.usage.total_tokens || 0;
      tokenStats.requestCount++;
    }

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content);
    } catch (e) {
      console.error('[AI-Filter] Failed to parse response:', content);
      return { score: 0, category: 'error', reason: 'Parse error', isCannabis: false, error: true };
    }

    const score = result.score || 0;
    const category = result.category || 'unknown';
    const reason = result.reason || '';
    const isCannabis = score >= QUALITY_THRESHOLD && category !== 'spam';

    console.log(
      `[AI-Filter] Score ${score}/10 [${category}] "${text.substring(0, 40)}..." → ${isCannabis ? 'INCLUDE' : 'EXCLUDE'}`
    );

    return { score, category, reason, isCannabis, error: false };
  } catch (error) {
    console.error('[AI-Filter] Request failed:', error.message);
    return { score: 0, category: 'error', reason: error.message, isCannabis: false, error: true };
  }
}

/**
 * Legacy function - wraps scorePost for backward compatibility
 * @param {string} text - The post text to analyze
 * @returns {Promise<{isCannabis: boolean, error: boolean}>}
 */
async function verifyWithAI(text) {
  const result = await scorePost(text);
  return { isCannabis: result.isCannabis, error: result.error };
}

/**
 * Batch score multiple posts
 * @param {string[]} texts - Array of post texts
 * @returns {Promise<{results: Array<{score: number, category: string, isCannabis: boolean}>, error: boolean}>}
 */
async function scoreBatch(texts) {
  const results = [];
  for (const text of texts) {
    const result = await scorePost(text);
    results.push(result);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { results, error: false };
}

/**
 * Legacy batch function for backward compatibility
 */
async function verifyBatchWithAI(texts) {
  const { results } = await scoreBatch(texts);
  return { results: results.map((r) => r.isCannabis), error: false };
}

/**
 * Get token usage statistics
 * gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output
 */
function getTokenStats() {
  const runningHours = (Date.now() - tokenStats.lastResetTime) / (1000 * 60 * 60);
  const inputCost = (tokenStats.totalPromptTokens / 1_000_000) * 0.15;
  const outputCost = (tokenStats.totalCompletionTokens / 1_000_000) * 0.6;
  const totalCost = inputCost + outputCost;

  return {
    ...tokenStats,
    runningHours: runningHours.toFixed(2),
    avgTokensPerRequest:
      tokenStats.requestCount > 0
        ? Math.round(tokenStats.totalTokens / tokenStats.requestCount)
        : 0,
    estimatedCost: `$${totalCost.toFixed(4)}`,
    costPerRequest:
      tokenStats.requestCount > 0 ? `$${(totalCost / tokenStats.requestCount).toFixed(6)}` : '$0',
    projectedDailyCost:
      runningHours > 0 ? `$${((totalCost / runningHours) * 24).toFixed(4)}` : '$0',
  };
}

/**
 * Reset token stats (call daily or on restart)
 */
function resetTokenStats() {
  tokenStats.totalPromptTokens = 0;
  tokenStats.totalCompletionTokens = 0;
  tokenStats.totalTokens = 0;
  tokenStats.requestCount = 0;
  tokenStats.lastResetTime = Date.now();
}

module.exports = {
  scorePost,
  scoreBatch,
  verifyWithAI,
  verifyBatchWithAI,
  getTokenStats,
  resetTokenStats,
  QUALITY_THRESHOLD,
};
