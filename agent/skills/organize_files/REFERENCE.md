# organize_files — REFERENCE

詳細的 customization 說明,只在 user 要客製規則時讀。

## script 接收的 args

`organize.py <path> [--rule <ext>:<target>]...`

範例:
- `organize.py ~/Downloads`(預設規則)
- `organize.py ~/Downloads --rule .csv:data/ --rule .zip:archives/`(加自訂)

## 預設分類表(可以 override)

| 副檔名 | 目標子目錄 |
|---|---|
| .pdf | pdfs/ |
| .png .jpg .jpeg | images/ |
| .txt .md | docs/ |
| 其他 | misc/ |

## 預期輸出格式

Script 在 dry-run 跑會列印:

```
Plan: move N files to K dirs
  ~/Downloads/file1.pdf → ~/Downloads/pdfs/file1.pdf
  ...
```

模型把這個 plan 用自然語言重新講給 user 看。

## 注意

- script 是 **dry-run only** for this spike — 真實 skill 會多一個 confirm flag
- 模型不應該自己嘗試實做檔案搬移,務必呼叫 script(這是 L3 範例)
