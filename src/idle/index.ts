import { music } from "./music";
export const idleAnimations = { music };
export type IdleId = keyof typeof idleAnimations;
export const IDLE_IDS = Object.keys(idleAnimations) as IdleId[];
export function isIdleId(value: string): value is IdleId { return Object.hasOwn(idleAnimations, value); }
export function randomIdle(previous?: IdleId): IdleId {
  const choices = IDLE_IDS.filter(id => id !== previous);
  return choices.length ? choices[Math.floor(Math.random() * choices.length)]! : IDLE_IDS[0]!;
}
export type { IdleAnimation } from "./props";
