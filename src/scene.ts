import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { orbitCamera, MIN_POLAR, MAX_POLAR } from "./view";
import { floorHeight } from "./pig";
import { applyFlight, tossCameraZoom, tossSettings, type Flight } from "./toss";
import type { Outcome } from "./rules";
import { PLAYER_IDS, type PlayerId } from "./shared";
import type { PlayerIndex } from "./game";
import { COLOR_PALETTES, type PlayerProfile } from "./palette";
import {
  makePlayerSlice, setSliceAppearance, showSlice, restoreSlice, sliceDestinations, positionSlice,
  celebrateSlice, turnAngle, transitionAngle, MIN_TABLE_HEIGHT, MIN_TABLE_WIDTH, SWITCH_MS,
} from "./tableau";

const random = (low: number, high: number) => low + Math.random() * (high - low);
export class PigTable {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100);
  private renderer: THREE.WebGLRenderer;
  private slices = [makePlayerSlice(), makePlayerSlice()] as const;
  private selected: PlayerIndex = 0;
  private hasView = false;
  private angle = 0;
  private switching: { from: number; to: number; start: number; resolve: () => void; promise: Promise<void> } | null = null;
  private winner: PlayerIndex | null = null;
  private celebrationStarted = 0;
  private resizeObserver: ResizeObserver;
  private running: { player: PlayerIndex; start: number; flights: [Flight, Flight]; done: () => void } | null = null;
  private charging: { started: number; onPower: (elapsed: number) => void } | null = null;
  private hovered: number | null = null;
  private animationFrame = 0;
  private lastTime = 0;
  private motion = matchMedia("(prefers-reduced-motion: reduce)");
  private cameraTarget = new THREE.Vector3(0, .65, 0);
  private contextLost = false;
  private controls: OrbitControls;
  private hemisphere: THREE.HemisphereLight;
  private hiddenAt: number | null = null;

  constructor(private host: HTMLElement, private targets: HTMLButtonElement[], private onFailure: () => void,
    private labels: HTMLElement[] = [], private sliceLabels: HTMLElement[] = [], private onViewSettled: () => void = () => {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x1c2433, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", event => {
      event.preventDefault(); this.contextLost = true; this.onFailure();
    });
    this.camera.position.set(3.5, 6, 8.5);
    this.camera.lookAt(this.cameraTarget);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.cameraTarget);
    this.controls.enablePan = false; this.controls.enableZoom = false;
    this.controls.enableDamping = !this.motion.matches; this.controls.dampingFactor = .09;
    this.controls.minPolarAngle = MIN_POLAR; this.controls.maxPolarAngle = MAX_POLAR;
    this.controls.rotateSpeed = .7;
    this.controls.addEventListener("change", () => this.layout());
    this.host.addEventListener("wheel", this.onWheel, { passive: false });
    this.host.addEventListener("keydown", this.onViewKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.hemisphere = new THREE.HemisphereLight(0xfff5df, 0x50697f, 2.8);
    this.scene.add(this.hemisphere);
    const sun = new THREE.DirectionalLight(0xfff0d6, 4.4);
    sun.position.set(-3, 10, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    sun.shadow.normalBias = .015; sun.shadow.bias = -.0002; sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xd7e7f2, 2.2); rim.position.set(4, 3, -4); this.scene.add(rim);
    for (const slice of this.slices) this.scene.add(slice.root);
    for (const [i, target] of this.targets.entries()) {
      target.addEventListener("pointerenter", () => { this.hovered = i; });
      target.addEventListener("pointerleave", () => { this.hovered = null; });
      target.addEventListener("focus", () => { this.hovered = i; });
      target.addEventListener("blur", () => { this.hovered = null; });
    }
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.resize();
    this.animationFrame = requestAnimationFrame(this.frame);
  }
  get transitioning() { return this.switching !== null; }
  setPlayers(profiles: Record<PlayerId, PlayerProfile>) {
    this.slices.forEach((slice, i) => setSliceAppearance(slice, profiles[PLAYER_IDS[i]!]));
    this.hemisphere.groundColor.setHex(COLOR_PALETTES[profiles[PLAYER_IDS[this.selected]].color].ground);
  }
  focus(player: PlayerIndex, animate = true): Promise<void> {
    if (this.hasView && player === this.selected) return this.switching?.promise ?? Promise.resolve();
    this.selected = player; this.hovered = null;
    const to = turnAngle(this.angle, player);
    this.switching?.resolve();
    if (!this.hasView || !animate || this.motion.matches) {
      this.hasView = true; this.angle = to; this.switching = null;
      this.updateControls(); this.layout(); return Promise.resolve();
    }
    this.hasView = true;
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    this.switching = { from: this.angle, to, start: performance.now(), promise, resolve };
    this.updateControls(); return promise;
  }
  setWinner(player: PlayerIndex | null) {
    if (player === this.winner) return;
    this.winner = player; this.celebrationStarted = performance.now();
    if (player === null) this.slices.forEach(restoreSlice);
  }
  private updateControls() { this.controls.enabled = !this.charging && !this.running && !this.switching; }
  private onVisibility = () => {
    if (document.hidden) this.hiddenAt = performance.now();
    else if (this.hiddenAt !== null) {
      const elapsed = performance.now() - this.hiddenAt;
      if (this.running) this.running.start += elapsed;
      if (this.switching) this.switching.start += elapsed;
      this.celebrationStarted += elapsed; this.hiddenAt = null;
    }
  };
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const aspect = width / height, vertical = Math.max(MIN_TABLE_HEIGHT, MIN_TABLE_WIDTH / aspect);
    this.camera.left = -vertical * aspect / 2; this.camera.right = vertical * aspect / 2;
    this.camera.top = vertical / 2; this.camera.bottom = -vertical / 2;
    this.camera.updateProjectionMatrix(); this.layout();
  }
  show(outcome: Outcome | null, player: PlayerIndex = this.selected) {
    showSlice(this.slices[player], outcome); this.layout();
  }
  startCharge(onPower: (elapsed: number) => void) {
    if (this.switching || this.running || this.winner !== null) return;
    this.charging = { started: performance.now(), onPower }; this.updateControls();
  }
  cancelCharge() {
    if (this.charging) restoreSlice(this.slices[this.selected]);
    this.charging = null; this.updateControls();
  }
  async toss(outcome: Outcome, strength: number, player: PlayerIndex = this.selected): Promise<void> {
    this.cancelCharge();
    await this.focus(player);
    const slice = this.slices[player], destinations = sliceDestinations(slice, outcome, true);
    const settings = tossSettings(strength, this.motion.matches);
    const flights = slice.pigs.map((pig, i): Flight => ({
      start: pig.group.position.clone(), end: destinations[i]!.position,
      from: pig.group.quaternion.clone(), to: destinations[i]!.rotation,
      spinAxis: new THREE.Vector3(random(-1, 1), random(-.4, .4), random(-1, 1)).normalize(),
      bend: (i === 0 ? -1 : 1) * random(.1, .45) * strength,
      settings: { ...settings, duration: settings.duration + (this.motion.matches ? 0 : i * 110) },
    })) as [Flight, Flight];
    slice.resting = destinations;
    return new Promise(done => {
      this.running = { player, start: performance.now(), flights, done }; this.updateControls();
    });
  }
  private layout() {
    this.camera.updateMatrixWorld();
    this.slices.forEach((slice, i) => positionSlice(slice.root, i as PlayerIndex, this.angle, this.camera, this.winner !== null));
    this.updateTargets();
  }
  private updateTargets() {
    const { width, height } = this.host.getBoundingClientRect();
    this.slices[this.selected].pigs.forEach((pig, i) => {
      pig.group.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(pig.group);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const screen = new THREE.Vector3(x, y, z).project(this.camera);
        const px = (screen.x + 1) / 2 * width, py = (1 - screen.y) / 2 * height;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      const target = this.targets[i]!;
      target.style.left = `${minX - 8}px`; target.style.top = `${minY - 8}px`;
      target.style.width = `${Math.max(64, maxX - minX + 16)}px`; target.style.height = `${Math.max(64, maxY - minY + 16)}px`;
      target.style.visibility = this.switching || this.winner !== null ? "hidden" : "";
      const label = this.labels[i];
      if (label) {
        label.style.left = `${Math.max(78, Math.min(width - 78, (minX + maxX) / 2))}px`;
        label.style.top = `${Math.min(height - 34, maxY + 7)}px`;
        label.style.visibility = this.switching || this.winner !== null ? "hidden" : "";
      }
    });
    this.sliceLabels.forEach((label, i) => {
      label.hidden = i === this.selected || !!this.switching;
      const anchor = new THREE.Vector3(0, 1.6, 0).applyMatrix4(this.slices[i]!.root.matrixWorld).project(this.camera);
      label.style.left = `${Math.max(60, Math.min(width - 60, (anchor.x + 1) / 2 * width))}px`;
      label.style.top = `${Math.max(4, (1 - anchor.y) / 2 * height - 16)}px`;
    });
  }
  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (!this.controls.enabled) return;
    const delta = (event.deltaX || event.deltaY) * (event.deltaMode === 1 ? 16 : 1);
    orbitCamera(this.camera, this.cameraTarget, Math.max(-180, Math.min(180, delta)) * .004);
    this.controls.update(); this.layout();
  };
  private onViewKey = (event: KeyboardEvent) => {
    if (!this.controls.enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    orbitCamera(this.camera, this.cameraTarget,
      event.key === "ArrowLeft" ? -.15 : event.key === "ArrowRight" ? .15 : 0,
      event.key === "ArrowUp" ? -.08 : event.key === "ArrowDown" ? .08 : 0);
    this.controls.update(); this.layout();
  };
  private frame = (now: number) => {
    this.animationFrame = requestAnimationFrame(this.frame);
    if (this.contextLost || document.hidden || now - this.lastTime < 1000 / 65) return;
    this.lastTime = now; this.controls.update();
    if (this.switching) {
      const change = this.switching, progress = (now - change.start) / SWITCH_MS;
      this.angle = transitionAngle(change.from, change.to, progress);
      if (progress >= 1) {
        this.angle = change.to; this.switching = null; this.updateControls();
        change.resolve(); this.onViewSettled();
      }
    }
    if (this.running) {
      const run = this.running;
      this.camera.zoom = Math.min(...run.flights.map(f => tossCameraZoom((now - run.start) / f.settings.duration, f.settings)));
      this.camera.updateProjectionMatrix();
      this.slices[run.player].pigs.forEach((pig, i) => applyFlight(pig, run.flights[i], (now - run.start) / run.flights[i].settings.duration));
      if (now - run.start >= Math.max(...run.flights.map(f => f.settings.duration))) {
        this.running = null; this.camera.zoom = 1; this.camera.updateProjectionMatrix(); this.updateControls(); run.done();
      }
    } else if (this.winner !== null) {
      this.slices.forEach((slice, i) => celebrateSlice(slice, i === this.winner, (now - this.celebrationStarted) / 1000, this.motion.matches));
    } else if (this.charging) {
      const slice = this.slices[this.selected], elapsed = now - this.charging.started, power = Math.min(1, elapsed / 1400);
      this.charging.onPower(elapsed);
      if (!this.motion.matches) slice.pigs.forEach((pig, i) => {
        pig.group.position.copy(slice.resting[i]!.position); pig.group.position.y += power * .15;
        pig.group.quaternion.copy(slice.resting[i]!.rotation);
        pig.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), Math.sin(now * .032 + i) * .025 * power));
        pig.group.position.y = Math.max(pig.group.position.y, floorHeight(pig, pig.group.quaternion));
      });
    } else {
      this.slices.forEach((slice, player) => slice.pigs.forEach((pig, i) => {
        pig.materials.skin.emissive.setHex(player === this.selected && this.hovered === i ? 0x391b0e : 0);
        pig.materials.skin.emissiveIntensity = .15;
      }));
    }
    this.layout(); this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    cancelAnimationFrame(this.animationFrame); this.resizeObserver.disconnect(); this.controls.dispose();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.host.removeEventListener("wheel", this.onWheel); this.host.removeEventListener("keydown", this.onViewKey);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.renderer.dispose();
  }
}
