# gstack

For all web browsing, always use the `/browse` skill from gstack. Never use `mcp__claude-in-chrome__*` tools.

## Available gstack skills

/office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex, /cso, /autoplan, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

## Deploy Configuration (configured by /setup-deploy)
- Platform: Vercel
- Production URL: https://fanshare-1.vercel.app
- Deploy workflow: `vercel --prod --yes` (CLI push, no auto-deploy from GitHub yet)
- Deploy status command: `vercel ls --prod`
- Merge method: squash
- Project type: web app (Next.js 16)
- Post-deploy health check: `curl -sf https://fanshare-1.vercel.app -o /dev/null -w "%{http_code}"`

### Custom deploy hooks
- Pre-merge: `npm run test && npm run build`
- Deploy trigger: `vercel --prod --yes`
- Deploy status: `vercel inspect <deployment-url>`
- Health check: https://fanshare-1.vercel.app (HTTP 200)

## Scripts
- `npm run init-players` — initializes all 15 player bonding curves on devnet. Loads env from `.env.local`. Saves mint addresses to `app/lib/player-mints.json`. Resume-safe (skips already-initialized players by checking the json file).
- `npm run oracle` — fetches live NBA stats from balldontlie.io and updates on-chain StatsOracle. Use `npm run oracle:mock` for offline testing.
- Both scripts load env from `.env.local` (not `.env`) via explicit `dotenv.config({ path: '.env.local' })`.

### Oracle authority note
The `stats_oracle` accounts are initialized with the `init-players` authority (`CsGh5T7...`, main deploy wallet) as the oracle authority. The `update_oracle` instruction requires signing with that same wallet. The oracle script defaults to `oracle-keypair.json` but falls back to `~/.config/solana/id.json`. To force the main wallet: `ORACLE_KEYPAIR_PATH=~/.config/solana/id.json npm run oracle:mock`. The Vercel cron uses `ORACLE_SECRET_KEY` env var (JSON array of the main wallet's secret key bytes).

## RPC Provider
- **Helius** — paid plan active as of 2026-04-07 ($25 first month, $49/mo after)
- Devnet RPC URL: `https://devnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>` (get from Helius dashboard)
- Always prefer Helius RPC over public `api.devnet.solana.com` — more reliable, higher rate limits
- Use Helius URL for: `SOLANA_RPC_URL` env var, `anchor deploy --url`, `npm run init-players`, `npm run oracle`

## Environment Variables
Required for price history chart to work:
```
KV_REST_API_URL=         # Vercel KV (Upstash Redis) REST URL
KV_REST_API_TOKEN=       # Read-write token
KV_REST_API_READ_ONLY_TOKEN=  # Optional read-only token for API route
```
Without these, `/api/price-history/[playerId]` returns `[]` (safe fallback — chart shows empty state).

Required for oracle cron job (/api/cron/oracle):
```
ORACLE_SECRET_KEY=       # JSON array from oracle-keypair.json e.g. [1,2,3,...]
SOLANA_RPC_URL=          # Helius devnet URL (see RPC Provider section above)
SOLANA_CLUSTER=          # "devnet"
CRON_SECRET=             # Random secret — Vercel injects as Authorization: Bearer <secret>
BALLDONTLIE_API_KEY=     # Optional — improves balldontlie.io rate limits
```

## Design System
Always read DESIGN_SYSTEM.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN_SYSTEM.md.
