# FanShare — Skills Cheat Sheet

Last updated: 2026-03-29 (gstack v0.14.5.0)

## Your Team (10 Positions)

Use these like talking to team members. Type the command during any session.

---

### Engineering (CTO + QA + DevOps)

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/review` | CTO — Code Review | Reviews your diff with 7 parallel specialist agents (testing, security, performance, etc.) | After finishing a feature, before shipping |
| `/plan-eng-review` | CTO — Architecture | Architecture, data flow, edge cases, test coverage review | Before starting a major feature |
| `/investigate` | CTO — Debugging | Root cause analysis. No fixes without diagnosis. | When something is broken |
| `/qa` | QA Engineer | Full QA pass — tests the app AND fixes bugs found | When a feature is "done" |
| `/qa-only` | QA Engineer | Same but only reports bugs, doesn't fix | When you want a bug report first |
| `/ship` | DevOps | Final checks, bumps version, creates PR. Now idempotent (safe to re-run). | When code is ready to deploy |
| `/land-and-deploy` | DevOps | Merges PR, deploys, verifies production health | After /ship creates the PR |
| `/canary` | DevOps | Watches the live app for errors post-deploy | Right after deploying |

### Design (Head of Design)

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/design-consultation` | Head of Design | Creates DESIGN.md — full design system (typography, color, spacing, motion) | Before building any frontend UI |
| `/plan-design-review` | Head of Design | Rates each design dimension 0-10, fixes the plan to reach 10 | Review UI design in a plan |
| `/design-review` | Head of Design | Visual/UX audit on live site — finds and FIXES spacing, hierarchy, slop | After building a frontend screen |
| `/design-shotgun` | Head of Design | Generates multiple AI design variants, opens comparison board for you to pick | When you want to explore visual options |
| `/design-html` | Head of Design | Converts approved mockup to production HTML/CSS | After /design-shotgun picks a winner |

### Marketing & Growth (NEW — project skills, live in `.claude/skills/`)

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/community` | Community Manager | Community strategy, weekly plans, channel health, engagement tracking | Building or reviewing community presence |
| `/growth` | Growth Marketer | Acquisition channels, partnerships, experiments, weekly metrics | Finding and converting traders |
| `/content` | Content Creator | Drafts tweets, threads, announcements in FanShare voice | Any time you need to post something |

### Finance (NEW — project skill)

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/expenses` | CFO | Tracks burn rate, cost checks, $80/mo pre-funding guardrail | Adding a service, checking burn, budget review |

### Strategy (Head of Product)

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/office-hours` | Head of Product | YC-style first principles session | Rethinking a feature from scratch |
| `/plan-ceo-review` | Head of Product | Scope and strategy challenge (4 modes: expand/hold/reduce) | Big product or business decisions |
| `/codex` | Second Opinion | Independent Codex review, challenge, or consult | When you want a brutally honest second opinion |
| `/autoplan` | All Reviewers | Runs CEO + Design + Eng reviews in sequence, auto-decides | New major feature needing full review |

### Security & Safety (use closer to mainnet)

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/cso` | Security Officer | Full security audit — secrets, supply chain, OWASP, STRIDE | Before any mainnet deploy |
| `/careful` | Safety | Warns before destructive commands (rm -rf, DROP TABLE, force push) | When touching prod or shared systems |
| `/guard` | Safety | /careful + /freeze combined — maximum protection | When debugging live systems |
| `/freeze` | Safety | Lock edits to one directory only | Scope changes tightly during debug |
| `/unfreeze` | Safety | Remove the freeze | Done debugging, want full access again |

### Utility

| Skill | Position | What it does | When to use |
|-------|----------|-------------|-------------|
| `/browse` | Browser | Headless Chromium — navigate, screenshot, test any URL | Look anything up, test a page, verify a deploy |
| `/connect-chrome` | Browser | Launch real Chrome with Side Panel — watch actions live | When you want to see the browser in real time |
| `/retro` | Retrospective | Weekly review of what shipped, patterns, growth areas | End of each sprint |
| `/document-release` | Docs | Updates README/CHANGELOG/CLAUDE.md to match what shipped | After each deploy |
| `/benchmark` | Performance | Page load, Core Web Vitals, bundle size regression detection | Checking frontend performance |
| `/learn` | Knowledge | Review, search, prune what gstack learned across sessions | "Didn't we fix this before?" |
| `/gstack-upgrade` | Maintenance | Upgrade gstack to latest version | When prompted about new version |

---

## Quick Reference

**I just finished coding a feature:**
→ `/review` → `/qa` → `/ship`

**I need users/traders:**
→ `/community strategy` → `/growth channels` → `/content calendar`

**I want to post something:**
→ `/content tweet` or `/content thread`

**Something is broken:**
→ `/investigate`

**Am I spending too much?**
→ `/expenses burn`

**New service costs money?**
→ `/expenses check`

**Big NBA game tonight?**
→ `/content tweet` (game reaction draft)

**End of the week?**
→ `/retro` → `/community health` → `/growth metrics`

**I want to explore design options:**
→ `/design-shotgun` → pick winner → `/design-html`

**What have we learned across sessions?**
→ `/learn`

---

## What's New in gstack v0.14.x

- `/review` now dispatches 7 specialist subagents in parallel (testing, security, performance, etc.)
- `/review` always runs adversarial analysis from both Claude and Codex, regardless of diff size
- `/ship` is idempotent — safe to re-run if push or PR creation fails
- `/design-shotgun` opens an interactive comparison board for rating design variants
- `/design-html` converts approved mockups to production HTML/CSS
- `/connect-chrome` launches real Chrome with a Side Panel you can watch live
- CSS Inspector in sidebar — pick any element, see CSS cascade, edit styles live
- `/learn` manages project learnings across sessions

---

## Permissions for Speed

**Auto-approve ("Always allow"):**
- File operations (Read, Write, Edit, Glob, Grep)
- Build commands (npm, cargo, anchor build/test, solana CLI)
- Git operations (status, diff, add, commit)

**Approve once each time:**
- `git push`
- `anchor deploy`
- `solana transfer`
- `vercel deploy`

---

## Skill Types

**gstack skills** (global, in `~/.claude/skills/gstack/`):
Updated by `/gstack-upgrade`. You don't modify these.

**Project skills** (local, in `.claude/skills/`):
`/community`, `/growth`, `/content`, `/expenses` — yours, versioned with your repo, never touched by upgrades. You can modify these anytime.
