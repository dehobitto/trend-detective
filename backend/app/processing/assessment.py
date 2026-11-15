"""Trend assessment (``trend_significance.assess_trend``) shaped for the API, in English."""

from __future__ import annotations

import math

from app.processing.trend_significance import Report
from app.schemas.analysis import TestRow, TrendAssessment

TEST_NAMES = {
    "Манн-Кендалл TFPW (Yue-Pilon)": "Mann-Kendall TFPW",
}


def _num(x) -> float | None:
    return float(x) if x is not None and isinstance(x, (int, float)) and math.isfinite(x) else None


def to_assessment(report: Report) -> TrendAssessment:
    tests = [
        TestRow(
            name=TEST_NAMES.get(t["name"], t["name"]),
            estimate=_num(t.get("estimate")),
            p_value=_num(t.get("p_value")),
            direction=t.get("direction") if t.get("direction") in ("up", "down", "none") else None,
            significant=t.get("significant"),
            voting=bool(t.get("voting", True)),
        )
        for t in report.tests
        if t.get("applicable", True)
    ]
    voting = [t for t in tests if t.voting]
    s = report.sensitivity or {}
    return TrendAssessment(
        verdict=report.verdict,
        confidence=report.confidence,
        tests_significant=sum(1 for t in voting if t.significant),
        tests_voting=len(voting),
        robust_same_sign=_num(s.get("share_same_sign")),
        robust_significant=_num(s.get("share_significant")),
        tests=tests,
    )
