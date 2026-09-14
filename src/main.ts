import { isIdleId } from "./idle";
import { PLAYERS, playerIndex } from "./players";
import { isPlayerId } from "./shared";
const player = location.pathname.replace(/^\//, "").replace(/\/$/, "");
if (player.startsWith("eg/") && isIdleId(player.slice(3))) {
  const { startPreview } = await import("./preview");
  startPreview(player.slice(3) as import("./idle").IdleId);
} else if (isPlayerId(player)) {
  document.getElementById("home")!.hidden = true;
  document.getElementById("game-view")!.hidden = false;
  document.title = `${PLAYERS[playerIndex(player)]} · Pass the Pigs`;
  const { startGame } = await import("./client");
  await startGame(player);
}
