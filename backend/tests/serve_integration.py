"""Test-only HTTP servers. Mock inference, real FastAPI/PDF/sklearn operations.

Invoked by frontend/tests/integration.test.mjs; never used by production routes.
"""
import base64
import json
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pymupdf
import uvicorn

from main import create_app
from ollama_client import OllamaClient, OllamaSettings

QUESTIONS = [
    ("What does term frequency measure within a passage?", ["The count of a term", "Its page number", "The student's score", "The PDF size"], "TF-IDF", "Term frequency counts occurrences within a passage."),
    ("Why does inverse document frequency reduce the influence of common terms?", ["They distinguish passages less well", "They are always incorrect", "They require OCR", "They increase page counts"], "TF-IDF", "IDF downweights terms shared by many passages."),
    ("How should a retrieval query use the passage vocabulary?", ["Transform with the fitted vocabulary", "Fit an unrelated vocabulary", "Use the student's grade", "Delete all source metadata"], "Vectorization", "Queries are transformed with the fitted passage vocabulary."),
    ("What is cosine similarity for orthogonal nonzero vectors?", ["Zero", "One", "Negative ten", "A student confidence percentage"], "Cosine similarity", "Orthogonal vectors have a zero dot product and zero cosine similarity."),
    ("What does a high TF-IDF retrieval score indicate?", ["Greater lexical overlap", "A definite diagnosis", "Guaranteed factual accuracy", "A permanently saved PDF"], "Retrieval limitations", "Lexical relevance is not a probability of correctness."),
]


class MockOllama(BaseHTTPRequestHandler):
    chats = 0

    def log_message(self, *args):
        pass

    def reply(self, body):
        encoded = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path != "/api/tags":
            self.send_error(404)
            return
        self.reply({"models": [{"name": "test-model:latest"}]})

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404)
            return
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert payload["model"] == "test-model:latest"
        assert isinstance(payload["format"], dict)
        assert payload["stream"] is False
        assert [message["role"] for message in payload["messages"]] == ["system", "user"]
        evidence = json.loads(payload["messages"][1]["content"])
        passages = evidence["source_passages"]
        assert passages and all(passage["score"] > 0 for passage in passages)
        assert "DEMO" in "".join(passage["text"] for passage in passages) or any(
            "frequency" in passage["text"].lower() or "cosine" in passage["text"].lower()
            or "retrieval" in passage["text"].lower() for passage in passages
        )
        source = [passages[0]["chunk_id"]]
        if "requested_count" in evidence:
            content = {"questions": [
                {"question": question, "options": options, "correct_index": 0,
                 "topic": topic, "explanation": explanation, "source_chunk_ids": source}
                for question, options, topic, explanation in QUESTIONS[:evidence["requested_count"]]
            ]}
        else:
            assert evidence["student_explanation"]
            assert evidence["correct_answer"]
            content = {
                "reasoning_assessment": "partially_supported",
                "explanation": "TEST MOCK: compare the explanation with the retrieved definitions.",
                "possible_knowledge_gap": "TEST MOCK: review the distinction between term frequency and IDF.",
                "recommended_topic_to_review": "term frequency inverse document frequency",
                "source_chunk_ids": source,
            }
        MockOllama.chats += 1
        self.reply({"done": True, "message": {"content": json.dumps(content)}})


def main():
    mock = ThreadingHTTPServer(("127.0.0.1", 0), MockOllama)
    mock_thread = threading.Thread(target=mock.serve_forever, daemon=True)
    mock_thread.start()
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    client = OllamaClient(OllamaSettings(
        base_url=f"http://127.0.0.1:{mock.server_port}", model="test-model:latest", timeout_seconds=5))
    app = create_app(ollama=client)
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    try:
        for _ in range(200):
            if server.started:
                break
            time.sleep(0.025)
        if not server.started:
            raise RuntimeError("Integration backend did not start")
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((72, 72), "DEMO PDF: Term frequency counts terms. IDF downweights common terms.")
            pdf.new_page().insert_text((72, 72), "Cosine similarity ranks retrieval vectors. Orthogonal vectors have score zero.")
            fixture = base64.b64encode(pdf.tobytes()).decode()
        print(json.dumps({"base": f"http://127.0.0.1:{sock.getsockname()[1]}", "pdf": fixture}), flush=True)
        sys.stdin.readline()
        if MockOllama.chats != 5:
            raise RuntimeError(f"Expected generation + four feedback calls, received {MockOllama.chats}")
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        mock.shutdown()
        mock.server_close()


if __name__ == "__main__":
    main()
