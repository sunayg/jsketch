# Diatech Make editor study (2026-10-14)

Scope: what a signed-in user sees at https://cad.diatech.ai/app, in Chrome. No server code, API calls, tokens or paid assets were inspected. No design was saved, published, deleted or exported. The draft that was open (an unsaved "Untitled" holding an imported platinum solitaire mesh) was disposable per the user, and was replaced by the "Pavé-Shoulder Solitaire" example. In that example I painted one stroke and created a `stroke` curve, then dismissed the packing edit with Esc. Nothing was packed or saved.

Compared against: `cad/` on branch `ccr-e9ff11fc-98e0qv` of sunayg/jsketch (commit b068384), plus `diatech-reverse-engineering.md` from that branch.

Not examined: Save/Open/Publish, Migrate, Compress, the Agent panel (it may spend credits), Texture/Milgrain/Rope, the `/mcp` endpoint.

## 1. Layout

- **Title bar**: project name (click to rename), "Unsaved" flag, command palette (Cmd/Ctrl+K), undo, redo, dark mode, sign out.
- **Ribbon tabs**: File, Sketch, Solid, Surface, SubD, Modify, Gem, Arrange, View, Window. Each tab is a row of grouped buttons, many with a dropdown arrow ("quick actions").
- **Left panel**: Objects, with three views (Nested = operations under their users, Hierarchy = assemblies and their objects, Flat = document order), a name search, a "show relationships" and a "double-click to zoom to" control per row, and five colour layers (red, amber, green, blue, violet) at the bottom.
- **Centre**: Viewport. Axis gizmo top right. Left tool column: select, move (Alt+W), rotate (Alt+E), scale (Alt+R), box resize (Alt+T), "use selection's own axes" (Alt+O), pivot point, measure (Alt+M), dimension (Alt+D), fit (Alt+F). Bottom-left column: view Iso/Top/Front/Right and render mode (Matcap, Alt+X). Labels such as "top", "shoulder", "bottom" and "finger axis" float in the scene.
- **Right panel**: tabs Source and Inspector. A contextual tab appears while a tool is active (for example "Region").
- **Status bar**: online/idle, tool hint, selection count, selection filter (Objects / Faces / Edges / Vertices), Osnap (F3) with snap menu, 3D snap, Grid snap (F9) with a spacing field (0.5 mm) and an angle field (15 degrees), mesh quality (Preview or Export).
- **Window tab** is the layout manager: presets Default, Code, 4 views; "Add panel" for Viewport, Source, Inspector, Objects, Report (dropdown: Report, Manufacturability) and Agent. Panels split right or down and can be resized.
- A banner "New version available. Reload" shows. A second browser tab restored the same draft, so the draft autosaves.

## 2. Ribbon contents

| Tab | Buttons seen |
|---|---|
| File | New, Open, Save, Save As, Examples, Migrate. Import: Image, Mesh, SVG, Font, JCD, Rhino, DSB, Reference. Export: Export, Tech sheet, Publish. Tools: Compress |
| Sketch | 2D, Ellipse, Arc, Line, Polygon, Point, Profiles, Offset, Extend, Join, Trim, Blend, More, Project, Isocurve, Section, Centre, Edge, Intersect, 2-view curve |
| Solid | Basics, Text, Builders, More, Pipe, Contour band, Sweep, Profile, Connect, Extrude, Shell, Cut, Explode, Cap, Separate, Close back, Simplify, Symmetrize, Smooth, Relief, Texture, Pattern, Milgrain, Rope |
| Surface | Net, Loft, Patch, Blend, Tween, Drape, Face, Thicken, Offset, Morph |
| SubD | Box, Cylinder, Torus, Band, Signet, To SubD, Edit cage, Points, Edges, Faces, Loop, Display, Crease, Symmetry, Extrude, Insert loop, Delete faces, Bridge, Fill hole |
| Modify | Points, Rebuild, From points, Fillet, Chamfer, Mirror, Split, Bake, Keep only, Deform, Union, Subtract, Intersect, Regions |
| Gem | Create: Gem, To gem, Step cut. Cutters: Cutter, Outline, Azure, Channel cut, Microprong, Scallop. Settings: Head, Bezel, Illusion, Channel, Microsetting, Halo, Copy setting. Stud: Region, Stud, Springs |
| Arrange | Body, Face, Edge, Vertex, Select all, Move, Rotate, Scale, Box, Orient, Attach, Measure, Dimension, Distribute, Group |
| View | Iso, Top, Bottom, Front, Back, Left, Right, Normal, Side, Fit, Zoom in/out, Center, Origin, Show all, Isolate, Clip, Guides, Grid, Sizes, Comb, Matcap, Render |

## 3. The source ("script") editor

The Source tab is a line-numbered XML editor, not the line-based `.ds` text the spec describes. Every UI action rewrites it, and edits rebuild the model (the second tab showed the same text). Features seen in the Pavé-Shoulder Solitaire example:

```xml
<design view="render" name="Pavé-Shoulder Solitaire" metal="14k_white">
<import src="std:shanks.ds" />
<var name="finger_d" value="17.35" />
<cathedral_shank profile="court" id="shank" diameter="{$finger_d}" width="3"
  thickness="{$band_h}" rise="{$shoulder_rise}" opening_angle="28" taper="0.6" />
<gem id="diamond" cut="round" diameter="6" position="0, 0, {$finger_d / 2 + $band_h - 0.15}" />
<setting id="head" type="head" prong_tip="pointed" stones="diamond" prong_wire="0.8" />
<repeat id="right_stones">
  <distribute mode="along_path" path="shoulder" surface="shank" count="5" />
  <template ref="melee" />
</repeat>
<op id="left_stones" type="mirror" targets="right_stones" plane="YZ" />
<bool id="metal" expr="shank + head + beads - right_stones.drills - accents - diamond" />
<output ref="assembly"><export ref="metal" format="stl" /></output>
```

Observations:
- Variables (`<var>`) and `{ }` expressions with arithmetic. The Inspector shows bound fields with an "fx" mark and "click to edit".
- Every object has an `id`. Other objects reference ids (`targets=`, `members=`, `stones=`, `path=`, `surface=`, `ref=`). Dotted access such as `right_stones.drills` exists.
- Library components come from `std:*.ds` imports (here `cathedral_shank`). Components appear in the Inspector as a "component" dropdown.
- A boolean is an expression over ids (`bool expr="a + b - c"`). Ops include `mirror`, `simplify`.
- `<!-- @catalog role keywords -->` header comments tag designs for the search that the MCP tools use.
- The design root carries `metal=`, `view=`, and a `min_wall=` attribute that the checker mentions.
- Imported meshes sit as `<mesh src=".uploads/cache/<hash>.glb">`.
- Operation ids such as `lite` carry `metal_color="14k_rose"`.
- A pavé stroke becomes a `<curve id="stroke" mode="interpolate" edit_mode="snap" edit_snap_to="shank" edit_paint_axis="X">` with `<pt>` children.
- The editor can fold elements (arrow in the gutter).

## 4. Templates (File > Examples)

A searchable gallery with filters All / Designs / Components. It lists 120 designs and 34 components. Opening one loads it over the current draft and sets the URL hash (`#pave_shoulder_solitaire`). Design names include Cathedral 4-Prong Solitaire, Halo Solitaire Ring, Double Halo, Tapered Pavé Band, Micro-Prong Pavé Band, Petite Tennis Bracelet, Hinged Locket, Matched Wedding Set, Two-Tone Ring, SubD Signet Ring, filigree necklaces, earrings and brooches. Components include Setting controls, Head Setting Sampler, Claw Collet Sampler, Graduated Edge-Fill Pave, Snow Pave Dome, Tennis Bracelet Stone Patterns, Custom Mesh Gem.

## 5. Ring size and stone settings

- Selecting the shank shows an Inspector with sections BAND (size, system, diameter, width, thickness, profile), SHOULDERS (rise, span angle, opening angle, taper, embed fraction, shoulder profile/width/thickness) and HEAD CONNECTION (top profile, top width, top thickness, tip x, and more).
- Ring size is a number plus a system dropdown: US, EU, IT, DE, UK, JP, HK, MATRIX, custom. `diameter` can instead be a variable expression. Placeholder values show defaults (size 7, span angle 140, embed fraction 0.25).
- Gem fields: cut, diameter, position, `drill_bore` for melee. Settings are separate elements (`type="head"`, `type="prong" mode="shared"`, with `prong_wire`, `rail_wire`, `bead`, `below`, `above`, `end_prongs`).
- Gem tab offers settings Head (dropdown), Bezel, Illusion, Channel, Microsetting, Halo, plus Copy setting, and cutters (Outline, Azure, Channel cut, Microprong, Scallop).

## 6. Pavé paint workflow (as clicked)

1. Gem > **Region**. Right panel shows "Region, N stamps". Modes: Interior ("fills inside a closed outline"), Outline, Stroke ("one row of stones per stroke"), Magic wand. Sliders: brush radius (0.8 mm), precision (0.5). Buttons: Undo stroke, Cancel (Esc), **Fit region** (Enter). Shift draws a straight line.
2. After a stroke: Fit region > step 2 "preview" with Edit boundary, Back, Cancel, **Create curve**. The status line reads "Create a curve, then Gem > Stud curve to pavé".
3. Create curve adds a `curve` object. Then Gem > **Stud** opens a **Pack stones** dialog:
   - Tab "By count": approximate number of diamonds (5), with computed Stone diameter (1.29), Gap (0.28), Bead diameter (0.387), Bead height (0.71) in mm, and the path length (7.9 mm).
   - Tab "Auto size": picks the largest stock melee size that fills the region; Min/Max stone diameter (0.9 to 2), optional Min/Max count, "Find best size". It needs a closed region, a stroke is refused.
   - Buttons: Keep current sizes, Cancel, Pack stones.
4. A status-bar "Packing edit / Apply" appears for adjusting the result. I did not apply it.

## 7. Manufacturability panel (Window > Report > Manufacturability)

- Button "Run checks" (later "Recheck"). Description: measures the thinnest wall and paints thickness on the metal, then checks stone overlaps, melee sizes, stones in the finger bore, stones no metal holds, and open metal.
- WALLS block: "min wall 0.45 mm / 0.6 min", a Show toggle, and "thickness: Paint on metal" (heatmap on the model).
- FINDINGS list with coordinates, e.g. "metal: wall is 0.45 mm at (9.57, -0.50, 4.61), under the 0.6 mm minimum, thin metal may not fill in a cast. Thicken it; `<design min_wall=>` is the foundry's floor, not a fix."
- A "Stale: design changed" flag appears after any edit.
- On the imported ring mesh it reported 3 findings (0.03 mm walls) in a few seconds.

## 8. Tech sheet (File > Tech sheet)

Dialog with live preview. Options:
- Display mode (6): baked lighting (default), lit metal and stones with reflections, edges only, unlit fill, translucent metal (to check stones in settings), exploded "every part at once".
- Views: Top, Front, Side, Perspective, with remove and "+ Add view".
- Toggles: show dimensions, show dimensions drawn with the Dimension tool, show gem map.
- Units: size mm/cm/in; stones ct/mg/pts; metal g/dwt/ozt/tola.
- Metal table: document metal plus each metal used, 20 alloys to pick from (Silver 925, Gold 9K/10K/14K/18K in yellow/white/rose, 22K, Platinum 950, Palladium 950, Rhodium plate, Stainless steel, Brass, Bronze, Copper, Titanium) with an editable density per metal and a weight per metal.
- Stones table, logo upload, additional notes.
- Download as: one self-contained HTML file, or print-ready paginated.

## 9. Export (File > Export)

Dialog "Export design": formats glb (3D viewers and web), stl (print and cast), obj (rendering), 3mf (3D print package), 3dm (Rhino layered meshes), dsb (source plus meshes, portable). Mesh quality: Draft, Standard, Fine. "Shrinkage compensation %" (hint: 2 if the metal shrinks 2% when cast). Cancel / Export. The design file can also declare `<output><export ref= format=/></output>`.

## 10. Comparison with jsketch `cad/` (JewelScript)

jsketch `cad/` is about 1,000 lines: line-based script (`ring`, `shank`, `stone`, `halo`, `pave`, `paint`, `rule`), 3 templates, US/EU/JP sizes, 7 metals, prong and bezel settings, brush-stroke pavé on the band, tech sheet, three checks, STL/OBJ/GLB, a CLI (`validate`, `measure`).

Most valuable gaps, in suggested order:

1. **Named objects, variables and expressions in the script.** Diatech designs are graphs of id-addressed elements with `<var>`, `{expr}`, references and boolean expressions. JewelScript has one of each command and no ids, so no second stone, no mirrored shoulder, no component reuse. This blocks most of the rest.
2. **Pavé by curve and region, with auto size and bead parameters.** Diatech: Interior / Outline / Stroke / Magic wand, then fit, then curve, then Pack stones by count or auto size with stone diameter, gap, bead diameter, bead height; shared-bead mode; slope-following via `surface=`. jsketch: `paint s w r` strokes only on the band, one fixed `pave dia gap`, no bead or auto-size.
3. **Richer checks panel with a heatmap.** Add thin-wall location with coordinates, a "paint thickness on metal" view, stale-state flag and Recheck, plus checks for stones in the finger bore, stones no metal holds, and open metal. jsketch has min-wall as a pass/fail rule, unstocked melee sizes and overlap only.
4. **Tech sheet options.** Multiple dimensioned views, gem map, display modes, unit choices (including dwt, ozt, tola, pts), 20 alloys with per-metal density, logo and notes, print-ready output.
5. **Export extras.** 3MF, quality levels, shrinkage compensation %, per-part export, a portable source-plus-meshes bundle. (Size runs come from the spec, not seen in the UI.)
6. **Ring size systems.** Add UK, IT, DE, HK, MATRIX and custom, and let diameter come from a variable.
7. **Settings library.** Head, illusion, channel, microsetting, shared prong, halo variants, cutters; and the remaining stone cuts.
8. **Templates and components.** 120 designs and 34 components against 3 templates. A searchable gallery with `@catalog` keywords would also help the CLI.
9. **Editor ergonomics.** Inspector with bound-field markers, Objects tree views, layers, snaps, command palette, 4-view layout.
10. **Import and AI.** Mesh/GLB, SVG, image, font and Rhino import; an Agent panel and MCP.

Correction to the spec: `diatech-reverse-engineering.md` calls the language DiaScript `.ds` and implies a line-based file. In the signed-in editor the document is XML (`<design>`, element tags, `{$var}` expressions), importing `std:*.ds` libraries. A `.ds` extension appears only on imports. If JewelScript is meant to be interchangeable with Diatech designs later, this needs a decision now.
