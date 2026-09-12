# Product and implementation

## Mobile interface

The match opens directly on a playing field. The previous title/header,
visible rules link, “David's roll” label, repeated Bank-point total and
persistent tutorial/footer have been removed.

A compact top row shows David, Elisabeth, banked scores, best scores and a
clear active label. A gear opens Settings. Each pig has its own screen-space
landing label below its projected 3D bounds. The labels move as the view orbits.
The result row contains the combination, its points and the current turn total.
The action buttons do not repeat that total. While waiting, a small muted
message at the bottom says “Wait for David to take his turn” or “Wait for
Elisabeth to take her turn”. It hides on your turn, during setup/replay and
after the match ends.

Each player's chosen color remains their identity color. The page background,
3D felt, table rim, primary button and browser theme color follow the watched
player. A pending replay keeps the opponent's palette until playback is
complete; then the field switches to your color. REPLAY READY/REPLAYING labels
ensure color is not the only indicator. Both 3D pigs use the watched player's
white, pink or brown skin, including coordinated snout, ears and hoof materials.
Cosmetic skin changes do not change geometry, scoring or probabilities.

Typography uses Manrope throughout, including the result, scoreboard, landing
page and dialogs. The Latin variable WOFF2 is bundled in the app (about 25 KB),
with its SIL Open Font License in `public/fonts/OFL-Manrope.txt`. Bun includes
the font in the CSS bundle; no Google Fonts request runs on players' devices.
The fallback is the system sans serif with `font-display: swap`.

The field gets the remaining screen height, including on small phones.
Buttons are at least 44 px tall; safe-area insets support installed apps.
Reduced-motion preferences shorten tosses and remove camera damping.

Settings provides:
- Rules & odds with publisher/research links.
- History of rolls, banks and maintenance resets, latest first, 100 events
  per page. Old nudge events remain readable in existing history.
- A small Enable notifications button, shown as Notifications on once this
  browser's subscription is registered.

There is no Restart match, Play again, Switch player or Nudge control, and no
platform-specific installation paragraph. Player selection is available at
`/`. A maintenance reset through code preserves history, best banked scores,
wins, appearance choices and notification subscriptions, starts a new numbered
match with David first, and clears pending replay requirements. Ordinary code
deployment does not reset the stored match automatically.

## First-visit setup

The first time each player opens their route, a compact dialog presents three
color swatches (blue, plum, amber), three illustrated piggy skins (white, pink,
brown), and a request to enable turn notifications. Selecting a swatch previews
the field and pig materials. The choices are accessible radio groups. The
server reserves completed color choices; if both players choose the same color
at once, the first saved choice wins and the other player chooses another.

Enable notifications & play requests browser permission directly from the
button gesture, then saves the choices and subscription. Not now saves the
choices without requesting permission. Denied/unsupported notifications do not
block play. Existing browser subscriptions can follow the selected player
without requesting permission again; Not now does not revoke permission.
A failed setup save stays in the dialog with Retry, preserving the command ID.

Each profile stores color, skin and a completed flag in the same local JSON or
encrypted GitHub state as the match. Both routes see the same appearance; a new
device does not repeat an already-completed profile setup. Notification
permission is still per browser/device, so the small Settings button remains
available there. The server rejects roll/bank actions until that player has
completed setup. Setup does not alter the match's game revision, points or
history. Choices cannot be changed through the UI after completing setup.

Existing shared saves are upgraded with incomplete profiles while retaining
their match, scores, replays, history and subscriptions. Each existing player
therefore sees setup once after this update. This is separate from the previous
prototype's browser-only scores, which are not imported into shared state.

## Routes and identity

`/` describes the game and links to “I'm playing as David” and “I'm playing
as Elisabeth”. The chosen route determines the API's player field.

`/david` and `/elisabeth` show the same server-owned match. Only the active
player can roll or bank after setup and any required replay. Turn changes
automatically notify the next player. The server rejects off-turn actions,
completed-match moves, stale
game revisions and moves sent before the current toss has finished.

These identity selectors are intentionally not accounts or authentication.
Anyone who can reach the app can choose either route. Public restart and
manual nudge commands are rejected; maintenance reset logic remains in code.
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
required complete-turn replay. Winning turns can be watched after the match ends.

The current turn, each player's latest opponent turn, replay sessions and
acknowledgements live alongside the game in JSON/GitHub storage. The mandatory
gate prevents a new opponent turn from displacing an unwatched turn during
normal play. A maintenance reset explicitly clears replay requirements for the new match
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
- each player's saved appearance and setup completion;
- latest automatic turn notice (recipient, turn ID and timestamp);
- each player's pending opponent replay and replay-session deadline;
- public Web Push key and whether each player has subscriptions.

The snapshot includes server time so phone clock differences do not decide
when controls unlock. Clients poll every five seconds while visible.
ETags allow unchanged responses to be 304. In-flight polls cannot replace
a newer move. Hidden pages pause polling and resync on returning.

`POST /api/game` accepts `roll`, `bank`, `setup`, `subscribe`,
`unsubscribe`, `start-replay` or `finish-replay`, with player, command UUID
and expected game revision. Setup requires valid `color` and `skin` values.
Public `restart` and `nudge` commands are rejected. Replay commands also include `replayId` and an
optional `reducedMotion` boolean. Replays change the storage revision, but
not the game revision or score/history.
Roll strength must be between zero and one. Client-supplied scores or
tickets are ignored; the server samples an unbiased integer 0–5999.

Each move is committed before the response/animation. A lost response is
retried with the same UUID, so refreshing or retrying cannot roll again or
bank twice. The browser retains only the unconfirmed command and notification
display metadata locally; the authoritative match is always on the server.
Recent command receipts are retained for 512 actions. Stale game revisions
prevent old roll/bank requests from replaying after that window.

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

The first stored match includes generated VAPID keys. Permission is requested
from the first-visit or small Settings button. The service worker receives Web
Push and opens the recipient's player route when the notification is tapped.
It does not cache game API responses or provide offline moves. The client
registers the worker in advance, so the permission request can run directly
from a user gesture, as required by the [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).

A bank, Pig Out or Oinker that changes the active player creates one saved
turn notice, using the stable match/turn ID. The API saves the move first, then
only the request that successfully created that new turn sends Web Push to
the next player's subscriptions. Retried commands and competing stale moves
cannot send it again. Rerolls, setup, subscriptions, GET polling and replay
start/finish do not generate notices. A winning roll has no next turn and
sends no turn alert. Creating the initial match before either player subscribes
does not send a backdated notification when they later grant permission.

Each notification uses a turn-specific browser tag. There is no manual nudge,
reminder loop or periodic repeat. The text is “Hey, its your turn in pass the
pigs!”. Browsers without notification permission display the saved notice
once when syncing the still-active turn; browsers with permission use OS
notifications instead of a duplicate in-app toast.

Subscription URLs are restricted to recognized browser push-service domains.
Each player can have up to eight devices. Choosing another route can move that
device's existing subscription to the selected identity. Expired subscriptions
(404/410) are removed. Delivery is best effort: the API attempts each subscribed
device once, with a one-hour TTL and an eight-second timeout. There is no
external delivery queue, so a server interruption between commit and sending
can lose a push. A failed push never rolls back the match or deletes its saved
turn notice. The visible game and required replays remain usable independently
of phone notification delivery.

## Verification

`bun run check` runs:
- all official scoring pairs and every empirical probability slot;
- turn changes, busts, winning, restart records and request idempotency;
- concurrent clients, stale state, off-turn actions and input validation;
- first-visit choices, ownership, color reservations, persistence and migration;
- one automatic turn alert across retries/concurrent banks, no winning alert,
  and expired subscription cleanup without losing the saved turn;
- mandatory replay timing, both players, busts/wins, refresh persistence,
  idempotent replay retries, restart and migration from existing history;
- local persistence, encryption/tamper handling and a mocked GitHub CAS flow;
- geometry contacts, hard-toss endpoints, 360° orbit and phone framing;
- a real ephemeral Bun HTTP server serving all routes, assets and shared API;
- TypeScript and the production build with local asset-existence checks.

Real phone notification permission and delivery must be exercised on the
recipient devices. Tests do not send real notifications or modify the live
production match.
