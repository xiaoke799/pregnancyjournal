import os, sys, subprocess, time
os.environ["DATABASE_PATH"] = "test_retest4.db"
os.environ["PHOTOS_DIR"] = "./test_photos4"
os.environ["THUMBNAILS_DIR"] = "./test_thumbnails4"
os.environ["BACKUPS_DIR"] = "./test_backups4"
os.environ["DATA_DIR"] = "./backend/data"
os.environ["APP_MODE"] = "dev"

# First test: can we import?
print("STEP1: Testing import...")
from backend.main import app
print("STEP1: PASS - Import OK")

# Test: can we run the lifespan?
print("STEP2: Testing lifespan...")
import asyncio
from backend.database import init_db, close_db
asyncio.run(init_db())
print("STEP2: PASS - DB init OK")
asyncio.run(close_db())
print("STEP3: PASS - DB close OK")

# Now start server
print("STEP4: Starting uvicorn on 9876...")
import uvicorn
uvicorn.run(app, host="127.0.0.1", port=9876, log_level="info")
