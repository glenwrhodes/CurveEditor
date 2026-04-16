# AGENT.md — `curve_eval` (Python)

Instructions for AI coding assistants helping a user integrate this package.

## Purpose

Evaluates animation curves authored in the `.curve.json` format produced by the [Curve Editor VS Code extension](https://marketplace.visualstudio.com/items?itemName=TinyMooshGamesInc.curve-editor). Given a parsed dict and a time, returns the interpolated value at that time.

Zero dependencies (stdlib only). Python 3.9+. Full type hints.

## Install

```bash
pip install curve-eval
```

## Import

```python
from curve_eval import (
    evaluate,
    evaluate_all,
    evaluate_state,
    get_curve_names,
    get_curve_time_range,
)
```

Note: the PyPI package is `curve-eval` (dash) but the Python import name is `curve_eval` (underscore).

Always pass a **parsed dict** (e.g. from `json.load`), not a file path. The library never touches the filesystem.

## API

All functions are pure — no side effects, no mutation of the input dict.

### `evaluate(file, curve_name, time, *, normalized=False)`

| Arg | Type | Notes |
|-----|------|-------|
| `file` | `dict` | Parsed JSON |
| `curve_name` | `str` | Must match a curve's `name` exactly |
| `time` | `float` | Seconds (absolute). With `normalized=True`, 0–1 maps to first-key-to-last-key |
| `normalized` | `bool` | Keyword-only |

Returns:

| Curve Type | Return |
|------------|--------|
| `float` | `float` |
| `int` | `int` (rounded) |
| `vec2` / `vec3` / `vec4` | `tuple[float, ...]` |
| `color` | `dict[str, float]` with keys `r`, `g`, `b`, `a` (0–1 range) |

Returns `None` if the curve doesn't exist or has no keys.

### `evaluate_all(file, time, *, normalized=False) -> dict[str, Any]`

Evaluates every curve in the file at the same time.

### `evaluate_state(file, curve_name, time, *, normalized=False)`

Returns `{'index': int, 'label': str | None}` for int curves that define `states`. Returns `None` for non-state curves.

### `get_curve_names(file) -> list[str]`

### `get_curve_time_range(file, curve_name) -> dict | None`

Returns `{'start': float, 'end': float}` or `None`.

## Canonical usage patterns

### Evaluate a curve in a game loop

```python
import json
from curve_eval import evaluate

with open('anim.curve.json') as f:
    anim = json.load(f)

def update(t: float) -> None:
    opacity = evaluate(anim, 'fadeIn', t)
    sprite.alpha = opacity
```

### Drive a whole scene from one file

```python
from curve_eval import evaluate_all

frame = evaluate_all(anim, current_time)
# frame = {'fadeIn': 0.8, 'position': (3.4, 2.1, 0.0), 'tint': {'r': 1.0, ...}}
```

### Normalized time (0..1 progress)

```python
eased = evaluate(anim, 'easeCurve', progress, normalized=True)
```

### Color curve

```python
tint = evaluate(anim, 'tint', t)
material.set_color(tint['r'], tint['g'], tint['b'], tint['a'])
```

### State curve

```python
light = evaluate_state(anim, 'trafficLight', t)
if light and light['label'] == 'Green':
    drive_forward()
```

## Interpolation semantics

Per-key:
- `constant` — holds the value of the left key until the next key
- `linear` — straight-line interpolation
- `bezier` — cubic bezier via Newton-Raphson (fallback bisection)

The **left key** of each segment determines interpolation for that segment. On vec/color curves, each component can have its own `componentInterp` override.

## Infinity (pre/post extrapolation)

Each curve has `preInfinity` / `postInfinity`. Values:
- `constant` (default) — hold endpoint value
- `linear` — extrapolate with endpoint tangent
- `cycle` — loop the authored range
- `oscillate` — ping-pong

## Gotchas

- **Curve names are case-sensitive.**
- **Always parse the JSON yourself** with `json.load()` or `json.loads()`. The library expects a dict.
- **`evaluate` returns `None`** for missing curves or empty `keys`. Guard with `is None` checks or `if result:`.
- **Integer curves** ignore tangent handles; they only use `constant` or `linear` semantics.
- **State curves** are int curves with a `states` object. `evaluate` returns the integer; `evaluate_state` returns the richer object with labels.
- **Color keys are 0–1 normalized**, not 0–255. Multiply by 255 if you need byte values.
- **Vec returns are `tuple`, not `list`.** Immutable. Use tuple unpacking: `x, y, z = evaluate(file, 'pos', t)`.

## File format (tl;dr)

```jsonc
{
  "version": 1,
  "curves": [
    {
      "name": "fadeIn",
      "type": "float",
      "preInfinity": "constant",
      "postInfinity": "constant",
      "keys": [
        { "time": 0, "value": 0, "interp": "bezier", "tangentMode": "auto" },
        { "time": 1, "value": 1, "interp": "bezier", "tangentMode": "auto" }
      ]
    }
  ]
}
```

Full schema and authoring tool: https://github.com/glenwrhodes/CurveEditor

## Source

https://github.com/glenwrhodes/CurveEditor

MIT licensed.
