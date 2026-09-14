import type { Game, PlayerIndex } from "./game";
import type { ColorId, SkinId, PlayerProfile } from "./palette";
import type { PlayerValues } from "./players";
export { PLAYER_IDS, playerIndex, isPlayerId, type PlayerId } from "./players";
import type { PlayerId } from "./players";
export type MatchEvent = {
  id: string; number: number; match: number; at: number; player: PlayerId;
  // Legacy nudges remain readable in history; the command is no longer accepted.
  kind: "roll" | "bank" | "restart" | "nudge";
  ticket?: number; strength?: number; points?: number; turn: number; scores: PlayerValues<number>;
};
export type ReplayTurn = { id: string; match: number; player: PlayerId; startScores: PlayerValues<number>; events: MatchEvent[] };
export type ReplaySession = { id: string; notBefore: number };
export type TurnNotice = { id: string; at: number; to: PlayerId };
export type Snapshot = {
  serverTime: number; revision: number; gameRevision: number; match: number; game: Game; availableAt: number;
  lastRoll: MatchEvent | null; lastRolls: PlayerValues<MatchEvent | null>; turnNotice: TurnNotice | null; profiles: Record<PlayerId, PlayerProfile>;
  replays: PlayerValues<ReplayTurn | null>; replaySessions: PlayerValues<ReplaySession | null>;
  pushPublicKey: string; notificationsEnabled: PlayerValues<boolean>;
};
export type Command = {
  id: string; player: PlayerId; expectedRevision: number;
  // The public API allows restart only after a winner has been recorded.
  kind: "roll" | "bank" | "restart" | "setup" | "subscribe" | "unsubscribe" | "start-replay" | "finish-replay";
  strength?: number; subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  endpoint?: string; replayId?: string; reducedMotion?: boolean; color?: ColorId; skin?: SkinId;
};
export type ActionResponse = { state: Snapshot; event?: MatchEvent; delivery?: "push" | "in-app" | "failed" };
export const TURN_TEXT = "Hey, its your turn in pass the pigs!";
