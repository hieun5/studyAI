"""Small, environment-configured resource limits for a single-process local MVP."""
import os
from dataclasses import dataclass


def positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


@dataclass(frozen=True)
class Settings:
    max_pdf_bytes: int = 20 * 1024 * 1024
    max_pdf_pages: int = 100
    max_notes_chars: int = 100_000
    max_text_chars: int = 1_000_000
    max_chunks: int = 2_000
    max_features: int = 20_000
    chunk_words: int = 180
    overlap_words: int = 25
    max_sessions: int = 8
    max_session_bytes: int = 16 * 1024 * 1024
    max_store_bytes: int = 64 * 1024 * 1024
    session_ttl_seconds: int = 1800

    @property
    def max_request_bytes(self) -> int:
        # Allow UTF-8 notes (up to four bytes per character) and multipart headers.
        return self.max_pdf_bytes + self.max_notes_chars * 4 + 64 * 1024

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            max_pdf_bytes=positive_int("MAX_PDF_BYTES", 20 * 1024 * 1024),
            max_pdf_pages=positive_int("MAX_PDF_PAGES", 100),
            max_sessions=positive_int("MAX_SESSIONS", 8),
            max_store_bytes=positive_int("MAX_STORE_BYTES", 64 * 1024 * 1024),
            session_ttl_seconds=positive_int("SESSION_TTL_SECONDS", 1800),
        )
