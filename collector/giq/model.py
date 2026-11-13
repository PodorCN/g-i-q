"""Hard-data model: maps FRED indicators onto the growth/inflation plane.

Every indicator is converted into a *gap in percentage points*:

    growth gap     g_i  ~ (implied real GDP growth) - trend_growth
    inflation gap  p_i  ~ (implied core PCE inflation) - inflation_target

The model point is the weighted mean of the gaps on each axis; its 1-sigma is
the weighted dispersion of the gaps around that mean (plus a measurement floor).
The mappings are deliberately simple rules of thumb (Okun's law, CPI-PCE wedge,
CFNAI scaling) and are documented next to each indicator so they can be tuned.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable

from . import fred

Series = fred.Series

# --------------------------------------------------------------------------- transforms


def _last(s: Series) -> float | None:
    return s[-1][1] if s else None


def _ann_change(s: Series, months: int) -> float | None:
    """Annualized % change over `months` monthly observations."""
    if len(s) <= months:
        return None
    a, b = s[-1 - months][1], s[-1][1]
    if a <= 0:
        return None
    return ((b / a) ** (12 / months) - 1) * 100


def _yoy_monthly(s: Series) -> float | None:
    """12-month % change, matching on calendar month (robust to a missing month)."""
    if not s:
        return None
    d, v = s[-1]
    target = date(d.year - 1, d.month, 1)
    prev = [x for x in s if x[0] == target]
    if not prev:
        return None
    return (v / prev[0][1] - 1) * 100


def _avg_monthly_diff(s: Series, months: int) -> float | None:
    if len(s) <= months:
        return None
    return (s[-1][1] - s[-1 - months][1]) / months


def _mean_last(s: Series, n: int) -> float | None:
    if len(s) < n:
        return None
    return sum(v for _, v in s[-n:]) / n


def _unemp_change(s: Series) -> float | None:
    """3m-avg unemployment now minus 3m-avg six months earlier (pp)."""
    if len(s) < 9:
        return None
    now = sum(v for _, v in s[-3:]) / 3
    then = sum(v for _, v in s[-9:-6]) / 3
    return now - then


def _claims_vs_year(s: Series) -> float | None:
    """4-week avg initial claims relative to trailing 52-week avg (%)."""
    if len(s) < 52:
        return None
    four = sum(v for _, v in s[-4:]) / 4
    year = sum(v for _, v in s[-52:]) / 52
    return (four / year - 1) * 100


# --------------------------------------------------------------------------- indicators


@dataclass
class Indicator:
    id: str
    axis: str                 # "growth" | "inflation"
    label: str
    series: list[str]         # FRED ids used
    unit: str
    lag_days: int             # publication lag used when back-filling history
    weight: float
    compute: Callable[[dict[str, Series]], float | None]
    to_gap: Callable[[float, dict], float]
    note: str
    extra: dict = field(default_factory=dict)


def build_indicators() -> list[Indicator]:
    T = lambda p: p["trend_growth"]  # noqa: E731
    PI = lambda p: p["inflation_target"]  # noqa: E731
    return [
        # ---------------- growth
        Indicator("gdpnow", "growth", "Atlanta Fed GDPNow (current qtr, % saar)", ["GDPNOW"], "%",
                  0, 1.5, lambda d: _last(d["GDPNOW"]), lambda v, p: v - T(p),
                  "Nowcast of current-quarter real GDP; gap = value - trend."),
        Indicator("gdp", "growth", "Real GDP, last quarter (% saar)", ["A191RL1Q225SBEA"], "%",
                  120, 1.0, lambda d: _last(d["A191RL1Q225SBEA"]), lambda v, p: v - T(p),
                  "Latest BEA print; gap = value - trend."),
        Indicator("cfnai", "growth", "Chicago Fed National Activity Index, 3m avg", ["CFNAI"], "idx",
                  55, 1.0, lambda d: _mean_last(d["CFNAI"], 3), lambda v, p: 1.5 * v,
                  "CFNAI = 0 means trend growth; heuristic: 1 index pt ~ 1.5pp of growth."),
        Indicator("payrolls", "growth", "Nonfarm payrolls, 3m avg change (k)", ["PAYEMS"], "k",
                  36, 1.0, lambda d: _avg_monthly_diff(d["PAYEMS"], 3),
                  lambda v, p: (v - p.get("breakeven_payrolls", 80)) / 60,
                  "Gap vs ~80k/month breakeven (low immigration era); 60k ~ 1pp. Heuristic."),
        Indicator("unemp", "growth", "Unemployment rate, 6m change in 3m avg (pp)", ["UNRATE"], "pp",
                  36, 1.0, lambda d: _unemp_change(d["UNRATE"]), lambda v, p: -4.0 * v,
                  "Okun's law: +0.5pp/yr unemployment ~ -1pp growth, so 6m change x -4."),
        Indicator("indpro", "growth", "Industrial production, 6m annualized (%)", ["INDPRO"], "%",
                  47, 0.5, lambda d: _ann_change(d["INDPRO"], 6), lambda v, p: 0.5 * (v - 1.0),
                  "IP trend ~1%/yr and ~2x as volatile as GDP, so scaled by 0.5."),
        Indicator("claims", "growth", "Initial claims, 4wk avg vs 52wk avg (%)", ["ICSA"], "%",
                  12, 0.5, lambda d: _claims_vs_year(d["ICSA"]), lambda v, p: -v / 10,
                  "Claims 10% above their 1y average ~ -1pp growth. Heuristic."),
        Indicator("retail", "growth", "Real retail sales, 3m annualized (%)", ["RSAFS", "CPIAUCSL"], "%",
                  45, 0.5,
                  lambda d: (None if _ann_change(d["RSAFS"], 3) is None or _ann_change(d["CPIAUCSL"], 3) is None
                             else _ann_change(d["RSAFS"], 3) - _ann_change(d["CPIAUCSL"], 3)),
                  lambda v, p: 0.5 * (v - T(p)),
                  "Nominal retail sales deflated by headline CPI; volatile, scaled by 0.5."),
        Indicator("nfci", "growth", "Chicago Fed NFCI (financial conditions)", ["NFCI"], "idx",
                  5, 0.5, lambda d: _mean_last(d["NFCI"], 4), lambda v, p: -1.0 * v,
                  "Leading: negative NFCI = looser than average = supports growth."),
        # ---------------- inflation
        Indicator("core_pce_yoy", "inflation", "Core PCE, y/y (%)", ["PCEPILFE"], "%",
                  58, 1.5, lambda d: _yoy_monthly(d["PCEPILFE"]), lambda v, p: v - PI(p),
                  "The Fed's target measure; gap = value - 2%."),
        Indicator("core_pce_3m", "inflation", "Core PCE, 3m annualized (%)", ["PCEPILFE"], "%",
                  58, 1.0, lambda d: _ann_change(d["PCEPILFE"], 3), lambda v, p: v - PI(p),
                  "Momentum of the target measure."),
        Indicator("core_cpi_3m", "inflation", "Core CPI, 3m annualized (%)", ["CPILFESL"], "%",
                  40, 1.0, lambda d: _ann_change(d["CPILFESL"], 3), lambda v, p: v - PI(p) - 0.4,
                  "CPI runs ~0.4pp above PCE, so gap = value - 2.4%."),
        Indicator("cpi_6m", "inflation", "Headline CPI, 6m annualized (%)", ["CPIAUCSL"], "%",
                  40, 0.5, lambda d: _ann_change(d["CPIAUCSL"], 6), lambda v, p: v - PI(p) - 0.4,
                  "Includes energy (volatile, so 6m window and half weight); gap = value - 2.4%."),
        Indicator("be10", "inflation", "10y breakeven inflation (%)", ["T10YIE"], "%",
                  1, 0.5, lambda d: _mean_last(d["T10YIE"], 5), lambda v, p: v - PI(p) - 0.3,
                  "Market-implied CPI inflation; ~0.3pp CPI/PCE + risk premium wedge."),
        Indicator("fwd5y5y", "inflation", "5y5y forward breakeven (%)", ["T5YIFR"], "%",
                  1, 0.5, lambda d: _mean_last(d["T5YIFR"], 5), lambda v, p: v - PI(p) - 0.3,
                  "Long-run expectations anchor."),
        Indicator("umich", "inflation", "UMich 1y inflation expectations (%)", ["MICH"], "%",
                  20, 0.5, lambda d: _last(d["MICH"]), lambda v, p: 0.5 * (v - 3.0),
                  "Survey runs ~1pp above realized PCE on average; half weight on the gap."),
    ]


ALL_SERIES = sorted({s for ind in build_indicators() for s in ind.series})

# --------------------------------------------------------------------------- model point


def _weighted_mean_sd(pairs: list[tuple[float, float]], floor: float) -> tuple[float, float]:
    wsum = sum(w for _, w in pairs)
    mean = sum(v * w for v, w in pairs) / wsum
    var = sum(w * (v - mean) ** 2 for v, w in pairs) / wsum
    # dispersion of indicators around the mean, combined with a measurement floor
    sd = math.sqrt(var + floor ** 2)
    return mean, sd


def evaluate(data: dict[str, Series], params: dict, as_of: date | None = None) -> dict:
    """Compute indicator readings, gaps and the model point. If as_of is given, each
    series is truncated to what would have been published by then (approximate)."""
    inds = build_indicators()
    rows = []
    for ind in inds:
        d = {}
        for sid in ind.series:
            s = data.get(sid, [])
            if as_of is not None:
                s = fred.truncate(s, as_of - timedelta(days=ind.lag_days))
            d[sid] = s
        try:
            val = ind.compute(d)
        except (ZeroDivisionError, KeyError, IndexError):
            val = None
        if val is None or math.isnan(val):
            continue
        gap = ind.to_gap(val, params)
        obs_date = max((d[s][-1][0] for s in ind.series if d[s]), default=None)
        rows.append({
            "id": ind.id, "axis": ind.axis, "label": ind.label, "unit": ind.unit,
            "value": round(val, 3), "gap": round(gap, 3), "weight": ind.weight,
            "observation_date": obs_date.isoformat() if obs_date else None,
            "series": ind.series, "note": ind.note,
            "supports": _supports(ind.axis, gap),
        })
    floor = params.get("min_sigma", 0.25)
    out = {"indicators": rows}
    for axis in ("growth", "inflation"):
        pairs = [(r["gap"], r["weight"]) for r in rows if r["axis"] == axis]
        if not pairs:
            raise RuntimeError(f"no {axis} indicators available")
        m, sd = _weighted_mean_sd(pairs, floor)
        out[axis] = {"mean": round(m, 3), "sd": round(sd, 3)}
    return out


def _supports(axis: str, gap: float, band: float = 0.25) -> str:
    if axis == "growth":
        return "above_trend" if gap > band else "below_trend" if gap < -band else "neutral"
    return "above_target" if gap > band else "below_target" if gap < -band else "neutral"


# --------------------------------------------------------------------------- quadrants

QUADRANTS = {
    "goldilocks": "Goldilocks (growth above trend, inflation below target)",
    "overheating": "Overheating / Reflation (growth above trend, inflation above target)",
    "stagflation": "Stagflation (growth below trend, inflation above target)",
    "slowdown": "Disinflationary slowdown (growth below trend, inflation below target)",
}


def quadrant_of(x: float, y: float) -> str:
    if x >= 0:
        return "overheating" if y >= 0 else "goldilocks"
    return "stagflation" if y >= 0 else "slowdown"


def mixture(components: list[dict], draws: int, seed: int = 7) -> dict:
    """components: [{x, sx, y, sy, w}]. Returns mixture mean/sd and quadrant probabilities
    estimated by Monte Carlo (axes treated as independent within a component)."""
    comps = [c for c in components if c["w"] > 0]
    wsum = sum(c["w"] for c in comps)
    if not comps:
        return {}
    # closed-form mixture moments
    mx = sum(c["w"] * c["x"] for c in comps) / wsum
    my = sum(c["w"] * c["y"] for c in comps) / wsum
    vx = sum(c["w"] * (c["sx"] ** 2 + (c["x"] - mx) ** 2) for c in comps) / wsum
    vy = sum(c["w"] * (c["y"] ** 2 + c["sy"] ** 2) for c in comps) / wsum - my ** 2
    rng = random.Random(seed)
    cum, acc = [], 0.0
    for c in comps:
        acc += c["w"] / wsum
        cum.append(acc)
    counts = dict.fromkeys(QUADRANTS, 0)
    for _ in range(draws):
        u = rng.random()
        c = comps[next((i for i, t in enumerate(cum) if u <= t), len(comps) - 1)]
        counts[quadrant_of(rng.gauss(c["x"], c["sx"]), rng.gauss(c["y"], c["sy"]))] += 1
    return {
        "x": round(mx, 3), "sx": round(math.sqrt(max(vx, 0)), 3),
        "y": round(my, 3), "sy": round(math.sqrt(max(vy, 0)), 3),
        "probabilities": {k: round(v / draws, 3) for k, v in counts.items()},
    }
