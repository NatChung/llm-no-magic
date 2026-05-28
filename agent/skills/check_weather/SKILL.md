---
name: check_weather
description: 查指定城市的目前天氣(溫度 + 天氣狀況)。當 user 問天氣 / 氣溫 / weather / temperature 時使用。
---

# Check Weather

查指定城市現在天氣。

## Quick start

呼叫 bundled script:

`run_skill_script("check_weather", "weather.py", "<city>")`

Script 回傳 JSON: `{"city":"...", "temp_c":..., "condition":"..."}`(mock 資料,固定 28°C 晴 — spike 用)。

## 回覆格式

把 JSON 用以下格式回 user:

```
{city}:{temp_c}°C, {condition}
```

## 注意事項

- 一律 °C(metric)
- 一次只查一個城市;user 問多個就分開呼叫 script
- 不要加 emoji、不要加多餘建議(format 要嚴格守住)
- 若 user 沒指定城市,先問一次再呼叫
