import { isPlayerId } from "./shared";
const player = location.pathname.replace(/^\//, "").replace(/\/$/, "");
if (isPlayerId(player)) {
  document.getElementById("home")!.hidden = true;
  document.getElementById("game-view")!.hidden = false;
  document.title = `${player === "david" ? "David" : "Elisabeth"} · Pass the Pigs`;
  const { startGame } = await import("./client");
  await startGame(player);
}
