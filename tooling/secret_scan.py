"""Fail CI when tracked files contain obvious secrets or local artifacts."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_TRACKED_NAMES = {
    ".env",
    "btx_platform.db",
}

FORBIDDEN_TRACKED_PARTS = {
    ".venv",
    "node_modules",
    "dist",
    "build",
    ".pytest_cache",
    "coverage",
    ".DS_Store",
}

SECRET_PATTERNS = [
    re.compile(r"\bsk_(?:test|live)_[A-Za-z0-9_\-]{12,}\b"),
    re.compile(r"\bpat-[A-Za-z0-9_\-]{20,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{20,}\b"),
]

ALLOWLISTED_FILES = {
    ".env.example",
    "frontend/.env.example",
    "frontend/.env.production.example",
    "tooling/secret_scan.py",
}


def tracked_files() -> list[str]:
    result = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True, text=True, capture_output=True)
    return [line for line in result.stdout.splitlines() if line.strip()]


def is_local_artifact(path: str) -> bool:
    parts = set(Path(path).parts)
    return Path(path).name in FORBIDDEN_TRACKED_NAMES or bool(parts & FORBIDDEN_TRACKED_PARTS) or path.endswith((".db", ".sqlite", ".sqlite3"))


def has_populated_env_assignment(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return False
    match = re.match(r"(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=(.+)$", stripped)
    if not match:
        return False
    value = match.group(1).strip().rstrip("\\").strip().strip("'\"")
    placeholder_markers = (
        "YOUR_",
        "REPLACE_WITH",
        "<",
        ">",
        "xxx",
        "...",
        "dummy",
        "pk_test_or_live",
        "pk_live_or_test",
    )
    return bool(value and not any(marker.lower() in value.lower() for marker in placeholder_markers))


def main() -> int:
    failures: list[str] = []
    for path in tracked_files():
        if is_local_artifact(path):
            failures.append(f"tracked local artifact: {path}")
            continue
        if path in ALLOWLISTED_FILES:
            continue
        candidate = ROOT / path
        if not candidate.exists():
            continue
        try:
            text = candidate.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for index, line in enumerate(text.splitlines(), start=1):
            if has_populated_env_assignment(line):
                failures.append(f"populated secret-like env assignment: {path}:{index}")
            for pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    failures.append(f"secret-like token: {path}:{index}")
                    break
    if failures:
        print("Secret scan failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("secret scan ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
