"""Validated model output and private in-memory practice state."""
import re
from dataclasses import dataclass, field
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Option = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
AnswerIndex = Annotated[int, Field(strict=True, ge=0, le=3)]


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GeneratedQuestion(ClosedModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=600)]
    options: list[Option] = Field(min_length=4, max_length=4)
    correct_index: AnswerIndex
    topic: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
    source_chunk_ids: list[Text] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def distinct_options_and_sources(self):
        if len({re.sub(r"\s+", " ", option.casefold()) for option in self.options}) != 4:
            raise ValueError("Answer options must be distinct")
        if len(set(self.source_chunk_ids)) != len(self.source_chunk_ids):
            raise ValueError("Source IDs must be distinct")
        return self


class QuestionBatch(ClosedModel):
    questions: list[GeneratedQuestion] = Field(min_length=1, max_length=10)


class FeedbackDraft(ClosedModel):
    reasoning_assessment: Literal["supported", "partially_supported", "unsupported", "unclear"]
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    possible_knowledge_gap: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] | None
    recommended_topic_to_review: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    source_chunk_ids: list[Text] = Field(min_length=1, max_length=4)


class GenerationRequest(ClosedModel):
    count: Literal[5, 10]

    @field_validator("count", mode="before")
    @classmethod
    def integer_count(cls, value):
        if type(value) is not int:
            raise ValueError("Question count must be the integer 5 or 10")
        return value


class SubmissionRequest(ClosedModel):
    selected_index: AnswerIndex
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2000)]


@dataclass
class QuestionState:
    question_id: str
    generated: GeneratedQuestion
    sources: list[dict]
    submission: dict | None = None

    def public(self) -> dict:
        # Correct index, explanation, and source passages are never serialized
        # here: the API keeps the answer key private until this question is locked.
        return {"question_id": self.question_id, "question": self.generated.question,
                "options": self.generated.options, "topic": self.generated.topic,
                "submission": self.submission}


@dataclass
class Practice:
    questions: list[QuestionState] = field(default_factory=list)
    requested_count: int = 5
    notice: str | None = None
    model: str = ""

    def public(self) -> dict:
        return {"questions": [question.public() for question in self.questions],
                "requested_count": self.requested_count, "returned_count": len(self.questions),
                "notice": self.notice, "model": self.model}
