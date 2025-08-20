const express = require('express');
const WebSocket = require('ws');
const { createClient } = require('redis');
const cors = require('cors');

const app = express();

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379/0';
const STREAM = process.env.STREAM || 'bgp.events';
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
let messageQueue = [];

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

// Reader function to read from Redis stream
async function reader() {
  while (true) {
    try {
      const response = await redis.xReadGroup(
        GROUP,
        CONSUMER_ID,
        { key: STREAM, id: '>' },
        { COUNT: READ_COUNT, BLOCK: BLOCK_MS }
      );

      if (!response || response.length === 0) {
        continue;
      }

      for (const stream of response) {
        for (const message of stream.messages) {
          try {
            const data = JSON.parse(message.message.data || '{}');
            messageQueue.push({ id: message.id, data });
          } catch (error) {
            messageQueue.push({ id: message.id, data: null });
          }
        }
      }
    } catch (error) {
      console.error('reader error:', error);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// Batcher function to send batched messages to WebSocket clients
async function batcher() {
  while (true) {
    await new Promise(resolve => setTimeout(resolve, WS_BATCH_MS));
    
    const toAck = [];
    const batch = [];

    // Drain the queue
    while (messageQueue.length > 0) {
      const { id, data } = messageQueue.shift();
      toAck.push(id);
      if (data) {
        batch.push(data);
      }
    }

    if (batch.length === 0 || clients.size === 0) {
      // Still ack to move group cursor forward
      if (toAck.length > 0) {
        try {
          await redis.xAck(STREAM, GROUP, toAck);
        } catch (error) {
          console.error('xack error:', error);
        }
      }
      continue;
    }

    const payload = JSON.stringify({ type: 'bgp', items: batch });
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

    // Ack after successful broadcast
    try {
      await redis.xAck(STREAM, GROUP, toAck);
    } catch (error) {
      console.error('xack error:', error);
    }
  }
}

// Initialize and start services
async function startup() {
  await redis.connect();
  await ensureGroup();
  
  // Start background tasks
  reader();
  batcher();
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