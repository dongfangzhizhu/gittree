/**
 * three.js 三维渲染器
 *
 * 职责：
 * - 持有 WebGLRenderer / Scene / Camera / OrbitControls
 * - setScene(scene)：把场景描述编译为 three 对象图（锥形枝干、实例化叶、果实、年轮地纹、星空）
 * - updateTree(t)：确定性更新（同一 t 必得同一画面，风动是 t 的函数）
 * - pick()：射线拾取叶子/果实，供点击交互
 * - 相机视角预设与过渡动画、自动旋转
 * - sampleCanvas()：供端到端测试读取 WebGL 像素
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ThreeScene, SceneSegment, SceneLeaf, SceneFruit, SceneBranch } from "./scene-types";
import { buildBranchGeometry, visibleRingCount } from "./branch-geometry";
import type { ForestScene, ForestTreeMeta } from "./forest-builder";

/** 叶子调色板（索引 12 = 紫色，spec:/hook: 提交；与二维版一致） */
const LEAF_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
  "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#82E0AA",
  "#F1948A", "#63A06E", "#9B59B6",
];
const WITHERED_COLOR = "#8d6e63";
const TRUNK_COLOR = 0x2f5d3f;
const BRANCH_COLOR = 0x4a7c59;
const GRAFT_COLOR = 0x7a9b6a;
const GOLD = 0xffd700;
const BG_COLOR = 0x0a0e27;

/** 落叶持续时间（动画时间单位，与二维版一致） */
const FALL_DURATION = 0.06;

/**
 * 节点视觉缩放：场景以「树高 ≈ 820 世界单位」构图，
 * 叶/果的基础半径只有 0.3–1.6 单位，直接渲染不足 1px。
 * 放大到肉眼可见、可点击的尺寸（直径约 8–26 单位）。
 */
const LEAF_SCALE = 11;
const FRUIT_SCALE = 11;

export type ViewName = "overview" | "side" | "top" | "root";

interface BranchEntry {
  branch: SceneBranch;
  mesh: THREE.Mesh;
  ringBirths: number[];
  indicesPerRing: number;
  ringCount: number;
  sideIndexCount: number;
  fullIndexCount: number;
}

interface GraftEntry {
  seg: SceneSegment;
  mesh: THREE.Mesh;
  rings: number;
}

interface LeafGroup {
  mesh: THREE.InstancedMesh;
  items: SceneLeaf[];
  /** 每实例基础颜色 */
  baseColors: THREE.Color[];
}

interface FruitGroup {
  mesh: THREE.InstancedMesh;
  items: SceneFruit[];
  baseColors: THREE.Color[];
}

export interface NodeHitLeaf {
  kind: "leaf";
  item: SceneLeaf;
  point: THREE.Vector3;
}

export interface NodeHitFruit {
  kind: "fruit";
  item: SceneFruit;
  point: THREE.Vector3;
}

export type NodeHit = NodeHitLeaf | NodeHitFruit;

export interface TreeRendererOptions {
  dpr?: number;
}

export class TreeRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private scene3d: ThreeScene | null = null;
  /** 森林里的树（单树时长度为 1），供 HTML 名牌定位 */
  private forest: ForestTreeMeta[] = [];
  /** 每帧渲染后的回调（HTML 名牌跟随三维位置） */
  onAfterRender: (() => void) | null = null;
  private branchEntries: BranchEntry[] = [];
  private graftEntries: GraftEntry[] = [];
  private leafGroups: LeafGroup[] = [];
  private fruitGroups: FruitGroup[] = [];
  private pickMeshes: THREE.Mesh[] = [];
  private disposables: Array<{ dispose(): void }> = [];

  private ground: THREE.Group | null = null;
  private stars: THREE.Points | null = null;
  private selectionMarker: THREE.Mesh | null = null;
  private hoveredKey: string | null = null;
  private selectedKey: string | null = null;

  /** 相机过渡动画状态 */
  private camAnim: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    dur: number;
  } | null = null;

  private raycaster = new THREE.Raycaster();
  private tmpMatrix = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();
  private tmpVec = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private upVector = new THREE.Vector3(0, 1, 0);
  /** 最近一次 updateTree 的时间点（判定节点是否可见） */
  private lastT = 0;
  /** 待取景标记：setScene 后等首个真实画幅再算机位 */
  private needsFrame = true;
  /** 空闲驱动循环句柄（相机过渡 / 自动旋转） */
  private idleRaf: number | null = null;
  /** 需要持续出帧到的时刻（拖拽/滚轮后的阻尼收敛） */
  private renderUntil = 0;

  constructor(canvas: HTMLCanvasElement, options: TreeRendererOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // 保留绘制缓冲：toDataURL（PNG 导出）与 readPixels（测试采样）依赖它
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(options.dpr ?? window.devicePixelRatio ?? 1);
    this.renderer.setClearColor(BG_COLOR, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, 1800, 4800);

    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 5, 9000);
    this.camera.position.set(1100, 800, 1300);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 200;
    this.controls.maxDistance = 4600;
    this.controls.maxPolarAngle = 1.53; // 不钻到地面以下
    this.controls.autoRotateSpeed = 0.7;

    // 暂停时也要能拖动/缩放：交互期间按需出帧（含阻尼收敛）
    const wake = () => this.requestFrames(450);
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", wake);
    el.addEventListener("pointermove", wake);
    el.addEventListener("wheel", wake, { passive: true });
    el.addEventListener("touchmove", wake, { passive: true });

    this.setupLights();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x0a0e27, 0.62);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.0);
    sun.position.set(700, 1400, 500);
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x4ecdc4, 0.4);
    rim.position.set(-600, 300, -500);
    this.scene.add(rim);
  }

  /** 编译场景描述 → three 对象图 */
  setScene(scene: ThreeScene | null): void {
    this.clearScene();
    this.scene3d = scene;
    const forest = (scene as ForestScene | null)?.trees;
    this.forest = Array.isArray(forest) ? forest : [];
    if (!scene || scene.segments.length === 0) return;

    this.buildGround(scene.radius);
    this.buildStars();
    this.buildBranches(scene);
    this.buildGrafts(scene);
    this.buildLeaves(scene);
    this.buildFruits(scene);
    this.buildSelectionMarker();

    // 初始取景：等第一次拿到真实画幅后再算（见 resize → frameScene）
    this.needsFrame = true;
    this.frameScene();
    this.camAnim = null;
    this.controls.update();
  }

  /**
   * 在当前 fov 与画幅下装下整棵树所需的相机距离。
   * 树高 800+、宽 400+，用固定距离必然裁切，故按 fov 反算。
   */
  private fitDistance(margin = 1.1): number {
    const s = this.scene3d;
    if (!s) return 1200;
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * Math.max(0.55, this.camera.aspect);
    const halfH = Math.max(s.height * 0.55, 120);
    const halfW = Math.max(s.radius * 1.15, s.height * 0.2);
    return Math.max(halfH / tanV, halfW / tanH) * margin;
  }

  /** 默认机位：正对整棵树，略高俯视 */
  private frameScene(): void {
    const s = this.scene3d;
    if (!s) return;
    const target = new THREE.Vector3(0, s.height * 0.5, 0);
    const dist = this.fitDistance();
    const dir = new THREE.Vector3(0.68, 0.36, 0.68).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.update();
  }

  private clearScene(): void {
    for (const entry of this.branchEntries) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.branchEntries = [];
    for (const entry of this.graftEntries) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.graftEntries = [];
    for (const group of this.leafGroups) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      (group.mesh.material as THREE.Material).dispose();
      group.mesh.dispose();
    }
    this.leafGroups = [];
    for (const group of this.fruitGroups) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      (group.mesh.material as THREE.Material).dispose();
      group.mesh.dispose();
    }
    this.fruitGroups = [];
    this.pickMeshes = [];
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        if (mat && "map" in mat && (mat as any).map) (mat as any).map.dispose();
        mat?.dispose();
      });
      this.ground = null;
    }
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      (this.stars.material as THREE.Material).dispose();
      this.stars = null;
    }
    if (this.selectionMarker) {
      this.scene.remove(this.selectionMarker);
      this.selectionMarker.geometry.dispose();
      (this.selectionMarker.material as THREE.Material).dispose();
      this.selectionMarker = null;
    }
    this.hoveredKey = null;
    this.selectedKey = null;
  }

  /** 年轮地纹 + 地面光晕（呼应「代码年轮」意象） */
  private buildGround(radius: number): void {
    const group = new THREE.Group();

    const glowGeo = new THREE.CircleGeometry(Math.max(600, radius * 1.8), 64);
    const glowTex = makeRadialTexture();
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -2;
    group.add(glow);

    // 四道年轮环线
    for (let i = 0; i < 4; i++) {
      const r = 260 + i * 220;
      const ringGeo = new THREE.RingGeometry(r, r + 3, 96);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x4ecdc4,
        transparent: true,
        opacity: 0.1 - i * 0.015,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1;
      group.add(ring);
    }

    this.ground = group;
    this.scene.add(group);
  }

  /** 确定性星空（种子来自场景 seed） */
  private buildStars(): void {
    const scene = this.scene3d!;
    const count = 360;
    const positions = new Float32Array(count * 3);
    let seedState = hashString(scene.seed + ":stars");
    for (let i = 0; i < count; i++) {
      seedState = (seedState * 1664525 + 1013904223) >>> 0;
      const r1 = seedState / 0xffffffff;
      seedState = (seedState * 1664525 + 1013904223) >>> 0;
      const r2 = seedState / 0xffffffff;
      const theta = r1 * Math.PI * 2;
      const phi = Math.acos(1 - r2 * 0.85); // 偏上半球
      const radius = 2600 + r1 * 600;
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * radius + 200;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.5,
      fog: false,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  /**
   * 枝干：每条 lane 一根连续管状网格（CatmullRom 平滑 + 平行传输标架 + 连续锥度），
   * 彻底消除「多段圆柱拼接」的接缝与折痕
   */
  private buildBranches(scene: ThreeScene): void {
    for (const branch of scene.branches) {
      const built = buildBranchGeometry(branch);
      if (built.ringCount === 0) continue;

      const color = branch.kind === "trunk" ? TRUNK_COLOR : BRANCH_COLOR;
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.92,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(built.geometry, mat);
      mesh.frustumCulled = false;
      // 初始全部隐藏，由 updateTree 按出生时间揭示
      built.geometry.setDrawRange(0, 0);
      this.scene.add(mesh);

      this.branchEntries.push({
        branch,
        mesh,
        ringBirths: built.ringBirths,
        indicesPerRing: built.indicesPerRing,
        ringCount: built.ringCount,
        sideIndexCount: built.sideIndexCount,
        fullIndexCount: built.fullIndexCount,
      });
    }
  }

  /** 嫁接弧：merge 处的二次贝塞尔细管，按 drawRange 生长 */
  private buildGrafts(scene: ThreeScene): void {
    for (const seg of scene.segments) {
      if (seg.kind !== "graft") continue;
      const ctrl = seg.ctrl ?? [
        (seg.p0[0] + seg.p1[0]) / 2,
        (seg.p0[1] + seg.p1[1]) / 2 + 40,
        (seg.p0[2] + seg.p1[2]) / 2,
      ];
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(...seg.p0),
        new THREE.Vector3(...ctrl),
        new THREE.Vector3(...seg.p1)
      );
      const rings = 14;
      const geo = new THREE.TubeGeometry(curve, rings, 1.5, 6, false);
      geo.setDrawRange(0, 0);
      const mat = new THREE.MeshStandardMaterial({ color: GRAFT_COLOR, roughness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.graftEntries.push({ seg, mesh, rings });
    }
  }

  /** 叶子：按形状分组的 InstancedMesh */
  private buildLeaves(scene: ThreeScene): void {
    const byShape = new Map<string, SceneLeaf[]>();
    for (const leaf of scene.leaves) {
      if (leaf.shape === "none") continue;
      const list = byShape.get(leaf.shape) || [];
      list.push(leaf);
      byShape.set(leaf.shape, list);
    }

    for (const [shape, items] of byShape) {
      const geo = leafGeometry(shape);
      if (!geo) continue;
      // 叶形几何在 XY 平面（叶长沿 Y）；旋到水平面，再由实例矩阵做方位与俯仰
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.78,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const baseColors: THREE.Color[] = [];
      for (let i = 0; i < items.length; i++) {
        const leaf = items[i];
        const color =
          leaf.shape === "withered"
            ? new THREE.Color(WITHERED_COLOR)
            : new THREE.Color(LEAF_COLORS[leaf.colorIndex] || LEAF_COLORS[11]);
        baseColors.push(color);
        mesh.setColorAt(i, color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      this.scene.add(mesh);
      this.leafGroups.push({ mesh, items, baseColors });
      this.pickMeshes.push(mesh);
    }
  }

  /** 果实：主版本（金色八面体）/ 普通标签（金球）/ Kiro 紫花（紫色四面体） */
  private buildFruits(scene: ThreeScene): void {
    const kinds: Array<"major" | "normal" | "spec"> = ["major", "normal", "spec"];
    for (const kind of kinds) {
      const items = scene.fruits.filter((f) => f.kind === kind);
      if (items.length === 0) continue;

      let geo: THREE.BufferGeometry;
      let color: number;
      let emissive: number;
      if (kind === "major") {
        geo = makeAppleGeometry(1.2);
        color = 0xd8342b; // 主版本：红苹果
        emissive = 0x2a0503;
      } else if (kind === "normal") {
        geo = makeAppleGeometry(0.92);
        color = 0xe8a33d; // 普通标签：金苹果
        emissive = 0x2b1c02;
      } else {
        geo = makeAppleGeometry(0.72);
        color = 0x9b59b6; // spec:/hook: 紫苹果
        emissive = 0x2a1140;
      }
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.3,
        roughness: 0.42,
        metalness: 0.06,
        vertexColors: true,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // 苹果的颜色由材质 + 顶点色（果身白、果柄深褐）决定，
      // 不再用 instanceColor —— 否则会和顶点色相乘导致颜色失真。
      const baseColors: THREE.Color[] = items.map(() => new THREE.Color(color));

      this.scene.add(mesh);
      this.fruitGroups.push({ mesh, items, baseColors });
      this.pickMeshes.push(mesh);
    }
  }

  /** 选中节点的脉冲光环 */
  private buildSelectionMarker(): void {
    const geo = new THREE.RingGeometry(14, 18, 40);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4ecdc4,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.selectionMarker = new THREE.Mesh(geo, mat);
    this.selectionMarker.visible = false;
    this.scene.add(this.selectionMarker);
  }

  /**
   * 确定性更新：t ∈ [0,1] → 画面（不读时钟）
   */
  updateTree(t: number): void {
    const scene = this.scene3d;
    if (!scene) return;
    this.lastT = t;

    // 枝干生长：按环序揭示索引（环序即时间序），保留连续管面
    for (const entry of this.branchEntries) {
      const visibleRings = visibleRingCount(entry.ringBirths, t);
      if (visibleRings <= 0) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.visible = true;
      if (visibleRings >= entry.ringCount) {
        // 完全长成：连同端盖一起显示
        entry.mesh.geometry.setDrawRange(0, entry.fullIndexCount);
      } else {
        // 环 i → 环 i+1 属于第 i 段侧面；显示 visibleRings-1 段
        const bands = Math.max(0, visibleRings - 1);
        entry.mesh.geometry.setDrawRange(0, bands * entry.indicesPerRing);
      }
    }

    // 嫁接弧生长
    for (const entry of this.graftEntries) {
      const [t0, t1] = entry.seg.birth;
      if (t < t0) {
        entry.mesh.visible = false;
        continue;
      }
      const progress = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1;
      if (progress <= 0) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.visible = true;
      // TubeGeometry 顶点按环排列：每环 (radialSegments+1)=7 个顶点
      const perRing = 7;
      const rings = Math.max(1, Math.ceil(progress * entry.rings));
      entry.mesh.geometry.setDrawRange(0, rings * perRing);
    }

    // 叶子：生长、风动、落叶
    for (const group of this.leafGroups) {
      const mesh = group.mesh;
      for (let i = 0; i < group.items.length; i++) {
        const leaf = group.items[i];
        if (t < leaf.birth) {
          this.tmpScale.set(0, 0, 0);
          this.tmpMatrix.compose(new THREE.Vector3(...leaf.pos), this.tmpQuat.identity(), this.tmpScale);
          mesh.setMatrixAt(i, this.tmpMatrix);
          continue;
        }

        let s = leaf.size * LEAF_SCALE * Math.min(1, (t - leaf.birth) / 0.08);
        let [x, y, z] = leaf.pos;

        if (leaf.fallAt !== undefined && t > leaf.fallAt) {
          const f = (t - leaf.fallAt) / FALL_DURATION;
          if (f >= 1) {
            this.tmpScale.set(0, 0, 0);
            this.tmpMatrix.compose(new THREE.Vector3(x, y, z), this.tmpQuat.identity(), this.tmpScale);
            mesh.setMatrixAt(i, this.tmpMatrix);
            continue;
          }
          x += Math.sin(f * 6 + i) * 24 * f;
          y -= f * 140;
          s *= 1 - f;
        }

        // 风动：叶片按方位角铺开，只做小幅俯仰与偏摆，不再像螺旋桨那样自转
        s *= 1 + Math.sin(t * Math.PI * 2 * 2 + leaf.phase) * 0.05;
        const yaw = leaf.phase * Math.PI * 2 + Math.sin(t * 1.7 + leaf.phase) * 0.14;
        const tilt = 0.28 + leaf.axis[1] * 0.34 + Math.sin(t * 2.3 + leaf.phase * 2.1) * 0.08;
        const roll = leaf.axis[0] * 0.6;
        this.tmpEuler.set(tilt, yaw, roll, "YXZ");
        this.tmpQuat.setFromEuler(this.tmpEuler);

        if (s <= 0) {
          this.tmpScale.set(0, 0, 0);
        } else {
          this.tmpScale.set(s, s, s);
        }
        this.tmpVec.set(x, y, z);
        this.tmpMatrix.compose(this.tmpVec, this.tmpQuat, this.tmpScale);
        mesh.setMatrixAt(i, this.tmpMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    // 果实：生长 + 浮动 + 慢旋
    for (const group of this.fruitGroups) {
      const mesh = group.mesh;
      for (let i = 0; i < group.items.length; i++) {
        const fruit = group.items[i];
        if (t < fruit.birth) {
          this.tmpScale.set(0, 0, 0);
          this.tmpMatrix.compose(new THREE.Vector3(...fruit.pos), this.tmpQuat.identity(), this.tmpScale);
          mesh.setMatrixAt(i, this.tmpMatrix);
          continue;
        }
        const fade = Math.min(1, (t - fruit.birth) / 0.2);
        const hover = fruit.id === this.hoveredKey ? 1.25 : 1;
        const s = fruit.size * FRUIT_SCALE * (0.7 + 0.3 * fade) * (1 + Math.sin(t * Math.PI * 2 * 2 + i) * 0.06) * hover;
        this.tmpVec.set(
          fruit.pos[0],
          fruit.pos[1] + Math.sin(t * 2 + i * 0.7) * 3,
          fruit.pos[2]
        );
        this.tmpQuat.setFromAxisAngle(this.upVector, t * 0.8 + i);
        this.tmpScale.set(s, s, s);
        this.tmpMatrix.compose(this.tmpVec, this.tmpQuat, this.tmpScale);
        mesh.setMatrixAt(i, this.tmpMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    // 选中光环脉冲
    if (this.selectionMarker && this.selectedKey) {
      const hit = this.getNodeById(this.selectedKey);
      if (hit) {
        this.selectionMarker.visible = true;
        this.selectionMarker.position.copy(hit.point);
        this.selectionMarker.lookAt(this.camera.position);
        const pulse = 1 + Math.sin(t * Math.PI * 4) * 0.15;
        this.selectionMarker.scale.set(pulse, pulse, pulse);
      } else {
        this.selectionMarker.visible = false;
      }
    }
  }

  /** 渲染一帧（含相机阻尼与过渡动画） */
  render(now: number = performance.now()): void {
    if (this.camAnim) {
      const k = Math.min(1, (now - this.camAnim.start) / this.camAnim.dur);
      const e = easeInOutCubic(k);
      this.camera.position.lerpVectors(this.camAnim.from, this.camAnim.to, e);
      this.controls.target.lerpVectors(this.camAnim.fromTarget, this.camAnim.toTarget, e);
      if (k >= 1) this.camAnim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    // 通知外部：三维画面已更新（HTML 名牌据此跟随投影位置）
    this.onAfterRender?.();
  }

  /** 视角预设 */
  setView(name: ViewName): void {
    const scene = this.scene3d;
    if (!scene) return;
    const h = scene.height;
    const fit = this.fitDistance();
    let to: THREE.Vector3;
    let target: THREE.Vector3;
    const place = (dir: THREE.Vector3, dist: number, tgt: THREE.Vector3) =>
      tgt.clone().addScaledVector(dir.normalize(), dist);
    switch (name) {
      case "side":
        target = new THREE.Vector3(0, h * 0.5, 0);
        to = place(new THREE.Vector3(1, 0.1, 0.16), fit, target);
        break;
      case "top":
        target = new THREE.Vector3(0, h * 0.42, 0);
        to = place(new THREE.Vector3(0.01, 1, 0.01), fit * 1.02, target);
        break;
      case "root":
        target = new THREE.Vector3(0, h * 0.14, 0);
        to = place(new THREE.Vector3(0.72, 0.24, 0.72), fit * 0.46, target);
        break;
      case "overview":
      default:
        target = new THREE.Vector3(0, h * 0.5, 0);
        to = place(new THREE.Vector3(0.68, 0.36, 0.68), fit, target);
        break;
    }
    this.flyTo(to, target);
  }

  /** 聚焦到某个节点（信息面板「定位」用） */
  focusNode(key: string): void {
    const hit = this.getNodeById(key);
    if (!hit) return;
    const dir = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    const to = hit.point.clone().add(dir.multiplyScalar(240));
    to.y = Math.max(to.y, hit.point.y + 60);
    this.flyTo(to, hit.point.clone());
  }

  private flyTo(to: THREE.Vector3, target: THREE.Vector3): void {
    this.camAnim = {
      from: this.camera.position.clone(),
      to,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      start: performance.now(),
      dur: 900,
    };
    // 暂停状态下主循环不跑帧，这里自带驱动，否则视角切换「点了没反应」
    this.ensureIdleLoop();
  }

  /**
   * 空闲驱动循环：播放暂停时也要让相机过渡/自动旋转/拖拽阻尼持续推进。
   * 只在有实际动画需求时自我续帧，避免空转耗电。
   */
  private ensureIdleLoop(): void {
    if (this.idleRaf !== null) return;
    const tick = (now: number) => {
      this.idleRaf = null;
      this.render(now);
      const active = this.camAnim || this.controls.autoRotate || now < this.renderUntil;
      if (active) this.idleRaf = requestAnimationFrame(tick);
    };
    this.idleRaf = requestAnimationFrame(tick);
  }

  /** 请求在未来 ms 毫秒内持续出帧（拖拽/滚轮后让阻尼走完） */
  private requestFrames(ms = 400): void {
    this.renderUntil = Math.max(this.renderUntil, performance.now() + ms);
    this.ensureIdleLoop();
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
    if (on) this.ensureIdleLoop();
  }

  /**
   * 射线拾取：屏幕坐标 → 叶子/果实节点
   * 先做精确射线检测；未命中时退化为「屏幕就近拾取」，
   * 保证任意视角、任意远近、播放或暂停状态都能稳定点中节点。
   */
  pick(clientX: number, clientY: number, tolerancePx = 18): NodeHit | null {
    if (this.pickMeshes.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    for (const hit of hits) {
      if (hit.instanceId === undefined || !hit.object) continue;
      const mesh = hit.object as THREE.InstancedMesh;
      const leafGroup = this.leafGroups.find((g) => g.mesh === mesh);
      const fruitGroup = this.fruitGroups.find((g) => g.mesh === mesh);
      if (leafGroup) {
        const item = leafGroup.items[hit.instanceId];
        if (item) return { kind: "leaf", item, point: hit.point.clone() };
      } else if (fruitGroup) {
        const item = fruitGroup.items[hit.instanceId];
        if (item) return { kind: "fruit", item, point: hit.point.clone() };
      }
    }
    return this.pickNearest(clientX, clientY, tolerancePx);
  }

  /** 屏幕就近拾取（只考虑当前已出现的节点） */
  private pickNearest(clientX: number, clientY: number, maxPx: number): NodeHit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    let bestScore = Infinity;
    let best: NodeHit | null = null;

    const project = (pos: readonly number[]): { x: number; y: number } | null => {
      this.tmpVec.set(pos[0], pos[1], pos[2]).project(this.camera);
      if (this.tmpVec.z > 1) return null; // 相机背后
      const x = rect.left + ((this.tmpVec.x + 1) / 2) * rect.width;
      const y = rect.top + ((-this.tmpVec.y + 1) / 2) * rect.height;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
      return { x, y };
    };

    const consider = (kind: "leaf" | "fruit", item: SceneLeaf | SceneFruit, weight: number) => {
      const p = project(item.pos);
      if (!p) return;
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d > maxPx) return;
      const score = d * weight;
      if (score < bestScore) {
        bestScore = score;
        best =
          kind === "leaf"
            ? { kind: "leaf", item: item as SceneLeaf, point: new THREE.Vector3(...item.pos) }
            : { kind: "fruit", item: item as SceneFruit, point: new THREE.Vector3(...item.pos) };
      }
    };

    for (const group of this.leafGroups) {
      for (const leaf of group.items) {
        if (this.lastT < leaf.birth) continue; // 尚未长出
        if (leaf.fallAt !== undefined && this.lastT > leaf.fallAt + FALL_DURATION) continue; // 已落尽
        consider("leaf", leaf, 1);
      }
    }
    for (const group of this.fruitGroups) {
      for (const fruit of group.items) {
        if (this.lastT < fruit.birth) continue;
        consider("fruit", fruit, 0.9); // 果实体积更大，同距离优先
      }
    }
    return best;
  }

  /** 按 key（leaf-/fruit- 前缀的 id）查找节点世界坐标 */
  getNodeById(key: string): NodeHit | null {
    for (const group of this.leafGroups) {
      const item = group.items.find((l) => l.id === key);
      if (item) return { kind: "leaf", item, point: new THREE.Vector3(...item.pos) };
    }
    for (const group of this.fruitGroups) {
      const item = group.items.find((f) => f.id === key);
      if (item) return { kind: "fruit", item, point: new THREE.Vector3(...item.pos) };
    }
    return null;
  }

  /** 节点世界坐标 → 屏幕坐标（测试点击用） */
  nodeScreenPos(key: string): { x: number; y: number } | null {
    const hit = this.getNodeById(key);
    if (!hit) return null;
    const v = hit.point.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((-v.y + 1) / 2) * rect.height,
    };
  }

  /** 枚举前 n 个叶子 key（测试用） */
  sampleLeafKeys(n = 5): string[] {
    const out: string[] = [];
    for (const group of this.leafGroups) {
      for (const item of group.items) {
        out.push(item.id);
        if (out.length >= n) return out;
      }
    }
    return out;
  }

  /** 枚举前 n 个果实 key（测试用） */
  sampleFruitKeys(n = 5): string[] {
    const out: string[] = [];
    for (const group of this.fruitGroups) {
      for (const item of group.items) {
        out.push(item.id);
        if (out.length >= n) return out;
      }
    }
    return out;
  }

  /** hover 高亮：增亮对应实例颜色 */
  setHover(hit: NodeHit | null): void {
    const key = hit ? hit.item.id : null;
    if (key === this.hoveredKey) return;
    this.applyColor(this.hoveredKey, false);
    this.hoveredKey = key;
    this.applyColor(key, true);
  }

  private applyColor(key: string | null, highlight: boolean): void {
    if (!key) return;
    // 仅叶子用实例颜色做高亮；果实的颜色来自材质与顶点色，改用放大高亮（见 updateTree）
    for (const group of this.leafGroups) {
      const idx = group.items.findIndex((it) => it.id === key);
      if (idx < 0) continue;
      const base = group.baseColors[idx];
      const c = highlight ? base.clone().lerp(new THREE.Color(0xffffff), 0.55) : base;
      group.mesh.setColorAt(idx, c);
      if (group.mesh.instanceColor) group.mesh.instanceColor.needsUpdate = true;
      return;
    }
  }

  /** 选中节点（光环标记） */
  setSelected(key: string | null): void {
    this.selectedKey = key;
    if (this.selectionMarker) this.selectionMarker.visible = key !== null;
  }

  /** 画布像素统计（端到端测试用，读 WebGL 绘制缓冲） */
  sampleCanvas(): { w: number; h: number; nonBgRatio: number; distinctColors: number } {
    this.renderer.render(this.scene, this.camera);
    const canvas = this.renderer.domElement;
    const gl = this.renderer.getContext();
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return { w, h, nonBgRatio: 0, distinctColors: 0 };
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBg = 0;
    let total = 0;
    const colors = new Set<string>();
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        total++;
        // 背景色 #0a0e27 附近
        if (!(r < 45 && g < 55 && b < 80)) nonBg++;
        colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
      }
    }
    return { w, h, nonBgRatio: nonBg / Math.max(1, total), distinctColors: colors.size };
  }

  /** PNG 截图数据（纪念卡导出用） */
  snapshotDataURL(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** 供视频导出捕获流 */
  captureCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** 尺寸变化 */
  resize(width: number, height: number, dpr?: number): void {
    if (dpr) this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    // 首帧拿到真实画幅后重新取景，避免默认 16/9 估算导致裁切
    if (this.needsFrame) {
      this.needsFrame = false;
      this.frameScene();
    }
  }

  /** 场景统计（调试/测试钩子） */
  stats(): { segments: number; branches: number; leaves: number; fruits: number; trees: number } {
    return {
      segments: this.scene3d?.segments.length ?? 0,
      branches: this.scene3d?.branches.length ?? 0,
      leaves: this.scene3d?.leaves.length ?? 0,
      fruits: this.scene3d?.fruits.length ?? 0,
      trees: this.forest.length,
    };
  }

  /** 每棵树的树冠锚点（世界坐标），HTML 名牌用 */
  treeAnchors(): Array<{ x: number; y: number; z: number; index: number }> {
    return this.forest.map((t) => ({
      index: t.index,
      x: t.x,
      y: t.height * 1.02 + 40,
      z: t.z,
    }));
  }

  /** 世界坐标 → 画布内像素坐标（不可见时 visible=false） */
  projectToScreen(point: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    visible: boolean;
  } {
    const v = this.tmpVec.set(point.x, point.y, point.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
      visible: v.z > -1 && v.z < 1,
    };
  }
}

/** 形状 → 单位几何（半径约 0.5，实例矩阵再缩放） */
/** 给几何体刷上统一顶点色（与实例色相乘时作为「部件固有色」） */
function paintGeometry(geo: THREE.BufferGeometry, color: [number, number, number]): THREE.BufferGeometry {
  const count = geo.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color[0];
    arr[i * 3 + 1] = color[1];
    arr[i * 3 + 2] = color[2];
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * 真实叶片：用 Shape 贝塞尔曲线勾出叶形（基部渐窄 → 中部最宽 → 叶尖收拢），
 * 再挤出 5% 叶长的厚度并沿中脉上拱，避免「一片平板」的塑料感。
 * 几何以叶心为原点，叶长沿 Y，厚度沿 Z（渲染时旋到水平）。
 */
function makeLeafGeometry(width: number, curl = 0.16): THREE.BufferGeometry {
  const w = width * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.5); // 叶柄端
  shape.bezierCurveTo(w * 0.55, -0.34, w, -0.05, w * 0.92, 0.22);
  shape.bezierCurveTo(w * 0.78, 0.42, w * 0.34, 0.5, 0, 0.54); // 叶尖
  shape.bezierCurveTo(-w * 0.34, 0.5, -w * 0.78, 0.42, -w * 0.92, 0.22);
  shape.bezierCurveTo(-w, -0.05, -w * 0.55, -0.34, 0, -0.5);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.02,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 5,
  });
  geo.center();

  // 叶面上拱 + 叶尖略垂，叶缘比中脉低 → 有厚度的真叶观感
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const edge = Math.min(1, Math.abs(x) / Math.max(1e-4, w));
    pos.setZ(i, pos.getZ(i) + curl * (1 - edge) * 0.12 - Math.abs(y) * 0.05);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * 苹果：压扁的球体 + 顶部果脐凹陷 + 深色果柄。
 * 果身顶点色为白（由材质决定红/金/紫），果柄顶点色深褐。
 */
function makeAppleGeometry(scale = 1): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 16, 12);
  const pos = body.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.3) {
      // 果脐：顶部向内凹
      const k = Math.min(1, (y - 0.3) / 0.2);
      pos.setY(i, y - k * 0.1);
    } else if (y < -0.32) {
      // 底部略微收平
      const k = Math.min(1, (-0.32 - y) / 0.18);
      pos.setY(i, y + k * 0.05);
    }
  }
  pos.needsUpdate = true;
  body.scale(1, 0.93, 1);
  body.computeVertexNormals();
  paintGeometry(body, [1, 1, 1]);

  const stem = new THREE.CylinderGeometry(0.022, 0.045, 0.4, 6);
  stem.translate(0, 0.42, 0);
  stem.rotateZ(0.14);
  paintGeometry(stem, [0.16, 0.12, 0.1]);

  const merged = mergeGeometries([body, stem]) || body;
  if (scale !== 1) merged.scale(scale, scale, scale);
  return merged;
}

function leafGeometry(shape: string): THREE.BufferGeometry | null {
  switch (shape) {
    case "circle":
      return makeLeafGeometry(0.78);
    case "pointed":
      return makeLeafGeometry(0.52, 0.2);
    case "long":
      return makeLeafGeometry(0.34, 0.22);
    case "small":
      return makeLeafGeometry(0.6);
    case "tiny":
      return makeLeafGeometry(0.66);
    case "withered": {
      // 枯萎叶：更窄、更卷
      const g = makeLeafGeometry(0.46, 0.46);
      g.rotateZ(0.45);
      return g;
    }
    case "triple": {
      // 三出复叶：三片小叶共柄
      const angles = [-0.55, 0, 0.55];
      const parts = angles.map((a) => {
        const l = makeLeafGeometry(0.42, 0.18);
        l.scale(0.7, 0.7, 0.7);
        l.rotateZ(a);
        l.translate(Math.sin(a) * 0.2, 0.3, 0);
        return l;
      });
      return mergeGeometries(parts) || makeLeafGeometry(0.5);
    }
    case "purple": {
      // 五瓣小花（spec:/hook: 提交）
      const petals = Array.from({ length: 5 }, (_, i) => {
        const p = makeLeafGeometry(0.5, 0.1);
        p.scale(0.4, 0.4, 0.4);
        p.rotateZ((i / 5) * Math.PI * 2);
        p.translate(Math.cos((i / 5) * Math.PI * 2) * 0.06, Math.sin((i / 5) * Math.PI * 2) * 0.06, 0);
        return p;
      });
      return mergeGeometries(petals) || makeLeafGeometry(0.5);
    }
    default:
      return null;
  }
}

/** 径向渐变贴图（地面光晕） */
function makeRadialTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(78, 205, 196, 0.22)");
  grad.addColorStop(0.55, "rgba(78, 205, 196, 0.07)");
  grad.addColorStop(1, "rgba(78, 205, 196, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
