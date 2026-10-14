"""Real HTTP multipart upload/retrieval smoke check on an ephemeral local port."""
import json
import threading
import time
import unittest
from urllib.request import Request, urlopen

import uvicorn

from main import app
from test_pipeline import sample_pdf


class HttpSmokeTests(unittest.TestCase):
    def test_real_http_pdf_retrieval(self):
        # Let the OS choose a free port; Uvicorn owns this temporary socket.
        import socket
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
        thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.05)
            base = f"http://127.0.0.1:{port}"
            body = (b'--studyai\r\nContent-Disposition: form-data; name="pdf"; filename="lecture.pdf"\r\n'
                    b'Content-Type: application/pdf\r\n\r\n' + sample_pdf() + b'\r\n--studyai--\r\n')
            with urlopen(Request(base + "/sessions", data=body, headers={"Content-Type": "multipart/form-data; boundary=studyai", "Origin": "http://localhost:5173"}), timeout=10) as response:
                self.assertEqual(response.status, 201)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:5173")
                session_id = json.load(response)["session_id"]
            with urlopen(Request(base + f"/sessions/{session_id}/retrieve", data=json.dumps({"query": "mitochondria ATP"}).encode(), headers={"Content-Type": "application/json"}), timeout=10) as response:
                passages = json.load(response)["passages"]
                self.assertEqual(passages[0]["page_number"], 1)
                self.assertGreater(passages[0]["score"], 0)
            with urlopen(Request(base + f"/sessions/{session_id}", method="DELETE"), timeout=10) as response:
                self.assertEqual(response.status, 204)
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            sock.close()


if __name__ == "__main__":
    unittest.main()
