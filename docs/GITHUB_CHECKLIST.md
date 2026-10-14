# GitHub readiness checklist

No push or commit was performed. At Stage 5 review, this workspace has no .git repository, so there is no local commit history to inspect. The source audit found no private lecture files or hardcoded API secrets among publishable files. This does not cover an external repository's history.

- [x] README overview, features, stack, Windows setup, architecture Mermaid, retrieval explanation, tests and limitations.
- [x] Original labeled demo notes, without fabricated AI output or seeded quiz scores.
- [x] .env.example; no paid keys or hardcoded credentials.
- [x] .gitignore covers .env secrets, Python environments/cache, npm dependencies, builds, local runtime, test artifacts, PDFs, private/upload folders, model directories/artifacts and logs.
- [x] Backend documents and indexes have bounded temporary lifecycle; browser stores bounded submitted results/excerpts.
- [x] Automated checks and honest resume verification documented.
- [ ] Install local Ollama and complete real-model acceptance.
- [ ] Capture real desktop screenshots; placeholders are clearly labeled.
- [ ] Initialize Git, inspect exactly what will be staged, choose a license, then create a reviewed initial commit.
- [ ] Publish only after user approval; no remote/cloud setup is required to run the app.

Before staging, keep local PDFs and real lecture notes under private/ or local/. Ignore patterns are a safeguard, not a confidentiality guarantee. Demo .txt notes are intentionally publishable. Student explanations/feedback exports should be reviewed manually.

Optional preparation, from the project root, after reviewing source:

```powershell
git init
git status --short --untracked-files=all
git check-ignore .runtime/python/python.exe frontend/node_modules/react/index.js backend/.venv/Scripts/python.exe frontend/dist/index.html
git add .gitignore .env.example AGENTS.md README.md frontend backend docs
git diff --cached --stat
git diff --cached
```

Review the full staged diff for credentials/private material before committing. Do not stage ignored runtime caches, dependencies, models or documents with --force. Git publication and license selection are human decisions; this checklist does not perform them.
