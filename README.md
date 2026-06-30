# @zakkster/lite-dom-binder

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-dom-binder.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-dom-binder)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-dom-binder?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-dom-binder)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-dom-binder?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-dom-binder)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-dom-binder?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-dom-binder)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

> Zero-GC bridge from flat Float32Array transform matrices to the CSSOM. Bypasses framework diffing.

You have a simulation, ECS, or animation runtime producing 4×4 transform matrices in a typed array. You need them on the DOM. Every framework reconciler — React's virtual DOM, Vue's reactivity, Svelte's stores — wants to allocate, diff, and reschedule. For 1000+ DOM nodes updating per frame, that's measurable GC pressure during the exact moments you can least afford it.

This is the lower path: walk the buffer, dirty-check 16 floats, write `el.style.transform` only when something actually changed. The shadow buffer is pre-allocated. Stable entities cost zero allocations. Active entities cost one `matrix3d(...)` string each.

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│   ECS / Physics                Float32Array                  DOM   │
│   ────────────                 ────────────                  ───   │
│                                                                    │
│   per frame:        ─────►   [m₀ m₁ m₂ ... m₁₅]   ─────►   el.style│
│                                                                    │
│                              ▼ unrolled diff vs                    │
│                                shadow buffer                       │
│                                                                    │
│                           skip if equal  ──────────►   no write    │
│                           write if changed ────────►   matrix3d(…) │
└────────────────────────────────────────────────────────────────────┘
```

---

## Why this exists

Frameworks are built around the idea that the renderer owns the schedule: you describe what you want, they figure out when and how. That works beautifully for component trees and event handlers. It falls apart for per-frame transform updates from a simulation source — every `useState` or reactive `set` becomes an allocation, a diff, a microtask, a possible re-render of unrelated subtree.

When the source-of-truth is a typed array updated in a hot loop, the right pipeline is: read the buffer, write `style.transform`, done. No diff, no virtual DOM, no scheduling. This library does exactly that, with a dirty check so you don't pay for stable entities.

The `matrix3d(...)` form is chosen deliberately: it forces the modern compositor onto the GPU-only update path — no layout, no paint, just composite. One string allocation per *changed* entity per frame, and that's the entire cost.

---

## Install

```bash
npm install @zakkster/lite-dom-binder
```

ESM only. No runtime dependencies. Browser-only (uses `style.transform`).

---

## Quick start

```js
import { DOMBinder } from '@zakkster/lite-dom-binder';

// Bind up to 5000 DOM nodes
const binder = new DOMBinder(5000);

// Your DOM — cache references once, never re-query.
const elements = Array.from(document.querySelectorAll('.entity'));

// Your matrix source — typically the output of an ECS or physics step.
const matrixBuffer = new Float32Array(5000 * 16);

// Per-frame loop
function tick() {
    runPhysicsOrECS(matrixBuffer);            // your code
    binder.updateDOMTransforms(elements, matrixBuffer, activeCount);
    requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

That's the whole API surface for normal use.

---

## API

### `new DOMBinder(maxEntities)`

Constructor. Allocates a shadow buffer of `maxEntities * 16` floats (~64 bytes per entity). The shadow is NaN-poisoned so the first frame paints every entity unconditionally — guarantees correct initial state regardless of source matrix contents.

| Parameter      | Type     | Notes                                                     |
|----------------|----------|-----------------------------------------------------------|
| `maxEntities`  | `number` | Hard upper bound. Coerced via `\| 0`. Sets buffer capacity. |

### `updateDOMTransforms(elements, matrixBuffer, count)`

The hot path. For each of the first `count` entities:
1. Compares 16 matrix components against the shadow buffer.
2. If anything differs, copies the new matrix into the shadow and writes `el.style.transform = matrix3d(...)`.
3. If everything is identical, does nothing.

| Parameter      | Type                              | Notes                                                |
|----------------|-----------------------------------|------------------------------------------------------|
| `elements`     | `(HTMLElement \| null \| undefined)[]` | Cached node references. Sparse positions are skipped. |
| `matrixBuffer` | `Float32Array`                    | Flat 4×4 matrices, stride 16.                        |
| `count`        | `number`                          | Active entity count. Clamped against array length and `maxEntities`. |

### `invalidate()`

Re-poisons the shadow buffer with NaN. Forces every entity to repaint on the next `updateDOMTransforms` call. Useful after page-level events that may have desynced the DOM from your matrix state — route changes, theme toggles, fullscreen transitions, dynamic style sheet swaps.

---

## Performance characteristics

The hot path per entity:

```
updateDOMTransforms inner loop (per entity):
    16 × float comparison       ; dirty check, branch-predicted
    if dirty:
        16 × float copy         ; shadow update
        1  × matrix3d string    ; the only allocation
        1  × el.style.transform ; CSSOM write
    else:
        nothing
```

**Memory cost:** 64 bytes per entity, allocated once. 10,000 entities = 640 KB. The shadow buffer is the only persistent allocation.

**Per-frame cost (steady state):** zero allocations for entities that didn't change. One string per entity that did. Your scene's actual GC pressure tracks the dirty count, not the total count.

**Why `matrix3d` and not CSS variables:** `matrix3d` is a single CSSOM property write that the browser routes onto the compositor-only update path on every modern engine. CSS variables require multiple `setProperty` calls per element and may force style recalc on read. For arbitrary 4×4 matrices, `matrix3d` is faster.

**Why not the Web Animations API:** WAAPI is timeline-based — you describe a keyframed animation, the browser owns the schedule. This library is for the inverse case: your simulation owns the schedule, and you need direct per-frame writes. Not a competitor; a complement.

---

## When to reach for this

- You're building a physics simulation, particle system, or ECS-style game targeting DOM (because of accessibility, document semantics, or hybrid 2D/3D layouts).
- You have 100+ simultaneously-animated DOM nodes driven by a non-keyframed source.
- You're integrating a custom animation runtime into a React/Vue/Svelte/Solid app and want the runtime to bypass framework reconciliation entirely.
- You're rendering a virtualized list or canvas-style timeline where matrix math is the source of truth.

Skip this library if you're animating fewer than ~50 nodes with simple transitions — CSS animations and the Web Animations API are simpler and just as fast at that scale.

---

## Notes & limitations

- **3D matrices only.** The `matrix3d(...)` form takes 16 components. If your transforms are 2D-only, a sibling library `lite-dom-binder-2d` could halve the work — open an issue if you need it.
- **No alpha, color, or filter binding.** This is strictly transform. If you need opacity or color from the same buffer, write a sister binder; the dirty-check pattern generalizes cleanly.
- **The string allocation is fundamental.** `el.style.transform` is a setter on a CSSOM property; it accepts a string. There's no zero-alloc path through the standard DOM API. CSS Typed OM (`.attributeStyleMap`) avoids string parsing on the read side but still allocates `CSSTransformValue` objects on write — generally a wash.
- **Browser-only.** The implementation only touches the DOM on the write path; you can run the dirty check in any environment, but the actual `style.transform` assignment requires a real `HTMLElement`.

---

## License

MIT. See `LICENSE.txt`.
