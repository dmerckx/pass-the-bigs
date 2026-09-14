export const PLAYER_IDS = ["david", "elisabeth", "ine"] as const;
export const PLAYERS = ["David", "Elisabeth", "Ine"] as const;
export const PLAYER_INDICES = [0, 1, 2] as const;
export type PlayerId = typeof PLAYER_IDS[number];
export type PlayerIndex = typeof PLAYER_INDICES[number];
export type PlayerValues<T> = [T, T, T];
export function nextPlayer(player: PlayerIndex): PlayerIndex { return ((player + 1) % PLAYERS.length) as PlayerIndex; }
export function playerIndex(id: PlayerId): PlayerIndex { return PLAYER_IDS.indexOf(id) as PlayerIndex; }
export function isPlayerId(value: unknown): value is PlayerId { return PLAYER_IDS.includes(value as PlayerId); }
export function playerValues<T>(value: (index: PlayerIndex) => T): PlayerValues<T> { return PLAYER_INDICES.map(value) as PlayerValues<T>; }
export function scoresForPlayers(scores: readonly number[]): PlayerValues<number> { return playerValues(i => scores[i] ?? 0); }
