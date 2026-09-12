import type { PlayerId } from "./shared";
export const PLAYER_PALETTES: Record<PlayerId, { background: string; accent: string; felt: number; rim: number; ground: number }> = {
  david: { background: "#1b354f", accent: "#b8dafa", felt: 0x244661, rim: 0x8aadc9, ground: 0x50697f },
  elisabeth: { background: "#512e48", accent: "#f4bad9", felt: 0x693e59, rim: 0xc292b4, ground: 0x80596f },
};
