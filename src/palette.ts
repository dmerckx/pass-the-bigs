export const COLOR_IDS = ["blue", "plum", "amber"] as const;
export type ColorId = typeof COLOR_IDS[number];
export const SKIN_IDS = ["white", "pink", "brown"] as const;
export type SkinId = typeof SKIN_IDS[number];
export type PlayerProfile = { color: ColorId; skin: SkinId; completed: boolean };
export const COLOR_PALETTES = {
  blue: { name: "Blue", background: "#1b354f", accent: "#b8dafa", felt: 0x244661, rim: 0x8aadc9, ground: 0x50697f },
  plum: { name: "Plum", background: "#512e48", accent: "#f4bad9", felt: 0x693e59, rim: 0xc292b4, ground: 0x80596f },
  amber: { name: "Amber", background: "#513b20", accent: "#f7d28c", felt: 0x72532d, rim: 0xcfad75, ground: 0x816948 },
} satisfies Record<ColorId, { name: string; background: string; accent: string; felt: number; rim: number; ground: number }>;
export const PIG_SKINS = {
  white: { body: 0xeee8dc, details: 0xd5aaa7, hoof: 0x948780 },
  pink: { body: 0xf0b8ad, details: 0xd27e86, hoof: 0xb36d77 },
  brown: { body: 0x986342, details: 0xbc8b76, hoof: 0x604331 },
} satisfies Record<SkinId, { body: number; details: number; hoof: number }>;
export function defaultProfiles(): { david: PlayerProfile; elisabeth: PlayerProfile } {
  return { david: { color: "blue", skin: "pink", completed: false }, elisabeth: { color: "plum", skin: "pink", completed: false } };
}
export function isColorId(value: unknown): value is ColorId { return COLOR_IDS.includes(value as ColorId); }
export function isSkinId(value: unknown): value is SkinId { return SKIN_IDS.includes(value as SkinId); }
