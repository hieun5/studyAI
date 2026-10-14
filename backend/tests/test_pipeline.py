import asyncio
import unittest
from dataclasses import replace

import numpy as np
import pymupdf
from fastapi.testclient import TestClient
from sklearn.metrics.pairwise import cosine_similarity

from config import Settings
from main import UploadGuard, create_app
from materials import MaterialError, SourceText, chunk_sources, extract_pdf, normalize_text
from retrieval import RetrievalIndex
from sessions import SessionStore


BIOLOGY = "Mitochondria generate ATP through cellular respiration. ATP stores energy for cells."
PHYSICS = "Fourier transforms describe signal frequencies. Signal analysis uses Fourier spectra."
GARDEN = "Garden flowers need water and soil. Roses bloom during spring."


def sample_pdf(texts=(BIOLOGY, PHYSICS)) -> bytes:
    with pymupdf.open() as document:
        for text in texts:
            page = document.new_page()
            if text:
                page.insert_text((72, 72), text)
        return document.tobytes()


def scanned_pdf() -> bytes:
    with pymupdf.open() as document:
        page = document.new_page()
        image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), False)
        image.clear_with(120)
        page.insert_image(pymupdf.Rect(72, 72, 200, 200), pixmap=image)
        return document.tobytes()


def make_index(settings=None):
    settings = settings or Settings()
    sources = [SourceText(BIOLOGY, "pdf", "lecture.pdf", 1),
               SourceText(PHYSICS, "pdf", "lecture.pdf", 2),
               SourceText(GARDEN, "notes")]
    return RetrievalIndex(chunk_sources(sources, settings), settings)


class ExtractionTests(unittest.TestCase):
    def test_extract_real_two_page_pdf(self):
        sources, count, skipped = extract_pdf(sample_pdf(), "lecture.pdf", "application/pdf", Settings())
        self.assertEqual(count, 2)
        self.assertEqual(skipped, [])
        self.assertIn("Mitochondria", sources[0].text)
        self.assertIn("Fourier", sources[1].text)
        self.assertEqual([source.page_number for source in sources], [1, 2])
        self.assertEqual(sources[0].filename, "lecture.pdf")

    def test_image_only_pdf_rejected_with_ocr_message(self):
        with self.assertRaisesRegex(MaterialError, "OCR"):
            extract_pdf(scanned_pdf(), "scan.pdf", "application/pdf", Settings())

    def test_mixed_pdf_reports_skipped_page(self):
        sources, count, skipped = extract_pdf(sample_pdf((BIOLOGY, "")), "mixed.pdf", "application/pdf", Settings())
        self.assertEqual((len(sources), count, skipped), (1, 2, [2]))

    def test_malformed_pdf_rejected(self):
        for data in (b"", b"not a pdf", b"%PDF-1.7\nthis is broken"):
            with self.subTest(data=data), self.assertRaises(MaterialError):
                extract_pdf(data, "broken.pdf", "application/pdf", Settings())

    def test_type_size_and_page_limits(self):
        pdf = sample_pdf()
        for filename, mime, settings, status in (
            ("notes.txt", "application/pdf", Settings(), 415),
            ("notes.pdf", "text/plain", Settings(), 415),
            ("notes.pdf", "application/pdf", replace(Settings(), max_pdf_bytes=10), 413),
            ("notes.pdf", "application/pdf", replace(Settings(), max_pdf_pages=1), 413),
        ):
            with self.subTest(filename=filename, mime=mime, status=status):
                with self.assertRaises(MaterialError) as error:
                    extract_pdf(pdf, filename, mime, settings)
                self.assertEqual(error.exception.status_code, status)

    def test_encrypted_pdf_rejected(self):
        with pymupdf.open(stream=sample_pdf(), filetype="pdf") as document:
            data = document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="secret")
        with self.assertRaisesRegex(MaterialError, "Password"):
            extract_pdf(data, "locked.pdf", "application/pdf", Settings())

    def test_filename_is_only_a_label(self):
        sources, _, _ = extract_pdf(sample_pdf(), "C:\\secret\\lecture.pdf", "application/pdf", Settings())
        self.assertEqual(sources[0].filename, "lecture.pdf")


class ChunkAndRetrievalTests(unittest.TestCase):
    def test_normalize_preserves_technical_terms_and_paragraphs(self):
        self.assertEqual(normalize_text(" C++  Na+ O(n) α\r\nwrapped\r\n\r\nATP\x00 "), "C++ Na+ O(n) α wrapped\n\nATP")

    def test_chunk_paragraph_and_page_metadata(self):
        chunks = chunk_sources([SourceText("First concept.\n\nSecond concept.", "pdf", "a.pdf", 3)], Settings())
        self.assertEqual([chunk.text for chunk in chunks], ["First concept.", "Second concept."])
        self.assertTrue(all(chunk.page_number == 3 and chunk.filename == "a.pdf" for chunk in chunks))
        self.assertEqual(len({chunk.chunk_id for chunk in chunks}), 2)

    def test_long_chunk_bound_overlap_and_complete_coverage(self):
        words = [f"term{i}" for i in range(500)]
        settings = replace(Settings(), chunk_words=50, overlap_words=10)
        chunks = chunk_sources([SourceText(" ".join(words), "notes")], settings)
        self.assertTrue(all(len(chunk.text.split()) <= 50 for chunk in chunks))
        self.assertEqual(chunks[0].text.split()[-10:], chunks[1].text.split()[:10])
        self.assertEqual(set(words), {word for chunk in chunks for word in chunk.text.split()})

    def test_chunk_limit_and_empty_text(self):
        with self.assertRaises(MaterialError):
            chunk_sources([SourceText("  ", "notes")], Settings())
        with self.assertRaises(MaterialError):
            chunk_sources([SourceText("one\n\ntwo", "notes")], replace(Settings(), max_chunks=1))

    def test_real_sparse_tfidf_vectorization(self):
        index = make_index()
        self.assertEqual(index.matrix.shape[0], 3)
        self.assertGreater(index.matrix.nnz, 0)
        self.assertIn("mitochondria", index.vectorizer.vocabulary_)
        self.assertTrue(np.all(index.vectorizer.idf_ > 0))

    def test_known_topic_ranked_above_unrelated_passages(self):
        index = make_index()
        query = "mitochondria ATP cellular energy"
        scores = cosine_similarity(index.vectorizer.transform([query]), index.matrix).ravel()
        results = index.retrieve(query, 3)
        self.assertEqual(results[0]["page_number"], 1)
        self.assertEqual(results[0]["filename"], "lecture.pdf")
        self.assertAlmostEqual(results[0]["score"], float(scores[0]), places=6)
        self.assertGreater(scores[0], scores[1])
        self.assertGreater(scores[0], scores[2])
        self.assertEqual(scores[2], 0)

    def test_second_topic_retrieves_second_page(self):
        self.assertEqual(make_index().retrieve("Fourier signal frequencies", 1)[0]["page_number"], 2)

    def test_sentence_end_punctuation_does_not_hide_term(self):
        index = RetrievalIndex(chunk_sources([SourceText("Plants use photosynthesis.", "notes")], Settings()), Settings())
        self.assertGreater(index.retrieve("photosynthesis")[0]["score"], 0)

    def test_unknown_query_has_no_fabricated_matches(self):
        self.assertEqual(make_index().retrieve("volcano tectonics"), [])

    def test_query_validation(self):
        for query, count in ((" ", 5), ("ATP", 0), ("ATP", 11), ("x" * 2001, 5)):
            with self.subTest(query=query[:10], count=count), self.assertRaises(MaterialError):
                make_index().retrieve(query, count)

    def test_technical_token_vocabulary(self):
        index = RetrievalIndex(chunk_sources([SourceText("C++ C# Na+ α O(n)", "notes")], Settings()), Settings())
        for term in ("c++", "c#", "na+", "α"):
            self.assertIn(term, index.vectorizer.vocabulary_)


class SessionTests(unittest.TestCase):
    def test_fixed_expiry_and_cleanup(self):
        now = [100.0]
        store = SessionStore(replace(Settings(), session_ttl_seconds=10), clock=lambda: now[0])
        session = store.add(make_index())
        now[0] = 109
        self.assertEqual(store.summary(session.session_id)["expires_at"], 110)
        now[0] = 110
        self.assertEqual(store.cleanup(), 1)
        with self.assertRaises(MaterialError):
            store.summary(session.session_id)

    def test_capacity_and_explicit_delete(self):
        store = SessionStore(replace(Settings(), max_sessions=1))
        first = store.add(make_index())
        with self.assertRaises(MaterialError) as error:
            store.add(make_index())
        self.assertEqual(error.exception.status_code, 503)
        store.delete(first.session_id)
        self.assertIsNotNone(store.add(make_index()))

    def test_per_session_and_total_memory_limits(self):
        with self.assertRaises(MaterialError) as error:
            SessionStore(replace(Settings(), max_session_bytes=1)).add(make_index())
        self.assertEqual(error.exception.status_code, 413)
        with self.assertRaises(MaterialError) as error:
            SessionStore(replace(Settings(), max_store_bytes=1)).add(make_index())
        self.assertEqual(error.exception.status_code, 503)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_pdf_process_retrieve_delete(self):
        response = self.client.post("/sessions", files={"pdf": ("lecture.pdf", sample_pdf(), "application/pdf")}, data={"notes": GARDEN})
        self.assertEqual(response.status_code, 201, response.text)
        summary = response.json()
        self.assertEqual(summary["page_count"], 2)
        self.assertEqual(summary["chunk_count"], 3)
        session_id = summary["session_id"]
        result = self.client.post(f"/sessions/{session_id}/retrieve", json={"query": "mitochondria ATP", "top_k": 3})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["passages"][0]["page_number"], 1)
        self.assertEqual(self.client.delete(f"/sessions/{session_id}").status_code, 204)
        self.assertEqual(self.client.get(f"/sessions/{session_id}").status_code, 404)

    def test_notes_only_and_empty_notes(self):
        response = self.client.post("/sessions", data={"notes": BIOLOGY})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["page_count"], 0)
        for notes in ("", "  ", "!!!"):
            with self.subTest(notes=notes):
                self.assertEqual(self.client.post("/sessions", data={"notes": notes}).status_code, 422)

    def test_invalid_uploads_return_clear_errors(self):
        for filename, data, mime, status in (
            ("a.pdf", b"broken", "application/pdf", 422),
            ("a.pdf", b"%PDF-1.7 broken", "application/pdf", 422),
            ("a.txt", b"text", "text/plain", 415),
            ("a.pdf", sample_pdf(), "text/plain", 415),
            ("a.pdf", b"", "application/pdf", 422),
            ("a.pdf", scanned_pdf(), "application/pdf", 422),
        ):
            with self.subTest(filename=filename, mime=mime, status=status):
                response = self.client.post("/sessions", files={"pdf": (filename, data, mime)})
                self.assertEqual(response.status_code, status, response.text)
                self.assertIsInstance(response.json()["detail"], str)

    def test_size_page_and_notes_limits(self):
        with TestClient(create_app(replace(Settings(), max_pdf_bytes=100))) as client:
            self.assertEqual(client.post("/sessions", files={"pdf": ("a.pdf", sample_pdf(), "application/pdf")}).status_code, 413)
        with TestClient(create_app(replace(Settings(), max_pdf_pages=1, max_notes_chars=10))) as client:
            self.assertEqual(client.post("/sessions", files={"pdf": ("a.pdf", sample_pdf(), "application/pdf")}).status_code, 413)
            self.assertEqual(client.post("/sessions", data={"notes": "x" * 11}).status_code, 413)

    def test_api_query_validation_and_missing_session(self):
        session_id = self.client.post("/sessions", data={"notes": BIOLOGY}).json()["session_id"]
        for query in ({"query": " "}, {"query": ""}, {"query": "ATP", "top_k": 11}):
            self.assertEqual(self.client.post(f"/sessions/{session_id}/retrieve", json=query).status_code, 422)
        self.assertEqual(self.client.post("/sessions/missing/retrieve", json={"query": "ATP"}).status_code, 404)

    def test_oversized_query_body_is_rejected(self):
        response = self.client.post("/sessions/missing/retrieve", content=b"x" * 17000, headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)

    def test_cors_and_limits(self):
        response = self.client.options("/sessions", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")
        response = self.client.post("/sessions", data={"notes": ""}, headers={"Origin": "http://localhost:5173"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")
        self.assertEqual(self.client.get("/limits").json()["max_pdf_pages"], 100)

    def test_lifespan_clears_sessions(self):
        app = create_app()
        with TestClient(app) as client:
            session_id = client.post("/sessions", data={"notes": BIOLOGY}).json()["session_id"]
        with self.assertRaises(MaterialError):
            app.state.store.summary(session_id)

    def test_streaming_multipart_request_rejected_before_parsing(self):
        settings = replace(Settings(), max_pdf_bytes=1, max_notes_chars=1)
        body = b'--boundary\r\nContent-Disposition: form-data; name="notes"\r\n\r\n' + b'x' * 70000 + b'\r\n--boundary--\r\n'
        with TestClient(create_app(settings)) as client:
            response = client.post("/sessions", content=iter([body]), headers={"Content-Type": "multipart/form-data; boundary=boundary"})
            self.assertEqual(response.status_code, 413, response.text)

    def test_api_storage_capacity_is_reported(self):
        with TestClient(create_app(replace(Settings(), max_sessions=1))) as client:
            first = client.post("/sessions", data={"notes": BIOLOGY})
            self.assertEqual(first.status_code, 201)
            self.assertEqual(client.post("/sessions", data={"notes": PHYSICS}).status_code, 503)
            client.delete("/sessions/" + first.json()["session_id"])
            self.assertEqual(client.post("/sessions", data={"notes": PHYSICS}).status_code, 201)

    def test_streaming_body_limit_without_content_length(self):
        async def check():
            called = False
            async def downstream(scope, receive, send):
                nonlocal called
                called = True
                await receive()
            guard = UploadGuard(downstream, max_bytes=5)
            messages = []
            async def receive():
                return {"type": "http.request", "body": b"123456", "more_body": False}
            async def send(message):
                messages.append(message)
            await guard({"type": "http", "method": "POST", "path": "/sessions", "headers": []}, receive, send)
            self.assertTrue(called)
            self.assertEqual(messages[0]["status"], 413)
        asyncio.run(check())


if __name__ == "__main__":
    unittest.main()
