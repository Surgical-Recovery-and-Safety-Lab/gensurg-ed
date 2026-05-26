/* ─── State ──────────────────────────────────────────────────── */
const state = {
  index: null,
  idf: new Map(),
  activePath: "data/index.html",
  lastResults: [],
  topicQuestions: [],
};

/* ─── Progress (localStorage) ───────────────────────────────── */
const progress = {
  _get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
    catch { return fallback; }
  },
  _set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },

  get studied()     { return this._get("gog-studied",     {}); },
  get bookmarks()   { return this._get("gog-bookmarks",   []); },
  get recent()      { return this._get("gog-recent",      []); },
  get annotations() { return this._get("gog-annotations", {}); },

  isStudied(path)     { return !!this.studied[path]; },
  isBookmarked(path)  { return this.bookmarks.some(b => b.path === path); },
  getStatus(path)     { return this.annotations[path] || "unreviewed"; },

  markStudied(path) {
    const s = this.studied; s[path] = Date.now(); this._set("gog-studied", s);
  },
  unmarkStudied(path) {
    const s = this.studied; delete s[path]; this._set("gog-studied", s);
  },
  toggleStudied(path) {
    this.isStudied(path) ? this.unmarkStudied(path) : this.markStudied(path);
  },

  toggleBookmark(path, title) {
    const b = this.bookmarks;
    const i = b.findIndex(x => x.path === path);
    if (i >= 0) b.splice(i, 1); else b.unshift({ path, title });
    this._set("gog-bookmarks", b);
  },

  addRecent(path, title) {
    const r = this.recent.filter(x => x.path !== path);
    r.unshift({ path, title, ts: Date.now() });
    this._set("gog-recent", r.slice(0, 15));
  },

  setStatus(path, status) {
    const a = this.annotations;
    if (status === "unreviewed") delete a[path]; else a[path] = status;
    this._set("gog-annotations", a);
  },

  exportAnnotations() {
    const a = this.annotations;
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), annotations: a }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "gog-annotations.json"; link.click();
    URL.revokeObjectURL(url);
  },

  studiedCount() {
    return Object.keys(this.studied).length;
  },
};

/* ─── Theme ──────────────────────────────────────────────────── */
const theme = {
  current() {
    return localStorage.getItem("gog-theme") || "auto";
  },
  apply(mode) {
    const html = document.documentElement;
    if (mode === "dark")  { html.dataset.theme = "dark"; }
    else if (mode === "light") { html.dataset.theme = "light"; }
    else { delete html.dataset.theme; }
    localStorage.setItem("gog-theme", mode);
    const icon = document.querySelector(".themeIcon");
    if (icon) icon.textContent = mode === "dark" ? "☽" : mode === "light" ? "☀" : "◑";
  },
  cycle() {
    const order = ["auto", "light", "dark"];
    const next = order[(order.indexOf(this.current()) + 1) % order.length];
    this.apply(next);
  },
};

/* ─── Elements ───────────────────────────────────────────────── */
const els = {
  status:         document.querySelector("#indexStatus"),
  search:         document.querySelector("#globalSearch"),
  topicList:      document.querySelector("#topicList"),
  form:           document.querySelector("#questionForm"),
  question:       document.querySelector("#questionInput"),
  strict:         document.querySelector("#strictToggle"),
  answer:         document.querySelector("#answerPanel"),
  results:        document.querySelector("#results"),
  mcq:            document.querySelector("#mcqOutput"),
  frame:          document.querySelector("#noteFrame"),
  viewerTitle:    document.querySelector("#viewerTitle"),
  openHome:       document.querySelector("#openHome"),
  makeQuiz:       document.querySelector("#makeQuiz"),
  tabs:           document.querySelector(".workspaceTabs"),
  template:       document.querySelector("#resultTemplate"),
  themeToggle:    document.querySelector("#themeToggle"),
  studyStats:     document.querySelector("#studyStats"),
  statusBtn:      document.querySelector("#statusBtn"),
  statusMenu:     document.querySelector("#statusMenu"),
  statusLabel:    document.querySelector("#statusLabel"),
  bookmarkBtn:    document.querySelector("#bookmarkBtn"),
  studiedBtn:     document.querySelector("#studiedBtn"),
  bookmarkSection: document.querySelector("#bookmarkSection"),
  bookmarkList:   document.querySelector("#bookmarkList"),
  recentSection:  document.querySelector("#recentSection"),
  recentList:     document.querySelector("#recentList"),
};

const stopwords = new Set([
  "about","after","also","and","are","but","for","from","has","have",
  "into","may","not","that","the","then","there","these","this","with",
  "what","when","where","which",
]);

/* ─── Boot ───────────────────────────────────────────────────── */
theme.apply(theme.current());
init();

async function init() {
  try {
    const response = await fetch("search-index.json");
    state.index = await response.json();
    state.idf = buildIdf(state.index.chunks);
    const total = state.index.documents.length;
    els.status.textContent = `${total} notes indexed`;
    renderToc(state.index.toc || fallbackToc());
    openNote("data/index.html", "Surgery Notes");
    runSearch("appendicitis management", { openTopResult: false, activateRetrieve: false });
    refreshSidebarExtras();
  } catch (error) {
    els.status.textContent = "Index not found";
    els.answer.innerHTML = `<p class="empty">Run <code>python3 scripts/build_index.py</code> from the project root, then refresh.</p>`;
    console.error(error);
  }
}

/* ─── Event listeners ────────────────────────────────────────── */
els.search.addEventListener("input", () => {
  const query = els.search.value.trim();
  if (query.length < 2) {
    renderToc(state.index?.toc || fallbackToc());
    return;
  }
  renderSearchResults(rankDocuments(query).slice(0, 80));
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = els.question.value.trim() || els.search.value.trim();
  if (query) runSearch(query, { openTopResult: true });
});

els.openHome.addEventListener("click", () => openNote("data/index.html", "Surgery Notes"));

els.makeQuiz.addEventListener("click", () => {
  renderQuiz(state.lastResults);
  activateTab("questions");
});

els.tabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tab]");
  if (button) activateTab(button.dataset.tab);
});

els.frame.addEventListener("load", () => {
  styleLoadedNote();
  syncReaderFromFrame();
  renderTopicQuestions();
  refreshWorkspaceHeader();
});

els.themeToggle.addEventListener("click", () => theme.cycle());

els.bookmarkBtn.addEventListener("click", () => {
  progress.toggleBookmark(state.activePath, docTitle(state.activePath));
  refreshWorkspaceHeader();
  refreshSidebarExtras();
  markActiveToc();
});

els.studiedBtn.addEventListener("click", () => {
  progress.toggleStudied(state.activePath);
  refreshWorkspaceHeader();
  refreshStudyStats();
  markActiveToc();
});

els.statusBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.statusMenu.hidden = !els.statusMenu.hidden;
});

els.statusMenu.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-status]");
  if (!button) return;
  progress.setStatus(state.activePath, button.dataset.status);
  els.statusMenu.hidden = true;
  refreshWorkspaceHeader();
  markActiveToc();
});

document.addEventListener("click", (e) => {
  if (!els.statusBtn.contains(e.target)) els.statusMenu.hidden = true;
});

/* ─── Keyboard shortcuts ─────────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  switch (e.key) {
    case "/":
      e.preventDefault();
      els.search.focus();
      els.search.select();
      break;
    case "h": case "H":
      openNote("data/index.html", "Surgery Notes");
      break;
    case "b": case "B":
      progress.toggleBookmark(state.activePath, docTitle(state.activePath));
      refreshWorkspaceHeader();
      refreshSidebarExtras();
      markActiveToc();
      break;
    case "m": case "M":
      progress.toggleStudied(state.activePath);
      refreshWorkspaceHeader();
      refreshStudyStats();
      markActiveToc();
      break;
    case "Escape":
      els.statusMenu.hidden = true;
      break;
  }
});

/* ─── Sidebar helpers ────────────────────────────────────────── */
function refreshStudyStats() {
  if (!state.index) return;
  const total = state.index.documents.length;
  const done = progress.studiedCount();
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.studyStats.textContent = `${done}/${total} studied (${pct}%)`;
}

function refreshSidebarExtras() {
  renderBookmarks();
  renderRecent();
  refreshStudyStats();
}

function renderBookmarks() {
  const bm = progress.bookmarks;
  els.bookmarkSection.hidden = bm.length === 0;
  els.bookmarkList.innerHTML = "";
  bm.forEach(({ path, title }) => {
    const row = makeTocItemRow(path, title || pathTitle(path), 0);
    els.bookmarkList.append(row);
  });
}

function renderRecent() {
  const rec = progress.recent;
  els.recentSection.hidden = rec.length === 0;
  els.recentList.innerHTML = "";
  rec.slice(0, 10).forEach(({ path, title }) => {
    const row = makeTocItemRow(path, title || pathTitle(path), 0);
    els.recentList.append(row);
  });
}

function refreshWorkspaceHeader() {
  const path = state.activePath;
  const isStudied = progress.isStudied(path);
  const isBookmarked = progress.isBookmarked(path);
  const status = progress.getStatus(path);

  els.studiedBtn.textContent = isStudied ? "✓ Studied" : "Mark studied";
  els.studiedBtn.classList.toggle("done", isStudied);
  els.bookmarkBtn.textContent = isBookmarked ? "★" : "☆";
  els.bookmarkBtn.style.color = isBookmarked ? "#f59e0b" : "";

  const statusLabels = { unreviewed: "Unreviewed", verified: "Verified ✓", "needs-review": "Needs review ⚠", incorrect: "Incorrect ✗" };
  els.statusLabel.textContent = statusLabels[status] || "Unreviewed";
  els.statusBtn.dataset.status = status;
}

/* ─── TOC ────────────────────────────────────────────────────── */
function fallbackToc() {
  return [{ label: "All Notes", items: state.index.documents.map(doc => ({ title: doc.title, path: doc.path })) }];
}

function renderToc(sections) {
  els.topicList.innerHTML = "";
  sections.forEach((section, index) => {
    const details = document.createElement("details");
    details.className = "tocSection";
    details.open = index < 4;
    const summary = document.createElement("summary");
    summary.textContent = section.label;
    details.append(summary);
    const list = document.createElement("div");
    list.className = "tocItems";
    renderTocItems(section.items || [], list, 0);
    details.append(list);
    els.topicList.append(details);
  });
  refreshStudyStats();
}

function renderTocItems(items, container, depth) {
  items.forEach(item => {
    const row = makeTocItemRow(item.path, item.title || pathTitle(item.path), depth);
    container.append(row);
    if (item.children?.length) {
      const childContainer = document.createElement("div");
      childContainer.className = "tocChildren";
      renderTocItems(item.children, childContainer, depth + 1);
      container.append(childContainer);
    }
  });
}

function makeTocItemRow(path, title, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = `tocItem depth${Math.min(depth, 2)}`;

  const row = document.createElement("div");
  row.className = "tocItemRow";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = title;
  button.title = path;
  button.classList.toggle("active", path === state.activePath);
  button.addEventListener("click", () => openNote(path, title));

  const badges = document.createElement("div");
  badges.className = "tocBadges hasActions";

  const dot = document.createElement("span");
  dot.className = "statusDotSmall";
  dot.dataset.status = progress.getStatus(path);

  const check = document.createElement("span");
  check.className = "studiedCheck";
  check.textContent = progress.isStudied(path) ? "✓" : "";

  const star = document.createElement("button");
  star.type = "button";
  star.className = "bookmarkStar" + (progress.isBookmarked(path) ? " active" : "");
  star.textContent = "★";
  star.title = "Bookmark";
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    progress.toggleBookmark(path, title);
    star.classList.toggle("active", progress.isBookmarked(path));
    refreshWorkspaceHeader();
    renderBookmarks();
  });

  badges.append(dot, check, star);
  row.append(button, badges);
  wrapper.append(row);
  return wrapper;
}

function renderSearchResults(documents) {
  els.topicList.innerHTML = "";
  const section = document.createElement("div");
  section.className = "searchResults";
  const header = document.createElement("p");
  header.textContent = `${documents.length} matching notes`;
  section.append(header);
  documents.forEach(doc => {
    const row = makeTocItemRow(doc.path, doc.title || doc.path, 0);
    section.append(row);
  });
  els.topicList.append(section);
}

function markActiveToc() {
  els.topicList.querySelectorAll("button[title]").forEach(button => {
    button.classList.toggle("active", button.title === state.activePath);
  });
  renderBookmarks();
  renderRecent();
}

/* ─── Note navigation ────────────────────────────────────────── */
function openNote(path, title, options = {}) {
  const src = path.startsWith("../") ? path : `../${path}`;
  state.activePath = path.replace(/^\.\.\//, "");
  els.frame.src = src;
  els.viewerTitle.textContent = title || docTitle(state.activePath);
  progress.addRecent(state.activePath, title || docTitle(state.activePath));
  markActiveToc();
  refreshWorkspaceHeader();
  if (options.showNotes !== false) activateTab("notes");
}

function syncReaderFromFrame() {
  try {
    const url = new URL(els.frame.contentWindow.location.href);
    const dataIndex = decodeURIComponent(url.pathname).lastIndexOf("/data/");
    if (dataIndex >= 0) {
      const path = decodeURIComponent(url.pathname.slice(dataIndex + 1));
      state.activePath = path;
      const title = docTitle(path);
      els.viewerTitle.textContent = title;
      progress.addRecent(path, title);
      markActiveToc();
      refreshWorkspaceHeader();
    }
  } catch { /* cross-origin; ignore */ }
}

function styleLoadedNote() {
  try {
    const doc = els.frame.contentDocument;
    if (!doc || doc.querySelector("#studyDeskNoteStyle")) return;
    const isDark = document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const bg = isDark ? "#111827" : "#ffffff";
    const bodyBg = isDark ? "#111827" : "#ffffff";
    const bodyColor = isDark ? "#d8e4f5" : "#10243f";
    const linkColor = isDark ? "#7ab4f0" : "#0b63ce";
    const headingColor = isDark ? "#93b8e8" : "#0b3f91";
    const boldColor = isDark ? "#a8c8f0" : "#0d376f";

    const style = doc.createElement("style");
    style.id = "studyDeskNoteStyle";
    style.textContent = `
      html { background: ${bg}; }
      body {
        margin: 0 auto !important;
        max-width: 940px;
        padding: 32px 36px 80px !important;
        color: ${bodyColor} !important;
        background: ${bodyBg} !important;
        font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      body, body *:not(code):not(pre), p, span, div, center, td, th, li {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: 15px !important;
        line-height: 1.65 !important;
      }
      p, div.MsoNormal { margin: 0 0 12px !important; }
      span[style*="font-family:Symbol"], span[style*="Courier New"] {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      center:first-of-type, h1, h2, h3 { color: ${headingColor} !important; }
      h1, h2, h3, h4, h5, h6,
      center:first-of-type, center:first-of-type * {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-weight: 800 !important;
      }
      h1, h1 * { font-size: 26px !important; }
      h2, h2 * { font-size: 22px !important; }
      h3, h3 * { font-size: 18px !important; }
      center:first-of-type, center:first-of-type * { font-size: 18px !important; }
      b, strong { color: ${boldColor} !important; }
      i, em { color: ${isDark ? "#93b8e8" : "#214c82"} !important; }
      a { color: ${linkColor} !important; font-weight: 700; text-decoration-thickness: 1px; }
      hr { border: 0 !important; border-top: 1px solid ${isDark ? "#253046" : "#d8e5f7"} !important; margin: 20px 0 !important; }
      img { max-width: 100% !important; height: auto !important; border-radius: 8px; }
      table { max-width: 100%; border-collapse: collapse; }
      td, th { padding: 4px 8px; border: 1px solid ${isDark ? "#253046" : "#d8e5f7"} !important; }
    `;
    doc.head.append(style);
  } catch { /* progressive enhancement */ }
}

/* ─── Questions ──────────────────────────────────────────────── */
function renderTopicQuestions() {
  const title = docTitle(state.activePath);
  state.topicQuestions = extractTopicQuestions(title);
  if (!state.topicQuestions.length) {
    els.mcq.innerHTML = `<p class="empty">No extractable topic questions found here. Retrieve notes, then build MCQs from matched passages.</p>`;
    return;
  }
  els.mcq.innerHTML = `
    <p class="answerNote">${state.topicQuestions.length} question${state.topicQuestions.length === 1 ? "" : "s"} pulled from ${escapeHtml(title)}. Answers are hidden for recall practice.</p>
    <div class="topicQuestions"></div>
  `;
  const box = els.mcq.querySelector(".topicQuestions");
  state.topicQuestions.slice(0, 12).forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "topicQuestion";
    card.innerHTML = `
      <strong>Q${index + 1}. ${escapeHtml(item.question)}</strong>
      <button type="button">Reveal answer</button>
      <div class="hiddenAnswer" hidden>${formatAnswer(item.answer)}</div>
    `;
    const button = card.querySelector("button");
    const answer = card.querySelector(".hiddenAnswer");
    button.addEventListener("click", () => {
      answer.hidden = !answer.hidden;
      button.textContent = answer.hidden ? "Reveal answer" : "Hide answer";
    });
    box.append(card);
  });
}

function extractTopicQuestions(title) {
  try {
    const doc = els.frame.contentDocument;
    if (!doc?.body || state.activePath.endsWith("index.html")) return [];
    const explicit = extractExplicitQuestions(doc);
    if (explicit.length) return explicit;
    return extractHeadingQuestions(doc, title);
  } catch { return []; }
}

function extractExplicitQuestions(doc) {
  const lineQuestions = extractLineQuestions(doc.body.innerText || "");
  if (lineQuestions.length) return lineQuestions;
  const blocks = noteBlocks(doc);
  const questions = [];
  blocks.forEach((block, index) => {
    if (!/[?]\s*$/.test(block.text)) return;
    const answer = collectAnswer(blocks, index + 1);
    if (answer.length > 20) questions.push({ question: block.text, answer });
  });
  return uniqueQuestionCards(questions);
}

function extractLineQuestions(text) {
  const lines = cleanupNoteText(text).split("\n").map(line => cleanupNoteText(line)).filter(Boolean);
  const questions = [];
  lines.forEach((line, index) => {
    if (!/[?]\s*$/.test(line) || line.length > 180) return;
    const answerLines = [];
    for (let i = index + 1; i < lines.length && answerLines.length < 10; i += 1) {
      const candidate = lines[i];
      if (/[?]\s*$/.test(candidate) || /^questions?$/i.test(candidate) || isLikelyNavigation(candidate)) break;
      if (!isStandaloneHeading(candidate) || answerLines.length === 0) answerLines.push(candidate);
      if (answerLines.length > 1 && isStandaloneHeading(candidate)) break;
    }
    const answer = cleanupNoteText(answerLines.join("\n"));
    if (answer.length > 16) questions.push({ question: line, answer });
  });
  return uniqueQuestionCards(questions);
}

function extractHeadingQuestions(doc, title) {
  const blocks = noteBlocks(doc);
  const questions = [];
  blocks.forEach((block, index) => {
    if (!isHeadingBlock(block)) return;
    if (normalizeComparable(block.text) === normalizeComparable(title) || normalizeLoose(block.text) === normalizeLoose(title)) return;
    if (index <= 1 && normalizeLoose(title).startsWith(normalizeLoose(block.text).split(" ")[0] || "")) return;
    const answer = collectAnswer(blocks, index + 1);
    const minAnswerLength = /^(ix|rx|mx)$/i.test(block.text) ? 2 : 24;
    if (answer.length > minAnswerLength) questions.push({ question: headingQuestion(block.text, title), answer });
  });
  return uniqueQuestionCards(questions).slice(0, 10);
}

function noteBlocks(doc) {
  const candidates = [...doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,center,div,li")];
  const blocks = candidates
    .map(node => ({
      node,
      text: cleanupNoteText(node.innerText || node.textContent || ""),
      tag: node.tagName.toLowerCase(),
      italic: !!node.querySelector("i,em,[style*='italic']") || node.closest("i,em"),
      bold: !!node.querySelector("b,strong") || node.tagName.match(/^H[1-6]$/),
    }))
    .filter(block => block.text.length > 1 && !/^D E A B M I M$/i.test(block.text));
  return blocks.filter((block, index) => !blocks.slice(0, index).some(prior => prior.text === block.text && prior.text.length > 45));
}

function collectAnswer(blocks, startIndex) {
  const lines = [];
  for (let i = startIndex; i < blocks.length && lines.length < 9; i += 1) {
    const block = blocks[i];
    if (/[?]\s*$/.test(block.text) || (lines.length && isHeadingBlock(block))) break;
    if (!isLikelyNavigation(block.text)) lines.push(block.text);
  }
  return cleanupNoteText(lines.join("\n"));
}

function isHeadingBlock(block) {
  const text = block.text;
  if (/[?]$/.test(text) || text.length > 54 || text.split(/\s+/).length > 7) return false;
  if (/^(home|index|d e a b m i m)$/i.test(text)) return false;
  if (/^(uss|ct|mri|fna|cxr)$/i.test(text)) return false;
  return block.tag.match(/^h[1-6]$/) || block.bold || block.italic || /^[A-Z0-9 /&-]{2,45}$/.test(text);
}

function isStandaloneHeading(text) {
  if (text.length > 54 || text.split(/\s+/).length > 7) return false;
  return /^[A-Z0-9 /&-]{2,45}$/.test(text) || /^(definition|epidemiology|location|complications?|ix|investigations?|management|treatment|operative)$/i.test(text);
}

function headingQuestion(heading, title) {
  const clean = heading.replace(/^\d+\.\s*/, "").replace(/[:.]+$/, "");
  if (/^(ix|investigations?|work.?up)$/i.test(clean)) return `What investigations are needed for ${title}?`;
  if (/^(rx|mx|management|treatment)$/i.test(clean)) return `How is ${title} managed?`;
  if (/^definition$/i.test(clean)) return `What is the definition of ${title}?`;
  if (/^epidemiology$/i.test(clean)) return `What epidemiology is relevant for ${title}?`;
  if (/^complications?$/i.test(clean)) return `What complications are associated with ${title}?`;
  if (/^examination$/i.test(clean)) return `What examination findings matter in ${title}?`;
  return `What should you know about ${clean} in ${title}?`;
}

/* ─── Search & retrieval ─────────────────────────────────────── */
function runSearch(query, options = {}) {
  const results = rankChunks(query).slice(0, 8);
  state.lastResults = results;
  renderResults(results, query);
  renderAnswer(query, results);
  els.mcq.innerHTML = `<p class="empty">Build MCQs from these retrieved passages, or open a topic to pull its embedded questions.</p>`;
  if (options.openTopResult && results[0]) openNote(results[0].path, results[0].title, { showNotes: false });
  if (options.activateRetrieve !== false) activateTab("retrieve");
}

function activateTab(name) {
  document.querySelectorAll(".workspaceTabs button").forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".tabPane").forEach(pane => {
    pane.classList.toggle("active", pane.dataset.pane === name);
  });
}

function rankChunks(query) {
  const queryTokens = tokens(query);
  if (!queryTokens.length || !state.index) return [];
  return state.index.chunks
    .map(chunk => {
      const titleScore = weightedScore(queryTokens, chunk.title) * 5;
      const keywordScore = weightedScore(queryTokens, chunk.keywords.join(" ")) * 2;
      const textScore = weightedScore(queryTokens, chunk.text);
      const phraseBoost = chunk.text.toLowerCase().includes(query.toLowerCase()) ? 8 : 0;
      return { ...chunk, score: titleScore + keywordScore + textScore + phraseBoost };
    })
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score);
}

function rankDocuments(query) {
  const queryTokens = tokens(query);
  return state.index.documents
    .map(doc => ({ ...doc, score: weightedScore(queryTokens, `${doc.title} ${doc.title} ${doc.keywords.join(" ")}`) }))
    .filter(doc => doc.score > 0)
    .sort((a, b) => b.score - a.score);
}

function weightedScore(queryTokens, text) {
  const haystack = tokens(text);
  const counts = new Map();
  haystack.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
  return queryTokens.reduce((score, t) => {
    const idf = state.idf.get(t) || 1;
    const exact = Math.min(counts.get(t) || 0, 8);
    const fuzzy = haystack.some(c => c.startsWith(t) || t.startsWith(c)) ? 0.25 : 0;
    return score + exact * idf * 2.2 + fuzzy * idf;
  }, 0);
}

function buildIdf(chunks) {
  const docFreq = new Map();
  chunks.forEach(chunk => {
    unique(tokens(`${chunk.title} ${chunk.text}`)).forEach(t => {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    });
  });
  const total = chunks.length || 1;
  return new Map([...docFreq.entries()].map(([t, count]) => [t, Math.log(1 + total / count)]));
}

function tokens(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []).filter(t => !stopwords.has(t));
}

/* ─── Render results ─────────────────────────────────────────── */
function renderResults(results, query) {
  els.results.innerHTML = "";
  if (!results.length) {
    els.results.innerHTML = `<p class="empty">No matching passages. Try a broader surgical topic or synonym.</p>`;
    return;
  }
  results.forEach((result, index) => {
    const node = els.template.content.cloneNode(true);
    const title = node.querySelector(".resultTitle");
    title.textContent = `${index + 1}. ${result.title}`;
    title.addEventListener("click", () => openNote(result.path, result.title));
    node.querySelector(".resultMeta").textContent = `${result.path} · score ${result.score.toFixed(1)}`;
    node.querySelector(".resultText").innerHTML = highlight(excerpt(result.text, query), query);
    const tags = node.querySelector(".resultTags");
    result.keywords.slice(0, 6).forEach(tag => {
      const span = document.createElement("span");
      span.textContent = tag;
      tags.append(span);
    });
    els.results.append(node);
  });
}

function renderAnswer(query, results) {
  if (!results.length) { els.answer.innerHTML = ""; return; }
  const bullets = results.slice(0, 5).map(result => {
    const sentence = bestSentence(result.text, query);
    return `<li>${escapeHtml(sentence)} <button type="button" data-path="${escapeHtml(result.path)}">${escapeHtml(result.title)}</button></li>`;
  });
  els.answer.innerHTML = `
    <h4>Retrieved Answer</h4>
    <p class="answerNote">${els.strict.checked ? "Extracted only from cited notes." : "Retrieved notes prioritized; verify in reader above."}</p>
    <ul>${bullets.join("")}</ul>
  `;
  els.answer.querySelectorAll("button[data-path]").forEach(button => {
    button.addEventListener("click", () => openNote(button.dataset.path, button.textContent));
  });
}

/* ─── MCQ ────────────────────────────────────────────────────── */
function renderQuiz(results) {
  const candidates = buildQuestions(results.slice(0, 6));
  if (!candidates.length) {
    els.mcq.innerHTML = `<p class="empty">Retrieve a topic first, then build MCQs from matched notes.</p>`;
    return;
  }
  els.mcq.innerHTML = `<p class="answerNote">Questions generated from note passages. Click an option to check yourself.</p><div class="mcq"></div>`;
  const box = els.mcq.querySelector(".mcq");
  candidates.slice(0, 5).forEach((question, idx) => {
    const article = document.createElement("article");
    article.innerHTML = `<strong>Q${idx + 1}. ${escapeHtml(question.prompt)}</strong><p class="answerNote">${escapeHtml(question.source)}</p>`;
    question.options.forEach(option => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.addEventListener("click", () => {
        article.querySelectorAll("button").forEach(b => b.classList.remove("correct", "incorrect"));
        button.classList.add(option === question.answer ? "correct" : "incorrect");
      });
      article.append(button);
    });
    box.append(article);
  });
}

function buildQuestions(results) {
  const questions = [];
  const allTitleTokens = new Set(results.flatMap(item => tokens(item.title)));
  const keywordPool = unique(
    results.flatMap(item => item.keywords)
      .filter(word => word.length > 5 && !allTitleTokens.has(word))
      .map(titleCase)
  );
  const allSentences = results.flatMap(result =>
    usefulSentences(result.text).map(sentence => ({ sentence, title: result.title }))
  );
  results.forEach(result => {
    usefulSentences(result.text).slice(0, 2).forEach(sentence => {
      const titleTokens = new Set(tokens(result.title));
      const term = result.keywords.find(word => {
        const pos = sentence.toLowerCase().indexOf(word.toLowerCase());
        return word.length > 5 && pos > 12 && !titleTokens.has(word);
      });
      if (term) {
        const answer = titleCase(term);
        const prompt = sentence.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "i"), "_____");
        const distractors = keywordPool.filter(w => w !== answer).slice(0, 3);
        if (distractors.length === 3 && prompt !== sentence) {
          questions.push({ prompt, answer, options: shuffle([answer, ...distractors]), source: result.title });
          return;
        }
      }
      const answer = sentence;
      const distractors = unique(
        allSentences.filter(item => item.title !== result.title && item.sentence !== answer).map(item => item.sentence)
      ).slice(0, 3);
      if (distractors.length < 3) return;
      questions.push({
        prompt: `Which statement about ${result.title} is supported by the retrieved notes?`,
        answer, options: shuffle([answer, ...distractors]), source: result.title,
      });
    });
  });
  return questions;
}

function usefulSentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+| - /)
    .map(s => s.trim())
    .filter(s => s.length > 55 && s.length < 190 && /[a-z]/i.test(s))
    .filter(s => !/^[A-Z\s:]{8,}$/.test(s));
}

/* ─── Text helpers ───────────────────────────────────────────── */
function excerpt(text, query) {
  const qt = tokens(query);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const picked = sentences.find(s => qt.some(t => s.toLowerCase().includes(t))) || text;
  return picked.length > 420 ? `${picked.slice(0, 420)}…` : picked;
}

function bestSentence(text, query) {
  const qt = tokens(query);
  return text.split(/(?<=[.!?])\s+/)
    .map(s => ({ s, score: weightedScore(qt, s) }))
    .sort((a, b) => b.score - a.score)[0]?.s.slice(0, 360) || text.slice(0, 360);
}

function highlight(text, query) {
  let safe = escapeHtml(text);
  tokens(query).slice(0, 8).forEach(t => {
    safe = safe.replace(new RegExp(`\\b(${escapeRegExp(t)}\\w*)`, "gi"), "<mark>$1</mark>");
  });
  return safe;
}

function docTitle(path) {
  if (path === "data/index.html") return "Surgery Notes";
  return (state.index?.documents.find(d => d.path === path)?.title || pathTitle(path)).replace(/_/g, " ");
}

function pathTitle(path) {
  return decodeURIComponent(path.split("/").pop().replace(/\.(html?|HTML?)$/, "")).replace(/[_-]/g, " ");
}

function cleanupNoteText(text) {
  return text
    .replace(/ /g, " ").replace(/[·]/g, "-")
    .replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function isLikelyNavigation(text) {
  return /^(D\s*E\s*A\s*B\s*M\s*I\s*M|home|index)$/i.test(text.trim());
}

function uniqueQuestionCards(cards) {
  const seen = new Set();
  return cards.filter(card => {
    const key = card.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatAnswer(answer) {
  const lines = cleanupNoteText(answer).split("\n").filter(Boolean);
  if (lines.length <= 1) return `<p>${escapeHtml(lines[0] || "No answer text extracted.")}</p>`;
  return `<ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function normalizeComparable(text) {
  return text.toLowerCase().replace(/[_-]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeLoose(text) {
  return normalizeComparable(text).split(" ").map(w => w.replace(/s$/, "")).join(" ");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'": "&#039;" })[c]);
}

function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function titleCase(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function unique(items) { return [...new Set(items)]; }
function shuffle(items) {
  return items.map(v => ({ v, s: Math.random() })).sort((a, b) => a.s - b.s).map(x => x.v);
}
