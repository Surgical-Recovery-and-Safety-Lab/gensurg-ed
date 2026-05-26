# FRACS Part 2 Study Desk

This folder now contains a local-first RAG-style study website for the HTML notes in `data/`.

## Mechanism

- `data/` remains the source of truth, including all original HTML, images, and PDFs.
- `scripts/build_index.py` parses every `.html` and `.htm` note, extracts titles, text chunks, links, anchors, image references, and keywords.
- `app/search-index.json` is the generated retrieval index.
- `app/index.html` is a static study interface with:
  - note search and browsing
  - extractive retrieval answers with citations
  - original-note viewer with working relative links and images
  - MCQ generation from retrieved passages

The default app has no paid LLM dependency. It uses local retrieval in the browser. A future enhancement can add an optional local open-source model through Ollama or llama.cpp, using the retrieved passages as context.

## Run

From this project root:

```bash
python3 scripts/build_index.py
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/app/
```

## Regenerate

When notes change, rerun:

```bash
python3 scripts/build_index.py
```

## Recommended LLM Extension

For a fully generative RAG assistant without usage charges, install a local runtime such as Ollama and use a small open model:

- `llama3.2:3b` for general local use
- `qwen2.5:7b` if the machine has enough memory
- an embedding model such as `nomic-embed-text` for semantic search

The current retrieval layer is deliberately independent of those tools so the study site works immediately and remains portable.
