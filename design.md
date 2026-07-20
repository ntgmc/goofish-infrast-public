# Design — Goofish Infrastructure

Locked multi-page design system. Future Hallmark runs read this file first;
pages defer to it. Amend intentionally — this file is the rule.

## System

- Genre · modern-minimal
- Marketing macrostructure · Workbench
- Application macrostructure · Workbench
- Content macrostructure · Long Document
- Theme · custom tuned (vibe: "technical, restrained, precise, trustworthy")
- Axes · light / geometric-sans / cool-violet
- Navigation · N9 edge-aligned public shell; existing side rail for app and admin
- Footer · Ft2 inline rule, collapsing to a vertical list below 40rem
- Enrichment · existing product captures on marketing pages; none elsewhere

## Tokens (canonical · `tokens.css` is the source of truth)

```css
:root {
  --color-paper:      oklch(0.985 0.008 285);
  --color-paper-2:    oklch(0.958 0.012 285);
  --color-ink:        oklch(0.205 0.018 285);
  --color-ink-2:      oklch(0.390 0.016 285);
  --color-rule:       oklch(0.820 0.016 285);
  --color-accent:     oklch(0.470 0.185 285);
  --color-accent-ink: oklch(0.985 0.008 285);
  --color-focus:      oklch(0.550 0.220 285);

  --font-display: "Noto Sans SC Variable", "Microsoft YaHei", sans-serif;
  --font-body: "Geist Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, monospace;

  /* 4px spacing scale: --space-3xs through --space-4xl. */
  /* Major-third type scale: --text-xs through --text-display. */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 160ms;
  --dur-base: 220ms;
  --dur-slow: 300ms;
  --radius-card: 10px;
  --radius-pill: 999px;
  --radius-input: 7px;
}
```

## Composition rules

- One primary containment layer. `.tool-panel` is primary; `.tool-inset` is a ruled region, never a second card.
- Public pages lead with real product evidence. Avoid three-equal-column feature grids and generic SaaS section sequences.
- App and admin pages preserve route ownership and side-rail information architecture while using open data regions.
- Content pages use a 60–65ch reading measure, 1.65+ line height, and whitespace instead of card stacks.
- Display headings use `overflow-wrap: anywhere` and `min-width: 0`; document copy stays left aligned.
- Accent is a signal only: primary action, active state, focus, and compact status marks.

## CTA voice

- Primary · accent fill · 7px radius · compact 12px/18px rhythm · concrete verb
- Secondary · transparent or paper fill with visible rule · same radius and height
- Destructive · reserved semantic red; never reuse the brand accent

## Motion stance

- Composed and quiet: route opacity/short translate plus direct state transitions only.
- No nested stagger cascades, bounce, overshoot, parallax, or scroll-linked ornament.
- Reduced-motion fallback · no transform; opacity transitions at or below 150ms.

## Responsive contract

- Layout collapse at 60rem; phone typography and interaction rules at 40rem.
- Verify 320, 375, 414, and 768px; all phone hit targets are at least 44×44px.
- `html` and `body` clip accidental horizontal overflow without masking component-level defects.

## Exports

`tokens.css` in this project is the runtime source of truth. The following
portable exports mirror its light-mode core roles; dark values remain under
`.dark` in `tokens.css`.

### Tailwind v4

```css
@theme {
  --color-paper: oklch(98.5% 0.008 285);
  --color-paper-2: oklch(95.8% 0.012 285);
  --color-paper-3: oklch(92.5% 0.014 285);
  --color-rule: oklch(82% 0.016 285);
  --color-rule-2: oklch(88.5% 0.014 285);
  --color-muted: oklch(45.5% 0.018 285);
  --color-ink-2: oklch(39% 0.016 285);
  --color-ink: oklch(20.5% 0.018 285);
  --color-accent: oklch(47% 0.185 285);
  --color-accent-ink: oklch(98.5% 0.008 285);
  --color-focus: oklch(55% 0.220 285);
  --font-display: "Noto Sans SC Variable", "Microsoft YaHei", sans-serif;
  --font-body: "Geist Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4rem;
  --radius-card: 10px;
  --radius-pill: 999px;
  --radius-input: 7px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.5% 0.008 285)", "$type": "color" },
    "paper-2": { "$value": "oklch(95.8% 0.012 285)", "$type": "color" },
    "paper-3": { "$value": "oklch(92.5% 0.014 285)", "$type": "color" },
    "rule": { "$value": "oklch(82% 0.016 285)", "$type": "color" },
    "rule-2": { "$value": "oklch(88.5% 0.014 285)", "$type": "color" },
    "muted": { "$value": "oklch(45.5% 0.018 285)", "$type": "color" },
    "ink-2": { "$value": "oklch(39% 0.016 285)", "$type": "color" },
    "ink": { "$value": "oklch(20.5% 0.018 285)", "$type": "color" },
    "accent": { "$value": "oklch(47% 0.185 285)", "$type": "color" },
    "accent-ink": { "$value": "oklch(98.5% 0.008 285)", "$type": "color" },
    "focus": { "$value": "oklch(55% 0.220 285)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Noto Sans SC Variable, Microsoft YaHei, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Geist Variable, PingFang SC, Microsoft YaHei, sans-serif", "$type": "fontFamily" },
    "mono": { "$value": "SFMono-Regular, Consolas, Liberation Mono, monospace", "$type": "fontFamily" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4rem", "$type": "dimension" }
  },
  "duration": {
    "fast": { "$value": "160ms", "$type": "duration" },
    "base": { "$value": "220ms", "$type": "duration" },
    "slow": { "$value": "300ms", "$type": "duration" }
  }
}
```

### shadcn/ui

```css
:root {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: var(--color-paper-2);
  --card-foreground: var(--color-ink);
  --popover: var(--color-paper-2);
  --popover-foreground: var(--color-ink);
  --primary: var(--color-accent);
  --primary-foreground: var(--color-accent-ink);
  --secondary: var(--color-paper-3);
  --secondary-foreground: var(--color-ink);
  --muted: var(--color-paper-3);
  --muted-foreground: var(--color-muted);
  --accent: var(--color-rule-2);
  --accent-foreground: var(--color-ink);
  --border: var(--color-rule-2);
  --input: var(--color-rule);
  --ring: var(--color-focus);
  --radius: var(--radius-card);
}
```
