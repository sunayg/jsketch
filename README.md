# JSketch

A browser jewelry design studio, built from a feature spec (`blng-reverse-engineering.md`) with original code.

- **Chat to concept**: describe a piece ("thin rose gold ring with a large pear sapphire") and get a concept sketch on a new layer.
- **Layered sketch canvas**: brush, eraser, size, opacity, colour, undo (Ctrl/Cmd+Z), layer visibility, PNG export.
- **3D preview**: three.js ring, pendant and earrings driven by the same spec, orbit controls, GLB export.
- **Designs** are stored in `localStorage`.

## Run

```
npm install
npm run dev      # development
npm run build    # production build in dist/
npm test         # prompt-parsing tests
```

## Generation provider

By default concepts are drawn procedurally in the browser, so no API key is needed. To use a real image model, set `VITE_GENERATE_URL` to an endpoint that accepts `POST {prompt, spec}` and returns `{imageUrl}`.

## Not included

Accounts, real-time collaboration, billing, voice, video, and image-to-3D generation. These need a backend; see the spec for how BLNG splits them.

## JewelScript CAD

The repo also contains a text-defined parametric jewelry CAD in `cad/` (see `cad/README.md`), built from the spec in `diatech-reverse-engineering.md`. Run it with `npm run cad`.
