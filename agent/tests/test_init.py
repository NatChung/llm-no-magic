"""Unit tests for init.py environment checker (stdlib-only, repo root)."""
import init


def test_python_check_passes_on_current_interpreter():
    c = init.check_python()
    assert c.ok  # 我們本來就要求 3.10+ 才跑得了 tests


def test_llama_missing(monkeypatch):
    monkeypatch.setattr(init.shutil, "which", lambda _: None)
    c = init.check_llama()
    assert not c.ok
    assert "brew install llama.cpp" in c.fix


def test_model_missing(tmp_path):
    c = init.check_model("0.6B", models_dir=tmp_path)
    assert not c.ok
    assert "hf download Qwen/Qwen3-0.6B-GGUF" in c.fix


def test_model_present(tmp_path):
    (tmp_path / "Qwen3-0.6B-Q4_K_M.gguf").touch()
    assert init.check_model("0.6B", models_dir=tmp_path).ok


def test_port_9000_free(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (None, b""))
    assert init.check_port_9000().ok


def test_port_9000_own_server(monkeypatch):
    monkeypatch.setattr(init, "_http_get",
                        lambda url, timeout=1.0: (200, b"<title>LLM, no magic</title>"))
    assert init.check_port_9000().ok


def test_port_9000_foreign_process(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (200, b"<html>vite</html>"))
    monkeypatch.setattr(init, "_lsof", lambda port: "node 123 …")
    c = init.check_port_9000()
    assert not c.ok
    assert "node 123" in c.fix


def test_port_8080_llama_running(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (200, b"{}"))
    assert init.check_port_8080().ok


def test_summarize_missing_core_is_exit_1():
    checks = [init.Check("llama.cpp", False, fix="brew install llama.cpp")]
    line, code = init.summarize(checks)
    assert code == 1
    assert line.startswith("MISSING:") and "llama.cpp" in line


def test_summarize_playwright_warn_only_is_exit_0():
    checks = [
        init.Check("Python ≥ 3.10", True),
        init.Check("playwright(教學用)", False, warn_only=True),
    ]
    line, code = init.summarize(checks)
    assert code == 0
    assert "WARN teaching" in line


def test_summarize_all_ok():
    line, code = init.summarize([init.Check("x", True)])
    assert (line, code) == ("READY", 0)


def test_main_prints_one_line_per_check_and_summary(monkeypatch, capsys):
    fake = [init.Check("a", True, detail="ok"),
            init.Check("b", False, fix="install b")]
    monkeypatch.setattr(init, "run_checks", lambda: fake)
    code = init.main([])
    out = capsys.readouterr().out
    assert code == 1
    assert "✓ a" in out and "✗ b" in out and "fix: install b" in out
    assert out.strip().endswith("MISSING: b")


def test_port_8080_free(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (None, b""))
    assert init.check_port_8080().ok


def test_port_8080_foreign_process(monkeypatch):
    monkeypatch.setattr(init, "_http_get", lambda url, timeout=1.0: (503, b""))
    monkeypatch.setattr(init, "_lsof", lambda port: "node 999 :8080")
    c = init.check_port_8080()
    assert not c.ok
    assert "node 999" in c.fix


def test_fix_mode_reruns_checks_twice(monkeypatch):
    calls = {"n": 0}

    def fake_run_checks():
        calls["n"] += 1
        return [init.Check("x", True)]

    monkeypatch.setattr(init, "run_checks", fake_run_checks)
    monkeypatch.setattr(init, "apply_fixes", lambda checks: None)
    code = init.main(["--fix"])
    assert code == 0
    assert calls["n"] == 2  # once before fixes, once after
