import { PLAYER_INDICES } from "./players";
import { MoveOutbox, MoveConflict } from "./outbox";
import { PigTable } from "./scene";
import { PLAYERS, lastOutcome, type Game, type PlayerIndex } from "./game";
import { combinationOdds, POSE_NAMES, SAMPLE_SIZE, outcomeForTicket } from "./rules";
import { COLOR_PALETTES, COLOR_IDS, defaultProfiles, type ColorId, type SkinId } from "./palette";
import { strengthForHold } from "./toss";
import { landingFeedback } from "./roll-feedback";
import { TURN_TEXT, PLAYER_IDS, playerIndex, type ActionResponse, type Command, type MatchEvent, type PlayerId, type Snapshot } from "./shared";

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
  const mine = playerIndex(me);
  let state: Snapshot | null = null, connected = false, busy = false, failed = false;
  let onboardingBusy = false, notificationBusy = false, deviceSubscribed = false;
  let draftColor: ColorId = defaultProfiles()[me].color, draftSkin: SkinId = defaultProfiles()[me].skin;
  let replaying = false, replayRolling = false, replayGame: Game | null = null;
  let animatingPlayer: PlayerIndex | null = null, landingPreview: MatchEvent | null = null;
  let liveRolling = false;
  let rollFeedback: ReturnType<typeof landingFeedback>["message"] = null;
  let seenRoll: string | null = null, unlockAt = 0, syncing = false;
  let table: PigTable | null = null;
  let outboxChanged = false, saveFailed = false, saveNotBefore = 0;
  const outboxKey = `pigs:outbox:${me}`;
  function persistOutbox(value: string | null) {
    try { if (value === null) localStorage.removeItem(outboxKey); else localStorage.setItem(outboxKey, value); }
    catch { throw new Error("This device could not save your buffered rolls. Free some browser storage and retry."); }
  }
  let outbox = MoveOutbox.restore(stored(outboxKey), me, persistOutbox);
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;
  let hold: { start: number; target: HTMLButtonElement; pointer: number | null; key: string | null } | null = null;
  let pending: Command | null = null;
  const pendingKey = `pigs:pending:${me}`;
  try { pending = JSON.parse(stored(pendingKey) ?? "null"); } catch { /* Ignore malformed browser metadata. */ }
  if (pending?.player !== me) pending = null;
  const pigs = [el<HTMLButtonElement>("pig-0"), el<HTMLButtonElement>("pig-1")];
  const roll = el<HTMLButtonElement>("roll"), bank = el<HTMLButtonElement>("bank");
  const settings = el<HTMLDialogElement>("settings-dialog"), history = el<HTMLDialogElement>("history-dialog"), rules = el<HTMLDialogElement>("rules-dialog");
  const setup = el<HTMLDialogElement>("setup-dialog");
  const notifyButton = el<HTMLButtonElement>("notifications");
  let historyBefore: number | null = null;
  function message(text: string, retry = false) {
    if (setup.open) { el("setup-help").textContent = text; el("setup-help").hidden = false; }
    el("toast-text").textContent = text; el("toast").hidden = false; el("retry").hidden = !retry;
  }
  function ready() { return state && state.profiles[me].completed && connected && !setup.open && !onboardingBusy && !notificationBusy && !busy && !table?.transitioning && !replaying && !hold && !pending && !saveFailed && !outbox?.full; }
  function render() {
    const profile = state?.profiles[me];
    if (profile && !profile.completed && !setup.open) setup.showModal();
    if (profile?.completed && setup.open && !onboardingBusy) setup.close();
    for (const input of setup.querySelectorAll<HTMLInputElement>('input[name="color"]')) {
      input.checked = input.value === draftColor;
      input.disabled = true;
    }
    for (const input of setup.querySelectorAll<HTMLInputElement>('input[name="skin"]')) {
      input.checked = input.value === draftSkin; input.disabled = onboardingBusy || busy;
    }
    for (const id of ["setup-enable", "setup-skip"]) {
      el<HTMLButtonElement>(id).disabled = !state || !connected || busy || !!pending || onboardingBusy;
    }
    el("setup-retry").hidden = !pending && connected;
    el<HTMLButtonElement>("setup-retry").disabled = busy || onboardingBusy;
    const live = state?.game;
    const game = replayGame ?? (landingPreview && live ? { ...live, scores: landingPreview.scores, turn: landingPreview.turn } : live);
    const ownTurn = live?.active === mine && live.winner === null;
    const replay = state?.replays[mine] ?? null;
    const viewing = setup.open ? me : animatingPlayer !== null ? PLAYER_IDS[animatingPlayer] : replayGame ? PLAYER_IDS[replayGame.active] : replay?.player ?? PLAYER_IDS[game?.active ?? mine];
    const appearance = setup.open ? { color: draftColor, skin: draftSkin } : state?.profiles[viewing] ?? defaultProfiles()[viewing];
    const watching = playerIndex(viewing), palette = COLOR_PALETTES[appearance.color];
    document.documentElement.dataset.viewing = viewing;
    document.documentElement.style.setProperty("--table-background", palette.background);
    document.documentElement.style.setProperty("--accent", palette.accent);
    const profiles = structuredClone(state?.profiles ?? defaultProfiles());
    if (setup.open) profiles[me] = { ...profiles[me], ...appearance };
    table?.setPlayers(profiles);
    void table?.focus(watching);
    const finished = !!live && live.winner !== null && !replay && !replaying && !setup.open;
    table?.setWinner(finished ? live!.winner : null);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", palette.background);
    for (const i of PLAYER_INDICES) {
      const player = el(`player-${i}`);
      const playerColor = (setup.open && i === mine) ? draftColor : (state?.profiles[PLAYER_IDS[i]!] ?? defaultProfiles()[PLAYER_IDS[i]!]).color;
      player.style.setProperty("--player-accent", COLOR_PALETTES[playerColor].accent);
      el(`slice-label-${i}`).style.color = COLOR_PALETTES[playerColor].accent;
      player.classList.toggle("active", watching === i);
      el(`score-${i}`).textContent = String(game?.scores[i] ?? 0);
      const stars = el(`wins-${i}`), wins = game?.wins[i] ?? 0;
      stars.textContent = "★".repeat(Math.min(wins, 20)) + (wins > 20 ? ` +${wins - 20}` : "");
      stars.setAttribute("aria-label", `${wins} ${wins === 1 ? "game" : "games"} won`);
      player.setAttribute("aria-label", `${PLAYERS[i]}: ${game?.scores[i] ?? 0} points${watching === i ? ", watching" : ""}`);
    }
    const watchedLanding = landingPreview ?? state?.lastRolls[watching];
    const outcome = replayGame ? lastOutcome(replayGame) : watchedLanding ? outcomeForTicket(watchedLanding.ticket!) : null;
    el("combination").textContent = outcome?.name ?? "Ready to roll";
    el("roll-score").textContent = outcome ? outcome.kind === "score" ? `+${outcome.points}` : "0 pts" : "";
    el("turn-score").textContent = String(game?.turn ?? 0);
    el("result").classList.toggle("bust", !!outcome && outcome.kind !== "score");
    for (const i of [0, 1]) el(`pig-label-${i}`).textContent = liveRolling || replayRolling || !outcome ? "" : POSE_NAMES[outcome.poses[i]!];
    const canAct = !!ready() && !!ownTurn && !replay;
    for (const target of pigs) target.disabled = !canAct || failed;
    roll.disabled = !canAct || failed;
    bank.disabled = !canAct || !game?.turn;
    roll.textContent = game?.turn ? "Keep rolling" : "Toss pigs";
    el("roll-feedback").hidden = !rollFeedback;
    el("roll-feedback").textContent = rollFeedback?.text ?? "";
    el("roll-feedback").lang = rollFeedback?.lang ?? "en";
    el("own-actions").hidden = !!rollFeedback || !!replay || replaying || (!!game && (!ownTurn || game.winner !== null));
    el("replay").hidden = !replay || replaying;
    (el("replay") as HTMLButtonElement).disabled = !ready() || failed || !!outbox?.count;
    if (replay) el("replay").textContent = `Replay ${PLAYERS[playerIndex(replay.player)]}'s turn · ${replay.events.filter(e => e.kind === "roll").length} rolls`;
    el("replay-progress").hidden = !replaying;
    const waiting = el("waiting-message");
    waiting.hidden = !!rollFeedback || !live || live.winner !== null || live.active === mine || !!replay || replaying || setup.open;
    waiting.textContent = live ? `Wait for ${PLAYERS[live.active]} to take ${live.active === 0 ? "his" : "her"} turn.` : "";
    el("match-finish").hidden = !finished;
    el<HTMLButtonElement>("restart").disabled = !ready() || !!outbox?.count || performance.now() < unlockAt;
    el("series-score").textContent = live ? `Wins · ${PLAYERS.map((name, i) => `${name} ${live.wins[i]}`).join(" / ")}` : "";
    notifyButton.disabled = !state || busy || notificationBusy || deviceSubscribed || !!outbox?.count;
    notifyButton.textContent = deviceSubscribed ? "Notifications on" : "Enable notifications";
    el("records").textContent = game ? `Wins · ${PLAYERS.map((name, i) => `${name} ${game.wins[i]}`).join(" / ")}` : "";
    el("save-status").hidden = !outbox?.count;
    el("save-status").textContent = saveFailed ? "Rolls saved on this device · retrying…" : "Saving…";
    clearTimeout(unlockTimer);
    const wait = unlockAt - performance.now();
    if (wait > 0) unlockTimer = setTimeout(render, wait + 25);
  }
  function cancelHold() {
    if (!hold) return;
    const previous = hold; hold = null;
    if (previous.pointer !== null && previous.target.hasPointerCapture(previous.pointer)) previous.target.releasePointerCapture(previous.pointer);
    table?.cancelCharge(); el("charge").hidden = true; render();
    if (outboxChanged && !busy && outbox) void adopt(outbox.view, false, true);
  }
  async function adopt(incoming: Snapshot, animate = true, local = false) {
    if (!local && state && incoming.revision < state.revision) return;
    const previous = state, freshRoll = incoming.lastRoll && incoming.lastRoll.id !== seenRoll;
    unlockAt = performance.now() + Math.max(0, incoming.availableAt - incoming.serverTime);
    let animated: PlayerIndex | null = null;
    if (freshRoll) {
      const event = incoming.lastRoll!;
      seenRoll = event.id;
      if (animate && previous && Date.now() - event.at < 20_000 && table && !failed) {
        cancelHold(); busy = true; liveRolling = true; animatingPlayer = playerIndex(event.player); render();
        await table.toss(outcomeForTicket(event.ticket!), event.strength ?? 0, animatingPlayer);
        liveRolling = false; landingPreview = event;
        await holdLanding(event.ticket!);
        animated = animatingPlayer; animatingPlayer = null; landingPreview = null; busy = false;
      }
    }
    if (local && outbox) {
      const latest = outbox.view;
      if (latest.lastRoll?.id !== incoming.lastRoll?.id) animated = null;
      incoming = latest; outboxChanged = false;
    }
    if (!incoming.lastRoll) seenRoll = null;
    for (const i of PLAYER_INDICES) {
      const landing = incoming.lastRolls[i];
      if (i !== animated && (local || !previous || previous.lastRolls[i]?.id !== landing?.id || previous.match !== incoming.match)) {
        table?.show(landing ? outcomeForTicket(landing.ticket!) : null, i);
      }
    }
    state = incoming;
    connected = true;
    render();
    if (!local && previous && previous.match !== incoming.match) message(!incoming.profiles.david.completed && !incoming.profiles.elisabeth.completed
      ? "Scores and player choices reset." : "Match restarted. Best scores and history kept.");
    const note = incoming.turnNotice, key = `pigs:last-turn-notice:${me}`;
    if (note && note.to === me && incoming.game.active === mine && incoming.game.winner === null && stored(key) !== note.id) {
      store(key, note.id);
      // A subscribed browser gets the OS notification, not a duplicate toast.
      if (!(pushSupported() && Notification.permission === "granted")) message(TURN_TEXT);
    }
    if (incoming.game.winner !== null && !incoming.replays[mine]) message(`${PLAYERS[incoming.game.winner]} wins with ${incoming.game.scores[incoming.game.winner]} points!`);
  }
  async function sync(animate = true) {
    if (outbox?.count) { void flushMoves(); return; }
    if (syncing || busy || onboardingBusy || notificationBusy || hold || document.hidden) return;
    syncing = true;
    try {
      const response = await fetch("/api/game", { cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: state ? { "If-None-Match": `"${state.revision}"` } : {} });
      if (response.status === 304) { connected = true; if (!busy && !hold) render(); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to reach the match.");
      // A move may have started while this poll was in flight.
      if (!busy && !onboardingBusy && !notificationBusy && !hold && !replaying && !outbox?.count) {
        if (outbox) outbox.accept(data.state); else outbox = new MoveOutbox(data.state, persistOutbox);
        await adopt(data.state, animate);
      }
    } catch (error) {
      connected = false; render();
      message(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Connection lost. Your saved match is safe.", true);
    } finally { syncing = false; }
  }
  async function send(command: Command) {
    if (busy || outbox?.count) return;
    cancelHold(); busy = true; pending = command; store(pendingKey, JSON.stringify(command)); render();
    try {
      const response = await fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command), signal: AbortSignal.timeout(25_000) });
      const data = await response.json() as ActionResponse & { error?: string };
      if (!response.ok) {
        if (response.status < 500) { pending = null; store(pendingKey, null); }
        busy = false;
        if (data.state) { outbox?.accept(data.state); await adopt(data.state, false, true); }
        throw new Error(data.error ?? "Your move could not be confirmed.");
      }
      pending = null; store(pendingKey, null); busy = false;
      el("toast").hidden = true;
      if (outbox) outbox.accept(data.state); else outbox = new MoveOutbox(data.state, persistOutbox);
      await adopt(data.state);
      if (command.kind === "subscribe") { deviceSubscribed = true; notificationHelp(""); }
      return true;
    } catch (error) {
      busy = false;
      if (pending) connected = false;
      message(error instanceof Error ? error.message : "Your move could not be confirmed.", !!pending);
      return false;
    } finally { render(); }
  }
  async function flushMoves() {
    if (!outbox?.count || outbox.flushing || !navigator.onLine) return;
    try {
      await outbox.flush(async command => {
        // Reduced-motion or buffered tosses may finish before the server's lock.
        await pause(Math.max(0, saveNotBefore - performance.now()));
        const response = await fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command), signal: AbortSignal.timeout(25_000) });
        const data = await response.json() as ActionResponse & { error?: string };
        if (!response.ok) {
          if (response.status < 500 && data.state) throw new MoveConflict(data.error ?? "The shared match changed.", data.state);
          throw new Error(data.error ?? "Unable to save your rolls yet.");
        }
        saveNotBefore = performance.now() + Math.max(0, data.state.availableAt - data.state.serverTime);
        if (saveFailed) el("toast").hidden = true;
        connected = true; saveFailed = false;
        return data.state;
      }, async conflict => {
        outboxChanged = true;
        if (conflict) { cancelHold(); message("The shared match changed. Showing the saved result."); }
        if (!busy && !hold && !replaying) await adopt(outbox!.view, false, true);
        else render();
      });
    } catch (error) {
      if (!(error instanceof MoveConflict)) {
        saveFailed = true; connected = false;
        message("Your rolls are saved on this device. Reconnecting…", true);
      }
    } finally { render(); }
  }
  async function bufferedAction(kind: "roll" | "bank", fields: Partial<Command>) {
    if (!ready() || !outbox || !state || state.game.active !== mine || state.replays[mine]) return;
    try {
      const base = outbox.view;
      const command: Command = { id: requestId(), player: me, expectedRevision: base.gameRevision, kind, ...fields,
        ...(kind === "roll" ? { expectedRollIndex: base.rollIndex } : {}) };
      const predicted = outbox.enqueue(command);
      el("toast").hidden = true;
      // Start the animation before dispatching its save. Later rolls can queue
      // while that request is still waiting for GitHub.
      const animation = adopt(predicted, kind === "roll", true);
      void flushMoves();
      await animation;
    } catch (error) { message(error instanceof Error ? error.message : "This roll could not be buffered.", true); }
  }
  function action(kind: Command["kind"], fields: Partial<Command> = {}) {
    if (kind === "roll" || kind === "bank") { void bufferedAction(kind, fields); return; }
    if (!state || busy || pending) return;
    void send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind, ...fields });
  }
  function beginHold(target: HTMLButtonElement, pointer: number | null, key: string | null) {
    if (!ready() || state?.game.active !== mine || state.game.winner !== null || state.replays[mine] || failed || !table || setup.open || settings.open || history.open || rules.open) return;
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
  const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  async function holdLanding(ticket: number, scorePause = 650) {
    // Pick once per landing, independently of the server's roll selection.
    const feedback = landingFeedback(outcomeForTicket(ticket).kind, scorePause);
    rollFeedback = feedback.message; render();
    try { await pause(feedback.duration); }
    finally { rollFeedback = null; }
  }
  async function visible() {
    if (!document.hidden) return;
    await new Promise<void>(resolve => {
      const check = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", check); resolve(); } };
      document.addEventListener("visibilitychange", check);
    });
  }
  async function replayTurn() {
    const replay = state?.replays[mine];
    if (!state || !replay || !ready() || !table || failed || outbox?.count) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = await send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind: "start-replay", replayId: replay.id, reducedMotion });
    if (!started || !state) return;
    const notBefore = performance.now() + Math.max(0, (state.replaySessions[mine]?.notBefore ?? 0) - state.serverTime);
    const actor = playerIndex(replay.player), rolls = replay.events.filter(e => e.kind === "roll").length;
    replaying = true; busy = true;
    replayGame = { ...state.game, active: actor, scores: [...replay.startScores], turn: 0, winner: null, lastTicket: null, lastPlayer: actor };
    table.show(null, actor); render();
    try {
      let number = 0;
      for (const event of replay.events) {
        await visible();
        if (event.kind === "roll") {
          number++;
          el("replay-progress").textContent = `${PLAYERS[actor]} · roll ${number} of ${rolls}`;
          replayRolling = true; render();
          await table.toss(outcomeForTicket(event.ticket!), event.strength ?? 0, actor);
          replayRolling = false;
          replayGame.lastTicket = event.ticket!;
          replayGame.turn = event.turn; replayGame.scores = [...event.scores];
          await holdLanding(event.ticket!, 600);
        } else if (event.kind === "bank") {
          el("replay-progress").textContent = `${PLAYERS[actor]} banked ${event.points} points`;
          replayGame.turn = 0; replayGame.scores = [...event.scores];
          render(); await pause(900);
        }
      }
      await visible();
      await pause(Math.max(0, notBefore - performance.now() + 100));
      replaying = false; replayRolling = false; replayGame = null; busy = false;
      await send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind: "finish-replay", replayId: replay.id, reducedMotion });
      for (const i of PLAYER_INDICES) {
        const landing = state.lastRolls[i];
        table.show(landing ? outcomeForTicket(landing.ticket!) : null, i);
      }
    } catch {
      replaying = false; replayRolling = false; replayGame = null; busy = false;
      message("The replay was interrupted. Replay the turn to unlock your rolls.");
      render();
    }
  }
  el("replay").addEventListener("click", () => { void replayTurn(); });
  bank.addEventListener("click", () => action("bank"));
  el("restart").addEventListener("click", () => action("restart"));
  for (const i of PLAYER_INDICES) el(`slice-label-${i}`).textContent = `${PLAYERS[i]}${i === mine ? " · You" : ""}`;
  async function retryPending() {
    if (outbox?.count) await flushMoves(); else if (pending) await send(pending); else await sync(false);
    await restoreSubscription();
  }
  el("retry").addEventListener("click", () => { void retryPending(); });
  el("setup-retry").addEventListener("click", () => { void retryPending(); });
  el("toast-close").addEventListener("click", () => { el("toast").hidden = true; });
  el("identity").textContent = `Playing as ${PLAYERS[mine]}`;
  el("settings-open").addEventListener("click", () => { cancelHold(); settings.showModal(); });
  el("rules-open").addEventListener("click", () => { settings.close(); rules.showModal(); });
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
        detail.textContent = `Turn ${event.turn} · ${PLAYERS.map((name, i) => `${name} ${event.scores[i] ?? 0}`).join(" / ")}`;
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
  const pushReady = pushSupported()
    ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).catch(() => null)
    : Promise.resolve(null);
  function notificationHelp(text: string) {
    el("notification-help").textContent = text; el("notification-help").hidden = !text;
  }
  async function requestBrowserNotifications(): Promise<PushSubscription | null> {
    if (!state || !pushSupported()) { notificationHelp("Notifications aren't available in this browser."); return null; }
    // Called directly from the setup/settings button, before any network await.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notificationHelp("Notifications are off. You can enable them in your browser settings."); return null;
    }
    const registration = await pushReady;
    if (!registration) throw new Error("Notifications could not be enabled. Please try again.");
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;
    const base64 = state.pushPublicKey.replace(/-/g, "+").replace(/_/g, "/");
    const key = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  async function saveSubscription(subscription: PushSubscription) {
    if (!state) return false;
    const data = subscription.toJSON();
    const saved = await send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind: "subscribe",
      subscription: { endpoint: data.endpoint!, keys: { p256dh: data.keys!.p256dh!, auth: data.keys!.auth! } } });
    if (saved) { deviceSubscribed = true; notificationHelp(""); render(); }
    return saved;
  }
  async function enableNotifications() {
    if (!state || busy || pending || notificationBusy) return;
    notificationBusy = true; render();
    try {
      const subscription = await requestBrowserNotifications();
      if (subscription) await saveSubscription(subscription);
    } catch (error) { notificationHelp(error instanceof Error ? error.message : "Notifications could not be enabled."); }
    finally { notificationBusy = false; render(); }
  }
  async function completeSetup(withNotifications: boolean) {
    if (!state || busy || pending || onboardingBusy || !connected) return;
    onboardingBusy = true; el("setup-help").hidden = true; render();
    try {
      let subscription: PushSubscription | null = null;
      if (withNotifications) {
        try { subscription = await requestBrowserNotifications(); }
        catch (error) { notificationHelp(error instanceof Error ? error.message : "Notifications could not be enabled."); }
      }
      const saved = await send({ id: requestId(), player: me, expectedRevision: state.gameRevision, kind: "setup", color: draftColor, skin: draftSkin });
      if (saved && subscription) await saveSubscription(subscription);
      else if (saved && !withNotifications) {
        const existing = await (await pushReady)?.pushManager.getSubscription();
        if (existing) await saveSubscription(existing);
      }
      if (saved && withNotifications && !subscription) message(el("notification-help").textContent || "Notifications are off. You can enable them in Settings.");
    } finally { onboardingBusy = false; render(); }
  }
  el("setup-player").textContent = `Playing as ${PLAYERS[mine]}`;
  setup.addEventListener("cancel", event => event.preventDefault());
  setup.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.name === "color") draftColor = input.value as ColorId;
    if (input.name === "skin") draftSkin = input.value as SkinId;
    render();
  });
  el("setup-enable").addEventListener("click", () => { void completeSetup(true); });
  el("setup-skip").addEventListener("click", () => { void completeSetup(false); });
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
    }, [el("pig-label-0"), el("pig-label-1")], PLAYER_INDICES.map(i => el(`slice-label-${i}`)), render);
  } catch {
    failed = true; el("render-error").hidden = false;
    el("render-error").textContent = "The 3D table couldn't load. Try a browser with graphics acceleration.";
  }
  render();
  if (outbox?.count) { await adopt(outbox.view, false, true); void flushMoves(); }
  else await sync(false);
  if (pending && !outbox?.count) await send(pending);
  async function restoreSubscription() {
    try {
      const registration = await pushReady;
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && state && !pending && !busy && !hold && !onboardingBusy && !notificationBusy && !setup.open && !deviceSubscribed && !outbox?.count) {
        // A previously subscribed device follows its selected player route.
        await saveSubscription(subscription);
      }
    } catch { /* The small settings button can retry browser registration. */ }
  }
  void restoreSubscription();
  const interval = setInterval(() => { void sync(); }, 5000);
  if (import.meta.hot) import.meta.hot.dispose(() => { clearInterval(interval); clearTimeout(unlockTimer); table?.dispose(); });
}
