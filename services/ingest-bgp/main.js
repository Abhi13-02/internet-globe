const { createClient } = require('redis');
const RipeClient = require('./ripe-client');

// Environment configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
const STREAM = process.env.STREAM || 'bgp.events';
const MAXLEN = parseInt(process.env.STREAM_MAXLEN || '50000');
const USE_MOCK_DATA = process.env.USE_MOCK_DATA === 'true';

async function main() {
  console.log('🚀 Starting BGP Ingest Service...');
  console.log(`📊 Stream: ${STREAM}`);
  console.log(`💾 Max events: ${MAXLEN}`);
  console.log(`🔄 Mode: ${USE_MOCK_DATA ? 'MOCK' : 'REAL'} data`);
  
  // Connect to Redis with retry logic
  const redis = createClient({ url: REDIS_URL });
  
  let retries = 10;
  while (retries > 0) {
    try {
      await redis.connect();
      console.log('✅ Connected to Redis');
      break;
    } catch (error) {
      console.log(`⏳ Redis not ready, retrying... (${retries} attempts left)`);
      retries--;
      if (retries === 0) {
        console.error('❌ Failed to connect to Redis after all retries:', error);
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  if (USE_MOCK_DATA) {
    console.log('🎭 Starting mock data generator for testing...');
    await runMockGenerator(redis);
  } else {
    console.log('🌐 Starting real RIPE RIS Live client...');
    await runRipeClient(redis);
  }
}

/**
 * Run the real RIPE RIS Live client
 */
async function runRipeClient(redis) {
  const ripeClient = new RipeClient(redis, STREAM, MAXLEN);
  
  // Start connection
  await ripeClient.connect();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down RIPE client...');
    ripeClient.close();
    await redis.quit();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down RIPE client...');
    ripeClient.close();
    await redis.quit();
    process.exit(0);
  });
  
  // Keep the process alive
  console.log('📡 RIPE client running... Press Ctrl+C to stop');
}

/**
 * Run the mock data generator (for testing/development)
 */
async function runMockGenerator(redis) {
  const ANNOUNCE_COLOR = '#3aa3ff';
  const WITHDRAW_COLOR = '#ff8a3a';

  const PEERS = [
    [52.37, 4.90],    // Amsterdam
    [51.50, -0.12],   // London
    [40.71, -74.01],  // New York
    [35.68, 139.76],  // Tokyo
    [1.29, 103.85]    // Singapore
  ];

  const ORIGINS = [
    [37.77, -122.42], // San Francisco
    [48.85, 2.35],    // Paris
    [13.08, 80.27],   // Chennai
    [28.61, 77.20],   // Delhi
    [19.08, 72.88]    // Mumbai
  ];

  function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  console.log('🎭 Mock BGP data generator started');

  while (true) {
    const ts = Date.now() / 1000;
    const [srcLat, srcLng] = randomChoice(PEERS);
    const [dstLat, dstLng] = randomChoice(ORIGINS);
    const event = Math.random() > 0.35 ? 'announce' : 'withdraw';
    const color = event === 'announce' ? ANNOUNCE_COLOR : WITHDRAW_COLOR;
    
    const asPathLength = randomInt(3, 6);
    const asPath = [];
    for (let i = 0; i < asPathLength; i++) {
      asPath.push(randomInt(10000, 65000));
    }
    
    const prefixLength = randomChoice([22, 23, 24]);
    const prefix = `${randomInt(1, 223)}.${randomInt(0, 255)}.${randomInt(0, 255)}.0/${prefixLength}`;
    
    const arc = {
      schema: 'bgp.arc.v0',
      ts: ts,
      event: event,
      prefix: prefix,
      origin_asn: asPath[asPath.length - 1],
      peer_asn: asPath[0],
      as_path: asPath,
      src: { lat: srcLat, lng: srcLng },
      dst: { lat: dstLat, lng: dstLng },
      color: color
    };

    try {
      await redis.xAdd(STREAM, '*', { data: JSON.stringify(arc) }, {
        MAXLEN: MAXLEN,
        APPROXIMATE: true
      });
    } catch (error) {
      console.error('Error adding to stream:', error);
    }

    await new Promise(resolve => setTimeout(resolve, 5)); // ~100 events/sec
  }
}

// Handle graceful shutdown for mock mode
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

main().catch(console.error);