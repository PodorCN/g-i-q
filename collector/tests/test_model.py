import json
import math
from datetime import date
from pathlib import Path

import pytest

from giq import build, model
from giq.commentary import to_view

ROOT = Path(__file__).resolve().parents[2]
CFG = build.load_config(ROOT / "collector" / "config.yaml")


def monthly(start_value, growth_pct_per_year, n=96, start=date(2019, 1, 1)):
    out, v = [], start_value
    for i in range(n):
        y, m = start.year + (start.month - 1 + i) // 12, (start.month - 1 + i) % 12 + 1
        out.append((date(y, m, 1), v))
        v *= (1 + growth_pct_per_year / 100) ** (1 / 12)
    return out


def flat(value, n=96, start=date(2019, 1, 1), step_days=30):
    return [(date.fromordinal(start.toordinal() + i * step_days), value) for i in range(n)]


def synthetic():
    """An economy at exactly trend growth and 2% core PCE inflation."""
    return {
        "GDPNOW": flat(2.0), "A191RL1Q225SBEA": flat(2.0), "CFNAI": flat(0.0),
        "PAYEMS": [(d, 150000 + 80 * i) for i, (d, _) in enumerate(monthly(1, 0))],
        "UNRATE": flat(4.0), "INDPRO": monthly(100, 1.0), "ICSA": flat(220000, n=400, step_days=7),
        "RSAFS": monthly(500000, 4.4), "CPIAUCSL": monthly(300, 2.4), "NFCI": flat(0.0, n=400, step_days=7),
        "PCEPILFE": monthly(120, 2.0), "CPILFESL": monthly(300, 2.4),
        "T10YIE": flat(2.3, n=2000, step_days=1), "T5YIFR": flat(2.3, n=2000, step_days=1), "MICH": flat(3.0),
    }


def test_neutral_economy_sits_at_origin():
    ev = model.evaluate(synthetic(), CFG["params"])
    assert abs(ev["growth"]["mean"]) < 0.05
    assert abs(ev["inflation"]["mean"]) < 0.05
    assert ev["growth"]["sd"] >= CFG["params"]["min_sigma"]


def test_quadrants():
    assert model.quadrant_of(1, -1) == "goldilocks"
    assert model.quadrant_of(1, 1) == "overheating"
    assert model.quadrant_of(-1, 1) == "stagflation"
    assert model.quadrant_of(-1, -1) == "slowdown"


def test_mixture_moments_and_probabilities():
    mix = model.mixture([{"x": 1, "sx": 0.1, "y": 1, "sy": 0.1, "w": 1},
                         {"x": -1, "sx": 0.1, "y": 1, "sy": 0.1, "w": 1}], draws=20000)
    assert mix["x"] == pytest.approx(0, abs=1e-9)
    assert mix["sx"] == pytest.approx(math.sqrt(1 + 0.01), rel=1e-3)
    assert mix["sy"] == pytest.approx(0.1, rel=1e-3)
    p = mix["probabilities"]
    assert sum(p.values()) == pytest.approx(1, abs=1e-6)
    assert p["overheating"] == pytest.approx(0.5, abs=0.02)
    assert p["stagflation"] == pytest.approx(0.5, abs=0.02)


def test_to_view_clamps():
    raw = {"growth_gap": 99, "growth_sd": 0, "inflation_gap": -99, "inflation_sd": 9,
           "direction_growth": 5, "direction_inflation": -5}
    v = to_view({"id": "x", "name": "X", "type": "sell_side"}, raw, "test")
    assert (v["x"], v["sx"], v["y"], v["sy"], v["dx"], v["dy"]) == (4, 0.15, -3, 2.0, 1, -1)


def test_quadrant_truncated_mixture_respects_plausible_quadrants():
    mix = model.mixture([
        {"x": 0.3, "sx": 0.8, "y": 0.8, "sy": 0.6, "w": 1.0, "plausible_quadrants": ["overheating"]},
    ], draws=10000)
    assert mix["probabilities"]["overheating"] == 1.0
    assert mix["probabilities"]["stagflation"] == 0.0
    assert mix["probabilities"]["goldilocks"] == 0.0
    assert mix["probabilities"]["slowdown"] == 0.0
    assert mix["plausible_quadrants"] == ["overheating"]

    ev_hot = {
        "growth": {"mean": 0.9, "sd": 0.7},
        "inflation": {"mean": 0.9, "sd": 0.6},
        "indicators": [
            {"axis": "growth", "gap": 1.2},
            {"axis": "growth", "gap": -0.05},
            {"axis": "inflation", "gap": 1.1},
        ],
    }
    assert model.model_plausible_quadrants(ev_hot) == ["overheating"]
    ev_hot["indicators"].append({"axis": "growth", "gap": -0.4})
    assert model.model_plausible_quadrants(ev_hot) == ["overheating", "stagflation"]


def test_build_offline_with_seed_views():
    sources = {s["id"]: s for s in CFG["sources"]}
    views = build.load_manual_views([ROOT / "data" / "views" / "2026-11-13-seed.json"], sources)
    snap = build.build(CFG, synthetic(), views, date(2026, 11, 13), 6, use_llm_synthesis=False)
    assert snap["schema_version"] == 1
    assert len(snap["views"]) == len(views)
    assert {"x", "sx", "y", "sy", "probabilities"} <= set(snap["blend"]["blended"])
    assert sum(snap["blend"]["blended"]["probabilities"].values()) == pytest.approx(1, abs=1e-6)
    assert snap["synthesis"]["method"] == "template"
    assert len(snap["synthesis"]["divergences"]) >= 1
    assert len(snap["synthesis"]["watch_list"]) >= 1
    stale = {v["id"] for v in snap["views"] if v["stale"]}
    assert stale == {"jpm", "bofa"}
    json.dumps(snap)  # serialisable
