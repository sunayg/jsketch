// Procedural line-art concept drawing used by the built-in generator.
import { METALS, GEMS } from "./design.js";

export function drawConcept(ctx, size, spec) {
  const c = size / 2;
  const metal = METALS[spec.metal].color;
  const gem = GEMS[spec.gem].color;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2a2a33";
  ctx.lineWidth = 3;
  if (spec.kind === "ring") drawRing(ctx, c, size, spec, metal, gem);
  else if (spec.kind === "pendant") drawPendant(ctx, c, size, spec, metal, gem);
  else drawEarrings(ctx, c, size, spec, metal, gem);
  ctx.restore();
}

function gemPath(ctx, x, y, r, shape) {
  ctx.beginPath();
  if (shape === "square") ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (shape === "pear") {
    ctx.moveTo(x, y - r * 1.4);
    ctx.bezierCurveTo(x + r * 1.2, y - r * 0.2, x + r, y + r, x, y + r);
    ctx.bezierCurveTo(x - r, y + r, x - r * 1.2, y - r * 0.2, x, y - r * 1.4);
  } else if (shape === "oval") ctx.ellipse(x, y, r * 0.8, r * 1.15, 0, 0, Math.PI * 2);
  else ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

function drawGem(ctx, x, y, r, shape, color) {
  gemPath(ctx, x, y, r, shape);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
}

function drawRing(ctx, c, size, spec, metal, gem) {
  const R = size * 0.28;
  const w = spec.bandWidth * size * 0.5;
  const cy = c + size * 0.1;
  ctx.beginPath();
  ctx.arc(c, cy, R, 0, Math.PI * 2);
  ctx.arc(c, cy, R - w, 0, Math.PI * 2, true);
  ctx.fillStyle = metal;
  ctx.fill("evenodd");
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, cy, R - w, 0, Math.PI * 2);
  ctx.stroke();
  const r = spec.gemSize * size * 0.2;
  const gy = cy - R - r * 0.4;
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(c + dx * r * 0.9, gy + r * 0.9);
    ctx.lineTo(c + dx * r * 0.45, gy + r * 1.6);
    ctx.stroke();
  }
  drawGem(ctx, c, gy, r, spec.shape, gem);
}

function drawPendant(ctx, c, size, spec, metal, gem) {
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.15);
  ctx.quadraticCurveTo(c, size * 0.62, size * 0.8, size * 0.15);
  ctx.stroke();
  const r = spec.gemSize * size * 0.2;
  const y = size * 0.52;
  ctx.beginPath();
  ctx.arc(c, y - r * 1.5, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.stroke();
  gemPath(ctx, c, y, r * 1.35, spec.shape);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.stroke();
  drawGem(ctx, c, y, r, spec.shape, gem);
}

function drawEarrings(ctx, c, size, spec, metal, gem) {
  const r = spec.gemSize * size * 0.17;
  for (const x of [size * 0.32, size * 0.68]) {
    ctx.beginPath();
    ctx.arc(x, size * 0.28, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, size * 0.28 + r * 0.35);
    ctx.lineTo(x, size * 0.45);
    ctx.stroke();
    drawGem(ctx, x, size * 0.45 + r, r, spec.shape, gem);
  }
}
