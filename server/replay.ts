import { outcomeForTicket } from "../src/rules";
import { tossSettings } from "../src/toss";
import { BAD_ROLL_PAUSE_MS } from "../src/roll-feedback";
import { PLAYER_IDS, playerIndex, type MatchEvent, type PlayerId, type ReplayTurn } from "../src/shared";
import type { StoredState } from "./model";

export function makeTurn(match: number, number: number, player: PlayerId, scores: [number, number]): ReplayTurn {
  return { id: `${match}:${number}`, match, player, startScores: [...scores], events: [] };
}
export function replayDuration(turn: ReplayTurn, reduced = false) {
  return turn.events.reduce((total, event) => total + (event.kind === "roll"
    ? tossSettings(event.strength ?? 0, reduced).duration + (reduced ? 0 : 110)
      + (outcomeForTicket(event.ticket!).kind === "score" ? 350 : BAD_ROLL_PAUSE_MS)
    : 700), 0);
}
export function needsReplay(state: StoredState, player: 0 | 1) {
  const turn = state.replays[player];
  return turn !== null && state.replayAcknowledged[player] !== turn.id;
}
export function recordReplayEvent(state: StoredState, event: MatchEvent) {
  if (event.kind === "restart") {
    state.turnNumber = 1;
    state.currentTurn = makeTurn(state.match, 1, "david", [0, 0]);
    state.replays = [null, null]; state.replayAcknowledged = [null, null]; state.replaySessions = [null, null];
    return;
  }
  if (event.kind !== "roll" && event.kind !== "bank") return;
  const actor = playerIndex(event.player), other = actor === 0 ? 1 : 0;
  state.currentTurn.events.push(event);
  const complete = event.kind === "bank" || outcomeForTicket(event.ticket!).kind !== "score" || event.scores[actor] >= 100;
  if (complete) {
    state.replays[other] = structuredClone(state.currentTurn);
    state.replaySessions[other] = null;
    state.turnNumber++;
    state.currentTurn = makeTurn(state.match, state.turnNumber, PLAYER_IDS[other], event.scores);
  }
}
/** Upgrade an existing shared match without discarding scores or history. */
export function upgradeReplays(state: StoredState) {
  if (Array.isArray(state.replays) && state.currentTurn && Array.isArray(state.replaySessions) && Array.isArray(state.replayAcknowledged)) return;
  state.turnNumber = 1;
  state.currentTurn = makeTurn(1, 1, "david", [0, 0]);
  state.replays = [null, null]; state.replayAcknowledged = [null, null]; state.replaySessions = [null, null];
  const currentMatch = state.match;
  for (const event of state.history) {
    state.match = event.match;
    recordReplayEvent(state, event);
  }
  state.match = currentMatch;
}
