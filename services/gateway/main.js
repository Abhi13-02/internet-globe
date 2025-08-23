require('dotenv').config();

const express = require('express');
const WebSocket = require('ws');
const { createClient } = require('redis');
const cors = require('cors');

const app = express();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
const STREAM = process.env.STREAM || 'bgp.raw';
const GROUP = process.env.GROUP || 'bgp:ws';
const CONSUMER_ID = process.env.CONSUMER_ID || 'gateway-1';
const WS_BATCH_MS = parseInt(process.env.WS_BATCH_MS || '1000');
const READ_COUNT = parseInt(process.env.READ_COUNT || '200');
const BLOCK_MS = parseInt(process.env.BLOCK_MS || '500');
const PORT = parseInt(process.env.PORT || '8000');

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// CORS middleware
app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN,
  credentials: true
}));

// Redis client
const redis = createClient({ url: REDIS_URL });
const clients = new Set();

// Health check endpoint
app.get('/healthz', async (req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

// Ensure Redis stream group exists
async function ensureGroup() {
  try {
    await redis.xGroupCreate(STREAM, GROUP, '$', { MKSTREAM: true });
  } catch (error) {
    // BUSYGROUP means it already exists
    if (!error.message.includes('BUSYGROUP')) {
      throw error;
    }
  }
}

// Real-time processor - sends messages immediately, no batching
async function realtimeProcessor() {
  while (true) {
    try {
      const response = await redis.xReadGroup(
        GROUP,
        CONSUMER_ID,
        { key: STREAM, id: '>' },
        { COUNT: 1, BLOCK: BLOCK_MS } // Read one message at a time
      );

      if (!response || response.length === 0) {
        continue;
      }

      for (const stream of response) {
        for (const message of stream.messages) {
          let data = null;
          try {
            data = JSON.parse(message.message.data || '{}');
          } catch (error) {
            console.error('parse error:', error);
          }

          // Send immediately if we have data and clients
          if (data && clients.size > 0) {
            const payload = JSON.stringify({ type: 'bgp', items: [data] });
            const deadClients = [];

            for (const ws of clients) {
              try {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(payload);
                } else {
                  deadClients.push(ws);
                }
              } catch (error) {
                deadClients.push(ws);
              }
            }

            // Remove dead clients
            for (const ws of deadClients) {
              clients.delete(ws);
            }
          }

          // Ack the message
          try {
            await redis.xAck(STREAM, GROUP, [message.id]);
          } catch (error) {
            console.error('xack error:', error);
          }
        }
      }
    } catch (error) {
      console.error('realtime processor error:', error);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// Initialize and start services
async function startup() {
  await redis.connect();
  await ensureGroup();
  
  // Start real-time processor
  realtimeProcessor();
}

// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`Gateway server listening on port ${PORT}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws/live' });

wss.on('connection', (ws) => {
  clients.add(ws);
  
  // Send keepalive pings
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('{"type":"ping"}');
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('close', () => {
    clients.delete(ws);
    clearInterval(pingInterval);
  });

  ws.on('error', () => {
    clients.delete(ws);
    clearInterval(pingInterval);
  });
});

// Start the application
startup().catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await redis.disconnect();
  process.exit(0);
});