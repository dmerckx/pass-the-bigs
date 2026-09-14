import { PigTable } from "./scene";
import { defaultProfiles } from "./palette";
import type { IdleId } from "./idle";
export function startPreview(activity: IdleId) {
  document.getElementById("home")!.hidden = true;
  document.getElementById("game-view")!.hidden = false;
  document.querySelector<HTMLElement>(".scoreboard")!.hidden = true;
  document.querySelector<HTMLElement>(".bottom-bar")!.hidden = true;
  const heading = document.createElement("div"); heading.className = "preview-heading";
  const back = document.createElement("a"); back.href = "/"; back.textContent = "← Players";
  const title = document.createElement("span"); title.textContent = activity[0]!.toUpperCase() + activity.slice(1);
  heading.append(back, title); document.getElementById("game-view")!.prepend(heading);
  document.title = `${title.textContent} · Piggy preview`;
  const table = new PigTable(document.getElementById("stage")!, [0,1].map(i => document.getElementById(`pig-${i}`) as HTMLButtonElement), () => {
    document.getElementById("render-error")!.hidden = false;
    document.getElementById("render-error")!.textContent = "Enable graphics acceleration to see this preview.";
  });
  table.setPlayers(defaultProfiles()); void table.focus(0, false); table.setWaiting(true, activity);
  if (import.meta.hot) import.meta.hot.dispose(() => table.dispose());
}
