"""Build a quadrant snapshot.

    python -m giq.build                          # FRED + Claude scoring (needs ANTHROPIC_API_KEY)
    python -m giq.build --views data/views/x.json   # FRED + hand-scored views, no LLM
    python -m giq.build --skip-llm               # FRED only; house views carried forward

Writes data/snapshots/<as_of>.json and data/latest.json (paths relative to repo root).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from . import fred, model

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 1
CONF_W = {"high": 1.0, "medium": 0.8, "low": 0.6}


def load_config(path: Path) -> dict:
    return yaml.safe_load(path.read_text())


def fetch_all(cache: Path | None) -> dict[str, fred.Series]:
    out = {}
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(fred.fetch, sid, "2018-01-01", cache): sid for sid in model.ALL_SERIES}
        for fut in cf.as_completed(futs):
            sid = futs[fut]
            try:
                out[sid] = fut.result()
            except Exception as err:  # one missing series should not kill the run
                print(f"[warn] {err}", file=sys.stderr)
                out[sid] = []
    return out


def month_ends(as_of: date, n: int) -> list[date]:
    out, y, m = [], as_of.year, as_of.month
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        out.append(date.fromordinal(nxt.toordinal() - 1))
    return sorted(out)


def model_history(data, params, as_of: date, months: int) -> list[dict]:
    hist = []
    for d in month_ends(as_of, months):
        try:
            ev = model.evaluate(data, params, as_of=d)
        except RuntimeError:
            continue
        hist.append({"as_of": d.isoformat(), "x": ev["growth"]["mean"], "y": ev["inflation"]["mean"],
                     "sx": ev["growth"]["sd"], "sy": ev["inflation"]["sd"]})
    return hist


# ----------------------------------------------------------------------------- views


def load_manual_views(paths: list[Path], sources: dict) -> list[dict]:
    from .commentary import to_view
    views = []
    for p in paths:
        payload = json.loads(p.read_text())
        for raw in payload["views"]:
            src = sources.get(raw["id"]) or {"id": raw["id"], "name": raw.get("name", raw["id"]),
                                             "short": raw.get("short", raw["id"]),
                                             "type": raw.get("type", "buy_side")}
            views.append(to_view(src, raw, method=raw.get("method", payload.get("method", "manual"))))
    return views


def llm_views(cfg: dict, today: date, prev: dict[str, dict]) -> list[dict]:
    from . import commentary
    out = []

    def one(src):
        try:
            return commentary.score_source(src, cfg["params"], cfg["llm"], today)
        except Exception as err:
            print(f"[warn] {src['id']}: {err}", file=sys.stderr)
            if src["id"] in prev:
                return {**prev[src["id"]], "carried_forward": True}
            return None

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for v in pool.map(one, cfg["sources"]):
            if v:
                out.append(v)
    return out


def annotate(views: list[dict], params: dict, today: date) -> None:
    for v in views:
        try:
            age = (today - date.fromisoformat(v["published"])).days
        except (TypeError, ValueError):
            age = None
        v["age_days"] = age
        v["stale"] = age is None or age > params["stale_after_days"]
        w = CONF_W.get(v.get("confidence", "medium"), 0.8)
        if v["stale"]:
            w *= params["stale_weight"]
        v["weight"] = round(w, 3)
        v["quadrant"] = model.quadrant_of(v["x"], v["y"])
        raw_pq = [q for q in (v.get("plausible_quadrants") or []) if q in model.QUADRANTS]
        if v["quadrant"] not in raw_pq:
            raw_pq.insert(0, v["quadrant"])
        v["plausible_quadrants"] = [q for q in model.QUADRANTS if q in raw_pq]


# ----------------------------------------------------------------------------- synthesis


def template_synthesis(snap: dict) -> dict:
    """Deterministic fallback when the LLM is not available."""
    m, b = snap["model"], snap["blend"]
    params = snap.get("params", {})
    trend = params.get("trend_growth", 2.0)
    target = params.get("inflation_target", 2.0)
    g = [r for r in m["indicators"] if r["axis"] == "growth"]
    p = [r for r in m["indicators"] if r["axis"] == "inflation"]
    up_g = sum(r["supports"] == "above_trend" for r in g)
    dn_g = sum(r["supports"] == "below_trend" for r in g)
    up_p = sum(r["supports"] == "above_target" for r in p)
    dn_p = sum(r["supports"] == "below_target" for r in p)
    mq = model.quadrant_of(m["growth"]["mean"], m["inflation"]["mean"])
    probs = b["blended"]["probabilities"]
    top = max(probs, key=probs.get)
    name = lambda q: model.QUADRANTS[q].split(" (")[0]  # noqa: E731
    houses = b["houses"]
    views = snap.get("views", [])
    fresh = [v for v in views if not v.get("stale")]
    stale = [v for v in views if v.get("stale")]
    source_ids = {s["id"] for s in snap.get("sources", [])}
    missing = [s["name"] for s in snap.get("sources", []) if s["id"] not in {v["id"] for v in views}]

    divergences = []
    pool = fresh or views
    if len(pool) >= 2:
        g_lo, g_hi = min(pool, key=lambda v: v["x"]), max(pool, key=lambda v: v["x"])
        if g_hi["x"] - g_lo["x"] >= 0.2:
            divergences.append(
                f"Growth spread (fresh views): {g_lo['name']} ({g_lo['x']:+.2f}pp) vs {g_hi['name']} ({g_hi['x']:+.2f}pp)."
            )
        p_lo, p_hi = min(pool, key=lambda v: v["y"]), max(pool, key=lambda v: v["y"])
        if p_hi["y"] - p_lo["y"] >= 0.2:
            divergences.append(
                f"Inflation spread (fresh views): {p_lo['name']} ({p_lo['y']:+.2f}pp) vs {p_hi['name']} ({p_hi['y']:+.2f}pp)."
            )
    tail_houses = [v["short"] or v["name"] for v in pool if "stagflation" in (v.get("plausible_quadrants") or []) and v["quadrant"] != "stagflation"]
    if tail_houses:
        divergences.append(
            f"Downside growth / stagflation tail risk flagged by: {', '.join(tail_houses)}."
        )
    be = [r for r in p if r["id"] in ("be10", "fwd5y5y")]
    if be and all(r["gap"] <= 0 for r in be) and m["inflation"]["mean"] > 0.4:
        be_str = ", ".join(f"{r['label'].split(' (')[0]} {r['value']:.2f}%" for r in be)
        divergences.append(
            f"Realized vs expectations: core PCE/CPI run >+1.2pp above target, yet market breakevens remain anchored ({be_str})."
        )

    watch_list = []
    if stale:
        watch_list.append(
            f"Stale views (>{params.get('stale_after_days', 60)}d, down-weighted to {params.get('stale_weight', 0.35):.0%}): "
            + ", ".join(f"{v.get('short') or v['name']} ({v.get('published') or 'n.d.'})" for v in stale)
            + "."
        )
    if missing:
        watch_list.append(f"Missing coverage ({len(missing)} of {len(source_ids)} configured sources): {', '.join(missing)}.")
    soft_ind = sorted(m["indicators"], key=lambda r: r["gap"])[:2]
    if soft_ind:
        watch_list.append(
            "Coolest hard-data readings: " + "; ".join(f"{r['label'].split(' (')[0]} ({r['gap']:+.2f}pp)" for r in soft_ind) + "."
        )

    gap_g = houses["x"] - m["growth"]["mean"]
    h_probs = houses["probabilities"]
    h_top = max(h_probs, key=h_probs.get)
    imp_g = trend + houses["x"]
    imp_p = target + houses["y"]
    return {
        "headline": (
            f"{name(h_top)} ({h_probs[h_top]:.0%} house consensus) — implied {imp_g:.1f}% real GDP, {imp_p:.1f}% core PCE"
        ),
        "regime_call": h_top,
        "data_supports": (
            f"Hard data place the economy in {name(mq)}: growth gap {m['growth']['mean']:+.2f}pp "
            f"(~{trend + m['growth']['mean']:.2f}% GDP, ±{m['growth']['sd']:.2f}), inflation gap "
            f"{m['inflation']['mean']:+.2f}pp (~{target + m['inflation']['mean']:.2f}% core PCE, ±{m['inflation']['sd']:.2f}). "
            f"{up_g} of {len(g)} growth indicators are above trend and {dn_g} below; "
            f"{up_p} of {len(p)} inflation indicators are above target and {dn_p} below."
        ),
        "consensus_vs_data": (
            f"House consensus sits at growth {houses['x']:+.2f}pp / inflation {houses['y']:+.2f}pp "
            f"versus hard data at {m['growth']['mean']:+.2f} / {m['inflation']['mean']:+.2f} "
            f"(houses sit {abs(gap_g):.2f}pp {'below' if gap_g < 0 else 'above'} hard data on growth)."
        ),
        "divergences": divergences,
        "watch_list": watch_list,
        "method": "template",
    }


# ----------------------------------------------------------------------------- main


def build(cfg: dict, data: dict, views: list[dict], today: date, backfill_months: int,
          use_llm_synthesis: bool) -> dict:
    params = cfg["params"]
    ev = model.evaluate(data, params)
    hist = model_history(data, params, today, backfill_months)
    # model momentum: change vs. ~3 months ago, scaled so 1pp change -> arrow of length 1
    ref = hist[-4] if len(hist) >= 4 else None
    dx = round(max(-1, min(1, ev["growth"]["mean"] - ref["x"])), 2) if ref else 0
    dy = round(max(-1, min(1, ev["inflation"]["mean"] - ref["y"])), 2) if ref else 0
    model_pt = {
        "id": "data_model", "name": "Hard-data model (FRED)", "short": "Data",
        "x": ev["growth"]["mean"], "sx": ev["growth"]["sd"],
        "y": ev["inflation"]["mean"], "sy": ev["inflation"]["sd"],
        "dx": dx, "dy": dy, "quadrant": model.quadrant_of(ev["growth"]["mean"], ev["inflation"]["mean"]),
        "plausible_quadrants": ev["plausible_quadrants"],
    }
    annotate(views, params, today)

    comps = [{"x": v["x"], "sx": v["sx"], "y": v["y"], "sy": v["sy"], "w": v["weight"],
              "plausible_quadrants": v["plausible_quadrants"]} for v in views]
    draws = params["mc_draws"]
    houses = model.mixture(comps, draws) if comps else None
    model_comp = {"x": model_pt["x"], "sx": model_pt["sx"], "y": model_pt["y"],
                  "sy": model_pt["sy"], "w": 1.0,
                  "plausible_quadrants": model_pt["plausible_quadrants"]}
    model_mix = model.mixture([model_comp], draws)
    share = params["model_weight_share"] if comps else 1.0
    wsum = sum(c["w"] for c in comps) or 1.0
    blended_comps = [{**c, "w": c["w"] / wsum * (1 - share)} for c in comps] + [
        {**model_comp, "w": share}]
    blended = model.mixture(blended_comps, draws)

    snap = {
        "schema_version": SCHEMA_VERSION,
        "as_of": today.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params": params,
        "quadrants": model.QUADRANTS,
        "model": {**ev, "point": model_pt, "history": hist,
                  "caveat": "History uses current-vintage FRED data with approximate publication lags, "
                            "not true real-time vintages."},
        "views": views,
        "blend": {"houses": houses or model_mix, "model": model_mix, "blended": blended,
                  "model_weight_share": share},
        "sources": [{"id": s["id"], "name": s["name"], "short": s.get("short"), "type": s["type"]}
                    for s in cfg["sources"]],
    }
    synth = None
    if use_llm_synthesis:
        from . import commentary
        try:
            synth = {**commentary.synthesize(snap, cfg["llm"]), "method": f"llm:{cfg['llm']['model']}"}
        except Exception as err:
            print(f"[warn] synthesis failed: {err}", file=sys.stderr)
    snap["synthesis"] = synth or template_synthesis(snap)
    return snap


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=ROOT / "collector" / "config.yaml")
    ap.add_argument("--views", type=Path, nargs="*", default=[], help="hand-scored view JSON file(s)")
    ap.add_argument("--synthesis", type=Path, help="hand-written synthesis JSON (overrides template)")
    ap.add_argument("--skip-llm", action="store_true", help="never call Claude")
    ap.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    ap.add_argument("--backfill-months", type=int, default=18)
    ap.add_argument("--fred-cache", type=Path, help="cache raw FRED CSVs here")
    ap.add_argument("--out-dir", type=Path, default=ROOT / "data")
    args = ap.parse_args(argv)

    from .commentary import api_available
    cfg = load_config(args.config)
    sources = {s["id"]: s for s in cfg["sources"]}
    latest_path = args.out_dir / "latest.json"
    prev = {}
    if latest_path.exists():
        prev = {v["id"]: v for v in json.loads(latest_path.read_text()).get("views", [])}

    data = fetch_all(args.fred_cache)
    use_llm = not args.skip_llm and api_available()
    if args.views:
        views = load_manual_views(args.views, sources)
    elif use_llm:
        views = llm_views(cfg, args.as_of, prev)
    else:
        print("[info] no views file and no LLM: carrying forward previous views", file=sys.stderr)
        views = [{**v, "carried_forward": True} for v in prev.values()]

    snap = build(cfg, data, views, args.as_of, args.backfill_months,
                 use_llm_synthesis=use_llm and not args.synthesis)
    if args.synthesis:
        snap["synthesis"] = {**json.loads(args.synthesis.read_text()), "method": "manual"}

    out = json.dumps(snap, indent=1, ensure_ascii=False)
    (args.out_dir / "snapshots").mkdir(parents=True, exist_ok=True)
    (args.out_dir / "snapshots" / f"{snap['as_of']}.json").write_text(out)
    latest_path.write_text(out)
    b = snap["blend"]["blended"]
    print(f"as_of={snap['as_of']} views={len(views)} model=({snap['model']['point']['x']:+.2f},"
          f"{snap['model']['point']['y']:+.2f}) blended=({b['x']:+.2f},{b['y']:+.2f}) "
          f"probs={b['probabilities']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
