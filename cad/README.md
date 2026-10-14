# JewelScript CAD

A browser jewelry CAD where **the design is a short text file**. UI actions edit the script (changing only the lines they touch, so your comments and order stay) and editing the text rebuilds the model. It is an original implementation of the ideas in `../diatech-reverse-engineering.md` and `../diatech-study-notes.md`; the language, geometry and checks are its own and it does not read or write Diatech files.

```
design "Pavé shoulder solitaire"
var stone_d=6
ring size=US7 metal=platinum
shank width={stone_d/2} thickness=1.9 profile=comfort
stone cut=round dia={stone_d} setting=prong prongs=4 tip=claw
halo dia=1.2 gap=0.1 kind=double
accent id=side cut=pear dia=2.8 s=7.5 setting=prong prongs=3 mirror=yes
region id=shoulder pts=9:-1.4,26:-1.4,26:1.4,9:1.4 dia=auto min=0.9 max=1.5 setting=bead mirror=yes
rule min_wall=0.8 shrink=0
```

The full language reference is in `src/docs.js` (and under "Language" in the app).

## Run

```
npm install
npm run cad          # dev server
npm run cad:build    # static build in dist-cad/
npm test             # all tests
```

## What it does

**Design**
- Text script with variables (`var band=1.8`) and arithmetic in `{…}`; errors per line, with a stale banner while the last valid design stays on screen. Drafts with errors survive a reload.
- Named objects: `accent` (single side stones, bezel/prong/flush), `stroke` (a row along a path, bead or channel set, by size or by count) and `region` (an outline filled with a hex lattice). Any of them can be mirrored to the other shoulder. Fills keep clear of the head and of stones already placed.
- 15 cuts: round, oval, marquise, pear, heart, cushion, princess, emerald, asscher, radiant, baguette, tapered baguette, trillion, hexagonal, octagonal. Settings: prong (round, pointed, flat or claw tips), bezel, illusion, or none (plain band). Halos: single, double, hidden, following the cut's outline and leaving room for the prongs.
- Ring sizes US, EU, DE, IT, JP or an inside `diameter=`; the panel converts between systems. 17 alloys with a density override.
- Gallery of 28 designs and 9 components with search; a rule-based assistant (not an AI model) that edits the design from requests like "a size 6.5 platinum solitaire with a 1 ct oval in six prongs" and lists the words it did not use.

**Editor**
- Tools: orbit, brush (paint pavé), stroke, outline, wand (fill across the band), measure; grid snap. One drag is one undo step; Undo/Redo cover every change, including opening a template.
- Objects tab with per-object stone counts and weights, highlighting and removal. Command palette (Ctrl/Cmd+K). Views (iso, top, front, right, fit), a 4-view layout, and display modes: shaded, translucent metal, edges, and a wall-thickness heatmap.
- Imports: `.jws` scripts; STL/OBJ/GLB as a translucent reference mesh (with a warning when its size does not look like millimetres); SVG artwork as a pavé region on the shoulder.

**Checks** (in the sidebar, the tech sheet, the CLI and the MCP server)
- Thinnest shank wall from the real profile (with its location) and every part against `rule min_wall`; open (non-watertight) metal; metal not connected to the rest; stones in the finger bore; stones overhanging the band; stones nothing holds; stones running into prongs; metal under pavé culets; edge margin; touching stones; overlaps; unstocked melee sizes; fills that produce no stones.

**Output**
- Tech sheet: top/front/side/perspective views with dimension lines, gem map, metal table with house density, stone list in ct/mg/pts, units g/dwt/ozt/tola and mm/cm/in, logo, notes; preview, download as one HTML file, or print.
- Export: STL (metal, stones, or one object), 3MF (millimetres, metal and stones as objects), GLB (in metres, as glTF expects), OBJ, a portable bundle (script plus meshes), and size runs (one STL per finger size). Draft/standard/fine quality and casting shrinkage %.

## For AI agents

**MCP server** (stdio): `claude mcp add jewelscript -- node /path/to/cad/mcp.js`

Tools: `read_docs`, `browse_catalog`, `search_examples`, `get_example`, `validate_design`, `measure_design`, `check_stone_fit`, `render_design` (PNG images from a built-in software renderer), `compare_designs`, `edit_design`, `export_design` (writes only under `$JEWELSCRIPT_OUT`, default `./jewelscript-out`).

**CLI**: `node cad/cli.js <validate|check|measure|render|export> <file.jws|-> [options]`. Output is JSON. Exit codes: 0 ok, 1 script errors, 2 usage or file problem, 3 checks failed.

## Limits

- Geometry is built from parametric primitives, not a general CAD kernel: no booleans, sweeps along arbitrary rails, lofts, surfaces, engraving, relief or mesh repair tools.
- No STEP, Rhino `.3dm` or JewelCAD `.jcd` import; imported meshes are references only. No image or font import.
- Halos offset the outline by scaling it (not an exact offset curve); stones are skipped where prongs pass.
- The connectivity check compares bounding boxes, so it catches floating parts but not every gap. Stone/metal clearance is checked against prongs only.
- Painted positions are stored as mm along the band, so changing the ring size moves them around the ring slightly.
- Weights use typical alloy densities and deduct flush stone seats; carats are diamond estimates from size.
- UK, HK and MATRIX ring sizes are not included (no verified table).
- The assistant is rule-based; it is not a language model.
