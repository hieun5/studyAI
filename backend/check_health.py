"""Run after installing requirements: python check_health.py."""
import json
import threading
from urllib.request import Request, urlopen

import uvicorn
from main import app

server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8001, log_level="error"))
thread = threading.Thread(target=server.run, daemon=True)
thread.start()
try:
    import time
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    with urlopen(Request("http://127.0.0.1:8001/health", headers={"Origin": "http://localhost:5173"}), timeout=5) as response:
        assert response.status == 200
        assert json.load(response) == {"status": "ok", "service": "studyAI", "stage": "5"}
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    with urlopen(Request("http://127.0.0.1:8001/health", headers={"Origin": "https://example.com"}), timeout=5) as response:
        assert response.headers.get("Access-Control-Allow-Origin") is None
    print("PASS: health endpoint and local-only CORS")
finally:
    server.should_exit = True
    thread.join(timeout=5)
