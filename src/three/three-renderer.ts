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
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ThreeScene, SceneSegment, SceneLeaf, SceneFruit, SceneBranch } from "./scene-types";
import type { QualityLevel } from "../core/perf-monitor";
import { buildBranchGeometry, visibleRingCount } from "./branch-geometry";
import type { ForestScene, ForestTreeMeta } from "./forest-builder";

/** 叶子调色板（索引 12 = 紫色，spec:/hook: 提交；与二维版一致） */
const LEAF_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
  "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#82E0AA",
  "#F1948A", "#63A06E", "#9B59B6",
];
const WITHERED_COLOR = "#8d6e63";
const TRUNK_COLOR = 0x4f7d5a;
const BRANCH_COLOR = 0x6a9c73;
/** 细分枝：更浅更亮，与主干分出层次（ez-tree 里细枝受光更多） */
const TWIG_COLOR = 0x86b98f;
const GRAFT_COLOR = 0x8fae7d;
const GOLD = 0xffd700;
const BG_COLOR = 0x0a0e27;

/** 落叶持续时间（动画时间单位，与二维版一致） */
const FALL_DURATION = 0.06;

/**
 * 节点视觉缩放：场景以「树高 ≈ 820 世界单位」构图，
 * 叶/果的基础半径只有 0.3–1.6 单位，直接渲染不足 1px。
 * 放大到肉眼可见、可点击的尺寸（直径约 8–26 单位）。
 */
const LEAF_SCALE = 13;
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

/** 画质档位：供低帧率自动降级使用（定义在 core/perf-monitor，此处复用） */
export type { QualityLevel };

export interface TreeRendererOptions {
  dpr?: number;
  /** 初始画质档位（默认 high：泛光 + 高 DPR） */
  quality?: QualityLevel;
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
  private sky: THREE.Mesh | null = null;
  private fireflies: THREE.Points | null = null;
  private selectionMarker: THREE.Mesh | null = null;
  /** 程序化树皮纹理（全场景共用一份，切换场景不重建）：颜色 + 法线 */
  private barkTexture: THREE.Texture;
  private barkNormal: THREE.Texture;
  private hoveredKey: string | null = null;
  private selectedKey: string | null = null;

  /** 后期处理链：RenderPass → UnrealBloomPass → OutputPass（ACES 色调映射） */
  private composer: EffectComposer | null = null;
  /** 泛光开关（低帧率降级时关闭，直接走普通渲染） */
  private bloomEnabled = true;
  /** DPR 上限（降级时压低） */
  private dprCap = 2;
  /** 当前画质档位 */
  private quality: QualityLevel = "high";
  /**
   * 叶片抽稀步长（ez-tree 的 leafStride）：1 = 全画，2 = 隔一片画一片。
   * 森林模式叶片可达上万片，低端机靠这个把顶点/填充开销砍半。
   */
  private leafStride = 1;

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
      // 优先独显：泛光 + 阴影对 GPU 有压力，尽量拿高性能适配器
      powerPreference: "high-performance",
    });
    this.quality = options.quality ?? "high";
    this.applyQualityProfile(this.quality);
    this.renderer.setPixelRatio(this.effectivePixelRatio(options.dpr ?? window.devicePixelRatio ?? 1));
    this.renderer.setClearColor(BG_COLOR, 1);
    // ACES 电影级色调映射：让高光（果实自发光、萤火虫）过曝得更自然，
    // 与 OutputPass 配合后 bloom 不会把画面推成一片死白
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    // 树皮纹理：程序化生成，无需外部贴图资源（ez-tree 改为外置贴图，
    // 但本项目要零依赖离线运行，所以用 canvas 现场画一套纤维+裂纹，并由灰度推导法线）
    const bark = makeBarkTextures();
    this.barkTexture = bark.color;
    this.barkNormal = bark.normal;

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

  /** 画质档位 → 泛光/DPR 上限/叶片抽稀 */
  private applyQualityProfile(level: QualityLevel): void {
    switch (level) {
      case "high":
        this.bloomEnabled = true;
        this.dprCap = 2;
        this.leafStride = 1;
        break;
      case "medium":
        this.bloomEnabled = true;
        this.dprCap = 1.25;
        this.leafStride = 1;
        break;
      case "low":
      default:
        this.bloomEnabled = false;
        this.dprCap = 1;
        this.leafStride = 2;
        break;
    }
  }

  /** 实际生效的像素比（不超过档位上限） */
  private effectivePixelRatio(requested: number): number {
    return Math.max(0.5, Math.min(requested, this.dprCap));
  }

  /**
   * 切换画质档位（性能自适应降级用）。
   * 关闭泛光时直接走普通渲染路径，省掉一整条全屏后处理链。
   */
  setQuality(level: QualityLevel): void {
    this.quality = level;
    this.applyQualityProfile(level);
    const raw = window.devicePixelRatio ?? 1;
    this.renderer.setPixelRatio(this.effectivePixelRatio(raw));
    if (this.composer) this.composer.setPixelRatio(this.effectivePixelRatio(raw));
    if (this.fireflies) {
      (this.fireflies.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value =
        this.effectivePixelRatio(raw);
    }
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (w > 0 && h > 0) this.resize(w, h);
    // 抽稀步长影响叶片可见性：暂停状态下也要立刻重绘，否则切档「没反应」
    this.updateTree(this.lastT);
  }

  /** 当前画质档位 */
  getQuality(): QualityLevel {
    return this.quality;
  }

  /** 泛光是否开启 */
  isBloomEnabled(): boolean {
    return this.bloomEnabled;
  }

  /** 单独开关泛光（UI 上可做成「光效」开关） */
  setBloomEnabled(on: boolean): void {
    this.bloomEnabled = on;
  }

  /** 懒初始化后期处理链（要等拿到真实画幅，避免按 16/9 估算分配缓冲） */
  private ensureComposer(): EffectComposer | null {
    if (!this.bloomEnabled) return null;
    if (this.composer) return this.composer;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x <= 0 || size.y <= 0) return null;
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.62, // strength：只给自发光果实/萤火虫加柔光，不让整棵树发毛
      0.72, // radius：光晕扩散范围
      0.68, // threshold：只有明显亮于环境的像素才 bloom
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    return composer;
  }

  private setupLights(): void {
    // 环境光兜底：ACES 色调映射会把暗部压得很死，没有 ambient 时背光面纯黑
    const ambient = new THREE.AmbientLight(0x93a8cc, 0.45);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x16223a, 0.8);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
    sun.position.set(700, 1400, 500);
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x4ecdc4, 0.55);
    rim.position.set(-600, 300, -500);
    this.scene.add(rim);

    // 树冠附近的暖色点光：让果实与叶片有「逆光通透感」
    const warm = new THREE.PointLight(0xffc98a, 0.7, 2600, 1.6);
    warm.position.set(0, 520, 0);
    this.scene.add(warm);
  }

  /** 编译场景描述 → three 对象图 */
  setScene(scene: ThreeScene | null): void {
    this.clearScene();
    this.scene3d = scene;
    const forest = (scene as ForestScene | null)?.trees;
    this.forest = Array.isArray(forest) ? forest : [];
    if (!scene || scene.segments.length === 0) return;

    this.buildSky();
    this.buildGround(scene.radius);
    this.buildStars();
    this.buildFireflies(scene);
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
   * 在当前 fov 与画幅下装下整棵树（整片森林）所需的相机距离。
   * 树高 800+、宽 400+，用固定距离必然裁切，故按 fov 反算。
   * 森林里斜视时近处的树会被投影到画面下方，需要额外留边，否则树根出画。
   */
  private fitDistance(margin = 1.1): number {
    const s = this.scene3d;
    if (!s) return 1200;
    const extra = this.forest.length > 1 ? 1.22 : 1;
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * Math.max(0.55, this.camera.aspect);
    const halfH = Math.max(s.height * 0.55, 120);
    const halfW = Math.max(s.radius * 1.15, s.height * 0.2);
    return Math.max(halfH / tanV, halfW / tanH) * margin * extra;
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
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      (this.sky.material as THREE.Material).dispose();
      this.sky = null;
    }
    if (this.fireflies) {
      this.scene.remove(this.fireflies);
      this.fireflies.geometry.dispose();
      (this.fireflies.material as THREE.Material).dispose();
      this.fireflies = null;
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

  /**
   * 渐变天空球：天顶深靛蓝 → 地平线暖紫，配一道极淡的「朝阳」辉光。
   * 关掉雾（半径 5000 已超出雾区），否则会被雾成一片纯色。
   */
  private buildSky(): void {
    const geo = new THREE.SphereGeometry(5000, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x070a1e) },
        uMid: { value: new THREE.Color(0x1b2b5e) },
        uBottom: { value: new THREE.Color(0x3a2a5c) },
        uSunDir: { value: new THREE.Vector3(700, 1400, 500).normalize() },
        uSunColor: { value: new THREE.Color(0xffb27a) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uBottom;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vDir;

        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          // 天顶 → 地平线 → 地面以下
          vec3 col = mix(uMid, uTop, smoothstep(0.05, 0.75, h));
          col = mix(col, uBottom, smoothstep(0.05, -0.35, h));
          // 太阳方向的一抹暖光（贴近地平线更明显）
          float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          float halo = pow(sun, 6.0) * 0.34 + pow(sun, 64.0) * 0.5;
          col += uSunColor * halo * smoothstep(0.35, -0.15, h);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  /**
   * 年轮地纹 + 地面光晕（呼应「代码年轮」意象）。
   * 地面是一块 ShaderMaterial 圆盘：静态同心年轮 + 随生长进度外扩的能量脉冲带
   * + 有机噪点，边缘淡出融入雾色，看不见硬边。
   */
  private buildGround(radius: number): void {
    const group = new THREE.Group();
    const discR = Math.max(3000, radius * 6);

    const discGeo = new THREE.CircleGeometry(discR, 128);
    const discMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uRadius: { value: discR },
        uTime: { value: 0 },
        uTeal: { value: new THREE.Color(0x4ecdc4) },
        uViolet: { value: new THREE.Color(0x8e6fd0) },
        uBg: { value: new THREE.Color(BG_COLOR) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform float uRadius;
        uniform float uTime;
        uniform vec3 uTeal;
        uniform vec3 uViolet;
        uniform vec3 uBg;
        varying vec2 vPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        void main() {
          float r = length(vPos);
          float rn = r / uRadius;

          // 有机斑驳：两层噪点叠加，避免「纯数学圆环」的塑料感
          float mottle = noise(vPos * 0.02) * 0.6 + noise(vPos * 0.09) * 0.4;

          // 静态年轮（间距不均 + 噪点扰动 → 更像真实木材切面）
          float rings = 0.5 + 0.5 * sin(r * 0.11 + mottle * 1.6);
          rings *= 0.5 + 0.5 * sin(r * 0.031 + mottle * 0.7);

          // 生长脉冲：一条高斯亮带从树根向外扩（进度驱动）
          float front = uProgress * uRadius * 1.05;
          float band = exp(-pow((r - front) * 0.0032, 2.0));
          // 已长过的区域保留淡淡的余晖
          float afterglow = smoothstep(front + 900.0, front - 200.0, r) * 0.16;

          float edge = 1.0 - smoothstep(0.45, 1.0, rn);
          float alpha = edge * (0.075 + 0.045 * rings + 0.28 * band + afterglow);

          vec3 col = mix(uTeal, uViolet, clamp(rn * 1.3, 0.0, 1.0));
          col += uTeal * band * 0.55;
          // 边缘过渡到背景色，消除接缝
          col = mix(uBg, col, edge);

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -6;
    disc.renderOrder = -1;
    group.add(disc);

    // 树根处的一团柔光（径向贴图），给「起点」一个视觉焦点
    const glowTex = makeRadialTexture();
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(600, radius * 1.8), 64),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        fog: false,
      })
    );
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
    this.ground.userData.discMat = discMat;
    this.scene.add(group);
  }

  /**
   * 萤火虫：树冠周围缓慢游荡的加法混合光点。
   * 位置由 t 驱动（与生长进度绑定）→ 视频导出仍是确定性的，
   * 同时「生长」与「流萤」共用一条时间轴，看上去像树在吸引它们。
   */
  private buildFireflies(scene: ThreeScene): void {
    const count = 170;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    let state = hashString(scene.seed + ":fireflies");
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 140 + rand() * Math.max(260, scene.radius * 0.85);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 40 + rand() * scene.height * 0.92;
      positions[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const dpr = this.renderer.getPixelRatio();
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
        uWarm: { value: new THREE.Color(0xffe6a8) },
        uCool: { value: new THREE.Color(0x9ff5ea) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vTwinkle;
        varying float vSeed;
        void main() {
          float s = aSeed * 6.2831853;
          vec3 p = position;
          p.x += sin(uTime * 0.55 + s) * 30.0;
          p.y += sin(uTime * 0.85 + s * 1.7) * 16.0;
          p.z += cos(uTime * 0.48 + s * 1.3) * 30.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vTwinkle = 0.45 + 0.55 * sin(uTime * 2.3 + s * 3.1);
          vSeed = aSeed;
          gl_PointSize = (7.0 + 13.0 * aSeed) * uPixelRatio * (420.0 / max(1.0, -mv.z));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uWarm;
        uniform vec3 uCool;
        varying float vTwinkle;
        varying float vSeed;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d);
          if (r > 0.5) discard;
          float a = pow(smoothstep(0.5, 0.0, r), 2.2);
          vec3 col = mix(uWarm, uCool, vSeed);
          gl_FragColor = vec4(col, a * vTwinkle * 0.9);
        }
      `,
    });

    this.fireflies = new THREE.Points(geo, mat);
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
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
   * 彻底消除「多段圆柱拼接」的接缝与折痕。
   * 树皮用程序化生成的纤维纹理（UV 已按半径归一，粗细枝密度一致）。
   */
  private buildBranches(scene: ThreeScene): void {
    for (const branch of scene.branches) {
      const built = buildBranchGeometry(branch);
      if (built.ringCount === 0) continue;

      const color =
        branch.kind === "trunk" ? TRUNK_COLOR : branch.kind === "twig" ? TWIG_COLOR : BRANCH_COLOR;
      const mat = new THREE.MeshStandardMaterial({
        color,
        map: this.barkTexture,
        normalMap: this.barkNormal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: this.barkTexture,
        roughness: branch.kind === "twig" ? 0.88 : 0.95,
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
      const mat = new THREE.MeshStandardMaterial({
        color: GRAFT_COLOR,
        map: this.barkTexture,
        normalMap: this.barkNormal,
        roughness: 0.95,
        metalness: 0,
      });
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
        if (this.leafStride > 1 && i % this.leafStride !== 0) {
          // 低画质抽稀：整数量级地省掉一半叶片的顶点与填充
          this.tmpScale.set(0, 0, 0);
          this.tmpVec.set(leaf.pos[0], leaf.pos[1], leaf.pos[2]);
          this.tmpMatrix.compose(this.tmpVec, this.tmpQuat.identity(), this.tmpScale);
          mesh.setMatrixAt(i, this.tmpMatrix);
          continue;
        }
        if (t < leaf.birth) {
          this.tmpScale.set(0, 0, 0);
          this.tmpVec.set(leaf.pos[0], leaf.pos[1], leaf.pos[2]);
          this.tmpMatrix.compose(this.tmpVec, this.tmpQuat.identity(), this.tmpScale);
          mesh.setMatrixAt(i, this.tmpMatrix);
          continue;
        }

        let s = leaf.size * LEAF_SCALE * Math.min(1, (t - leaf.birth) / 0.08);
        let [x, y, z] = leaf.pos;

        if (leaf.fallAt !== undefined && t > leaf.fallAt) {
          const f = (t - leaf.fallAt) / FALL_DURATION;
          if (f >= 1) {
            this.tmpScale.set(0, 0, 0);
            this.tmpVec.set(x, y, z);
            this.tmpMatrix.compose(this.tmpVec, this.tmpQuat.identity(), this.tmpScale);
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

    this.updateAmbience(t);
  }

  /**
   * 驱动氛围元素：地面年轮脉冲随生长进度外扩，萤火虫随时间游荡。
   * 都用 t（动画时间）而不是墙钟时间，保证同一 t 画面完全一致（视频导出可复现）。
   */
  private updateAmbience(t: number): void {
    const discMat = this.ground?.userData.discMat as THREE.ShaderMaterial | undefined;
    if (discMat) {
      discMat.uniforms.uProgress.value = t;
      discMat.uniforms.uTime.value = t * 20;
    }
    if (this.fireflies) {
      (this.fireflies.material as THREE.ShaderMaterial).uniforms.uTime.value = t * 20;
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
    this.drawFrame();
    // 通知外部：三维画面已更新（HTML 名牌据此跟随投影位置）
    this.onAfterRender?.();
  }

  /**
   * 真正出一帧：开启泛光时走 RenderPass → UnrealBloomPass → OutputPass 后处理链，
   * 否则直接渲染（省掉整条全屏链，低端机降级用）。
   */
  private drawFrame(): void {
    // 手动重置统计：走 composer 时每个 pass 都会 render 一次，
    // 自动重置会让 info 只剩最后一个全屏 quad 的数据（1 call / 1 triangle）
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    const composer = this.bloomEnabled ? this.ensureComposer() : null;
    if (composer) {
      composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
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
      for (let i = 0; i < group.items.length; i++) {
        const leaf = group.items[i];
        if (this.leafStride > 1 && i % this.leafStride !== 0) continue; // 抽稀掉的不可点
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

  /**
   * 枚举 n 个叶子 key（测试用）。
   * 按全量均匀取样而不是「取前 n 个」——森林里第一棵树的叶子可能就上万片，
   * 取前 n 个会永远只落在第 0 棵树上。
   */
  sampleLeafKeys(n = 5): string[] {
    const all: string[] = [];
    for (const group of this.leafGroups) {
      for (const item of group.items) all.push(item.id);
    }
    return evenSample(all, n);
  }

  /** 枚举 n 个果实 key（测试用，取样规则同上） */
  sampleFruitKeys(n = 5): string[] {
    const all: string[] = [];
    for (const group of this.fruitGroups) {
      for (const item of group.items) all.push(item.id);
    }
    return evenSample(all, n);
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

  /**
   * 画布像素统计（端到端测试用，读 WebGL 绘制缓冲）。
   * - nonBgRatio / greenRatio：全量扫描的粗指标
   * - sig：40×23 降采样签名（每格 3 个分量），供测试比较两帧画面差异——
   *   有了渐变天空球后「非背景占比」恒接近 100%，只能靠逐格比对判断树长了多少
   */
  sampleCanvas(): {
    w: number;
    h: number;
    nonBgRatio: number;
    distinctColors: number;
    greenRatio: number;
    sig: number[];
  } {
    this.drawFrame();
    const canvas = this.renderer.domElement;
    const gl = this.renderer.getContext();
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) {
      return { w, h, nonBgRatio: 0, distinctColors: 0, greenRatio: 0, sig: [] };
    }
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBg = 0;
    let green = 0;
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
        // 绿色主导：树皮/叶片/年轮地纹（天空是蓝紫，b 占优，不会误判）
        if (g > r + 10 && g > b + 10 && g > 40) green++;
        colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
      }
    }

    // 降采样签名：固定 40×23 网格，与画布实际像素尺寸无关
    const GW = 40;
    const GH = 23;
    const sig: number[] = [];
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const x = Math.min(w - 1, Math.floor(((gx + 0.5) / GW) * w));
        // WebGL 的 readPixels 原点在左下角，转成「从上到下」的直觉顺序
        const y = Math.min(h - 1, Math.floor((1 - (gy + 0.5) / GH) * h));
        const i = (y * w + x) * 4;
        sig.push(pixels[i], pixels[i + 1], pixels[i + 2]);
      }
    }

    return {
      w,
      h,
      nonBgRatio: nonBg / Math.max(1, total),
      distinctColors: colors.size,
      greenRatio: green / Math.max(1, total),
      sig,
    };
  }

  /** PNG 截图数据（纪念卡导出用） */
  snapshotDataURL(): string {
    this.drawFrame();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** 供视频导出捕获流 */
  captureCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** 尺寸变化 */
  resize(width: number, height: number, dpr?: number): void {
    const raw = dpr ?? window.devicePixelRatio ?? 1;
    this.renderer.setPixelRatio(this.effectivePixelRatio(raw));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (this.fireflies) {
      (this.fireflies.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value =
        this.renderer.getPixelRatio();
    }
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
    // 首帧拿到真实画幅后重新取景，避免默认 16/9 估算导致裁切
    if (this.needsFrame) {
      this.needsFrame = false;
      this.frameScene();
    }
  }

  /** 释放 GPU 资源（热更新/卸载时调用） */
  dispose(): void {
    this.clearScene();
    this.barkTexture.dispose();
    this.barkNormal.dispose();
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.renderer.dispose();
  }

  /** 场景统计（调试/测试钩子） */
  stats(): {
    segments: number;
    branches: number;
    leaves: number;
    fruits: number;
    trees: number;
    quality: QualityLevel;
    bloom: boolean;
  } {
    return {
      segments: this.scene3d?.segments.length ?? 0,
      branches: this.scene3d?.branches.length ?? 0,
      leaves: this.scene3d?.leaves.length ?? 0,
      fruits: this.scene3d?.fruits.length ?? 0,
      trees: this.forest.length,
      quality: this.quality,
      bloom: this.bloomEnabled,
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
  grad.addColorStop(0, "rgba(78, 205, 196, 0.14)");
  grad.addColorStop(0.55, "rgba(78, 205, 196, 0.045)");
  grad.addColorStop(1, "rgba(78, 205, 196, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * 程序化树皮纹理（canvas 现场画，零外部资源）：
 * - 纵向纤维：大量 1px 宽的深浅竖条，模拟树皮的纹理走向
 * - 横向皮孔/裂纹：随机短横线，打断纯纵向的呆板感
 * - 噪点：细颗粒，避免「塑料平滑」
 * 同时当 roughnessMap 用（亮处更粗糙），所以明暗也影响光泽。
 * 返回颜色贴图 + 由亮度梯度推导的法线贴图（让树皮真的有起伏）。
 */
function makeBarkTextures(): { color: THREE.Texture; normal: THREE.Texture } {
  const W = 256;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // 底色：中性偏亮灰（最终颜色由材质 color 决定，贴图只提供明暗/粗糙变化）
  ctx.fillStyle = "#ddd7cb";
  ctx.fillRect(0, 0, W, H);

  // 纵向纤维
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * W;
    const w = 0.6 + Math.random() * 2.2;
    const dark = Math.random();
    const alpha = 0.08 + Math.random() * 0.3;
    ctx.fillStyle =
      dark > 0.55 ? `rgba(40,32,24,${alpha})` : `rgba(240,235,224,${alpha * 0.8})`;
    // 纤维略带倾斜，沿高度方向有轻微漂移
    const drift = Math.sin((x / W) * Math.PI * 3) * 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + drift, H);
    ctx.lineTo(x + drift + w, H);
    ctx.lineTo(x + w, 0);
    ctx.closePath();
    ctx.fill();
  }

  // 皮孔 / 横向裂纹
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 3 + Math.random() * 22;
    const alpha = 0.08 + Math.random() * 0.26;
    ctx.strokeStyle = `rgba(38,30,22,${alpha})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }

  // 细噪点
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const color = new THREE.CanvasTexture(canvas);
  color.wrapS = THREE.RepeatWrapping;
  color.wrapT = THREE.RepeatWrapping;
  color.colorSpace = THREE.SRGBColorSpace;

  return { color, normal: makeNormalFromLuminance(canvas, 3.4) };
}

/**
 * 由灰度图推导切线空间法线贴图：亮度当高度，中心差分求梯度。
 * 采样做环绕（不是 clamp），保证贴图可无缝平铺。
 */
function makeNormalFromLuminance(source: HTMLCanvasElement, strength: number): THREE.Texture {
  const W = source.width;
  const H = source.height;
  const src = source.getContext("2d")!.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
  }
  const at = (x: number, y: number) => lum[((y + H) % H) * W + ((x + W) % W)];

  const out = ctx2d(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * W + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    }
  }
  const tex = new THREE.CanvasTexture(canvasFrom(out, W, H));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function ctx2d(w: number, h: number): ImageData {
  return new ImageData(w, h);
}

function canvasFrom(img: ImageData, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

function easeInOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** 从数组里均匀取 n 个（n >= 长度时全给） */
function evenSample<T>(all: T[], n: number): T[] {
  if (n <= 0) return [];
  if (all.length <= n) return all.slice();
  const step = all.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(all[Math.min(all.length - 1, Math.floor(i * step))]);
  }
  return out;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
