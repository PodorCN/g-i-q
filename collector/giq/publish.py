"""Push a snapshot to the backend Worker.

    GIQ_API_URL=https://giq-api.<you>.workers.dev GIQ_INGEST_TOKEN=... \
        python -m giq.publish data/latest.json
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def publish(path: Path, api_url: str, token: str) -> dict:
    body = path.read_bytes()
    json.loads(body)  # fail fast on invalid JSON
    req = urllib.request.Request(
        api_url.rstrip("/") + "/api/ingest", data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}",
                 "User-Agent": "g-i-q-collector/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        raise SystemExit(f"ingest failed: HTTP {err.code} {err.read().decode()[:500]}")


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/latest.json")
    api, token = os.environ.get("GIQ_API_URL"), os.environ.get("GIQ_INGEST_TOKEN")
    if not api or not token:
        raise SystemExit("set GIQ_API_URL and GIQ_INGEST_TOKEN")
    print(json.dumps(publish(path, api, token)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
