"""Collect and score market commentary with Claude (web search + structured output).

For each house in config.yaml, Claude searches the web for that house's most
recent macro commentary, reads it, and scores it onto the growth/inflation plane
with an explicit rubric. A second call writes the synthesis ("what the data
supports") from the hard-data model plus all house views.
"""
from __future__ import annotations

import json
import os
from datetime import date

import anthropic

FALLBACK_BETA = "server-side-fallback-2026-07-01"

RUBRIC = """\
Coordinate system (percentage points, "pp"), horizon = next 6-12 months, United States:
  growth_gap    = expected real GDP growth - {trend:.1f}% (trend growth)
  inflation_gap = expected core PCE inflation - {target:.1f}% (Fed target)

Scoring rubric:
- Explicit GDP forecast for the next 4 quarters -> growth_gap = forecast - {trend:.1f}.
  If several horizons are given, weight the next 2-4 quarters most.
- Explicit core PCE forecast -> inflation_gap = forecast - {target:.1f}.
  A CPI forecast is converted to PCE by subtracting 0.4pp. Headline forecasts driven by
  energy should be tilted toward the house's core view.
- Qualitative only: recession -2.0; clear below-trend slowdown -0.75; around trend 0;
  resilient / above trend +0.5 to +1.0; boom +1.5. Inflation: deflation risk -1.0;
  at target 0; moderating toward target +0.5; sticky/persistent above target +1.0;
  re-accelerating +1.5.
- sd (1-sigma, pp): 0.3 for explicit point forecasts, 0.5 for ranges or mixed signals,
  0.8 for qualitative-only views; add 0.2 if the house stresses two-sided/tail risks.
- direction: expected change in each gap over the horizon, from -1 (falling fast) to +1.
- Use the house's own words; do not import other houses' numbers.
"""

VIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "published": {"type": "string", "description": "YYYY-MM-DD of the commentary"},
        "title": {"type": "string"},
        "url": {"type": "string"},
        "growth_gap": {"type": "number"},
        "growth_sd": {"type": "number"},
        "inflation_gap": {"type": "number"},
        "inflation_sd": {"type": "number"},
        "direction_growth": {"type": "number"},
        "direction_inflation": {"type": "number"},
        "quadrant_call": {"type": "string",
                          "enum": ["goldilocks", "overheating", "stagflation", "slowdown"]},
        "summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "forecast_numbers": {"type": "array", "items": {
            "type": "object",
            "properties": {"metric": {"type": "string"}, "value": {"type": "string"},
                           "period": {"type": "string"}},
            "required": ["metric", "value", "period"], "additionalProperties": False}},
        "quotes": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "scoring_rationale": {"type": "string"},
    },
    "required": ["found", "published", "title", "url", "growth_gap", "growth_sd",
                 "inflation_gap", "inflation_sd", "direction_growth", "direction_inflation",
                 "quadrant_call", "summary", "key_points", "forecast_numbers", "quotes",
                 "confidence", "scoring_rationale"],
    "additionalProperties": False,
}

SYNTH_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "regime_call": {"type": "string",
                        "enum": ["goldilocks", "overheating", "stagflation", "slowdown"]},
        "data_supports": {"type": "string"},
        "consensus_vs_data": {"type": "string"},
        "divergences": {"type": "array", "items": {"type": "string"}},
        "watch_list": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "regime_call", "data_supports", "consensus_vs_data",
                 "divergences", "watch_list"],
    "additionalProperties": False,
}


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(max_retries=4)


def _run(client: anthropic.Anthropic, *, model: str, effort: str, system: str, prompt: str,
         schema: dict, tools: list[dict] | None = None) -> dict:
    """One structured-output request, resuming server-tool pauses, with refusal fallback."""
    messages: list[dict] = [{"role": "user", "content": prompt}]
    for _ in range(8):
        resp = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            system=system,
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            tools=tools or [],
            messages=messages,
        )
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        if resp.stop_reason == "refusal":
            cat = resp.stop_details.category if resp.stop_details else None
            raise RuntimeError(f"model declined (category={cat})")
        if resp.stop_reason == "max_tokens":
            raise RuntimeError("response truncated at max_tokens")
        texts = [b.text for b in resp.content if b.type == "text"]
        for candidate in (texts[-1] if texts else "", "".join(texts)):
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
        raise RuntimeError("no JSON in response")
    raise RuntimeError("too many pause_turn continuations")


def score_source(src: dict, params: dict, llm: dict, today: date,
                 client: anthropic.Anthropic | None = None) -> dict:
    client = client or _client()
    rubric = RUBRIC.format(trend=params["trend_growth"], target=params["inflation_target"])
    system = (
        "You are a macro research analyst maintaining a growth/inflation quadrant tracker. "
        "You research one institution's latest published US macro view and score it with "
        "the rubric exactly. Prefer primary sources (the institution's own site) over press "
        "coverage. If nothing from the last 90 days can be found, set found=false and use "
        "your best reading of the most recent view you did find, with a wider sd.\n\n" + rubric
    )
    prompt = (
        f"Today is {today.isoformat()}.\n"
        f"Institution: {src['name']}\n"
        f"Where to look first: {', '.join(src.get('hints', []))}\n"
        f"Primary domains: {', '.join(src.get('domains', []))}\n\n"
        "Find this institution's most recent commentary on the US growth and inflation outlook "
        "(economic outlook, weekly commentary, speech, forecast update). Read it, extract any "
        "explicit forecast numbers, short verbatim quotes, and score it."
    )
    n = int(llm.get("max_searches_per_source", 6))
    tools = [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": n},
        {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": n},
    ]
    raw = _run(client, model=llm["model"], effort=llm.get("effort", "high"),
               system=system, prompt=prompt, schema=VIEW_SCHEMA, tools=tools)
    return to_view(src, raw, method=f"llm:{llm['model']}")


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def to_view(src: dict, raw: dict, method: str) -> dict:
    """Normalise a raw scored record into the snapshot `views[]` shape."""
    return {
        "id": src["id"],
        "name": src["name"],
        "short": src.get("short", src["name"]),
        "type": src["type"],
        "published": raw.get("published"),
        "title": raw.get("title", ""),
        "url": raw.get("url", ""),
        "x": round(_clamp(raw["growth_gap"], -4, 4), 2),
        "sx": round(_clamp(raw["growth_sd"], 0.15, 2.0), 2),
        "y": round(_clamp(raw["inflation_gap"], -3, 5), 2),
        "sy": round(_clamp(raw["inflation_sd"], 0.15, 2.0), 2),
        "dx": round(_clamp(raw.get("direction_growth", 0), -1, 1), 2),
        "dy": round(_clamp(raw.get("direction_inflation", 0), -1, 1), 2),
        "quadrant_call": raw.get("quadrant_call"),
        "summary": raw.get("summary", ""),
        "key_points": raw.get("key_points", [])[:6],
        "forecast_numbers": raw.get("forecast_numbers", [])[:8],
        "quotes": raw.get("quotes", [])[:4],
        "confidence": raw.get("confidence", "medium"),
        "scoring_rationale": raw.get("scoring_rationale", ""),
        "found_recent": bool(raw.get("found", True)),
        "method": method,
    }


def synthesize(snapshot: dict, llm: dict, client: anthropic.Anthropic | None = None) -> dict:
    client = client or _client()
    slim = {
        "as_of": snapshot["as_of"],
        "params": snapshot["params"],
        "model": {k: snapshot["model"][k] for k in ("growth", "inflation")},
        "indicators": [{k: r[k] for k in ("label", "value", "gap", "supports", "observation_date")}
                       for r in snapshot["model"]["indicators"]],
        "views": [{k: v[k] for k in ("name", "published", "x", "y", "sx", "sy", "summary", "stale")}
                  for v in snapshot["views"]],
        "blend": snapshot["blend"],
    }
    system = ("You are a macro strategist. Write tight, specific prose with numbers. "
              "Distinguish what the hard data supports from what houses forecast. No hype.")
    prompt = ("Here is this week's growth/inflation quadrant snapshot as JSON. Write: a one-line "
              "headline; the regime call; 'data_supports' (3-5 sentences on which quadrant the "
              "hard data supports and why, citing indicators); 'consensus_vs_data' (2-3 sentences); "
              "the main divergences between houses; and a watch list of upcoming data/events.\n\n"
              + json.dumps(slim, indent=1))
    return _run(client, model=llm["model"], effort=llm.get("effort", "high"),
                system=system, prompt=prompt, schema=SYNTH_SCHEMA)


def api_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
