import { PigTable } from "./scene";
import { PLAYERS, lastOutcome } from "./game";
import { combinationOdds, POSE_NAMES, SAMPLE_SIZE, outcomeForTicket } from "./rules";
import { strengthForHold } from "./toss";
import { NUDGE_TEXT, PLAYER_IDS, playerIndex, type ActionResponse, type Command, type MatchEvent, type PlayerId, type Snapshot } from "./shared";

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function requestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; LAN HTTP gameplay still needs IDs.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Game state lives on the server. */ }
}
export async function startGame(me: PlayerId) {
  const mine = playerIndex(me), other = PLAYER_IDS[mine === 0 ? 1 : 0];
  let state: Snapshot | null = null, connected = false, busy = false, failed = false;
  let seenRoll: string | null = null, unlockAt = 0, syncing = false;
  let table: PigTable | null = null;
  let hold: { start: number; target: HTMLButtonElement; pointer: number | null; key: string | null } | null = null;
  let pending: Command | null = null;
  const pendingKey = `pigs:pending:${me}`;
  try { pending = JSON.parse(stored(pendingKey) ?? "null"); } catch { /* Ignore malformed browser metadata. */ }
  if (pending?.player !== me) pending = null;
  const pigs = [el<HTMLButtonElement>("pig-0"), el<HTMLButtonElement>("pig-1")];
  const roll = el<HTMLButtonElement>("roll"), bank = el<HTMLButtonElement>("bank"), nudge = el<HTMLButtonElement>("nudge");
  const settings = el<HTMLDialogElement>("settings-dialog"), history = el<HTMLDialogElement>("history-dialog"), rules = el<HTMLDialogElement>("rules-dialog");
  const notifyButton = el<HTMLButtonElement>("notifications");
  let historyBefore: number | null = null;
  function message(text: string, retry = false) {
    el("toast-text").textContent = text; el("toast").hidden = false; el("retry").hidden = !retry;
  }
  function ready() { return state && connected && !busy && !hold && !pending && performance.now() >= unlockAt; }
  function render() {
    const game = state?.game, ownTurn = game?.active === mine && game.winner === null;
    for (const i of [0, 1]) {
      const player = el(`player-${i}`);
      player.classList.toggle("active", game?.active === i);
      el(`score-${i}`).textContent = String(game?.scores[i] ?? 0);
      el(`best-${i}`).textContent = String(game?.best[i] ?? 0);
      player.querySelector(".active-label")!.textContent = game?.winner === i ? "WINNER"
        : game?.active === i ? (i === mine ? "YOUR TURN" : "PLAYING") : (i === mine ? "YOU" : "WAITING");
      player.setAttribute("aria-label", `${PLAYERS[i]}: ${game?.scores[i] ?? 0} points${game?.active === i ? ", active player" : ""}`);
    }
    const outcome = game ? lastOutcome(game) : null;
    el("combination").textContent = outcome?.name ?? "Ready to roll";
    el("roll-score").textContent = outcome ? outcome.kind === "score" ? `+${outcome.points}` : "0 pts" : "";
    el("turn-score").textContent = String(game?.turn ?? 0);
    el("result").classList.toggle("bust", !!outcome && outcome.kind !== "score");
    for (const i of [0, 1]) el(`pig-label-${i}`).textContent = busy || !outcome ? "" : POSE_NAMES[outcome.poses[i]!];
    const canAct = !!ready() && !!ownTurn;
    for (const target of pigs) target.disabled = !canAct || failed;
    roll.disabled = !canAct || failed;
    bank.disabled = !canAct || !game?.turn;
    roll.textContent = game?.turn ? "Keep rolling" : "Toss pigs";
    el("own-actions").hidden = !!game && (!ownTurn || game.winner !== null);
    nudge.hidden = !game || !!ownTurn || game.winner !== null;
    nudge.textContent = `Nudge ${PLAYERS[mine === 0 ? 1 : 0]}`;
    nudge.disabled = !ready();
    el("rematch").hidden = !game || game.winner === null;
    (el("rematch") as HTMLButtonElement).disabled = !ready();
    notifyButton.disabled = !state || busy;
    el("records").textContent = game ? `Wins · David ${game.wins[0]} / Elisabeth ${game.wins[1]}` : "";
    const wait = unlockAt - performance.now();
    if (wait > 0) setTimeout(render, wait + 25);
  }
  function cancelHold() {
    if (!hold) return;
    const previous = hold; hold = null;
    if (previous.pointer !== null && previous.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer);
    table?.cancelCharge(); el("charge").hidden = true; render();
  }
  async function adopt(incoming: Snapshot, animate = true) {
    if (state && incoming.revision < state.revision) return;
    const previous = state, freshRoll = incoming.lastRoll && incoming.lastRoll.id !== seenRoll;
    unlockAt = performance.now() + Math.max(0, incoming.availableAt - incoming.serverTime);
    if (freshRoll) {
      const event = incoming.lastRoll!;
      seenRoll = event.id;
      if (animate && previous && Date.now() - event.at < 20_000 && table && !failed) {
        cancelHold(); busy = true; render();
        await table.toss(outcomeForTicket(event.ticket!), event.strength ?? 0);
        busy = false;
      } else table?.show(lastOutcome(incoming.game));
    } else if (!incoming.lastRoll && previous?.lastRoll) {
      seenRoll = null; table?.show(null);
    }
    state = incoming;
    connected = true;
    render();
    if (previous && previous.match !== incoming.match) message("Match restarted. Best scores and history kept.");
    const note = incoming.lastNudge, key = `pigs:last-nudge:${me}`;
    if (note && note.to === me && stored(key) !== note.id && Date.now() - note.at < 3_600_000) {
      store(key, note.id); message(NUDGE_TEXT);
    }
    if (incoming.game.winner !== null) message(`${PLAYERS[incoming.game.winner]} wins with ${incoming.game.scores[incoming.game.winner]} points!`);
  }
  async function sync(animate = true) {
    if (syncing || busy || hold || document.hidden) return;
    syncing = true;
    try {
      const response = await fetch("/api/game", { cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: state ? { "If-None-Match": `"${state.revision}"` } : {} });
      if (response.status === 304) { connected = true; render(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to reach the match.");
      // A move may have started while this poll was in flight.
      if (!busy && !hold) await adopt(data.state, animate);
    } catch (error) {
      connected = false; render();
      message(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Connection lost. Your saved match is safe.", true);
    } finally { syncing = false; }
  }
  async function send(command: Command) {
    if (busy) return;
    cancelHold(); busy = true; pending = command; store(pendingKey, JSON.stringify(command)); render();
    try {
      const response = await fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command), signal: AbortSignal.timeout(25_000) });
      const data = await response.json() as ActionResponse & { error?: string };
      if (!response.ok) {
        if (response.status < 500) { pending = null; store(pendingKey, null); }
        busy = false;
        if (data.state) await adopt(data.state, false);
        throw new Error(data.error ?? "Your move could not be confirmed.");
      }
      pending = null; store(pendingKey, null); busy = false;
      el("toast").hidden = true;
      await adopt(data.state);
      if (command.kind === "nudge") message(data.delivery === "push" ? "Nudge sent."
        : data.delivery === "failed" ? "Nudge saved. Phone notification couldn't be delivered."
        : "Nudge saved. It will appear when they open the game.");
    } catch (error) {
      busy = false;
      if (pending) connected = false;
      message(error instanceof Error ? error.message : "Your move could not be confirmed.", !!pending);
    } finally { render(); }
  }
  function action(kind: Command["kind"], fields: Partial<Command> = {}) {
    if (!state || busy || pending) return;
    void send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind, ...fields });
  }
  function beginHold(target: HTMLButtonElement, pointer: number | null, key: string | null) {
    if (!ready() || state?.game.active !== mine || state.game.winner !== null || failed || !table || settings.open || history.open || rules.open) return;
    hold = { start: performance.now(), target, pointer, key };
    if (pointer !== null) target.setPointerCapture(pointer);
    el("charge").hidden = false;
    table.startCharge(elapsed => {
      const power = strengthForHold(elapsed);
      el("charge-fill").style.transform = `scaleX(${power})`;
      el("power-meter").setAttribute("aria-valuenow", String(Math.round(power * 100)));
      el("charge-label").textContent = power > .85 ? "Full power · release to toss" : "Release to toss";
    });
    bank.disabled = true;
  }
  function releaseHold() {
    if (!hold) return;
    const strength = strengthForHold(performance.now() - hold.start);
    cancelHold(); action("roll", { strength });
  }
  for (const target of [...pigs, roll]) {
    target.addEventListener("contextmenu", e => e.preventDefault());
    target.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault(); target.focus({ preventScroll: true }); beginHold(target, e.pointerId, null);
    });
    target.addEventListener("pointerup", e => { if (hold?.pointer === e.pointerId) { e.preventDefault(); releaseHold(); } });
    target.addEventListener("pointercancel", e => { if (hold?.pointer === e.pointerId) cancelHold(); });
    target.addEventListener("lostpointercapture", e => { if (hold?.pointer === e.pointerId) cancelHold(); });
    target.addEventListener("keydown", e => {
      if (e.code !== "Space" && e.code !== "Enter") return;
      e.preventDefault(); if (!e.repeat) beginHold(target, null, e.code);
    });
    target.addEventListener("keyup", e => { if (hold?.key === e.code && hold.target === target) { e.preventDefault(); releaseHold(); } });
    target.addEventListener("blur", () => { if (hold?.target === target) cancelHold(); });
  }
  bank.addEventListener("click", () => action("bank"));
  nudge.addEventListener("click", () => action("nudge"));
  el("rematch").addEventListener("click", () => action("restart"));
  el("retry").addEventListener("click", () => { if (pending) void send(pending); else void sync(false); });
  el("toast-close").addEventListener("click", () => { el("toast").hidden = true; });
  el("identity").textContent = `Playing as ${PLAYERS[mine]}`;
  el("settings-open").addEventListener("click", () => { cancelHold(); settings.showModal(); });
  el("rules-open").addEventListener("click", () => { settings.close(); rules.showModal(); });
  el("restart-open").addEventListener("click", () => { el("restart-confirm").hidden = false; });
  el("restart-cancel").addEventListener("click", () => { el("restart-confirm").hidden = true; });
  el("restart").addEventListener("click", () => { settings.close(); el("restart-confirm").hidden = true; action("restart"); });
  for (const dialog of [settings, history, rules]) {
    dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", e => {
      const rect = dialog.getBoundingClientRect();
      if (e.target === dialog && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) dialog.close();
    });
  }
  async function loadHistory(reset: boolean) {
    if (reset) { el("history-list").replaceChildren(); historyBefore = null; }
    (el("history-more") as HTMLButtonElement).disabled = true;
    try {
      const query = historyBefore === null ? "" : `&before=${historyBefore}`;
      const response = await fetch(`/api/game?view=history${query}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "History unavailable.");
      el("history-summary").textContent = `${data.total} moves · latest first`;
      for (const event of data.events as MatchEvent[]) {
        const row = document.createElement("li"), meta = document.createElement("div"), move = document.createElement("div"), detail = document.createElement("div");
        meta.className = "history-meta"; move.className = "history-move"; detail.className = "history-detail";
        meta.textContent = `Match ${event.match} · ${new Date(event.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
        const label = document.createElement("span"), points = document.createElement("strong");
        const outcome = event.kind === "roll" ? outcomeForTicket(event.ticket!) : null;
        label.textContent = `${PLAYERS[playerIndex(event.player)]} · ${outcome?.name ?? ({ bank: "Banked", restart: "Restarted match", nudge: "Sent a nudge" } as Record<string,string>)[event.kind]}`;
        points.textContent = event.points === undefined ? "" : `${event.points > 0 ? "+" : ""}${event.points}`;
        move.append(label, points);
        detail.textContent = `Turn ${event.turn} · David ${event.scores[0]} / Elisabeth ${event.scores[1]}`;
        row.append(meta, move, detail); el("history-list").append(row);
      }
      historyBefore = data.next; el("history-more").hidden = historyBefore === null;
      if (!data.total) el("history-summary").textContent = "No rolls yet.";
    } catch (error) {
      el("history-summary").textContent = error instanceof Error ? error.message : "History unavailable.";
      el("history-more").hidden = false; el("history-more").textContent = "Retry";
    } finally { (el("history-more") as HTMLButtonElement).disabled = false; }
  }
  el("history-open").addEventListener("click", () => { settings.close(); history.showModal(); void loadHistory(true); });
  el("history-more").addEventListener("click", () => { void loadHistory(false); });
  for (const item of combinationOdds()) {
    const row = document.createElement("tr"), percentage = item.count / SAMPLE_SIZE * 100;
    for (const text of [item.name, item.kind === "oinker" ? "Lose all" : String(item.points), `${percentage.toFixed(percentage < .01 ? 3 : 2)}%`]) {
      const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
    }
    el("odds-body").append(row);
  }
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && isSecureContext; }
  async function enableNotifications() {
    if (!state || busy) return;
    if (!pushSupported()) { el("notification-help").textContent = "Notifications need HTTPS and a supported browser. On iPhone, first open the game from your Home Screen."; return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { el("notification-help").textContent = "Notifications are off. You can change this in your browser or phone settings."; return; }
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const base64 = state.pushPublicKey.replace(/-/g, "+").replace(/_/g, "/");
        const key = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const data = subscription.toJSON();
      await send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind: "subscribe",
        subscription: { endpoint: data.endpoint!, keys: { p256dh: data.keys!.p256dh!, auth: data.keys!.auth! } } });
      if (!pending && connected) {
        notifyButton.textContent = "Notifications enabled";
        el("notification-help").textContent = "You'll receive a notification when the other player nudges you.";
      }
    } catch (error) { el("notification-help").textContent = error instanceof Error ? error.message : "Notifications could not be enabled."; }
  }
  notifyButton.addEventListener("click", () => { void enableNotifications(); });
  window.addEventListener("blur", cancelHold);
  window.addEventListener("offline", () => { cancelHold(); connected = false; render(); message("You're offline. Reconnect to keep playing.", true); });
  window.addEventListener("online", () => { void sync(false); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelHold(); else void sync(false); });
  document.addEventListener("keydown", e => { if (e.code === "Escape") cancelHold(); });
  try {
    table = new PigTable(el("stage"), pigs, () => {
      failed = true; cancelHold(); el("render-error").hidden = false;
      el("render-error").textContent = "The 3D table couldn't load. Enable graphics acceleration and reload. The shared match is saved.";
      render();
    }, [el("pig-label-0"), el("pig-label-1")]);
  } catch {
    failed = true; el("render-error").hidden = false;
    el("render-error").textContent = "The 3D table couldn't load. Try a browser with graphics acceleration.";
  }
  render();
  await sync(false);
  if (pending) await send(pending);
  if (pushSupported()) {
    void navigator.serviceWorker.register("/sw.js").then(async registration => {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && state && !pending && !busy) {
        // Reassociate an existing device subscription when choosing the other route.
        const data = subscription.toJSON();
        await send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind: "subscribe",
          subscription: { endpoint: data.endpoint!, keys: { p256dh: data.keys!.p256dh!, auth: data.keys!.auth! } } });
        if (connected && !pending) notifyButton.textContent = "Notifications enabled";
      }
    }).catch(() => {});
  }
  const interval = setInterval(() => { void sync(); }, 5000);
  if (import.meta.hot) import.meta.hot.dispose(() => { clearInterval(interval); table?.dispose(); });
}
