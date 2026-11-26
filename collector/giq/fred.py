"""Minimal FRED client.

Uses the public `fredgraph.csv` endpoint, which needs no API key. Each series is
returned as a sorted list of (date, value) with missing observations dropped.
"""
from __future__ import annotations

import csv
import io
import time
import urllib.request
from datetime import date
from pathlib import Path

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"

Series = list[tuple[date, float]]


def _parse(text: str) -> Series:
    out: Series = []
    reader = csv.reader(io.StringIO(text))
    next(reader, None)  # header
    for row in reader:
        if len(row) < 2 or row[1] in ("", "."):
            continue
        try:
            out.append((date.fromisoformat(row[0]), float(row[1])))
        except ValueError:
            continue
    out.sort(key=lambda r: r[0])
    return out


def fetch(series_id: str, start: str = "2018-01-01", cache_dir: Path | None = None,
          retries: int = 3) -> Series:
    """Download one FRED series. If cache_dir is given, the raw CSV is cached there."""
    if cache_dir:
        cached = cache_dir / f"{series_id}.csv"
        if cached.exists():
            return _parse(cached.read_text())
    url = FRED_CSV.format(sid=series_id, start=start)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            # FRED's bot filter rejects unfamiliar User-Agent strings; keep urllib's default.
            with urllib.request.urlopen(url, timeout=30) as resp:
                text = resp.read().decode("utf-8")
            if cache_dir:
                cache_dir.mkdir(parents=True, exist_ok=True)
                (cache_dir / f"{series_id}.csv").write_text(text)
            return _parse(text)
        except Exception as err:  # network errors are retried
            last_err = err
            time.sleep(2 ** attempt)
    raise RuntimeError(f"FRED download failed for {series_id}: {last_err}")


def truncate(series: Series, as_of: date) -> Series:
    """Observations dated on or before as_of (approximate real-time view, current vintage)."""
    return [r for r in series if r[0] <= as_of]
