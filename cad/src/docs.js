// Language reference, shared by the MCP server (and kept in step with the in-app help).
export const LANGUAGE_REFERENCE = `JewelScript: a short, line-based description of a ring, in millimetres.
One command per line, options as key=value. "#" starts a comment.

design "Name"                      the design's name (quotes required)
var band=1.8                       a variable; use it as {band} or {band*2 + 0.1}
                                   ({…} allows + - * / and parentheses; define vars before use)
ring size=US7 metal=18k-yellow     size systems: US, EU, DE, IT, JP (e.g. US6.5, EU54, JP13)
ring diameter=17.35                ...or an inside diameter in mm instead of size
     density=15.5                  optional: override the alloy's density (g/cm³)
shank width=3 thickness=1.8 profile=comfort     profile: flat | comfort | domed | none
stone cut=round dia=6.5 setting=prong prongs=4 tip=round
      setting: prong | bezel | illusion | none (none = plain band, no centre stone)
      tip: round | pointed | flat | claw;  dia is the stone's width (shorter side)
halo dia=1.2 gap=0.1 kind=single   kind: single | double | hidden
accent id=side cut=pear dia=2.5 s=12 w=0 setting=prong prongs=3 mirror=yes
      a single stone on the band; setting: bezel | prong | flush
stroke id=row pts=8:0,20:0 dia=1.3 gap=0.15 setting=bead mirror=yes
      one row of stones along a path; count=10 instead of dia packs by count
      (count= and dia= are exclusive; a count that can't fit is reduced)
      setting: bead | channel | none
region id=z pts=8:-1,20:-1,20:1,8:1 dia=auto min=0.9 max=1.5 setting=bead mirror=yes
      a closed outline filled with a hex lattice; dia=auto picks the stocked
      melee size that covers the most area
sculpt id=ring src=ring.stl fit=ring repair=auto
      an imported mesh (AI sculpt or scan) as part of the design. src: an
      asset id or a .stl/.obj/.glb file name (no folders outside the script's
      or the assets folder). fit=ring finds the finger hole at any angle and
      in any units, sizes the finished bore to the ring and turns the head
      up; overlapping shells (a head modelled on the band) become one piece.
      repair=auto keeps a mesh that is already a closed solid and rebuilds a
      broken one (voxel=0.15 mm, closing holes and smoothing once unless
      close= / smooth= say otherwise); repair=voxel always rebuilds; keep=
      largest drops debris; hollow=0.8 leaves a 0.8 mm wall; symmetrize=x+|x-;
      scale/x/y/z/rx/ry/rz place it by hand. Use shank profile=none when the
      sculpt is the whole ring (accents, strokes, regions and brushed pavé
      need a band; use surfpave on the sculpt instead).
surfpave id=p on=ring pts=x:y:z,… r=1.5 dia=auto setting=bead mirror=yes
      pavé brushed onto a sculpt; pts are brush centres in mm
accent … turn=90                    spin an accent about its axis (aim a pear)
pave dia=1.3 gap=0.15 bead=0.35    settings for brushed pavé (written once there is paint)
paint s=0 w=0 r=2                  one brush dab
rule min_wall=0.8 shrink=0         minimum wall checked; shrink = % scale on export

Positions on the band: s = mm along the outer surface from the top (positive
toward +x), w = mm across the band (0 = centre line). mirror=yes copies to -s.
ids must be unique; accent, stroke and region need one.
Cuts: round oval marquise pear heart cushion princess emerald asscher radiant
baguette tapered-baguette trillion hexagonal octagonal.
Metals: 9k/10k/14k/18k/22k gold (yellow, white, rose where made), platinum,
palladium, silver-925, titanium, stainless, brass, bronze, copper.
Metal is unioned into one exact solid (Manifold) with every stone seat cut,
so weights are exact and exports are a single watertight shell.
Checks: minimum wall (band profile and sculpts, with location), open metal,
metal not connected (exact, from the solid), stones in the finger bore,
stones overhanging the band, stones nothing holds, stones running into
another setting's metal (prongs, bezels, posts), metal under culets, edge
margin, overlaps, unstocked melee sizes, halos blocked by prongs.`;
