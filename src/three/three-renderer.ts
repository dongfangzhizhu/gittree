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
import { ThreeScene, SceneSegment, SceneLeaf, SceneFruit } from "./scene-types";

/** 叶子调色板（索引 12 = 紫色，spec:/hook: 提交；与二维版一致） */
const LEAF_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
  "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#82E0AA",
  "#F1948A", "#D7DBDD", "#9B59B6",
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
const LEAF_SCALE = 8;
const FRUIT_SCALE = 5.5;

export type ViewName = "overview" | "side" | "top" | "root";

interface SegmentEntry {
  seg: SceneSegment;
  mesh: THREE.Mesh;
  /** 单位方向 */
  dir: THREE.Vector3;
  len: number;
  /** graft 用： TubeGeometry 的环数 */
  rings?: number;
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
  private segmentEntries: SegmentEntry[] = [];
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
  private tmpVec = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private upVector = new THREE.Vector3(0, 1, 0);

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

    this.setupLights();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x0a0e27, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
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
    if (!scene || scene.segments.length === 0) return;

    this.buildGround(scene.radius);
    this.buildStars();
    this.buildSegments(scene);
    this.buildLeaves(scene);
    this.buildFruits(scene);
    this.buildSelectionMarker();

    // 初始取景：由场景尺度推导的默认机位
    const target = new THREE.Vector3(0, scene.height * 0.42, 0);
    this.controls.target.copy(target);
    const dist = scene.radius * 1.35 + 320;
    this.camera.position.set(dist * 0.72, scene.height * 0.95, dist * 0.72);
    this.camAnim = null;
    this.controls.update();
  }

  private clearScene(): void {
    for (const entry of this.segmentEntries) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.segmentEntries = [];
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
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.75,
      fog: false,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  /** 枝干：每段一个锥形圆柱（保留 w0→w1 锥度）；嫁接弧用 TubeGeometry + drawRange 生长 */
  private buildSegments(scene: ThreeScene): void {
    for (const seg of scene.segments) {
      if (seg.kind === "graft") {
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
        const geo = new THREE.TubeGeometry(curve, rings, 1.6, 6, false);
        const mat = new THREE.MeshStandardMaterial({ color: GRAFT_COLOR, roughness: 0.95 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.segmentEntries.push({
          seg,
          mesh,
          dir: new THREE.Vector3(),
          len: 1,
          rings,
        });
        continue;
      }

      const dir = new THREE.Vector3(...seg.p1).sub(new THREE.Vector3(...seg.p0));
      const len = dir.length() || 0.001;
      dir.normalize();

      // 单位高度圆柱，底部（w0）在原点，顶部（w1）在 +1
      const geo = new THREE.CylinderGeometry(seg.w1, seg.w0, 1, 7, 1, false);
      geo.translate(0, 0.5, 0);
      const color = seg.kind === "trunk" ? TRUNK_COLOR : BRANCH_COLOR;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.segmentEntries.push({ seg, mesh, dir, len });
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
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0 });
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
        geo = new THREE.OctahedronGeometry(1.0, 0);
        color = GOLD;
        emissive = 0x6b5200;
      } else if (kind === "normal") {
        geo = new THREE.SphereGeometry(0.5, 8, 6);
        color = GOLD;
        emissive = 0x554400;
      } else {
        geo = new THREE.TetrahedronGeometry(0.6, 0);
        color = 0x9b59b6;
        emissive = 0x3d1d56;
      }
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.55,
        roughness: 0.4,
        metalness: 0.2,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const baseColors: THREE.Color[] = [];
      for (let i = 0; i < items.length; i++) {
        const c = new THREE.Color(color);
        baseColors.push(c);
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

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

    // 枝干生长
    for (const entry of this.segmentEntries) {
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

      if (entry.seg.kind === "graft" && entry.rings) {
        // TubeGeometry 顶点按环排列：每环 (radialSegments+1)=7 个顶点
        const perRing = 7;
        const rings = Math.max(1, Math.ceil(progress * entry.rings));
        entry.mesh.geometry.setDrawRange(0, rings * perRing);
        continue;
      }

      const len = entry.len * progress;
      entry.mesh.scale.set(1, len, 1);
      this.tmpVec.copy(entry.dir).multiplyScalar(len / 2).add(new THREE.Vector3(...entry.seg.p0));
      entry.mesh.position.copy(this.tmpVec);
      this.tmpQuat.setFromUnitVectors(this.upVector, entry.dir);
      entry.mesh.quaternion.copy(this.tmpQuat);
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

        // 风动：呼吸 + 自转（t 的确定性函数）
        s *= 1 + Math.sin(t * Math.PI * 2 * 2 + leaf.phase) * 0.06;
        const angle = t * 0.6 + leaf.phase;
        this.tmpQuat.setFromAxisAngle(new THREE.Vector3(...leaf.axis), angle);

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
        const s = fruit.size * FRUIT_SCALE * (0.7 + 0.3 * fade) * (1 + Math.sin(t * Math.PI * 2 * 2 + i) * 0.06);
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
  }

  /** 视角预设 */
  setView(name: ViewName): void {
    const scene = this.scene3d;
    if (!scene) return;
    const h = scene.height;
    const r = scene.radius;
    let to: THREE.Vector3;
    let target: THREE.Vector3;
    switch (name) {
      case "side":
        to = new THREE.Vector3(r * 2.2 + 320, h * 0.55, r * 0.12 + 40);
        target = new THREE.Vector3(0, h * 0.5, 0);
        break;
      case "top":
        to = new THREE.Vector3(0.01, h + 900, 0.01);
        target = new THREE.Vector3(0, h * 0.3, 0);
        break;
      case "root":
        to = new THREE.Vector3(r * 0.8 + 180, 170, r * 0.8 + 180);
        target = new THREE.Vector3(0, h * 0.16, 0);
        break;
      case "overview":
      default:
        to = new THREE.Vector3(r * 1.35 + 320, h * 0.95, r * 1.35 + 320);
        target = new THREE.Vector3(0, h * 0.42, 0);
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
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  /**
   * 射线拾取：屏幕坐标 → 叶子/果实节点
   */
  pick(clientX: number, clientY: number): NodeHit | null {
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
    return null;
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
    for (const group of [...this.leafGroups, ...this.fruitGroups]) {
      const items = "items" in group ? group.items : [];
      const idx = items.findIndex((it) => it.id === key);
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
  }

  /** 场景统计（调试/测试钩子） */
  stats(): { segments: number; leaves: number; fruits: number } {
    return {
      segments: this.scene3d?.segments.length ?? 0,
      leaves: this.scene3d?.leaves.length ?? 0,
      fruits: this.scene3d?.fruits.length ?? 0,
    };
  }
}

/** 形状 → 单位几何（半径约 0.5，实例矩阵再缩放） */
function leafGeometry(shape: string): THREE.BufferGeometry | null {
  switch (shape) {
    case "circle":
      return new THREE.SphereGeometry(0.5, 8, 6);
    case "pointed":
      return new THREE.ConeGeometry(0.5, 1.1, 6);
    case "long": {
      const g = new THREE.CapsuleGeometry(0.32, 0.9, 3, 6);
      g.rotateZ(Math.PI / 2);
      return g;
    }
    case "triple": {
      const a = new THREE.SphereGeometry(0.3, 6, 5);
      a.translate(-0.45, 0, 0);
      const b = new THREE.SphereGeometry(0.3, 6, 5);
      b.translate(0.45, 0, 0);
      const c = new THREE.SphereGeometry(0.3, 6, 5);
      c.translate(0, 0.45, 0);
      return mergeGeometries([a, b, c]) || new THREE.SphereGeometry(0.4, 6, 5);
    }
    case "small":
      return new THREE.SphereGeometry(0.4, 6, 5);
    case "tiny":
      return new THREE.SphereGeometry(0.28, 6, 5);
    case "withered": {
      const g = new THREE.SphereGeometry(0.45, 6, 5);
      g.scale(1, 1, 0.45);
      return g;
    }
    case "purple":
      return new THREE.IcosahedronGeometry(0.5, 0);
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
