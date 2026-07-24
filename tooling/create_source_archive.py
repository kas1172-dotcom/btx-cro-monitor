"""Create a source-only release archive from tracked files."""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a reproducible source archive from git, excluding ignored local files.")
    parser.add_argument("--output", default="release/btx-cro-monitor-source.tar.gz", help="Archive path to write.")
    parser.add_argument("--ref", default="HEAD", help="Git ref to archive.")
    args = parser.parse_args()

    output = (ROOT / args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "archive", "--format=tar.gz", f"--output={output}", args.ref],
        cwd=ROOT,
        check=True,
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
