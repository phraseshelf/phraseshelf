"""Builds the PhraseShelf web app into dist/web/, ready to upload to any static host.

    python scripts/build_web.py

The site is the shared UI (ui/) plus the browser backend and PWA files (web/). The version
comes from src-tauri/tauri.conf.json, so the web app always matches the desktop release.
Uses only the Python standard library.
"""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "ui"
WEB = ROOT / "web"
OUT = ROOT / "dist" / "web"
VERSION_MARK = "__PHRASESHELF_VERSION__"

HEAD_EXTRA = """\
  <meta name="description" content="Tabs of labeled buttons that copy phrases to the clipboard. Your data stays in your browser.">
  <meta name="theme-color" content="#3b6fd9">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" type="image/png" href="favicon.png">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
"""


def main() -> None:
    version = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text("utf-8"))["version"]

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    shutil.copy2(UI / "styles.css", OUT)
    shutil.copy2(UI / "main.js", OUT)
    shutil.copytree(WEB / "icons", OUT / "icons")
    shutil.copy2(WEB / "favicon.png", OUT)
    shutil.copy2(WEB / "manifest.webmanifest", OUT)
    shutil.copy2(WEB / "privacy.html", OUT)
    for name in ("platform.js", "sw.js"):
        text = (WEB / name).read_text("utf-8")
        (OUT / name).write_text(text.replace(VERSION_MARK, version), "utf-8", newline="\n")

    html = (UI / "index.html").read_text("utf-8")
    main_tag = '<script src="main.js"></script>'
    for marker in ("</head>", main_tag):
        if html.count(marker) != 1:
            raise SystemExit(f"ui/index.html: expected exactly one {marker!r}")
    # The CSS and JS get a version query so browsers fetch fresh copies after a release.
    html = html.replace('href="styles.css"', f'href="styles.css?v={version}"')
    html = html.replace("</head>", HEAD_EXTRA + "</head>")
    html = html.replace(
        main_tag,
        f'<script src="platform.js?v={version}"></script>\n  <script src="main.js?v={version}"></script>',
    )
    (OUT / "index.html").write_text(html, "utf-8", newline="\n")

    files = sorted(p.relative_to(OUT).as_posix() for p in OUT.rglob("*") if p.is_file())
    print(f"PhraseShelf web {version} -> {OUT.relative_to(ROOT).as_posix()}/ ({len(files)} files)")


if __name__ == "__main__":
    main()
