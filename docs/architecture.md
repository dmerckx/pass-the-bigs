# Product and implementation

## Mobile interface

The match opens directly on a playing field. The previous title/header,
visible rules link, “David's roll” label, repeated Bank-point total and
persistent tutorial/footer have been removed.

A compact top row shows David, Elisabeth, banked scores, best scores and a
clear active label. A gear opens Settings. Each pig has its own screen-space
landing label below its projected 3D bounds. The labels move as the view orbits.
The result row contains the combination, its points and the current turn total.
The action buttons do not repeat that total.

David has a dedicated deep blue palette and Elisabeth a plum palette. Their
name colors stay fixed. The page background, 3D felt, table rim, primary
button and browser theme color follow the watched player. A pending replay
keeps the opponent's palette until playback is complete; then the field
switches to your color. The top label also says REPLAY READY or REPLAYING,
so color is not the only indicator.

The field gets the remaining screen height, including on small phones.
Buttons are at least 44 px tall; safe-area insets support installed apps.
Reduced-motion preferences shorten tosses and remove camera damping.

Settings provides:
- Rules & odds with publisher/research links.
- History of rolls, banks, restarts and nudges, latest first, 100 events per page.
- Enable notifications.
- Restart match, with a confirmation describing the effect on both players.
- Switch player.

Restart preserves all history, best banked scores, wins and notification
subscriptions. It starts a new numbered match with David playing first.
The previous prototype's browser-only scores are not automatically imported
into the new shared match.

## Routes and identity

`/` describes the game and links to “I'm playing as David” and “I'm playing
as Elisabeth”. The chosen route determines the API's player field.

`/david` and `/elisabeth` show the same server-owned match. Only the active
player can roll or bank. While waiting, the player can nudge the active
opponent. The server rejects off-turn actions, completed-match moves, stale
game revisions and moves sent before the current toss has finished.

These identity selectors are intentionally not accounts or authentication.
Anyone who can reach the app can choose either route or restart the match.
Use suitable hosting access protection if access beyond the two players is
unwanted. No token, private push key, or subscription endpoint is returned
by the public state API.

## Required turn replays

Every completed turn captures all its rolls in order, including the immutable
outcome tickets and hold strengths, plus the bank, bust or winning roll that
ended it. Before making their own rolls, the next player taps **Replay** and
watches that complete sequence. Progress shows the player and roll number;
each landing displays the combination, individual poses, score and turn pot.
Banking is shown at the end when applicable. Replaying never rolls new odds
or applies the scores again. Outcomes and toss strength match the saved turn;
cosmetic flight variation is regenerated.

Roll/bank controls stay locked until playback completes. The server enforces
this using a replay ID, a recorded start and a minimum duration before the
finish acknowledgement. The acknowledgement is stored with the shared match,
so it applies across that player's devices. Opening the page or refreshing
does not silently mark a turn watched; an interrupted sequence can be replayed
from the start. Lost start/finish responses use the same idempotent command
retry mechanism as moves. A client timer alone cannot unlock rolls.

The replay uses the opponent's starting banked scores and each recorded score
update, with their color and a REPLAYING label throughout. Reduced-motion
preferences shorten playback. Toss animations pause while the document is
hidden and playback waits for the page to be visible before proceeding.
Live polling pauses during playback. Watching live rolls does not replace the
required complete-turn replay. Winning turns can be watched before rematching.

The current turn, each player's latest opponent turn, replay sessions and
acknowledgements live alongside the game in JSON/GitHub storage. The mandatory
gate prevents a new opponent turn from displacing an unwatched turn during
normal play. Restart explicitly clears replay requirements for the new match
while preserving full history and records. Existing shared saves are upgraded
from their event history; an existing completed opponent turn may therefore
need to be replayed once after this update.

These are gameplay checks for the two trusted player routes. They do not prove
that a human paid attention and are not an anti-cheat authentication system.

## 3D interaction

Three.js builds both pigs and the felt field. Geometry supports six scoring
poses and an explicit touching Oinker. Convex-hull support faces place the
pigs on the table; the rare Snouter and Leaning Jowler use the named anatomy
as actual contact points. The black flank dot distinguishes opposite sides.

Holding a pig or the toss button charges for up to 1.4 seconds. Longer holds
increase height, revolutions and bounce. Outcome selection runs on the
server independently of strength, view direction and motion preferences.
The animation finishes on that outcome; simulated physics does not decide
the result. The camera pulls back during high throws to keep them visible.

OrbitControls provides unrestricted azimuth: swipe or drag the empty field
to rotate all 360 degrees. Mouse wheel rotation and focused-table arrow
keys are supported. Vertical rotation is bounded above the table. Camera
controls pause while a pig is being charged or tossed; controls on the pigs
remain separate from the empty-field drag gesture.

## Shared state and transport

`src/game.ts` is the scoring/turn reducer. `server/model.ts` adds match IDs,
history, command receipts, notification subscriptions and game revisions.
`server/handler.ts` validates the API and owns random sampling.

`GET /api/game` returns a public snapshot:
- game, match number and revisions;
- most recent roll (including its immutable outcome ticket and strength);
- the time until which moves are locked for the toss;
- latest nudge;
- each player's pending opponent replay and replay-session deadline;
- public Web Push key and whether each player has subscriptions.

The snapshot includes server time so phone clock differences do not decide
when controls unlock. Clients poll every five seconds while visible.
ETags allow unchanged responses to be 304. In-flight polls cannot replace
a newer move. Hidden pages pause polling and resync on returning.

`POST /api/game` accepts `roll`, `bank`, `restart`, `nudge`, `subscribe`,
`unsubscribe`, `start-replay` or `finish-replay`, with player, command UUID
and expected game revision. Replay commands also include `replayId` and an
optional `reducedMotion` boolean. Replays change the storage revision, but
not the game revision or score/history.
Roll strength must be between zero and one. Client-supplied scores or
tickets are ignored; the server samples an unbiased integer 0–5999.

Each move is committed before the response/animation. A lost response is
retried with the same UUID, so refreshing or retrying cannot roll again or
bank twice. The browser retains only the unconfirmed command and notification
display metadata locally; the authoritative match is always on the server.
Recent command receipts are retained for 512 actions. Stale game revisions
prevent old roll/bank/restart requests from replaying after that window.

The public history API is `GET /api/game?view=history&before=<index>`.
Stable before-indices keep pagination consistent when later moves arrive.
History is never cleared by restarting a match.

## Storage

### Local

One Bun process uses `.data/state.json` by default. It is a growing JSON
object containing state, complete event history, receipts, subscriptions and
generated VAPID keys. Writes are serialized, use a content-hash comparison,
and atomically rename a temporary file. This avoids partial files and lost
updates from simultaneous HTTP requests in that process.

The local backend is for one development server, not multiple processes
sharing a network filesystem. Tests use isolated temporary paths.

### Vercel/GitHub

On Vercel the server automatically selects GitHub storage and requires
`GITHUB_TOKEN`. The default production branch is `game-state`; Preview uses
`game-state-preview`. On first use the branch is created from `main`, then
an encrypted `state.json` is written using GitHub's Contents API.

The entire object uses AES-256-GCM with a random nonce per write and an
authenticated format version. This repository is public, so notification
subscriptions and private push keys must not appear as plaintext in Git.
The key derives from `STATE_ENCRYPTION_KEY`, or from `GITHUB_TOKEN` if the
optional separate secret is absent.

Every update includes the file's previous blob SHA. A conflict triggers a
fresh read and revalidation. Two moves with the same game revision cannot
both win. An already-applied command is recognized on retries. Invalid,
corrupted or undecryptable data causes an error; it is never silently reset.

GitHub responses are cached in a function instance for up to four seconds;
writes always revalidate. Authenticated conditional requests use GitHub's
ETag support. The file is retrieved with the raw media type when it exceeds
the Contents API's 1 MB inline threshold.

This is deliberately a low-volume, two-player use of GitHub. Sync is polling,
not instantaneous realtime; writes depend on GitHub availability and rate
limits. History grows with every move and is re-saved with the state. The
Contents API has a 100 MB file limit. For much larger usage, migrate the
storage adapter instead of treating this design as a general database.
Game-state commits are excluded from Vercel deployments and CI.

## Notifications

The first stored match includes generated VAPID keys. Enabling notifications
requires a user gesture and browser permission. The service worker receives
Web Push and opens the correct player route when its notification is tapped.
It does not cache game API responses or provide offline moves.

Subscription URLs are restricted to recognized browser push-service domains;
the API cannot be used to send arbitrary server-side requests. Each player
can have up to eight devices. A subscription is moved to the chosen identity
when that device switches routes.

A nudge is saved first, with sender/recipient and timestamp, then push is
attempted. There is no external job queue. Without subscriptions it is an
in-game notification. Expired subscriptions (404/410) are removed. If the OS
or push service cannot deliver, the durable in-game nudge remains available.
Nudges are retained for display for one hour and deduplicated per browser.
A repeat nudge to the same current recipient is limited to once per minute.

## Verification

`bun run check` runs:
- all official scoring pairs and every empirical probability slot;
- turn changes, busts, winning, restart records and request idempotency;
- concurrent clients, stale state, off-turn actions and input validation;
- mandatory replay timing, both players, busts/wins, refresh persistence,
  idempotent replay retries, restart and migration from existing history;
- local persistence, encryption/tamper handling and a mocked GitHub CAS flow;
- geometry contacts, hard-toss endpoints, 360° orbit and phone framing;
- a real ephemeral Bun HTTP server serving all routes, assets and shared API;
- TypeScript and the production build with local asset-existence checks.

Real phone notification permission and delivery must be exercised on the
recipient devices. Tests do not send real notifications or modify the live
production match.
