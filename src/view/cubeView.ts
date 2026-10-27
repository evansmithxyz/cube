/**
 * Three.js rendering of the cube. Stickers sit in fixed slots and are recolored
 * from the facelet string; a turn animates by rotating its layer's 9 cubies on a
 * pivot, then snaps them back and repaints, which looks identical by construction.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FACE_NORMAL, SOLVED, STICKERS, applyMove } from '../cube/facelets';
import { FACES, type Face, type Move } from '../cube/moves';

const COLORS: Record<Face, string> = {
  U: '#f5f5f2',
  R: '#d4142d',
  F: '#0ba84f',
  D: '#ffd41f',
  L: '#ff6d00',
  B: '#1767e0',
};
const TURN_MS = 140;
const ORIENTATION_SMOOTHING_MS = 60;
// From above the U-F-R corner, showing three faces: for a cube with no gyro.
const CORNER_VIEW = new THREE.Vector3(5, 5.6, 8);
// Straight at F from about 30 degrees above, roughly where your eyes are when you hold
// the cube, so a gyro-driven cube on screen looks the way the real one looks to you.
const HOLDING_VIEW = new THREE.Vector3(0, 5.5, 9.5);

interface Turn {
  move: Move;
  pivot: THREE.Group;
  axis: THREE.Vector3;
  angle: number;
  elapsed: number;
  duration: number;
}

function roundedSquare(size: number, radius: number): THREE.ShapeGeometry {
  const h = size / 2;
  const shape = new THREE.Shape()
    .moveTo(-h + radius, -h)
    .lineTo(h - radius, -h)
    .quadraticCurveTo(h, -h, h, -h + radius)
    .lineTo(h, h - radius)
    .quadraticCurveTo(h, h, h - radius, h)
    .lineTo(-h + radius, h)
    .quadraticCurveTo(-h, h, -h, h - radius)
    .lineTo(-h, -h + radius)
    .quadraticCurveTo(-h, -h, -h + radius, -h);
  return new THREE.ShapeGeometry(shape, 6);
}

export class CubeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly root = new THREE.Group();
  private readonly cubies: THREE.Group[] = [];
  private readonly stickers: THREE.Mesh[] = [];
  private readonly materials: Record<Face, THREE.Material>;
  private shown = SOLVED;
  private queue: Move[] = [];
  private turn: Turn | null = null;
  private readonly targetOrientation = new THREE.Quaternion();
  private lastFrame = performance.now();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.setHoldingView(false);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 9, 6);
    this.scene.add(key);

    this.materials = {} as Record<Face, THREE.Material>;
    for (const face of FACES) {
      this.materials[face] = new THREE.MeshStandardMaterial({ color: COLORS[face], roughness: 0.35 });
    }
    this.build();
    this.scene.add(this.root);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.enableDrag();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /** Show a state immediately, dropping any queued animation. */
  setState(state: string): void {
    this.queue = [];
    if (this.turn) this.endTurn();
    this.paint(state);
  }

  /** Animate a turn after any already queued. */
  enqueue(move: Move): void {
    this.queue.push(move);
  }

  /** Orientation of the whole cube (e.g. from the cube's gyro); smoothed while rendering. */
  setOrientation(orientation: THREE.Quaternion): void {
    this.targetOrientation.copy(orientation);
  }

  /** Look from where you'd see a cube you're holding (gyro cubes), or from above a corner. */
  setHoldingView(holding: boolean): void {
    this.camera.position.copy(holding ? HOLDING_VIEW : CORNER_VIEW);
    this.camera.lookAt(0, 0, 0);
  }

  private build(): void {
    const body = new RoundedBoxGeometry(0.97, 0.97, 0.97, 3, 0.1);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 });
    const sticker = roundedSquare(0.84, 0.13);
    const facingZ = new THREE.Vector3(0, 0, 1);
    const byPosition = new Map<string, THREE.Group>();

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          const cubie = new THREE.Group();
          cubie.position.set(x, y, z);
          cubie.add(new THREE.Mesh(body, bodyMaterial));
          byPosition.set(`${x},${y},${z}`, cubie);
          this.cubies.push(cubie);
          this.root.add(cubie);
        }
      }
    }

    STICKERS.forEach(({ pos, normal }, i) => {
      const mesh = new THREE.Mesh(sticker, this.materials[SOLVED[i] as Face]);
      const n = new THREE.Vector3(...normal);
      mesh.position.copy(n).multiplyScalar(0.487);
      mesh.quaternion.setFromUnitVectors(facingZ, n);
      byPosition.get(pos.join())!.add(mesh);
      this.stickers.push(mesh);
    });
  }

  private paint(state: string): void {
    this.shown = state;
    this.stickers.forEach((mesh, i) => (mesh.material = this.materials[state[i] as Face]));
  }

  private startTurn(move: Move): void {
    const axis = new THREE.Vector3(...FACE_NORMAL[move.face]);
    const pivot = new THREE.Group();
    this.root.add(pivot);
    for (const cubie of this.cubies) {
      if (cubie.position.dot(axis) > 0.5) pivot.add(cubie);
    }
    // Clockwise seen from outside the face is a negative angle about its normal.
    const quarterTurns = move.amount === 3 ? -1 : move.amount;
    this.turn = {
      move,
      pivot,
      axis,
      angle: (-Math.PI / 2) * quarterTurns,
      elapsed: 0,
      // Catch up when turns arrive faster than they animate.
      duration: (TURN_MS * (move.amount === 2 ? 1.4 : 1)) / (1 + this.queue.length),
    };
  }

  /** Put the layer back in the root (cubie transforms were never touched). */
  private endTurn(): void {
    const { pivot } = this.turn!;
    for (const cubie of [...pivot.children]) this.root.add(cubie);
    this.root.remove(pivot);
    this.turn = null;
  }

  private stepTurn(dt: number): void {
    if (!this.turn && this.queue.length > 0) this.startTurn(this.queue.shift()!);
    const turn = this.turn;
    if (!turn) return;
    turn.elapsed += dt;
    const t = Math.min(1, turn.elapsed / turn.duration);
    const eased = 1 - (1 - t) ** 3;
    turn.pivot.quaternion.setFromAxisAngle(turn.axis, turn.angle * eased);
    if (t === 1) {
      this.endTurn();
      this.paint(applyMove(this.shown, turn.move));
    }
  }

  private frame(now: number): void {
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.stepTurn(dt);
    this.root.quaternion.slerp(this.targetOrientation, 1 - Math.exp(-dt / ORIENTATION_SMOOTHING_MS));
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.canvas;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Drag to look around the cube; double-click to reset. The gyro overrides this. */
  private enableDrag(): void {
    let last: { x: number; y: number } | null = null;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3();
    const spin = new THREE.Quaternion();

    this.canvas.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.targetOrientation.premultiply(spin.setFromAxisAngle(up, dx * 0.01));
      this.targetOrientation.premultiply(spin.setFromAxisAngle(right, dy * 0.01));
    });
    const release = () => (last = null);
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('dblclick', () => this.targetOrientation.identity());
  }
}
