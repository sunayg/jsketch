// File imports: scripts, reference meshes and SVG outlines.
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const refMaterial = () => new THREE.MeshStandardMaterial({ color: "#7aa7ff", transparent: true, opacity: 0.35, roughness: 0.6, depthWrite: false });

// A reference mesh is shown for comparison only; it is not part of the design.
function referenceFrom(object, name) {
  object.traverse((o) => {
    if (o.isMesh) o.material = refMaterial();
  });
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.y, size.z);
  // a ring is roughly 15-35 mm across; anything far off probably has no real units
  const unscaled = big < 5 || big > 120;
  const msg = `Reference ${name}: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm${unscaled ? " (size looks wrong for a ring: the file may not be in millimetres)" : ""}. Shown for comparison only.`;
  return { kind: "reference", object, message: msg, size: size.toArray(), unscaled };
}

// SVG artwork -> a region outline on the band, centred on the right shoulder.
export function svgToRegion(text, design) {
  const data = new SVGLoader().parse(text);
  let best = null;
  for (const path of data.paths) {
    for (const shape of SVGLoader.createShapes(path)) {
      const pts = shape.getPoints(24);
      const area = Math.abs(THREE.ShapeUtils.area(pts));
      if (!best || area > best.area) best = { pts, area };
    }
  }
  if (!best || best.pts.length < 3) throw new Error("No closed shape found in the SVG");
  const xs = best.pts.map((p) => p.x), ys = best.pts.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const half = design.shank.width / 2 - 0.1;
  const k = (2 * half) / Math.max(1e-6, maxY - minY); // artwork height fills the band width
  const centreS = 14;
  const pts = best.pts.map((p) => [
    Math.round((centreS + (p.x - (minX + maxX) / 2) * k) * 10) / 10,
    Math.round(-(p.y - (minY + maxY) / 2) * k * 100) / 100,
  ]);
  return {
    kind: "region",
    region: { dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts, min: 0.9, max: 1.5 },
    message: `SVG outline placed on the shoulder (${((maxX - minX) * k).toFixed(1)} mm long), filled with auto-sized pavé.`,
  };
}

export async function importFile(file, design) {
  const name = file.name;
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "jws" || ext === "txt") return { kind: "script", text: await file.text() };
  if (ext === "svg") return svgToRegion(await file.text(), design);
  if (ext === "stl") {
    const geo = new STLLoader().parse(await file.arrayBuffer());
    return referenceFrom(new THREE.Mesh(geo), name);
  }
  if (ext === "obj") return referenceFrom(new OBJLoader().parse(await file.text()), name);
  if (ext === "glb" || ext === "gltf") {
    const data = ext === "glb" ? await file.arrayBuffer() : await file.text();
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(data, "", res, rej));
    return referenceFrom(gltf.scene, name);
  }
  throw new Error(`Unsupported file type .${ext}`);
}
