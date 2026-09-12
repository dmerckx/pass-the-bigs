import { createHash } from "node:crypto";
import webpush from "web-push";
import { newGame, resolveRoll, bankTurn } from "../src/game";
import { outcomeForTicket } from "../src/rules";
import { tossSettings } from "../src/toss";
import { PLAYER_IDS, playerIndex, type Command, type MatchEvent, type TurnNotice, type Snapshot, type ReplayTurn, type ReplaySession } from "../src/shared";

import { defaultProfiles, isColorId, isSkinId, type PlayerProfile } from "../src/palette";
import { makeTurn, needsReplay, recordReplayEvent, replayDuration, upgradeReplays } from "./replay";

export type StoredState = {
  schema: 2; revision: number; gameRevision: number; match: number; game: ReturnType<typeof newGame>;
  availableAt: number; history: MatchEvent[]; lastRoll: MatchEvent | null; turnNotice: TurnNotice | null; profiles: Record<"david" | "elisabeth", PlayerProfile>;
  subscriptions: Record<"david" | "elisabeth", webpush.PushSubscription[]>;
  vapid: { publicKey: string; privateKey: string };
  turnNumber: number; currentTurn: ReplayTurn; replays: [ReplayTurn | null, ReplayTurn | null];
  replayAcknowledged: [string | null, string | null]; replaySessions: [ReplaySession | null, ReplaySession | null];
  receipts: { id: string; fingerprint: string }[];
};
export class GameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function initialState(): StoredState {
  return { schema: 2, revision: 0, gameRevision: 0, match: 1, game: newGame(), availableAt: 0,
    history: [], lastRoll: null, turnNotice: null, profiles: defaultProfiles(), subscriptions: { david: [], elisabeth: [] },
    vapid: webpush.generateVAPIDKeys(), receipts: [], turnNumber: 1, currentTurn: makeTurn(1, 1, "david", [0, 0]),
    replays: [null, null], replayAcknowledged: [null, null], replaySessions: [null, null] };
}
export function validateState(value: unknown): StoredState {
  const s = value as StoredState;
  if (!s || s.schema !== 2 || !Number.isSafeInteger(s.revision) || !Number.isSafeInteger(s.gameRevision)
    || !s.game || !Array.isArray(s.history) || !Array.isArray(s.receipts)
    || !Array.isArray(s.subscriptions?.david) || !Array.isArray(s.subscriptions?.elisabeth)
    || !s.vapid?.publicKey || !s.vapid?.privateKey) {
    throw new Error("Stored state is invalid; restore a valid state file instead of overwriting it.");
  }
  // Existing matches keep all scores, subscriptions and history. Each player
  // chooses their appearance once after upgrading.
  s.profiles ??= defaultProfiles();
  s.turnNotice ??= null;
  for (const player of PLAYER_IDS) {
    const profile = s.profiles[player];
    if (!profile || !isColorId(profile.color) || !isSkinId(profile.skin) || typeof profile.completed !== "boolean") {
      throw new Error("Stored player preferences are invalid.");
    }
  }
  upgradeReplays(s);
  return s;
}
export function snapshot(s: StoredState): Snapshot {
  return { serverTime: Date.now(), revision: s.revision, gameRevision: s.gameRevision, match: s.match, game: s.game,
    availableAt: s.availableAt, lastRoll: s.lastRoll, turnNotice: s.turnNotice, profiles: s.profiles,
    replays: [needsReplay(s, 0) ? s.replays[0] : null, needsReplay(s, 1) ? s.replays[1] : null],
    replaySessions: s.replaySessions, pushPublicKey: s.vapid.publicKey,
    notificationsEnabled: [s.subscriptions.david.length > 0, s.subscriptions.elisabeth.length > 0] };
}
function fingerprint(command: Command) { return createHash("sha256").update(JSON.stringify(command)).digest("hex"); }
export function applyCommand(current: StoredState, command: Command, now: number, ticket: number) {
  const hash = fingerprint(command), receipt = current.receipts.find(r => r.id === command.id);
  if (receipt) {
    if (receipt.fingerprint !== hash) throw new GameError(409, "This request was already used for a different action.");
    return { state: current, event: current.history.find(e => e.id === command.id), applied: false };
  }
  const s = structuredClone(current), player = playerIndex(command.player);
  const isGameMove = ["roll", "bank", "restart"].includes(command.kind);
  if (isGameMove) {
    if (command.expectedRevision !== s.gameRevision) throw new GameError(409, "The match changed. Your screen has been refreshed.");
    if (now < s.availableAt) throw new GameError(409, "Let the pigs land first.");
    if (command.kind !== "restart" && s.game.winner !== null) throw new GameError(409, "This match has finished.");
    if (command.kind !== "restart" && !s.profiles[command.player].completed) throw new GameError(409, "Choose your color and piggy skin first.");
    if (command.kind !== "restart" && needsReplay(s, player)) throw new GameError(409, "Replay the other player's turn first.");
    if (command.kind !== "restart" && s.game.active !== player) throw new GameError(403, "It is the other player's turn.");
  }
  let event: MatchEvent | undefined;
  if (command.kind === "roll") {
    s.game = resolveRoll(s.game, ticket);
    s.availableAt = now + Math.ceil(tossSettings(command.strength!).duration) + 150;
    event = { id: command.id, number: s.history.length + 1, match: s.match, at: now, player: command.player,
      kind: "roll", ticket, strength: command.strength, points: outcomeForTicket(ticket).points,
      turn: s.game.turn, scores: [...s.game.scores] };
    s.lastRoll = event;
  } else if (command.kind === "bank") {
    if (s.game.turn === 0) throw new GameError(409, "There are no turn points to bank.");
    const points = s.game.turn;
    s.game = bankTurn(s.game);
    event = { id: command.id, number: s.history.length + 1, match: s.match, at: now, player: command.player,
      kind: "bank", points, turn: 0, scores: [...s.game.scores] };
  } else if (command.kind === "restart") {
    s.game = newGame(s.game); s.match++; s.lastRoll = null; s.availableAt = 0;
    event = { id: command.id, number: s.history.length + 1, match: s.match, at: now, player: command.player,
      kind: "restart", turn: 0, scores: [0, 0] };
  } else if (command.kind === "setup") {
    if (!isColorId(command.color) || !isSkinId(command.skin)) throw new GameError(400, "Choose a valid color and piggy skin.");
    if (s.profiles[command.player].completed) throw new GameError(409, "Your player is already set up. Refresh to continue.");
    const other = s.profiles[PLAYER_IDS[player === 0 ? 1 : 0]];
    if (other.completed && other.color === command.color) throw new GameError(409, "That color was just picked. Please choose another.");
    s.profiles[command.player] = { color: command.color, skin: command.skin, completed: true };
  } else if (command.kind === "start-replay" || command.kind === "finish-replay") {
    const replay = s.replays[player];
    if (!replay || !needsReplay(s, player) || replay.id !== command.replayId || replay.match !== s.match) throw new GameError(409, "That replay is no longer available. Refresh the match.");
    if (command.kind === "start-replay") {
      // Starting again deliberately requires the whole sequence again.
      s.replaySessions[player] = { id: replay.id, notBefore: now + Math.ceil(replayDuration(replay, command.reducedMotion)) };
    } else {
      const session = s.replaySessions[player];
      if (!session || session.id !== replay.id || now < session.notBefore) throw new GameError(409, "Watch the entire turn before playing.");
      s.replayAcknowledged[player] = replay.id;
      s.replaySessions[player] = null;
    }
  } else if (command.kind === "subscribe") {
    // A device belongs to the selected player, even after switching routes.
    for (const id of PLAYER_IDS) s.subscriptions[id] = s.subscriptions[id].filter(p => p.endpoint !== command.subscription!.endpoint);
    s.subscriptions[command.player].push(command.subscription!);
    s.subscriptions[command.player] = s.subscriptions[command.player].slice(-8);
  } else {
    s.subscriptions[command.player] = s.subscriptions[command.player].filter(p => p.endpoint !== command.endpoint);
  }
  if (event) { recordReplayEvent(s, event); s.history.push(event); }
  let notice: TurnNotice | undefined;
  if (isGameMove && s.game.winner === null && (s.game.active !== current.game.active || command.kind === "restart")) {
    // The turn ID is stable across command retries and replay acknowledgements.
    notice = { id: s.currentTurn.id, at: now, to: PLAYER_IDS[s.game.active] };
    s.turnNotice = notice;
  }
  if (isGameMove) s.gameRevision++;
  s.revision++;
  s.receipts.push({ id: command.id, fingerprint: hash });
  s.receipts = s.receipts.slice(-512);
  return { state: s, event, notice, applied: true };
}
