# Rules and probabilities

Scoring follows [Winning Moves' 2023 official rules](https://winning-moves.com/images/PTP_Rule_2023.pdf).
The publisher does not supply an exact roll-probability table. The game uses
the complete empirical joint distribution from Table 4 of
[John C. Kern, *Pig Data and Bayesian Inference on Multinomial Probabilities*,
Journal of Statistics Education 14(3), 2006](https://jse.amstat.org/v14n3/datasets.kern.html).

There are 5,977 non-contact observations plus 23 touching rolls, out of
6,000 throws. The server samples an unbiased integer from 0 through 5,999,
maps it to that table, then returns the result for the 3D animation.
Press duration and camera direction are not inputs to outcome sampling.

| First / second pig | Dot up | Dot down | Trotter | Razorback | Snouter | Leaning Jowler |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dot up | 573 | 656 | 139 | 360 | 56 | 12 |
| Dot down | 623 | 731 | 185 | 449 | 58 | 17 |
| Trotter | 155 | 180 | 45 | 149 | 17 | 5 |
| Razorback | 396 | 473 | 124 | 308 | 45 | 8 |
| Snouter | 54 | 67 | 13 | 47 | 2 | 1 |
| Leaning Jowler | 10 | 10 | 0 | 7 | 1 | 1 |

Settings → Rules & odds aggregates both orders of equivalent combinations.
Probabilities there are observation counts divided by 6,000. A zero-count
ordered cell stays zero; multiplying rounded single-pig percentages would
not reproduce this joint distribution.

All observed touching rolls are represented as Oinker. The study has no
separate measured Piggy Back frequency, so the game does not invent one.
These are measured estimates, not official universal probabilities. Real
pig shapes, wear, surfaces and throwing techniques can change frequencies.
