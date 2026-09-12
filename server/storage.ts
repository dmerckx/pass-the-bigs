import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { GameError, initialState, validateState, type StoredState } from "./model";

export type Versioned = { state: StoredState | null; token: string | null };
export interface StateStore {
  load(fresh?: boolean): Promise<Versioned>;
  save(state: StoredState, expectedToken: string | null): Promise<boolean>;
}
const locks = new Map<string, Promise<unknown>>();
export class LocalStore implements StateStore {
  constructor(private path = resolve(process.env.LOCAL_STATE_PATH ?? ".data/state.json")) {}
  async load(): Promise<Versioned> {
    try {
      const text = await readFile(this.path, "utf8");
      return { state: validateState(JSON.parse(text)), token: createHash("sha256").update(text).digest("hex") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: null, token: null };
      throw error;
    }
  }
  async save(state: StoredState, expectedToken: string | null) {
    const previous = locks.get(this.path) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if ((await this.load()).token !== expectedToken) return false;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, this.path);
      return true;
    });
    locks.set(this.path, operation);
    return operation;
  }
}
function encryptionKey(secret: string) {
  return createHash("sha256").update("pass-the-bigs:state:v2:").update(secret).digest();
}
export function sealState(state: StoredState, secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from("pass-the-bigs:v2"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return JSON.stringify({ format: "pass-the-bigs:aes-256-gcm:v2", iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}
export function openState(text: string, secret: string): StoredState {
  try {
    const envelope = JSON.parse(text);
    if (envelope.format !== "pass-the-bigs:aes-256-gcm:v2") throw new Error("Wrong format");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from("pass-the-bigs:v2")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return validateState(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")));
  } catch {
    throw new GameError(503, "The saved match cannot be decrypted. Restore the original state encryption key; the file has not been changed.");
  }
}
type GithubConfig = { token: string; repo: string; branch: string; secret: string; fetcher?: typeof fetch };
export class GithubStore implements StateStore {
  private cache: { value: Versioned; etag: string | null; until: number } | null = null;
  private branchReady = false;
  private fetcher: typeof fetch;
  constructor(private config: GithubConfig) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(config.repo) || !/^game-state[\w.-]*$/.test(config.branch)) {
      throw new GameError(503, "GITHUB_REPOSITORY or GITHUB_STATE_BRANCH is invalid.");
    }
    this.fetcher = config.fetcher ?? fetch;
  }
  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetcher(`https://api.github.com/repos/${this.config.repo}/${path}`, {
      ...init, signal: AbortSignal.timeout(12_000), headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${this.config.token}`,
        "User-Agent": "pass-the-bigs", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.status === 401 || response.status === 403) throw new GameError(503, "GitHub storage is unavailable. Check the token's Contents read/write permission or its rate limit.");
    if (response.status >= 500) throw new GameError(503, "GitHub is temporarily unavailable. Try again.");
    return response;
  }
  private async ensureBranch() {
    if (this.branchReady) return;
    const branch = await this.request(`git/ref/heads/${this.config.branch}`);
    if (branch.status === 404) {
      const main = await this.request("git/ref/heads/main");
      if (!main.ok) throw new GameError(503, "GitHub repository or main branch could not be read.");
      const { object } = await main.json() as { object: { sha: string } };
      const create = await this.request("git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${this.config.branch}`, sha: object.sha }) });
      if (!create.ok && create.status !== 422) throw new GameError(503, "Could not create the game-state branch.");
    } else if (!branch.ok) throw new GameError(503, "Could not read the game-state branch.");
    this.branchReady = true;
  }
  async load(fresh = false): Promise<Versioned> {
    if (!fresh && this.cache && Date.now() < this.cache.until) return structuredClone(this.cache.value);
    await this.ensureBranch();
    const path = `contents/state.json?ref=${encodeURIComponent(this.config.branch)}`;
    const response = await this.request(path, {
      headers: this.cache?.etag ? { "If-None-Match": this.cache.etag } : {},
    });
    if (response.status === 304 && this.cache) {
      this.cache.until = Date.now() + 4000;
      return structuredClone(this.cache.value);
    }
    if (response.status === 404) return { state: null, token: null };
    if (!response.ok) throw new GameError(503, "Could not read the shared match from GitHub.");
    const file = await response.json() as { content: string; encoding: string; sha: string };
    let text: string;
    if (file.encoding === "base64") text = Buffer.from(file.content, "base64").toString("utf8");
    else {
      // The contents API omits inline content above 1 MB; the raw representation
      // supports growing history files up to GitHub's 100 MB contents limit.
      const raw = await this.request(path, { headers: { Accept: "application/vnd.github.raw+json" } });
      if (!raw.ok) throw new GameError(503, "Could not read the match history.");
      text = await raw.text();
    }
    const value = { state: openState(text, this.config.secret), token: file.sha };
    this.cache = { value, etag: response.headers.get("etag"), until: Date.now() + 4000 };
    return structuredClone(value);
  }
  async save(state: StoredState, expectedToken: string | null) {
    await this.ensureBranch();
    const response = await this.request("contents/state.json", { method: "PUT", body: JSON.stringify({
      message: "[skip ci] Save Pass the Bigs match", branch: this.config.branch,
      content: Buffer.from(sealState(state, this.config.secret) + "\n").toString("base64"),
      ...(expectedToken ? { sha: expectedToken } : {}),
    }) });
    this.cache = null;
    if (response.status === 409 || response.status === 422) return false;
    if (!response.ok) throw new GameError(503, "The move could not be saved to GitHub. Try again.");
    return true;
  }
}
export async function readState(store: StateStore) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.load(attempt > 0);
    if (current.state) return current.state;
    const state = initialState();
    if (await store.save(state, current.token)) return state;
  }
  throw new GameError(409, "The match is busy. Try again.");
}
export async function transaction<T extends { state: StoredState; applied: boolean }>(
  store: StateStore, change: (state: StoredState) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.load(true);
    const result = change(current.state ?? initialState());
    if (!result.applied || await store.save(result.state, current.token)) return result;
  }
  throw new GameError(409, "Another move arrived first. Refresh and try again.");
}
let sharedStore: StateStore | null = null;
export function getStore(): StateStore {
  if (sharedStore) return sharedStore;
  if (process.env.VERCEL || process.env.STATE_BACKEND === "github") {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new GameError(503, "Add GITHUB_TOKEN in Vercel's environment settings, then redeploy.");
    sharedStore = new GithubStore({
      token, repo: process.env.GITHUB_REPOSITORY ?? "dmerckx/pass-the-bigs",
      branch: process.env.GITHUB_STATE_BRANCH ?? (process.env.VERCEL_ENV === "preview" ? "game-state-preview" : "game-state"),
      secret: process.env.STATE_ENCRYPTION_KEY ?? token,
    });
  } else sharedStore = new LocalStore();
  return sharedStore;
}
