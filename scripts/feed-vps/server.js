/**
 * Cannect Feed Service
 * Real-time feed aggregation via Jetstream
 * 
 * Phase 1: Local Feed + Global Feed
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const CANNECT_PDS = 'https://cannect.space';
const JETSTREAM_URL = 'wss://jetstream2.us-west.bsky.network/subscribe';

// Curated cannabis community accounts for global feed
// Verified accounts that actively post about cannabis (reviewed 2024-12-28)
// Managed by: node manage-accounts.mjs
// Rating: percentage of recent posts about cannabis (minimum 10% to qualify)
// Auto-generated: 205 verified accounts
const CANNABIS_ACCOUNTS = [
  // === 🟢 HIGH CONFIDENCE (50%+ cannabis posts) ===
  'normlorg.bsky.social',             // 100% - NORML
  'weedjesus.bsky.social',            // 100% - Weed Jesus
  'oglesby.bsky.social',              // 100% - Pat Oglesby
  'junglecae.bsky.social',            // 100% - Cae
  'potculturemagazine.com',           // 100% - Pot Culture Magazine
  'industria420.bsky.social',         // 100% - Industria420 Cannabis News
  'weedcheck.bsky.social',            // 100% - Weed Check
  'cannabisjrnl.bsky.social',         // 100% - Cannabis and Cannabinoid Research
  'mydogateedibles.com',              // 100% - MyDogAteEdibles.com
  'o2vape.bsky.social',               // 100% - O2vape
  'cmcr-ucsd.bsky.social',            // 100% - CMCR @ UCSD
  'covasoftware.bsky.social',         // 100% - Cova Software
  'omnimedical.bsky.social',          // 100% - Omni Medical Services FL
  'cannaflow.bsky.social',            // 100% - Cristina Dirlea
  'moremwallercpa.bsky.social',       // 100% - Morem & Waller CPAs
  'vapingpost.bsky.social',           // 100% - Vaping Post
  'ilovegrowing.bsky.social',         // 100% - ILoveGrowing
  'prohibitionblund2.bsky.social',    // 100% - Prohibition Blunder
  'mimjnews.bsky.social',             // 97% - Michigan Marijuana News
  'headynj.bsky.social',              // 97% - Heady NJ
  'montelwilliams.bsky.social',       // 93% - Montel Williams
  'sarapayan.bsky.social',            // 93% - Sara Payan
  'mmpconnect.bsky.social',           // 93% - Medical Marijuana Pages
  'cporthempreviews.bsky.social',     // 93% - C Port Hemp Reviews
  'canadacannabisnews.bsky.social',   // 93% - Canada Cannabis News
  'mpp.org',                          // 93% - Marijuana Policy Project
  'shaygilmorelaw.bsky.social',       // 93% - Shay Aaron Gilmore
  'lccscotland.bsky.social',          // 93% - Legalise Cannabis Scotland
  'johnschroyer.bsky.social',         // 93% - John Schroyer
  'cannabis-scientist.bsky.social',   // 90% - Andrew Waye, PhD
  'drcaplan.bsky.social',             // 90% - drcaplan
  'plantedwithsara.bsky.social',      // 90% - Planted with Sara Payan
  'theamazingflower.com',             // 87% - theamazingflower.com
  'canorml.bsky.social',              // 87% - California NORML
  'usaweed.bsky.social',              // 87% - USAWeed
  'researcherog.bsky.social',         // 87% - Mike Robinson
  'grinspoon.bsky.social',            // 87% - Dr. Peter Grinspoon
  'cannaoperators.bsky.social',       // 87% - CA Cannabis Operators
  'cporttestpanel2.bsky.social',      // 87% - C Port Hemp Reviews Test Panel
  'cannabistech.com',                 // 86% - Cannabis Tech
  'lucagoth666.bsky.social',          // 86% - luca
  'cacannabisdept.bsky.social',       // 83% - CA Dept of Cannabis Control
  'invest420.bsky.social',            // 83% - invest420
  'buddeezcannahaus.bsky.social',     // 83% - buddeezcannahaus
  'cannakeys.bsky.social',            // 83% - CannaKeys
  'cannabislover.bsky.social',        // 83% - Cannabis Lover
  'oaksterdam.bsky.social',           // 82% - Oaksterdam University
  'byken.bsky.social',                // 82% - Chef420
  'reeferrising.bsky.social',         // 81% - Reefer Rising
  'cscnbg.bsky.social',               // 80% - CSC Nürnberg
  'sugarleaffarm.com',                // 80% - Sugar Leaf Farm
  'trichometraders.com',              // 80% - Trichome Traders
  'leung-lab.bsky.social',            // 80% - Maxwell C. K. Leung, PhD
  '420farming.bsky.social',           // 80% - 420 Farming
  'crstn420.bsky.social',             // 77% - crstn
  'jberke.bsky.social',               // 77% - Jeremy Berke
  'realjohnnygreen.bsky.social',      // 77% - Johnny Green
  '6diphra.bsky.social',              // 77% - PhraSeiDi
  'njcannabistimes.com',              // 75% - NJ Cannabis Times
  'effecthemp.bsky.social',           // 75% - effectHEMP
  'weednews.bsky.social',             // 74% - Weed News
  'bud.weedstar.social',              // 73% - Bud Weedstar
  'tcdr8.bsky.social',                // 73% - TCDR
  'normlfr.bsky.social',              // 71% - NORML France
  'sdurrett70.bsky.social',           // 71% - sdurrett70
  'lehighvalleynorml.bsky.social',    // 70% - Lehigh Valley NORML
  'peter-reynolds.bsky.social',       // 70% - Peter Reynolds
  'csckarlsruhe.bsky.social',         // 68% - CSC Karlsruhe
  'cannabisembassy.bsky.social',      // 67% - Cannabis Embassy
  'miyabeshields.bsky.social',        // 65% - Dr. Miyabe Shields, PhD
  'wynorml.bsky.social',              // 65% - Wyoming NORML
  'dannydanko.bsky.social',           // 64% - Danny Danko
  'chrisgoldstein.bsky.social',       // 63% - Chris Goldstein
  'mybpg.bsky.social',                // 63% - Berkeley Patients Group
  'hanfverband.de',                   // 63% - Deutscher Hanfverband
  'hopelesslyhype.bsky.social',       // 63% - Fallon F
  'fionapatten.bsky.social',          // 63% - Fiona Patten
  'rosenblumen0.bsky.social',         // 63% - Katja R
  'nycannabistimes.com',              // 60% - NY Cannabis Times
  'ncbudget.bsky.social',             // 60% - NC Budget & Tax Center
  'researchmj.bsky.social',           // 60% - Research Society on Marijuana
  'blumenfreund.bsky.social',         // 60% - Florian der Blumenfreund
  'donjuanmatus.bsky.social',         // 58% - Don Juan Matus
  'sweetgrasscann.bsky.social',       // 57% - Sweetgrass Cannabis
  'yourcanna-club.bsky.social',       // 57% - YourCannaClub420
  'lcqparty.bsky.social',             // 57% - LCQ Party
  'ewicker.bsky.social',              // 57% - Edward
  'dpaulstanford.bsky.social',        // 56% - D. Paul Stanford
  'highteregedanken.bsky.social',     // 53% - Hightere Gedanken
  'tomblickman.bsky.social',          // 53% - Tom Blickman
  'jagdavies.bsky.social',            // 52% - Jag Davies
  'teluobir.bsky.social',             // 52% - Kenzi Riboulet-Zemouli
  'pincannabis.bsky.social',          // 50% - pincannabis
  'amandareiman.bsky.social',         // 50% - Amanda knows weed stuff
  'bfw.bsky.social',                  // 50% - Dr Brian Walker MLC
  'michaelhadrons.bsky.social',       // 50% - Michael Hadrons
  'neuro-linguistic.bsky.social',     // 50% - Neuro
  'sunsetcannafarm.bsky.social',      // 50% - LOTWSunsetCannaFarm
  'flowersbyfidel.bsky.social',       // 50% - Fidels
  
  // === 🟡 MEDIUM CONFIDENCE (20-49% cannabis posts) ===
  'breedersteve.bsky.social',         // 47% - Breeder Steve
  'nhcannapatient.bsky.social',       // 47% - nhcannapatient
  'finesandfeesjc.bsky.social',       // 47% - Fines and Fees Justice Center
  'ngaio420.bsky.social',             // 43% - Ngaio Bealum
  'atn420.bsky.social',               // 43% - Etienne Fontan
  'whoa-magic.lol',                   // 43% - Áine
  'tedsmithvcbc.bsky.social',         // 43% - Ted Smith
  'cashdcannabis.bsky.social',        // 42% - Cash'd Cannabis
  'cantrip.bsky.social',              // 41% - Weed Drinks Guy
  'marijuana.com.au',                 // 40% - Marijuana.com.au
  'filtermag.bsky.social',            // 37% - Filter Magazine
  'samreisman.bsky.social',           // 37% - Sam Reisman
  'legalcannabis.bsky.social',        // 34% - Legal Cannabis
  'cannabis.bsky.social',             // 33% - cannabis 101
  'ommpeddie.bsky.social',            // 33% - Oregon Medical Marijuana
  'weedmapsofficial.bsky.social',     // 33% - Weedmaps
  'larsmillermedia.bsky.social',      // 33% - Lars Miller
  'dieschlauemaus.bsky.social',       // 33% - DieSchlaueMaus
  'peterschmidt.bsky.social',         // 32% - peterschmidt
  'whatsmypot.com',                   // 30% - WhatsMyPot
  'weedmama.bsky.social',             // 30% - Weed Mama
  'bettyondrugs.bsky.social',         // 30% - Betty Aldworth
  'coralreefer420.bsky.social',       // 30% - Coral Kamstra-Brown
  'cannabislounge.cafe',              // 29% - Cannabis Lounge
  'kirstenkappert.bsky.social',       // 29% - Kirsten Kappert-Gonther
  'norcalwomenincanna.bsky.social',   // 29% - NorCal Women in Cannabis
  'aimz.bsky.social',                 // 29% - Green Thread Productions
  'adirondack.green',                 // 29% - Adirondack Green
  'shermanmicah.bsky.social',         // 28% - Micah Sherman
  'kristinaetter.bsky.social',        // 28% - Kristina Etter
  'leddder.bsky.social',              // 27% - Lester Black
  'drugpolicy.org',                   // 27% - Drug Policy Alliance
  'mollyweed.bsky.social',            // 27% - Mollyweed
  'ohioladycannabis.bsky.social',     // 27% - OhioLadyCannabis
  'coolnerdweedshow.bsky.social',     // 27% - Cool Nerd Weed Show
  'tc3consortium.bsky.social',        // 27% - Toronto Cannabis Research
  'vanessamarigold.bsky.social',      // 27% - Vanessa Dora Lavorato
  'llblue.bsky.social',               // 27% - Dr Len Blue
  'doccannabico.com',                 // 27% - Ricardo Urbina
  'kathryn68.bsky.social',            // 27% - Kathryn
  'julianbuchanan.bsky.social',       // 27% - Julian Buchanan, PhD
  'lumen.bsky.social',                // 25% - Lumen
  'rollingphatuk.bsky.social',        // 25% - RollingPhatUk
  'leafdebrief.com',                  // 25% - LEAF DEBRIEF
  'dborchardt.bsky.social',           // 23% - Debra Borchardt
  'cannabis-eos.bsky.social',         // 23% - Cannabis
  'elusivebobcat.bsky.social',        // 23% - Not an actual bobcat
  'hanfdampf.hdiag.de',               // 23% - Hanfdampf
  'tauhid.bsky.social',               // 23% - Tauhid Chappell
  'csc-krefeld.bsky.social',          // 23% - CSC Krefeld
  'homegrowpro.bsky.social',          // 23% - Homegrow Pro
  'julesnetherland.bsky.social',      // 23% - Jules Netherland
  'steverolles.bsky.social',          // 21% - SteveRolles
  'haucap.bsky.social',               // 21% - Justus Haucap
  'highgroundberlin.bsky.social',     // 21% - CSC High Ground Berlin
  'cannabis-lounges.bsky.social',     // 20% - Cannabis Lounges
  'marijuanamasao.bsky.social',       // 20% - Marijuana Masao
  'prancingponyflower.bsky.social',   // 20% - Prancing Pony Flowers
  'mrgreengenes420.bsky.social',      // 20% - Giligadi
  'growinghome420.bsky.social',       // 20% - Jaimie Miller-Haywood
  'vetsactioncouncil.bsky.social',    // 20% - Veterans Action Council
  'holler1012.bsky.social',           // 20% - Brian Holler
  'igloochik.bsky.social',            // 20% - Kelly Sutton
  'nigeldeez.bsky.social',            // 20% - Nigel
  
  // === 🟠 BORDERLINE (10-19% cannabis posts) ===
  'bigbadbri.bsky.social',            // 18% - Brian D
  'danalarsen.bsky.social',           // 17% - Dana Larsen
  'niamhrelease.bsky.social',         // 17% - Niamh Eastwood
  'maune.bsky.social',                // 17% - Maune
  'phishphillet.bsky.social',         // 17% - Phestive Phish
  'hrca.bsky.social',                 // 17% - Harm Reduction Coalition
  'phscss.bsky.social',               // 17% - PHS Community Services
  'momsforallpaths.bsky.social',      // 17% - Kathleen Cochran
  'shaleen.bsky.social',              // 14% - Shaleen Title
  'mrbill420.bsky.social',            // 14% - Mr Bill
  'meganpru.bsky.social',             // 14% - Megan Pru
  'natsfert.bsky.social',             // 13% - Natalie Fertig (POLITICO)
  'kenmoore.bsky.social',             // 13% - Ken Moore
  'trianglekushseeds.com',            // 13% - Triangle Kush Seeds
  'klassickristin.bsky.social',       // 13% - Kristin Souza
  'mapsorg.bsky.social',              // 13% - MAPS
  'jackie-jackpot.bsky.social',       // 13% - Jackie Jackpot
  'melorello.bsky.social',            // 13% - melorello
  'jogomoin.bsky.social',             // 13% - jogo
  'repconklin.bsky.social',           // 13% - Rep. Scott Conklin
  'blick847.bsky.social',             // 13% - Blick
  'gaygardens.bsky.social',           // 13% - gaygardens
  'myharmreduction.bsky.social',      // 13% - Sheila Vakharia PhD MSW
  'joncappetta.bsky.social',          // 13% - jon cappetta (High Times)
  'sinsemillajones.bsky.social',      // 13% - Sinsemilla Jones
  'hightweeds.bsky.social',           // 12% - HighTweeds
  'actualrhetorical.bsky.social',     // 12% - Chris Conrad
  'joeadair.bsky.social',             // 11% - Joe Adair
  'ricksteves.bsky.social',           // 10% - Rick Steves
  'boxbrown.bsky.social',             // 10% - Brian Box Brown
  'wizkaliko.bsky.social',            // 10% - Kaliko Castille
  'tallirishone.bsky.social',         // 10% - TallIrishOne
  'nacosis.bsky.social',              // 10% - nacosis
  'jjfox.bsky.social',                // 10% - Mile High Fennec
  'psyconicgardener.bsky.social',     // 10% - Psyconic
  'pspete.bsky.social',               // 10% - PSP_Pete
  'heatherkhilton.bsky.social',       // 10% - Heather Hilton
  'rossbyjove.bsky.social',           // 10% - ross thomas
  'alexwodak.bsky.social',            // 10% - Dr Alex Wodak AM
];

// Initialize SQLite database
const db = new Database('/root/cannect-feed/feed.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    uri TEXT PRIMARY KEY,
    cid TEXT,
    author_did TEXT,
    author_handle TEXT,
    author_name TEXT,
    author_avatar TEXT,
    text TEXT,
    has_media INTEGER DEFAULT 0,
    media_json TEXT,
    reply_to TEXT,
    embed_json TEXT,
    like_count INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    created_at TEXT,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    feed_type TEXT DEFAULT 'local'
  );
  
  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_did);
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_feed_type ON posts(feed_type);
  CREATE INDEX IF NOT EXISTS idx_posts_media ON posts(has_media) WHERE has_media = 1;
`);

// Middleware
app.use(cors());
app.use(express.json());

// State
let cannectDids = new Set();
let jetstreamWs = null;
let isConnected = false;
let stats = {
  eventsReceived: 0,
  postsProcessed: 0,
  lastEventTime: null,
  startedAt: new Date().toISOString(),
};

// === HELPER FUNCTIONS ===

async function fetchCannectUsers() {
  try {
    const response = await fetch(`${CANNECT_PDS}/xrpc/com.atproto.sync.listRepos?limit=100`);
    if (!response.ok) throw new Error(`PDS error: ${response.status}`);
    const data = await response.json();
    cannectDids = new Set(data.repos?.map(r => r.did) || []);
    console.log(`[Feed] Loaded ${cannectDids.size} Cannect users from PDS`);
    return cannectDids;
  } catch (error) {
    console.error('[Feed] Error fetching Cannect users:', error.message);
    return cannectDids;
  }
}

async function fetchAuthorFeed(did, limit = 30) {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=${limit}`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.feed || [];
  } catch (error) {
    console.error(`[Feed] Error fetching feed for ${did}:`, error.message);
    return [];
  }
}

async function fetchExternalFeed(feedUri, limit = 30) {
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${limit}`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.feed || [];
  } catch (error) {
    console.error(`[Feed] Error fetching external feed:`, error.message);
    return [];
  }
}

function savePost(post, feedType = 'local') {
  try {
    const hasMedia = post.embed?.images?.length > 0 || 
                     post.embed?.media?.images?.length > 0 ||
                     post.embed?.video != null;
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO posts 
      (uri, cid, author_did, author_handle, author_name, author_avatar, 
       text, has_media, media_json, reply_to, embed_json, 
       like_count, repost_count, reply_count, created_at, feed_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      post.uri,
      post.cid,
      post.author?.did,
      post.author?.handle,
      post.author?.displayName || '',
      post.author?.avatar || '',
      post.record?.text || '',
      hasMedia ? 1 : 0,
      hasMedia ? JSON.stringify(post.embed) : null,
      post.record?.reply?.parent?.uri || null,
      post.embed ? JSON.stringify(post.embed) : null,
      post.likeCount || 0,
      post.repostCount || 0,
      post.replyCount || 0,
      post.record?.createdAt || post.indexedAt,
      feedType
    );
    return true;
  } catch (error) {
    console.error('[Feed] Error saving post:', error.message);
    return false;
  }
}

async function refreshLocalFeed() {
  console.log('[Feed] Refreshing local feed from Cannect users...');
  const dids = Array.from(cannectDids);
  let totalPosts = 0;
  
  for (const did of dids) {
    const feed = await fetchAuthorFeed(did, 20);
    for (const item of feed) {
      if (item.post && savePost(item.post, 'local')) {
        totalPosts++;
      }
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`[Feed] Refreshed local feed: ${totalPosts} posts from ${dids.length} users`);
  return totalPosts;
}

async function refreshGlobalFeed() {
  console.log('[Feed] Refreshing global cannabis feeds from curated accounts...');
  let totalPosts = 0;
  
  for (const handle of CANNABIS_ACCOUNTS) {
    const feed = await fetchAuthorFeed(handle, 20);
    for (const item of feed) {
      if (item.post) {
        // Skip posts from Cannect users (they're already in local feed)
        if (cannectDids.has(item.post.author?.did)) continue;
        
        if (savePost(item.post, 'global')) {
          totalPosts++;
        }
      }
    }
    // Small delay between fetches
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`[Feed] Refreshed global feed: ${totalPosts} posts from ${CANNABIS_ACCOUNTS.length} accounts`);
  return totalPosts;
}

// === JETSTREAM CONNECTION ===

function connectJetstream() {
  if (cannectDids.size === 0) {
    console.log('[Jetstream] No Cannect users to track, skipping connection');
    return;
  }
  
  const didsArray = Array.from(cannectDids).slice(0, 100);
  const params = new URLSearchParams();
  params.set('wantedCollections', 'app.bsky.feed.post');
  didsArray.forEach(did => params.append('wantedDids', did));
  
  const url = `${JETSTREAM_URL}?${params.toString()}`;
  console.log(`[Jetstream] Connecting with ${didsArray.length} DIDs...`);
  
  jetstreamWs = new WebSocket(url);
  
  jetstreamWs.on('open', () => {
    console.log('[Jetstream] Connected!');
    isConnected = true;
  });
  
  jetstreamWs.on('message', async (data) => {
    try {
      const event = JSON.parse(data.toString());
      stats.eventsReceived++;
      stats.lastEventTime = new Date().toISOString();
      
      if (event.kind === 'commit' && event.commit?.collection === 'app.bsky.feed.post') {
        if (event.commit.operation === 'create') {
          await handleNewPost(event);
        } else if (event.commit.operation === 'delete') {
          handleDeletePost(event);
        }
      }
    } catch (error) {
      console.error('[Jetstream] Error processing message:', error.message);
    }
  });
  
  jetstreamWs.on('close', (code, reason) => {
    console.log(`[Jetstream] Disconnected: ${code} ${reason}`);
    isConnected = false;
    // Reconnect after 5 seconds
    setTimeout(connectJetstream, 5000);
  });
  
  jetstreamWs.on('error', (error) => {
    console.error('[Jetstream] Error:', error.message);
  });
}

async function handleNewPost(event) {
  const { did, commit } = event;
  const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
  
  // Fetch full post data from API
  try {
    const response = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`
    );
    if (response.ok) {
      const data = await response.json();
      if (data.posts?.[0]) {
        savePost(data.posts[0], 'local');
        stats.postsProcessed++;
        console.log(`[Jetstream] Saved new post from ${did}`);
      }
    }
  } catch (error) {
    // Save minimal post from event data
    const minimalPost = {
      uri,
      cid: commit.cid,
      author: { did },
      record: commit.record,
      indexedAt: new Date().toISOString(),
    };
    savePost(minimalPost, 'local');
    stats.postsProcessed++;
  }
}

function handleDeletePost(event) {
  const { did, commit } = event;
  const uri = `at://${did}/${commit.collection}/${commit.rkey}`;
  
  try {
    db.prepare('DELETE FROM posts WHERE uri = ?').run(uri);
    console.log(`[Jetstream] Deleted post: ${uri}`);
  } catch (error) {
    console.error('[Jetstream] Error deleting post:', error.message);
  }
}

// === API ENDPOINTS ===

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cannect-feed',
    timestamp: new Date().toISOString(),
    jetstream: isConnected ? 'connected' : 'disconnected',
  });
});

// Stats
app.get('/stats', (req, res) => {
  const localCount = db.prepare("SELECT COUNT(*) as count FROM posts WHERE feed_type = 'local'").get();
  const globalCount = db.prepare("SELECT COUNT(*) as count FROM posts WHERE feed_type = 'global'").get();
  
  res.json({
    ...stats,
    jetstreamConnected: isConnected,
    cannectUsersTracked: cannectDids.size,
    postsInDb: {
      local: localCount.count,
      global: globalCount.count,
    },
  });
});

// Local Feed (Cannect users)
app.get('/feed/local', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const cursor = req.query.cursor;
  
  let query = `
    SELECT * FROM posts 
    WHERE feed_type = 'local'
    ${cursor ? 'AND created_at < ?' : ''}
    ORDER BY created_at DESC 
    LIMIT ?
  `;
  
  const params = cursor ? [cursor, limit + 1] : [limit + 1];
  const posts = db.prepare(query).all(...params);
  
  const hasMore = posts.length > limit;
  const resultPosts = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? resultPosts[resultPosts.length - 1].created_at : null;
  
  // Format posts for client
  const formattedPosts = resultPosts.map(p => ({
    uri: p.uri,
    cid: p.cid,
    author: {
      did: p.author_did,
      handle: p.author_handle,
      displayName: p.author_name,
      avatar: p.author_avatar,
    },
    record: {
      text: p.text,
      createdAt: p.created_at,
    },
    embed: p.embed_json ? JSON.parse(p.embed_json) : undefined,
    likeCount: p.like_count,
    repostCount: p.repost_count,
    replyCount: p.reply_count,
    indexedAt: p.indexed_at,
  }));
  
  res.json({
    posts: formattedPosts,
    cursor: nextCursor,
  });
});

// Global Feed (Cannabis community)
app.get('/feed/global', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const cursor = req.query.cursor;
  
  let query = `
    SELECT * FROM posts 
    WHERE feed_type = 'global'
    ${cursor ? 'AND created_at < ?' : ''}
    ORDER BY created_at DESC 
    LIMIT ?
  `;
  
  const params = cursor ? [cursor, limit + 1] : [limit + 1];
  const posts = db.prepare(query).all(...params);
  
  const hasMore = posts.length > limit;
  const resultPosts = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? resultPosts[resultPosts.length - 1].created_at : null;
  
  const formattedPosts = resultPosts.map(p => ({
    uri: p.uri,
    cid: p.cid,
    author: {
      did: p.author_did,
      handle: p.author_handle,
      displayName: p.author_name,
      avatar: p.author_avatar,
    },
    record: {
      text: p.text,
      createdAt: p.created_at,
    },
    embed: p.embed_json ? JSON.parse(p.embed_json) : undefined,
    likeCount: p.like_count,
    repostCount: p.repost_count,
    replyCount: p.reply_count,
    indexedAt: p.indexed_at,
  }));
  
  res.json({
    posts: formattedPosts,
    cursor: nextCursor,
  });
});

// Force refresh endpoints
app.post('/feed/refresh/local', async (req, res) => {
  const count = await refreshLocalFeed();
  res.json({ status: 'ok', postsRefreshed: count });
});

app.post('/feed/refresh/global', async (req, res) => {
  const count = await refreshGlobalFeed();
  res.json({ status: 'ok', postsRefreshed: count });
});

// === STARTUP ===

async function start() {
  console.log('[Feed] Starting Cannect Feed Service...');
  
  // Load Cannect users
  await fetchCannectUsers();
  
  // Initial feed load
  await refreshLocalFeed();
  await refreshGlobalFeed();
  
  // Connect to Jetstream for real-time updates
  connectJetstream();
  
  // Periodic refresh (every 5 minutes for global, every 2 minutes for local)
  setInterval(refreshGlobalFeed, 5 * 60 * 1000);
  setInterval(refreshLocalFeed, 2 * 60 * 1000);
  setInterval(fetchCannectUsers, 10 * 60 * 1000); // Refresh user list every 10 min
  
  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Feed] Server running on port ${PORT}`);
  });
}

start().catch(console.error);
