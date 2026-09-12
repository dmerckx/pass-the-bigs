import type { Outcome } from "./rules";

export const BAD_ROLL_PAUSE_MS = 3000;
const BAD_ROLL_MESSAGES = [
  { text: "ahh.. too bad", lang: "en" },
  { text: "Oops… there goes your turn.", lang: "en" },
  { text: "The piggies had other plans.", lang: "en" },
  { text: "That’s a rough landing.", lang: "en" },
  { text: "Well… that didn’t go to plan.", lang: "en" },
  { text: "One roll too far.", lang: "en" },
  { text: "Oh no… piggy trouble.", lang: "en" },
  { text: "Bad luck, little piggies.", lang: "en" },
  { text: "That’s all for this turn.", lang: "en" },
  { text: "The pigs have spoken.", lang: "en" },
  { text: "So close… next time.", lang: "en" },
  { text: "Ouch… better luck next turn.", lang: "en" },
  { text: "Øv… så røg turen.", lang: "da" },
  { text: "Åh nej… sikke et uheld.", lang: "da" },
  { text: "Grisene havde andre planer.", lang: "da" },
  { text: "Det var ét kast for meget.", lang: "da" },
  { text: "Sikke noget griseri!", lang: "da" },
  { text: "Øv bøv… prøv igen næste gang.", lang: "da" },
  { text: "Næsten… bedre held næste gang.", lang: "da" },
  { text: "Av… den gjorde ondt.", lang: "da" },
] as const;

export function landingFeedback(kind: Outcome["kind"], scorePause = 650) {
  return kind === "score"
    ? { duration: scorePause, message: null }
    : { duration: BAD_ROLL_PAUSE_MS, message: BAD_ROLL_MESSAGES[Math.floor(Math.random() * BAD_ROLL_MESSAGES.length)]! };
}
