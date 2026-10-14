import asyncio
import os
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from config import Settings
from materials import MaterialError, SourceText, chunk_sources, extract_pdf, normalize_text
from retrieval import RetrievalIndex
from sessions import SessionStore
from ollama_client import OllamaClient, OllamaSettings
from practice import PracticeService
from practice_models import GenerationRequest, SubmissionRequest


class RetrievalQuery(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=10)


class BodyTooLarge(HTTPException):
    def __init__(self):
        super().__init__(413, "Upload exceeds the request size limit.")


class UploadGuard:
    """Limit multipart bodies and concurrent processing before parsing uploads."""
    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes
        self.slots = asyncio.Semaphore(2)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        is_upload = scope["path"].rstrip("/") == "/sessions"
        is_query = scope["path"].startswith("/sessions/")
        if not is_upload and not is_query:
            await self.app(scope, receive, send)
            return
        limit = self.max_bytes if is_upload else 16 * 1024
        if is_upload:
            try:
                await asyncio.wait_for(self.slots.acquire(), timeout=0.1)
            except TimeoutError:
                await JSONResponse({"detail": "Material processing is busy. Try again shortly."}, status_code=503)(scope, receive, send)
                return
        received = 0
        started = False

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise BodyTooLarge()
            return message

        async def tracked_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            try:
                declared = int(dict(scope["headers"]).get(b"content-length", b"0"))
            except ValueError:
                declared = 0
            if declared > limit:
                raise BodyTooLarge()
            await self.app(scope, bounded_receive, tracked_send)
        except BodyTooLarge:
            if not started:
                await JSONResponse({"detail": "Upload exceeds the request size limit."}, status_code=413)(scope, receive, send)
        finally:
            if is_upload:
                self.slots.release()


def create_app(settings: Settings | None = None, ollama: OllamaClient | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    store = SessionStore(settings)
    ollama = ollama or OllamaClient(OllamaSettings.from_env())
    practice = PracticeService(store, ollama)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async def sweep():
            while True:
                await asyncio.sleep(30)
                store.cleanup()
        task = asyncio.create_task(sweep())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            store.clear()

    app = FastAPI(title="studyAI", version="0.5.0", lifespan=lifespan)
    app.state.store = store
    app.state.ollama = ollama
    app.add_middleware(UploadGuard, max_bytes=settings.max_request_bytes)
    origins = [origin.strip() for origin in os.getenv(
        "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if origin.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])

    @app.exception_handler(MaterialError)
    async def material_error(request: Request, error: MaterialError):
        return JSONResponse({"detail": str(error)}, status_code=error.status_code)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "studyAI", "stage": "5"}

    @app.get("/health/ollama")
    def ollama_health() -> dict:
        return ollama.health()

    @app.get("/limits")
    def limits() -> dict:
        return {"max_pdf_bytes": settings.max_pdf_bytes, "max_pdf_pages": settings.max_pdf_pages,
                "max_notes_chars": settings.max_notes_chars, "session_ttl_seconds": settings.session_ttl_seconds,
                "llm_request_timeout_seconds": ollama.settings.timeout_seconds * ollama.settings.max_attempts + 30}

    def process(notes: str, data: bytes | None, filename: str, content_type: str) -> dict:
        if len(notes) > settings.max_notes_chars:
            raise MaterialError("Lecture notes exceed the character limit.", 413)
        sources = []
        text = normalize_text(notes)
        if text:
            sources.append(SourceText(text, "notes"))
        page_count = 0
        skipped = []
        if data is not None:
            pdf_sources, page_count, skipped = extract_pdf(data, filename, content_type, settings)
            sources.extend(pdf_sources)
        if sum(len(source.text) for source in sources) > settings.max_text_chars:
            raise MaterialError("Combined material exceeds the extracted-text limit.", 413)
        index = RetrievalIndex(chunk_sources(sources, settings), settings)
        return store.add(index, page_count, skipped).summary()

    @app.post("/sessions", status_code=201)
    async def create_session(notes: str = Form(""), pdf: UploadFile | None = File(None)) -> dict:
        try:
            data = await pdf.read(settings.max_pdf_bytes + 1) if pdf else None
            filename = (pdf.filename or "") if pdf else ""
            content_type = (pdf.content_type or "") if pdf else ""
            return await run_in_threadpool(process, notes, data, filename, content_type)
        finally:
            if pdf:
                await pdf.close()

    @app.get("/sessions/{session_id}")
    def session_summary(session_id: str) -> dict:
        return store.summary(session_id)

    @app.post("/sessions/{session_id}/retrieve")
    def retrieve(session_id: str, query: RetrievalQuery) -> dict:
        return {"session_id": session_id, "passages": store.retrieve(session_id, query.query, query.top_k)}

    @app.post("/sessions/{session_id}/questions")
    def generate_questions(session_id: str, body: GenerationRequest) -> dict:
        return practice.generate(session_id, body.count)

    @app.get("/sessions/{session_id}/practice")
    def get_practice(session_id: str) -> dict:
        return practice.snapshot(session_id)

    @app.post("/sessions/{session_id}/questions/{question_id}/submit")
    def submit_answer(session_id: str, question_id: str, body: SubmissionRequest) -> dict:
        return practice.submit(session_id, question_id, body)

    @app.post("/sessions/{session_id}/questions/{question_id}/feedback")
    def retry_feedback(session_id: str, question_id: str) -> dict:
        return practice.retry_feedback(session_id, question_id)

    @app.delete("/sessions/{session_id}", status_code=204)
    def delete_session(session_id: str) -> Response:
        store.delete(session_id)
        return Response(status_code=204)

    return app


app = create_app()
