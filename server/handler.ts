import { applyCommand, GameError, snapshot } from "./model";
import { getStore, readState, transaction, type StateStore } from "./storage";
import { sendTurnNotification, validSubscription } from "./notifications";
import { isColorId, isSkinId } from "../src/palette";
import { isPlayerId, PLAYER_IDS, type Command } from "../src/shared";

function json(body: unknown, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
export function parseCommand(value: unknown): Command {
  const c = value as Command;
  if (!c || !isPlayerId(c.player) || typeof c.id !== "string" || !/^[\w-]{16,100}$/.test(c.id)
    || !Number.isSafeInteger(c.expectedRevision) || c.expectedRevision < 0
    || !["roll", "bank", "restart", "setup", "subscribe", "unsubscribe", "start-replay", "finish-replay"].includes(c.kind)) throw new GameError(400, "Invalid action.");
  if (c.kind === "setup" && (!isColorId(c.color) || !isSkinId(c.skin))) throw new GameError(400, "Choose a valid color and piggy skin.");
  if (c.kind === "roll" && (typeof c.strength !== "number" || !Number.isFinite(c.strength) || c.strength < 0 || c.strength > 1)) throw new GameError(400, "Invalid toss strength.");
  if (c.kind === "subscribe" && !validSubscription(c.subscription)) throw new GameError(400, "Invalid browser notification subscription.");
  if (c.kind === "unsubscribe" && (typeof c.endpoint !== "string" || c.endpoint.length > 2048)) throw new GameError(400, "Invalid notification endpoint.");
  if ((c.kind === "start-replay" || c.kind === "finish-replay")
    && (typeof c.replayId !== "string" || !/^\d+:\d+$/.test(c.replayId)
      || (c.reducedMotion !== undefined && typeof c.reducedMotion !== "boolean"))) throw new GameError(400, "Invalid replay.");
  if (c.expectedRollIndex !== undefined && (!Number.isSafeInteger(c.expectedRollIndex) || c.expectedRollIndex < 0)) throw new GameError(400, "Invalid roll sequence.");
  // Pick only supported fields: clients cannot submit points, poses or tickets.
  return { id: c.id, player: c.player, expectedRevision: c.expectedRevision, kind: c.kind,
    ...(c.kind === "setup" ? { color: c.color, skin: c.skin } : {}),
    ...(c.kind === "roll" ? { strength: c.strength, ...(c.expectedRollIndex !== undefined ? { expectedRollIndex: c.expectedRollIndex } : {}) } : {}),
    ...(c.kind === "subscribe" ? { subscription: c.subscription } : {}),
    ...(c.kind === "unsubscribe" ? { endpoint: c.endpoint } : {}),
    ...(["start-replay", "finish-replay"].includes(c.kind) ? { replayId: c.replayId, reducedMotion: !!c.reducedMotion } : {}),
  };
}
type Dependencies = { store?: StateStore; ticket?: () => number; now?: () => number; notify?: typeof sendTurnNotification };
export function createHandler(deps: Dependencies = {}) {
  return async function handle(request: Request): Promise<Response> {
    let store: StateStore | undefined;
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
      if (request.method === "POST") {
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) throw new GameError(403, "Cross-site actions are not allowed.");
        if (!request.headers.get("content-type")?.includes("application/json")) throw new GameError(415, "Use application/json.");
      }
      store = deps.store ?? getStore();
      if (request.method === "GET") {
        const state = await readState(store);
        if (url.searchParams.get("view") === "history") {
          const before = Math.max(0, Math.min(state.history.length, Number(url.searchParams.get("before") ?? state.history.length)));
          if (!Number.isSafeInteger(before)) throw new GameError(400, "Invalid history cursor.");
          const start = Math.max(0, before - 100);
          return json({ events: state.history.slice(start, before).reverse(), next: start || null, total: state.history.length });
        }
        const etag = `"${state.revision}"`;
        if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
        return json({ state: snapshot(state) }, 200, { ETag: etag });
      }
      if (Number(request.headers.get("content-length") ?? 0) > 8192) throw new GameError(413, "Action is too large.");
      const text = await request.text();
      if (text.length > 8192) throw new GameError(413, "Action is too large.");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new GameError(400, "Invalid JSON."); }
      const command = parseCommand(parsed), now = (deps.now ?? Date.now)();
      const ticket = command.kind === "roll" ? deps.ticket?.() : undefined;
      const result = await transaction(store, state => {
        const changed = applyCommand(state, command, now, ticket);
        if (command.kind === "restart" && changed.applied && state.game.winner === null) {
          throw new GameError(409, "Finish this match before restarting.");
        }
        return changed;
      });
      let delivery: string | undefined;
      if (result.applied && result.notice) {
        // Commit first. Only the request that created this turn sends its push.
        const sent = await (deps.notify ?? sendTurnNotification)(result.state, result.notice);
        delivery = sent.status;
        if (sent.expired.length) {
          const cleaned = await transaction(store, state => {
            const next = structuredClone(state);
            for (const player of PLAYER_IDS) next.subscriptions[player] = next.subscriptions[player].filter(s => !sent.expired.includes(s.endpoint));
            next.revision++;
            return { state: next, applied: true };
          });
          result.state = cleaned.state;
        }
      }
      return json({ state: snapshot(result.state), event: result.event, delivery });
    } catch (error) {
      const known = error instanceof GameError;
      if (!known) console.error("Game request failed:", error instanceof Error ? error.name : "unknown");
      const status = known ? error.status : 503;
      let current;
      if (status === 409 && store) {
        try { current = snapshot(await readState(store)); } catch { /* Preserve the original error. */ }
      }
      return json({ error: known ? error.message : "The match could not be reached. Please try again.", state: current }, status);
    }
  };
}
export const handleGameRequest = createHandler();
