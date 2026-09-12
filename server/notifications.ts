import webpush from "web-push";
import { NUDGE_TEXT, type PlayerId } from "../src/shared";
import { type StoredState } from "./model";

export function validSubscription(input: unknown): input is webpush.PushSubscription {
  const data = input as webpush.PushSubscription;
  if (!data || typeof data.endpoint !== "string" || data.endpoint.length > 2048
    || typeof data.keys?.p256dh !== "string" || typeof data.keys?.auth !== "string") return false;
  try {
    const url = new URL(data.endpoint);
    const allowed = url.hostname === "fcm.googleapis.com" || url.hostname === "android.googleapis.com"
      || url.hostname === "updates.push.services.mozilla.com" || url.hostname.endsWith(".push.services.mozilla.com")
      || url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com");
    return allowed && url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^[A-Za-z0-9_-]{80,100}={0,2}$/.test(data.keys.p256dh)
      && /^[A-Za-z0-9_-]{20,30}={0,2}$/.test(data.keys.auth);
  } catch { return false; }
}
export type Delivery = { status: "push" | "in-app" | "failed"; expired: string[] };
export async function sendNudge(state: StoredState, to: PlayerId): Promise<Delivery> {
  const subscriptions = state.subscriptions[to];
  if (!subscriptions.length) return { status: "in-app", expired: [] };
  const expired: string[] = [];
  const results = await Promise.all(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify({
        title: "Pass the Pigs", body: NUDGE_TEXT, url: `/${to}`, tag: state.lastNudge!.id,
      }), {
        TTL: 3600, timeout: 8000,
        vapidDetails: { subject: process.env.VAPID_SUBJECT ?? "https://github.com/dmerckx/pass-the-bigs", ...state.vapid },
      });
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) expired.push(subscription.endpoint);
      return false;
    }
  }));
  return { status: results.some(Boolean) ? "push" : "failed", expired };
}
