"""Reusable lexical retrieval: fit once per session, query the same sparse index."""
from dataclasses import asdict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from config import Settings
from materials import Chunk, MaterialError, normalize_text


class RetrievalIndex:
    def __init__(self, chunks: list[Chunk], settings: Settings):
        self.chunks = chunks
        # Keep technical tokens (C++, C#, Na+, hyphenated names), single letters,
        # and Unicode words. Source passages themselves retain their exact case.
        self.vectorizer = TfidfVectorizer(
            token_pattern=r"(?u)\b\w(?:[\w+#.-]*[\w+#])?",
            ngram_range=(1, 2),
            max_features=settings.max_features,
            sublinear_tf=True,
            dtype=np.float32,
        )
        try:
            self.matrix = self.vectorizer.fit_transform(chunk.text for chunk in chunks)
        except ValueError as error:
            raise MaterialError("Material contains no searchable words. Add readable lecture text.") from error
        self.estimated_bytes = (
            self.matrix.data.nbytes + self.matrix.indices.nbytes + self.matrix.indptr.nbytes
            + self.vectorizer.idf_.nbytes
            + sum(len(chunk.text.encode("utf-8")) * 4 + 512 for chunk in chunks)
            + sum(len(term.encode("utf-8")) * 4 + 256 for term in self.vectorizer.vocabulary_)
        )

    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        if not 1 <= top_k <= 10:
            raise MaterialError("Choose between 1 and 10 passages.")
        query = normalize_text(query)
        if not query:
            raise MaterialError("Enter a non-empty search query.")
        if len(query) > 2000:
            raise MaterialError("Query exceeds the 2,000-character limit.")
        vector = self.vectorizer.transform([query])
        if not vector.nnz:
            return []
        scores = cosine_similarity(vector, self.matrix).ravel()
        order = np.argsort(-scores, kind="stable")[:top_k]
        return [{**asdict(self.chunks[int(index)]), "score": float(np.clip(scores[index], 0, 1))}
                for index in order if scores[index] > 0]
