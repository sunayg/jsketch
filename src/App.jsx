import { useEffect, useMemo, useRef, useState } from "react";
import SketchCanvas from "./SketchCanvas.jsx";
import RingPreview from "./RingPreview.jsx";
import { GEMS, KINDS, METALS, SHAPES } from "./design.js";
import { generateConcept } from "./generate.js";
import { loadJourneys, newJourney, saveJourneys } from "./store.js";

export default function App() {
  const [journeys, setJourneys] = useState(loadJourneys);
  const [currentId, setCurrentId] = useState(() => journeys[0].id);
  const [tab, setTab] = useState("sketch");
  const [activeLayer, setActiveLayer] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const chatEnd = useRef(null);

  const journey = journeys.find((j) => j.id === currentId) || journeys[0];
  const layerId = journey.layers.some((l) => l.id === activeLayer) ? activeLayer : journey.layers[0].id;

  useEffect(() => {
    const t = setTimeout(() => setSaveError(!saveJourneys(journeys)), 300);
    return () => clearTimeout(t);
  }, [journeys]);
  useEffect(() => chatEnd.current?.scrollIntoView?.({ block: "end" }), [journey.messages.length, busy]);

  const update = (id, fn) =>
    setJourneys((list) => list.map((j) => (j.id === id ? { ...fn(j), updatedAt: Date.now() } : j)));
  const updateCurrent = (fn) => update(journey.id, fn);
  const setLayers = (fn) => updateCurrent((j) => ({ ...j, layers: fn(j.layers) }));

  const send = async (e) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    const id = journey.id;
    setPrompt("");
    setBusy(true);
    update(id, (j) => ({ ...j, messages: [...j.messages, { role: "user", text }] }));
    try {
      const out = await generateConcept(text, journey.spec);
      const layer = { id: crypto.randomUUID(), name: `Concept ${journey.layers.length}`, visible: true, dataUrl: out.imageUrl };
      update(id, (j) => ({
        ...j,
        spec: out.spec,
        layers: [...j.layers, layer],
        messages: [...j.messages, { role: "assistant", text: out.reply, image: out.imageUrl }],
      }));
      setActiveLayer(layer.id);
    } catch (err) {
      update(id, (j) => ({ ...j, messages: [...j.messages, { role: "assistant", text: `Sorry, that failed: ${err.message}`, error: true }] }));
    } finally {
      setBusy(false);
    }
  };

  const setSpec = (patch) => updateCurrent((j) => ({ ...j, spec: { ...j.spec, ...patch } }));
  const spec = useMemo(() => journey.spec, [journey.spec]);

  const addJourney = () => {
    const j = newJourney();
    setJourneys((list) => [j, ...list]);
    setCurrentId(j.id);
  };
  const removeJourney = (id) => {
    if (!confirm("Delete this design?")) return;
    const rest = journeys.filter((j) => j.id !== id);
    const next = rest.length ? rest : [newJourney("My first design")];
    setJourneys(next);
    if (id === currentId) setCurrentId(next[0].id);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>JSketch</h1>
        <button className="primary" onClick={addJourney}>+ New design</button>
        <ul>
          {journeys.map((j) => (
            <li key={j.id} className={j.id === journey.id ? "active" : ""}>
              <button className="name" onClick={() => setCurrentId(j.id)}>{j.name}</button>
              <button onClick={() => removeJourney(j.id)} aria-label={`Delete ${j.name}`}>✕</button>
            </li>
          ))}
        </ul>
        {saveError && <p className="warn">Storage is full or blocked. Export your work; changes are not being saved.</p>}
      </aside>

      <main>
        <header>
          <input
            className="title"
            aria-label="Design name"
            value={journey.name}
            onChange={(e) => updateCurrent((j) => ({ ...j, name: e.target.value }))}
          />
          <nav>
            <button className={tab === "sketch" ? "on" : ""} onClick={() => setTab("sketch")}>Sketch</button>
            <button className={tab === "3d" ? "on" : ""} onClick={() => setTab("3d")}>3D preview</button>
          </nav>
        </header>
        {tab === "sketch" ? (
          <SketchCanvas
            layers={journey.layers}
            activeId={layerId}
            onCommit={(id, url) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, dataUrl: url } : l)))}
            onSelect={setActiveLayer}
            onAddLayer={() => {
              const l = { id: crypto.randomUUID(), name: `Layer ${journey.layers.length + 1}`, visible: true, dataUrl: null };
              setLayers((ls) => [...ls, l]);
              setActiveLayer(l.id);
            }}
            onToggle={(id) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)))}
            onDelete={(id) => setLayers((ls) => ls.filter((l) => l.id !== id))}
          />
        ) : (
          <RingPreview spec={spec} />
        )}
      </main>

      <section className="right">
        <div className="specs">
          <h2>Piece</h2>
          <Select label="Type" value={spec.kind} options={KINDS} onChange={(v) => setSpec({ kind: v })} />
          <Select label="Metal" value={spec.metal} options={Object.keys(METALS)} names={(k) => METALS[k].label} onChange={(v) => setSpec({ metal: v })} />
          <Select label="Gem" value={spec.gem} options={Object.keys(GEMS)} names={(k) => GEMS[k].label} onChange={(v) => setSpec({ gem: v })} />
          <Select label="Cut" value={spec.shape} options={SHAPES} onChange={(v) => setSpec({ shape: v })} />
          <label>Band width <input type="range" min="0.05" max="0.25" step="0.01" value={spec.bandWidth} onChange={(e) => setSpec({ bandWidth: +e.target.value })} /></label>
          <label>Gem size <input type="range" min="0.15" max="0.55" step="0.01" value={spec.gemSize} onChange={(e) => setSpec({ gemSize: +e.target.value })} /></label>
        </div>
        <div className="chat">
          <div className="messages" aria-live="polite">
            {journey.messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}${m.error ? " error" : ""}`}>
                <p>{m.text}</p>
                {m.image && <img src={m.image} alt="Generated concept" />}
              </div>
            ))}
            {busy && <div className="msg assistant"><p>Designing…</p></div>}
            <div ref={chatEnd} />
          </div>
          <form onSubmit={send}>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe a piece…"
              aria-label="Design prompt"
            />
            <button className="primary" disabled={busy || !prompt.trim()}>Generate</button>
          </form>
        </div>
      </section>
    </div>
  );
}

function Select({ label, value, options, names = (k) => k, onChange }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{names(o)}</option>
        ))}
      </select>
    </label>
  );
}
