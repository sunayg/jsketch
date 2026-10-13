import { useEffect, useRef, useState } from "react";

const SIZE = 800;
const MAX_UNDO = 30;

function LayerCanvas({ layer, registry }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    registry.current[layer.id] = canvas;
    return () => {
      delete registry.current[layer.id];
    };
  }, [layer.id, registry]);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas.dataset.src === (layer.dataUrl || "")) return;
    canvas.dataset.src = layer.dataUrl || "";
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!layer.dataUrl) return;
    const img = new Image();
    img.onload = () => {
      // ignore if a newer state arrived while loading
      if (canvas.dataset.src === layer.dataUrl) ctx.drawImage(img, 0, 0, SIZE, SIZE);
    };
    img.src = layer.dataUrl;
  }, [layer.dataUrl]);
  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      className="layer"
      style={{ visibility: layer.visible ? "visible" : "hidden" }}
    />
  );
}

export default function SketchCanvas({ layers, activeId, onCommit, onSelect, onAddLayer, onToggle, onDelete }) {
  const registry = useRef({});
  const undo = useRef({});
  const drawing = useRef(null);
  const [tool, setTool] = useState("brush");
  const [size, setSize] = useState(6);
  const [color, setColor] = useState("#2a2a33");
  const [opacity, setOpacity] = useState(1);

  const point = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * SIZE, y: ((e.clientY - rect.top) / rect.height) * SIZE };
  };

  const start = (e) => {
    const canvas = registry.current[activeId];
    const layer = layers.find((l) => l.id === activeId);
    if (!canvas || !layer?.visible) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const stack = (undo.current[activeId] ||= []);
    stack.push(canvas.dataset.src || "");
    if (stack.length > MAX_UNDO) stack.shift();
    const ctx = canvas.getContext("2d");
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = size * (e.pressure && e.pointerType === "pen" ? 0.4 + e.pressure : 1);
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    const p = point(e);
    drawing.current = { ctx, canvas, last: p };
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
  };

  const move = (e) => {
    const d = drawing.current;
    if (!d) return;
    const p = point(e);
    d.ctx.beginPath();
    d.ctx.moveTo(d.last.x, d.last.y);
    d.ctx.lineTo(p.x, p.y);
    d.ctx.stroke();
    d.last = p;
  };

  const end = () => {
    const d = drawing.current;
    if (!d) return;
    drawing.current = null;
    d.ctx.globalAlpha = 1;
    d.ctx.globalCompositeOperation = "source-over";
    const url = d.canvas.toDataURL("image/png");
    d.canvas.dataset.src = url;
    onCommit(activeId, url);
  };

  const doUndo = () => {
    const stack = undo.current[activeId];
    if (!stack?.length) return;
    onCommit(activeId, stack.pop() || null);
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        doUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportPng = () => {
    const out = document.createElement("canvas");
    out.width = out.height = SIZE;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (const l of layers) if (l.visible && registry.current[l.id]) ctx.drawImage(registry.current[l.id], 0, 0);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "jsketch-design.png";
    a.click();
  };

  return (
    <div className="sketch">
      <div className="toolbar">
        <button className={tool === "brush" ? "on" : ""} onClick={() => setTool("brush")}>Brush</button>
        <button className={tool === "eraser" ? "on" : ""} onClick={() => setTool("eraser")}>Eraser</button>
        <label>Size <input type="range" min="1" max="40" value={size} onChange={(e) => setSize(+e.target.value)} /></label>
        <label>Opacity <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
        <input type="color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button onClick={doUndo}>Undo</button>
        <button onClick={exportPng}>Export PNG</button>
      </div>
      <div className="stage-row">
        <div
          className="stage"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {layers.map((l) => (
            <LayerCanvas key={l.id} layer={l} registry={registry} />
          ))}
        </div>
        <ul className="layers" aria-label="Layers">
          {[...layers].reverse().map((l) => (
            <li key={l.id} className={l.id === activeId ? "active" : ""}>
              <button className="eye" onClick={() => onToggle(l.id)} aria-label={`Toggle ${l.name}`}>{l.visible ? "👁" : "–"}</button>
              <button className="name" onClick={() => onSelect(l.id)}>{l.name}</button>
              {layers.length > 1 && <button onClick={() => onDelete(l.id)} aria-label={`Delete ${l.name}`}>✕</button>}
            </li>
          ))}
          <li><button onClick={onAddLayer}>+ Layer</button></li>
        </ul>
      </div>
    </div>
  );
}
