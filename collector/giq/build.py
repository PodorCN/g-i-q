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


# ----------------------------------------------------------------------------- synthesis


def template_synthesis(snap: dict) -> dict:
    """Deterministic fallback when the LLM is not available."""
    m, b = snap["model"], snap["blend"]
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
    return {
        "headline": f"{name(top)} is the most likely regime ({probs[top]:.0%} blended probability)",
        "regime_call": top,
        "data_supports": (
            f"Hard data place the economy in {name(mq)}: growth gap {m['growth']['mean']:+.2f}pp "
            f"(±{m['growth']['sd']:.2f}), inflation gap {m['inflation']['mean']:+.2f}pp "
            f"(±{m['inflation']['sd']:.2f}). {up_g} of {len(g)} growth indicators are above trend and "
            f"{dn_g} below; {up_p} of {len(p)} inflation indicators are above target and {dn_p} below."
        ),
        "consensus_vs_data": (
            f"The house consensus sits at growth {houses['x']:+.2f}pp / inflation {houses['y']:+.2f}pp "
            f"versus the data model at {m['growth']['mean']:+.2f} / {m['inflation']['mean']:+.2f}."
        ),
        "divergences": [],
        "watch_list": [],
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
    }
    annotate(views, params, today)

    comps = [{"x": v["x"], "sx": v["sx"], "y": v["y"], "sy": v["sy"], "w": v["weight"]} for v in views]
    draws = params["mc_draws"]
    houses = model.mixture(comps, draws) if comps else None
    model_mix = model.mixture([{"x": model_pt["x"], "sx": model_pt["sx"], "y": model_pt["y"],
                                "sy": model_pt["sy"], "w": 1.0}], draws)
    share = params["model_weight_share"] if comps else 1.0
    wsum = sum(c["w"] for c in comps) or 1.0
    blended_comps = [{**c, "w": c["w"] / wsum * (1 - share)} for c in comps] + [
        {"x": model_pt["x"], "sx": model_pt["sx"], "y": model_pt["y"], "sy": model_pt["sy"], "w": share}]
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
