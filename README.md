# Pass the Bigs

A minimal, local two-player 3D Pass the Pigs game for David and Elisabeth.
Built with TypeScript, Three.js, and Bun (runtime, package manager, bundler,
development server, and test runner). No framework or external asset requests.

## Run

```sh
bun install
bun dev
```

Open http://localhost:3007. Hold either pig, then release to toss both.
Longer holds increase height, spin, and bounce without changing the odds.
Bank to keep the turn score and pass to the next player. A Pig Out loses
the turn; an Oinker loses that player's current game score. First to 100 wins.
Each player's best banked score and wins persist in this browser.

```sh
bun run check   # type checking, tests, static production build
bun start       # production Bun server
```

`PORT` (default 3007) and `HOST` (default 0.0.0.0) configure the server.
`bun run build` emits a deployable static site in `dist/`.

## Rules and probability provenance

Scoring follows [Winning Moves' 2023 official rules](https://winning-moves.com/images/PTP_Rule_2023.pdf).
The publisher does **not** provide an exact probability table. We therefore
use the complete empirical joint distribution in Table 4 of
[John C. Kern, *Pig Data and Bayesian Inference on Multinomial Probabilities*,
Journal of Statistics Education 14(3), 2006](https://jse.amstat.org/v14n3/datasets.kern.html).

The 36 non-contact counts total 5,977. The remaining 23 of 6,000 throws
were contact (Oinker). Sampling a uniform integer from 0–5,999 preserves
every measured combination frequency, including zero-count pairs. This
avoids independence assumptions and rounding errors from multiplying
single-pig percentages. These are empirical estimates, not official or
universal physical probabilities; real pigs and surfaces vary. Piggy Back
has no separate measured count in this study, so no invented chance is
assigned to it. All observed contact is represented as Oinker.

A cryptographic, unbiased ticket is reserved independently of input strength.
The animation follows that outcome; it is not a physics solver used to
determine scoring. Rare poses and contact are represented explicitly.
Refresh during a toss resolves the already-reserved ticket, preventing a
reload from discarding an unlucky result.

## Controls and persistence

- Mouse/touch: hold either 3D pig and release anywhere.
- Keyboard: focus either pig's invisible, labelled button; hold Space or Enter.
- Bank turn: keep the turn's points and pass.
- Rules & odds: published scores, measured combination percentages, sources.
- Rematch after a win: reset the current game, preserve best scores and wins.
- Saved game and records are local to the browser; no account or server storage.
