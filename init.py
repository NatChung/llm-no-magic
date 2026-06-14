#!/usr/bin/env python3
"""init.py — clone 後環境檢查(stdlib-only;它的工作是檢查依賴,自己不能有依賴)。

Usage:
    python3 init.py          # 只檢查,一項一行 + 最後一行 summary
    python3 init.py --fix    # pip 類自動補裝;brew / 模型下載印指令請人跑

Exit: 0 = 核心項全過(playwright 缺只 WARN,因為只有教學 demo 需要)、1 = 有核心項缺。
"""
from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

MODELS_DIR = Path.home() / "models"
MODEL_FILES = {"0.6B": "Qwen3-0.6B-Q4_K_M.gguf", "4B": "Qwen3-4B-Q4_K_M.gguf"}
SERVER_MARKER = b"LLM, no magic"  # GET :9000/ 的 <title> 識別字串


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    fix: str = ""                                  # 修復指令(印給 user / AI)
    auto_fix: list = field(default_factory=list)   # --fix 可跑的 cmd list(每項一個 argv list)
    warn_only: bool = False                        # 缺了不影響 exit code


def check_python() -> Check:
    v = sys.version_info
    return Check("Python ≥ 3.10", v >= (3, 10), f"{v.major}.{v.minor}.{v.micro}",
                 "裝 Python 3.10+(brew install python@3.12 或 python.org)")


def check_llama() -> Check:
    p = shutil.which("llama-server")
    return Check("llama.cpp", p is not None, p or "", "brew install llama.cpp")


def check_hf() -> Check:
    p = shutil.which("hf") or shutil.which("huggingface-cli")
    return Check("hf CLI", p is not None, p or "",
                 'pip install -U "huggingface_hub[cli]"',
                 auto_fix=[[sys.executable, "-m", "pip", "install", "-U", "huggingface_hub[cli]"]])


def check_model(size: str, models_dir: Path = MODELS_DIR) -> Check:
    fname = MODEL_FILES[size]
    path = models_dir / fname
    return Check(f"Model {size}", path.exists(), str(path),
                 f"hf download Qwen/Qwen3-{size}-GGUF {fname} --local-dir ~/models")


def check_requests() -> Check:
    ok = importlib.util.find_spec("requests") is not None
    return Check("requests", ok, "", "pip install requests",
                 auto_fix=[[sys.executable, "-m", "pip", "install", "requests"]])


def _chromium_installed() -> bool:
    for base in (Path.home() / "Library/Caches/ms-playwright",   # macOS
                 Path.home() / ".cache/ms-playwright"):          # Linux
        if base.is_dir() and any(base.glob("chromium-*")):
            return True
    return False


def check_playwright() -> Check:
    has_pkg = importlib.util.find_spec("playwright") is not None
    ok = has_pkg and _chromium_installed()
    detail = "" if ok else ("chromium browser 未安裝" if has_pkg else "套件未安裝")
    return Check("playwright(教學用)", ok, detail,
                 "pip install playwright && playwright install chromium",
                 auto_fix=[[sys.executable, "-m", "pip", "install", "playwright"],
                           [sys.executable, "-m", "playwright", "install", "chromium"]],
                 warn_only=True)


def _http_get(url: str, timeout: float = 1.0):
    """回 (status, body[:4096]);連不上(= port 空著)回 (None, b'')。"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read(4096)
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return None, b""


def _lsof(port: int) -> str:
    try:
        out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
        return out or "(lsof 看不到 — 可能剛釋放)"
    except Exception as e:  # lsof 不在 / timeout
        return f"(lsof failed: {e})"


def check_port_9000() -> Check:
    status, body = _http_get("http://localhost:9000/")
    if status is None:
        return Check("Port 9000", True, "空著(server 之後再起)")
    if SERVER_MARKER in body:
        return Check("Port 9000", True, "本專案 server 已在跑")
    return Check("Port 9000", False, "被其他 process 佔用",
                 "停掉佔用者再重試:\n   " + _lsof(9000))


def check_port_8080() -> Check:
    status, _ = _http_get("http://localhost:8080/v1/models")
    if status is None:
        return Check("Port 8080", True, "空著(llama-server 之後自動起)")
    if status == 200:
        return Check("Port 8080", True, "llama-server 已在跑")
    return Check("Port 8080", False, "被其他 process 佔用(非 llama-server)",
                 "停掉佔用者再重試:\n   " + _lsof(8080))


def run_checks() -> list[Check]:
    return [check_python(), check_llama(), check_hf(),
            *[check_model(size) for size in MODEL_FILES],
            check_requests(), check_playwright(),
            check_port_9000(), check_port_8080()]


def apply_fixes(checks: list[Check]) -> None:
    for c in checks:
        if c.ok or not c.auto_fix:
            continue
        for cmd in c.auto_fix:
            print(f"→ {' '.join(cmd)}")
            r = subprocess.run(cmd)
            if r.returncode != 0:
                print("   pip 失敗?若訊息是 externally-managed(PEP 668),先建 venv:\n"
                      "   python3 -m venv .venv && source .venv/bin/activate,然後重跑 init.py --fix")
                return


def summarize(checks: list[Check]) -> tuple[str, int]:
    missing = [c.name for c in checks if not c.ok and not c.warn_only]
    warns = [c.name for c in checks if not c.ok and c.warn_only]
    if missing:
        return "MISSING: " + ", ".join(missing), 1
    if warns:
        return "READY + WARN teaching: " + ", ".join(warns) + " missing", 0
    return "READY", 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fix", action="store_true", help="pip 類缺項自動補裝")
    args = ap.parse_args(argv)

    checks = run_checks()
    if args.fix:
        apply_fixes(checks)
        checks = run_checks()  # 補裝後重查

    for c in checks:
        mark = "✓" if c.ok else ("⚠" if c.warn_only else "✗")
        print(f"{mark} {c.name}" + (f" — {c.detail}" if c.detail else ""))
        if not c.ok:
            print(f"   fix: {c.fix}")
    line, code = summarize(checks)
    print(line)
    return code


if __name__ == "__main__":
    sys.exit(main())
