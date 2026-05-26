#!/usr/bin/env python3
"""Rewrite broken absolute file:// links in data/ HTML notes to relative filenames.

Replaces patterns like:
  file:///Users/greg/Dropbox/Cardbox/rectalcancer.html
  file:///Users/Greg/Dropbox/Cardbox/rectalcancer.html
  file:///iBook/Users/greg/.../rectalcancer.html

with just the filename (relative, since all notes live in the same data/ folder).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


FILE_URL_PATTERN = re.compile(
    r'(href|src)="(file:///[^"]+)"',
    re.IGNORECASE,
)


def extract_filename(url: str) -> str:
    path = unquote(url.split("file:///", 1)[1])
    return Path(path).name


def fix_file(html_path: Path, data_dir: Path, dry_run: bool = False) -> int:
    raw = html_path.read_bytes()
    for encoding in ("utf-8", "windows-1252", "iso-8859-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
        encoding = "utf-8"

    replacements = 0
    output_parts: list[str] = []
    last_end = 0

    for match in FILE_URL_PATTERN.finditer(text):
        attr, url = match.group(1), match.group(2)
        filename = extract_filename(url)
        if not filename:
            continue
        candidate = data_dir / filename
        if not candidate.exists():
            print(f"  WARN {html_path.name}: target not found → {filename}")
        new_value = f'{attr}="{filename}"'
        output_parts.append(text[last_end : match.start()])
        output_parts.append(new_value)
        last_end = match.end()
        replacements += 1

    if replacements == 0:
        return 0

    output_parts.append(text[last_end:])
    fixed = "".join(output_parts)

    if not dry_run:
        html_path.write_text(fixed, encoding=encoding, errors="replace")
    return replacements


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    args = parser.parse_args()

    data_dir: Path = args.data_dir.resolve()
    html_files = sorted(
        p for p in data_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".html", ".htm"}
    )

    total_files = 0
    total_replacements = 0
    for path in html_files:
        n = fix_file(path, data_dir, dry_run=args.dry_run)
        if n:
            label = "would fix" if args.dry_run else "fixed"
            print(f"  {label} {n:2d} link(s): {path.name}")
            total_files += 1
            total_replacements += n

    action = "Would fix" if args.dry_run else "Fixed"
    print(f"\n{action} {total_replacements} link(s) across {total_files} file(s).")
    if args.dry_run:
        print("Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
