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
ensure color is not the only indicator. Each player owns a separate 3D slice and two pigs using their chosen
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

The menu has no reset, Switch player or Nudge control, and no platform-specific
installation paragraph. Player selection is available at `/`. A large Restart
button appears below the game only after a win and any replay required on that
device. It preserves history, best banked scores, overall match wins, appearance
choices and notification subscriptions, starts a new numbered match with David
first, and clears pending replay requirements. The final round scores remain
in history. Ordinary deployment does not reset the stored match automatically.
The explicit 2026-09-12 maintenance reset clears points, high scores, wins and
appearance choices once per existing state file, with a persisted version marker;
see [deployment documentation](deployment.md#one-time-score-and-appearance-reset-2026-09-12).

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
Anyone who can reach the app can choose either route. Public restart is
restricted to finished matches; manual nudge commands remain rejected.
In-progress resets require maintenance code.
Use suitable hosting access protection if access beyond the three players is
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

Three.js builds two separate floating felt slices, each with two pigs. The
watched player's slice is foreground-sized; the other stays at 22% scale above
and behind it. A small name label identifies the background slice, adding You
when it belongs to the current route. Each slice retains its own color, skin
and last landed combination instead of repainting one shared pair of pigs.
The snapshot's `lastRolls` comes from each player's latest roll in the current
match, so refreshing reconstructs both slices without importing old-match poses.

On a view change, the slices orbit around each other over 900 ms: the outgoing
one shrinks into the background while the incoming one rotates forward. The
layout uses camera-relative positioning to keep both visible during manual
360-degree orbit. The camera's user-selected angle is preserved. Toss controls
are locked while the slices move. Reduced-motion preferences switch the view
immediately. Hidden pages pause both turn transitions and toss animations.

Scoring landings hold for 650 ms during live play (600 ms in replays). A Pig
Out or Oinker instead keeps the outgoing player's slice and landed result in
view for **three seconds after the toss finishes**, before rotating sides.
During that pause, a compact message replaces the action/waiting row: one of
20 randomly chosen variations, including eight Danish phrases. The message's
language is marked for screen readers. Selection happens once per landing,
independently of the server's roll probabilities; messages are cosmetic and
are not saved in match history. Both live rolls and required replays use this
pause, including with reduced motion. The server's replay deadline also
includes the three-second bad-roll hold. Scoring and turn notifications still
commit immediately; the delay controls presentation only.

If a required opponent replay is pending, that opponent remains in front
until playback finishes; the player's own small slice then rotates forward. Results and per-pig labels always describe the
foreground pair. The scene tracks which player owns a toss even if the server
has already passed the turn to the opponent.

Geometry supports six scoring poses and an explicit touching Oinker. Convex-hull
support faces place the pigs on their slice; the rare Snouter and Leaning
Jowler use the named anatomy as actual contact points. The black flank dot
distinguishes opposite sides.

Holding a pig or the toss button charges for up to 1.4 seconds. Longer holds
increase height, revolutions and bounce. Outcome selection runs on the
server independently of strength, view direction and motion preferences.
The animation finishes on that outcome; simulated physics does not decide
the result. The camera pulls back during high throws to keep them visible.

OrbitControls provides unrestricted azimuth: swipe or drag the empty field
to rotate all 360 degrees. Mouse wheel rotation and focused-table arrow
keys are supported. Vertical rotation is bounded above the table. Camera
controls pause during a slice transition and while a pig is being charged or tossed; controls on the pigs
remain separate from the empty-field drag gesture.

## Winning and restarting

After the winning landing (or the losing player's required replay), the
winning pair hops, sways and periodically twirls. The losing pair slumps and
shakes with visible blue teardrops. Its background slice grows slightly to 36%
scale so the reaction is readable. These expressions never modify the stored
outcome or score. Landing labels on the pigs hide while they react; the final
combination and score remain in the result row. Manual orbit still works.
Reduced-motion users get still celebration poses and visible tears.

The end screen shows the series tally, Wins · David X / Elisabeth Y, and a
full-width 60 px Restart button. Either player can restart a finished game.
The public API checks the winner within the same storage transaction as the
reset; it rejects mid-match restarts and stale competing requests. Repeating
an already-saved request ID cannot increment the match twice or add another
win. The scoring reducer increments the winner's total once on the winning
roll; Restart only preserves that tally.

Restart clears round scores, current toss, pending replays and both pairs'
celebration poses/tears. It retains best scores, wins, appearance profiles,
subscriptions and every historical event, including final round scores. The
new David turn creates one automatic turn notice. As an explicit new-match
action, Restart also clears an unwatched replay on the other device.

## Shared state and transport

`src/game.ts` is the scoring/turn reducer. `server/model.ts` adds match IDs,
history, command receipts, notification subscriptions and game revisions.
`server/handler.ts` validates the API; `src/seed.ts` derives deterministic roll tickets on both client and server.

`GET /api/game` returns a public snapshot:
- game, match number and revisions;
- most recent roll plus the last roll for each player in this match, including
  immutable outcome tickets and hold strengths;
- the time until which moves are locked for the toss;
- each player's saved appearance and setup completion;
- latest automatic turn notice (recipient, turn ID and timestamp);
- each player's pending opponent replay and replay-session deadline;
- public Web Push key and whether each player has subscriptions.

The snapshot includes server time so phone clock differences do not decide
when controls unlock. Clients poll every five seconds while visible.
ETags allow unchanged responses to be 304. In-flight polls cannot replace
a newer move. Hidden pages pause polling and resync on returning.

`POST /api/game` accepts `roll`, `bank`, `restart`, `setup`, `subscribe`,
`unsubscribe`, `start-replay` or `finish-replay`, with player, command UUID
and expected game revision. Setup requires valid `color` and `skin` values.
Public `restart` requires a finished match; `nudge` is rejected. Replay
commands also include `replayId` and an
optional `reducedMotion` boolean. Replays change the storage revision, but
not the game revision or score/history.
Roll strength must be between zero and one. Client-supplied scores or
tickets are ignored; the server derives and validates the next seeded integer 0–5999.

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

This is deliberately a low-volume, three-player use of GitHub. Sync is polling,
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
sends no turn alert. Restart begins a new David turn and creates a new notice.
Creating the initial match before either player subscribes
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
- both pairs fitting throughout carousel turns, celebration ground contact,
  reduced-motion expressions and resetting the scene;
- post-win restart preserving series scores and one-time match/notification updates;
- a real ephemeral Bun HTTP server serving all routes, assets and shared API;
- TypeScript and the production build with local asset-existence checks.

Real phone notification permission and delivery must be exercised on the
recipient devices. Tests do not send real notifications or modify the live
production match.

## Three-player roster migration (2026-09-14)

The roster is David, Elisabeth and Ine, in that turn order. `/ine` works in
Bun, Vercel rewrites and notification links. All three have their own 3D
slice. David stays blue and Elisabeth retains the pink/plum palette. Ine is
assigned amber and brown piggies; existing skins for the original players are
retained. The scoreboard replaces turn/best captions with small win stars.

`rosterVersion: 3` upgrades existing saved state through the storage adapter's
compare-and-swap operation. It pads player score/record arrays, adds Ine's
profile/subscription slot, and preserves the active turn, score, match number,
history, VAPID keys, receipts, and unfinished opponent replays. It retires the
2026-09-12 reset without clearing scores. Revisions increase to reject stale
moves, which receive the current snapshot for recovery. No browser cache or
storage deletion is required. Existing two-player browser saves are also read
with a zero third score.

Each recipient retains the existing `replays` head and a `replayBacklog` of
later completed opponent turns. Finishing a replay advances only its head;
the player's rolls remain gated until their queue is empty. The server sends
turn notifications only to the next player. Restart clears all replay queues.

## Immediate tosses with a durable save queue (2026-09-14)

A 256-bit seed is generated once per match (and once when upgrading older
saved data). Each roll consumes a monotonically increasing index. Client and
server hash `pass-the-pigs:v1:<seed>:<index>:<attempt>` using SHA-256, read the
first unsigned big-endian 32-bit word and use rejection sampling before modulo
6000. Both use [noble-hashes](https://github.com/paulmillr/noble-hashes), which
also works on LAN HTTP without browser Web Crypto. This preserves the existing
6000 empirical ticket weights and scoring. Strength only affects animation.
The public seed intentionally allows prediction; this is a trusted family game.

The client projects a roll/bank with the shared game reducer, durably records
its command ID, expected revision, expected roll index and strength, and starts
animation immediately. `MoveOutbox` retains up to 32 ordered moves under
`pigs:outbox:<player>`, with the last confirmed snapshot. One background writer
submits them serially while subsequent tosses animate. A small Saving status
indicates unconfirmed moves. The writer honors the server's toss deadline,
including when reduced-motion animations are shorter. A bust, bank or win ends
local rolling immediately. Restart and replay wait for queued moves to save.

The server independently computes the ticket, validates ownership, replay
completion, revision and optional roll index, and commits through GitHub CAS.
It never accepts a client ticket, points or seed. Optional indices preserve
compatibility with already-open older clients. No random call is made per toss.

Uncertain failures keep the queue and retry exact IDs. Refresh restores it;
recent committed IDs in snapshots handle lost acknowledgements without double
scoring. A definitive conflict discards the speculative suffix and reconciles
to shared state. Storage-quota failures prevent starting an unrecorded toss.
The existing legacy pending-command key remains supported. Polling cannot
replace a projection while its moves are still pending, and save responses do
not interrupt an animation or hold. The queue pauses new input after a network
failure, then automatically retries; it is not an unlimited offline mode.

Seeding upgrades do not reset scores, appearance, history, replay requirements,
or subscriptions. Normal asset hashing and the no-cache service worker make
updates available on refresh without clearing caches or local data.

## Waiting easter eggs

When viewing another player's turn, the foreground pigs perform a cosmetic
idle scene. Scenes change every 14 seconds, avoid immediate repeats, pause in
hidden tabs and respect reduced motion. Starting a toss, replay, camera turn
transition or win restores the actual landing and removes all props. These
scenes never consume a roll seed or write to match storage.

Preview routes instantiate only the 3D scene: no game API calls, score changes,
queued moves or notification subscriptions. Drag/wheel rotation still works.
`<base href="/">` makes hashed assets resolve on nested preview routes.

- `/eg/music`: over-ear headphones, bobbing piggies and floating musical notes.
- `/eg/eating`: a raised food tray, carrots and gently munching piggies.
- `/eg/drinking`: piggies sipping from a blue water puddle with expanding ripples.
- `/eg/jumping`: happy jumps in a mud puddle, with muddy spots and little splashes.
- `/eg/reading`: open books with printed pages, bookmarks and slow page turns.
- `/eg/sleeping`: closed eyes, little pillows, gentle breathing and floating Zs.
