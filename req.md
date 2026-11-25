build this as a “Material Replacement Visualizer.” A designer uploads an existing room render, uploads a laminate/tile sample or selects a paint colour, and applies it to a selected surface while preserving the room’s design.

The important distinction: a JPG/PNG render is a flat image. We can preserve untouched areas exactly, but perfectly reconstructing material behaviour and lighting from that image alone is not guaranteed.

The product would work like this:
Step	Designer action	Application behaviour
1. Upload room render	Upload a bedroom, kitchen, or living-room image	Keep the original as the reference
2. Select surface	Click a wardrobe shutter, wall, floor, or panel	Suggest a selection; allow brush corrections
3. Upload material	Upload a laminate/tile sample, or select a paint colour	Prepare the material for application
4. Adjust application	Set grain direction, tile dimensions, pattern scale, and finish	Align the material to the surface’s perspective
5. Preview	Compare alternatives	Update the selected surface while retaining its boundaries and protected details
6. Export	Save the approved option	Export the image and selected material details


For example: upload a bedroom render, select the wardrobe shutters, and upload a walnut laminate. The wardrobe dimensions, shutter divisions, handles, bed, ceiling, and camera angle should stay fixed.

How we should build it for precision

A full-image generative edit should not be the core rendering method. I would use a controlled pipeline:
1. Surface selection: use a segmentation model to propose masks, with manual correction. Meta’s Segment Anything models support prompt-based image segmentation. A mask still needs validation around handles, thin edges, and overlapping furniture. Research - AI at Meta
2. Material preparation: crop and straighten the uploaded sample, remove photographed lighting where possible, and prepare repeatable textures. Adobe’s Image to Material workflow demonstrates this material-generation approach. Adobe Substance 3D Sampler
3. Perspective mapping: map the actual texture onto each selected plane. Let the designer confirm corners and one known dimension for accurate scale.
4. Lighting preservation: estimate the existing shading and combine it with the new texture. This is approximate because the original material and lighting are already mixed together.
5. Protected compositing: copy original pixels everywhere outside the approved editing mask. Protect handles, seams, and other details with separate masks.
6. Verification: automatically check that pixels outside the editing mask have not changed.
What precision can we promise?
Requirement	With a JPG/PNG input
Unselected areas remain identical	Yes, with controlled compositing and lossless export
Furniture placement and outlines remain unchanged	Yes, with correctly reviewed masks
Wood grain direction and tile pattern scale	Controllable; physical scale needs a known measurement
Existing shadows look convincing	Often achievable, but approximate
Matte wood becomes glossy marble with correct reflections	Cannot guarantee from one image
Exact real-world material colour	Cannot guarantee from an uncalibrated sample photo and display


There is also a trade-off: a physically correct material change can alter reflections or colour spill elsewhere in the room. Freezing every outside pixel deliberately preserves the original appearance instead.

For maximum accuracy, add an original-3D-model mode later. Changing materials on the existing mesh preserves geometry and allows the renderer to calculate lighting and reflections. UV mapping controls how textures sit on those surfaces.