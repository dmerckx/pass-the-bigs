/**
 * Official scoring: https://winning-moves.com/images/PTP_Rule_2023.pdf
 * Empirical JOINT frequencies: Kern (2006), Table 4, 6000 throws.
 * https://jse.amstat.org/v14n3/datasets.kern.html
 * These are measured estimates, NOT publisher-certified probabilities.
 * Keep the joint observations, including the 23 touching throws; do not
 * multiply rounded single-pig percentages or make odds depend on strength.
 */
export const POSES = ["dot-up", "dot-down", "trotter", "razorback", "snouter", "jowler"] as const;
export type Pose = typeof POSES[number];
export const POSE_NAMES: Record<Pose, string> = {
  "dot-up": "Sider · dot up", "dot-down": "Sider · dot down",
  trotter: "Trotter", razorback: "Razorback", snouter: "Snouter", jowler: "Leaning Jowler",
};
export const JOINT_COUNTS = [
  [573, 656, 139, 360, 56, 12],
  [623, 731, 185, 449, 58, 17],
  [155, 180, 45, 149, 17, 5],
  [396, 473, 124, 308, 45, 8],
  [54, 67, 13, 47, 2, 1],
  [10, 10, 0, 7, 1, 1],
] as const;
export const TOUCHING_COUNT = 23;
export const SAMPLE_SIZE = 6000;
export type Outcome = {
  poses: [Pose, Pose];
  name: string;
  points: number;
  kind: "score" | "pig-out" | "oinker";
};
const points: Record<Pose, number> = {
  "dot-up": 0, "dot-down": 0, trotter: 5, razorback: 5, snouter: 10, jowler: 15,
};
export function scorePoses(a: Pose, b: Pose, touching = false): Outcome {
  const poses: [Pose, Pose] = [a, b];
  if (touching) return { poses, name: "Oinker", points: 0, kind: "oinker" };
  const sideA = points[a] === 0, sideB = points[b] === 0;
  if (sideA && sideB) return a === b
    ? { poses, name: "Sider", points: 1, kind: "score" }
    : { poses, name: "Pig Out", points: 0, kind: "pig-out" };
  const name = a === b ? `Double ${POSE_NAMES[a]}`
    : sideA ? POSE_NAMES[b] : sideB ? POSE_NAMES[a] : `${POSE_NAMES[a]} + ${POSE_NAMES[b]}`;
  return { poses, name, points: a === b ? points[a] * 4 : points[a] + points[b], kind: "score" };
}
/** An unbiased integer ticket; outcome entropy never comes from animation. */
export function randomTicket(): number {
  const value = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / SAMPLE_SIZE) * SAMPLE_SIZE;
  do { crypto.getRandomValues(value); } while (value[0]! >= limit);
  return value[0]! % SAMPLE_SIZE;
}
export function outcomeForTicket(ticket: number): Outcome {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= SAMPLE_SIZE) throw new RangeError("Invalid roll ticket");
  let cursor = 0;
  for (let a = 0; a < POSES.length; a++) {
    for (let b = 0; b < POSES.length; b++) {
      cursor += JOINT_COUNTS[a]![b]!;
      if (ticket < cursor) return scorePoses(POSES[a]!, POSES[b]!);
    }
  }
  // The study records contact, not the poses of the touching pigs.
  // Both stand side by side and visibly touch in the Oinker animation.
  return scorePoses("trotter", "trotter", true);
}
export function combinationOdds() {
  const groups = new Map<string, { name: string; points: number; kind: Outcome["kind"]; count: number }>();
  for (let ticket = 0; ticket < SAMPLE_SIZE; ticket++) {
    const roll = outcomeForTicket(ticket);
    const group = groups.get(roll.name) ?? { name: roll.name, points: roll.points, kind: roll.kind, count: 0 };
    group.count++;
    groups.set(roll.name, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
