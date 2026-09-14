import { nextPlayer, PLAYER_INDICES, type PlayerIndex, type PlayerValues } from "../src/players";
import { outcomeForTicket } from "../src/rules";
import { tossSettings } from "../src/toss";
import { BAD_ROLL_PAUSE_MS } from "../src/roll-feedback";
import { PLAYER_IDS, playerIndex, type MatchEvent, type PlayerId, type ReplayTurn } from "../src/shared";
import type { StoredState } from "./model";

export function makeTurn(match: number, number: number, player: PlayerId, scores: PlayerValues<number>): ReplayTurn {
  return { id: `${match}:${number}`, match, player, startScores: [...scores], events: [] };
}
export function replayDuration(turn: ReplayTurn, reduced = false) {
  return turn.events.reduce((total, event) => total + (event.kind === "roll"
    ? tossSettings(event.strength ?? 0, reduced).duration + (reduced ? 0 : 110)
      + (outcomeForTicket(event.ticket!).kind === "score" ? 350 : BAD_ROLL_PAUSE_MS)
    : 700), 0);
}
export function needsReplay(state: StoredState, player: PlayerIndex) {
  const turn = state.replays[player];
  return !!turn && state.replayAcknowledged[player] !== turn.id;
}
export function recordReplayEvent(state: StoredState, event: MatchEvent) {
  if (event.kind === "restart") {
    state.replayBacklog = [[], [], []];
    state.turnNumber = 1;
    state.currentTurn = makeTurn(state.match, 1, "david", [0, 0, 0]);
    state.replays = [null, null, null]; state.replayAcknowledged = [null, null, null]; state.replaySessions = [null, null, null];
    return;
  }
  if (event.kind !== "roll" && event.kind !== "bank") return;
  const actor = playerIndex(event.player), other = nextPlayer(actor);
  state.currentTurn.events.push(event);
  const complete = event.kind === "bank" || outcomeForTicket(event.ticket!).kind !== "score" || event.scores[actor] >= 100;
  if (complete) {
    for (const recipient of PLAYER_INDICES) {
      if (recipient === actor) continue;
      const turn = structuredClone(state.currentTurn);
      if (needsReplay(state, recipient)) state.replayBacklog[recipient].push(turn);
      else { state.replays[recipient] = turn; state.replaySessions[recipient] = null; }
    }
    state.turnNumber++;
    state.currentTurn = makeTurn(state.match, state.turnNumber, PLAYER_IDS[other], event.scores);
  }
}
/** Upgrade an existing shared match without discarding scores or history. */
export function upgradeReplays(state: StoredState) {
  if (Array.isArray(state.replays) && state.currentTurn && Array.isArray(state.replaySessions) && Array.isArray(state.replayAcknowledged)) return;
  state.turnNumber = 1;
  state.currentTurn = makeTurn(1, 1, "david", [0, 0, 0]);
  state.replays = [null, null, null]; state.replayAcknowledged = [null, null, null]; state.replaySessions = [null, null, null];
  state.replayBacklog = [[], [], []];
  const currentMatch = state.match;
  for (const event of state.history) {
    state.match = event.match;
    recordReplayEvent(state, event);
  }
  state.match = currentMatch;
}
