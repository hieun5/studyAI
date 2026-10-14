# Resume claim verification

Claims were compared with production code and Stage 5 checks. “Implemented” describes code functionality; it does not mean model quality was empirically established. No measured accuracy, speed, usage, or educational improvement is claimed.

| Proposed claim | Status | Evidence and boundary |
| --- | --- | --- |
| Full-stack React, TypeScript, and FastAPI study application generating personalized practice questions. | Implemented; live smoke checked | React forms call FastAPI; validated local Ollama questions use passages from uploaded notes. Personalization is to source material, not adaptive difficulty/history-based question selection. UI workflow passed with mocked inference; one live model request returned five questions. |
| NLP retrieval using scikit-learn, TF-IDF, and cosine similarity. | Fully implemented and verified | backend/retrieval.py uses TfidfVectorizer.fit_transform/transform and cosine_similarity on sparse vectors. Extraction, expected-topic ranking, lower unrelated scores and actual HTTP retrieval pass with real operations. |
| LLM API evaluating student explanations, identifying potential knowledge gaps, and generating targeted recommendations through an interactive dashboard. | Partially implemented as worded | Ollama evaluates explanations and suggests per-question potential gaps/review topics. The interactive dashboard computes numerical scores and aggregates weak-topic recommendations deterministically; it does not request an LLM-generated study plan. Live model smoke passed; broad accuracy and error-path acceptance remains pending. |

## Precise resume wording

- Built a local React/TypeScript and FastAPI study app that processes lecture notes and integrates Ollama for source-grounded multiple-choice practice.
- Implemented PDF extraction and passage retrieval with PyMuPDF and scikit-learn TF-IDF/cosine similarity, preserving source metadata.
- Integrated local LLM reasoning feedback with a Recharts dashboard that separates deterministic quiz scores from qualitative estimates and derives topic review recommendations from submitted attempts.

If listing verification, say “Automated retrieval, quiz, persistence and HTTP integration tests, plus one real local-model smoke run.” Do not imply successful real-model testing until the manual acceptance checklist is complete.

Avoid “diagnosed student understanding,” “confidence scores,” “adaptive learning,” “improved learning by X%,” or “production-deployed” for this MVP. No evidence supports those claims.
