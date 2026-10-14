"""Bounded, single-process session storage with fixed TTL and explicit deletion."""
import copy
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable

from config import Settings
from materials import MaterialError
from retrieval import RetrievalIndex
from practice_models import Practice


@dataclass
class Session:
    session_id: str
    index: RetrievalIndex
    page_count: int
    skipped_pages: list[int]
    created_at: float
    expires_at: float
    practice: Practice | None = None
    generating: bool = False
    practice_bytes: int = 0

    def summary(self) -> dict:
        return {"session_id": self.session_id, "chunk_count": len(self.index.chunks),
                "page_count": self.page_count, "skipped_pages": self.skipped_pages,
                "expires_at": self.expires_at}


class SessionStore:
    def __init__(self, settings: Settings, clock: Callable[[], float] = time.time):
        self.settings = settings
        self.clock = clock
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()

    def cleanup(self) -> int:
        with self._lock:
            expired = [key for key, session in self._sessions.items() if session.expires_at <= self.clock()]
            for key in expired:
                del self._sessions[key]
            return len(expired)

    def add(self, index: RetrievalIndex, page_count: int = 0, skipped_pages: list[int] | None = None) -> Session:
        with self._lock:
            self.cleanup()
            if index.estimated_bytes > self.settings.max_session_bytes:
                raise MaterialError("This session exceeds the memory limit. Use less material.", 413)
            total = sum(session.index.estimated_bytes + session.practice_bytes for session in self._sessions.values())
            if len(self._sessions) >= self.settings.max_sessions or total + index.estimated_bytes > self.settings.max_store_bytes:
                raise MaterialError("Temporary session storage is full. Clear a session or wait for it to expire.", 503)
            now = self.clock()
            session = Session(uuid.uuid4().hex, index, page_count, skipped_pages or [], now, now + self.settings.session_ttl_seconds)
            self._sessions[session.session_id] = session
            return session

    def _get(self, session_id: str) -> Session:
        self.cleanup()
        if session_id not in self._sessions:
            raise MaterialError("Session not found or expired. Process your material again.", 404)
        return self._sessions[session_id]

    def summary(self, session_id: str) -> dict:
        with self._lock:
            return self._get(session_id).summary()

    def retrieve(self, session_id: str, query: str, top_k: int) -> list[dict]:
        with self._lock:
            return self._get(session_id).index.retrieve(query, top_k)

    def begin_generation(self, session_id: str, count: int) -> list[dict]:
        with self._lock:
            session = self._get(session_id)
            if session.generating or session.practice is not None:
                raise MaterialError("A practice set already exists or is being generated. Process a fresh material session to start another set.", 409)
            # Reserve bounded space for 10 questions, locked submissions, and
            # feedback. Payload limits in practice_models/context enforce this cap.
            reserved = 1024 * 1024
            total = sum(item.index.estimated_bytes + item.practice_bytes for item in self._sessions.values())
            if session.index.estimated_bytes + reserved > self.settings.max_session_bytes or total + reserved > self.settings.max_store_bytes:
                raise MaterialError("Not enough session memory for practice. Clear another session or use less material.", 413)
            chunks = session.index.chunks
            seed_count = min(6, count, len(chunks))
            positions = [round(index * (len(chunks) - 1) / max(1, seed_count - 1)) for index in range(seed_count)]
            context: dict[str, dict] = {}
            remaining = 8000
            for position in positions:
                for passage in session.index.retrieve(chunks[position].text[:2000], 2):
                    if passage["chunk_id"] in context or len(context) >= 6 or remaining < 100:
                        continue
                    clipped = clip_passage(passage, min(1500, remaining))
                    context[passage["chunk_id"]] = clipped
                    remaining -= len(clipped["text"])
            if not context:
                raise MaterialError("No usable source passages for question generation. Try smaller, readable notes.")
            session.generating = True
            session.practice_bytes = reserved
            return list(context.values())

    def finish_generation(self, session_id: str, practice: Practice) -> dict:
        with self._lock:
            session = self._get(session_id)
            session.practice = practice
            session.generating = False
            return copy.deepcopy(practice.public())

    def cancel_generation(self, session_id: str) -> None:
        with self._lock:
            self.cleanup()
            session = self._sessions.get(session_id)
            if session and session.practice is None:
                session.generating = False
                session.practice_bytes = 0

    def practice_action(self, session_id: str, action):
        # Network work happens outside this lock. Atomic callbacks claim or read
        # practice state; copies prevent callers mutating stored submissions.
        with self._lock:
            practice = self._get(session_id).practice
            if practice is None:
                raise MaterialError("Generate a practice set first.", 404)
            return copy.deepcopy(action(practice))

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._get(session_id)
            del self._sessions[session_id]

    def clear(self) -> None:
        with self._lock:
            self._sessions.clear()


def clip_passage(passage: dict, limit: int = 1500) -> dict:
    text = passage["text"]
    clipped = text[:limit]
    if len(text) > limit and " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0]
    return {**passage, "text": clipped, "truncated": len(clipped) < len(text)}
