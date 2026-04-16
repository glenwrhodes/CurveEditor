"""Test curve_eval against shared test fixtures."""

import json
import math
import os
from pathlib import Path

import pytest

from curve_eval import evaluate, evaluate_all, evaluate_state, get_curve_names, get_curve_time_range

FIXTURES_DIR = Path(__file__).parent.parent.parent.parent / "test-fixtures"
CURVE_FILE = json.loads((FIXTURES_DIR / "test_curves.curve.json").read_text())
EXPECTED = json.loads((FIXTURES_DIR / "expected_results.json").read_text())


class TestGetCurveNames:
    def test_returns_all_names(self) -> None:
        names = get_curve_names(CURVE_FILE)
        assert "singleFloat" in names
        assert "linearPair" in names
        assert "trafficLight" in names
        assert "empty" in names


class TestGetCurveTimeRange:
    def test_returns_range(self) -> None:
        r = get_curve_time_range(CURVE_FILE, "linearPair")
        assert r == {"start": 0.0, "end": 1.0}

    def test_empty_returns_none(self) -> None:
        assert get_curve_time_range(CURVE_FILE, "empty") is None


class TestSharedFixtures:
    @pytest.mark.parametrize(
        "test_case", EXPECTED["tests"], ids=[t["name"] for t in EXPECTED["tests"]]
    )
    def test_fixture(self, test_case: dict) -> None:
        opts: dict = {}
        if test_case.get("normalized"):
            opts["normalized"] = True

        if "expected_state" in test_case:
            result = evaluate_state(CURVE_FILE, test_case["curve"], test_case["time"], **opts)
            assert result is not None
            assert result["index"] == test_case["expected_state"]["index"]
            if test_case["expected_state"].get("label"):
                assert result["label"] == test_case["expected_state"]["label"]

        elif "expected_vec" in test_case:
            result = evaluate(CURVE_FILE, test_case["curve"], test_case["time"], **opts)
            assert result is not None
            tol = test_case.get("tolerance", 1e-6)
            assert isinstance(result, tuple)
            for i, expected_val in enumerate(test_case["expected_vec"]):
                assert abs(result[i] - expected_val) < tol, (
                    f"Component {i}: {result[i]} != {expected_val}"
                )

        elif "expected_color" in test_case:
            result = evaluate(CURVE_FILE, test_case["curve"], test_case["time"], **opts)
            assert result is not None
            assert isinstance(result, dict)
            tol = test_case.get("tolerance", 1e-6)
            for key in ("r", "g", "b", "a"):
                assert abs(result[key] - test_case["expected_color"][key]) < tol, (
                    f"{key}: {result[key]} != {test_case['expected_color'][key]}"
                )

        elif test_case.get("expected") is None:
            result = evaluate(CURVE_FILE, test_case["curve"], test_case["time"], **opts)
            assert result is None

        else:
            result = evaluate(CURVE_FILE, test_case["curve"], test_case["time"], **opts)
            tol = test_case.get("tolerance", 1e-6)
            assert isinstance(result, (int, float))
            assert abs(result - test_case["expected"]) < tol, (
                f"{result} != {test_case['expected']}"
            )


class TestEvaluateAll:
    def test_evaluates_all(self) -> None:
        result = evaluate_all(CURVE_FILE, 0.5)
        assert "singleFloat" in result
        assert "linearPair" in result
        assert isinstance(result["linearPair"], float)
        assert abs(result["linearPair"] - 0.5) < 1e-6
