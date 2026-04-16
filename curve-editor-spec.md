# VS Code Curve Editor Extension — Developer Specification

**Version:** 1.0  
**Date:** April 2026  
**Author:** Glen Rhodes / Tiny Moosh Games Inc.  
**Status:** Ready for development

---

## 1. Overview

Build a VS Code extension that provides a visual curve editor for `.curve.json` files. The editor lets users define animation curves, parameter envelopes, and state timelines using keyframes with bezier or linear interpolation — similar to Unreal Engine's curve editor. The extension should feel native to VS Code, support undo/redo through the standard editor stack, and produce clean, human-readable JSON.

### 1.1 Target Users

Game developers, technical artists, and tools programmers who need to author time-based curves outside of a game engine and commit them to version control as plain JSON.

### 1.2 Supported Curve Types

| Type | Value Format | Interpolation | Notes |
|------|-------------|---------------|-------|
| `float` | `number` | bezier, linear, constant | Primary type. Full tangent support. |
| `int` | `integer` | constant, linear | No bezier. Linear rounds to nearest int at eval time. Optionally define `states` for discrete finite-state curves (§16.3). |
| `vec2` | `[x, y]` | bezier, linear, constant | Per-component tangents. Shared keyframe times. |
| `vec3` | `[x, y, z]` | bezier, linear, constant | Per-component tangents. Shared keyframe times. |
| `vec4` | `[x, y, z, w]` | bezier, linear, constant | Per-component tangents. Shared keyframe times. |
| `color` | `[r, g, b, a]` | bezier, linear, constant | Values 0–1. Canvas shows color gradient preview. |

---

## 2. JSON Schema

### 2.1 File Format

Files use the extension `.curve.json`. The extension registers as a custom editor for this glob pattern.

```json
{
  "version": 1,
  "curves": [ ...CurveDefinition ]
}
```

### 2.2 CurveDefinition

```jsonc
{
  "name": "string",             // unique within file, used as display label
  "type": "float",              // float | int | vec2 | vec3 | vec4 | color
  "range": {                    // optional — display clamp and evaluation clamp
    "min": 0.0,
    "max": 1.0
  },
  "timeRange": {                // optional — suggested visible time window
    "start": 0.0,
    "end": 5.0
  },
  "states": {                   // optional — int curves only (see §16.3)
    "count": 3,                 // number of valid states: 0 through count-1
    "labels": ["Red", "Yellow", "Green"]  // optional display names
  },
  "preInfinity": "constant",   // constant | linear | cycle | oscillate
  "postInfinity": "constant",  // constant | linear | cycle | oscillate
  "keys": [ ...KeyFrame ]
}
```

### 2.3 KeyFrame

```jsonc
{
  "time": 0.0,                         // seconds (float, any range)
  "value": 0.0,                        // number for float/int, array for vec/color
  "interp": "bezier",                  // bezier | linear | constant
  "tangentMode": "auto",               // auto | user | break | aligned
  "tangentIn":  { "dx": -0.1, "dy": 0.0 },  // omit for constant/linear
  "tangentOut": { "dx":  0.1, "dy": 0.5 }   // omit for constant/linear
}
```

**Tangent rules:**

- `auto` — extension calculates tangents from neighboring keys using Catmull-Rom (see §5.2)
- `aligned` — user sets one tangent handle; the other mirrors it (same slope, opposite direction)
- `user` — both handles set independently but constrained to same slope (no break)
- `break` — each handle is fully independent

For `vec`/`color` types, tangentIn/tangentOut become arrays of `{dx, dy}` objects, one per component:

```jsonc
"tangentIn":  [{ "dx": -0.1, "dy": 0.0 }, { "dx": -0.1, "dy": 0.0 }],  // vec2
"tangentOut": [{ "dx":  0.1, "dy": 0.5 }, { "dx":  0.1, "dy": 0.3 }]
```

### 2.4 JSON Schema File

Ship a `curve.schema.json` in the extension. Register it via `contributes.jsonValidation` so that users who open the raw JSON get validation and autocomplete. The schema must enforce all the constraints above (enum values, conditional required fields based on type, array lengths matching component count, etc.).

---

## 3. Extension Architecture

### 3.1 Activation

- **Activation event:** `onCustomEditor:curveEditor.curveView`
- **File association:** `*.curve.json`
- Also contribute a command `curveEditor.newCurveFile` that scaffolds an empty file.

### 3.2 Custom Editor Provider

Implement `vscode.CustomTextEditorProvider`. This gives us:

- Free undo/redo/revert via `TextDocument`
- Dirty state tracking
- File watching for external changes
- Side-by-side with the raw JSON text editor (user can split and see both)

**Do NOT use CustomDocument / binary editor.** The file is JSON text and we want the VS Code text stack.

### 3.3 Extension Host ↔ Webview Protocol

All communication uses `postMessage`. Define a typed message protocol:

**Host → Webview:**

| Message | Payload | When |
|---------|---------|------|
| `doc:update` | Full parsed JSON | Document changes (external edit, undo, redo) |
| `doc:saved` | — | File saved |
| `theme:changed` | VS Code color tokens | Theme changes |

**Webview → Host:**

| Message | Payload | When |
|---------|---------|------|
| `edit:batch` | Array of JSON Patch ops (RFC 6902) | User makes any edit in the canvas |
| `command:newCurve` | `{ type }` | User clicks "Add Curve" |
| `command:deleteCurve` | `{ name }` | User deletes a curve |
| `ui:ready` | — | Webview loaded, requesting initial data |

**Critical:** The host applies edits via `WorkspaceEdit` on the `TextDocument`. The host is the single source of truth. The webview never writes JSON directly — it proposes edits, the host applies them, and then sends back the updated document. This keeps undo/redo atomic and consistent.

### 3.4 Edit Batching

Interactive drags (moving a key, adjusting a tangent handle) generate many intermediate positions. Batch these: collect edits during a drag, apply only on mouseup as a single `WorkspaceEdit`. During the drag, the webview renders the preview locally without waiting for a round-trip.

### 3.5 Project Structure

```
curve-editor/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts            # activation, provider registration
│   ├── CurveEditorProvider.ts  # CustomTextEditorProvider implementation
│   ├── protocol.ts             # shared message type definitions
│   └── schema/
│       └── curve.schema.json
├── webview/
│   ├── index.html              # webview entry
│   ├── main.ts                 # bootstrapping, message handling
│   ├── state/
│   │   └── EditorState.ts      # parsed doc model, selection, viewport
│   ├── canvas/
│   │   ├── CurveCanvas.ts      # main canvas renderer
│   │   ├── GridRenderer.ts     # background grid + labels
│   │   ├── CurveRenderer.ts    # curve polyline drawing
│   │   ├── KeyRenderer.ts      # keyframe diamonds + tangent handles
│   │   └── SelectionBox.ts     # marquee select
│   ├── panels/
│   │   ├── CurveList.ts        # left sidebar: curve list
│   │   ├── KeyInspector.ts     # right/bottom panel: selected key properties
│   │   └── Toolbar.ts          # top toolbar
│   ├── math/
│   │   ├── bezier.ts           # cubic bezier evaluation
│   │   ├── tangents.ts         # auto-tangent calculation
│   │   └── transforms.ts       # screen ↔ curve space conversions
│   └── styles/
│       └── editor.css
├── test/
│   ├── bezier.test.ts
│   ├── tangents.test.ts
│   └── schema.test.ts
└── README.md
```

### 3.6 Build

Use esbuild for both the extension host bundle and the webview bundle. Two entry points, two outputs. No webpack. The webview bundle is inlined into the HTML or loaded as a local resource URI. No CDN dependencies — the extension must work fully offline.

### 3.7 Dependencies

Keep these minimal:

- **None required for extension host** beyond `@types/vscode`
- **Webview:** no frameworks. Vanilla TypeScript + Canvas API. Optionally a small utility like `mitt` for internal events. No React, no D3, no charting libraries.

---

## 4. User Interface Layout

```
┌──────────────────────────────────────────────────────────┐
│ Toolbar                                                  │
│ [Add Curve ▾] [Snap ⊞] [Frame All] [Frame Selection]    │
│ [Interp: Bezier ▾] [Tangent: Auto ▾] [∞ Pre ▾] [∞ Post ▾] │
├────────────┬─────────────────────────────────────────────┤
│ Curve List │ Canvas                                      │
│            │                                             │
│ ● fadeIn   │    1.0 ┤·····················♦─────────     │
│ ● scaleX   │        │                 ╱                  │
│ ○ scaleY   │        │              ╱                     │
│            │    0.5 ┤·········╱·····                     │
│            │        │      ╱                              │
│            │        │   ╱                                 │
│            │    0.0 ┤♦─╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌      │
│            │        └──┬──────┬──────┬──────┬─────       │
│            │          0.0    1.0    2.0    3.0            │
├────────────┴─────────────────────────────────────────────┤
│ Key Inspector                                            │
│ Time: [1.5    ] Value: [0.72   ] Interp: [Bezier ▾]     │
│ Tan In: dx [-0.1] dy [0.0]  Tan Out: dx [0.1] dy [0.5] │
└──────────────────────────────────────────────────────────┘
```

### 4.1 Curve List Panel (Left)

- Shows all curves in the file by name.
- Each row: colored circle (auto-assigned or user-set), curve name, visibility toggle (eye icon), lock toggle.
- Click to select (multi-select with Ctrl/Cmd). Selected curves render in the canvas.
- Double-click name to rename inline.
- Right-click context menu: Rename, Duplicate, Delete, Change Color, Change Type.
- Drag to reorder (reorders the `curves` array in JSON).

### 4.2 Canvas (Center)

The primary interaction surface. See §5 for rendering details and §6 for interaction.

### 4.3 Key Inspector (Bottom)

- Shows editable fields for the currently selected keyframe(s).
- If one key selected: show Time, Value, Interp dropdown, Tangent Mode dropdown, TangentIn dx/dy, TangentOut dx/dy.
- If multiple keys selected: show mixed state indicators. Edits apply to all selected keys (relative for time/value, absolute for dropdowns).
- For vec/color types: show per-component fields or a collapsed summary.
- For color type: include a small color swatch preview.
- Input fields commit on Enter or blur. Arrow keys nudge values by a small step (configurable in settings).

### 4.4 Toolbar (Top)

- **Add Curve** dropdown: Float, Int, Vec2, Vec3, Vec4, Color.
- **Snap toggle** with configurable snap intervals (time and value).
- **Frame All** (Home key): fit all visible curves in viewport.
- **Frame Selection** (F key): fit selected keys in viewport.
- **Interpolation override**: set interp mode for selected keys.
- **Tangent mode override**: set tangent mode for selected keys.
- **Pre/Post Infinity**: dropdowns, apply to selected curves.

### 4.5 Theming

Use VS Code CSS custom properties from the webview. All colors, fonts, and backgrounds should derive from the active VS Code theme. Define semantic CSS variables:

```css
--curve-bg: var(--vscode-editor-background);
--curve-grid: var(--vscode-editorLineNumber-foreground);
--curve-grid-major: var(--vscode-editorLineNumber-activeForeground);
--curve-text: var(--vscode-editor-foreground);
--key-selected: var(--vscode-focusBorder);
--key-handle: var(--vscode-textLink-foreground);
```

Per-curve colors use a built-in palette of 8–10 distinct hues chosen to be visible on both dark and light themes. User can override per-curve.

---

## 5. Rendering

### 5.1 Canvas Pipeline

Use a single `<canvas>` element with 2D context. Render at `devicePixelRatio` resolution for crisp display on HiDPI screens.

**Render order (back to front):**

1. Background fill
2. Grid lines (minor, major) + axis labels
3. Time range shading (if `timeRange` is set, dim outside that range)
4. Infinity preview (dotted/dashed lines extending beyond first/last key)
5. Curve polylines (one per visible curve)
6. Keyframe diamonds
7. Tangent handles + handle lines (only for selected keys)
8. Selection marquee (if dragging)
9. Tooltip overlay (if hovering a key)
10. For `color` type curves: a horizontal gradient strip below or above the curve showing the interpolated color

**Repaint strategy:** requestAnimationFrame loop that only repaints when a dirty flag is set. No continuous rendering.

### 5.2 Bezier Evaluation

Each segment between two consecutive keys defines a cubic bezier. Convert the key + tangent representation to four control points:

```
P0 = (key0.time, key0.value)
P1 = (key0.time + key0.tangentOut.dx, key0.value + key0.tangentOut.dy)
P2 = (key1.time + key1.tangentIn.dx,  key1.value + key1.tangentIn.dy)
P3 = (key1.time, key1.value)
```

**Evaluation:** For each pixel column in the visible range, solve for `t` given `x` using Newton-Raphson (3–5 iterations is sufficient), then compute `y(t)`. Cache the polyline points per curve and invalidate on key/tangent change or viewport change.

**Auto tangents (Catmull-Rom):**

```
For key[i] with neighbors key[i-1] and key[i+1]:
  slope = (key[i+1].value - key[i-1].value) / (key[i+1].time - key[i-1].time)
  tangentOut.dx = (key[i+1].time - key[i].time) / 3
  tangentOut.dy = slope * tangentOut.dx
  tangentIn.dx  = -(key[i].time - key[i-1].time) / 3
  tangentIn.dy  = slope * tangentIn.dx
```

For first/last keys with no neighbor on one side, use the slope to the single neighbor.

### 5.3 Grid

- Adaptive grid density: compute nice round intervals based on current zoom level (1, 2, 5, 10 pattern).
- Major gridlines every 5th or 10th minor line.
- Labels on the left (value axis) and bottom (time axis).
- Origin lines (time=0, value=0) drawn slightly thicker/brighter.

### 5.4 Keyframe Rendering

- Diamond shape, 8×8 CSS pixels.
- Fill color = curve color. Stroke = theme border color.
- Selected keys: brighter fill + thicker stroke using `--key-selected`.
- Hovered key: subtle glow or size increase.

### 5.5 Tangent Handles

- Only drawn for selected keys with bezier interp.
- Small circles at the tangent control point positions.
- Connected to the key diamond by thin lines.
- When `tangentMode` is `break`, draw handles in different sub-colors to indicate independence.

---

## 6. Interaction

### 6.1 Viewport Navigation

| Input | Action |
|-------|--------|
| Middle mouse drag | Pan |
| Scroll wheel | Zoom (centered on cursor) |
| Shift + scroll | Horizontal zoom only |
| Ctrl/Cmd + scroll | Vertical zoom only |
| Alt + right mouse drag | Pan (alternative for trackpad users) |
| Home / toolbar button | Frame all visible curves |
| F / toolbar button | Frame selected keys |

Implement smooth inertial scrolling for trackpad. Clamp zoom to reasonable min/max (e.g., 0.001s to 100000s per screen width).

### 6.2 Key Selection

| Input | Action |
|-------|--------|
| Click key | Select (deselect others) |
| Ctrl/Cmd + click key | Toggle key in selection |
| Shift + click key | Range select (all keys between last selected and clicked, on same curve) |
| Click empty space | Deselect all |
| Drag on empty space | Marquee select |
| Ctrl/Cmd + A | Select all keys on visible curves |

### 6.3 Key Manipulation

| Input | Action |
|-------|--------|
| Drag selected key(s) | Move in time and value |
| Shift + drag | Constrain to horizontal (time only) or vertical (value only) based on initial drag direction |
| Drag tangent handle | Adjust tangent |
| Double-click empty canvas | Add key at that time/value on the currently selected curve |
| Delete / Backspace | Delete selected keys |
| Ctrl/Cmd + D | Duplicate selected keys (offset slightly in time) |

During a key drag, show a tooltip with the precise time and value. Snap to grid if snap is enabled.

### 6.4 Context Menu (Right-Click)

**On a key:**
- Set Interpolation → Bezier / Linear / Constant
- Set Tangent Mode → Auto / User / Break / Aligned
- Flatten Tangents (set dy to 0)
- Delete Key
- Copy Key(s)
- Paste Key(s)

**On empty canvas:**
- Add Key Here
- Paste Key(s)
- Frame All
- Frame Selection

### 6.5 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `1` | Set selected keys to Constant |
| `2` | Set selected keys to Linear |
| `3` | Set selected keys to Bezier |
| `Ctrl/Cmd + Z` | Undo (handled by VS Code, not the webview) |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + C` | Copy selected keys as JSON to clipboard |
| `Ctrl/Cmd + V` | Paste keys from clipboard |
| `S` | Toggle snap |
| `T` | Toggle tangent display |

---

## 7. Vec and Color Curve Specifics

### 7.1 Vec Curves (vec2, vec3, vec4)

- All components share the same keyframe times. Adding a key adds it to all components.
- The canvas shows each component as a separate sub-curve (e.g., X = red, Y = green, Z = blue, W = white).
- The curve list shows the parent vec curve with expandable component children. User can solo/hide individual components.
- Tangent handles are per-component. When the user drags a key vertically, they move one component at a time (based on which sub-curve line they clicked near). Time drags move all components together.
- The Key Inspector shows all component values side by side.

### 7.2 Color Curves

- Stored as `[r, g, b, a]` with values in the 0–1 range.
- In addition to the component sub-curves (drawn as R/G/B/A lines), render a horizontal color gradient strip across the bottom of the canvas area showing the evaluated color at each time position.
- The Key Inspector includes a color swatch and optional hex input for convenience (converted to 0–1 RGBA internally).
- When adding a key, if the user clicks on the color gradient strip, open a color picker to set the value.

---

## 8. Infinity Modes

When evaluating or displaying beyond the first/last keyframe:

| Mode | Behavior |
|------|----------|
| `constant` | Hold the value of the nearest endpoint key |
| `linear` | Extrapolate using the tangent of the endpoint key |
| `cycle` | Repeat the curve range (loop) |
| `oscillate` | Ping-pong the curve range |

The canvas should render a preview of the infinity behavior as a dashed line extending to the edges of the visible viewport.

---

## 9. Settings (contributes.configuration)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `curveEditor.snapTimeInterval` | number | 0.1 | Time snap increment |
| `curveEditor.snapValueInterval` | number | 0.1 | Value snap increment |
| `curveEditor.defaultInterpolation` | enum | "bezier" | Default interp for new float keys |
| `curveEditor.defaultTangentMode` | enum | "auto" | Default tangent mode for new keys |
| `curveEditor.showGridLabels` | boolean | true | Show axis labels |
| `curveEditor.curveLineWidth` | number | 2 | Curve line thickness in pixels |
| `curveEditor.antiAlias` | boolean | true | Canvas anti-aliasing |

---

## 10. Commands (contributes.commands)

| Command ID | Title | Description |
|-----------|-------|-------------|
| `curveEditor.newFile` | Curve Editor: New Curve File | Create a new `.curve.json` file with empty curves array |
| `curveEditor.addCurve` | Curve Editor: Add Curve | Add a new curve to the open file |
| `curveEditor.frameAll` | Curve Editor: Frame All | Fit all curves in viewport |
| `curveEditor.frameSelection` | Curve Editor: Frame Selection | Fit selected keys in viewport |
| `curveEditor.flattenTangents` | Curve Editor: Flatten Tangents | Set selected tangents to horizontal |

---

## 11. Testing Requirements

### 11.1 Unit Tests

- **Bezier evaluation**: known curve segments evaluated at specific `t` values, verified against reference implementations.
- **Auto-tangent calculation**: verify Catmull-Rom output for known key configurations.
- **Screen ↔ curve space transforms**: round-trip accuracy.
- **JSON schema validation**: valid and invalid documents.
- **Infinity evaluation**: each mode tested at positions beyond key range.

### 11.2 Integration Tests

- Load a `.curve.json` file → verify the custom editor opens.
- Edit a key in the webview → verify the underlying `TextDocument` JSON is updated correctly.
- Edit the raw JSON in a text editor → verify the webview reflects the change.
- Undo/redo → verify state consistency in both directions.
- Multiple curves with different types in one file → verify all render and edit correctly.

### 11.3 Manual Test Scenarios

Provide a set of sample `.curve.json` files covering: empty curves array, single float curve, multi-curve file with mixed types, color curve with gradient, edge cases (single key, two keys, 1000+ keys for performance).

---

## 12. Performance Targets

| Metric | Target |
|--------|--------|
| Initial render (10 curves, 50 keys each) | < 50ms |
| Key drag frame time | < 16ms (60fps) |
| File with 100 curves, 500 keys each | Smooth pan/zoom |
| Memory for large file | < 50MB webview heap |

Cache polyline points per curve. Invalidate per-curve, not globally. Skip rendering curves that are entirely outside the visible viewport. For very dense key counts (>1000 per curve), consider LOD: skip rendering keys that are sub-pixel apart.

---

## 13. Delivery Milestones

### Milestone 1 — Core Float Editor
- Extension scaffolding, provider, webview shell
- JSON schema + validation
- Canvas with grid, pan, zoom
- Float curve rendering (bezier + linear + constant)
- Add/delete/move keys
- Tangent handle interaction (all four modes)
- Undo/redo through VS Code
- Key Inspector panel

### Milestone 2 — Multi-Curve + Int
- Curve list panel with visibility/lock/color
- Multiple curves in one file
- Int curve type
- Context menus
- Keyboard shortcuts
- Snap to grid
- Copy/paste keys
- Infinity mode rendering

### Milestone 3 — Vec + Color
- Vec2/3/4 curve types with per-component sub-curves
- Color curve type with gradient strip
- Color picker for color keys
- Component solo/hide in curve list

### Milestone 4 — Runtime Libraries + Polish + Ship
- JS and Python evaluation libraries (§16) with shared test fixtures
- npm and PyPI packaging
- Theme adaptation (verify on 5+ popular themes)
- Performance optimization pass
- Sample files and README documentation
- Marketplace listing assets (icon, screenshots, description)
- Full test suite passing (extension + both runtime libraries)

---

## 14. Out of Scope (v1)

These are explicitly **not** included in v1 but noted for future consideration:

- ~~Curve evaluation runtime library (separate npm package, later)~~ → moved to §16
- Expression-driven curves
- Audio waveform overlay
- Onion-skinning / ghosting previous states
- Collaborative editing
- Curve presets / library
- Integration with specific game engines (export adapters)

---

## 15. Reference

- **VS Code Custom Editor API**: https://code.visualstudio.com/api/extension-guides/custom-editors
- **Unreal Engine FRichCurve**: https://docs.unrealengine.com/en-US/API/Runtime/Engine/Curves/FRichCurve/
- **Cubic Bezier math**: https://pomax.github.io/bezierinfo/
- **JSON Patch (RFC 6902)**: https://datatracker.ietf.org/doc/html/rfc6902

---

## 16. Runtime Evaluation Libraries (JS + Python)

Ship two standalone, zero-dependency evaluation libraries — one in JavaScript (ES module + CommonJS), one in Python — that load a `.curve.json` file and evaluate any curve at a given time. These are **not** part of the VS Code extension; they are separate packages intended for use in game engines, servers, tools pipelines, and creative coding projects.

### 16.1 API Surface

Both libraries expose the same logical API.

**Core function:**

```
evaluate(curveFile, curveName, time, options?) → value
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `curveFile` | parsed JSON object | The full `.curve.json` contents |
| `curveName` | string | Name of the curve to evaluate |
| `time` | number | Absolute time in seconds |
| `options.normalized` | boolean (default false) | If true, treat `time` as 0–1 mapped to the curve's first-key-to-last-key range |

**Return types by curve type:**

| Curve Type | JS Return | Python Return |
|------------|-----------|---------------|
| `float` | `number` | `float` |
| `int` | `number` (integer) | `int` |
| `vec2` | `[x, y]` | `tuple(x, y)` |
| `vec3` | `[x, y, z]` | `tuple(x, y, z)` |
| `vec4` | `[x, y, z, w]` | `tuple(x, y, z, w)` |
| `color` | `{ r, g, b, a }` | `dict(r, g, b, a)` — values 0–1 |

**Convenience functions:**

```
evaluateAll(curveFile, time, options?) → { curveName: value, ... }
getCurveNames(curveFile) → string[]
getCurveTimeRange(curveFile, curveName) → { start, end }
```

`evaluateAll` evaluates every curve in the file at the same time and returns a keyed object/dict.

### 16.2 Normalized Time

When `options.normalized` is true:

```
absoluteTime = firstKey.time + normalizedTime * (lastKey.time - firstKey.time)
```

This lets callers drive a curve from a 0–1 progress value (e.g., a tween, a health bar, a loading bar) without knowing the authored time range.

### 16.3 Int Curves and Discrete States

Int curves serve double duty: they represent both continuous integer values (e.g., a floor count) and **discrete finite states** (e.g., a traffic light switching between Red, Yellow, Green).

**Schema addition for int curves:**

```jsonc
{
  "name": "trafficLight",
  "type": "int",
  "states": {                    // optional — if present, this is a state curve
    "count": 3,
    "labels": ["Red", "Yellow", "Green"]   // optional — human-readable names
  },
  "range": { "min": 0, "max": 2 },        // auto-inferred from states.count if omitted
  "keys": [
    { "time": 0.0,  "value": 0, "interp": "constant" },
    { "time": 5.0,  "value": 2, "interp": "constant" },
    { "time": 8.0,  "value": 1, "interp": "constant" },
    { "time": 10.0, "value": 0, "interp": "constant" }
  ]
}
```

**Rules:**

- `states.count` defines the number of valid integer values: 0 through `count - 1`.
- `states.labels` is optional and purely for display. Length must equal `count`. The runtime libraries carry labels through for debugging but evaluation always returns the integer.
- When `states` is present, the editor enforces `constant` interpolation only (no blending between states). The value dropdown in the Key Inspector shows labels instead of raw ints.
- When `states` is absent, the int curve behaves normally — `linear` interp is allowed (rounded to nearest int at eval time), and `constant` snaps to the value of the left key.
- Validation: key values must be integers in the range `[0, states.count - 1]`. The schema and the editor both enforce this.

**Editor rendering for state curves:**

Instead of a continuous line, render horizontal colored bands for each state — similar to a Gantt chart or a sequencer lane. Each state gets a color from its index. Labels are drawn inside the bands if there is room.

```
  Green ┤ █████████████████████░░░░░░░░░░░░░░
 Yellow ┤ ░░░░░░░░░░░░░░░░░░░░░░░░████████░░
    Red ┤ ░░░░░░░░░░░░░░░░░░░░██████████████
        └──┬──────┬──────┬──────┬──────┬─────
          0.0    2.0    4.0    6.0    8.0
```

**Runtime evaluation for state curves:**

Returns the integer value. Additionally, both libraries expose:

```
evaluateState(curveFile, curveName, time, options?) → { index, label? }
```

This returns the integer index plus the label string if `states.labels` is defined in the curve.

### 16.4 Interpolation Evaluation Logic

The runtime must implement all interpolation modes identically to the editor canvas.

**Float / Vec / Color curves:**

| Interp | Evaluation |
|--------|-----------|
| `constant` | Return value of the left key (the key at or just before `time`) |
| `linear` | Lerp between left and right key values based on `(time - left.time) / (right.time - left.time)` |
| `bezier` | Construct cubic bezier from left key + tangentOut and right key + tangentIn (see §5.2). Solve for `t` at given `time` using Newton-Raphson, evaluate `y(t)`. |

**Int curves (without states):**

| Interp | Evaluation |
|--------|-----------|
| `constant` | Return value of left key |
| `linear` | Lerp, then `Math.round()` / `round()` |

**Int curves (with states):**

Always `constant` — return value of left key.

**Infinity handling:**

Apply `preInfinity` / `postInfinity` before evaluating. For `cycle` and `oscillate`, remap the input time into the key range:

```
range = lastKey.time - firstKey.time
cycle:     remappedTime = firstKey.time + ((time - firstKey.time) % range + range) % range
oscillate: fold time into range, reverse on odd periods
```

### 16.5 JavaScript Package

**Package name:** `curve-eval`  
**Format:** ES module with CommonJS fallback  
**Target:** ES2020 (runs in Node 14+, all modern browsers)  
**TypeScript:** Ship `.d.ts` type declarations  
**Zero dependencies**

```js
import { evaluate, evaluateAll, evaluateState } from 'curve-eval';

const file = JSON.parse(fs.readFileSync('anim.curve.json', 'utf8'));

// Absolute time
const opacity = evaluate(file, 'fadeIn', 2.5);          // → 0.72
const color   = evaluate(file, 'tint', 1.0);            // → { r: 1, g: 0.5, b: 0, a: 1 }

// Normalized time (0–1)
const mid = evaluate(file, 'fadeIn', 0.5, { normalized: true });

// State curve
const light = evaluateState(file, 'trafficLight', 6.0); // → { index: 1, label: 'Yellow' }

// All curves at once
const frame = evaluateAll(file, 3.0);
// → { fadeIn: 0.92, scaleX: 1.5, trafficLight: 2, tint: { r: 1, g: 1, b: 1, a: 1 } }
```

### 16.6 Python Package

**Package name:** `curve_eval`  
**Target:** Python 3.9+  
**Zero dependencies** (stdlib math only)  
**Type hints:** full typing throughout, passes mypy strict

```python
from curve_eval import evaluate, evaluate_all, evaluate_state
import json

with open('anim.curve.json') as f:
    file = json.load(f)

# Absolute time
opacity = evaluate(file, 'fadeIn', 2.5)             # → 0.72
color   = evaluate(file, 'tint', 1.0)               # → {'r': 1.0, 'g': 0.5, 'b': 0.0, 'a': 1.0}

# Normalized time
mid = evaluate(file, 'fadeIn', 0.5, normalized=True)

# State curve
light = evaluate_state(file, 'trafficLight', 6.0)   # → {'index': 1, 'label': 'Yellow'}

# All curves at once
frame = evaluate_all(file, 3.0)
# → {'fadeIn': 0.92, 'scaleX': 1.5, 'trafficLight': 2, 'tint': {'r': 1, ...}}
```

### 16.7 Test Matrix

Both libraries must produce **identical results** for the same inputs. Create a shared test fixture file (`test_curves.curve.json`) and a shared expected-results JSON file. Each library's test suite loads both and verifies output within a tolerance of `1e-6` for floats.

| Test Case | Coverage |
|-----------|----------|
| Single float key (before, at, after) | Constant extrapolation |
| Two keys, linear interp | Lerp accuracy |
| Two keys, bezier interp, flat tangents | Bezier with known output |
| Two keys, bezier interp, steep tangents | Newton-Raphson convergence |
| S-curve (3+ keys, mixed interp) | Segment selection logic |
| Int curve, linear interp | Rounding behavior |
| State curve (3 states, 6 transitions) | Constant-only, label lookup |
| State curve, out-of-range time | Pre/post infinity for states |
| Vec3 curve | Per-component evaluation |
| Color curve | Returns object/dict, values clamped 0–1 |
| Normalized time at 0, 0.5, 1 | Time remapping accuracy |
| Cycle infinity | Looping beyond range |
| Oscillate infinity | Ping-pong beyond range |
| Empty keys array | Returns null/None gracefully |
| 10,000 keys, 100,000 evaluations | Performance: < 1s total |

### 16.8 Delivery

These libraries are part of **Milestone 4**. They live in a `packages/` directory alongside the extension:

```
curve-editor/
├── extension/          # VS Code extension (§3)
├── packages/
│   ├── curve-eval-js/  # JS/TS package
│   └── curve-eval-py/  # Python package
└── test-fixtures/      # shared .curve.json + expected results
```

Publish separately: JS to npm, Python to PyPI.
