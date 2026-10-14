# Stage 5 verification

Recorded 2026-10-13 on Windows, Python 3.12.10 and Node 24.21.0. Re-run these checks after changes; counts are an execution record, not performance or learning metrics.

| Check | Result | Scope |
| --- | --- | --- |
| Backend Pytest | 54 tests + 29 unittest subtests pass | Extraction, malformed/scanned/encrypted/oversized PDFs, multi-page metadata, chunks, real TF-IDF/cosine, expiry/deletion/budgets, schemas, duplicates, locking/scoring, model failures |
| Frontend tests | 38 pass | Quiz states, offline model, response recovery, score grouping, storage/corruption/quota/Unicode, clear, actual Recharts SVG bars, full app with mocked fetch |
| HTTP integration | 1 pass | Native frontend fetch → real FastAPI → real PyMuPDF/sklearn → Ollama adapter → test-only HTTP model responses → dashboard/persistence |
| TypeScript | Pass | tsc --noEmit |
| Production build | Pass | Vite output and lazy chart chunk |
| Dependency health | Pass | pip check; npm ls; npm audit reports zero vulnerabilities |
| Backend health/CORS | Pass | Real Uvicorn HTTP; allowed loopback origin, denied unrelated origin |
| Production static HTTP | Pass | HTML, JS and CSS return 200 at 127.0.0.1:5173 |
| Real local Ollama | Smoke pass; extended checks pending | Configured llama3.2:3b available; five real questions generated and one submitted answer received structured feedback with retrieved source evidence |
| Browser visual acceptance | Not run | No enabled browser surface; jsdom is not visual QA |
| Vite development optimizer | Blocked in managed environment | esbuild cannot read a parent directory; build/preview succeeds |

The HTTP harness is exclusively in backend/tests/serve_integration.py. It starts ephemeral local Ollama-protocol and FastAPI servers, verifies fixed message roles, JSON schemas and positive real retrieval scores, and expects one generation plus four feedback calls; one answer omits reasoning and skips inference. Mock content is labeled TEST MOCK and cannot be activated from production settings/routes. No product fake-output fallback exists.

The test loads original demo notes, rejects empty/unsupported/malformed inputs, processes a generated two-page PDF with an empty MIME type, clears its session, generates five questions, submits one correct/four incorrect answers (including one without reasoning), verifies locked choices and a backend 409 on edits, retrieves targeted passages, checks 20% accuracy, remounts/restores history, and clears history. Temporary servers shut down after the test.

Backend unittest classes are collected by Pytest. One Starlette TestClient/httpx deprecation warning remains; it does not fail tests. Ordinary network timeouts, malformed JSON and session deletion behavior have frontend API regression tests.

## Interface and optional reasoning update - 2026-10-14

- Backend: 55 Pytest tests and 32 unittest subtests pass; backend health and loopback CORS pass.
- Frontend: 40 tests and the full HTTP integration test pass; TypeScript and production build pass.
- Optional reasoning: blank, whitespace-only, and omitted explanations score and lock without an Ollama chat. Short explanations still receive feedback. Feedback retries preserve the skipped state, and saved results restore blank explanations after refresh.
- Interface: the library navigation/placeholder and sidebar slogans are removed. The sample-notes control uses the primary button style and wraps within narrow desktop cards.
- HTTP integration uses real FastAPI, PyMuPDF, and scikit-learn with test-only mocked inference; this update did not rerun real-model acceptance. The prior live smoke result remains recorded above.
- Visual acceptance remains pending: no connected browser was available. Pytest reported the existing Starlette/httpx deprecation plus a nonblocking cache-directory permission warning.

## Commands

From backend, with the installed environment:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe check_health.py
.\.venv\Scripts\python.exe -m pip check
```

In this workspace, substitute ..\.runtime\python\python.exe for the virtual environment interpreter if no .venv exists.

From frontend:

```powershell
npm.cmd run test
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run build
npm.cmd run preview
```

The integration command auto-detects a Python interpreter. If necessary:

```powershell
$env:STUDYAI_TEST_PYTHON = "C:\absolute\path\to\python.exe"
npm.cmd run test:integration
```

## Required manual acceptance with real Ollama

1. Install Ollama, start its local-only server, and pull the configured local model (README instructions).
2. Start FastAPI plus frontend/preview. Confirm /health/ollama lists service/model available.
3. Load demo notes, process them, and search for IDF/cosine. Check returned passages and no invented page numbers.
4. Generate five questions, then repeat a fresh session requesting ten. Validate four options, plausible single keys, distinct questions, and any partial-generation notice. Check facts against the notes.
5. Answer correctly and incorrectly with supported and intentionally flawed explanations. Also submit an answer without an explanation: check immediate deterministic scoring, skipped reasoning feedback, locked inputs, and saved results after refresh. For explanations, check qualitative estimates, review topic and actual source passages.
6. Finish the quiz; open Dashboard, expand feedback, retrieve a suggested topic. Refresh at the same browser origin and confirm scores/history persist.
7. Inspect light/dark layouts at 1024px and a wider desktop width, keyboard focus, labels, loading/error states, long filenames and long feedback.
8. Stop Ollama: verify friendly startup instructions; stop it after generation and submit to confirm scored answers persist and feedback can retry after restart.
9. Try a scanned, malformed and over-limit PDF. Clear the session and verify its API returns 404. Clear saved history and confirm theme/unrelated storage remains.
10. Capture genuine screenshots using only the labeled demo dataset. Record model/version and factual concerns without inventing quality metrics.

Live smoke result: “Generated five questions and evaluated one submitted answer with the configured local model.” Do not infer model accuracy from this single run. Complete the remaining cases above before claiming broader acceptance.
