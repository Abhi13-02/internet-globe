import asyncio, json, os, time, random
import redis.asyncio as redis

r = redis.from_url(os.getenv("REDIS_URL","redis://redis:6379/0"), decode_responses=True)

async def run():
    i=0
    while True:
        evt={"type":"tls","domain":f"ex{i}.com","ip":"1.1.1.1",
             "lat": random.uniform(-60,60), "lng": random.uniform(-180,180),
             "ts": int(time.time())}
        await r.publish("events.tls", json.dumps(evt))
        i+=1
        await asyncio.sleep(1)

if __name__=="__main__":
    asyncio.run(run())
