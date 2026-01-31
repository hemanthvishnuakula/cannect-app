function handleNewPost(did, commit) {
  const record = commit.record;
  if (!record) return;

  // Skip replies - only include top-level posts for better feed quality
  if (record.reply) {
    return;
  }

  // Get post text
  const text = getPostText(record);

  // Check if this is a cannect.space user (by DID lookup)
  const isCannectSpaceUser = isCannectUser(did);

  // Check if post should be included
  // Pass a fake handle for cannect.space users so shouldIncludePost works
  const handle = isCannectSpaceUser ? 'user.cannect.space' : '';
  const result = shouldIncludePost(handle, text);

  const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
  const cid = commit.cid;
  // Always use server UTC time for consistent sorting
  const indexedAt = new Date().toISOString();

  // Extract content for storage (for ML training)
  const content = extractPostContent(record);

  // If post should be included directly (high confidence or cannect user)
  if (result.include) {
    db.addPost(uri, cid, did, handle, indexedAt, content);
    stats.indexed++;

    if (result.reason === 'cannect_user') {
      console.log(`[Indexer] Cannect user post: ${uri.substring(0, 60)}...`);
    }

    if (stats.indexed % 100 === 0) {
      console.log(`[Indexer] Stats: ${stats.indexed} indexed, ${stats.processed} processed`);
    }
    return;
  }

  // If post needs AI verification (ambiguous content)
  if (result.needsAI && text) {
    // Process async - don't block the main event loop
    processWithAI(uri, cid, did, handle, text, indexedAt, result.reason, content).catch((err) => {
      console.error(`[AI-Filter] Error processing post:`, err.message);
    });
  }
}

/**
 * Extract post content for database storage (ML training data)
 */
function extractPostContent(record) {
  // Determine embed type and if has media
  let embedType = null;
  let hasMedia = false;

  if (record.embed) {
    const embedTypeStr = record.embed.$type || '';
    if (embedTypeStr.includes('images')) {
      embedType = 'images';
      hasMedia = true;
    } else if (embedTypeStr.includes('video')) {
      embedType = 'video';
      hasMedia = true;
    } else if (embedTypeStr.includes('external')) {
      embedType = 'external';
    } else if (embedTypeStr.includes('record')) {
      embedType = 'quote';
    } else if (embedTypeStr.includes('recordWithMedia')) {
      embedType = 'quote_with_media';
      hasMedia = true;
    }
  }

  return {
    text: record.text || null,
    facets: record.facets || null,
    hasMedia,
    embedType,
    langs: record.langs || null,
  };
}

/**
 * Process a post with AI verification
 */
async function processWithAI(uri, cid, did, handle, text, indexedAt, reason, content = {}) {
  try {
    const aiResult = await verifyWithAI(text);

    if (aiResult.error) {
      // If AI fails, don't include (conservative approach)
      console.log(`[AI-Filter] Error for "${text.substring(0, 40)}..." - skipping`);
      return;
    }

    if (aiResult.isCannabis) {
      db.addPost(uri, cid, did, handle, indexedAt, content);
      stats.indexed++;
      console.log(`[AI-Filter] ✓ INCLUDED (${reason}): ${text.substring(0, 50)}...`);
    } else {
      console.log(`[AI-Filter] ✗ REJECTED (${reason}): ${text.substring(0, 50)}...`);
    }
  } catch (err) {
    console.error(`[AI-Filter] Exception:`, err.message);
  }
}
