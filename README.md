# Pass the Pigs — David × Elisabeth

A mobile-first, shared 1v1 3D game built with **Bun, TypeScript and Three.js**.
No database setup. Local development uses a JSON file; Vercel uses encrypted
JSON in this GitHub repository.

## Play

- **/** — description and player selection.
- **/david** — David's view.
- **/elisabeth** — Elisabeth's view.
- Hold either pig (or the toss button) and release to throw. Hold longer to
  toss harder; the measured probabilities never change.
- Swipe/drag the empty field to rotate **360 degrees**. Mouse wheel and
  focused-table arrow keys work too.
- Before your next turn, tap **Replay** to watch every roll from the other
  player's completed turn. Your rolls unlock only after the replay finishes.
- On your turn: **Keep rolling** or **Bank turn**. When waiting: **Nudge**.
- Settings contains **Rules & odds**, **History**, notifications and **Restart match**.
- **David is blue; Elisabeth is plum.** The background, 3D felt and accents
  follow the player being watched, including during replays.
- The active player is highlighted above the field. Individual landing names
  follow each pig; the combined score and turn total share one compact row.
- First to 100 wins. Pig Out loses the turn. Oinker loses that player's game score.
  Best banked scores and wins survive restarts.

## Local development

```sh
bun install --frozen-lockfile
bun dev
```

Open [David](http://localhost:3007/david) and
[Elisabeth](http://localhost:3007/elisabeth), on two tabs or devices.
Both routes talk to the same API. State and complete history accumulate in
`.data/state.json`, which is ignored by Git. Stop/start the server to verify
persistence. No environment variables are required locally.

```sh
bun run check   # unit/integration tests, TypeScript, production build
bun run build   # TypeScript and deployable frontend in dist/
bun start       # local Bun production server
```

Bun 1.4.2 is used in CI. Vercel is configured for Bun 1.4.x.
A single Bun server can be reached on your LAN if Windows/WSL forwarding
and the firewall allow it. Phone push notifications need HTTPS; ordinary
gameplay can use HTTP on the LAN.

## Vercel deployment

The checked-in `vercel.json` explicitly sets the framework to Other/null,
uses `bun install --frozen-lockfile`, builds with `bun run build`, serves
`dist/`, and routes `/david` and `/elisabeth` to the app. The API is the
Vercel Function in `api/game.ts`. Vercel does **not** run the local dev server.

1. Connect this repository and deploy `main`.
2. Add **GITHUB_TOKEN** to the Vercel Production environment. Use a
   fine-grained token for `dmerckx/pass-the-bigs` with **Contents: Read and write**.
3. Redeploy after adding/changing environment variables.
4. Open the app. The server creates `game-state` and its encrypted
   `state.json` automatically. No branch or data file needs to be created by hand.
5. David opens `/david`; Elisabeth opens `/elisabeth`.

Preview deployments use `game-state-preview`, separate from the live match.
Give Preview its own token environment value only if you want playable previews.
Missing credentials never fall back to ephemeral Vercel disk storage: the app
shows a setup error while the frontend build/deployment still succeeds.

**Token rotation:** by default, the token also derives the state encryption key.
Before your first game, you can optionally set a stable `STATE_ENCRYPTION_KEY`
to decouple encryption from token changes. If you use the one-variable setup,
retain the original token's value as `STATE_ENCRYPTION_KEY` when rotating
`GITHUB_TOKEN`. Losing the original encryption secret makes old state unreadable.
The server will refuse to overwrite an unreadable file.

## Notifications

In Settings, each player taps **Enable notifications** and grants permission.
On iPhone/iPad, first add the site to the Home Screen and open that installed app.
The server generates and stores the Web Push keys automatically; no extra
notification service or VAPID environment variables are required.

The waiting player's Nudge sends:
**“Hey, its your turn in pass the pigs!”**

The recipient gets a phone notification if subscribed. Otherwise the saved
nudge appears in the game when their page syncs. Nudges have a 60-second
cooldown per current recipient. Notification delivery requires connectivity
and browser/OS permission; a delivery failure is reported without losing the
saved nudge. Switching player routes reassigns that browser's subscription.

## Documentation

- [Product, architecture and storage](docs/architecture.md)
- [Deployment, environment and recovery](docs/deployment.md)
- [Rules and probability provenance](docs/probabilities.md)

This is a two-person, trust-based game. The player routes select an identity;
they are not an authentication system. State encryption protects the data
file in the public repository, not access to the game's public HTTP endpoints.
