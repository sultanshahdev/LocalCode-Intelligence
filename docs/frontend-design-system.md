# LocalCode Intelligence — Frontend Design System Specification

## 1. Executive Summary & Design Foundations

This specification establishes the visual and interaction design tokens for **LocalCode Intelligence**, directly influenced by the Kiro website design reference (`template.html`). 

The redesign strictly bifurcates LocalCode Intelligence into two dedicated environments sharing a unified visual language:
1. **Environment A — Product Landing Page (`/`)**: Storytelling, wide responsive grid, oversized rounded headings, choreographed entrance animations, interactive multi-scene product demonstration, capabilities showcase, workflow diagram, and transparent privacy disclosures.
2. **Environment B — Engineering Workspace (`/app`)**: Compact, dense, high-utility developer workspace featuring multi-pane navigation, repository switcher, instant search with ranked inspectable candidates, literal exact search, symbol explorer with usage inspection, 2D interactive repository map, and a slide-out source inspector drawer.

---

## 2. Color Palette & Surface Hierarchy

The color system relies on true pitch-black foundations with elevated obsidian and violet-tinted dark surfaces, punctuated by energetic purple accents and lavender framing.

| Token | Value | Semantic Role |
|---|---|---|
| `--color-bg` | `#000000` | Deep canvas / body background |
| `--color-surface` | `#090a11` | Primary card & panel container surface |
| `--color-surface-raised` | `#13141d` | Elevated workspace panels, hover states, sidebars |
| `--color-surface-hover` | `#1c1c28` | Interactive row & button hover state |
| `--color-border` | `#262438` | Structural subtle borders |
| `--color-border-subtle` | `#1a1926` | Low-contrast delimiters |
| `--color-purple-primary` | `#9147ff` | Primary CTA, focus rings, active indicator |
| `--color-purple-hover` | `#9f63ff` | Hover state for primary actions |
| `--color-purple-lavender` | `#c59eff` | Showcase frames, hero highlights, accent tags |
| `--color-purple-faint` | `rgba(145, 71, 255, 0.08)` | Selected row canvas tint, badge background |
| `--color-text-primary` | `#f5f4f7` | Crisp primary headings and code text |
| `--color-text-secondary` | `#c1bec6` | Explanatory secondary text |
| `--color-text-muted` | `#898590` | Subdued metadata, line numbers, shortcuts |
| `--color-success` | `#22c55e` | Ready status, complete coverage |
| `--color-warning` | `#f59e0b` | Scope warnings, truncated results |
| `--color-error` | `#ef4444` | Invalid paths, errors |

---

## 3. Typography Hierarchy

Fonts are chosen for maximum legibility and precision, combining modern rounded display type with geometric UI sans and a monospace code font.

| Role | Font Family Stack | Size / Weight | Usage |
|---|---|---|---|
| **Display** | `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif` | 2.5rem – 4.5rem / 800 | Hero headlines, section titles |
| **Heading** | `'Plus Jakarta Sans', system-ui, sans-serif` | 1.25rem – 1.875rem / 700 | Card titles, modal headers |
| **UI Body** | `'Inter', system-ui, -apple-system, sans-serif` | 0.875rem – 1rem / 400, 500 | Explanations, inputs, buttons |
| **Code / Mono** | `'JetBrains Mono', 'Fira Code', 'Consolas', monospace` | 0.8125rem – 0.875rem / 400, 600 | Code excerpts, paths, line numbers |

---

## 4. Spacing, Geometry & Radii

- **Base Radius (`--radius-sm`)**: `6px` — Small badges, pills, controls
- **Card Radius (`--radius-md`)**: `12px` — Cards, dropdowns, inputs
- **Container Radius (`--radius-lg`)**: `16px` — Main panels, code viewers
- **Showcase Radius (`--radius-xl`)**: `24px` — Large lavender-framed hero showcases
- **Grid Container**: Max-width `1240px` with fluid responsive padding (`1.5rem` to `3rem`).

---

## 5. Motion Tokens & Easing

Directly influenced by Kiro's CSS animations (`template.html`):

- **`ghost-float`**: `transform: translateY(0)` to `translateY(-10px)` (3s ease-in-out infinite)
- **`wf-rise`**: `opacity: 0; transform: translateY(6px)` to `opacity: 1; transform: translateY(0)` (350ms cubic-bezier(0.16, 1, 0.3, 1))
- **`wf-pop`**: `opacity: 0; transform: scale(0.95)` to `opacity: 1; transform: scale(1)` (250ms ease-out)
- **`wf-fade`**: `opacity: 0` to `opacity: 1` (200ms linear)
- **`wf-path-draw`**: `stroke-dasharray: 1; stroke-dashoffset: 1` to `stroke-dashoffset: 0` (800ms ease-out)
- **`terminal-cursor-blink`**: `0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 }` (1s step-end infinite)
- **`button-fill`**: Expanding gradient fill on hover using controlled pseudo-element / clip-path.
- **Accessibility Fallback**: `@media (prefers-reduced-motion: reduce)` disables all continuous loops and reduces transforms to simple instant opacity transitions.

---

## 6. Component Architecture & System Separation

- **Landing Page (`/`)**:
  - `Navbar`: Sticky dark bar with brand mark, navigation anchors, and "Open Workspace" CTA.
  - `HeroSection`: Word-staggered headline entrance ("Understand any codebase. Follow the evidence."), sub-copy, CTAs.
  - `HeroDemo`: 6-scene deterministic animated showcase (Repository load -> Query typing -> Candidate discovery -> Source inspector reveal -> 2D map node reveal -> Conclusion) with full Play/Pause/Replay controls.
  - `StorySections`: 5 alternating feature stories (Natural language search, Evidence grounding, 2D repo map, Symbol explorer, Local-first privacy).
  - `CapabilitiesSection`: Modular interactive cards for all 7 platform features with dynamic multilingual backend count.
  - `WorkflowSection`: 3-stage animated workflow diagram with connecting SVG lines (`wf-path-draw`).
  - `FaqSection`: Accordion FAQ with verified technical answers.
  - `Footer`: High-contrast CTA banner and footer metadata.

- **Workspace (`/app`)**:
  - `AppHeader`: Compact top bar with breadcrumbs, repository status indicator, and route toggle.
  - `Sidebar / ModeNav`: Seamless tab switcher (Overview, Semantic Search, Exact Search, Symbol Explorer, Repository Map, Files).
  - `MainCanvas`:
    - Overview: Quick stats, repository onboarding, indexing summary, supported languages.
    - Semantic Search: Query bar, rank badges, similarity score pills, inspect actions, honest unverified disclaimer.
    - Exact Search: Literal string search, case-sensitive & whole-word toggles, line highlights.
    - Symbol Explorer: Declarations list grouped by file/container, search filter, and AST usage finder.
    - Repository Map: Interactive 2D hierarchy visualization with pan/zoom/filter controls, directory toggles, and click-to-open.
    - File Navigator: Tree/directory structure.
  - `SourceInspector`: Slide-out right panel showing file path, line numbers, highlighted region, copy actions, and GitHub links.
