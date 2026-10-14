"""Extract and chunk source text without changing case or technical notation."""
import re
import unicodedata
from dataclasses import dataclass

import pymupdf

from config import Settings


class MaterialError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class SourceText:
    text: str
    source_type: str
    filename: str | None = None
    page_number: int | None = None


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    text: str
    source_type: str
    filename: str | None
    page_number: int | None


def normalize_text(text: str) -> str:
    # NFC retains symbols such as C++, Na+, O(n), and Greek letters. Do not stem,
    # lowercase source text, remove punctuation, or guess at PDF hyphenation.
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(char for char in text if char in "\n\t" or not unicodedata.category(char).startswith("C"))
    paragraphs = re.split(r"\n[ \t]*\n", text)
    return "\n\n".join(re.sub(r"\s+", " ", paragraph).strip() for paragraph in paragraphs if paragraph.strip())


def extract_pdf(data: bytes, filename: str, content_type: str, settings: Settings) -> tuple[list[SourceText], int, list[int]]:
    if not filename.lower().endswith(".pdf") or content_type != "application/pdf":
        raise MaterialError("Only PDF files with application/pdf content type are supported.", 415)
    if not data:
        raise MaterialError("The uploaded PDF is empty.")
    if len(data) > settings.max_pdf_bytes:
        raise MaterialError(f"PDF exceeds the {settings.max_pdf_bytes}-byte size limit.", 413)
    if not data.startswith(b"%PDF-"):
        raise MaterialError("The upload is not a valid PDF document.")
    # Treat filenames as labels only, never paths.
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1][:255]
    try:
        with pymupdf.open(stream=data, filetype="pdf") as document:
            if document.needs_pass:
                raise MaterialError("Password-protected PDFs are not supported. Upload an unlocked PDF.")
            if document.page_count > settings.max_pdf_pages:
                raise MaterialError(f"PDF exceeds the {settings.max_pdf_pages}-page limit.", 413)
            sources: list[SourceText] = []
            skipped: list[int] = []
            total_chars = 0
            page_count = document.page_count
            for index, page in enumerate(document):
                text = normalize_text(page.get_text("text", sort=True))
                total_chars += len(text)
                if total_chars > settings.max_text_chars:
                    raise MaterialError("Extracted PDF text exceeds the text limit.", 413)
                if text:
                    sources.append(SourceText(text, "pdf", filename, index + 1))
                else:
                    skipped.append(index + 1)
            if not sources:
                raise MaterialError("This PDF has no extractable text. Scanned/image-only PDFs require OCR, which is not supported in this MVP.")
            return sources, page_count, skipped
    except MaterialError:
        raise
    except (pymupdf.FileDataError, pymupdf.EmptyFileError, RuntimeError, ValueError) as error:
        raise MaterialError("The PDF is malformed or cannot be read. Try another PDF.") from error


def chunk_sources(sources: list[SourceText], settings: Settings) -> list[Chunk]:
    if not 0 <= settings.overlap_words < settings.chunk_words:
        raise ValueError("Chunk overlap must be smaller than chunk size")
    chunks: list[Chunk] = []
    for source in sources:
        text = normalize_text(source.text)
        for paragraph in text.split("\n\n"):
            if not paragraph:
                continue
            # Keep paragraph/page boundaries. Prefer sentence boundaries for long
            # paragraphs; a word window handles a sentence longer than the limit.
            sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9Α-Ω])", paragraph)
            buffer: list[str] = []
            def emit(words: list[str]) -> None:
                chunks.append(Chunk(f"chunk-{len(chunks) + 1}", " ".join(words), source.source_type, source.filename, source.page_number))
                if len(chunks) > settings.max_chunks:
                    raise MaterialError("Material produces too many passages. Use a smaller document.", 413)
            for sentence in sentences:
                words = sentence.split()
                if buffer and len(buffer) + len(words) > settings.chunk_words:
                    emit(buffer)
                    buffer = buffer[-settings.overlap_words:] if settings.overlap_words else []
                    if len(buffer) + len(words) > settings.chunk_words:
                        buffer = []
                while len(words) > settings.chunk_words:
                    emit(words[:settings.chunk_words])
                    words = words[settings.chunk_words - settings.overlap_words:]
                buffer.extend(words)
            if buffer:
                emit(buffer)
    if not chunks:
        raise MaterialError("Add lecture notes containing readable text or a text-based PDF.")
    return chunks
