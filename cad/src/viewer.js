import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { stoneGeometry } from "./gems.js";
import { stoneMatrix, shankThicknessAt } from "./build.js";
import { bakeGeometry, to3mf } from "./export.js";
import { METALS } from "./script.js";

const GEM_COLOR = { centre: "#f4fbff", halo: "#eaf6ff", halo2: "#eaf6ff", pave: "#eaf6ff", accent: "#f0f7ff", stroke: "#eaf6ff", region: "#eaf6ff" };
const VIEWS = {
  iso: [26, 22, 38],
  top: [0, 60, 0.001],
  front: [0, 4, 60],
  right: [60, 4, 0],
};

// Heat colour for a wall thickness against the minimum: red under, amber near, green fine.
export function heatColor(t, min) {
  const c = new THREE.Color();
  if (t < min) return c.set("#d93025");
  const k = Math.min(1, (t - min) / Math.max(min, 0.3));
  return c.set("#f2a900").lerp(new THREE.Color("#1e8e3e"), k);
}

function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color("#8b919b");
  for (const [x, y, z, sx, sy] of [[0, 8, 0, 10, 10], [10, 2, 6, 6, 8], [-10, 2, -4, 6, 8], [0, 3, -12, 14, 4]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    env.add(panel);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.04).texture;
  pm.dispose();
  return tex;
}

function addLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(20, 30, 25);
  const rim = new THREE.DirectionalLight(0xffeedd, 1.4);
  rim.position.set(-25, 10, -20);
  scene.add(key, rim);
}

// Meshes for a model. mode: shaded | translucent | edges | heat | flat
export function modelObjects(model, { mode = "shaded", highlight = null, stoneCache } = {}) {
  const group = new THREE.Group();
  const d = model.design;
  const metalColor = METALS[d.ring.metal].color;
  const cache = stoneCache || new Map();
  const geoFor = (cut, dia) => {
    const k = `${cut}|${dia}`;
    if (!cache.has(k)) cache.set(k, stoneGeometry(cut, dia));
    return cache.get(k);
  };
  for (const part of model.metal) {
    let mat;
    let geometry = part.geometry;
    if (mode === "heat") {
      geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      const p = geometry.attributes.position;
      const colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const t = part.name === "shank" ? shankThicknessAt(d, model.geom, p.getZ(i)) : part.thickness ?? (part.bead ? Infinity : Infinity);
        const c = Number.isFinite(t) ? heatColor(t, d.rule.min_wall) : new THREE.Color("#9aa0a6");
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
    } else if (mode === "flat") {
      mat = new THREE.MeshBasicMaterial({ color: metalColor });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: metalColor, metalness: 1, roughness: 0.22, side: THREE.DoubleSide,
        transparent: mode === "translucent", opacity: mode === "translucent" ? 0.3 : 1, depthWrite: mode !== "translucent",
      });
    }
    if (highlight && part.obj === highlight) mat.emissive?.set("#1f6feb"), mat.emissiveIntensity !== undefined && (mat.emissiveIntensity = 0.35);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = part.name;
    mesh.userData = { obj: part.obj, kind: "metal" };
    if (mode === "edges") {
      mesh.material.visible = false;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(part.geometry, 25), new THREE.LineBasicMaterial({ color: "#3c4043" }));
      group.add(lines);
    }
    group.add(mesh);
  }
  const groups = new Map();
  for (const s of model.stones) {
    const k = `${s.role}|${s.cut}|${s.dia}|${s.obj === highlight}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(s);
  }
  for (const list of groups.values()) {
    const hl = list[0].obj === highlight && highlight;
    const mat = mode === "flat"
      ? new THREE.MeshBasicMaterial({ color: "#cfe8ff" })
      : new THREE.MeshPhysicalMaterial({ color: hl ? "#8ab4f8" : GEM_COLOR[list[0].role] || "#eaf6ff", metalness: 0, roughness: 0.04, transmission: 0.5, thickness: 0.5, ior: 2.4, flatShading: true });
    const im = new THREE.InstancedMesh(geoFor(list[0].cut, list[0].dia), mat, list.length);
    list.forEach((s, i) => im.setMatrixAt(i, stoneMatrix(s)));
    im.userData = { obj: list[0].obj, kind: "stones" };
    if (mode === "edges") {
      mat.visible = false;
      const lg = new THREE.EdgesGeometry(geoFor(list[0].cut, list[0].dia), 20);
      for (const s of list) {
        const l = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#1a73e8" }));
        l.applyMatrix4(stoneMatrix(s));
        group.add(l);
      }
    }
    group.add(im);
  }
  return group;
}

export function createViewer(container, handlers = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 500);
  camera.position.set(...VIEWS.iso);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  // keyboard: the canvas takes focus; arrow keys pan, +/- zoom (see keydown below)
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "3D view. Arrow keys pan, plus and minus zoom, F fits the design.");
  controls.listenToKeyEvents(renderer.domElement);
  controls.target.set(0, 4, 0);
  addLights(scene);
  scene.environment = makeEnvironment(renderer);

  // fixed orthographic cameras for the 4-view layout
  const ortho = {};
  for (const v of ["top", "front", "right"]) {
    const c = new THREE.OrthographicCamera(-16, 16, 16, -16, 0.1, 200);
    c.position.set(...VIEWS[v]);
    c.lookAt(0, 4, 0);
    ortho[v] = c;
  }

  const holder = new THREE.Group();
  scene.add(holder);
  const reference = new THREE.Group();
  scene.add(reference);
  const overlay = new THREE.Group();
  scene.add(overlay);
  const stoneCache = new Map();
  let model = null;
  let mode = "shaded";
  let highlight = null;
  let layout = 1;

  function redraw() {
    for (const o of [...holder.children]) {
      o.traverse((x) => x.material?.dispose?.());
      holder.remove(o);
    }
    if (model) holder.add(modelObjects(model, { mode, highlight, stoneCache }));
  }
  function setModel(m) {
    for (const g of stoneCache.values()) g.dispose();
    stoneCache.clear();
    model = m;
    redraw();
  }

  // ---- tools ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let tool = "orbit";
  let brushR = 2;
  let snap = 0;
  let wandSpan = 6;
  let down = false;
  let last = null;
  let path = [];
  let measureA = null;
  const brush = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0x1f6feb, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  brush.visible = false;
  brush.renderOrder = 10;
  scene.add(brush);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1f6feb, depthTest: false }));
  pathLine.renderOrder = 11;
  overlay.add(pathLine);

  const pick = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  // map a hit on the band's outer surface to (s, w)
  const hitBand = (e) => {
    pick(e);
    const shank = holder.getObjectByName("shank");
    if (!shank || !model) return null;
    const { ri, ro } = model.geom;
    const h = ray.intersectObject(shank, false).find((x) => Math.hypot(x.point.x, x.point.y) > (ri + ro) / 2);
    if (!h) return null;
    let s = Math.atan2(h.point.x, h.point.y) * ro;
    let w = h.point.z;
    if (snap > 0) {
      s = Math.round(s / snap) * snap;
      w = Math.round(w / snap) * snap;
    }
    return { s: +s.toFixed(2), w: +w.toFixed(2), point: h.point, normal: new THREE.Vector3(h.point.x, h.point.y, 0).normalize() };
  };
  const hitAny = (e) => {
    pick(e);
    return ray.intersectObjects(holder.children, true).find((x) => x.object.visible !== false)?.point || null;
  };
  const drawPath = () => {
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry().setFromPoints(path.map((p) => p.point.clone().addScaledVector(p.normal, 0.15)));
  };

  const dom = renderer.domElement;
  dom.addEventListener("pointermove", (e) => {
    if (tool === "orbit" || tool === "measure") return;
    const h = hitBand(e);
    brush.visible = !!h && tool === "paint";
    if (!h) return;
    brush.position.copy(h.point).addScaledVector(h.normal, 0.05);
    brush.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.normal);
    brush.scale.setScalar(brushR);
    if (!down) return;
    if (tool === "paint" && (!last || Math.hypot(h.s - last.s, h.w - last.w) > brushR * 0.7)) {
      // fill in dabs between pointer samples so a fast drag leaves no gaps
      const dabs = [];
      const from = last || h;
      const steps = last ? Math.max(1, Math.ceil(Math.hypot(h.s - from.s, h.w - from.w) / (brushR * 0.7))) : 1;
      for (let i = 1; i <= steps; i++) {
        const t = last ? i / steps : 1;
        dabs.push({ s: Math.round((from.s + (h.s - from.s) * t) * 10) / 10, w: Math.round((from.w + (h.w - from.w) * t) * 10) / 10, r: brushR });
      }
      last = h;
      handlers.onPaint?.(dabs);
    } else if ((tool === "stroke" || tool === "outline") && (!path.length || Math.hypot(h.s - path.at(-1).s, h.w - path.at(-1).w) > 0.8)) {
      path.push(h);
      drawPath();
    }
  });
  dom.addEventListener("pointerdown", (e) => {
    if (tool === "orbit") return;
    if (tool === "measure") {
      const p = hitAny(e);
      if (!p) return;
      if (!measureA) {
        measureA = p.clone();
        handlers.onMeasure?.({ a: measureA, b: null, mm: null });
      } else {
        handlers.onMeasure?.({ a: measureA, b: p.clone(), mm: measureA.distanceTo(p) });
        measureA = null;
      }
      return;
    }
    if (tool === "wand") {
      const h = hitBand(e);
      if (h) handlers.onWand?.({ s: h.s, span: wandSpan });
      return;
    }
    down = true;
    last = null;
    path = [];
    dom.setPointerCapture(e.pointerId);
    dom.dispatchEvent(new PointerEvent("pointermove", e));
  });
  const up = () => {
    if (!down) return;
    down = false;
    if (tool === "paint") handlers.onPaintEnd?.();
    if (tool === "stroke" && path.length >= 2) handlers.onStroke?.(path.map((p) => [p.s, p.w]));
    if (tool === "outline" && path.length >= 3) handlers.onOutline?.(path.map((p) => [p.s, p.w]));
    path = [];
    drawPath();
  };
  dom.addEventListener("pointerup", up);
  dom.addEventListener("pointercancel", up);
  dom.addEventListener("pointerleave", () => (brush.visible = false));
  dom.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") camera.position.lerp(controls.target, 0.15), controls.update();
    else if (e.key === "-") camera.position.sub(controls.target).multiplyScalar(1.18).add(controls.target), controls.update();
    else if (e.key.toLowerCase() === "f") api.fit();
  });

  // ---- render loop (1 or 4 views) ----
  const size = () => ({ w: container.clientWidth || 600, h: container.clientHeight || 500 });
  const resize = () => {
    const { w, h } = size();
    renderer.setSize(w, h);
    camera.aspect = layout === 4 ? w / h : w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  let raf;
  const fitOrtho = (c, aspect) => {
    const r = model ? model.geom.ro + 0.43 * model.design.stone.dia + 4 : 16;
    c.left = -r * aspect;
    c.right = r * aspect;
    c.top = r;
    c.bottom = -r;
    c.updateProjectionMatrix();
  };
  const loop = () => {
    controls.update();
    const { w, h } = size();
    if (layout === 4) {
      renderer.setScissorTest(true);
      const cells = [["top", 0, h / 2], ["front", w / 2, h / 2], ["right", 0, 0], ["persp", w / 2, 0]];
      for (const [name, x, y] of cells) {
        renderer.setViewport(x, y, w / 2, h / 2);
        renderer.setScissor(x, y, w / 2, h / 2);
        if (name === "persp") {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        } else {
          fitOrtho(ortho[name], w / h);
          renderer.render(scene, ortho[name]);
        }
      }
      renderer.setScissorTest(false);
    } else {
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(loop);
  };
  loop();

  // ---- off-screen views for the tech sheet ----
  let sheetRenderer = null;
  function renderView(m, view, { px = 520, mode: viewMode = "shaded", pad = 1.15 } = {}) {
    sheetRenderer ||= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    sheetRenderer.setSize(px, px, false);
    const sc = new THREE.Scene();
    addLights(sc);
    sc.environment = scene.environment;
    const objs = modelObjects(m, { mode: viewMode });
    sc.add(objs);
    const box = new THREE.Box3().setFromObject(objs);
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    let cam;
    let spanX, spanY;
    if (view === "perspective") {
      cam = new THREE.PerspectiveCamera(30, 1, 1, 500);
      const r = sz.length() * 1.25;
      cam.position.set(c.x + r * 0.55, c.y + r * 0.45, c.z + r * 0.7);
      cam.lookAt(c);
    } else {
      // world extents shown horizontally (spanX) and vertically (spanY)
      const dims = { top: [sz.x, sz.z], front: [sz.x, sz.y], side: [sz.z, sz.y] }[view];
      const half = (Math.max(dims[0], dims[1]) * pad) / 2;
      cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 500);
      const dir = { top: [0, 1, 0], front: [0, 0, 1], side: [1, 0, 0] }[view];
      cam.position.set(c.x + dir[0] * 100, c.y + dir[1] * 100, c.z + dir[2] * 100);
      if (view === "top") cam.up.set(0, 0, -1);
      cam.lookAt(c);
      spanX = dims[0];
      spanY = dims[1];
    }
    sheetRenderer.render(sc, cam);
    const url = sheetRenderer.domElement.toDataURL("image/png");
    objs.traverse((x) => x.material?.dispose?.());
    const mmPerPx = view === "perspective" ? null : (cam.right - cam.left) / px;
    return { url, px, mmPerPx, spanX, spanY };
  }

  // ---- exports ----
  const toBlob = (data, type) => new Blob([data], { type });
  const meshOf = (m, which, opts) => {
    const g = bakeGeometry(m, which, undefined, opts);
    return g && new THREE.Mesh(g, new THREE.MeshStandardMaterial(which === "stones" ? { color: "#eaf6ff" } : { color: METALS[m.design.ring.metal].color, metalness: 1, roughness: 0.25 }));
  };
  // glTF is in metres, so GLB scales the millimetre model by 1/1000
  const all = (m, scale = 1) => {
    const g = new THREE.Group();
    for (const w of ["metal", "stones"]) {
      const mesh = meshOf(m, w);
      if (mesh) {
        mesh.name = w;
        g.add(mesh);
      }
    }
    g.scale.setScalar(scale);
    g.updateMatrixWorld(true);
    return g;
  };

  const api = {
    setModel,
    get model() {
      return model;
    },
    setTool(t) {
      tool = t;
      controls.enabled = t === "orbit";
      brush.visible = false;
      measureA = null;
      path = [];
      drawPath();
    },
    setBrush: (r) => (brushR = r),
    setSnap: (mm) => (snap = mm),
    setWandSpan: (mm) => (wandSpan = mm),
    setMode(m) {
      mode = m;
      redraw();
    },
    setHighlight(obj) {
      highlight = obj;
      redraw();
    },
    setLayout(n) {
      layout = n;
      resize();
    },
    setView(v) {
      camera.position.set(...VIEWS[v]);
      controls.target.set(0, 4, 0);
      controls.update();
    },
    fit() {
      const box = new THREE.Box3().setFromObject(holder);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length();
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(c);
      camera.position.copy(c).addScaledVector(dir, r * 1.6);
      controls.update();
    },
    setReference(object) {
      reference.clear();
      if (object) reference.add(object);
    },
    renderView,
    exportStl: (m, which, opts) => toBlob(new STLExporter().parse(meshOf(m, which, opts) ?? new THREE.Mesh(), { binary: true }), "model/stl"),
    stlBytes: (m, which, opts) => new Uint8Array(new STLExporter().parse(meshOf(m, which, opts) ?? new THREE.Mesh(), { binary: true }).buffer),
    exportObj: (m) => toBlob(new OBJExporter().parse(all(m)), "text/plain"),
    export3mf: (m) => toBlob(to3mf(m), "model/3mf"),
    glbBytes: (m) => new Promise((resolve, reject) => new GLTFExporter().parse(all(m, 0.001), (b) => resolve(new Uint8Array(b)), reject, { binary: true })),
    exportGlb: (m) =>
      new Promise((resolve, reject) => new GLTFExporter().parse(all(m, 0.001), (b) => resolve(toBlob(b, "model/gltf-binary")), reject, { binary: true })),
    screenshot: () => renderer.domElement.toDataURL("image/png"),
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      sheetRenderer?.dispose();
    },
  };
  return api;
}
