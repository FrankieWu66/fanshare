# Design System — FanShare

## Product Context
- **What this is:** Solana DEX where fans trade tokens representing NBA player performance
- **Who it's for:** Crypto-native sports bettors with existing Solana wallets
- **Space/industry:** Crypto trading + sports prediction (pump.fun model applied to real-world performance)
- **Project type:** Web app (Next.js), two core screens: market grid + trade page

## Aesthetic Direction
- **Direction:** Industrial-Utilitarian meets sports arena
- **Decoration level:** Intentional (subtle grain texture on cards, not flat)
- **Mood:** Data-dense like a trading terminal but with the warmth and energy of an NBA broadcast. Scoreboard typography, arena-light warmth. Not another cold dark-mode DEX.
- **Reference sites:** pump.fun (dark, raw, functional), Jupiter/jup.ag (premium dark, chartreuse), Polymarket (light, editorial)
- **Differentiation:** Amber accent (basketball/arena lights) instead of green/blue. Warm near-black instead of cold blue-black. Geometric display font with scoreboard energy. No crypto trading platform currently owns the sports visual identity.

## Typography
- **Display/Hero:** Cabinet Grotesk (800 weight) — geometric, strong, modern scoreboard energy. Loaded from Fontshare CDN.
- **Body:** DM Sans (400/500/600/700) — clean, readable, excellent tabular-nums support for prices. Loaded from Google Fonts.
- **UI/Labels:** DM Sans (same as body)
- **Data/Tables:** Geist Mono (400/500) — crisp monospace for prices, token amounts, addresses. Loaded from jsDelivr CDN.
- **Code:** Geist Mono
- **Loading:** CDN (Fontshare for Cabinet Grotesk, Google Fonts for DM Sans, jsDelivr for Geist Mono)
- **Scale:**
  - Hero: 64px / 4rem (clamp 40px-64px)
  - H1: 36px / 2.25rem
  - H2: 24px / 1.5rem
  - H3: 18px / 1.125rem
  - Body: 15px / 0.9375rem
  - Small: 13px / 0.8125rem
  - Caption: 11px / 0.6875rem
  - Mono data: 14px / 0.875rem (prices, amounts)
  - Mono small: 10px / 0.625rem (badges, labels)

## Color
- **Approach:** Restrained (one signature accent + neutrals, color is rare and meaningful)
- **Background:** #09090B — warm near-black (not cold blue-black)
- **Surface/Card:** #141417 — elevated dark surface
- **Border:** #1E1E22 — subtle separation
- **Border low:** rgba(30, 30, 34, 0.5) — ultra-subtle borders
- **Primary text:** #FAFAF9 — warm white (not pure white)
- **Muted text:** #71717A — readable gray
- **Accent:** #F59E0B — amber/orange (basketball, arena lights, brand signature)
- **Accent subtle:** rgba(245, 158, 11, 0.15) — for badges and hover backgrounds
- **Positive:** #22C55E — green (price up, buy confirmation)
- **Negative:** #EF4444 — red (price down, errors)
- **Info:** #3B82F6 — blue (neutral information, oracle updates)
- **Light mode:** Not supported for v1. Dark-only matches crypto conventions and the arena aesthetic.

### Semantic Color Usage
- Accent (#F59E0B): brand elements, "Undervalued" badges, active tab highlight, "Practice mode" indicator, hover borders, supply progress bars, **primary marketing CTA** (e.g., /invite "Claim $100")
- Positive (#22C55E): price-up indicators, buy buttons (in-app trade widget), transaction success alerts
- Negative (#EF4444): price-down indicators, sell buttons (in-app trade widget), "Overvalued" badges, error alerts
- Info (#3B82F6): neutral data, oracle update notifications
- Muted (#71717A): secondary text, labels, inactive UI, "Fair value" badges

**Button color semantic split (decided 2026-04-22):** Buy/Sell buttons INSIDE the trade widget are positive/negative (green/red) because those are financial actions where color carries critical meaning about direction. Primary CTAs OUTSIDE the trade widget (marketing, onboarding, grant-claim) use amber — the brand color — because these are identity/conversion actions, not directional trades. Same system, two different semantic registers.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (not cramped like Dexscreener, not airy like Polymarket)
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)
- **Card padding:** 16px
- **Card gap:** 12px
- **Section gap:** 48px

## Layout
- **Approach:** Grid-disciplined
- **Grid:** 3 columns (market), 1 column centered (trade)
- **Max content width:** 1200px (market), 480px (trade widget)
- **Border radius:**
  - sm: 4px (badges, pills)
  - md: 8px (buttons, inputs, inner cards)
  - lg: 12px (cards, panels)
  - xl: 16px (trade widget, modals)

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150ms) medium(250ms)
- **Animations:**
  - Card hover: translateY(-1px) + border-color transition (150ms)
  - Price changes: number tick animation (250ms)
  - Input focus: border-color transition (150ms)
  - No decorative animation, no entrance animations, no scroll-driven effects

## Component Patterns

### Player Card
- Emoji in amber-tinted container (rgba(245,158,11,0.08))
- Player name in DM Sans 600, meta in Geist Mono 11px muted
- Price change badge: green bg for up, red bg for down
- Market price in Geist Mono 18px, stats index in Geist Mono 13px muted
- Spread signal badge: amber for undervalued, red for overvalued, gray for fair
- Supply progress bar: 3px height, amber fill
- Hover: amber border glow + subtle lift

### Trade Widget
- Centered, max 480px
- Tab switcher: amber active tab on dark bg
- SOL input: Geist Mono 16px, amber focus border
- Preview card: label/value rows in 12px
- Buy button: full-width, positive green, bold
- Sell button: full-width, negative red, bold

### Primary Marketing CTA (Amber)
- Use case: conversion action OUTSIDE the trade widget — onboarding, invite page, grant claim, future marketing surfaces. NOT for directional trade actions (those stay green/red per Trade Widget).
- Shape: height 56px (`h-14`), radius `xl` (16px), horizontal padding 24px (`px-6`)
- Fill: solid `--accent` (#F59E0B); hover `#FBBF24` (amber-400, brighter warm-up)
- Text: `--accent-foreground` (warm near-black), DM Sans bold 16px, letter-spacing -0.005em
- Shadow: `0 8px 32px -8px rgba(245,158,11,0.4)` default; hover deepens to `0 12px 40px -8px rgba(245,158,11,0.5)`
- Motion: `hover:-translate-y-px` (1px lift), `active:translate-y-0`, 150ms ease-out
- Label pattern: action verb + outcome noun + rightward arrow. Example: `"Claim $100 →"`, `"Start Trading →"`. Arrow is part of the label, not a separate icon.
- Adjacent ghost link: secondary "how does this work" link sits immediately to the right, `h-11`, `text-[13px]`, muted → foreground on hover. Never full-width. Never amber.
- Width: hug-content (`inline-flex`), NOT `w-full`. The Buy/Sell full-width pattern lives only inside the trade widget.
- Limit: at most one amber CTA per viewport. If two primary actions are needed on the same screen, step back to the information architecture — the page has a scope problem, not a button problem.

### Alerts/Toasts
- Success: green tint bg, green text, green border
- Error: red tint bg, red text, red border
- Info: blue tint bg, blue text, blue border
- Warning: amber tint bg, amber text, amber border

## CSS Variables (copy to globals.css)
```css
:root {
  --background: #09090B;
  --foreground: #FAFAF9;
  --surface: #141417;
  --border: #1E1E22;
  --border-low: rgba(30, 30, 34, 0.5);
  --muted: #71717A;
  --accent: #F59E0B;
  --accent-subtle: rgba(245, 158, 11, 0.15);
  --positive: #22C55E;
  --negative: #EF4444;
  --info: #3B82F6;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --font-display: 'Cabinet Grotesk', sans-serif;
  --font-body: 'DM Sans', sans-serif;
  --font-mono: 'Geist Mono', monospace;
}
```

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-01 | Initial design system created | /design-consultation based on pump.fun, Jupiter, Polymarket competitive research |
| 2026-04-01 | Amber accent over green/blue | Every crypto DEX uses green or blue. Amber = basketball, arena lights, visual differentiation |
| 2026-04-01 | Cabinet Grotesk for display | Geometric, strong, scoreboard energy. Distinct from Inter/Poppins defaults |
| 2026-04-01 | Dark-only, no light mode | Matches crypto conventions + arena aesthetic. Light mode deferred post-beta |
| 2026-04-01 | Warm near-black (#09090B) | Jupiter/Dexscreener lean cold. Warm feels like arena lighting, not a server room |
