"""organize.py — L3 bundled script for organize_files skill.

Dry-run mode only: lists how files WOULD be organized, doesn't actually
move anything. The output is what the model sees + reports to the user.

Mock mode: if the target path doesn't exist (e.g. for spike demos),
emits a synthetic file listing so the demo still runs end-to-end.
"""
import sys
from pathlib import Path


RULES = {
    ".pdf": "pdfs/",
    ".png": "images/", ".jpg": "images/", ".jpeg": "images/",
    ".txt": "docs/", ".md": "docs/",
}
DEFAULT_TARGET = "misc/"


# Mock listing for spike demos when path doesn't exist
MOCK_LISTING = [
    "report.pdf", "photo1.png", "photo2.png", "notes.txt", "slides.pdf",
]


def plan(target_path: str) -> str:
    p = Path(target_path).expanduser()
    if p.exists() and p.is_dir():
        files = [f.name for f in p.iterdir() if f.is_file()]
        prefix = str(p)
    else:
        # Mock mode for spike demos
        files = MOCK_LISTING
        prefix = str(p) + " (mock — path does not exist; using synthetic listing)"

    if not files:
        return f"Plan: nothing to organize in {prefix} (no files found)"

    lines = [f"Plan (dry-run): organize {len(files)} files in {prefix}"]
    for name in files:
        ext = Path(name).suffix.lower()
        target = RULES.get(ext, DEFAULT_TARGET)
        lines.append(f"  {name} → {target}{name}")
    lines.append(f"\nDirs to create: {sorted(set(RULES.get(Path(n).suffix.lower(), DEFAULT_TARGET) for n in files))}")
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: organize.py <path>", file=sys.stderr)
        sys.exit(1)
    print(plan(sys.argv[1]))
