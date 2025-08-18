import os, json, asyncio
from typing import Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import redis.asyncio as redis

app = FastAPI()
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
WS_BATCH_MS = int(os.getenv("WS_BATCH_MS", "1000"))

r = redis.from_url(REDIS_URL, decode_responses=True)
clients: Set[WebSocket] = set()
queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1000)

@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.on_event("startup")
async def startup():
    async def sub_task():
        ps = r.pubsub()
        await ps.subscribe("events.tls")
        async for msg in ps.listen():
            if msg.get("type") == "message":
                await queue.put(msg["data"])

    async def batch_task():
        while True:
            await asyncio.sleep(WS_BATCH_MS/1000)
            batch = []
            try:
                while True:
                    batch.append(json.loads(queue.get_nowait()))
            except asyncio.QueueEmpty:
                pass
            if not batch or not clients:
                continue
            payload = json.dumps({"type":"tls","items":batch})
            dead=[]
            for ws in clients:
                try:
                    await ws.send_text(payload)
                except:
                    dead.append(ws)
            for ws in dead:
                clients.discard(ws)

    asyncio.create_task(sub_task())
    asyncio.create_task(batch_task())

@app.websocket("/ws/live")
async def live(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive (ignored)
    except WebSocketDisconnect:
        clients.discard(ws)
