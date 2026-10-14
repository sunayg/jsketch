# Mesh-to-parametric ring CAD: prior work review

Scope: turning AI-generated or scanned ring meshes (Meshy, Tripo, Hunyuan3D, Rodin, scans) into a parametric model that follows the mesh's own contours. Compiled October 2026.

Verification legend: **[V]** = checked against a primary or indexed source during this review. **[M]** = from memory of the literature and well known, but the link or detail was not re-fetched. **[U]** = uncertain; check before citing. Vendor claims are marketing unless stated otherwise.

---

## Executive summary (10 lines)

1. Your section-and-loft pipeline is the classic "feature-based reverse engineering" pattern (Várady, Martin and Cox 1997; Benkő, Martin and Várady 2001): segment by function, fit the simplest surface type per region, then rebuild topology. The literature supports keeping it.
2. Adopt the classic loft machinery: compatible re-parameterisation of sections (shared knot vector, consistent start point and orientation, arc-length or feature-aligned parameter) before skinning. Piegl and Tiller's skinning and Meyers, Skinner and Sloan (1992) cover the correspondence problem you will hit at the head.
3. Model prongs, split shanks and galleries as **generalized cylinders** (spine curve plus a varying cross-section). Get the spine from a curve skeleton (mean-curvature skeleton, available in CGAL) or a medial axis (Q-MAT or Coverage Axis spheres). Then fit radius or section profiles along it. SweepNet (2024) and Generalized Cylinder Decomposition (2015) show this abstraction is sound.
4. Use RANSAC primitive detection (Schnabel et al. 2007) only for the faceted or analytic parts: stone tables, pavilion facets, seat cones and flat gallery rails. Do not use it on the band or prongs.
5. Use the shape diameter function (SDF) for two jobs: segmentation (thin prongs and thick band separate cleanly) and castability, since local SDF approximates wall thickness.
6. Avoid learning-based CAD inference (DeepCAD, CAD-Recode, Point2CAD, SECAD-Net, Point2Cyl and others) as the core of the pipeline. All of them are trained on mechanical ABC, Fusion 360 or DeepCAD parts (sketch-plus-extrude or analytic B-rep). None of them reproduces swept, tapered, organic ring geometry. At most, Point2CAD's "segment, fit, intersect" structure is worth copying.
7. Commercial mesh-to-CAD tools (Geomagic Design X, Rhino, Fusion, SolidWorks ScanTo3D) are either human-guided feature wizards (Design X sketches sections from mesh slices and lofts them, which is your approach) or patch-surfacing (QuadRemesh to SubD to NURBS, which looks right but has no design intent). No jewellery CAD tool we found automatically turns a mesh into a parametric ring.
8. Stone and setting generation is solved parametrically in commercial jewellery CAD (MatrixGold, RhinoArtisan, TiaraCAD automatic pavé, prongs and cutters). Academic work is thin: Kielarova et al. 2016 halo-ring setting is about the only paper. Detecting a stone inside a fused AI mesh is an open problem.
9. Open problems you would be addressing: (a) segmenting fused head geometry (stone, prongs, gallery) without labelled jewellery data; (b) recovering stone cut and size from a blobby fused stone; (c) section correspondence across topology changes (where the shank splits or meets the head); (d) a design-intent-preserving parametric representation of organic prongs.
10. AI-to-castable-jewellery startups (Pencil, JewelArchitect, Ruby Kinglet, FormaNova and others, 2025–2026) mostly ship STL meshes or template-driven 3DM. None that we could verify does contour-faithful mesh-to-parametric conversion, so this looks like a real gap.

---

## 1. Reverse engineering and mesh-to-CAD (classic and commercial)

### 1.1 Várady, Martin and Cox: "Reverse engineering of geometric models—an introduction" [M]
- Computer-Aided Design 29(4):255–268, 1997. https://doi.org/10.1016/S0010-4485(96)00054-1
- **What it does.** Sets out the canonical pipeline: data capture, preprocessing, segmentation, surface-type classification (planes, quadrics, sweeps, free-form), fitting, and B-rep model creation. It argues that the hard part is segmentation and choosing the right surface type, not the fitting.
- **Relevance: high.** It gives the vocabulary and structure for your pipeline, and its taxonomy explicitly includes "translational and rotational sweeps" and "free-form" as surface classes. That maps directly to band sections (sweep) and head (free-form plus primitives).
- **Code:** none (survey).

### 1.2 Benkő, Martin and Várady: "Algorithms for reverse engineering boundary representation models" [M]
- Computer-Aided Design 33(11):839–851, 2001. https://doi.org/10.1016/S0010-4485(01)00100-2
- **What it does.** Segments point data into regions, classifies each region's surface type (including extrusions and rotational surfaces), fits it, and builds edge blends and vertex blends to stitch a B-rep together.
- **Relevance: high**, for its treatment of blends. Your band-to-head transitions and prong roots are blends. Fitting them as explicit blends between two fitted primary surfaces, rather than fitting them directly, is the lesson here.
- **Follow-up:** Benkő, Kós, Várady, Andor and Martin, "Constrained fitting in reverse engineering", Computer Aided Geometric Design 19(3), 2002 [M]. This adds constraints such as symmetry, parallelism and tangency during fitting. It is useful for enforcing mirror symmetry of a ring and equal prongs.
- **Code:** none.

### 1.3 Pottmann et al.: kinematic and sweep surface recognition [V]
- Pottmann, Leopoldseder, Wallner and Peternell, "Recognition and reconstruction of special surfaces from point clouds", ISPRS Archives 2002. https://miro.geometrie.tuwien.ac.at/geom/ig/peternell/cv2002.pdf
- Bartoň, Pottmann and Wallner, "Detection and reconstruction of freeform sweeps", Computer Graphics Forum 33(2), 2014. https://www.geometrie.tuwien.ac.at/ig/publications/2014/sweep2014/sweep2014.pdf (DOI 10.1111/cgf.12287)
- **What they do.** The 2002 paper uses line geometry. It fits a linear line complex to the surface normals to recover rotation axes, helical motions and translation directions, which identifies surfaces of revolution, pipe surfaces and similar. The 2014 paper detects which parts of a freeform surface are generated by a planar profile moving through space. It does this with an exhaustive search over planar cuts, comparing curvature plots, then global optimisation.
- **Relevance: high.** (a) The normal-based line-complex fit is a robust way to find the finger axis: a band is close to a surface of revolution around it. (b) The 2014 method is close to your design problem. It asks "is this region a sweep of a planar profile, and along which path?" It is effectively the principled version of your "is this slice a clean section, or does it bump relative to its neighbours?" test, and it generalises to prongs whose sweep path is not the finger axis.
- **Code:** not public as far as we know.

### 1.4 Surfaces from contours and skinning (lofting from sections) [M]
- Meyers, Skinner and Sloan, "Surfaces from contours", ACM Transactions on Graphics 11(3):228–258, 1992.
- Piegl and Tiller, *The NURBS Book*, 2nd ed., Springer 1997, chapter 10 on skinning. Also Piegl and Tiller, "Surface skinning revisited", The Visual Computer 18, 2002 [U on exact year and venue].
- Woodward, "Skinning techniques for interactive B-spline surface interpolation", Computer-Aided Design 20(8), 1988 [M].
- **What they do.** Meyers et al. formalise the four sub-problems of contour stacks: correspondence, tiling, branching and surface fitting. Branching covers one contour becoming two. Piegl and Tiller and Woodward cover making section curves compatible (same degree, merged knot vectors) and the knot-count blow-up this causes. "Surface skinning revisited" proposes approximate, not exact, knot compatibility to avoid that blow-up.
- **Relevance: high.** Your loft will break in three places: where the start point or orientation of sections drifts, which twists the loft; where control-point counts differ between adaptive sections; and where a section splits into islands (a split shank or prongs leaving the band). Meyers et al.'s branching treatment is the closest classical answer to the band-to-head topology change. Practical recipe: re-fit all band sections with one shared, fixed knot vector rather than a per-section adaptive count. Choose the count by the worst section. Align the start points by minimising rotation and phase, using a cyclic cross-correlation of curvature or a Fourier phase (see 2.6).
- **Code:** none specific. Most B-spline libraries implement skinning, for example OpenCASCADE `BRepOffsetAPI_ThruSections` and verb-nurbs (JavaScript).

### 1.5 Geomagic Design X ("mesh to CAD") [V, vendor]
- https://oqton.com/geomagic-designx/ ; feature chart: https://www.cadmicro.com/wp-content/uploads/Geomagic-DesignX-ComparisonChart-22V1-EN.pdf
- **What it does.** A human-guided feature-based reverse engineering tool. It segments a mesh into regions by curvature. Mesh Sketch creates sketch entities from mesh sections. Modeling Wizards auto-extract extrude, revolve, loft and sweep features from mesh regions. Its Accuracy Analyzer shows the deviation of the CAD model from the mesh.
- **Relevance: high**, as a product benchmark. Design X's "section to sketch to loft or sweep wizard" is essentially your prototype with a human in the loop, so it validates the approach. It also shows the UX you want: a deviation colour map, a per-section editable sketch, and the user choosing feature type per region. It has no jewellery knowledge (stones and settings).
- **Code:** commercial, closed.

### 1.6 Rhino (MeshToNURB, QuadRemesh to SubD to NURBS, ShrinkWrap) [V, vendor]
- https://wiki.mcneel.com/rhino/reverseengineering ; https://blog.rhino3d.com/2026/02/mastering-scan-to-model-workflows-in.html
- **What it does.** MeshToNURB makes one planar NURBS face per triangle, which is useless for editing. QuadRemesh, then ToSubD, then ToNURBS gives smooth patch layouts. ShrinkWrap (Rhino 8) produces a watertight wrapped mesh from messy input. McNeel's own guidance for real reverse engineering is still "use the mesh as reference and remodel".
- **Relevance: medium.** QuadRemesh to SubD is the "looks right, no intent" option: good for organic carving, bad for prongs and seats. ShrinkWrap and alpha-wrapping are useful as a preprocessing step for AI meshes (see 6.4). Third-party plugins Mesh2Surface and ReSurf do region-based surfacing [U on current versions].
- **Code:** commercial.

### 1.7 Fusion (Mesh to BRep, prismatic or faceted) and SolidWorks ScanTo3D [M/U]
- **What they do.** Fusion's Mesh workspace converts meshes to faceted or "prismatic" B-reps: prismatic recognises planes and cylinders from mesh face groups. It works on mechanical parts and is unhelpful on organic ones. SolidWorks ScanTo3D (in SolidWorks Premium) offers a Mesh Prep Wizard and a Surface Wizard. The Surface Wizard has an automatic patch mode and a guided feature-extraction mode that extracts sections for extrude, revolve and similar.
- **Relevance: low to medium.** These confirm that mainstream tools handle prismatic or analytic recognition and generic patching, but not swept organic features. We could not re-verify current feature details in this review.

### 1.8 Jewellery CAD tools: scan and mesh import [V, vendor, limited]
- **MatrixGold** (Gemvision/Stuller, Rhino-based): mesh repair tooling added in later updates. https://www.cadjewelleryskills.com/jewellery-tech-blog-topics/news/matrixgold-update-release-announced/ . No automatic mesh-to-parametric step found. Meshes are used as reference or kept as mesh bodies, and Rhino tools are used to remodel.
- **RhinoArtisan**: has a "Generative AI Studio" (bring your own fal.ai key) that produces organic meshes kept as meshes, plus a thickness analysis command. Automatic pavé works on surfaces, polysurfaces, meshes or SubD objects. https://rhinoartisan.com/docs/7/organic/generative-ai/ , https://docs.rhinoartisan.com/commands/diamonds/pave/automatic-pave , https://rhinoartisan.com/docs/7/tabs/analyze/thickness/
- **3Design** (Gravotech): imports STL, with a "clean your meshes" tool. https://novedge.com/products/buy-3design-pro
- **JewelCAD Pro, RhinoGold**: no mesh-to-parametric features found. One 2026 vendor article states RhinoGold is discontinued [U].
- **Relevance: high**, for positioning. The incumbents treat an imported mesh as an inert body. You can add stones, prongs and cutters on or into it (RhinoArtisan pavé can target a mesh), but the mesh's own shape never becomes editable parameters. This is the gap your product targets.

---

## 2. Primitive and surface-type fitting

### 2.1 Schnabel, Wahl and Klein: "Efficient RANSAC for point-cloud shape detection" [M]
- Computer Graphics Forum 26(2):214–226, 2007. https://doi.org/10.1111/j.1467-8659.2007.01016.x
- **What it does.** Detects planes, spheres, cylinders, cones and tori in noisy point clouds using localised sampling and an octree, scoring candidates by inlier count and normal agreement.
- **Relevance: medium to high, for the head.** Use it for stone faceting (table plane, crown and pavilion facets, girdle cylinder) and for setting geometry (seat cones, cylindrical bezel walls, gallery rails, tori for round wire). It is not the right tool for the band.
- **Code:** CGAL Shape Detection package (C++, includes Efficient RANSAC and region growing). https://doc.cgal.org/latest/Shape_detection/ . The original authors' library is also available. For the browser, a small JavaScript or WebAssembly RANSAC is easy to write for planes, spheres and cylinders.

### 2.2 Wang, Pottmann and Liu: "Fitting B-spline curves to point clouds by curvature-based squared distance minimization" [M]
- ACM Transactions on Graphics 25(2):214–238, 2006.
- **What it does.** Replaces point-distance (PDM) least squares, which requires a fixed parameterisation, with squared-distance minimisation (SDM). SDM uses a curvature-aware local quadratic approximation of the distance to the curve, so the foot-points slide. It converges faster and avoids the parameterisation artefacts of plain least squares.
- **Relevance: high.** Your section tracing is least squares with a fixed (chord-length, presumably) parameterisation. SDM or tangent-distance iterations give tighter fits with fewer control points, especially on asymmetric band profiles (comfort-fit, knife-edge). It is easy to implement in JavaScript.
- **Code:** no official code. The algorithm is short.

### 2.3 Adaptive knot placement for B-spline curve fitting [V citation only]
- Park and Lee, "B-spline curve fitting based on adaptive curve refinement using dominant points", Computer-Aided Design 39(6):439–451, 2007.
- Yeh, Nashed, Peterka and Tricoche, "Fast automatic knot placement method for accurate B-spline curve fitting", Computer-Aided Design 128, 2020 (feature-function based). https://www.cs.purdue.edu/homes/xmt/papers/Knot-Placement_CAD_2020.pdf [authors: M]
- **What they do.** Select "dominant points" (curvature extrema) as knot locations and refine until within tolerance, or place knots by integrating a feature function such as the cube root of curvature.
- **Relevance: high**, but note the tension with lofting. Adaptive knots per section break loft compatibility. Use adaptive placement on a representative section, or on the union of dominant parameters across all band sections, and then use that one knot vector for every section.

### 2.4 ParSeNet (Sharma et al., ECCV 2020) [M]
- "ParSeNet: A parametric surface fitting network for 3D point clouds". https://arxiv.org/abs/2003.12181 . Code: https://github.com/Hippogriff/parsenet-codebase [U on URL]
- **What it does.** Segments point clouds and fits primitives plus open or closed B-spline patches, including a learned B-spline patch predictor.
- **Relevance: low to medium.** It is trained on ABC mechanical parts, but its "closed B-spline patch" handling and its segmentation-then-fit split are a useful reference.

### 2.5 Generalized cylinders, sweeps and skeleton-based tubular fitting
- **Generalized Cylinder Decomposition**: Zhou, Yin, Huang, Zhang, Gong and Cohen-Or, SIGGRAPH Asia 2015 (ACM TOG 34(6)). https://www2.cs.sfu.ca/~haoz/pubs/zhou_siga15_gcd.pdf [V]. It decomposes a mesh into generalized cylinders by scoring "cylindricity" with a minimum-description-length cost: skeletal curve plus cross-section profiles. It builds an over-complete cover and then selects an exact cover by global optimisation. **Relevance: high.** This is the formal version of "band = one GC along the finger axis; each prong = one GC along its own spine; shoulders and split shanks = GCs". The MDL cylindricity cost is a principled way to decide "loftable vs not" in place of your bump heuristic. Code: unknown or not public [U].
- **SweepNet**: Zhao, Wang, Yu, Zou and Mahdavi-Amiri, ECCV 2024. https://arxiv.org/abs/2407.06305 , project page https://mingrui-zhao.github.io/SweepNet [V]. Unsupervised shape abstraction into sweep surfaces, with a superellipse profile and a B-spline spine, in about 14 floats per sweep. **Relevance: medium to high**, as a representation idea. "Superellipse cross-section plus B-spline spine plus scale profile" is a compact, editable prong parameterisation: round, square or knife-edge prongs are all superellipses. Code linked from the project page.
- **Neural Generalized Cylinder** (arXiv 2410.03675, 2024) [V title only]: controllable shape modelling with GCs. **Relevance: low to medium** as a reference for editing GC-parameterised shapes.
- **Mean Curvature Skeletons**: Tagliasacchi, Alhashim, Olson and Zhang, SGP 2012 (CGF 31(5)) [V]. Robust curve skeleton by mean-curvature-flow contraction, with medial correction. Code: CGAL Triangulated Surface Mesh Skeletonization (https://doc.cgal.org/latest/Surface_mesh_skeletonization/), which needs a closed, single-component mesh. Original code: github.com/taiya/starlab-mcfskel. **Relevance: high.** It gives prong centrelines and the shank or gallery wire graph. The skeleton-to-surface correspondence it outputs gives you, per skeleton point, the mesh vertices to fit a local cross-section or radius to.
- **Skeleton extraction by mesh contraction**: Au, Tai, Chu, Cohen-Or and Lee, SIGGRAPH 2008 [M]. The predecessor of MCF skeletons. It also gives skeleton-based segmentation.
- **Practical recipe for prongs:** skeleton branch, then smooth the spine with a B-spline (SDM fit, 2.2), then sample orthogonal planes along the spine and fit a closed section at each (circle, superellipse or B-spline), then fit radius r(s) as a 1D spline, then model the tip as a terminal cap (hemisphere, claw, V, or bead). Fit the tip by comparing the last 10–20% of length against a small library of parametric caps.

### 2.6 Fourier descriptors for closed curves [M]
- Zahn and Roskies, "Fourier descriptors for plane closed curves", IEEE Transactions on Computers C-21(3), 1972.
- Kuhl and Giardina, "Elliptic Fourier features of a closed contour", Computer Graphics and Image Processing 18(3):236–258, 1982.
- **What they do.** Represent a closed contour by Fourier coefficients of x(t) and y(t). Low harmonics capture shape. Phase gives start-point and rotation normalisation.
- **Relevance: medium to high, as auxiliaries rather than the representation.** Use them (a) to align start points and orientation across sections before lofting (phase of the first harmonic); (b) as a cheap per-section shape signature to detect "this section differs from neighbours" (head detection), and to cluster similar sections; (c) to smooth noisy AI sections by truncating harmonics. Keep B-splines as the editable representation, because jewellery profiles have corners (knife-edge, flat-top) that Fourier series ring on.

---

## 3. Learning-based CAD program inference

General verdict: all of these are trained on mechanical CAD datasets (ABC, DeepCAD, Fusion 360 Gallery). Outputs are sketch-plus-extrude sequences, analytic B-reps or CSG. None handle swept, tapered, organic ring geometry or gemstones. They are useful for ideas, not as a component. **Plausibility on rings: low** for all, unless noted.

| Item | Year, venue | Output | Code | Notes for us |
|---|---|---|---|---|
| **CSGNet**: Sharma et al. https://arxiv.org/abs/1712.08290 [M] | CVPR 2018 | CSG program (2D/3D primitives) | yes (github.com/hippogriff/CSGNet) [U URL] | Low. Primitive CSG cannot express sweeps. |
| **InverseCSG**: Du, Inala, Pu, Wu, Solar-Lezama, Matusik et al. [M] | SIGGRAPH Asia 2018 | CSG via program synthesis | released by authors [U URL] | Low. Mechanical solids only. |
| **ShapeAssembly**: Jones et al. [M] | SIGGRAPH Asia 2020 | cuboid-assembly programs | github.com/rkjones4/ShapeAssembly [U URL] | Low. Idea of "part programs" is relevant, geometry is not. |
| **DeepCAD**: Wu, Xiao and Zheng. https://arxiv.org/abs/2105.09492 [M] | ICCV 2021 | sketch+extrude sequence | github.com/ChrisWu1997/DeepCAD [M] | Low. Sketch+extrude only; the dataset is reused by most later work. |
| **Point2Cyl**: Uy, Chang, Sung, Goel, Lambourne, Birdal and Guibas. https://arxiv.org/abs/2112.09329 [V] | CVPR 2022 | extrusion cylinders (sketch+axis+range) | yes (github.com/mikacuy/point2cyl) [U URL] | Low to medium. Its closed-form "base/barrel" segmentation plus axis estimation is conceptually like our sweep detection. |
| **ExtrudeNet**: Ren et al. [M] | ECCV 2022 | sketch+extrude (self-supervised) | [U] | Low. |
| **ComplexGen**: Guo, Liu, Pan, Liu, Tong and Guo. https://arxiv.org/abs/2205.14573 [V] | SIGGRAPH 2022 | B-rep chain complex | yes, per Papers-with-Code (github.com/guohaoxiang/ComplexGen) [U URL] | Low to medium. Interesting topology-consistency formulation; analytic patches only. |
| **SECAD-Net**: Li et al. https://arxiv.org/abs/2303.10613 [V] | CVPR 2023 | sketch+extrude, implicit sketches, union | github.com/BunnySoCrazy/SECAD-Net [V] | Low. |
| **Point2CAD**: Liu, Obukhov, Wegner and Schindler. https://arxiv.org/abs/2312.04962 [V] | CVPR 2024 | B-rep: analytic + neural freeform surfaces, intersected | github.com/YujiaLiu76/point2cad [V] | **Medium.** Key finding: ML matters mostly for segmentation; fitting and topology can be classical. That is the architecture we should follow. |
| **CAD-SIGNet**: Khan et al. [V title] | CVPR 2024 | sketch+extrude language | [U] | Low. |
| **Text2CAD**: Khan et al. [V] | NeurIPS 2024 | sketch+extrude from text | github.com/SadilKhan/Text2CAD [U URL] | Low. |
| **CAD-MLLM**: Xu, Wang, Zhao, Liu, Ma and Gao. https://arxiv.org/abs/2411.04954 [V] | arXiv 2024 | sketch+extrude from text, image or point cloud | [U] | Low. |
| **CAD-Recode**: Rukhovich et al. (Univ. Luxembourg / Artec3D). https://arxiv.org/abs/2412.14042 [V] | ICCV 2025 | CadQuery Python code (Qwen2-1.5B decoder) | github.com/filaPro/cad-recode [V] | Low to medium. The "emit executable CAD code via LLM" pattern is attractive (editable, readable), but the training data is procedural sketch+extrude. A jewellery DSL with procedural training data is a plausible future direction for us. |
| **CADDreamer** [V] | CVPR 2025 | B-rep (primitive-based) from a single image | [U] | Low. |
| **MeshCoder**. https://arxiv.org/abs/2508.14879 [V] | arXiv 2025 | part-structured Blender Python from point clouds (41 categories, ~1M pairs) | Hugging Face InternRobotics/MeshCoder, CC-BY-NC-SA, gated [V] | Low to medium. The closest to "AI mesh to editable part program", but furniture- and object-level, not jewellery-precise. The non-commercial licence matters. |
| **Mesh2Brep** (IEEE Xplore doc 10824954) [V title, U details] | ~2025 | B-rep from meshes, handling primitives in smoothly blended regions | [U] | Medium, as a reference on blends. |
| **DreamCAD**. https://arxiv.org/abs/2603.05607 [V] | arXiv 2026 | C0 Bézier patch B-rep, trained on unannotated meshes | [U] | Low to medium. Learns patch CAD from plain meshes (relevant to our "no labelled data" setting), but outputs patches, not design intent. |

**What to take from this area:** (1) Point2CAD's split: learned or heuristic segmentation, then classical fitting, then topology by intersection. (2) The CAD-Recode or MeshCoder idea of a code or DSL output. Our parametric ring model could be serialised as a small program (band sections, prong sweeps, stone, seats), which could later become a target for a learned model trained on procedurally generated rings.

**What to avoid:** expecting any of these to work zero-shot on Meshy or Tripo rings. There is no jewellery training data, and the representations cannot express tapered sweeps or gems.

---

## 4. Mesh segmentation into functional parts

### 4.1 Shape Diameter Function (SDF) segmentation [M]
- Shapira, Shamir and Cohen-Or, "Consistent mesh partitioning and skeletonisation using the shape diameter function", The Visual Computer 24(4):249–259, 2008.
- **What it does.** For each face, it casts a cone of rays inward opposite the normal and takes a robust mean of hit distances, which gives a local "thickness". It then segments with GMM clustering plus graph-cut on SDF values. The result is pose-invariant and consistent across similar shapes.
- **Relevance: high.** Prongs (about 0.6–1.2 mm), band (about 1.5–2.5 mm) and stone (several mm) occupy clearly separated SDF ranges. SDF is the best unsupervised first cut for "prong vs band vs stone blob", and the same values feed castability (Section 6).
- **Code:** CGAL Triangulated Surface Mesh Segmentation (`sdf_values`, `segmentation_from_sdf_values`). https://doc.cgal.org/latest/Surface_mesh_segmentation/ . A GPU or three-mesh-bvh ray-cast version is straightforward in the browser.

### 4.2 Skeleton-based segmentation [M]
- Au et al. 2008 (mesh contraction) and Tagliasacchi et al. 2012 both give a skeleton-to-vertex mapping. Skeleton junctions split the mesh into branches (prongs) and the ring loop (band).
- **Relevance: high.** A ring's skeleton is a loop (band) with a subgraph (head) attached. Prongs are leaf branches ending at tips. This gives a topological definition of "head" that is more robust than per-slice island detection. Combine it with your slicing: slices whose half-plane intersects non-loop skeleton branches are head.

### 4.3 Generalized Cylinder Decomposition (see 2.5)
- Doubles as a segmentation method. Particularly apt because rings are mostly unions of GCs.

### 4.4 Learned part segmentation (PartNet-trained networks, SAMPart3D, PartField and others) [M/U]
- Recent "segment anything in 3D" methods (2024–2025, for example SAMPart3D and PartField) segment arbitrary meshes into parts without category training, using 2D foundation-model features lifted to 3D.
- **Relevance: medium.** They may separate a fused stone from metal on AI meshes, especially if the generator's texture or colour carries a "gem vs metal" cue. Use the albedo of Meshy or Tripo textured outputs; it is a strong, cheap signal we should not ignore. They are heavyweight (server-side GPU). Not verified in this review.

### 4.5 Jewellery-specific segmentation
- **No academic paper found** on segmenting ring meshes into shank, head, prongs and stones. The only adjacent hit was a 2D gemstone image-segmentation patent (USPTO "Optical weight estimation system", U-Net on images, not meshes). **Open problem we would be addressing.**

---

## 5. Jewellery-specific computational work

### 5.1 Kielarova (Wannarumon) et al.: automatic gemstone setting on halo rings [V]
- "Development of computer-aided design module for automatic gemstone setting on halo ring", KKU Engineering Journal / Engineering and Applied Science Research, 2016. https://ph01.tci-thaijo.org/index.php/easr/article/view/70200
- **What it does.** RhinoScript modules that parametrically place centre, side and accent stones around a halo. Stone size, cut, spacing, prong size and shape, and metal shrinkage are written as explicit relations. The authors report about 67–70% time savings.
- **Relevance: medium to high.** A rare published parametric spec of setting relations: prong diameter versus stone size, stone spacing, and shrinkage allowance. It is a good source for default rules once we detect a stone.
- The same group published generative jewellery design work: Santa Fe Symposium 2019, "Make your jewelry design 'pop' with generative design" (interactive GA plus multi-objective GA in Grasshopper and Octopus). https://www.santafesymposium.org/2019-santa-fe-symposium/2019-make-your-jewelry-design-pop-with-generative-design [V listing]. Earlier work includes Wannarumon and Bohez on jewellery CAD and rapid prototyping, around 2004–2006 [M/U]. **Code:** none.

### 5.2 Santa Fe Symposium on Jewelry Manufacturing Technology (proceedings) [M]
- https://www.santafesymposium.org/ : annual proceedings (papers free online) with the industry's best technical material on casting defects, investment, platinum casting, 3D-printed wax and resin patterns, sprue design and minimum section thicknesses.
- **Relevance: high**, for castability rules and default parameters. It is not academic geometry-processing work, but it is authoritative for the manufacturing side.

### 5.3 Commercial parametric settings (MatrixGold, RhinoArtisan, TiaraCAD, JewelBeetle) [V, vendor]
- Automatic pavé (gem packing on a surface or mesh from an origin point or from edges), automatic prongs between gems, cutters (seat-cutting solids subtracted from metal), gem libraries with standard cuts and proportions. RhinoArtisan's scripting API: "meshes it at high resolution and packs diamonds across it automatically, optionally adding prongs and cutters". https://rhinoartisan.com/docs/scripting/reference/gemsets/pave-on-surface/
- **Relevance: high**, as a feature-parity target. Once we have a stone (cut and size) and a fitted head, the "cutter" pattern is how seats are made: a parametric solid, cone plus cylinder below the girdle, subtracted from prongs and gallery. That is what turns a "fused blob" into a seat. No public algorithm descriptions exist. For pavé, the standard academic tools are surface circle packing or Lloyd relaxation on a mesh (geodesic centroidal Voronoi). We found no jewellery-specific paper.

### 5.4 AI-to-jewellery companies (2024–2026) [V existence, vendor claims unverified]
- **Pencil** (AI jewellery CAD agent; stone settings and editable templates), **JewelArchitect** (sketch to STL, https://jewelarchitect.com/), **Ruby Kinglet** (AI-to-CAD plus "Rhino-backed parametric" 3DM editing for common engagement-ring styles, https://www.rubykinglet.ai/cad), **FormaNova**, **Diatech**, **Neural4D** (generic image-to-3D marketed to jewellers), **Meshy** jewellery use-case page, and **RhinoArtisan Generative AI Studio**.
- Consensus across these, mostly self-published, sources: AI meshes are "a head start". Stone seats, wall uniformity and micro-pavé still need a CAD jeweller. Where editable output exists (Ruby Kinglet), it appears to come from **templates** (swap shank, head or stone), not from fitting the AI mesh's own contours.
- **Relevance: high**, as competitive context. Contour-faithful mesh-to-parametric conversion appears unclaimed. Template substitution is the competitor approach we deliberately differ from.

---

## 6. Thin structures, wall thickness and mesh repair for casting

### 6.1 Medial axis approximations: Q-MAT and Coverage Axis [M]
- Li, Wang, Sun, Guo, Zhang and Wang, "Q-MAT: Computing medial axis transform by quadratic error minimization", ACM TOG 35(1), 2015.
- Dou et al., "Coverage Axis: Inner point selection for 3D shape skeletonization", Computer Graphics Forum (Eurographics) 2022. Coverage Axis++ followed in 2024 [U].
- **What they do.** Compact medial-sphere sets that approximate the shape. Sphere radii along medial curves give thickness directly.
- **Relevance: medium to high.** For prongs, a chain of medial spheres is exactly "centreline plus radius profile". It is a cleaner alternative to fitting sections when prongs are nearly circular. It also gives min-thickness maps.

### 6.2 SDF and ray-based thickness for castability (see 4.1)
- Cheap per-face thickness, and the industry-standard way to show thin-wall maps (RhinoArtisan Thickness, Materialise Magics, Netfabb).
- **Rules of thumb from vendors** [V, vendor guidance, not standards]: about 0.8 mm minimum for structural or external walls, about 0.5–0.6 mm for claws and bezels (Cooksongold), and rods at least 0.8 mm diameter (Materialise). https://www.cooksongold.com/downloads/files/Cooksongold%203D%20Precious%20Metal%20Printing%20Design%20Guidelines.pdf
- **Relevance: high.** It makes castability checks a by-product of segmentation.

### 6.3 Sprue placement and casting simulation
- **No strong open academic work found** for jewellery sprue placement. The industry uses rules (sprue to the thickest section, directional solidification) and commercial casting simulation (MAGMA, ProCAST, ...). Santa Fe Symposium papers are the best source. **Relevance: low for now.** Mark it as a later heuristic feature.

### 6.4 Mesh repair and robust booleans for browser use [M]
- **Alpha wrapping**: Portaneri, Rouxel-Labbé, Hemmer, Cohen-Steiner and Alliez, "Alpha wrapping with an offset", ACM TOG (SIGGRAPH) 2022. CGAL 3D Alpha Wrapping. It produces a guaranteed watertight, manifold, intersection-free wrap of a messy AI mesh, which is what Rhino ShrinkWrap does conceptually. **High**, as a preprocessing step before skeletonisation (which needs closed, single-component input) and SDF.
- **MeshFix**: Attene, "A lightweight approach to repairing digitized polygon meshes", The Visual Computer 2010 [M]. **Medium.**
- **fTetWild**: Hu et al., SIGGRAPH 2020 [M]. Robust tetrahedralisation and wrapping. **Low to medium** (heavy).
- **Manifold** (Emmett Lalish; github.com/elalish/manifold, npm `manifold-3d`, WebAssembly) [M]. Guaranteed-manifold mesh booleans that run in the browser. **High.** Seat cutting (stone cutter subtraction), unioning prongs to the band, and ensuring a watertight export are all boolean operations on meshes from our parametric model.

---

## Recommended reading order (7 items)

1. Várady, Martin and Cox 1997, "Reverse engineering of geometric models—an introduction". The framework and vocabulary.
2. Bartoň, Pottmann and Wallner 2014, "Detection and reconstruction of freeform sweeps". The closest academic match to band and prong sweep recovery.
3. Zhou et al. 2015, "Generalized Cylinder Decomposition". The segmentation and representation for prongs, shanks and galleries.
4. Tagliasacchi et al. 2012, "Mean Curvature Skeletons", with the CGAL docs. Prong centrelines and the head-vs-band topology.
5. Shapira, Shamir and Cohen-Or 2008, "Shape Diameter Function". Unsupervised part separation plus thickness.
6. Wang, Pottmann and Liu 2006, "B-spline curve fitting by squared distance minimization", plus Piegl and Tiller's skinning chapter. Better section fits and compatible lofts.
7. Liu et al. 2024, "Point2CAD". The segment, fit, intersect architecture, and why ML belongs only in segmentation.
8. Optional: Kielarova et al. 2016 halo-ring setting module, and the Santa Fe Symposium proceedings, for setting and casting rules.

---

## Concrete techniques to adopt in our pipeline

**Preprocessing**
- Alpha-wrap or shrink-wrap the AI mesh (CGAL alpha wrapping offline, or a voxel or SDF remesh in the browser) to get a closed, single-component manifold. This is required for skeletons and SDF.
- Finger-axis estimation: fit a surface of revolution to the band. Use Pottmann's line-complex fit on normals, or simply the least-squares axis that minimises the variance of radial distance of inner-surface points. Refine on inner-surface points only, flagged by inward-facing normals.
- Use texture albedo, when the generator provides it, as a prior for stone vs metal.

**Band (sections and loft)**
- Keep half-plane slicing, but switch the fit to **SDM / tangent-distance B-spline fitting** (Wang, Pottmann and Liu 2006) with **one shared knot vector** across all band sections. Pick knots from the union of dominant points (Park and Lee 2007 style), or use a fixed count chosen by the worst section's tolerance.
- **Section correspondence:** normalise each section's start point and orientation. Use the angle from the finger axis at the inner-most point, or the first-harmonic elliptic Fourier phase (Kuhl and Giardina), and force consistent CCW orientation. Then re-parameterise by arc length, with feature points (sharp corners) pinned to the same parameter values across sections.
- Represent the band parametrically as **profile(θ) = blend of a few key sections + smooth width, thickness and taper functions of θ**. Fit key sections where curvature-of-parameters changes, and let users edit key sections and taper curves rather than 72 raw sections. The 72 sections become the fitting data, not the model.
- Replace the "bump vs neighbours" head test with: (a) skeleton topology (the slice plane intersects non-loop skeleton branches); (b) an SDF outlier test; (c) a cylindricity or MDL residual of a sweep fit across a window of sections (GCD-style).

**Prongs and wires**
- Segment by skeleton branch plus SDF range. For each prong: fit a spine B-spline to skeleton points; sample orthogonal sections; fit a **superellipse** section (SweepNet-style: covers round, square, oval and knife-edge with 2–3 params) or a B-spline if the residual is high; fit radius or scale r(s) as a 1D spline. Classify the tip against a parametric cap library (round, claw or pointed, V, flat, bead) by residual. Store the prong as {spine, section type and params, r(s), tip type and params, root blend radius}.
- Alternative or check: chain of medial spheres (Q-MAT or Coverage Axis) gives r(s) directly.
- Enforce symmetry: detect the ring's mirror plane and the head's rotational symmetry (n-fold prongs) and fit prongs jointly with shared parameters (Benkő et al. 2002 constrained fitting).

**Stones and seats**
- Stone region: SDF-thick blob above the head plus albedo prior, often roughly convex. Estimate the stone axis by symmetry (rotational symmetry of the blob about its PCA axis). Find the girdle as the maximal cross-section perpendicular to the axis, and the table as the top plane (RANSAC plane).
- Cut classification: fit the girdle outline to round, oval, cushion, princess, emerald, pear, marquise and other templates. Use superellipse or Fourier descriptors of the girdle outline (aspect ratio plus corner sharpness distinguish most cuts). Snap size to standard mm or carat sizes. Do not try to recover facets from AI meshes; replace the stone with a parametric gem of the detected cut and size.
- Seats: generate the industry-standard **cutter** (girdle cylinder plus pavilion cone at the cut's pavilion angle, plus a clearance bore) and boolean-subtract it from prongs and gallery with Manifold (WebAssembly). Seat height on each prong comes from the girdle plane.
- Pavé (later): geodesic Lloyd relaxation or circle packing on the fitted surface region, plus shared-prong placement at triangle gaps (the established commercial pattern).

**Castability**
- Per-face SDF or ray thickness heatmap with thresholds (about 0.8 mm walls, about 0.5–0.6 mm claws, ≥0.8 mm rods, metal-dependent). Since the parametric model knows each part's type, apply part-specific thresholds and offer "thicken to minimum" as a parameter edit (raise r(s) or section thickness), not a mesh offset.

**Architecture**
- Follow Point2CAD's lesson: keep fitting and topology classical and deterministic. Reserve learning, if any, for segmentation (stone, prong, band) and possibly cut classification. Serialise the result as a small ring DSL, which later enables CAD-Recode-style learned inference trained on procedurally generated rings.

**Open problems (where we would be novel)**
- Unsupervised functional segmentation of fused AI ring meshes.
- Stone cut and size inference from a fused, faceless stone blob.
- Loft correspondence through topology changes at shoulders and split shanks (Meyers et al. 1992 branching is the classical starting point).
- A compact, design-intent-preserving parametric vocabulary for organic prongs and galleries that is fitted to the mesh, not substituted from a library.
