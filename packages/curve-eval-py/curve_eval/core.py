"""
Curve evaluation library for .curve.json files.
Zero dependencies — stdlib math only.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple, Union

CurveFile = Dict[str, Any]
CurveDefinition = Dict[str, Any]
KeyFrame = Dict[str, Any]
TangentHandle = Dict[str, float]

# Type aliases for return values
FloatResult = float
IntResult = int
VecResult = Tuple[float, ...]
ColorResult = Dict[str, float]
StateResult = Dict[str, Any]
EvalResult = Union[float, int, Tuple[float, ...], Dict[str, float], None]


def evaluate(
    curve_file: CurveFile,
    curve_name: str,
    time: float,
    *,
    normalized: bool = False,
) -> EvalResult:
    """Evaluate a curve at the given time."""
    curve = _find_curve(curve_file, curve_name)
    if curve is None:
        return None
    keys: List[KeyFrame] = curve.get("keys", [])
    if len(keys) == 0:
        return None

    t = _resolve_time(curve, time, normalized)
    t = _remap_infinity(curve, t)
    curve_type: str = curve["type"]

    if curve_type == "float":
        return _evaluate_scalar(keys, t)
    elif curve_type == "int":
        if curve.get("states"):
            return _evaluate_constant_int(keys, t)
        return _evaluate_int(keys, t)
    elif curve_type in ("vec2", "vec3", "vec4"):
        count = _component_count(curve_type)
        return tuple(_evaluate_scalar(keys, t, comp) for comp in range(count))
    elif curve_type == "color":
        components = [
            max(0.0, min(1.0, _evaluate_scalar(keys, t, comp)))
            for comp in range(4)
        ]
        return {"r": components[0], "g": components[1], "b": components[2], "a": components[3]}
    return None


def evaluate_all(
    curve_file: CurveFile,
    time: float,
    *,
    normalized: bool = False,
) -> Dict[str, EvalResult]:
    """Evaluate all curves in a file at the given time."""
    result: Dict[str, EvalResult] = {}
    for curve in curve_file.get("curves", []):
        result[curve["name"]] = evaluate(curve_file, curve["name"], time, normalized=normalized)
    return result


def evaluate_state(
    curve_file: CurveFile,
    curve_name: str,
    time: float,
    *,
    normalized: bool = False,
) -> Optional[StateResult]:
    """Evaluate a state curve, returning index and optional label."""
    curve = _find_curve(curve_file, curve_name)
    if curve is None or curve["type"] != "int" or not curve.get("states"):
        return None
    keys: List[KeyFrame] = curve.get("keys", [])
    if len(keys) == 0:
        return None

    t = _resolve_time(curve, time, normalized)
    t = _remap_infinity(curve, t)
    index = _evaluate_constant_int(keys, t)
    labels = curve["states"].get("labels")
    label = labels[index] if labels and index < len(labels) else None
    return {"index": index, "label": label}


def get_curve_names(curve_file: CurveFile) -> List[str]:
    """Return list of curve names in the file."""
    return [c["name"] for c in curve_file.get("curves", [])]


def get_curve_time_range(
    curve_file: CurveFile,
    curve_name: str,
) -> Optional[Dict[str, float]]:
    """Return the time range (start, end) of a curve's keys."""
    curve = _find_curve(curve_file, curve_name)
    if curve is None:
        return None
    keys: List[KeyFrame] = curve.get("keys", [])
    if len(keys) == 0:
        return None
    return {"start": keys[0]["time"], "end": keys[-1]["time"]}


# ── Internal helpers ──

def _find_curve(file: CurveFile, name: str) -> Optional[CurveDefinition]:
    for c in file.get("curves", []):
        if c["name"] == name:
            return c
    return None


def _resolve_time(curve: CurveDefinition, time: float, normalized: bool) -> float:
    if normalized:
        keys = curve.get("keys", [])
        if len(keys) >= 2:
            first = keys[0]["time"]
            last = keys[-1]["time"]
            return first + time * (last - first)
    return time


def _component_count(curve_type: str) -> int:
    return {"vec2": 2, "vec3": 3, "vec4": 4, "color": 4}.get(curve_type, 1)


def _get_scalar(value: Any, component: Optional[int] = None) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if component is not None:
        return float(value[component]) if component < len(value) else 0.0
    return float(value[0]) if len(value) > 0 else 0.0


def _get_tangent(key: KeyFrame, which: str, component: Optional[int] = None) -> TangentHandle:
    field = "tangentIn" if which == "in" else "tangentOut"
    raw = key.get(field)
    default_dx = -0.1 if which == "in" else 0.1
    if raw is None:
        return {"dx": default_dx, "dy": 0.0}
    if isinstance(raw, list):
        idx = component if component is not None else 0
        if idx < len(raw):
            return raw[idx]
        return {"dx": default_dx, "dy": 0.0}
    return raw


def _compute_auto_tangents(
    keys: List[KeyFrame], i: int, component: Optional[int] = None
) -> Tuple[TangentHandle, TangentHandle]:
    key = keys[i]
    value = _get_scalar(key["value"], component)
    has_prev = i > 0
    has_next = i < len(keys) - 1

    if not has_prev and not has_next:
        return ({"dx": -0.1, "dy": 0.0}, {"dx": 0.1, "dy": 0.0})

    if not has_prev:
        nxt = keys[i + 1]
        nxt_val = _get_scalar(nxt["value"], component)
        slope = (nxt_val - value) / (nxt["time"] - key["time"])
        dx = (nxt["time"] - key["time"]) / 3.0
        return ({"dx": -dx, "dy": -slope * dx}, {"dx": dx, "dy": slope * dx})

    if not has_next:
        prev = keys[i - 1]
        prev_val = _get_scalar(prev["value"], component)
        slope = (value - prev_val) / (key["time"] - prev["time"])
        dx = (key["time"] - prev["time"]) / 3.0
        return ({"dx": -dx, "dy": -slope * dx}, {"dx": dx, "dy": slope * dx})

    prev = keys[i - 1]
    nxt = keys[i + 1]
    prev_val = _get_scalar(prev["value"], component)
    nxt_val = _get_scalar(nxt["value"], component)
    slope = (nxt_val - prev_val) / (nxt["time"] - prev["time"])
    dx_out = (nxt["time"] - key["time"]) / 3.0
    dx_in = -(key["time"] - prev["time"]) / 3.0
    return (
        {"dx": dx_in, "dy": slope * dx_in},
        {"dx": dx_out, "dy": slope * dx_out},
    )


def _get_effective_tangent(
    keys: List[KeyFrame], i: int, which: str, component: Optional[int] = None
) -> TangentHandle:
    key = keys[i]
    mode = _get_effective_tangent_mode(key, component)
    if mode == "auto" or (
        key.get("tangentIn") is None and key.get("tangentOut") is None
    ):
        tin, tout = _compute_auto_tangents(keys, i, component)
        return tin if which == "in" else tout
    return _get_tangent(key, which, component)


def _get_effective_interp(key: KeyFrame, component: Optional[int] = None) -> str:
    """Resolve effective interpolation mode, honoring per-component overrides."""
    comp_interp = key.get("componentInterp")
    if component is not None and comp_interp and component < len(comp_interp):
        override = comp_interp[component]
        if override:
            return str(override)
    return str(key.get("interp", "linear"))


def _get_effective_tangent_mode(key: KeyFrame, component: Optional[int] = None) -> str:
    """Resolve effective tangent mode, honoring per-component overrides."""
    comp_mode = key.get("componentTangentMode")
    if component is not None and comp_mode and component < len(comp_mode):
        override = comp_mode[component]
        if override:
            return str(override)
    return str(key.get("tangentMode", "auto"))


# ── Bezier Math ──

def _cubic_bezier(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
    mt = 1.0 - t
    return mt * mt * mt * p0 + 3.0 * mt * mt * t * p1 + 3.0 * mt * t * t * p2 + t * t * t * p3


def _cubic_bezier_deriv(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
    mt = 1.0 - t
    return 3.0 * mt * mt * (p1 - p0) + 6.0 * mt * t * (p2 - p1) + 3.0 * t * t * (p3 - p2)


def _solve_bezier_t(x: float, x0: float, x1: float, x2: float, x3: float) -> float:
    if x <= x0:
        return 0.0
    if x >= x3:
        return 1.0

    t = (x - x0) / (x3 - x0)

    # Newton-Raphson
    for _ in range(8):
        cx = _cubic_bezier(t, x0, x1, x2, x3)
        err = cx - x
        if abs(err) < 1e-7:
            return t
        dx = _cubic_bezier_deriv(t, x0, x1, x2, x3)
        if abs(dx) < 1e-10:
            break
        t -= err / dx
        t = max(0.0, min(1.0, t))

    # Bisection fallback
    lo, hi = 0.0, 1.0
    t = 0.5
    for _ in range(20):
        cx = _cubic_bezier(t, x0, x1, x2, x3)
        if abs(cx - x) < 1e-7:
            return t
        if cx < x:
            lo = t
        else:
            hi = t
        t = (lo + hi) / 2.0

    return t


# ── Evaluation ──

def _evaluate_scalar(
    keys: List[KeyFrame], time: float, component: Optional[int] = None
) -> float:
    if len(keys) == 0:
        return 0.0
    if len(keys) == 1:
        return _get_scalar(keys[0]["value"], component)

    if time <= keys[0]["time"]:
        return _get_scalar(keys[0]["value"], component)
    if time >= keys[-1]["time"]:
        return _get_scalar(keys[-1]["value"], component)

    idx = 0
    for i in range(len(keys) - 1):
        if keys[i]["time"] <= time <= keys[i + 1]["time"]:
            idx = i
            break

    k0 = keys[idx]
    k1 = keys[idx + 1]
    v0 = _get_scalar(k0["value"], component)
    v1 = _get_scalar(k1["value"], component)
    # Use effective interp so vec/color components can have independent modes
    interp = _get_effective_interp(k0, component)

    if interp == "constant":
        return v0

    if interp == "linear":
        t = (time - k0["time"]) / (k1["time"] - k0["time"])
        return v0 + (v1 - v0) * t

    # Bezier
    tan_out = _get_effective_tangent(keys, idx, "out", component)
    tan_in = _get_effective_tangent(keys, idx + 1, "in", component)

    px0 = k0["time"]
    py0 = v0
    px1 = k0["time"] + tan_out["dx"]
    py1 = v0 + tan_out["dy"]
    px2 = k1["time"] + tan_in["dx"]
    py2 = v1 + tan_in["dy"]
    px3 = k1["time"]
    py3 = v1

    t = _solve_bezier_t(time, px0, px1, px2, px3)
    return _cubic_bezier(t, py0, py1, py2, py3)


def _evaluate_int(keys: List[KeyFrame], time: float) -> int:
    if len(keys) == 0:
        return 0
    if len(keys) == 1:
        return round(keys[0]["value"])

    if time <= keys[0]["time"]:
        return round(keys[0]["value"])
    if time >= keys[-1]["time"]:
        return round(keys[-1]["value"])

    idx = 0
    for i in range(len(keys) - 1):
        if keys[i]["time"] <= time <= keys[i + 1]["time"]:
            idx = i
            break

    k0 = keys[idx]
    k1 = keys[idx + 1]
    v0 = k0["value"]
    v1 = k1["value"]
    interp = k0.get("interp", "constant")

    if interp == "constant":
        return int(v0)
    if interp == "linear":
        t = (time - k0["time"]) / (k1["time"] - k0["time"])
        return round(v0 + (v1 - v0) * t)
    return round(v0)


def _evaluate_constant_int(keys: List[KeyFrame], time: float) -> int:
    if len(keys) == 0:
        return 0
    if time <= keys[0]["time"]:
        return int(keys[0]["value"])
    for i in range(len(keys) - 1, -1, -1):
        if time >= keys[i]["time"]:
            return int(keys[i]["value"])
    return int(keys[0]["value"])


# ── Infinity Remapping ──

def _remap_infinity(curve: CurveDefinition, time: float) -> float:
    keys = curve.get("keys", [])
    if len(keys) < 2:
        return time

    first = keys[0]["time"]
    last = keys[-1]["time"]
    rng = last - first
    if rng <= 0:
        return time

    if time < first:
        mode = curve.get("preInfinity", "constant")
        return _apply_infinity_mode(mode, time, first, last, rng, is_pre=True)

    if time > last:
        mode = curve.get("postInfinity", "constant")
        return _apply_infinity_mode(mode, time, first, last, rng, is_pre=False)

    return time


def _apply_infinity_mode(
    mode: str, time: float, first: float, last: float, rng: float, is_pre: bool
) -> float:
    if mode == "constant":
        return first if is_pre else last

    if mode == "linear":
        return time

    if mode == "cycle":
        offset = time - first
        mod = ((offset % rng) + rng) % rng
        return first + mod

    if mode == "oscillate":
        offset = time - first
        period = 2.0 * rng
        mod = ((offset % period) + period) % period
        if mod <= rng:
            return first + mod
        return last - (mod - rng)

    return first if is_pre else last
