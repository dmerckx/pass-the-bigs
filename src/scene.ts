import * as THREE from "three";
import { makePig, floorHeight, poseRotation, type Pig } from "./pig";
import { applyFlight, tossCameraZoom, tossSettings, type Flight } from "./toss";
import type { Outcome } from "./rules";

const random = (low: number, high: number) => low + Math.random() * (high - low);
export class PigTable {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 80);
  private renderer: THREE.WebGLRenderer;
  private pigs: [Pig, Pig] = [makePig(0xf0b8ad), makePig(0xf7cabc)];
  private resizeObserver: ResizeObserver;
  private running: { start: number; flights: [Flight, Flight]; done: () => void } | null = null;
  private charging: { started: number; onPower: (elapsed: number) => void } | null = null;
  private resting: { position: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
  private targets: HTMLButtonElement[];
  private hovered: number | null = null;
  private animationFrame = 0;
  private lastTime = 0;
  private motion = matchMedia("(prefers-reduced-motion: reduce)");
  private cameraTarget = new THREE.Vector3(0, 0.65, 0);
  private contextLost = false;

  constructor(private host: HTMLElement, targets: HTMLButtonElement[], private onFailure: () => void) {
    this.targets = targets;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x173f34, 0);
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
    this.scene.add(new THREE.HemisphereLight(0xfff5df, 0x486b56, 2.8));
    const sun = new THREE.DirectionalLight(0xfff0d6, 4.4);
    sun.position.set(-3, 7, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -7; sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
    sun.shadow.normalBias = 0.015; sun.shadow.bias = -0.0002;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xd7f2ed, 2.2);
    rim.position.set(4, 3, -4);
    this.scene.add(rim);

    // A real 3D felt disk, with a quiet inset rim and soft contact shadows.
    const felt = new THREE.MeshStandardMaterial({ color: 0x21503d, roughness: 1, metalness: 0 });
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.07, 128), felt);
    disk.position.y = -0.035;
    disk.receiveShadow = true;
    this.scene.add(disk);
    const rimRing = new THREE.Mesh(new THREE.RingGeometry(4.56, 4.573, 128), new THREE.MeshBasicMaterial({ color: 0x779476, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
    rimRing.rotation.x = -Math.PI / 2; rimRing.position.y = 0.001; this.scene.add(rimRing);
    for (const pig of this.pigs) this.scene.add(pig.group);

    for (const [index, target] of this.targets.entries()) {
      target.addEventListener("pointerenter", () => { this.hovered = index; });
      target.addEventListener("pointerleave", () => { this.hovered = null; });
      target.addEventListener("focus", () => { this.hovered = index; });
      target.addEventListener("blur", () => { this.hovered = null; });
    }
    this.show(null);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.animationFrame = requestAnimationFrame(this.frame);
  }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const vertical = Math.max(5.8, 7.6 / aspect);
    this.camera.left = -vertical * aspect / 2; this.camera.right = vertical * aspect / 2;
    this.camera.top = vertical / 2; this.camera.bottom = -vertical / 2;
    this.camera.updateProjectionMatrix();
    this.updateTargets();
  }
  private destinations(outcome: Outcome | null, variation = false) {
    return this.pigs.map((pig, i) => {
      const oinker = outcome?.kind === "oinker";
      const pose = outcome?.poses[i] ?? "trotter";
      const yaw = oinker ? 0 : (i === 0 ? -0.5 : 0.45) + (variation ? random(-0.22, 0.22) : 0);
      const rotation = poseRotation(pig, pose, yaw);
      const position = new THREE.Vector3(
        oinker ? 0 : (i === 0 ? -1.6 : 1.6) + (variation ? random(-0.08, 0.08) : 0),
        floorHeight(pig, rotation),
        oinker ? (i === 0 ? -0.47 : 0.47) : (i === 0 ? 0.2 : -0.2) + (variation ? random(-0.1, 0.1) : 0),
      );
      return { position, rotation };
    });
  }
  show(outcome: Outcome | null) {
    this.resting = this.destinations(outcome);
    this.pigs.forEach((pig, i) => {
      pig.group.position.copy(this.resting[i]!.position);
      pig.group.quaternion.copy(this.resting[i]!.rotation);
    });
    this.updateTargets();
  }
  startCharge(onPower: (elapsed: number) => void) {
    this.charging = { started: performance.now(), onPower };
  }
  cancelCharge() {
    this.charging = null;
    this.pigs.forEach((pig, i) => {
      pig.group.position.copy(this.resting[i]!.position);
      pig.group.quaternion.copy(this.resting[i]!.rotation);
      pig.group.scale.setScalar(1);
    });
  }
  toss(outcome: Outcome, strength: number): Promise<void> {
    this.cancelCharge();
    const destinations = this.destinations(outcome, true);
    const settings = tossSettings(strength, this.motion.matches);
    const flights = this.pigs.map((pig, i): Flight => ({
      start: pig.group.position.clone(), end: destinations[i]!.position,
      from: pig.group.quaternion.clone(), to: destinations[i]!.rotation,
      spinAxis: new THREE.Vector3(random(-1, 1), random(-0.4, 0.4), random(-1, 1)).normalize(),
      bend: (i === 0 ? -1 : 1) * random(0.1, 0.45) * strength,
      settings: { ...settings, duration: settings.duration + (this.motion.matches ? 0 : i * 110) },
    })) as [Flight, Flight];
    this.resting = destinations;
    return new Promise(done => {
      this.running = { start: performance.now(), flights, done };
    });
  }
  private updateTargets() {
    this.camera.updateMatrixWorld();
    const { width, height } = this.host.getBoundingClientRect();
    this.pigs.forEach((pig, i) => {
      pig.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pig.group);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const screen = new THREE.Vector3(x, y, z).project(this.camera);
        const px = (screen.x + 1) / 2 * width, py = (1 - screen.y) / 2 * height;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      const target = this.targets[i]!;
      target.style.left = `${minX - 8}px`; target.style.top = `${minY - 8}px`;
      target.style.width = `${Math.max(64, maxX - minX + 16)}px`;
      target.style.height = `${Math.max(64, maxY - minY + 16)}px`;
    });
  }
  private frame = (now: number) => {
    this.animationFrame = requestAnimationFrame(this.frame);
    if (this.contextLost || document.hidden) return;
    // Render at most 60 fps on high refresh displays.
    if (now - this.lastTime < 1000 / 65) return;
    this.lastTime = now;
    if (this.running) {
      const run = this.running;
      this.camera.zoom = Math.min(...run.flights.map(f => tossCameraZoom((now - run.start) / f.settings.duration, f.settings)));
      this.camera.updateProjectionMatrix();
      this.pigs.forEach((pig, i) => applyFlight(pig, run.flights[i], (now - run.start) / run.flights[i].settings.duration));
      if (now - run.start >= Math.max(...run.flights.map(f => f.settings.duration))) {
        this.running = null;
        this.camera.zoom = 1;
        this.camera.updateProjectionMatrix();
        this.updateTargets();
        run.done();
      }
    } else if (this.charging) {
      const elapsed = now - this.charging.started, power = Math.min(1, elapsed / 1400);
      this.charging.onPower(elapsed);
      if (!this.motion.matches) this.pigs.forEach((pig, i) => {
        pig.group.position.copy(this.resting[i]!.position);
        pig.group.position.y += power * 0.15;
        pig.group.quaternion.copy(this.resting[i]!.rotation);
        pig.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), Math.sin(now * 0.032 + i) * 0.025 * power));
        pig.group.position.y = Math.max(pig.group.position.y, floorHeight(pig, pig.group.quaternion));
      });
    } else {
      this.pigs.forEach((pig, i) => {
        const skin = (pig.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>).material;
        skin.emissive.setHex(this.hovered === i ? 0x391b0e : 0x000000);
        skin.emissiveIntensity = this.hovered === i ? 0.15 : 0;
      });
    }
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
      }
    });
    this.renderer.dispose();
  }
}
