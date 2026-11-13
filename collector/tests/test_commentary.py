"""Exercises the Claude request loop with a fake client (no network, no API key)."""
import json
from datetime import date
from types import SimpleNamespace as NS

import pytest

from giq import commentary

RAW = {
    "found": True, "published": "2026-11-01", "title": "T", "url": "https://example.com/x",
    "growth_gap": 0.4, "growth_sd": 0.3, "inflation_gap": 0.9, "inflation_sd": 0.3,
    "direction_growth": -0.2, "direction_inflation": -0.4, "quadrant_call": "overheating",
    "summary": "s", "key_points": ["a"], "forecast_numbers": [], "quotes": [], "confidence": "high",
    "scoring_rationale": "r",
}


class FakeMessages:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def create(self, **kw):
        self.calls.append(kw)
        return self.responses.pop(0)


def fake_client(*responses):
    msgs = FakeMessages(responses)
    return NS(beta=NS(messages=msgs)), msgs


def resp(stop, *blocks, details=None):
    return NS(stop_reason=stop, content=list(blocks), stop_details=details)


def text(t):
    return NS(type="text", text=t)


def test_resumes_pause_turn_then_parses_json():
    client, msgs = fake_client(
        resp("pause_turn", NS(type="server_tool_use")),
        resp("end_turn", text("Here is the result"), text(json.dumps(RAW))),
    )
    src = {"id": "usbank", "name": "U.S. Bank", "type": "sell_side", "hints": [], "domains": []}
    v = commentary.score_source(src, {"trend_growth": 2.0, "inflation_target": 2.0},
                                {"model": "claude-opus-5-5", "effort": "high"}, date(2026, 11, 13), client)
    assert (v["x"], v["y"], v["method"]) == (0.4, 0.9, "llm:claude-opus-5-5")
    assert len(msgs.calls) == 2
    first = msgs.calls[0]
    assert first["model"] == "claude-opus-5-5"
    assert first["fallbacks"] == "default" and commentary.FALLBACK_BETA in first["betas"]
    assert first["output_config"]["format"]["type"] == "json_schema"
    assert {t["name"] for t in first["tools"]} == {"web_search", "web_fetch"}
    # the paused assistant turn is sent back unchanged
    assert msgs.calls[1]["messages"][-1]["role"] == "assistant"


def test_refusal_raises():
    client, _ = fake_client(resp("refusal", details=NS(category="cyber")))
    with pytest.raises(RuntimeError, match="declined"):
        commentary._run(client, model="m", effort="high", system="s", prompt="p", schema={})
