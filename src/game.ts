import { outcomeForTicket, type Outcome } from "./rules";
export const PLAYERS = ["David", "Elisabeth"] as const;
export const TARGET = 100;
export type PlayerIndex = 0 | 1;
export type Game = {
  scores: [number, number];
  best: [number, number];
  wins: [number, number];
  active: PlayerIndex;
  turn: number;
  winner: PlayerIndex | null;
  lastTicket: number | null;
  lastPlayer: PlayerIndex | null;
  message: string;
};
export function newGame(previous?: Pick<Game, "best" | "wins">): Game {
  return { scores: [0, 0], best: [...(previous?.best ?? [0, 0])], wins: [...(previous?.wins ?? [0, 0])],
    active: 0, turn: 0, winner: null, lastTicket: null, lastPlayer: null,
    message: "Hold either pig. Release to toss." };
}
function clone(game: Game): Game {
  return { ...game, scores: [...game.scores], best: [...game.best], wins: [...game.wins] };
}
function finish(game: Game): Game {
  game.scores[game.active] += game.turn;
  game.best[game.active] = Math.max(game.best[game.active], game.scores[game.active]);
  game.turn = 0;
  game.winner = game.active;
  game.wins[game.active]++;
  game.message = `${PLAYERS[game.active]} wins!`;
  return game;
}
export function resolveRoll(state: Game, ticket: number): Game {
  if (state.winner !== null) return state;
  const roll = outcomeForTicket(ticket), game = clone(state), player = game.active;
  game.lastTicket = ticket;
  game.lastPlayer = player;
  if (roll.kind !== "score") {
    const lost = game.turn;
    game.turn = 0;
    if (roll.kind === "oinker") game.scores[player] = 0;
    game.active = player === 0 ? 1 : 0;
    game.message = roll.kind === "oinker"
      ? `${PLAYERS[player]} lost their game score. ${PLAYERS[game.active]}'s turn.`
      : `${PLAYERS[player]} lost ${lost} turn ${lost === 1 ? "point" : "points"}. ${PLAYERS[game.active]}'s turn.`;
  } else {
    game.turn += roll.points;
    game.message = "Press a pig to risk another roll, or bank your points.";
    if (game.scores[player] + game.turn >= TARGET) finish(game);
  }
  return game;
}
export function bankTurn(state: Game): Game {
  if (state.winner !== null || state.turn === 0) return state;
  const game = clone(state), player = game.active, banked = game.turn;
  if (game.scores[player] + game.turn >= TARGET) return finish(game);
  game.scores[player] += game.turn;
  game.best[player] = Math.max(game.best[player], game.scores[player]);
  game.turn = 0;
  game.active = player === 0 ? 1 : 0;
  game.message = `${PLAYERS[player]} banked ${banked}. ${PLAYERS[game.active]}'s turn.`;
  return game;
}
export function lastOutcome(game: Game): Outcome | null {
  return game.lastTicket === null ? null : outcomeForTicket(game.lastTicket);
}
export const STORAGE_KEY = "pass-the-bigs:v1";
export type Save = { version: 1; game: Game; pendingTicket: number | null };
export function encodeSave(game: Game, pendingTicket: number | null = null): string {
  return JSON.stringify({ version: 1, game, pendingTicket } satisfies Save);
}
const isScore = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const isPair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isScore);
const isPlayer = (n: unknown): n is PlayerIndex => n === 0 || n === 1;
const isTicket = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) < 6000;
export function decodeSave(raw: string | null): Game {
  if (!raw) return newGame();
  try {
    const data = JSON.parse(raw) as Save, g = data.game;
    if (data.version !== 1 || !g || !isPair(g.scores) || !isPair(g.best) || !isPair(g.wins)
      || !isScore(g.turn) || !isPlayer(g.active) || !(g.winner === null || isPlayer(g.winner))
      || !(g.lastPlayer === null || isPlayer(g.lastPlayer))
      || !(g.lastTicket === null || isTicket(g.lastTicket)) || typeof g.message !== "string"
      || !(data.pendingTicket === null || isTicket(data.pendingTicket))) return newGame();
    return data.pendingTicket === null ? g : resolveRoll(g, data.pendingTicket);
  } catch { return newGame(); }
}
