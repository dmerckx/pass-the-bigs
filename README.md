# Pass the Pigs — David × Elisabeth × Ine

A mobile-first, shared three-player 3D game built with **Bun, TypeScript and Three.js**.
No database setup. Local development uses a JSON file; Vercel uses encrypted
JSON in this GitHub repository.

## Play

- **/** — description and player selection.
- **/david** — David's view.
- **/elisabeth** — Elisabeth's view.
- **/ine** — Ine's view, with amber and brown piggies.
- David stays blue and Elisabeth keeps the pink/plum palette. Their saved skins
  and all existing scores are preserved. Enable notifications in Settings.
- Hold either pig (or the toss button) and release to throw. Hold longer to
  toss harder; the measured probabilities never change. Rolls animate immediately
  from a shared seed and save in order in the background. Pending moves survive
  refreshes and retry with the same IDs if a save response is lost.
- Swipe/drag the empty field to rotate **360 degrees**. Mouse wheel and
  focused-table arrow keys work too.
- Before your next turn, tap **Replay** to watch every roll from both other
  players' completed turns. Your rolls unlock only after the replay finishes.
- On your turn: **Keep rolling** or **Bank turn**. The other player is notified
  automatically when the turn changes; there is no Nudge button.
- Settings contains **Rules & odds**, **History**, and a small notifications
  button. Return to **/** to choose a player. A large **Restart** button appears
  after a win; it starts a new round and preserves the overall match-win tally,
  high scores, player preferences and full history.
- Each player has their own colored 3D table slice and pair of pigs. The
  watched player is large in front; the other slices stay small in the background
  with a name/You label. Slices rotate into view when the watched turn changes,
  including after a required replay. The UI uses bundled **Manrope**.
- Winning pigs dance and twirl; losing pigs sob with blue tears. The winner's
  final score and the overall match-win tally stay visible above Restart.
- Small stars beneath each name count wins. The watched player stays highlighted. Individual landing names
  follow each pig; the combined score and turn total share one compact row.
- Bad rolls stay on screen for three seconds before sides switch, with one of
  20 random reactions (including eight in Danish). Replays use the same pause.
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

The first-visit setup requests permission when the player taps **Enable
notifications & play**. **Not now** saves the appearance without requesting
permission. The small Settings button can enable notifications later. Permission
is device-specific; a new phone may need it even when the appearance is saved.
Skipping the prompt does not revoke a device's previously granted subscription.

When a bank, Pig Out or Oinker starts the opponent's turn, the server saves a
single turn notice and sends (Restart also starts a fresh David turn):
**“Hey, its your turn in pass the pigs!”**

Rerolls, replay playback, page refreshes, polling and retried commands do not
send another turn notification. Winning ends the match without notifying a
nonexistent next turn. Push goes to the new active player's subscribed devices.
The app displays the saved notice once in browsers without notification
permission. Browser/OS delivery and connectivity still apply; the game never
depends on notification delivery succeeding.

The server generates and stores Web Push keys automatically. No extra service
or VAPID environment variables are required. Platform setup requirements are
documented in [Phone setup](docs/deployment.md#phone-setup); the game itself
does not show platform-specific installation instructions.

## Documentation

- [Product, architecture and storage](docs/architecture.md)
- [Deployment, environment and recovery](docs/deployment.md)
- [Rules and probability provenance](docs/probabilities.md)

This is a two-person, trust-based game. The player routes select an identity;
they are not an authentication system. State encryption protects the data
file in the public repository, not access to the game's public HTTP endpoints.

## Three-player update (2026-09-14)

Play as David at `/david`, Elisabeth at `/elisabeth`, or Ine at `/ine`.
Turns run David → Elisabeth → Ine → David. David keeps blue, Elisabeth keeps
the existing pink/plum palette, and Ine has amber with brown pigs. Existing
David/Elisabeth skins, points, wins, best scores and history are preserved.
Small stars under each name show games won; the old turn/best labels are gone.
Both opponents' completed turns queue for replay in order before your rolls.

The server upgrades existing two-player JSON/GitHub state atomically and only
once. Browser storage and the legacy save format remain readable; no cache
clearing is needed. The earlier maintenance score reset is retired and is not
reapplied by this update. Ine starts at zero without restarting the match.

## Waiting previews

- `/eg/music` — headphones and floating musical notes.

- `/eg/eating` — a raised food tray, carrots and gently munching piggies.

- `/eg/drinking` — piggies sipping from a blue water puddle with expanding ripples.

- `/eg/jumping` — happy jumps in a mud puddle, with muddy spots and little splashes.

- `/eg/reading` — open books with printed pages, bookmarks and slow page turns.

These preview routes do not read or change the shared match.
