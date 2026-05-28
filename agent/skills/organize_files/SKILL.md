---
name: organize_files
description: 把指定目錄裡的檔案按副檔名整理到子目錄(.pdf → pdfs/、.png → images/ 等)。當 user 想整理 / 歸類 / sort / clean up 檔案時使用。
---

# Organize Files

把指定目錄裡的 top-level 檔案按副檔名分類搬到子目錄。

## Quick start

呼叫 bundled script:

`run_skill_script("organize_files", "organize.py", "<target_path>")`

預設分類規則(在 script 內):
- `.pdf` → `pdfs/`
- `.png` / `.jpg` / `.jpeg` → `images/`
- `.txt` / `.md` → `docs/`
- 其他 → `misc/`

Script 以 dry-run 模式跑、回 plan 字串(不真實 move)。

## 流程

1. 若 user 沒指定 target path,問一次
2. 用 `run_skill_script("organize_files", "organize.py", path)` 看計劃
3. 把 script 回的計劃用人話講給 user 看,問是否確認執行
4. user 確認後再實際執行(本 spike 沒實做 — 真實 Claude Code skill 會有 confirm flag)

## 細節 / customization

若 user 想改分類規則或加 dry-run 選項,請讀 `REFERENCE.md`(用 `read_skill_file("organize_files", "REFERENCE.md")`)。

## 注意事項

- 只動 top-level 檔案,不進子目錄
- 大量檔案(>50)要在 content 講出概數讓 user 知道規模
