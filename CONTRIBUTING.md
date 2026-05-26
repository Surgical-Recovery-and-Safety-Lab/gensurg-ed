# Contributing to GOG-NOTES

Four-person collaborative review workflow for FRACS Part 2 notes.

---

## Repository setup (one-time, owner only)

```bash
git init
git add .
git commit -m "initial: GOG-NOTES FRACS Part 2 study app"
git remote add origin https://github.com/<org>/gog-notes.git
git push -u origin main
```

Enable branch protection on `main` in GitHub Settings → Branches:
- Require a pull request before merging
- Require at least 1 approval
- Do not allow bypassing the above settings

---

## Day-to-day workflow for all contributors

### 1  Pull the latest changes first

```bash
git pull origin main
```

### 2  Create a branch for your edits

```bash
git checkout -b review/your-name/topic-name
# e.g.  git checkout -b review/chris/rectal-cancer
```

Branch names must follow `review/<your-name>/<short-topic>`.
One branch = one topic or one group of related notes. Keep branches small.

### 3  Edit notes in `data/`

- Edit HTML files directly. All notes are in `data/`.
- Images must be placed in `data/` and referenced with a relative path.
- Do **not** use absolute `file://` paths — run `python3 scripts/fix_links.py` after any paste from an old note.
- If you add a new note, link it from the appropriate index file.

### 4  Rebuild the search index

```bash
python3 scripts/build_index.py
```

This regenerates `app/search-index.json`. Commit this file alongside your HTML changes.

### 5  Test locally

```bash
python3 -m http.server 8080
# open http://localhost:8080/app/
```

Check that:
- Your edited note renders correctly in the Notes tab
- Links within the note resolve to other notes (not broken)
- Images display
- Questions tab generates sensible questions

### 6  Commit and push

```bash
git add data/your-edited-file.html app/search-index.json
git commit -m "review: rectal cancer — update management section"
git push origin review/your-name/topic-name
```

### 7  Open a pull request

On GitHub, open a PR from your branch into `main`. Use the PR description to:
- Summarise what you changed and why
- Note any factual corrections with a source citation
- Flag anything uncertain for the other reviewers

### 8  Review someone else's PR

Read the diff. Check clinical accuracy. Leave inline comments on specific lines. Approve or request changes. At least one approval is required before merging.

---

## Fact-check annotations (in the app)

The live preview site has a per-note status selector (top right of the workspace):

| Status | Meaning |
|---|---|
| Unreviewed | Default — nobody has verified this note yet |
| Verified ✓ | At least one reviewer has confirmed accuracy |
| Needs review ⚠ | Flagged — content is uncertain or outdated |
| Incorrect ✗ | Known factual error — should be corrected before use |

These statuses are stored locally in each reviewer's browser. To share your review status across the team, use the export function and commit the JSON file:

```bash
# Download from the app (future feature) or export via browser DevTools:
# localStorage.getItem("gog-annotations")
```

Add the exported JSON to `reviews/<your-name>-annotations.json` via a PR.

---

## Conflict prevention

- Each person works on different topic areas — coordinate in your group chat before starting edits
- Keep branches short-lived (merge within a day or two)
- Merge main into your branch if it has moved on before you open a PR:
  ```bash
  git fetch origin
  git merge origin/main
  ```

---

## Note format conventions

Notes follow the DEABMIM framework (Definition, Epidemiology, Aetiology, Biological behaviour, Manifestations, Investigations, Management). Use the inline anchor links at the top of each note.

When adding images:
1. Place the file in `data/` (e.g. `data/RectalCancer1.jpg`)
2. Reference it in the HTML as `<img src="RectalCancer1.jpg">`
3. Keep image files under 500 KB where possible

---

## Deployment

See the [deployment guide](#deployment-guide) section in the main README.
