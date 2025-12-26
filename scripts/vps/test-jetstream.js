const WebSocket = require('ws');

// Try different endpoints
const endpoints = [
  'wss://jetstream1.us-east.bsky.network/subscribe',
  'wss://jetstream2.us-west.bsky.network/subscribe',
  'wss://jetstream1.us-west.bsky.network/subscribe'
];

async function tryConnect(url) {
  return new Promise((resolve) => {
    console.log('Trying:', url);
    const ws = new WebSocket(url, { handshakeTimeout: 10000 });
    
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 8000);
    
    ws.on('open', () => { 
      clearTimeout(timeout);
      console.log('SUCCESS:', url);
      ws.close();
      resolve(true);
    });
    ws.on('error', (e) => { 
      clearTimeout(timeout);
      console.log('Error:', e.message);
      resolve(false);
    });
  });
}

async function main() {
  for (const url of endpoints) {
    const ok = await tryConnect(url);
    if (ok) {
      console.log('Working endpoint found!');
      process.exit(0);
    }
  }
  console.log('No working endpoints');
  process.exit(1);
}

main();
