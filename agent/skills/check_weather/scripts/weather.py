"""weather.py — L3 bundled script for check_weather skill.

Mock implementation for spike (returns fixed JSON). Real version would
call OpenWeather / 中央氣象局 / 等 API with a key from env.
"""
import json
import sys


def get_weather(city: str) -> dict:
    # Mock: real impl would do `requests.get(API_URL + city, headers={"Authorization": ...})`
    return {"city": city, "temp_c": 28, "condition": "晴"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: weather.py <city>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(get_weather(sys.argv[1]), ensure_ascii=False))
