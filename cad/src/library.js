// Built-in designs and components. Each text is plain JewelScript; the
// "#@catalog" comment carries search keywords (it is ignored by the parser).
const solitaire = (cut, dia, prongs, metal, extra = "") => `#@catalog solitaire engagement ${cut} prong
design "${cut[0].toUpperCase() + cut.slice(1)} solitaire"
ring size=US6.5 metal=${metal}
shank width=2.4 thickness=1.7 profile=comfort
stone cut=${cut} dia=${dia} setting=prong prongs=${prongs}${extra}
rule min_wall=0.8 shrink=0
`;

export const DESIGNS = [
  { name: "Round solitaire", text: solitaire("round", 6.5, 4, "platinum") },
  { name: "Six-prong round solitaire", text: solitaire("round", 6.5, 6, "18k-yellow") },
  { name: "Oval solitaire", text: solitaire("oval", 5.5, 4, "18k-white") },
  { name: "Princess solitaire", text: solitaire("princess", 5.5, 4, "platinum") },
  { name: "Cushion solitaire", text: solitaire("cushion", 5.8, 4, "18k-rose") },
  { name: "Emerald-cut solitaire", text: solitaire("emerald", 5, 4, "platinum", " tip=claw") },
  { name: "Asscher solitaire", text: solitaire("asscher", 5.5, 4, "platinum", " tip=claw") },
  { name: "Radiant solitaire", text: solitaire("radiant", 5.2, 4, "18k-white") },
  { name: "Pear solitaire", text: solitaire("pear", 5, 5, "18k-rose", " tip=pointed") },
  { name: "Marquise solitaire", text: solitaire("marquise", 4.5, 6, "18k-yellow", " tip=pointed") },
  { name: "Heart solitaire", text: solitaire("heart", 6, 5, "18k-rose") },
  { name: "Trillion solitaire", text: solitaire("trillion", 6.5, 3, "platinum", " tip=flat") },
  {
    name: "Bezel solitaire",
    text: `#@catalog solitaire bezel modern round
design "Bezel solitaire"
ring size=US7 metal=18k-yellow
shank width=2.5 thickness=1.8 profile=domed
stone cut=round dia=6 setting=bezel
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Illusion solitaire",
    text: `#@catalog solitaire illusion budget round
design "Illusion solitaire"
ring size=US7 metal=18k-white
shank width=2.2 thickness=1.7 profile=comfort
stone cut=round dia=4 setting=illusion
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Halo ring",
    text: `#@catalog halo engagement round
design "Halo ring"
ring size=US6.5 metal=18k-white
shank width=2.4 thickness=1.8 profile=comfort
stone cut=round dia=6 setting=prong prongs=4
halo dia=1.2 gap=0.1
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Double halo cushion",
    text: `#@catalog halo double cushion vintage
design "Double halo cushion"
ring size=US6 metal=platinum
shank width=2.6 thickness=1.8 profile=comfort
stone cut=cushion dia=6 setting=prong prongs=4 tip=claw
halo dia=1.1 gap=0.1 kind=double
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Hidden halo oval",
    text: `#@catalog halo hidden oval engagement
design "Hidden halo oval"
ring size=US6.5 metal=18k-yellow
shank width=2.2 thickness=1.7 profile=comfort
stone cut=oval dia=6 setting=prong prongs=4
halo dia=1 gap=0.1 kind=hidden
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Pear halo",
    text: `#@catalog halo pear engagement
design "Pear halo"
ring size=US6 metal=18k-rose
shank width=2.4 thickness=1.8 profile=comfort
stone cut=pear dia=5 setting=prong prongs=5 tip=pointed
halo dia=1.1 gap=0.1
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Pavé shoulder solitaire",
    text: `#@catalog pave shoulders solitaire round region bead
design "Pavé shoulder solitaire"
ring size=US7 metal=platinum
shank width=3.2 thickness=1.9 profile=comfort
stone cut=round dia=6 setting=prong prongs=4
region id=shoulder pts=7:-1.6,26:-1.6,26:1.6,7:1.6 dia=auto min=0.9 max=1.5 gap=0.12 setting=bead bead=0.35 mirror=yes
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Three-stone ring",
    text: `#@catalog three-stone accents trilogy round mirror
design "Three-stone ring"
ring size=US6.5 metal=platinum
shank width=2.6 thickness=1.8 profile=comfort
stone cut=round dia=6 setting=prong prongs=4
accent id=side cut=round dia=3.5 s=6.5 setting=prong prongs=4 mirror=yes
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Pear side-stone ring",
    text: `#@catalog three-stone accents pear oval mirror
design "Pear side-stone ring"
ring size=US6.5 metal=18k-yellow
shank width=2.4 thickness=1.8 profile=comfort
stone cut=oval dia=5.5 setting=prong prongs=4
accent id=pear cut=pear dia=2.8 s=7.5 setting=prong prongs=3 tip=pointed mirror=yes
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Channel shoulder ring",
    text: `#@catalog channel shoulders stroke round
design "Channel shoulder ring"
ring size=US7 metal=18k-white
shank width=3 thickness=1.9 profile=flat
stone cut=princess dia=5 setting=prong prongs=4
stroke id=row pts=7:0,24:0 dia=1.5 gap=0.15 setting=channel mirror=yes
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Eternity band",
    text: `#@catalog band eternity wedding pave region
design "Eternity band"
ring size=US6.5 metal=platinum
shank width=3 thickness=1.8 profile=comfort
stone cut=round dia=4 setting=none
region id=all pts=-40:-1.5,40:-1.5,40:1.5,-40:1.5 dia=1.5 gap=0.12 setting=bead bead=0.35
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Half-eternity band",
    text: `#@catalog band half-eternity wedding stroke bead
design "Half-eternity band"
ring size=US6.5 metal=18k-yellow
shank width=2.6 thickness=1.8 profile=flat
stone cut=round dia=4 setting=none
stroke id=top pts=-17:0,17:0 dia=1.7 gap=0.12 setting=bead bead=0.35
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Comfort wedding band",
    text: `#@catalog band plain wedding comfort
design "Comfort wedding band"
ring size=US9 metal=14k-yellow
shank width=5 thickness=1.8 profile=comfort
stone cut=round dia=4 setting=none
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Domed band",
    text: `#@catalog band plain domed
design "Domed band"
ring size=US8 metal=18k-rose
shank width=4 thickness=2 profile=domed
stone cut=round dia=4 setting=none
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Flush-set band",
    text: `#@catalog band flush gypsy accent men
design "Flush-set band"
ring size=US10 metal=palladium
shank width=6 thickness=2.2 profile=flat
stone cut=round dia=4 setting=none
accent id=flush cut=round dia=3 s=0 setting=flush
rule min_wall=0.8 shrink=0
`,
  },
  {
    name: "Parametric halo",
    text: `#@catalog halo parametric variables round
design "Parametric halo"
var stone_d=6
var band=1.9
ring diameter={17.35} metal=18k-rose
shank width={stone_d/2} thickness={band} profile=comfort
stone cut=round dia={stone_d} setting=prong prongs=6
halo dia={stone_d/5} gap=0.1
pave dia=auto min=0.9 max=1.7 gap=0.15
rule min_wall=0.8 shrink=0
`,
  },
];

// Components: lines that can be appended to any design.
export const COMPONENTS = [
  { name: "Mirrored round accents", keywords: "accent mirror side stones", text: "accent id=side cut=round dia=3 s=7 setting=prong prongs=4 mirror=yes" },
  { name: "Mirrored pear accents", keywords: "accent mirror pear", text: "accent id=pear cut=pear dia=2.8 s=7.5 setting=prong prongs=3 tip=pointed mirror=yes" },
  { name: "Bezel-set side stones", keywords: "accent bezel mirror", text: "accent id=bezel cut=round dia=2.5 s=8 setting=bezel mirror=yes" },
  { name: "Channel row on both shoulders", keywords: "stroke channel shoulder row", text: "stroke id=channel pts=7:0,22:0 dia=1.5 gap=0.15 setting=channel mirror=yes" },
  { name: "Bead-set shoulder pavé", keywords: "region pave bead shoulder", text: "region id=pave_shoulder pts=7:-1.2,24:-1.2,24:1.2,7:1.2 dia=auto min=0.9 max=1.5 gap=0.12 setting=bead bead=0.35 mirror=yes" },
  { name: "Single halo", keywords: "halo", text: "halo dia=1.2 gap=0.1" },
  { name: "Double halo", keywords: "halo double", text: "halo dia=1.1 gap=0.1 kind=double" },
  { name: "Hidden halo", keywords: "halo hidden", text: "halo dia=1 gap=0.1 kind=hidden" },
  { name: "Size variables", keywords: "variables parametric", text: "var stone_d=6\nvar band=1.8" },
];

export function search(query, kind = "all") {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = [
    ...(kind !== "components" ? DESIGNS.map((d) => ({ ...d, kind: "design", keywords: (/#@catalog (.*)/.exec(d.text) || [])[1] || "" })) : []),
    ...(kind !== "designs" ? COMPONENTS.map((c) => ({ ...c, kind: "component" })) : []),
  ];
  return items.filter((it) => q.every((w) => `${it.name} ${it.keywords}`.toLowerCase().includes(w)));
}
