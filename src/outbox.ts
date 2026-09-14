import { bankTurn, resolveRoll } from "./game";
import { seededTicket, validSeed } from "./seed";
import { outcomeForTicket } from "./rules";
import { playerIndex, type Command, type MatchEvent, type PlayerId, type Snapshot } from "./shared";

export const MAX_BUFFERED_MOVES = 32;
type BufferedMove = { command: Command; at: number };
type SavedOutbox = { version: 1; base: Snapshot; moves: BufferedMove[] };
export class MoveConflict extends Error {
  constructor(message: string, public state: Snapshot) { super(message); }
}
/** Same scoring and seed as the server; this projection never commits a shared move. */
export function projectMove(base: Snapshot, command: Command, at = Date.now()): Snapshot {
  const actor = playerIndex(command.player);
  if (!["roll", "bank"].includes(command.kind) || command.expectedRevision !== base.gameRevision
    || base.game.active !== actor || base.game.winner !== null || base.replays[actor]
    || !base.profiles[command.player].completed) throw new Error("The match changed before this move could be saved.");
  const next = structuredClone(base), points = base.game.turn;
  let event: MatchEvent;
  if (command.kind === "roll") {
    if (command.expectedRollIndex !== base.rollIndex || typeof command.strength !== "number" || command.strength < 0 || command.strength > 1) throw new Error("The roll sequence changed.");
    const ticket = seededTicket(base.rollSeed, base.rollIndex);
    next.game = resolveRoll(base.game, ticket); next.rollIndex++;
    event = { id: command.id, number: base.eventCount + 1, match: base.match, at, player: command.player,
      kind: "roll", ticket, strength: command.strength, points: outcomeForTicket(ticket).points, turn: next.game.turn, scores: [...next.game.scores] };
    next.lastRoll = event; next.lastRolls[actor] = event;
  } else {
    if (!points) throw new Error("There are no turn points to bank.");
    next.game = bankTurn(base.game);
    event = { id: command.id, number: base.eventCount + 1, match: base.match, at, player: command.player,
      kind: "bank", points, turn: 0, scores: [...next.game.scores] };
  }
  next.eventCount++; next.gameRevision++; next.revision++;
  next.availableAt = 0; next.turnNotice = null;
  return next;
}

/** Durable FIFO. A GitHub response may arrive while several later tosses animate. */
export class MoveOutbox {
  private moves: BufferedMove[] = [];
  private base: Snapshot;
  private sending = false;
  constructor(base: Snapshot, private persist: (value: string | null) => void) { this.base = structuredClone(base); }
  get count() { return this.moves.length; }
  get full() { return this.count >= MAX_BUFFERED_MOVES; }
  get flushing() { return this.sending; }
  get view(): Snapshot { return this.moves.reduce((state, move) => projectMove(state, move.command, move.at), structuredClone(this.base)); }
  private save(base: Snapshot, moves: BufferedMove[]) {
    // Persist before acknowledging or animating anything; quota failures retain the previous queue.
    this.persist(moves.length ? JSON.stringify({ version: 1, base, moves } satisfies SavedOutbox) : null);
    this.base = structuredClone(base); this.moves = structuredClone(moves);
  }
  enqueue(command: Command, at = Date.now()) {
    if (this.full) throw new Error("Your buffered rolls are still saving. Please wait a moment.");
    const next = projectMove(this.view, command, at);
    this.save(this.base, [...this.moves, { command, at }]);
    return next;
  }
  accept(state: Snapshot, acknowledgedId?: string) {
    const moves = this.moves.filter(move => move.command.id !== acknowledgedId && !state.recentMoves.includes(move.command.id));
    let conflict = false;
    try { moves.reduce((base, move) => projectMove(base, move.command, move.at), state); }
    catch { conflict = true; }
    this.save(state, conflict ? [] : moves);
    return conflict;
  }
  discard(state: Snapshot) { this.save(state, []); }
  async flush(post: (command: Command) => Promise<Snapshot>, changed: (conflict: boolean) => void | Promise<void>) {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.moves.length) {
        const command = this.moves[0]!.command;
        try {
          const state = await post(command);
          const conflict = this.accept(state, command.id);
          await changed(conflict);
          if (conflict) return;
        } catch (error) {
          if (error instanceof MoveConflict) { this.discard(error.state); await changed(true); }
          throw error;
        }
      }
    } finally { this.sending = false; }
  }
  static restore(raw: string | null, player: PlayerId, persist: (value: string | null) => void): MoveOutbox | null {
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw) as SavedOutbox;
      if (saved.version !== 1 || !validSeed(saved.base.rollSeed) || !Array.isArray(saved.moves)
        || saved.moves.length > MAX_BUFFERED_MOVES || !saved.moves.every(move => move.command.player === player && Number.isFinite(move.at))) return null;
      const outbox = new MoveOutbox(saved.base, persist);
      outbox.moves = saved.moves; void outbox.view;
      return outbox;
    } catch { return null; }
  }
}
