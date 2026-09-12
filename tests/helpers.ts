import { initialState } from "../server/model";
export function readyState() {
  const state = initialState();
  state.profiles.david.completed = true;
  state.profiles.elisabeth.completed = true;
  return state;
}
