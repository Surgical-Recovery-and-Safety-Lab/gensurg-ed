#!/usr/bin/env python3
"""Build a local JSON retrieval index from the FRACS HTML notes."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urldefrag


BLOCK_TAGS = {
    "br",
    "p",
    "div",
    "hr",
    "li",
    "tr",
    "table",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "center",
}

STOPWORDS = {
    "a",
    "about",
    "after",
    "all",
    "also",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "for",
    "from",
    "has",
    "have",
    "if",
    "in",
    "into",
    "is",
    "it",
    "may",
    "more",
    "not",
    "of",
    "on",
    "or",
    "other",
    "should",
    "than",
    "that",
    "the",
    "then",
    "there",
    "these",
    "this",
    "to",
    "with",
}


@dataclass
class ParsedPage:
    title: str
    text: str
    anchors: list[dict[str, str]]
    links: list[dict[str, str]]
    images: list[dict[str, str]]


class NotesHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self.in_title = False
        self.current_anchor: str | None = None
        self.anchors: list[dict[str, str]] = []
        self.links: list[dict[str, str]] = []
        self.images: list[dict[str, str]] = []
        self._link_href: str | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        if tag == "title":
            self.in_title = True
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "a":
            name = attrs_dict.get("name") or attrs_dict.get("id")
            href = attrs_dict.get("href")
            if name:
                self.current_anchor = name
                self.anchors.append({"id": name, "label": ""})
            if href:
                self._link_href = href
                self._link_text = []
        if tag == "img":
            src = attrs_dict.get("src", "").strip()
            if src:
                self.images.append(
                    {
                        "src": src,
                        "alt": attrs_dict.get("alt", "").strip(),
                    }
                )

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        if tag == "a":
            if self.current_anchor:
                label = clean_text(" ".join(self._link_text))
                if label:
                    self.anchors[-1]["label"] = label[:120]
                self.current_anchor = None
            if self._link_href:
                label = clean_text(" ".join(self._link_text))
                self.links.append({"href": self._link_href, "label": label[:160]})
                self._link_href = None
                self._link_text = []
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        self.parts.append(data)
        if self._link_href is not None:
            self._link_text.append(data)

    def parsed(self) -> ParsedPage:
        title = clean_text(" ".join(self.title_parts))
        text = clean_text("\n".join(self.parts))
        return ParsedPage(title=title, text=text, anchors=self.anchors, links=self.links, images=self.images)


class HomeTOCParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[dict[str, str]] = []
        self._heading_tag: str | None = None
        self._heading_text: list[str] = []
        self._href: str | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        if re.fullmatch(r"h[1-6]", tag):
            self._heading_tag = tag
            self._heading_text = []
        if tag == "a" and attrs_dict.get("href"):
            self._href = attrs_dict["href"]
            self._link_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == self._heading_tag:
            label = clean_text(" ".join(self._heading_text))
            if label:
                self.events.append({"type": "heading", "label": label})
            self._heading_tag = None
            self._heading_text = []
        if tag == "a" and self._href:
            self.events.append({"type": "link", "href": self._href, "label": clean_text(" ".join(self._link_text))})
            self._href = None
            self._link_text = []

    def handle_data(self, data: str) -> None:
        if self._heading_tag:
            self._heading_text.append(data)
        if self._href:
            self._link_text.append(data)


def clean_text(value: str) -> str:
    value = html.unescape(value)
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n\s*", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def words(value: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z0-9'-]{2,}", value.lower())


def keywords(value: str, limit: int = 18) -> list[str]:
    seen: dict[str, int] = {}
    for token in words(value):
        if token not in STOPWORDS:
            seen[token] = seen.get(token, 0) + 1
    return [item[0] for item in sorted(seen.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def read_html(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8", "windows-1252", "iso-8859-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_page(path: Path) -> ParsedPage:
    parser = NotesHTMLParser()
    parser.feed(read_html(path))
    page = parser.parsed()
    if not page.title or is_generic_title(page.title):
        page.title = title_from_filename(path)
    return page


def is_generic_title(title: str) -> bool:
    normalized = title.strip().lower()
    return normalized in {
        "chapter 1 : regional anatomy",
        "procedure",
        "title",
        "5",
    }


def title_from_filename(path: Path) -> str:
    stem = unquote(path.stem).replace("_", " ").replace("-", " ")
    return clean_text(re.sub(r"\s+", " ", stem)).title()


def chunk_text(text: str, max_words: int = 170, overlap: int = 35) -> Iterable[tuple[str, int]]:
    paragraphs = [part.strip() for part in re.split(r"\n{2,}|(?<=\.)\s+(?=[A-Z][A-Za-z ]{2,}:?\n)", text) if part.strip()]
    current: list[str] = []
    current_count = 0
    chunk_no = 0
    for paragraph in paragraphs:
        count = len(words(paragraph))
        if current and current_count + count > max_words:
            yield clean_text("\n\n".join(current)), chunk_no
            chunk_no += 1
            tail = " ".join(" ".join(current).split()[-overlap:])
            current = [tail, paragraph] if tail else [paragraph]
            current_count = len(words(tail)) + count
        else:
            current.append(paragraph)
            current_count += count
    if current:
        yield clean_text("\n\n".join(current)), chunk_no


def is_html_note(path: Path) -> bool:
    return path.suffix.lower() in {".html", ".htm"} and not path.name.startswith(".")


def normalize_asset(path: Path) -> str:
    return path.as_posix()


def normalize_note_path(path: Path, data_dir: Path) -> str:
    resolved_path = path.resolve()
    resolved_data = data_dir.resolve()
    try:
        return f"{resolved_data.name}/{resolved_path.relative_to(resolved_data).as_posix()}"
    except ValueError:
        return path.as_posix()


def resolve_note_path(data_dir: Path, href: str) -> Path | None:
    href_no_hash = urldefrag(href)[0]
    if not href_no_hash or re.match(r"^[a-z]+:", href_no_hash, re.I):
        return None
    candidate = (data_dir / unquote(href_no_hash)).resolve()
    try:
        candidate.relative_to(data_dir.resolve())
    except ValueError:
        return None
    if candidate.is_file() and is_html_note(candidate):
        return candidate
    return None


def link_label(link: dict[str, str], path: Path, data_dir: Path, doc_titles: dict[str, str]) -> str:
    text = clean_text(link.get("label", ""))
    rel_path = normalize_note_path(path, data_dir)
    if text and text.lower() not in {"click here", "see notes", "see note", "here"}:
        return text
    return doc_titles.get(rel_path) or title_from_filename(path)


def build_toc(data_dir: Path, documents: list[dict[str, object]]) -> list[dict[str, object]]:
    doc_titles = {str(doc["path"]): str(doc["title"]) for doc in documents}
    visited: set[str] = set()

    def children_for(index_path: Path, depth: int = 0) -> list[dict[str, object]]:
        if depth > 1:
            return []
        rel_index = normalize_note_path(index_path, data_dir)
        if rel_index in visited:
            return []
        visited.add(rel_index)
        page = parse_page(index_path)
        items: list[dict[str, object]] = []
        seen: set[str] = set()
        for link in page.links:
            note_path = resolve_note_path(data_dir, link["href"])
            if not note_path:
                continue
            rel_path = normalize_note_path(note_path, data_dir)
            if rel_path in seen:
                continue
            seen.add(rel_path)
            item: dict[str, object] = {
                "title": link_label(link, note_path, data_dir, doc_titles),
                "path": rel_path,
            }
            if note_path.name.lower().startswith("index") and note_path.name.lower() != index_path.name.lower():
                nested = children_for(note_path, depth + 1)
                if nested:
                    item["children"] = nested
            items.append(item)
        return items

    home = data_dir / "index.html"
    if not home.exists():
        return [{"label": "All notes", "items": [{"title": str(doc["title"]), "path": str(doc["path"])} for doc in documents]}]

    sections: list[dict[str, object]] = []
    current_label = "Core Notes"
    current_items: list[dict[str, object]] = []
    seen_paths: set[str] = set()
    toc_parser = HomeTOCParser()
    toc_parser.feed(read_html(home))
    for event in toc_parser.events:
        if event["type"] == "heading":
            if current_items:
                sections.append({"label": clean_text(current_label).title(), "items": current_items})
                current_items = []
            current_label = event["label"]
            continue
        note_path = resolve_note_path(data_dir, event["href"])
        if note_path:
            rel_path = normalize_note_path(note_path, data_dir)
            if rel_path not in seen_paths:
                seen_paths.add(rel_path)
                item = {
                    "title": event["label"] or doc_titles.get(rel_path) or title_from_filename(note_path),
                    "path": rel_path,
                }
                if note_path.name.lower().startswith("index") or " index" in note_path.stem.lower():
                    nested = children_for(note_path, 0)
                    if nested:
                        item["children"] = nested
                current_items.append(item)
    if current_items:
        sections.append({"label": clean_text(current_label).title(), "items": current_items})

    indexed_paths = {str(doc["path"]) for doc in documents}
    def collect_paths(items: list[dict[str, object]]) -> set[str]:
        paths: set[str] = set()
        for item in items:
            if "path" in item:
                paths.add(str(item["path"]))
            if "children" in item:
                paths.update(collect_paths(item["children"]))  # type: ignore[arg-type]
        return paths

    toc_paths: set[str] = set()
    for section in sections:
        toc_paths.update(collect_paths(section["items"]))  # type: ignore[arg-type]
    uncategorized = [
        {"title": str(doc["title"]), "path": str(doc["path"])}
        for doc in documents
        if str(doc["path"]) not in toc_paths and str(doc["path"]) in indexed_paths
    ]
    if uncategorized:
        sections.append({"label": "A-Z Notes", "items": sorted(uncategorized, key=lambda item: item["title"].lower())})
    return sections


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data", type=Path)
    parser.add_argument("--out", default="app/search-index.json", type=Path)
    args = parser.parse_args()

    data_dir = args.data_dir
    html_files = sorted(path for path in data_dir.iterdir() if path.is_file() and is_html_note(path))
    asset_files = sorted(
        path
        for path in data_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".pdf"}
    )

    documents = []
    chunks = []
    for path in html_files:
        page = parse_page(path)
        rel_path = normalize_note_path(path.resolve(), data_dir.resolve())
        doc_id = hashlib.sha1(rel_path.encode("utf-8")).hexdigest()[:12]
        doc = {
            "id": doc_id,
            "title": page.title,
            "path": rel_path,
            "wordCount": len(words(page.text)),
            "keywords": keywords(page.text),
            "anchors": page.anchors[:40],
            "links": page.links[:80],
            "images": page.images[:40],
        }
        documents.append(doc)
        for chunk, chunk_no in chunk_text(page.text):
            if len(words(chunk)) < 18:
                continue
            chunks.append(
                {
                    "id": f"{doc_id}-{chunk_no}",
                    "docId": doc_id,
                    "title": page.title,
                    "path": rel_path,
                    "chunkNo": chunk_no,
                    "text": chunk,
                    "keywords": keywords(chunk, 12),
                }
            )

    payload = {
        "version": 1,
        "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "source": normalize_asset(data_dir),
        "documents": documents,
        "chunks": chunks,
        "assets": [normalize_asset(path) for path in asset_files],
        "toc": build_toc(data_dir, documents),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Indexed {len(documents)} HTML notes, {len(chunks)} chunks, {len(asset_files)} assets -> {args.out}")


if __name__ == "__main__":
    main()
