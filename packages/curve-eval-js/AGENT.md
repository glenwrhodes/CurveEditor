# AGENT.md — `curve-eval` (JavaScript)

Instructions for AI coding assistants helping a user integrate this package.

## Purpose

Evaluates animation curves authored in the `.curve.json` format produced by the [Curve Editor VS Code extension](https://marketplace.visualstudio.com/items?itemName=TinyMooshGamesInc.curve-editor). Given a parsed JSON file and a time, returns the interpolated value at that time.

Zero runtime dependencies. ES module + CommonJS. Ships TypeScript types.

## Install

```bash
npm install curve-eval
```

## Quick import

```ts
// ES module
import { evaluate, evaluateAll, evaluateState, getCurveNames, getCurveTimeRange } from 'curve-eval';

// CommonJS
const { evaluate, evaluateAll, evaluateState } = require('curve-eval');
```

Always pass the **parsed JSON object**, not a file path. Read the file with `fs`, `fetch`, or your bundler's asset loader.

## API

All functions are pure — no side effects, no mutation of the input file.

### `evaluate(file, curveName, time, options?) → value`

| Arg | Type | Notes |
|-----|------|-------|
| `file` | `CurveFile` | Parsed JSON. `{ version: 1, curves: [...] }` |
| `curveName` | `string` | Must match a `curve.name` exactly |
| `time` | `number` | Seconds (absolute). With `options.normalized: true`, 0–1 maps to first-key-to-last-key |
| `options.normalized` | `boolean?` | Default `false` |

Returns:

| Curve Type | Return |
|------------|--------|
| `float` | `number` |
| `int` | `number` (integer, `Math.round` applied) |
| `vec2` / `vec3` / `vec4` | `number[]` |
| `color` | `{ r, g, b, a }` with values 0–1 |

Returns `null` if the curve doesn't exist or has no keys.

### `evaluateAll(file, time, options?) → { [curveName]: value }`

Evaluates every curve in the file at the same time. Useful for driving a whole "frame" of state with one call.

### `evaluateState(file, curveName, time, options?) → { index, label? } | null`

For int curves that declare a `states` definition (finite-state machines). Returns the state index plus human label (if `states.labels` is set). Returns `null` for non-state curves.

### `getCurveNames(file) → string[]`

List all curve names.

### `getCurveTimeRange(file, curveName) → { start, end } | null`

First key time and last key time. `null` if the curve has no keys.

## Canonical usage patterns

### Evaluate a single curve in a render loop

```ts
import { evaluate } from 'curve-eval';
import anim from './anim.curve.json' assert { type: 'json' }; // or read with fs

function update(t: number) {
  const opacity = evaluate(anim, 'fadeIn', t);
  sprite.alpha = opacity as number;
}
```

### Drive a whole scene from one curve file

```ts
import { evaluateAll } from 'curve-eval';

const frame = evaluateAll(anim, currentTime);
// frame is an object: { fadeIn: 0.8, position: [3.4, 2.1, 0], tint: {r:1,g:0.5,b:0,a:1} }
```

### Normalized time (driving a curve from 0–1 progress)

```ts
// Tween completion is 0..1 regardless of the curve's authored time range
const eased = evaluate(anim, 'easeCurve', progress, { normalized: true });
```

### Color curve

```ts
const tint = evaluate(anim, 'tint', t) as { r: number; g: number; b: number; a: number };
material.setColor(tint.r, tint.g, tint.b, tint.a);
```

### State curve

```ts
const light = evaluateState(anim, 'trafficLight', t);
if (light?.label === 'Green') driveForward();
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

- **Curve names are case-sensitive.** `evaluate(file, 'FadeIn', t)` and `evaluate(file, 'fadeIn', t)` are different queries.
- **Always parse the JSON yourself** — the library never touches the filesystem.
- **`evaluate` returns `null`** for missing curves or empty `keys` arrays. Narrow types accordingly.
- **Integer curves** with `tangentMode` or tangent handles — tangents are ignored; int curves only use `constant` or `linear` semantics.
- **State curves** require `constant` interp; `evaluate` on a state curve returns the integer, `evaluateState` returns the richer object.

## File format (tl;dr)

```jsonc
{
  "version": 1,
  "curves": [
    {
      "name": "fadeIn",
      "type": "float",                 // float | int | vec2 | vec3 | vec4 | color
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

Full schema: https://github.com/glenwrhodes/CurveEditor

## Source

https://github.com/glenwrhodes/CurveEditor

MIT licensed.
