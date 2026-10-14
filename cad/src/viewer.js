import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { stoneGeometry } from "./gems.js";
import { stoneMatrix } from "./build.js";
import { bakeGeometry, to3mf } from "./export.js";
import { METALS } from "./script.js";

const GEM_COLOR = { centre: "#f4fbff", halo: "#eaf6ff", pave: "#eaf6ff" };

export function createViewer(container, { onPaint }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 500);
  camera.position.set(26, 22, 38);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 4, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(20, 30, 25);
  const rim = new THREE.DirectionalLight(0xffeedd, 1.4);
  rim.position.set(-25, 10, -20);
  scene.add(key, rim);
  const env = new THREE.Scene();
  env.background = new THREE.Color("#8b919b");
  // soft boxes so metal has bright shapes to reflect
  for (const [x, y, z, sx, sy] of [[0, 8, 0, 10, 10], [10, 2, 6, 6, 8], [-10, 2, -4, 6, 8], [0, 3, -12, 14, 4]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    env.add(panel);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.04).texture;

  const holder = new THREE.Group();
  scene.add(holder);
  let model = null;
  let shankMesh = null;
  const brush = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0x1f6feb, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  brush.visible = false;
  brush.renderOrder = 10;
  scene.add(brush);

  const stoneGeos = new Map();
  const geoFor = (cut, dia) => {
    const k = `${cut}|${dia}`;
    if (!stoneGeos.has(k)) stoneGeos.set(k, stoneGeometry(cut, dia));
    return stoneGeos.get(k);
  };

  const dispose = () => {
    for (const o of [...holder.children]) {
      o.geometry?.dispose?.();
      holder.remove(o);
    }
    for (const g of stoneGeos.values()) g.dispose();
    stoneGeos.clear();
  };

  function setModel(m) {
    dispose();
    model = m;
    const metalMat = new THREE.MeshStandardMaterial({ color: METALS[m.design.ring.metal].color, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
    for (const part of m.metal) {
      const mesh = new THREE.Mesh(part.geometry, metalMat);
      mesh.name = part.name;
      holder.add(mesh);
      if (part.name === "shank") shankMesh = mesh;
    }
    const groups = new Map();
    for (const s of m.stones) {
      const k = `${s.role}|${s.cut}|${s.dia}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(s);
    }
    for (const list of groups.values()) {
      const mat = new THREE.MeshPhysicalMaterial({ color: GEM_COLOR[list[0].role], metalness: 0, roughness: 0.04, transmission: 0.5, thickness: 0.5, ior: 2.4, flatShading: true });
      const im = new THREE.InstancedMesh(geoFor(list[0].cut, list[0].dia), mat, list.length);
      list.forEach((s, i) => im.setMatrixAt(i, stoneMatrix(s)));
      holder.add(im);
    }
  }

  // Paint: map a hit on the shank to (arc length s, axial w) on the outer surface.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let painting = false;
  let brushR = 2;
  let down = false;
  let last = null;
  const hitShank = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!shankMesh) return null;
    // only the outer surface: skip hits on the inside of the band
    const { ri, ro } = model.geom;
    const h = ray.intersectObject(shankMesh, false).find((x) => Math.hypot(x.point.x, x.point.y) > (ri + ro) / 2);
    if (!h) return null;
    const p = h.point;
    return { s: Math.atan2(p.x, p.y) * ro, w: p.z, point: p, normal: new THREE.Vector3(p.x, p.y, 0).normalize() };
  };
  const dom = renderer.domElement;
  dom.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const h = hitShank(e);
    brush.visible = !!h;
    if (!h) return;
    brush.position.copy(h.point).addScaledVector(h.normal, 0.05);
    brush.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.normal);
    brush.scale.setScalar(brushR);
    if (down && (!last || Math.hypot(h.s - last.s, h.w - last.w) > brushR * 0.7)) {
      last = h;
      onPaint({ s: Math.round(h.s * 10) / 10, w: Math.round(h.w * 10) / 10, r: brushR });
    }
  });
  dom.addEventListener("pointerdown", (e) => {
    if (!painting) return;
    down = true;
    last = null;
    dom.setPointerCapture(e.pointerId);
    dom.dispatchEvent(new PointerEvent("pointermove", e));
  });
  const up = () => (down = false);
  dom.addEventListener("pointerup", up);
  dom.addEventListener("pointercancel", up);
  dom.addEventListener("pointerleave", () => (brush.visible = false));

  const resize = () => {
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 500;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();

  // ---- exports: take a model (rebuilt at the chosen quality) and bake it to mm geometry ----
  const toBlob = (data, type) => new Blob([data], { type });
  const meshOf = (m, which) => {
    const g = bakeGeometry(m, which);
    return g && new THREE.Mesh(g, new THREE.MeshStandardMaterial(which === "stones" ? { color: "#eaf6ff" } : { color: METALS[m.design.ring.metal].color, metalness: 1, roughness: 0.25 }));
  };
  const all = (m) => {
    const g = new THREE.Group();
    for (const w of ["metal", "stones"]) {
      const mesh = meshOf(m, w);
      if (mesh) g.add(mesh);
    }
    g.updateMatrixWorld(true);
    return g;
  };

  return {
    setModel,
    setPainting(on) {
      painting = on;
      controls.enabled = !on;
      brush.visible = false;
    },
    setBrush(r) {
      brushR = r;
    },
    exportStl: (m, which) => toBlob(new STLExporter().parse(meshOf(m, which) ?? new THREE.Mesh(), { binary: true }), "model/stl"),
    exportObj: (m) => toBlob(new OBJExporter().parse(all(m)), "text/plain"),
    export3mf: (m) => toBlob(to3mf(m), "model/3mf"),
    exportGlb: (m) =>
      new Promise((resolve, reject) => new GLTFExporter().parse(all(m), (b) => resolve(toBlob(b, "model/gltf-binary")), reject, { binary: true })),
    screenshot: () => renderer.domElement.toDataURL("image/png"),
    destroy() {
      ro.disconnect();
      dispose();
      renderer.dispose();
    },
  };
}
