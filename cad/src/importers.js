// File imports: scripts, meshes (as a sculpt or a reference) and SVG outlines.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { readMesh } from "./meshio.js";

const refMaterial = () => new THREE.MeshStandardMaterial({ color: "#7aa7ff", transparent: true, opacity: 0.35, roughness: 0.6, depthWrite: false });

// A mesh file, ready either to become a sculpt or to show as a reference.
// GLB is in metres by convention; anything that small is shown as millimetres.
function meshImport(soup, name, bytes, ext) {
  if (!soup.length) throw new Error(`${name} has no triangles`);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(soup, 3));
  g.computeBoundingBox();
  let size = g.boundingBox.getSize(new THREE.Vector3());
  let big = Math.max(size.x, size.y, size.z);
  let note = "";
  if (big > 0 && big < 0.2) {
    g.scale(1000, 1000, 1000); // metres -> mm
    size = size.multiplyScalar(1000);
    big *= 1000;
    note = " (the file is in metres; shown as millimetres)";
  }
  g.computeVertexNormals();
  const object = new THREE.Mesh(g, refMaterial());
  const unscaled = big < 5 || big > 120;
  const message = `${name}: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm${note}${unscaled ? ". That does not look like a ring in millimetres; fit-to-ring will size it" : ""}.`;
  return { kind: "reference", object, message, size: size.toArray(), unscaled, bytes, ext, metres: !!note };
}

// SVG artwork -> a region outline on the band, centred on the right shoulder.
// Artwork longer than the shoulder is scaled down to fit.
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
  let k = (2 * half) / Math.max(1e-6, maxY - minY); // artwork height fills the band width
  const maxLen = 24; // mm along the shoulder
  let note = "";
  if ((maxX - minX) * k > maxLen) {
    k = maxLen / (maxX - minX);
    note = " It was scaled down to fit the shoulder.";
  }
  const centreS = 14;
  const pts = best.pts.map((p) => [
    Math.round((centreS + (p.x - (minX + maxX) / 2) * k) * 10) / 10,
    Math.round(-(p.y - (minY + maxY) / 2) * k * 100) / 100,
  ]);
  return {
    kind: "region",
    region: { dia: "auto", gap: 0.12, setting: "bead", bead: 0.35, mirror: "no", pts, min: 0.9, max: 1.5 },
    message: `SVG outline placed on the shoulder (${((maxX - minX) * k).toFixed(1)} mm long), filled with auto-sized pavé.${note}`,
  };
}

export async function importFile(file, design) {
  const name = file.name;
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "jws" || ext === "txt") return { kind: "script", text: await file.text() };
  if (ext === "svg") return svgToRegion(await file.text(), design);
  if (["stl", "obj", "glb"].includes(ext)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return meshImport(readMesh(bytes, ext), name, bytes, ext);
  }
  if (ext === "gltf") throw new Error("Use .glb (binary glTF); .gltf with separate files is not supported");
  throw new Error(`Unsupported file type .${ext}`);
}
