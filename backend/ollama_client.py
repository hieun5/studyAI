"""Bounded HTTP calls to a loopback Ollama service; no API key or cloud SDK."""
import json
import os
import re
import threading
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from materials import MaterialError


class OllamaError(MaterialError):
    pass


class InvalidModelResponse(OllamaError):
    def __init__(self):
        super().__init__("Ollama returned an invalid response. Try again with a smaller set of notes.", 502)


@dataclass(frozen=True)
class OllamaSettings:
    base_url: str = "http://127.0.0.1:11434"
    model: str = "llama3.2:3b"
    timeout_seconds: int = 120
    max_attempts: int = 3

    def __post_init__(self):
        parsed = urlparse(self.base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("OLLAMA_BASE_URL must be a loopback HTTP base URL, e.g. http://127.0.0.1:11434")
        if not re.fullmatch(r"[A-Za-z0-9_./:-]{1,128}", self.model) or self.model.casefold().endswith("cloud"):
            raise ValueError("OLLAMA_MODEL must name a local model")
        if not 1 <= self.max_attempts <= 3 or not 1 <= self.timeout_seconds <= 600:
            raise ValueError("Ollama attempts must be 1–3 and timeout 1–600 seconds")

    @classmethod
    def from_env(cls):
        return cls(os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
                   os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
                   int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120")),
                   int(os.getenv("OLLAMA_MAX_ATTEMPTS", "3")))


class OllamaClient:
    def __init__(self, settings: OllamaSettings, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.transport = transport
        self._slots = threading.BoundedSemaphore(1)

    @property
    def instructions(self) -> str:
        return f"Start Ollama with 'ollama serve', then install the configured model with 'ollama pull {self.settings.model}'."

    def _request(self, method: str, path: str, payload: dict | None = None, timeout: int | None = None) -> dict:
        try:
            with httpx.Client(base_url=self.settings.base_url, timeout=httpx.Timeout(timeout or self.settings.timeout_seconds, connect=3),
                              transport=self.transport, trust_env=False, follow_redirects=False) as client:
                with client.stream(method, path, json=payload) as response:
                    if response.status_code == 404:
                        raise OllamaError("The configured Ollama model or endpoint is unavailable. " + self.instructions, 503)
                    if not 200 <= response.status_code < 300:
                        raise OllamaError("Ollama could not complete this request. " + self.instructions, 503)
                    data = bytearray()
                    for chunk in response.iter_bytes(chunk_size=64 * 1024):
                        data.extend(chunk)
                        if len(data) > 256 * 1024:
                            raise InvalidModelResponse()
                    value = json.loads(data)
                    if not isinstance(value, dict):
                        raise InvalidModelResponse()
                    return value
        except httpx.TimeoutException as error:
            raise OllamaError("Ollama timed out. Try a smaller model or fewer questions, or increase OLLAMA_TIMEOUT_SECONDS.", 504) from error
        except httpx.RequestError as error:
            raise OllamaError("Cannot reach your local Ollama service. " + self.instructions, 503) from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise InvalidModelResponse() from error

    def health(self) -> dict:
        try:
            payload = self._request("GET", "/api/tags", timeout=3)
            models = payload.get("models")
            if not isinstance(models, list):
                raise InvalidModelResponse()
            names = set()
            for item in models:
                if not isinstance(item, dict):
                    raise InvalidModelResponse()
                name = item.get("name") or item.get("model")
                if not isinstance(name, str):
                    raise InvalidModelResponse()
                names.add(name)
            requested = self.settings.model if ":" in self.settings.model else self.settings.model + ":latest"
            available = requested in names
            return {"available": available, "service_available": True, "model_available": available,
                    "model": self.settings.model, "message": "Ollama and the configured model are available." if available else "Configured model is not installed. " + self.instructions}
        except OllamaError as error:
            return {"available": False, "service_available": False, "model_available": False,
                    "model": self.settings.model, "message": str(error) + (" " + self.instructions if error.status_code != 503 else "")}

    def chat(self, system: str, evidence: dict, schema: dict) -> str:
        # Fixed roles + JSON-encoded evidence prevent source text from creating
        # system messages. No tools, commands, URLs, or scoring authority are given
        # to the model. Prompt isolation mitigates injection; output is validated too.
        if not self._slots.acquire(blocking=False):
            raise OllamaError("Ollama is busy with another request. Try again shortly.", 503)
        try:
            payload = self._request("POST", "/api/chat", {
                "model": self.settings.model,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": json.dumps(evidence, ensure_ascii=False)}],
                "format": schema, "stream": False,
                "options": {"temperature": 0.2, "num_ctx": 8192, "num_predict": 4096},
            })
            message = payload.get("message")
            if payload.get("done") is not True or not isinstance(message, dict) or not isinstance(message.get("content"), str):
                raise InvalidModelResponse()
            return message["content"]
        finally:
            self._slots.release()
