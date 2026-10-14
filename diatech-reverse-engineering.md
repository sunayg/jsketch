# Reverse engineering cad.diatech.ai ("Diatech Make")

Method: passive analysis of what the site serves publicly. That means the landing page and its guide pages (`/features`, `/pave`, `/rings`, `/printing`, `/ai`, `/docs`), `robots.txt`, `llms.txt`, response headers, JSON-LD, and the 18 public JS chunks. REA (`morluto/rea`) was run on those chunks. The editor itself (`/app`) and the MCP endpoint (`/mcp`) are behind a Diatech login and were **not** accessed. No authentication was attempted.

REA result: the public chunks are only the SvelteKit marketing shell (171 modules, one `localStorage` key for the theme, no network endpoints). No CAD engine code is served publicly. Everything below about the product comes from the site's own descriptions, not from its code. The worker hit its heap limit on one chunk, so coverage is partial.

## What it is
Browser-based parametric jewelry CAD for rings, pendants and earrings, aimed at casting. Free to try with an account. Made by Diatech (Dubai). A sister product, Diatech Studio, handles AI renders and catalogs and shares the account.

## Stack (from headers and markup)
SvelteKit (static prerendered marketing pages, `x-sveltekit-page`), Tailwind-style utility classes, nginx on Ubuntu. Strict CSP with `wasm-unsafe-eval` (so the geometry kernel is probably WebAssembly), `worker-src blob:`, and COOP/COEP headers (cross-origin isolation, usually for threaded WASM/SharedArrayBuffer). Images from `cdn.diatech.ai`. Installable PWA (`manifest.webmanifest`). Dark/light theme.

## Core idea
A design is a readable text document called **DiaScript** (`.ds` extension), with dimensions in millimetres. *(Correction: the public site only says "short, readable text". A signed-in study found that the editor document is XML, not a line-based file; see `diatech-study-notes.md`.)* Every UI action writes a line of script, and editing the text rebuilds the model. This makes designs diffable, versionable and writable by language models. The script compiles to exact geometry plus measurements.

## Feature list (from the site)
- **Parametric rebuild**: change ring size, stone count or wall thickness and the whole piece rebuilds (the site's demo shows about 0.4 s).
- **Ring sizes** US, EU, UK, JP; real alloy densities; metal weight by alloy.
- **Stones are real objects** (table, girdle, culet). Cuts: round, oval, princess, cushion, emerald, asscher, radiant, marquise, pear, heart, baguette, tapered baguette, trillion, hexagonal, octagonal, custom from an imported model.
- **Settings built on the measured girdle**: prong, head/basket, bezel (full, half, under, tube, girdle-rim), flush/gypsy, channel, halo (single, double, hidden), shared-prong and bead pavé, micro-pavé, illusion plates, pendant bails, cutters (drill, seat, bearing, countersink), azure windows.
- **Paint-to-fill pavé**: brush, magic wand or path on any 3D surface (including meshes with holes); packing in hex, square, brick, row, concentric or scatter layouts; edge fill with the largest stocked melee size, flagging sizes that are not stocked; slope compensation; exclusion zones.
- **Modeling tools**: pen/arcs/helices/offsets, band profile library, image/SVG tracing, multi-rail sweep, loft, thicken, patch, control-point surfaces, booleans, deform, engraving (wrapped inscriptions, graver grooves, milgrain), relief from grayscale, parts and patterns (repeat along path or around axis, mirror), gumball manipulation, box/face/edge/vertex selection, snapping, command palette (Cmd+K), two-tone metal and gem colour.
- **Mesh tools** for AI sculpts and scans: separate, cut, simplify, smooth, symmetrize, mirror, hollow to a chosen wall, close a scooped back.
- **Import**: STEP, STL, GLB, OBJ, Rhino `.3dm`, JewelCAD `.jcd` (rebuilt as editable features), SVG and images.
- **Export**: STL, 3MF, GLB, OBJ at draft/standard/high quality, whole piece or single part, size runs (one file per finger size).
- **Manufacturing checks**: minimum wall thickness (shows where), stone fit against metal and each other, real-size flagging for unscaled meshes, user-written design rules that block the build.
- **Tech sheet**: metal weight by alloy, stone list with sizes/counts/carats, gem map, dimensioned views, per-metal house density, notes, metal priced at spot and stones from a price book.
- **AI**: an MCP server at `/mcp` (OAuth, Streamable HTTP) with tools to read the language docs and compiler catalog, search and get example designs, validate, migrate, compare, render (shaded views plus size, weight, stone list), check stone fit, publish designs (versioned, with Review and Showcase links), and read published designs. A local renderer/CLI is published on npm as `@diatechai/cad`.
- **Sharing**: published designs get a review page and an embeddable showcase page.

## What cannot be learned from the public surface
The DiaScript grammar, the geometry kernel, the exact packing and setting algorithms, the compile server, pricing beyond "free to try", and the account system. Those live behind the login or on the server.

## Build plan used for the clone
See `cad/README.md`. An original text-defined parametric ring CAD: own language (JewelScript), own geometry, own checks. It covers the core idea (text file is the model), ring sizes, girdle-based prong settings, halos that follow the cut outline, paint-to-fill pavé, alloy weights, stone list and carats, wall/fit checks, STL/OBJ/GLB export, and a headless CLI for AI agents. It does not copy Diatech code, branding or assets, and its output is not interchangeable with DiaScript.

## Correction after the signed-in study
`diatech-study-notes.md` (written from the signed-in editor, as a user) shows the document is **XML**: a `<design>` root with element tags, `id` attributes, `<var>` variables, `{expr}` expressions, `<import src="std:*.ds">` libraries, `<gem>`, `<setting>`, `<repeat>`, `<op>`, `<bool expr="a + b - c">` and `<output>`. The public pages implied a line-based file; that was wrong. JewelScript deliberately keeps its own line-based language and does not try to read or write Diatech files. Compatibility would mean copying their format, which this project does not do.

## Gaps closed in `cad/` since the study
Variables and `{expr}` expressions; auto-sized pavé (largest-coverage stocked melee in a range); wall findings with coordinates, plus a finger-bore check and a stale-state banner; tech-sheet units (g/dwt/ozt/tola, ct/mg/pts, mm/cm/in), 17 alloys with density override; export quality (draft/standard/fine), casting shrinkage %, 3MF; DE and IT ring sizes and custom diameter.

## Status of the study's gap list
Done in `cad/`: named objects with mirroring (accents, strokes, regions); pavé by brush, stroke, outline and wand, with auto size, pack-by-count, beads and channels; manufacturability checks with a wall-thickness heatmap, open/floating metal, prong clearance, culet and edge metal; tech sheet with dimensioned views, gem map, units, house density, logo, notes and print; 3MF, GLB, OBJ, per-part export, size runs and a portable bundle; DE/IT sizes and diameter; more settings (illusion, tips, double and hidden halos) and 15 cuts; a searchable gallery of designs and components; objects tree, command palette, undo/redo, 4-view layout, measure and snapping; STL/OBJ/GLB reference import and SVG-to-region; a rule-based assistant, an MCP server and a JSON CLI.

Not done (would need a real CAD kernel or verified data): booleans, sweeps, lofts, surfaces, engraving and relief; mesh repair tools; STEP/3DM/JCD import; image and font import; UK/HK/MATRIX sizes; publishing and sharing.
