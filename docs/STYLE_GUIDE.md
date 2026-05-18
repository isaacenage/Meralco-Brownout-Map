# Style Guide — Meralco Rotational Brownout Map

A reference for every visual decision in the project: colors, typography, layering, translucency, animations, and the universal "no-rounded-corners" rule. All values are sourced from `src/app/globals.css`, `tailwind.config.ts`, and the React components under `src/`.

---

## 1. Design Tokens (CSS Custom Properties)

Defined on `:root` in `src/app/globals.css`:

| Token                 | Value       | Role                                                 |
| --------------------- | ----------- | ---------------------------------------------------- |
| `--bo-orange`         | `#f97316`   | Primary orange (badges, accents, focus rings)        |
| `--bo-orange-deep`    | `#ea580c`   | Deeper orange (popup labels, shadow tint base)       |
| `--bo-orange-soft`    | `#ffedd5`   | Soft orange backgrounds (pill rows, popup chips)     |
| `--bo-yellow`         | `#facc15`   | Highlight yellow (search match `<mark>`)             |
| `--bo-yellow-soft`    | `#fef3c7`   | Soft yellow (control hover bg)                       |
| `--bo-amber`          | `#fbbf24`   | Amber accent                                         |
| `--bo-ink`            | `#1f1306`   | Primary text (deep warm brown/black)                 |
| `--bo-ink-soft`       | `#6b4a2b`   | Secondary text (muted warm brown)                    |
| `--bo-cream`          | `#fffaf0`   | App background (warm off-white)                      |
| `--bo-border`         | `#fde68a`   | Soft amber border for popups                         |

These tokens are referenced via `var(--bo-*)` in CSS and `[var(--bo-*)]` arbitrary values in Tailwind class lists.

---

## 2. Typography

### Font Family — Body

System UI stack, defined on `body`:

```css
font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
-webkit-font-smoothing: antialiased;
text-rendering: optimizeLegibility;
```

No web font is loaded — every screen renders in the user's native OS sans-serif.

### Font Family — Intro Title

A stronger variant of the same stack, swapping in **"Segoe UI Black"** to render the giant "BROWNOUT NA NAMAN!" title heavier on Windows:

```css
.intro-title {
  font-family: ui-sans-serif, system-ui, -apple-system,
               "Segoe UI Black", "Helvetica Neue", Arial, sans-serif;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
```

### Type Scale & Treatments

| Use                          | Size                        | Weight       | Other                                         |
| ---------------------------- | --------------------------- | ------------ | --------------------------------------------- |
| Intro title line             | `clamp(36px, 12vw, 140px)`  | `900`        | `line-height: 0.95`, white text-shadow outline |
| Intro subtitle               | `clamp(11px, 3vw, 20px)`    | `700`        | `letter-spacing: 0.28em`, uppercase           |
| Location prompt headline     | `clamp(24px, 5.8vw, 34px)`  | `900`        | `letter-spacing: -0.01em`                     |
| Location banner text         | `22px`                      | `800`        | `line-height: 1.35`                           |
| Location banner eyebrow      | `14px`                      | `900`        | `letter-spacing: 0.28em`, uppercase           |
| Live header title            | `12–14px` (sm:sm)           | `700` (bold) | uppercase, `tracking-wide`                    |
| Live header time             | `text-xl → text-3xl`        | `extrabold`  | `tabular-nums`                                |
| Popup title                  | `13px`                      | `700`        | `text-transform: capitalize`                  |
| Popup label                  | `9px`                       | `700`        | `letter-spacing: 0.08em`, uppercase           |
| Popup window chip            | `11px`                      | `600`        |                                               |
| Eyebrow chips (orange)       | `10–11px`                   | `800`        | `letter-spacing: 0.24em` / `0.18em`, uppercase|
| Sidebar body                 | `12–13px`                   | `500–700`    | mix                                           |
| Sidebar barangay item        | `12px`                      | `400`        |                                               |

Everything that looks like a "label," "tag," or "eyebrow" is **uppercase with wide letter-spacing** (`tracking-widest` ≈ `0.1em`+).

---

## 3. The No-Rounded-Corners Rule (Universal)

This project deliberately uses **sharp/square corners everywhere**. Every place a `border-radius` is set, it is set to `0`. Even small dots and indicators are squares, not circles.

### CSS (`globals.css`)

```css
.live-dot              { border-radius: 0; }
.bo-scroll::-webkit-scrollbar-thumb { border-radius: 0; }
.maplibregl-ctrl-group { border-radius: 0 !important; }
.brownout-popup .maplibregl-popup-content { border-radius: 0; }
.brownout-popup-windows li { border-radius: 0; }
mark.bo-mark           { border-radius: 0; }
.intro-spark           { border-radius: 0; }
.loc-geo-btn           { border-radius: 0; }
.loc-input             { border-radius: 0; }
.loc-submit            { border-radius: 0; }
```

### In Components — Tailwind `rounded-none`

`rounded-none` is applied to literally every box, badge, pill, button, and "dot" element. Representative examples:

- **Cards**: `rounded-none bg-white border border-amber-200` (no-data fallback)
- **Disclaimer card** (legal page): `rounded-none border-2 border-orange-300`
- **Eyebrow chip**: `rounded-none bg-orange-100 text-orange-700` with a square 1.5×1.5 dot also `rounded-none`
- **Live header card**: `bg-white/95 backdrop-blur-md … rounded-none`
- **Dropdown panel**: `bg-white border border-amber-200 rounded-none`
- **Sidebar item**: `rounded-none border border-amber-200 bg-white`
- **Province count badge**: `rounded-none bg-orange-600 text-white`
- **Time-window pill button**: `rounded-none whitespace-nowrap` (orange variants)
- **Mobile drawer pill / open button**: `rounded-none shadow-[0_8px_24px_…]`
- **Close × button**: `w-8 h-8 rounded-none bg-amber-100`
- **Bottom-sheet grabber**: `w-12 h-1.5 rounded-none bg-amber-300`
- **Bullet dot beside each barangay row**: `w-1 h-1 rounded-none bg-orange-400` (a 1px square, not a circle)
- **Pulsing live dots / sparks**: `w-2.5 h-2.5 rounded-none` (square, even with the `animate-pulse` halo)
- **Search-result highlight `<mark>`**: square yellow background

If you ever add a new element, give it `rounded-none` (or `border-radius: 0`) — circles and pills break the visual language.

---

## 4. Translucent / Floating Surfaces

Several screens float UI on a translucent or backdrop-blurred panel. Catalog:

### 4.1 Location Prompt Overlay (`.loc-overlay`)

A fullscreen modal sitting over the map.

```css
.loc-overlay {
  position: fixed; inset: 0;
  z-index: 9998;
  background: radial-gradient(
    ellipse at 50% 30%,
    rgba(154, 52, 0, 0.82) 0%,
    rgba(120, 40, 0, 0.88) 60%,
    rgba(82, 26, 0, 0.92) 100%
  );
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: loc-fade-in 0.4s ease-out;
}
```

- **Translucency**: 82 → 92 % opacity radial gradient in deep burnt-orange.
- **Backdrop blur**: 6 px on both prefixed and unprefixed `backdrop-filter`.
- Card inside (`.loc-card`) has **`background: transparent; border: none; box-shadow: none`** — the prompt is the gradient itself, with content floated over it.
- Input field: `background: rgba(255, 255, 255, 0.14)` with `border: 1px solid rgba(255, 240, 224, 0.35)` and a white-glow focus ring (`box-shadow: 0 0 0 3px rgba(255,255,255,0.18)`).

### 4.2 Location Result Banner (`.loc-banner-wrap`)

The "Malas mo!" / "Yehey!" fullscreen result screen.

```css
.loc-banner-wrap {
  background: radial-gradient(
    ellipse at 50% 40%,
    rgba(154, 52, 0, 0.86) 0%,
    rgba(120, 40, 0, 0.9) 55%,
    rgba(82, 26, 0, 0.94) 100%
  );
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  animation: loc-banner-fade-in 0.45s ease-out;
}
```

- 86 → 94 % opacity, **10 px blur** (heavier than the prompt).
- Time pill inside (`.loc-banner-time`): `background: rgba(255, 255, 255, 0.18)` floating chip.
- Close button: `background: rgba(255, 255, 255, 0.16)` (hover bumps to `0.3`).

### 4.3 Live Header Card

The pinned schedule header above the map uses **near-opaque white with a blur** so the map is faintly visible behind it:

```tsx
<div className="bg-white/95 backdrop-blur-md border border-amber-200
                rounded-none shadow-[0_10px_30px_rgba(234,88,12,0.18)]">
```

- `bg-white/95` = `rgba(255,255,255,0.95)`
- `backdrop-blur-md` = `backdrop-filter: blur(12px)`
- Orange-tinted drop shadow (see §6).

### 4.4 MapLibre Attribution Pill

```css
.maplibregl-ctrl-attrib {
  background: rgba(255, 255, 255, 0.85) !important;
  color: var(--bo-ink-soft) !important;
}
```

85 % white over the live map.

### 4.5 Mobile Detail-Sheet Backdrop

The bottom-sheet that opens when a barangay is tapped on mobile dims the rest of the screen with a translucent black scrim:

```tsx
<button … className="fixed inset-0 bg-black/40 z-40" />
```

`bg-black/40` = `rgba(0,0,0,0.4)`. No blur — just dimming.

### 4.6 Search Input (Inside Prompt)

```css
.loc-input {
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 240, 224, 0.35);
}
.loc-input:focus {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.85);
}
```

Frosted-on-burnt-orange glass effect.

---

## 5. Page-Level Backgrounds

| Screen                                | Background                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `body` (default)                      | `var(--bo-cream)` = `#fffaf0`                                                                       |
| Intro overlay (`.intro-overlay`)      | Radial gradient `#ff8a2a → #ff6a00 → #e85a00` (bright orange → deep orange-red)                     |
| Intro brownout layer (`.intro-brownout`) | Solid `#000000` overlay animated from `opacity 0` to `1` with brownout-flicker keyframes        |
| Location prompt                       | Radial burnt-orange gradient (see §4.1)                                                             |
| Location result banner                | Radial burnt-orange gradient (see §4.2)                                                             |
| No-data fallback `<main>`             | `bg-gradient-to-br from-yellow-50 via-orange-50 to-white`                                           |
| Legal page `<main>`                   | `bg-gradient-to-br from-yellow-50 via-orange-50 to-white`                                           |
| Live header (live state)              | `bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-400`                                     |
| Live header (stale state)             | `bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400`                                       |
| Selected window panel (live now)      | `bg-gradient-to-r from-red-50 via-orange-50 to-yellow-50`                                           |
| Selected window panel (any other)     | `bg-gradient-to-r from-orange-50 to-yellow-50`                                                      |
| Province accordion header             | `bg-gradient-to-r from-orange-100 to-yellow-50` (hover → `from-orange-200 to-yellow-100`)           |
| Mobile drawer header strip            | `bg-gradient-to-r from-orange-50 to-yellow-50`                                                      |

---

## 6. Shadows

Always tinted **orange** (`rgba(234, 88, 12, …)`) — never neutral gray.

| Element                                 | Shadow                                          |
| --------------------------------------- | ----------------------------------------------- |
| MapLibre control group                  | `0 4px 14px rgba(234, 88, 12, 0.18)`            |
| Popup card                              | `0 10px 26px rgba(234, 88, 12, 0.25)`           |
| No-data fallback card                   | `0 10px 30px rgba(234, 88, 12, 0.18)` (arbitrary value) |
| Disclaimer card (legal)                 | `0 10px 30px rgba(234, 88, 12, 0.12)`           |
| Live header card                        | `0 10px 30px rgba(234, 88, 12, 0.18)`           |
| Window dropdown panel                   | `0 14px 36px rgba(234, 88, 12, 0.28)`           |
| Mobile "Tap to view" pill               | `0 8px 24px rgba(234, 88, 12, 0.22)`            |
| Mobile drawer (left edge of panel)      | `-12px 0 40px rgba(234, 88, 12, 0.25)`          |
| Mobile barangay sheet (top edge)        | `0 -12px 40px rgba(234, 88, 12, 0.35)`          |
| Geolocate button (location prompt)      | `0 10px 24px rgba(40, 12, 0, 0.32)` (warm-black) |
| Geolocate button hover                  | `0 12px 30px rgba(40, 12, 0, 0.4)`              |
| Headlines on dark gradient (text-shadow) | `0 2px 12px rgba(60, 18, 0, 0.45)` and similar  |

Outside-glow on the intro title is a layered text-shadow stack:

```css
text-shadow:
  -2px 0 0 #ffffff, 2px 0 0 #ffffff,
  0 -2px 0 #ffffff, 0 2px 0 #ffffff,
  -2px -2px 0 #ffffff, 2px -2px 0 #ffffff,
  -2px 2px 0 #ffffff, 2px 2px 0 #ffffff,
  0 0 28px rgba(255, 170, 80, 0.85);
```

A white "sticker outline" plus an outer warm-orange glow.

---

## 7. Animations & Keyframes

All custom animations live in `globals.css`. Tailwind's built-in `animate-pulse` is also used on small dots.

### 7.1 `live-pulse` — pulsing live dot

Used by `.live-dot` (the red dot in the LIVE header).

```css
.live-dot {
  width: 10px; height: 10px;
  background: #ef4444;
  border-radius: 0;            /* square dot, not circular */
  box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
  animation: live-pulse 1.6s cubic-bezier(0.66, 0, 0, 1) infinite;
}
@keyframes live-pulse {
  to { box-shadow: 0 0 0 14px rgba(239, 68, 68, 0); }
}
```

A red square that emits an expanding red halo every 1.6 s.

### 7.2 Intro Sequence

Three coordinated layers play simultaneously for ~5 s on app open:

#### `intro-enter` / `intro-exit`

```css
.intro-overlay  { animation: intro-enter 0.5s ease-out; }
.intro-leaving  { animation: intro-exit  0.6s ease-in forwards; }

@keyframes intro-enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes intro-exit  {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(1.05); }
}
```

Slight scale-up zoom on exit so it feels like the camera is pushing through.

#### `intro-brownout` — flicker → blackout

```css
@keyframes intro-brownout {
  0%   { opacity: 0; }
  18%  { opacity: 0; }
  22%  { opacity: 0.6; }     /* dip 1 */
  28%  { opacity: 0; }
  42%  { opacity: 0; }
  46%  { opacity: 0.78; }    /* dip 2 */
  52%  { opacity: 0; }
  62%  { opacity: 0; }
  66%  { opacity: 0.9; }     /* dip 3 */
  72%  { opacity: 0.4; }
  78%  { opacity: 0.92; }
  84%  { opacity: 0.55; }
  90%  { opacity: 1; }
  100% { opacity: 1; }       /* full black */
}
```

A `position: absolute; inset: 0` black overlay simulating three brownout dips followed by a wave into permanent blackout. Duration: `5s ease-in-out forwards`. **Intentionally non-strobing** — the comment in CSS calls this out explicitly.

#### `spark-pulse` — sparkle row above title

```css
.intro-spark {
  width: 10px; height: 10px;
  border-radius: 0;
  background: #fff;
  box-shadow: 0 0 18px 4px rgba(255,255,255,0.9);
  animation: spark-pulse 1.2s ease-in-out infinite;
}
.intro-spark-2 { animation-delay: 0.25s; }
.intro-spark-3 { animation-delay: 0.5s; }

@keyframes spark-pulse {
  0%, 100% { transform: scale(0.7); opacity: 0.6; }
  50%      { transform: scale(1.3); opacity: 1; }
}
```

Three square white-glow sparks pulsing in a staggered chase pattern.

#### `intro-content-fade` — sparkle + subtitle fade out under the blackout

```css
@keyframes intro-content-fade {
  0%, 50% { opacity: 1; }
  100%    { opacity: 0; }
}
```

Applied to `.intro-spark-row` and `.intro-subtitle` so they vanish into the blackout, leaving only the bright-orange "BROWNOUT NA NAMAN!" title visible.

### 7.3 Location Prompt

```css
.loc-overlay { animation: loc-fade-in 0.4s ease-out; }
@keyframes loc-fade-in { from { opacity: 0; } to { opacity: 1; } }

.loc-card { animation: loc-card-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes loc-card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}

.loc-banner-wrap { animation: loc-banner-fade-in 0.45s ease-out; }
@keyframes loc-banner-fade-in { from { opacity: 0; } to { opacity: 1; } }
```

The card animation uses an **expo-out** style easing (`cubic-bezier(0.16, 1, 0.3, 1)`) — fast in, soft settle.

### 7.4 Accordion Content (`.bo-accordion-content`)

Every accordion body (provinces, cities, advisory) slides + fades in:

```css
.bo-accordion-content { animation: bo-slide-in 0.18s ease-out; }
@keyframes bo-slide-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0);    }
}
```

### 7.5 Accordion Chevron (`.bo-chev`)

Rotates 90 ° clockwise when the section opens:

```css
.bo-chev      { transition: transform 0.18s ease; }
.bo-chev.open { transform: rotate(90deg); }
```

Used for province rows, city rows, and the Advisory toggle.

### 7.6 Button micro-interactions

```css
.loc-geo-btn { transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
.loc-geo-btn:hover:not(:disabled) { transform: translateY(-1px); … }
.loc-geo-btn:active:not(:disabled){ transform: translateY(0); }

.loc-submit { transition: transform 0.12s ease, background 0.15s ease; }
.loc-submit:hover:not(:disabled) { transform: translateY(-1px); background: #000; }

.loc-banner-close { transition: background 0.15s ease, transform 0.15s ease; }
.loc-banner-close:active { transform: scale(0.97); }

.loc-input  { transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
.loc-skip   { transition: color 0.15s ease; }
```

Consistent pattern: **120–150 ms** transitions, tiny vertical nudge on hover (`-1px`) and a 0.97 scale on press for confirm-style buttons.

### 7.7 Mobile Drawer Slide

In `BrownoutMap.tsx`:

```tsx
className={
  "fixed inset-0 z-40 mobile-drawer-pad transform transition-transform " +
  "duration-300 ease-out " +
  (drawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none")
}
```

300 ms ease-out horizontal slide from the right edge.

### 7.8 Tailwind `animate-pulse` usage

Small status dots:

- Awaiting-update square (`bg-white animate-pulse`) in the stale header.
- "Live Now" red square in the time-window panel (`bg-red-500 animate-pulse`).
- Loading polygons dot (`bg-orange-500 animate-pulse`).
- "Go Live" inner dot (`bg-white animate-pulse`) on the red CTA pill.

All are squares (`rounded-none`).

### 7.9 Live header dropdown chevron

The select-window button rotates its caret 180 ° when open:

```tsx
className={"… transition-transform " + (windowDropdownOpen ? "rotate-180" : "")}
```

### 7.10 Reduced-motion guards

Honored for users with `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  .intro-brownout, .intro-spark { animation: none !important; }
  .intro-brownout              { opacity: 1; }   /* skip flicker, stay black */
}
@media (prefers-reduced-motion: reduce) {
  .loc-overlay, .loc-card, .loc-banner-wrap { animation: none !important; }
}
```

---

## 8. Map-Specific Styling

### 8.1 MapLibre controls

```css
.maplibregl-ctrl-group {
  border-radius: 0 !important;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(234, 88, 12, 0.18) !important;
  border: 1px solid #fed7aa !important;
}
.maplibregl-ctrl-group button:hover { background: var(--bo-yellow-soft) !important; }
```

Mobile only — moves the geolocate control above the "Tap to view" pill:

```css
@media (max-width: 1023px) {
  .maplibregl-ctrl-bottom-right {
    bottom: calc(60px + env(safe-area-inset-bottom)) !important;
  }
}
```

### 8.2 Brownout polygons (in JS, `BrownoutMap.tsx`)

| State                     | Fill color  | Fill opacity | Outline width |
| ------------------------- | ----------- | ------------ | ------------- |
| Default                   | `#fc5c00`   | `0.6`        | `1.5`         |
| Hover                     | `#000000`   | `0.85`       | `3`           |
| Tap-selected (touch only) | `#000000`   | `0.85`       | `3`           |

Outline color is always `#1e3a8a` (deep navy).

### 8.3 Map popup (`.brownout-popup`)

```css
.brownout-popup .maplibregl-popup-content {
  background: #fff;
  border: 1px solid var(--bo-border);
  border-radius: 0;
  padding: 10px 12px;
  box-shadow: 0 10px 26px rgba(234, 88, 12, 0.25);
}
```

Window chips inside the popup are orange "tags":

```css
.brownout-popup-windows li {
  background: var(--bo-orange-soft);
  color: var(--bo-orange-deep);
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 0;       /* still square */
  font-size: 11px;
}
```

---

## 9. Scrollbars

### Sidebar — `.bo-scroll`

Custom-styled square thumb, orange.

```css
.bo-scroll::-webkit-scrollbar       { width: 10px; }
.bo-scroll::-webkit-scrollbar-track { background: transparent; }
.bo-scroll::-webkit-scrollbar-thumb {
  background: #fed7aa;
  border-radius: 0;
  border: 2px solid var(--bo-cream);
}
.bo-scroll::-webkit-scrollbar-thumb:hover { background: #fdba74; }
```

### Hidden scrollbar — `.bo-pill-scroll`

Used on horizontally-scrolling pill rows:

```css
.bo-pill-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.bo-pill-scroll::-webkit-scrollbar { display: none; }
```

---

## 10. Layout & Mobile Safe-Area Handling

| Class                      | Purpose                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `.app-body`                | `overscroll-behavior-y: none` — prevents rubber-banding the entire page.                 |
| `.app-shell`               | `100vw / 100dvh` shell that hosts the map fullscreen. Uses `dvh` so mobile chrome doesn't push the map off-screen. |
| `.bo-overscroll-contain`   | `overscroll-behavior: contain; -webkit-overflow-scrolling: touch` — keeps drawer scroll from bleeding into the map. |
| `.live-header-pos`         | Top-left positioning with `env(safe-area-inset-*)` insets. At `min-width: 1024px` it un-stretches to top-left only. |
| `.mobile-pill-pos`         | Bottom-center pill, `bottom: calc(12px + env(safe-area-inset-bottom))`.                  |
| `.mobile-drawer-pad`       | Drawer respects top/bottom/right notches via `env(safe-area-inset-*)`.                   |
| `.mobile-sheet-pad`        | Bottom sheet padding for the home indicator.                                             |
| `.intro-safe-pad`          | Fallback no-data screen with full safe-area padding.                                     |

The map container is also explicitly opted **back into** native gestures so MapLibre can handle pinch/rotate:

```css
body { touch-action: manipulation; }   /* page disables double-tap zoom */
.maplibregl-map,
.maplibregl-canvas-container,
.maplibregl-canvas { touch-action: none; }   /* map handles its own gestures */
```

Plus a hand-written `disableZoomScript` in `src/app/layout.tsx` that calls `e.preventDefault()` on `gesturestart`, `gesturechange`, `gestureend`, multi-touch `touchmove`, double-tap `touchend`, `dblclick`, and `Ctrl+wheel` — but only when the event target is **outside** `.maplibregl-map`, so map gestures still work.

---

## 11. Z-Index Layering

| Layer                              | z-index    |
| ---------------------------------- | ---------- |
| Intro overlay                      | `9999`     |
| Location prompt overlay            | `9998`     |
| Location result banner             | `35`       |
| Mobile detail sheet                | `50`       |
| Mobile sheet backdrop / drawer     | `40`       |
| Live header (dropdown open)        | `40`       |
| Mobile open-drawer pill            | `30`       |
| Live header (dropdown closed)      | `20`       |
| Intro content layer                | `4`        |
| Intro brownout black overlay       | `3`        |

The intro and location prompt sit at four-digit z-indexes specifically because the map controls and tooltips from MapLibre can climb to the 10s/30s.

---

## 12. Color Usage Patterns

A quick reference for "where does each tint live?":

- **Bright orange (`orange-500 → 600`)** — primary CTAs, badges, "live" emphasis, accordion bullets.
- **Soft orange (`orange-50 → 100`)** — backgrounds for chips, hover states, gentle header gradients.
- **Yellow (`yellow-50 → 100`, `--bo-yellow`)** — secondary accent: search match highlight, sub-stripe in gradients, accordion hover.
- **Amber (`amber-100 → 300`, `--bo-border`)** — borders, neutral hover, "stale" warning header.
- **Red (`red-500 → 600`)** — strictly reserved for "live right now" indicators and the "Go Live" CTA. Nothing else should be red.
- **Deep navy (`#1e3a8a`)** — only used as the polygon outline on the map for legibility against the orange fill.
- **Warm black (`#1a0a02 → #000`)** — Enter button in the location prompt, hover state of black-ish buttons.
- **White/cream (`var(--bo-cream)`, `#fff`)** — main surfaces; never pure neutral gray cards.

There are **no cool grays** anywhere — everything neutral is warmed toward cream, amber, or brown.

---

## 13. Quick Do/Don't

**Do**

- Use `rounded-none` (or `border-radius: 0`) on every new element, including dots and indicators.
- Tint shadows orange (`rgba(234, 88, 12, …)`).
- Reach for `var(--bo-ink)` / `var(--bo-ink-soft)` for text — not Tailwind grays.
- Use system font stack; add `font-extrabold` + uppercase + `tracking-widest` for label-style text.
- Respect `env(safe-area-inset-*)` on anything that pins to screen edges.
- Guard custom animations with `@media (prefers-reduced-motion: reduce)`.

**Don't**

- Don't introduce `border-radius` other than `0` — not even for "dots."
- Don't add cool gray (`gray-*`, `slate-*`, `zinc-*`) text/borders; use the warm tokens.
- Don't use neutral black drop shadows; use orange-tinted ones.
- Don't load a custom web font — the system stack is intentional.
- Don't use bare opacity-1 black scrims on prompts; prefer the burnt-orange radial gradient with `backdrop-filter: blur`.
- Don't bypass the layout's anti-zoom script for non-map UI.
