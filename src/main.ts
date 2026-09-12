import { PigTable } from "./scene";
import { PLAYERS, bankTurn, decodeSave, encodeSave, lastOutcome, newGame, resolveRoll, STORAGE_KEY } from "./game";
import { combinationOdds, POSE_NAMES, SAMPLE_SIZE, randomTicket, outcomeForTicket } from "./rules";
import { strengthForHold } from "./toss";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}
let storageAvailable = true;
function readSaved() {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { storageAvailable = false; return null; }
}
let game = decodeSave(readSaved());
let rolling = false, failed = false;
let hold: { start: number; target: HTMLButtonElement; pointer: number | null; key: string | null } | null = null;
const targets = [element<HTMLButtonElement>("pig-0"), element<HTMLButtonElement>("pig-1")];
const bank = element<HTMLButtonElement>("bank"), rematch = element<HTMLButtonElement>("rematch");
const dialog = element<HTMLDialogElement>("rules-dialog");
const charge = element("charge"), chargeFill = element("charge-fill");
const rulesOpen = element<HTMLButtonElement>("rules-open");
let table: PigTable | null = null;
let pendingTicket: number | null = null;

function persist() {
  try { localStorage.setItem(STORAGE_KEY, encodeSave(game, pendingTicket)); }
  catch { storageAvailable = false; }
  element("save-note").textContent = storageAvailable ? "Best scores stay on this device." : "Storage unavailable · scores last for this visit.";
}
function render() {
  PLAYERS.forEach((_, i) => {
    element(`score-${i}`).textContent = String(game.scores[i]);
    element(`best-${i}`).textContent = String(game.best[i]);
    element(`wins-${i}`).textContent = String(game.wins[i]);
    element(`progress-${i}`).style.width = `${Math.min(100, game.scores[i])}%`;
    const player = element(`player-${i}`);
    player.classList.toggle("active", game.active === i);
    player.querySelector(".turn-tag")!.textContent = game.winner === i ? "WINNER" : "YOUR TURN";
    player.setAttribute("aria-label", `${PLAYERS[i]}: ${game.scores[i]} points, best ${game.best[i]}, ${game.wins[i]} wins${game.active === i ? ", current player" : ""}`);
  });
  element("turn-score").textContent = String(game.turn);
  element("bank-points").textContent = String(game.turn);
  bank.disabled = game.turn === 0 || rolling || hold !== null || game.winner !== null || failed;
  bank.hidden = game.winner !== null;
  rematch.hidden = game.winner === null;
  targets.forEach(target => target.disabled = rolling || game.winner !== null || failed);
  element("table-caption").textContent = game.winner !== null
    ? `${PLAYERS[game.winner].toUpperCase()} WINS`
    : rolling ? "A LITTLE LUCK IN THE AIR" : `${PLAYERS[game.active].toUpperCase()}'S TURN`;
  const last = lastOutcome(game);
  element("result-label").textContent = last
    ? `${PLAYERS[game.lastPlayer!].toUpperCase()}'S ${rolling ? "LAST " : ""}ROLL`
    : "THE TABLE IS YOURS";
  element("combination").textContent = last?.name ?? "Feeling lucky?";
  element("roll-score").textContent = last ? (last.kind === "score" ? `+${last.points}` : "0 pts") : "";
  element("pose-detail").textContent = last
    ? last.kind === "oinker" ? "Pigs touching · entire game score lost"
      : last.kind === "pig-out" ? "Opposite sides · turn points lost"
      : last.poses.map(pose => POSE_NAMES[pose]).join(" / ")
    : "Two pigs. One more toss.";
  element("result").classList.toggle("bust", last !== null && last.kind !== "score");
  element("instruction").textContent = rolling ? "Let's see where they land…" : game.message;
}
function cancelHold() {
  if (!hold) return;
  const previous = hold; hold = null;
  if (previous.pointer !== null && previous.target.hasPointerCapture(previous.pointer)) {
    previous.target.releasePointerCapture(previous.pointer);
  }
  table?.cancelCharge(); charge.hidden = true; render();
}
function beginHold(target: HTMLButtonElement, pointer: number | null, key: string | null) {
  if (hold || rolling || failed || game.winner !== null || dialog.open || !table) return;
  hold = { start: performance.now(), target, pointer, key };
  if (pointer !== null) target.setPointerCapture(pointer);
  charge.hidden = false;
  table.startCharge(elapsed => {
    const power = strengthForHold(elapsed);
    chargeFill.style.transform = `scaleX(${power})`;
    element("power-meter").setAttribute("aria-valuenow", String(Math.round(power * 100)));
    element("charge-label").textContent = power > 0.85 ? "Going all in" : power > 0.4 ? "A proper toss" : "A little nudge";
  });
  render();
}
async function releaseHold() {
  if (!hold || !table) return;
  const previous = hold, strength = strengthForHold(performance.now() - previous.start);
  hold = null;
  if (previous.pointer !== null && previous.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer);
  charge.hidden = true;
  // Reserve and persist the outcome before animating. Strength is only sent
  // to the renderer and is never an input to the probability sampler.
  try { pendingTicket = randomTicket(); }
  catch { failRenderer(); return; }
  const ticket = pendingTicket, outcome = outcomeForTicket(ticket);
  rolling = true;
  persist(); render();
  await table.toss(outcome, strength);
  game = resolveRoll(game, ticket);
  pendingTicket = null; rolling = false;
  persist(); render();
  if (previous.key !== null) {
    (game.winner !== null ? rematch : previous.target).focus({ preventScroll: true });
  }
}
function failRenderer() {
  failed = true;
  cancelHold();
  element("render-error").hidden = false;
  element("render-error").textContent = "The 3D table couldn't start. Enable graphics acceleration or try another browser, then reload. Your saved scores are kept.";
  render();
}
for (const target of targets) {
  target.addEventListener("contextmenu", event => event.preventDefault());
  target.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); target.focus({ preventScroll: true });
    beginHold(target, event.pointerId, null);
  });
  target.addEventListener("pointerup", event => {
    if (hold?.pointer === event.pointerId) { event.preventDefault(); void releaseHold(); }
  });
  target.addEventListener("pointercancel", event => { if (hold?.pointer === event.pointerId) cancelHold(); });
  target.addEventListener("lostpointercapture", event => { if (hold?.pointer === event.pointerId) cancelHold(); });
  target.addEventListener("keydown", event => {
    if (event.code !== "Space" && event.code !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) beginHold(target, null, event.code);
  });
  target.addEventListener("keyup", event => {
    if (hold?.key === event.code && hold.target === target) { event.preventDefault(); void releaseHold(); }
  });
  target.addEventListener("blur", () => { if (hold?.target === target) cancelHold(); });
}
window.addEventListener("blur", cancelHold);
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelHold(); });
document.addEventListener("keydown", event => { if (event.code === "Escape") cancelHold(); });
bank.addEventListener("click", () => {
  if (rolling || hold || failed) return;
  game = bankTurn(game); persist(); render();
});
rematch.addEventListener("click", () => {
  game = newGame(game); table?.show(null); persist(); render();
});
rulesOpen.addEventListener("click", () => { cancelHold(); dialog.showModal(); });
element("rules-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
const tbody = element("odds-body");
for (const item of combinationOdds()) {
  const row = document.createElement("tr"), percentage = item.count / SAMPLE_SIZE * 100;
  for (const text of [item.name, item.kind === "oinker" ? "Lose all" : String(item.points),
    `${percentage.toFixed(percentage < 0.01 ? 3 : 2)}%`]) {
    const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
  }
  tbody.append(row);
}
try {
  table = new PigTable(element("stage"), targets, failRenderer);
  table.show(lastOutcome(game));
} catch (error) {
  console.error("Unable to initialize the 3D table", error);
  failRenderer();
}
persist(); render();
if (import.meta.hot) import.meta.hot.dispose(() => table?.dispose());
