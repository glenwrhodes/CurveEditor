# curve-eval

Evaluate `.curve.json` animation curves authored in the [Curve Editor VS Code extension](https://marketplace.visualstudio.com/items?itemName=TinyMooshGamesInc.curve-editor). Supports bezier, linear, and constant interpolation for float, int, vec2/3/4, and color types.

Zero dependencies (standard library only). Python 3.9+. Full type hints.

## Install

```bash
pip install curve-eval
```

## Usage

```python
from curve_eval import evaluate, evaluate_all, evaluate_state
import json

with open('anim.curve.json') as f:
    file = json.load(f)

# Absolute time
opacity = evaluate(file, 'fadeIn', 2.5)              # → 0.72
color   = evaluate(file, 'tint', 1.0)                # → {'r': 1.0, 'g': 0.5, 'b': 0.0, 'a': 1.0}
position = evaluate(file, 'position', 0.5)           # → (5.0, 2.5, 1.0)

# Normalized time (0–1 maps to the curve's full time range)
mid = evaluate(file, 'fadeIn', 0.5, normalized=True)

# State curves return index + optional label
light = evaluate_state(file, 'trafficLight', 6.0)    # → {'index': 1, 'label': 'Yellow'}

# Evaluate every curve at one time
frame = evaluate_all(file, 3.0)
# → {'fadeIn': 0.92, 'scaleX': 1.5, 'trafficLight': 2, 'tint': {'r': 1, ...}}
```

## API

| Function | Returns |
|----------|---------|
| `evaluate(file, name, time, *, normalized=False)` | `float` / `int` / `tuple` / `dict` |
| `evaluate_all(file, time, *, normalized=False)` | `dict[str, value]` |
| `evaluate_state(file, name, time, *, normalized=False)` | `{"index": int, "label": str \| None}` |
| `get_curve_names(file)` | `list[str]` |
| `get_curve_time_range(file, name)` | `{"start": float, "end": float} \| None` |

## Interpolation Modes

- `constant` — value holds at the left key until the next key is reached
- `linear` — straight-line interpolation between keys
- `bezier` — cubic bezier with per-key tangent handles (Newton-Raphson solver)

Per-component interpolation is supported on vec/color curves: each component (X/Y/Z or R/G/B/A) can use a different mode on the same keyframe.

## Infinity Modes (extrapolation)

Each curve has `preInfinity` and `postInfinity` modes that control behavior outside the authored key range:

- `constant` — hold the endpoint value
- `linear` — extrapolate with the endpoint's tangent slope
- `cycle` — loop the authored range
- `oscillate` — ping-pong the authored range

## License

MIT © Glen Rhodes / Tiny Moosh Games Inc.

Source: https://github.com/glenwrhodes/CurveEditor
