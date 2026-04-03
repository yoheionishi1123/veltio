# Veltio Design System

> Apple-inspired design language for a B2B SaaS analytics tool.
> Principle: data is king — the UI should never compete with the numbers.

---

## 1. Philosophy

Veltio's design language borrows Apple's core tenets and applies them to a professional analytics context:

- **Clarity** — every element earns its place. No decorative borders, no gradient cards, no shadow rings.
- **Deference** — the interface recedes so the data stands forward.
- **Depth** — subtle shadows and layered surfaces give just enough spatial context without noise.
- **Consistency** — one accent color, one radius scale, one shadow recipe.

---

## 2. Color Tokens

### Core palette

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#f5f5f7` | Page canvas (Apple light gray) |
| `--bg-2` | `#ebebed` | Hover/active background |
| `--surface` | `#ffffff` | Panel and card surfaces |
| `--surface-2` | `#f5f5f7` | Secondary surface, nested sections |
| `--surface-3` | `#ebebed` | Tertiary, input backgrounds, progress tracks |

### Text

| Token | Value | Usage |
|---|---|---|
| `--ink` | `#1d1d1f` | Primary text (Apple near-black) |
| `--ink-2` | `rgba(0,0,0,0.64)` | Secondary text, labels |
| `--muted` | `rgba(0,0,0,0.40)` | Tertiary text, placeholders, kickers |

### Borders

| Token | Value | Usage |
|---|---|---|
| `--line` | `rgba(0,0,0,0.08)` | Default ultra-thin border |
| `--line-2` | `rgba(0,0,0,0.12)` | Slightly stronger, inputs, ghost buttons |

### Accent — Veltio Orange

There is exactly **one interactive accent color**. Do not introduce secondary accent colors.

| Token | Value | Usage |
|---|---|---|
| `--accent` | `#f97316` | Primary action, active states, focus rings |
| `--accent-hover` | `#ea6c06` | Hovered accent |
| `--accent-dim` | `rgba(249,115,22,0.10)` | Accent tint backgrounds |
| `--accent-text` | `#c2410c` | Orange text on white surfaces |

### Semantic

| Token | Value |
|---|---|
| `--success` | `#16a34a` |
| `--success-dim` | `rgba(22,163,74,0.10)` |
| `--danger` | `#dc2626` |
| `--danger-dim` | `rgba(220,38,38,0.10)` |
| `--warn` | `#f59e0b` |
| `--warn-dim` | `rgba(245,158,11,0.10)` |
| `--blue` | `#2563eb` |
| `--blue-dim` | `rgba(37,99,235,0.10)` |

### Legacy aliases

These token aliases are kept permanently so legacy JS and templates continue to work without changes.

```css
--panel:   var(--surface);
--panel-2: var(--surface-2);
--panel-3: var(--surface-3);
```

---

## 3. Typography

**Typeface:** Plus Jakarta Sans (already loaded via CDN). Fallback chain: `"Noto Sans JP", "Hiragino Sans", sans-serif`.

### Scale

| Role | Size | Weight | Tracking | Line-height |
|---|---|---|---|---|
| h1 | 22px | 700 | -0.02em | 1.15 |
| h2 | 18px | 700 | -0.02em | 1.20 |
| h3 | 15px | 600 | -0.015em | 1.25 |
| Body | 14px | 400 | -0.01em | 1.55 |
| Label / secondary | 13px | 500 | -0.01em | 1.5 |
| Kicker / ALL CAPS | 10–11px | 700 | +0.08em | — |
| Metric value (KPI) | 28–32px | 700 | -0.03em | 1.0 |

### Kickers / section labels

All uppercase labels use `text-transform: uppercase`, `letter-spacing: 0.08em`, `font-weight: 700`, and `color: var(--muted)`. This pattern is applied via `.dashboard-card-kicker`, `.metric-card-label`, `.account-field-label`, etc.

### Numbers

Metric values displayed in KPI cards or validation summaries use `letter-spacing: -0.03em` and `line-height: 1.0` to create a compact, data-first appearance.

---

## 4. Radius Scale

| Token | Value | Used for |
|---|---|---|
| `--radius-xs` | 6px | Tiny UI chips, step indicators |
| `--radius-sm` | 10px | Inputs, buttons, small cards |
| `--radius` | 14px | Standard cards, chart cards |
| `--radius-lg` | 18px | Main panels, primary containers |
| `--radius-pill` | 999px | Badges, tags, pill buttons |

---

## 5. Shadows

Two shadow recipes cover all use cases. Never stack multiple shadow layers on a single element.

| Token | Value | Used for |
|---|---|---|
| `--shadow-card` | `0 2px 20px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)` | Cards, panels, resting surfaces |
| `--shadow-float` | `0 4px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)` | Hover state, modals, dropdowns |

---

## 6. Layout

### Sidebar

- Width: `220px` (`--sidebar-w`)
- Background: `var(--surface)` — pure white, not gray
- Right border: `1px solid var(--line)`
- Nav items: no background by default; text + icon only
- Hover: `background: var(--bg)` (very subtle off-white)
- Active: `background: var(--accent-dim)`, `color: var(--accent)`, `font-weight: 600`

### Page canvas

- Background: `var(--bg)` — Apple light gray `#f5f5f7`
- Max content width: `1140px` via `.container`
- Padding: `24px 20px 40px`

### Spacing system

All spacing values are multiples of 4px: 4, 8, 12, 16, 20, 24, 32, 40.

---

## 7. Components

### Panels

```css
background: var(--surface);
border: 1px solid var(--line);
border-radius: var(--radius-lg);   /* 18px for primary panels */
box-shadow: var(--shadow-card);
```

Use `--radius` (14px) for inner cards nested within panels.

### Metric / KPI Cards

- White surface (`var(--surface)`), single thin border, card shadow
- No gradient backgrounds
- No colored box-shadow rings
- State is communicated via a left border accent only:
  - Primary state: `border-left: 3px solid var(--accent)`
  - Critical state: `border-left: 3px solid var(--danger)`
- Label (kicker): uppercase, 10.5px, `--muted`
- Value: 30px, weight 700, `letter-spacing: -0.03em`, `line-height: 1.0`

### Buttons

**Primary:**
```css
background: var(--accent);
color: #fff;
border-radius: var(--radius-sm);   /* 10px — not a pill */
padding: 8px 16px;
font-weight: 600;
```

**Ghost:**
```css
background: transparent;
border: 1px solid var(--line-2);
color: var(--ink-2);
border-radius: var(--radius-sm);
```

**Small modifier (`.btn-sm`):**
```css
padding: 5px 12px;
font-size: 12.5px;
```

**Danger:**
```css
background: var(--danger);
color: #fff;
```

**Focus state (all buttons):**
```css
outline: 2px solid var(--accent);
outline-offset: 2px;
```

### Inputs & Selects

```css
background: var(--surface);
border: 1px solid var(--line-2);
border-radius: var(--radius-sm);
```

Focus: `border-color: var(--accent)` (no glow by default).

### Tabs

Use a pill-shaped container with `background: var(--surface-3)`. Active tab gets `background: var(--surface)` with `--shadow-card`, creating a "lifted" effect without any colored highlight.

### Badges / Tags

```css
padding: 2px 8px;
border-radius: var(--radius-pill);
font-size: 11px;
font-weight: 600;
```

Color follows semantic tokens: success-dim/success, danger-dim/danger, etc.

### Tables

- `th`: 10.5px, uppercase, `letter-spacing: 0.07em`, `font-weight: 700`, `--muted`
- `td`: 13px, `--ink`
- Row hover: `background: var(--surface-2)`
- Borders: `1px solid var(--line)` (ultra-thin)

---

## 8. Diagnosis / Finding Cards

Left-border accent communicates severity without overwhelming the content:

| State | Border color |
|---|---|
| Critical | `var(--danger)` |
| Warning | `var(--warn)` |
| OK | `var(--success)` |
| Default | `var(--line)` |

---

## 9. Charts

Chart cards follow the standard card recipe:
- `background: var(--surface)`
- `border: 1px solid var(--line)`
- `border-radius: var(--radius)` (14px)
- `box-shadow: var(--shadow-card)`

No gradient backgrounds inside chart areas. Data ink should dominate.

---

## 10. Do's and Don'ts

### Do
- Use `var(--surface)` (white) for all cards and panels
- Use `var(--bg)` or `var(--bg-2)` only for the page canvas or hover states
- Use a single left-border accent to signal card state
- Keep kickers ALL CAPS with `--muted` color
- Use `--shadow-card` as the only resting shadow; `--shadow-float` only on hover/elevated
- Apply `letter-spacing: -0.03em` to all large numeric values

### Don't
- Don't use gradient backgrounds on metric cards
- Don't use colored box-shadow rings (e.g., `0 0 0 2px rgba(...)`)
- Don't introduce new accent colors — orange is the only interactive color
- Don't use `border-radius: 20px` or `border-radius: 999px` on primary action buttons
- Don't nest more than two surface layers (`--surface` → `--surface-2`)
- Don't add shadows to items that are already inside a shadowed container
