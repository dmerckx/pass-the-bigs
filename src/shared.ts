import type { Game, PlayerIndex } from "./game";
export const PLAYER_IDS = ["david", "elisabeth"] as const;
export type PlayerId = typeof PLAYER_IDS[number];
export function playerIndex(id: PlayerId): PlayerIndex { return id === "david" ? 0 : 1; }
export function isPlayerId(value: unknown): value is PlayerId { return value === "david" || value === "elisabeth"; }
export type MatchEvent = {
  id: string; number: number; match: number; at: number; player: PlayerId;
  kind: "roll" | "bank" | "restart" | "nudge";
  ticket?: number; strength?: number; points?: number; turn: number; scores: [number, number];
};
export type Nudge = { id: string; at: number; from: PlayerId; to: PlayerId };
export type Snapshot = {
  serverTime: number; revision: number; gameRevision: number; match: number; game: Game; availableAt: number;
  lastRoll: MatchEvent | null; lastNudge: Nudge | null;
  pushPublicKey: string; notificationsEnabled: [boolean, boolean];
};
export type Command = {
  id: string; player: PlayerId; expectedRevision: number;
  kind: "roll" | "bank" | "restart" | "nudge" | "subscribe" | "unsubscribe";
  strength?: number; subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  endpoint?: string;
};
export type ActionResponse = { state: Snapshot; event?: MatchEvent; delivery?: "push" | "in-app" | "failed" };
export const NUDGE_TEXT = "Hey, its your turn in pass the pigs!";
