# studyAI

An AI-powered study application that transforms lecture notes into personalized practice questions, helping students reinforce concepts and test their understanding through interactive quizzes.

Built using React, TypeScript, FastAPI, and a locally hosted Large Language Model (LLM).

## Features

📚 **Study Material Upload**: Upload text-based PDF lecture notes or paste notes directly into the application.

🧠 **NLP-Powered Retrieval**: Uses TF-IDF vectorization and cosine similarity to retrieve relevant information from study materials.

🤖 **AI-Generated Questions**: Generates personalized multiple-choice practice questions using a locally hosted LLM through Ollama.

✍️ **AI-Powered Feedback**: Evaluates students' written explanations and provides contextual feedback based on their notes.

✅ **Quiz Results**: Tracks correct and incorrect answers and displays performance after completing a quiz.

🌙 **Modern Interface**: Desktop-friendly design with light and dark mode.

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/hieun5/studyAI.git
cd studyAI
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Install backend dependencies

Open another terminal:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

### 4. Install and configure Ollama

- Download Ollama from https://ollama.com/download
- Install Ollama for Windows.
- Download the Llama 3.2 model:

```bash
ollama pull llama3.2:3b
```

- Ensure the Ollama application is running.

No paid API key is required. AI processing runs locally on your computer.

### 5. Start the backend

From the `backend` directory:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

The backend runs at:

http://localhost:8000

### 6. Start the frontend

In a separate terminal, from the `frontend` directory:

```bash
npm run dev
```

Open the local address displayed in the terminal, typically:

http://localhost:5173

## Architecture

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Python, FastAPI
- **NLP Retrieval**: scikit-learn, TF-IDF, cosine similarity
- **AI Integration**: Ollama with Llama 3.2
- **PDF Processing**: PyMuPDF
- **Local Storage**: Browser localStorage for quiz results

## How It Works

1. **Upload Materials** — Students upload lecture notes or paste text.
2. **Process Notes** — The backend extracts and organizes the text into searchable passages.
3. **Retrieve Context** — TF-IDF and cosine similarity identify relevant passages.
4. **Generate Questions** — Ollama generates multiple-choice questions using the retrieved material.
5. **Complete Quiz** — Students answer questions and optionally explain their reasoning.
6. **Receive Feedback** — The LLM evaluates written explanations and provides contextual feedback.
7. **Review Results** — Students view their quiz performance and review their answers.

## Getting Started

### Prerequisites

- Node.js and npm
- Python 3.12
- Ollama
- Git
- A computer capable of running the selected local LLM

## Limitations

- Designed primarily for desktop browsers.
- Scanned PDFs requiring OCR are not supported.
- Question generation speed depends on local hardware.
- AI-generated questions and feedback may contain inaccuracies.
- No account or cloud deployment is required.

## Author

GitHub: [hieun5](https://github.com/hieun5)