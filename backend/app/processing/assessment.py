"""The multi-test trend assessment (``trend_significance.assess_trend``) shaped for the API, in English."""

from __future__ import annotations

import math

from app.processing.trend_significance import Report
from app.schemas.analysis import TestRow, TrendAssessment

TEST_NAMES = {
    "OLS t-тест (класичний)": "OLS t-test",
    "OLS + HAC (Newey-West)": "OLS + HAC (Newey-West)",
    "Регресія з AR(1)-помилками (Wald)": "Regression with AR(1) errors",
    "Манн-Кендалл + Theil-Sen (наївний)": "Mann-Kendall + Theil-Sen",
    "Манн-Кендалл TFPW (Yue-Pilon)": "Mann-Kendall TFPW",
    "Манн-Кендалл Hamed-Rao": "Mann-Kendall Hamed-Rao",
    "Spearman ρ (час)": "Spearman ρ",
    "Дрейф на перших різницях (HAC)": "Drift of first differences",
    "Блоковий bootstrap (нахил OLS)": "Block bootstrap, OLS slope",
    "Блоковий bootstrap (нахил Theil-Sen)": "Block bootstrap, Theil-Sen slope",
    "Сурогати AR(1) (H0: шум без тренду)": "AR(1) surrogates",
    "Фазові сурогати (зберігають спектр)": "Phase surrogates",
    "Тренд етапу 2: сурогати AR(1)": "Two-stage trend, AR(1) surrogates",
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
