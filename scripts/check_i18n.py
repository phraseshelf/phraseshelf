"""Checks the translations in ui/i18n/ against English and the code.

    python scripts/check_i18n.py

Reports, for every language:
  - keys missing from the translation, or left over after being removed from English
  - {placeholders} that don't exist in the English text (they would show up literally)
  - plural entries without an "other" form
  - a malformed "welcome" starter tab
and also checks that every key the code uses exists in en.json, and that the language list in
ui/i18n.js matches the files. Exits with status 1 if anything is wrong. Standard library only.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "ui" / "i18n"
CODE_FILES = [ROOT / "ui" / "index.html", ROOT / "ui" / "main.js", ROOT / "web" / "platform.js"]
PLACEHOLDER = re.compile(r"\{(\w+)\}")
PLURAL_FORMS = {"zero", "one", "two", "few", "many", "other"}


def texts(value):
    """All strings inside an entry (a plain string, or a plural object)."""
    return value.values() if isinstance(value, dict) else [value]


def placeholders(value):
    return {name for text in texts(value) for name in PLACEHOLDER.findall(text)}


def check_welcome(welcome, problems):
    if not isinstance(welcome, dict) or not isinstance(welcome.get("name"), str):
        problems.append('"welcome" needs a "name" string')
        return
    snippets = welcome.get("snippets")
    if not isinstance(snippets, list) or not snippets:
        problems.append('"welcome" needs a non-empty "snippets" list')
        return
    for i, s in enumerate(snippets):
        if not (isinstance(s, dict) and isinstance(s.get("title"), str) and isinstance(s.get("content"), str)):
            problems.append(f'"welcome" snippet {i + 1} needs "title" and "content" strings')


def check_entry(key, value, english, problems):
    if isinstance(value, dict):
        if "other" not in value:
            problems.append(f'"{key}": plural entry has no "other" form')
        unknown = set(value) - PLURAL_FORMS
        if unknown:
            problems.append(f'"{key}": unknown plural forms {sorted(unknown)}')
    elif not isinstance(value, str):
        problems.append(f'"{key}": must be text or a plural object')
        return
    extra = placeholders(value) - placeholders(english)
    if extra:
        problems.append(f'"{key}": placeholders not in English: {sorted(extra)}')


def keys_used_in_code():
    used = set()
    for path in CODE_FILES:
        src = path.read_text("utf-8")
        used |= set(re.findall(r'\bt\(\s*"([\w.]+)"', src))
        used |= set(re.findall(r'data-i18n(?:-[\w-]+)?="([\w.]+)"', src))
        used |= set(re.findall(r'dataset\.i18n\w*\s*=\s*"([\w.]+)"', src))
        for a, b in re.findall(r'\bt\(\s*\w+\s*\?\s*"([\w.]+)"\s*:\s*"([\w.]+)"', src):
            used |= {a, b}
    # Prefixes such as t("theme." + name) are built at runtime and can't be checked here.
    return {k for k in used if not k.endswith(".")}


def main() -> int:
    failed = False
    files = {p.stem: p for p in sorted(I18N_DIR.glob("*.json"))}
    english = json.loads(files["en"].read_text("utf-8"))

    declared = set(re.findall(r'^\s*"?([\w-]+)"?:\s*"', (ROOT / "ui" / "i18n.js").read_text("utf-8").split("LANGUAGES = {")[1].split("}")[0], re.M))
    if declared != set(files):
        print(f"ui/i18n.js LANGUAGES {sorted(declared)} doesn't match files {sorted(files)}")
        failed = True

    missing_in_en = sorted(k for k in keys_used_in_code() if k not in english)
    if missing_in_en:
        print("Keys used in the code but missing from en.json:", ", ".join(missing_in_en))
        failed = True

    for code, path in files.items():
        problems = []
        try:
            strings = json.loads(path.read_text("utf-8"))
        except json.JSONDecodeError as e:
            print(f"{path.name}: invalid JSON: {e}")
            failed = True
            continue
        for key in sorted(set(english) - set(strings)):
            problems.append(f'missing "{key}"')
        for key in sorted(set(strings) - set(english)):
            problems.append(f'unused "{key}" (not in en.json)')
        for key, value in strings.items():
            if key == "welcome":
                check_welcome(value, problems)
            elif key in english:
                check_entry(key, value, english[key], problems)
        status = "OK" if not problems else f"{len(problems)} problem(s)"
        print(f"{path.name}: {len(strings)} entries, {status}")
        for p in problems:
            print("   -", p)
        failed |= bool(problems)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
