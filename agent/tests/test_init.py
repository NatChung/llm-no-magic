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
    monkeypatch.setattr(init, "restore_mcp_config", lambda: None)
    code = init.main(["--fix"])
    assert code == 0
    assert calls["n"] == 2  # once before fixes, once after


def test_check_node_missing(monkeypatch):
    monkeypatch.setattr(init.shutil, "which", lambda _: None)
    c = init.check_node()
    assert not c.ok and c.warn_only and c.warn_label == "teaching"


def test_check_node_present(monkeypatch):
    monkeypatch.setattr(init.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)
    assert init.check_node().ok


def test_detect_agents_claude_only(monkeypatch, tmp_path):
    monkeypatch.setattr(init.Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / ".claude.json").write_text("{}")
    assert init._detect_agents() == ["claude"]


def test_detect_agents_both(monkeypatch, tmp_path):
    monkeypatch.setattr(init.Path, "home", classmethod(lambda cls: tmp_path))
    (tmp_path / ".claude.json").write_text("{}")
    (tmp_path / ".codex").mkdir()
    assert set(init._detect_agents()) == {"claude", "codex"}


def test_mcp_config_ok_for_claude(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["claude"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    (tmp_path / ".mcp.json").write_text('{"mcpServers":{"playwright":{}}}')
    assert init.check_mcp_config().ok


def test_mcp_config_missing_codex_toml(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["codex"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    c = init.check_mcp_config()
    assert not c.ok and c.warn_label == "teaching"


def test_mcp_config_codex_string_scan(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["codex"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    cdir = tmp_path / ".codex"; cdir.mkdir()
    (cdir / "config.toml").write_text("[mcp_servers.playwright]\ncommand='npx'\n")
    assert init.check_mcp_config().ok


def test_playwright_warn_label_is_creator():
    c = init.check_playwright()
    assert c.warn_only and c.warn_label == "creator"


def test_summarize_groups_warn_by_label():
    checks = [
        init.Check("Python", True),
        init.Check("Node/npx(教學用)", False, warn_only=True, warn_label="teaching"),
        init.Check("playwright(creator 驗證用)", False, warn_only=True, warn_label="creator"),
    ]
    line, code = init.summarize(checks)
    assert code == 0
    assert "WARN teaching: Node/npx(教學用) missing" in line
    assert "WARN creator: playwright(creator 驗證用) missing" in line


def test_mcp_config_no_agents(monkeypatch):
    monkeypatch.setattr(init, "_detect_agents", lambda: [])
    assert init.check_mcp_config().ok


def test_restore_mcp_config_writes_when_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(init, "_detect_agents", lambda: ["claude"])
    monkeypatch.setattr(init, "REPO_ROOT", tmp_path)
    init.restore_mcp_config()
    f = tmp_path / ".mcp.json"
    assert f.exists() and "playwright" in f.read_text()
    before = f.read_text()
    init.restore_mcp_config()  # idempotent
    assert f.read_text() == before
