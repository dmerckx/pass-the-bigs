# Deployment and operations

## Vercel

Keep the project root at the repository root and production branch on `main`.
The repository's `vercel.json` overrides build detection:

| Setting | Value |
| --- | --- |
| Framework | Other (`null`) |
| Bun runtime | 1.4.x |
| Install command | `bun install --frozen-lockfile` |
| Build command | `bun run build` |
| Static output | `dist` |
| Server function | `api/game.ts` |
| Player route rewrites | `/david`, `/elisabeth` → `/index.html` |

The original local `Bun.serve` entry point is a development/standalone server.
Vercel serves the built frontend and the API function. Explicit output and
runtime configuration corrected the original failed deployment.

Building does not require a GitHub token. Requests to the shared-match API
do require it on Vercel. Environment changes need a redeployment before
functions see them. Do not expose the token with a public/client env prefix.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `GITHUB_TOKEN` | On Vercel | Fine-grained token scoped to this repository, Contents read/write. |
| `GITHUB_REPOSITORY` | No | Defaults to `dmerckx/pass-the-bigs`. |
| `GITHUB_STATE_BRANCH` | No | Defaults to `game-state` in production, `game-state-preview` in Preview; must start with `game-state`. |
| `STATE_ENCRYPTION_KEY` | No | Stable private encryption secret; defaults to the token value. Set before first use to simplify token rotation. |
| `VAPID_SUBJECT` | No | Web Push contact URL or mailto URI; defaults to the repository URL. |
| `STATE_BACKEND` | No | Set to `github` only to exercise GitHub storage outside Vercel. Local development otherwise uses JSON. |
| `LOCAL_STATE_PATH` | No | Local JSON file path; default `.data/state.json`. |
| `HOST` / `PORT` | No | Local server binding, defaults `0.0.0.0` / `3007`. |

No database, push vendor account, or manually supplied VAPID keys are needed.
The server generates VAPID keys once and keeps them in the saved state.
Never commit a real `.env`, token, decrypted state or local `.data` directory.

## Preview isolation and deployment loops

Production and Preview use separate state branches by default. All previews
share `game-state-preview` unless you choose another `game-state*` branch.
Use Vercel's environment scopes to control which deployments receive credentials.

`git.deploymentEnabled["game-state*"] = false` stops game-state commits from
starting Vercel deployments. GitHub Actions runs only on pushes/PRs to main.
Do not make `game-state` the production deployment branch or merge its data
file into main.

The token must be allowed to create and update the data branch. Branch rules
that require pull requests on every branch need an exception for `game-state*`.

## Encryption, token rotation and recovery

The public Git file is an encrypted JSON envelope, not plaintext game data.
AES-GCM authenticates it before parsing. Changing the secret does not start
a fresh match; it produces a visible error to protect the existing history.

To rotate a token safely:
1. If a separate `STATE_ENCRYPTION_KEY` is already set, keep that key unchanged.
2. If encryption currently uses the token, set `STATE_ENCRYPTION_KEY` to the
   **original token's value**. It remains usable as an encryption secret after
   that token's GitHub authorization expires.
3. Replace `GITHUB_TOKEN` with the new authorized token and redeploy.

GitHub commit history is the backup. To restore, revert only the encrypted
state file on the data branch to a known-good version while retaining its
encryption secret. Do not restore old state during active play. Local backup
is a copy of `.data/state.json` taken while the development server is stopped.

If the encryption secret has been lost, old data cannot be decrypted. A new
empty `game-state*` branch with a new secret starts a fresh history and new
push keys, so devices need to re-enable notifications. This is separate from
a maintenance reset in code, which can preserve history, keys, records and
player profiles. There is no in-game reset or public restart action. Regular
code deployment keeps the saved match; a deliberate reset needs a state
transaction using the maintenance branch in `server/model.ts`.

## Phone setup

Use the production HTTPS URL:
- David chooses `/david`.
- Elisabeth chooses `/elisabeth`.
- On first visit, each chooses a color and piggy skin, then enables
  notifications. The small Settings button can enable them later or on a new
  device; saved appearance preferences do not repeat across devices.
- On iPhone/iPad, first use Share → Add to Home Screen, open that installed
  app, then enable notifications.
- Watch the other player's complete turn with Replay before making your rolls.
  Refreshing during playback keeps that replay required.
- Choose blue, plum or amber. The color and white/pink/brown piggy skin follow
  the player being watched, including replays, then switch when your rolls
  unlock. Completed color choices are reserved for that player.
- Each new turn automatically sends one alert after banking or a bust.
  Rerolls, replay and refreshing do not send repeats.
- Phone/OS permission, connectivity and push-service delivery still apply.
  Browsers without notification permission show the saved turn notice when
  the recipient opens the still-active turn.

Both routes selecting identities in the same browser share one push
subscription; the most recently selected identity owns it. For reliable
1v1 notifications, use your individual phones.

Local HTTP gameplay on a LAN works if the server is reachable. Browser push
requires HTTPS (localhost is a development exception). WSL port forwarding
and Windows firewall configuration are outside the app.

## Troubleshooting

- **Build fails:** use the checked-in Bun lockfile and explicit Vercel settings.
  Run `bun install --frozen-lockfile && bun run check` in the repository.
- **Add GITHUB_TOKEN message:** configure Production/Preview env scope and redeploy.
- **GitHub storage unavailable:** check token expiration, repository scope,
  Contents write permission, branch rules, API availability and rate limits.
- **Cannot decrypt:** restore the original encryption secret. Do not delete
  the file to hide the error.
- **A move was not confirmed:** use Retry. The stored command UUID prevents
  duplicate rolls/banks even when the first response was lost.
- **Screen is behind:** visible pages poll every five seconds. Reopening the
  page resyncs; cached or offline clients cannot commit stale moves.
- **Roll buttons are locked:** complete the initial appearance setup and
  finish the pending opponent replay first.
  If playback was interrupted, replay it from the start. A WebGL failure
  requires reloading with graphics acceleration available.
- **No phone notification:** check installation/permissions, selected identity,
  network and Settings. A failed push does not delete the saved turn notice.
  Push is attempted once per transition; there is no reminder loop.

## Appearance and font maintenance

`src/palette.ts` defines the three allowed colors and pig skins. A player's
completed profile is persisted with the match, so changing frontend defaults
alone does not replace their saved choice. Use a deliberate state migration
for future profile changes; preserve game scores, history and replay metadata.

Manrope is bundled locally in `public/fonts/manrope-latin.woff2`, licensed
under the accompanying SIL OFL file. Both Bun development and the Vercel
production build serve the font through the CSS bundle. No runtime third-party
font request or new environment variable is needed.
