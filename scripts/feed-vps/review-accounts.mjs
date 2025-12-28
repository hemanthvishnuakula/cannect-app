/**
 * Review cannabis accounts - check if they actually post about cannabis
 * Run: node review-accounts.mjs
 */

const CANNABIS_ACCOUNTS = [
  // === SEED ACCOUNTS ===
  'boxbrown.bsky.social',
  'mistressmatisse.bsky.social',
  'rosasparks.bsky.social',
  
  // === CANNABIS MEDIA & NEWS ===
  'nycannabistimes.com',
  'normlorg.bsky.social',
  'filtermag.bsky.social',
  
  // === CANNABIS INDUSTRY ===
  'cannabis-lounges.bsky.social',
  'mybpg.bsky.social',
  'cantrip.bsky.social',
  'hempfarm.bsky.social',
  
  // === CANNABIS ADVOCATES & ACTIVISTS ===
  'weedjesus.bsky.social',
  'ngaio420.bsky.social',
  'milfweed.bsky.social',
  'oglesby.bsky.social',
  'junglecae.bsky.social',
  'chrisgoldstein.bsky.social',
  'danalarsen.bsky.social',
  'montelwilliams.bsky.social',
  'njlegalizeme.bsky.social',
  'breedersteve.bsky.social',
  'leddder.bsky.social',
  'nhcannapatient.bsky.social',
  'shaleen.bsky.social',
  'ommpeddie.bsky.social',
  'buchanan.today',
  'samreisman.bsky.social',
  'thedocumattarian.bsky.social',
  
  // === CANNABIS CULTURE ===
  'hotnails666420.bsky.social',
  'cannabis.bsky.social',
  'vulgarweed.bsky.social',
  'catarinakush.bsky.social',
  'kushkomikss.bsky.social',
  'thepotlabphd.bsky.social',
  'ricksteves.bsky.social',
  
  // === CANNABIS-ADJACENT ===
  'weedlordbonerchamp.hellthread.vet',
  'jonweb.bsky.social',
  'atheistgirl.bsky.social',
  'timmytwoshirts.bsky.social',
];

const CANNABIS_KEYWORDS = [
  'cannabis', 'marijuana', 'weed', '420', 'thc', 'cbd',
  'dispensary', 'strain', 'indica', 'sativa', 'hybrid',
  'edible', 'flower', 'concentrate', 'dab', 'vape',
  'legalize', 'legalization', 'decriminalize',
  'stoner', 'high', 'bud', 'nug', 'kush', 'hemp',
  'terpene', 'cannabinoid', 'joint', 'blunt', 'bong',
  'grower', 'cultivator', 'harvest', 'cure',
  'medical marijuana', 'recreational', 'adult use',
  'norml', 'reform', 'prohibition'
];

async function getProfile(handle) {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getRecentPosts(handle, limit = 30) {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=${limit}&filter=posts_no_replies`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.feed || [];
  } catch {
    return [];
  }
}

function countCannabisKeywords(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  for (const keyword of CANNABIS_KEYWORDS) {
    if (lower.includes(keyword)) count++;
  }
  return count;
}

function analyzePosts(posts) {
  let cannabisPosts = 0;
  let totalPosts = posts.length;
  const examples = [];
  
  for (const item of posts) {
    const text = item.post?.record?.text || '';
    const keywordCount = countCannabisKeywords(text);
    
    if (keywordCount > 0) {
      cannabisPosts++;
      if (examples.length < 3) {
        examples.push(text.slice(0, 100) + (text.length > 100 ? '...' : ''));
      }
    }
  }
  
  return {
    total: totalPosts,
    cannabisRelated: cannabisPosts,
    percentage: totalPosts > 0 ? Math.round((cannabisPosts / totalPosts) * 100) : 0,
    examples
  };
}

function getRating(percentage, bioMatch) {
  if (percentage >= 50) return '🟢 HIGH';
  if (percentage >= 25 || (percentage >= 10 && bioMatch)) return '🟡 MEDIUM';
  if (percentage >= 5) return '🟠 LOW';
  return '🔴 REMOVE';
}

async function main() {
  console.log('🔍 Cannabis Account Review\n');
  console.log('Analyzing recent posts from each account...\n');
  console.log('═'.repeat(100));
  
  const results = [];
  
  for (const handle of CANNABIS_ACCOUNTS) {
    process.stdout.write(`Checking ${handle}...`);
    
    const profile = await getProfile(handle);
    if (!profile) {
      console.log(' ❌ NOT FOUND');
      results.push({ handle, status: 'NOT_FOUND', rating: '🔴 REMOVE' });
      continue;
    }
    
    const posts = await getRecentPosts(handle);
    const bioKeywords = countCannabisKeywords(profile.description || '');
    const analysis = analyzePosts(posts);
    
    const rating = getRating(analysis.percentage, bioKeywords > 0);
    
    results.push({
      handle,
      displayName: profile.displayName || handle,
      bio: (profile.description || '').slice(0, 80),
      bioHasCannabis: bioKeywords > 0,
      postsAnalyzed: analysis.total,
      cannabisPosts: analysis.cannabisRelated,
      percentage: analysis.percentage,
      rating,
      examples: analysis.examples
    });
    
    console.log(` ${rating} (${analysis.cannabisRelated}/${analysis.total} = ${analysis.percentage}%)`);
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('\n' + '═'.repeat(100));
  console.log('\n📊 DETAILED RESULTS\n');
  
  // Group by rating
  const groups = {
    '🟢 HIGH': [],
    '🟡 MEDIUM': [],
    '🟠 LOW': [],
    '🔴 REMOVE': []
  };
  
  for (const r of results) {
    groups[r.rating]?.push(r);
  }
  
  // Print each group
  for (const [rating, accounts] of Object.entries(groups)) {
    if (accounts.length === 0) continue;
    
    console.log(`\n${rating} CONFIDENCE (${accounts.length} accounts)`);
    console.log('─'.repeat(80));
    
    for (const a of accounts) {
      if (a.status === 'NOT_FOUND') {
        console.log(`  ${a.handle} - Account not found`);
        continue;
      }
      
      console.log(`\n  ${a.handle}`);
      console.log(`  Name: ${a.displayName}`);
      console.log(`  Bio: "${a.bio}${a.bio?.length >= 80 ? '...' : ''}"`);
      console.log(`  Bio mentions cannabis: ${a.bioHasCannabis ? 'Yes' : 'No'}`);
      console.log(`  Cannabis posts: ${a.cannabisPosts}/${a.postsAnalyzed} (${a.percentage}%)`);
      
      if (a.examples?.length > 0) {
        console.log(`  Example posts:`);
        for (const ex of a.examples) {
          console.log(`    - "${ex}"`);
        }
      }
    }
  }
  
  // Output recommended list
  console.log('\n' + '═'.repeat(100));
  console.log('\n📋 RECOMMENDED ACCOUNTS (HIGH + MEDIUM confidence):\n');
  
  const recommended = [...groups['🟢 HIGH'], ...groups['🟡 MEDIUM']];
  console.log('const CANNABIS_ACCOUNTS = [');
  for (const a of recommended) {
    if (a.status !== 'NOT_FOUND') {
      console.log(`  '${a.handle}',  // ${a.percentage}% cannabis posts`);
    }
  }
  console.log('];');
  
  console.log('\n❌ ACCOUNTS TO REMOVE:\n');
  for (const a of [...groups['🟠 LOW'], ...groups['🔴 REMOVE']]) {
    console.log(`  ${a.handle} - ${a.percentage}% cannabis posts`);
  }
}

main().catch(console.error);
