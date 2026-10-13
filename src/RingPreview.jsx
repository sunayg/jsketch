import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GEMS, METALS } from "./design.js";

function gemGeometry(shape, r) {
  if (shape === "square") return new THREE.CylinderGeometry(r * 1.3, r * 0.5, r * 1.1, 4, 1);
  if (shape === "pear") {
    const g = new THREE.OctahedronGeometry(r, 1);
    g.scale(0.85, 1.25, 0.85);
    return g;
  }
  if (shape === "oval") {
    const g = new THREE.OctahedronGeometry(r, 1);
    g.scale(0.8, 1.15, 0.8);
    return g;
  }
  return new THREE.CylinderGeometry(r * 1.1, r * 0.35, r * 1.1, 16, 1);
}

// Build the piece from a spec. Pure function of the spec, reused for export.
export function buildPiece(spec) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: METALS[spec.metal].color,
    metalness: 1,
    roughness: METALS[spec.metal].roughness,
  });
  const gemMat = new THREE.MeshPhysicalMaterial({
    color: GEMS[spec.gem].color,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.6,
    thickness: 0.5,
    ior: 2.2,
    flatShading: true,
  });
  const r = spec.gemSize * 0.6;
  if (spec.kind === "ring") {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1, spec.bandWidth, 24, 96), metal);
    group.add(band);
    const gem = new THREE.Mesh(gemGeometry(spec.shape, r), gemMat);
    gem.position.y = 1 + spec.bandWidth + r * 0.45;
    gem.rotation.y = Math.PI / 4;
    group.add(gem);
    const claw = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, spec.bandWidth * 1.1, r * 0.6, 8), metal);
    claw.position.y = 1 + spec.bandWidth * 0.5;
    group.add(claw);
  } else if (spec.kind === "pendant") {
    const bail = new THREE.Mesh(new THREE.TorusGeometry(r * 0.35, 0.03, 12, 32), metal);
    bail.position.y = r * 1.9;
    group.add(bail);
    const setting = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.2, r * 0.9, 0.12, 24), metal);
    setting.position.y = -0.1;
    group.add(setting);
    const gem = new THREE.Mesh(gemGeometry(spec.shape, r), gemMat);
    gem.position.y = r * 0.35;
    group.add(gem);
    group.rotation.x = 0;
  } else {
    for (const x of [-0.9, 0.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 12), metal);
      post.position.set(x, 0.4, 0);
      group.add(post);
      const gem = new THREE.Mesh(gemGeometry(spec.shape, r), gemMat);
      gem.position.set(x, -0.1, 0);
      group.add(gem);
    }
  }
  return group;
}

export default function RingPreview({ spec }) {
  const mount = useRef(null);
  const state = useRef({});

  useEffect(() => {
    const el = mount.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f4f1ec");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 1.2, 4.5);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      el.textContent = "WebGL is not available in this browser.";
      return;
    }
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    // procedural studio lighting so metals have something to reflect
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(3, 4, 5);
    const rim = new THREE.DirectionalLight(0xffeedd, 1.5);
    rim.position.set(-4, 2, -3);
    scene.add(key, rim);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color("#ffffff");
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.04).texture;

    const resize = () => {
      const w = el.clientWidth || 600;
      const h = el.clientHeight || 500;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    state.current = { scene, renderer, piece: null };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pm.dispose();
      renderer.dispose();
      el.replaceChildren();
      state.current = {};
    };
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s.scene) return;
    if (s.piece) {
      s.scene.remove(s.piece);
      s.piece.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    s.piece = buildPiece(spec);
    s.scene.add(s.piece);
  }, [spec]);

  const exportGlb = () => {
    const s = state.current;
    if (!s.piece) return;
    new GLTFExporter().parse(
      s.piece,
      (buf) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
        a.download = `jsketch-${spec.kind}.glb`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      (err) => alert(`Export failed: ${err.message || err}`),
      { binary: true },
    );
  };

  return (
    <div className="preview">
      <div className="toolbar"><button onClick={exportGlb}>Export GLB</button></div>
      <div className="three" ref={mount} />
    </div>
  );
}
