# JewelScript CAD

A browser jewelry CAD where **the design is a short text file**. Every UI action writes a line of script and editing the text rebuilds the model. It is an original implementation of the ideas described in `diatech-reverse-engineering.md`; the language and geometry are its own, not a copy of any product's.

```
design "Halo ring"
ring size=US6.5 metal=18k-white
shank width=3 thickness=1.8 profile=comfort
stone cut=oval dia=5.5 setting=prong prongs=6
halo dia=1.2 gap=0.1
pave dia=1.3 gap=0.15
paint s=20 w=0 r=2.4      # one line per pavé brush stroke
rule min_wall=0.8
```

## Run

```
npm install
npm run cad          # dev server
npm run cad:build    # static build in dist-cad/
npm test             # all tests (design logic + CAD core)
```

## What it does

- **Text is the model**: edit the script (errors are shown per line and the last good model stays) or use the parameter panel, which writes canonical script back.
- **Ring sizes** US, EU and JP, converted to inner diameter in mm.
- **Stones are real objects** sized by their girdle: round, oval, marquise, pear, princess, cushion, emerald. Prong settings place prongs on the girdle outline; bezels follow it; halos follow the cut's outline with evenly spaced stones.
- **Paint-to-fill pavé**: turn on *Paint pavé* and drag over the band. Strokes become `paint` lines and a hex lattice of melee fills them, staying on the band and clear of the head.
- **Tech sheet**: metal weight from the real mesh volume and typical alloy densities, stone list with estimated diamond carats, inside diameter.
- **Checks**: minimum wall (user-set rule), unstocked melee sizes, overlapping stones.
- **Export**: STL (metal, stones), OBJ, GLB, in millimetres.
- **Headless for agents**: `node cad/cli.js validate design.jws` and `node cad/cli.js measure design.jws` print JSON (errors with line numbers, or the full report) so an AI assistant can write, check and measure designs without the UI.

## Limits (deliberate scope)

- Approximate cuts and settings: no heart, asscher, radiant, baguette or trillion; settings are prong and bezel only. Halos offset the outline by scaling, not an exact offset curve.
- Weight ignores stone seats and uses typical alloy densities. Carats are diamond estimates.
- No 3MF, size-run export, STEP/3DM/JCD import, booleans, sweeps, engraving or mesh tools.
- No MCP server; the CLI is the agent interface.
- UK ring sizes are not included.
