# Demo triage — eng workflow

What happens after ops hands eng a change request during live demo testing.
Ops decides *what* to change. This doc is *how* I (eng) turn that into a
shipped fix without breaking the demo in progress.

**Scope:** starts the moment ops drops an eng-ready spec in my lap. Ends when
the fix is live on prod, verified, and logged for the retro. Everything
upstream of that (how ops collects feedback, dedupes it, writes the spec) is
not in here.

---

## Intake format I expect from ops

Every request lands as a single message with these five fields:

```
PRIORITY:    P0 / P1 / P2
WHERE:       /invite  |  /trade/Player_XX  |  /portfolio  |  /leaderboard  |  backend
SYMPTOM:     what the user saw (verbatim if possible)
EXPECTED:    what should happen instead
REPRO:       exact steps OR "happened once, no repro" OR "multiple reports"
```

If any field is missing I ask ops once, then triage with what I have. I don't
guess at priority — if ops didn't set it, I default to **P1** and say so.

### Priority definitions — these are the only three

- **P0 — demo-breaking.** Something is on fire. A page 500s, a core action
  (connect, buy, sell, see balance) is impossible, or the site is leaking
  SOL. Users are actively blocked right now.
- **P1 — demo-hurting.** Works but is wrong/confusing/ugly enough that it's
  shaping user feedback in the wrong direction. Spread calc off, copy
  misleading, layout broken on mobile, badge renders as text.
- **P2 — polish.** Real, fix it later. Not blocking signal.

---

## The workflow

### 1. Triage (≤ 2 minutes)

First thing: **can this be a hot copy/CSS patch, or does it need logic?**
This branch determines everything downstream.

| If the change is… | Treat as |
|---|---|
| Text/copy only | Fast lane — copy fix |
| CSS / spacing / color only | Fast lane — styling fix |
| Adds/changes a button, flow, state, API call | Slow lane — logic fix |
| Touches Anchor program | Escalate to user — requires redeploy + re-init |
| Touches KV schema | Escalate to user — risks wiping live state |
| Touches oracle or pricing | Escalate to user — affects spread semantics mid-demo |

**If escalation is needed, I stop and ping the user before touching anything.**
The cost of an unintended program redeploy mid-demo is way higher than the
cost of a 5-minute pause.

### 2. Verify the repro locally (≤ 3 minutes)

Before editing anything I reproduce the bug on the preview server. No repro =
I can't verify the fix. If I can't reproduce in 3 min I tell ops "can't
reproduce" and ask for a user wallet + timestamp so I can check Helius/KV.

### 3. Implement

**Fast lane (copy/CSS):** edit, save, verify in preview, skip tests.
**Slow lane (logic):** edit, add/update test if the logic is testable,
`npm run test && npm run build`, verify in preview.

**Never skip the preview verify step during a live demo.** The build passing
doesn't mean the fix works. Use `preview_snapshot` to confirm the actual
rendered text/structure matches what ops asked for.

### 4. Ship

Direct to master. No PR branch during demo. Commit message format:

```
fix(demo): <one-line what changed>

P0/P1/P2 — reported by ops.
<one paragraph on what was broken and why this fixes it>
```

Push + `vercel --prod --yes` + health check. Health check is:
```
curl -sf https://fanshares.xyz<affected-path> -o /dev/null -w "%{http_code}\n"
```

Must be 200. If it's not, roll back (see below) before doing anything else.

### 5. Confirm back to ops

Reply with three things:

```
SHIPPED:   <commit sha>
DEPLOYED:  fanshares.xyz <path> → 200
VERIFY:    <one-line what ops should see when they refresh>
```

Then log it (next step). Do not move on until ops has confirmed the fix from
their side, because "deployed" ≠ "working for the real user who reported it."

### 6. Log for the retro

Append one line to `DEMO_TRIAGE_LOG.md` at repo root:

```
YYYY-MM-DD HH:MM — P[0/1/2] — <area> — <one-line issue> — <commit sha> — <minutes from intake to shipped>
```

This is the raw material for the post-demo retro. Don't editorialize. Just
log what happened and how fast. Patterns emerge over a day of reports.

---

## Rollback plan

If the fix makes things worse:

```bash
# Find the last known-good deploy in vercel
vercel ls --prod | head -5
# Promote the previous deployment (get the URL from the list above)
vercel promote <previous-deploy-url>
# OR hard revert in git + redeploy
git revert <bad-sha> --no-edit && git push origin master && vercel --prod --yes
```

Rollback target: **≤ 90 seconds** from noticing the regression to prod
serving the good version. Promote via Vercel is faster than a git revert, so
default to that unless the bad state is in KV (in which case promote won't
help — I'd have to restore from the reclaim/reset tooling).

Log the rollback to `DEMO_TRIAGE_LOG.md` too, marked `ROLLBACK`.

---

## Batching rule

**Never batch P0 fixes.** Ship each one alone. If I try to bundle two P0s, a
bad fix in one makes the other un-promotable via rollback.

**Batching is fine for P2s** at natural pauses (between test waves, during a
quiet stretch). Clearly delimit in the commit message:

```
polish(demo): bundle N P2 fixes

- <one line each>
```

Do not mix P0/P1 with P2 in the same commit ever.

---

## What I will *not* touch during a live demo without explicit user sign-off

These have blast radius beyond the demo, and the cost of a mistake is not
recoverable in a session:

- **`anchor deploy`** — program redeploy invalidates all live PDAs and all
  in-flight transactions. Requires full reset workflow afterward.
- **`npm run init-players`** — creates new mints, orphans all user holdings.
  Only run if the user explicitly says "do the reset" as in `RESET_WORKFLOW.md`.
- **`npm run reset-kv`** — wipes leaderboard, history, demo wallets. Users
  lose their position records.
- **Oracle formula changes** — anything that shifts `fair_value` mid-demo
  changes every spread reading and invalidates all prior trade signal.
- **Webhook schema changes** — events already recorded won't match new shape
  and telemetry export breaks retroactively.
- **`.env.local` / Vercel env changes** — can take the site down silently.

If ops writes a change request that implies any of the above, I escalate to
the user before touching anything. This is non-negotiable during a live
session.

---

## What counts as "done"

A fix is not done until all four are true:

1. Ops-reported SYMPTOM is gone when I reload the affected page in preview.
2. Prod returns 200 on the affected path.
3. Ops has confirmed from their side (they saw the fix in their session).
4. Entry is in `DEMO_TRIAGE_LOG.md`.

Missing any one = still in-flight. Doesn't matter how good the code looks.

---

## Fast-path examples

**Ops message:**
> P1 — /invite — button says "Claim $100" but the grant is actually 0.667 SOL which is like $100. Users keep asking if they're getting $100 cash. Change to "Claim your demo grant" or similar.

**My workflow:**
1. Triage: P1, copy-only, fast lane.
2. Open `app/invite/page.tsx`, change the button label.
3. `preview_snapshot` to confirm the new text renders.
4. Skip tests (copy change).
5. Commit, push, `vercel --prod --yes`, curl 200 check.
6. Reply: `SHIPPED: abc1234 / DEPLOYED: fanshares.xyz/invite → 200 / VERIFY: button now reads "Claim your demo grant"`.
7. Log to `DEMO_TRIAGE_LOG.md`.

End-to-end target: **under 5 minutes.**

**Ops message:**
> P0 — /trade/Player_LBJ — sell button doesn't do anything when clicked. Three users stuck.

**My workflow:**
1. Triage: P0, logic, slow lane.
2. Reproduce in preview: buy 0.01 SOL, click Sell, confirm nothing happens.
3. Check console logs for errors. Check whether the two-click arm flow is
   the culprit (recent change).
4. Fix. Add a test if the root cause is a regression in pure logic.
5. `npm run test && npm run build`.
6. Preview: click Sell, verify arm prompt shows, click again, verify trade
   submits.
7. Commit, push, deploy, health check.
8. Confirm to ops with the verification steps users should see.
9. Log.

End-to-end target: **under 15 minutes for a P0 involving logic.**

---

## If I'm stuck

If I've spent 15 minutes on a P0 without a fix in sight, I stop and tell the
user directly. I do not keep silently thrashing. Options at that point are:

1. **Ship the workaround.** Example: sell flow broken → add a banner that
   says "Sells paused, contact ops" and disable the Sell tab. Better than a
   button that does nothing.
2. **Roll back.** If the P0 started after a recent deploy, promote the
   previous deploy while I investigate.
3. **Pause the demo.** Ops tells users "we'll be right back" while we fix.
   Bad, but better than users trading against broken state.

The user picks. I don't choose between those three without a check-in.
