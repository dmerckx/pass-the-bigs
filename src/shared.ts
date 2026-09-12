import type { Game, PlayerIndex } from "./game";
import type { ColorId, SkinId, PlayerProfile } from "./palette";
export const PLAYER_IDS = ["david", "elisabeth"] as const;
export type PlayerId = typeof PLAYER_IDS[number];
export function playerIndex(id: PlayerId): PlayerIndex { return id === "david" ? 0 : 1; }
export function isPlayerId(value: unknown): value is PlayerId { return value === "david" || value === "elisabeth"; }
export type MatchEvent = {
  id: string; number: number; match: number; at: number; player: PlayerId;
  // Legacy nudges remain readable in history; the command is no longer accepted.
  kind: "roll" | "bank" | "restart" | "nudge";
  ticket?: number; strength?: number; points?: number; turn: number; scores: [number, number];
};
export type ReplayTurn = { id: string; match: number; player: PlayerId; startScores: [number, number]; events: MatchEvent[] };
export type ReplaySession = { id: string; notBefore: number };
export type TurnNotice = { id: string; at: number; to: PlayerId };
export type Snapshot = {
  serverTime: number; revision: number; gameRevision: number; match: number; game: Game; availableAt: number;
  lastRoll: MatchEvent | null; lastRolls: [MatchEvent | null, MatchEvent | null]; turnNotice: TurnNotice | null; profiles: Record<PlayerId, PlayerProfile>;
  replays: [ReplayTurn | null, ReplayTurn | null]; replaySessions: [ReplaySession | null, ReplaySession | null];
  pushPublicKey: string; notificationsEnabled: [boolean, boolean];
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
