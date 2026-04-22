# Tech-internal Handoff Workflow

How Tech Claude handles incoming CEO handoffs. Lives **inside** the CEO governance contract from `/Users/frankiewu/dev/fanshare/tech/CLAUDE.md` (frontmatter check, write boundaries, status-flip permission). This doc covers what Tech does *inside* those rules. Tech-owned, not CEO-governed — edit freely.

## Five-phase lifecycle

Ingest → Acknowledge → Park → Execute → Close.

### 1. Ingest (on session start, or when CEO flags a new handoff)
- Read `/Users/frankiewu/dev/fanshare/ceo/handoffs/open.md`. Scan rows where `To: tech`.
- For each new row: open the file. **Verify frontmatter `to: tech` first.** If missing or mismatched, STOP — do not read body, treat as no-access.
- Read body. Extract: DoD list, existing artifacts in `/tech/`, open asks, blockers.
- Surface assessment to user before any state change.

### 2. Acknowledge (when user confirms pickup)
- Frontmatter: `status: open → in-progress`
- Update `/Users/frankiewu/dev/fanshare/ceo/handoffs/open.md` row to `in-progress`
- Append `## Status notes` section above `## Completed` with first entry:
  ```
  - YYYY-MM-DD HH:MM (Tech Claude): Picked up. Plan: <one line>.
  ```

### 3. Park (auto, on every newly-acknowledged handoff)
- Add row to `/Users/frankiewu/dev/fanshare/tech/TODO.md` under `## Parked CEO handoffs`:
  ```
  - [ ] [topic] (handoff: <abs path>) — added YYYY-MM-DD — one-line summary
  ```
- Tech returns to whatever was in flight. **Does NOT execute the handoff.**
- User triggers execution by referencing the topic name (e.g. "do the observability handoff now").

### 4. Execute (only when user calls out the parked task)
- Treat the handoff's DoD as a checklist. Work item by item.
- Per item: capture evidence — `file:line`, commit SHA, screenshot path, dashboard URL.
- Append milestone notes to `## Status notes` as work lands.
- **Blocked → stop.** Write blocker to `## Status notes`, surface to user, status stays `in-progress`.
- **Need another domain → draft a NEW handoff** at `/Users/frankiewu/dev/fanshare/ceo/handoffs/` with appropriate `to:` field. Don't pollute current one.

### 5. Close

**Mandatory user verification gate.** Tech NEVER flips to `done` autonomously, even when every DoD item looks complete from Tech's side. The user is the canonical verifier — especially for items only they can check (third-party dashboards like PostHog/Tally/Vercel, business judgment, sensitive flows).

Sequence:
1. **Surface the DoD with per-item evidence.** Each item: status + concrete evidence (`file:line`, commit SHA, dashboard URL, screenshot path, browser test result). Be explicit when an item depends on user-side verification Tech can't perform alone.
2. **Ask the user to verify.** Phrasing: *"DoD verification — please confirm each item below meets your bar. Once you confirm, I'll flip to done."* List the items. List what the user needs to do (e.g. "open PostHog dashboard at X, click Y, confirm Z appears").
3. **Wait for explicit user confirmation.** "looks good", "yes flip it", "confirmed", "go ahead" — explicit. Silence or topic-switch is NOT confirmation.
4. **Only then:** fill `## Completed` (template below), frontmatter `status: in-progress → done` (or `abandoned`), update `/Users/frankiewu/dev/fanshare/ceo/handoffs/open.md` (remove from Active, add to Recently closed with date), remove row from `/Users/frankiewu/dev/fanshare/tech/TODO.md`.
5. Notify user with one-line summary.

If the user pushes back on any DoD item: stay `in-progress`, address the item, re-surface for verification.

## TODO.md mechanics

`/Users/frankiewu/dev/fanshare/tech/TODO.md` is persistent across sessions and tech-owned. Two sections:

- **Parked CEO handoffs** — acknowledged-but-not-executed handoffs. One row per handoff. Removed (not crossed out) on close. TODO.md is current state, not history.
- **Tech-internal deferrals** — optional second section for non-handoff parked work (bug-fix follow-ups, refactor candidates, sub-tasks discovered mid-execution that are out of scope). Off the CEO governance contract.

**Daily orientation step 1.5:** scan `TODO.md` after `open.md`. Anything under "Parked CEO handoffs" is acknowledged-but-deferred — execute only when user calls out the topic.

## Templates

### `## Status notes` (chronological log, sits above `## Completed`)

```markdown
## Status notes
- 2026-04-21 19:30 (Tech Claude): Picked up. Plan: A then B.
- 2026-04-21 20:15 (Tech Claude): Verified events.csv shows 9/11 firing. feedback_opened still missing.
- 2026-04-21 20:45 (Tech Claude): Fixed Tally onOpen wiring in tally-button.tsx. Deploying...
```

Optional — recommended for handoffs spanning >1 session, skip for short ones.

### `## Completed` (filled on close)

```markdown
## Completed
*Closed YYYY-MM-DD by Tech Claude. Status: DONE | DONE_WITH_CONCERNS | ABANDONED*

### DoD checklist
- [x] item 1 — evidence (file:line, commit SHA, screenshot path, dashboard URL)
- [x] item 2 — evidence
- [⚠] item 3 — partial, see Outstanding

### Files changed
- /Users/frankiewu/dev/fanshare/tech/path/to/file (commit abc1234)

### Commits
- abc1234 short msg

### Outstanding (if any)
- thing not done, why deferred, recommendation for follow-up
```

## Defaults (override per-handoff if needed)

| Decision | Default | Why |
|---|---|---|
| Park trigger | Auto on every acknowledge | User controls when to execute via call-out |
| `## Status notes` requirement | Optional (recommended for >1-session) | Friction for short handoffs |
| `## Status notes` placement | Above `## Completed` (chronological) | Receipt at the bottom |
| Closure sign-off | **Mandatory user verification before flipping to `done`** (not just "ask first" — explicit DoD walkthrough + user confirms each item) | User is the canonical verifier; Tech can't see third-party dashboards |
| Parked expiry | Never — only removed on close/abandon | TODO.md = current state, not history |
| gstack `/context-save` integration | Independent (TODO.md = task queue, /context-save = full session state) | Different concerns |

## Boundary checks

- **Never write to `/ceo/` outside the two permitted surfaces** — handoff files with `to: tech` (frontmatter + `## Status notes` + `## Completed`) and `open.md` row updates. Hard-ruled in `tech/CLAUDE.md`.
- **Never park a handoff without acknowledging.** Acknowledge → Park is one atomic step.
- **Never execute without user call-out.** Even if the user is in conversation about the topic, wait for an explicit "do X now" or equivalent.
- **Never flip to `done` without explicit user verification.** "Propose closure" is not enough — surface the DoD with evidence per item, ask the user to verify each, wait for explicit "yes / confirmed / looks good." Silence or topic-switch is NOT confirmation. Especially load-bearing for items Tech can't independently check (PostHog dashboard, Tally dashboard, Vercel logs, business judgment).
