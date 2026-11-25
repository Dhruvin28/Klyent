"""Headless Blender (Cycles) renderer for Interior 3D.

Usage:
  blender -b -P render_scene.py -- scene.json out.png width height samples [threads]

scene.json is produced by compileScene() in ../scene.ts (Blender axes, metres). The
script builds physically based materials, a sky + sun (or night) environment, the
fixture lights and the camera, then renders with Cycles + OpenImageDenoise.
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
scene_path, out_path, width, height, samples = argv[0], argv[1], int(argv[2]), int(argv[3]), int(argv[4])
threads = int(argv[5]) if len(argv) > 5 else 0
spec = json.load(open(scene_path, "r", encoding="utf-8"))
base_dir = os.path.dirname(os.path.abspath(scene_path))


def hex_rgb(h, default=(0.8, 0.8, 0.8)):
    try:
        h = h.lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))

        def lin(c):
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

        return (lin(r), lin(g), lin(b))
    except Exception:
        return default


def set_input(node, names, value):
    for n in names if isinstance(names, (list, tuple)) else [names]:
        if n in node.inputs:
            try:
                node.inputs[n].default_value = value
                return True
            except Exception:
                pass
    return False


# ── reset ──
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.engine = "CYCLES"
cy = scn.cycles
cy.samples = samples
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.01
cy.max_bounces = 8
cy.diffuse_bounces = 4
cy.glossy_bounces = 4
cy.transmission_bounces = 4
# Hard wall-clock budget per frame (seconds): Cycles stops sampling, then denoises what it has.
try:
    cy.time_limit = float(os.environ.get("BLENDER_TIME_LIMIT", "900"))
except Exception:
    pass
cy.transparent_max_bounces = 16
cy.sample_clamp_indirect = 8.0
cy.caustics_reflective = False
cy.caustics_refractive = False
try:
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
except Exception:
    pass
try:
    cy.use_light_tree = True
except Exception:
    pass
if threads > 0:
    scn.render.threads_mode = "FIXED"
    scn.render.threads = threads

# GPU if the host has one and asks for it (BLENDER_DEVICE=gpu); otherwise CPU.
if os.environ.get("BLENDER_DEVICE", "cpu").lower() == "gpu":
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                devs = [d for d in prefs.devices if d.type != "CPU"]
                if devs:
                    for d in prefs.devices:
                        d.use = d.type != "CPU"
                    cy.device = "GPU"
                    break
            except Exception:
                continue
    except Exception:
        pass

scn.render.resolution_x = width
scn.render.resolution_y = height
scn.render.resolution_percentage = 100
scn.render.image_settings.file_format = "PNG"
scn.render.image_settings.color_mode = "RGB"
scn.render.image_settings.color_depth = "16"
scn.render.filepath = out_path
for transform, look in (("AgX", "AgX - Punchy"), ("AgX", "None"), ("Filmic", "Medium High Contrast"), ("Standard", "None")):
    try:
        scn.view_settings.view_transform = transform
        scn.view_settings.look = look
        break
    except Exception:
        continue
scn.view_settings.exposure = math.log2(max(0.1, spec["world"].get("exposure", 1.0)))

# ── materials ──
materials = {}
image_cache = {}


def load_image(path):
    if path in image_cache:
        return image_cache[path]
    img = None
    try:
        img = bpy.data.images.load(path if os.path.isabs(path) else os.path.join(base_dir, path))
    except Exception:
        img = None
    image_cache[path] = img
    return img


def pattern_nodes(nt, bsdf, m):
    """Procedural wood / fabric / plaster detail so untextured finishes read as real materials."""
    base = hex_rgb(m["color"])
    pat = m.get("pattern")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(tc.outputs["UV"], mapping.inputs["Vector"])
    if pat == "wood":
        # Grain: stretched wave bands distorted by noise, plus plank seams from a brick texture.
        mapping.inputs["Scale"].default_value = (1.0, 7.0, 1.0)
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.inputs["Scale"].default_value = 14.0
        wave.inputs["Distortion"].default_value = 5.0
        wave.inputs["Detail"].default_value = 3.0
        wave.inputs["Detail Scale"].default_value = 1.5
        nt.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.25
        ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.55, 1)
        ramp.color_ramp.elements[1].position = 0.9
        ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
        nt.links.new(wave.outputs["Color"], ramp.inputs["Fac"])
        brick = nt.nodes.new("ShaderNodeTexBrick")
        mp2 = nt.nodes.new("ShaderNodeMapping")
        mp2.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        nt.links.new(tc.outputs["UV"], mp2.inputs["Vector"])
        nt.links.new(mp2.outputs["Vector"], brick.inputs["Vector"])
        brick.inputs["Scale"].default_value = 3.0
        brick.inputs["Mortar Size"].default_value = 0.004
        brick.inputs["Brick Width"].default_value = 0.4
        brick.inputs["Row Height"].default_value = 0.05
        brick.inputs["Color1"].default_value = (1, 1, 1, 1)
        brick.inputs["Color2"].default_value = (0.9, 0.9, 0.9, 1)
        brick.inputs["Mortar"].default_value = (0.25, 0.25, 0.25, 1)
        mul = nt.nodes.new("ShaderNodeMixRGB")
        mul.blend_type = "MULTIPLY"
        mul.inputs["Fac"].default_value = 1.0
        nt.links.new(ramp.outputs["Color"], mul.inputs["Color1"])
        nt.links.new(brick.outputs["Color"], mul.inputs["Color2"])
        tint = nt.nodes.new("ShaderNodeMixRGB")
        tint.blend_type = "MULTIPLY"
        tint.inputs["Fac"].default_value = 1.0
        tint.inputs["Color1"].default_value = (base[0], base[1], base[2], 1)
        nt.links.new(mul.outputs["Color"], tint.inputs["Color2"])
        nt.links.new(tint.outputs["Color"], bsdf.inputs["Base Color"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        bump.inputs["Distance"].default_value = 0.002
        nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        return True
    if pat in ("fabric", "plaster"):
        noise = nt.nodes.new("ShaderNodeTexNoise")
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        noise.inputs["Scale"].default_value = 420.0 if pat == "fabric" else 35.0
        noise.inputs["Detail"].default_value = 8.0
        noise.inputs["Roughness"].default_value = 0.65
        var = nt.nodes.new("ShaderNodeMixRGB")
        var.blend_type = "MULTIPLY"
        var.inputs["Fac"].default_value = 0.35 if pat == "fabric" else 0.12
        var.inputs["Color1"].default_value = (base[0], base[1], base[2], 1)
        nt.links.new(noise.outputs["Color"], var.inputs["Color2"])
        # Fac blends flat colour toward colour*noise, keeping the finish colour dominant.
        nt.links.new(var.outputs["Color"], bsdf.inputs["Base Color"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35 if pat == "fabric" else 0.12
        bump.inputs["Distance"].default_value = 0.001
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        if pat == "fabric":
            set_input(bsdf, ["Sheen Weight", "Sheen"], 0.6)
            set_input(bsdf, ["Sheen Roughness"], 0.5)
        return True
    return False


def make_material(m):
    mat = bpy.data.materials.new(m["id"])
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    kind = m["type"]
    if kind == "glass":
        # Clear pane without refraction (fast, noise-free, lets sun through): transparent
        # mixed with a Fresnel-weighted mirror so reflections still read.
        transp = nt.nodes.new("ShaderNodeBsdfTransparent")
        gloss = nt.nodes.new("ShaderNodeBsdfGlossy")
        gloss.inputs["Roughness"].default_value = 0.02
        fres = nt.nodes.new("ShaderNodeLayerWeight")
        fres.inputs["Blend"].default_value = 0.12
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fres.outputs["Fresnel"], mix.inputs["Fac"])
        nt.links.new(transp.outputs["BSDF"], mix.inputs[1])
        nt.links.new(gloss.outputs["BSDF"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
        return mat
    if kind == "emissive":
        em = nt.nodes.new("ShaderNodeEmission")
        c = hex_rgb(m["color"])
        em.inputs["Color"].default_value = (c[0], c[1], c[2], 1)
        em.inputs["Strength"].default_value = float(m.get("strength", 6.0))
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        return mat
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    c = hex_rgb(m["color"])
    bsdf.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
    bsdf.inputs["Roughness"].default_value = float(m["roughness"])
    bsdf.inputs["Metallic"].default_value = float(m.get("metalness", 0.0))
    # Real-world dielectrics have a clear specular layer; lower roughness gets a coat.
    if m["roughness"] < 0.5 and m.get("metalness", 0) < 0.5:
        set_input(bsdf, ["Coat Weight", "Clearcoat"], 0.15)
        set_input(bsdf, ["Coat Roughness", "Clearcoat Roughness"], max(0.03, m["roughness"] * 0.6))
    tex = m.get("texture")
    if tex:
        img = load_image(tex["file"])
        if img is not None:
            tc = nt.nodes.new("ShaderNodeTexCoord")
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (tex["repeat"][0], tex["repeat"][1], 1.0)
            mp.inputs["Rotation"].default_value = (0.0, 0.0, float(tex["rotation"]))
            nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
            it = nt.nodes.new("ShaderNodeTexImage")
            it.image = img
            it.extension = "REPEAT"
            it.interpolation = "Cubic"
            nt.links.new(mp.outputs["Vector"], it.inputs["Vector"])
            nt.links.new(it.outputs["Color"], bsdf.inputs["Base Color"])
            return mat
    if m.get("pattern"):
        try:
            pattern_nodes(nt, bsdf, m)
        except Exception as e:  # never lose the render over a decorative node
            print("pattern failed", m.get("pattern"), e)
    return mat


for m in spec["materials"]:
    materials[m["id"]] = make_material(m)
default_mat = bpy.data.materials.new("default")
default_mat.diffuse_color = (0.7, 0.7, 0.7, 1)

# ── geometry ──
coll = bpy.context.scene.collection


def build_mesh(ms):
    me = bpy.data.meshes.new(ms["name"])
    pos = ms["positions"]
    verts = [(pos[i], pos[i + 1], pos[i + 2]) for i in range(0, len(pos), 3)]
    idx = ms["indices"]
    faces = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    uvs = ms["uvs"]
    for loop in me.loops:
        vi = loop.vertex_index
        uv.data[loop.index].uv = (uvs[vi * 2], uvs[vi * 2 + 1])
    if ms.get("weld"):
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(me)
        bm.free()
    me.materials.append(materials.get(ms["material"], default_mat))
    obj = bpy.data.objects.new(ms["name"], me)
    coll.objects.link(obj)
    if not ms.get("castShadow", True):
        obj.visible_shadow = False
    bevel = float(ms.get("bevel", 0.0))
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3 if bevel >= 0.01 else 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(30)
        mod.harden_normals = False
    if ms.get("smooth"):
        try:
            bpy.context.view_layer.objects.active = obj
            for o in bpy.context.selected_objects:
                o.select_set(False)
            obj.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        except Exception:
            try:
                for p in me.polygons:
                    p.use_smooth = True
            except Exception:
                pass
    return obj


for ms in spec["meshes"]:
    if ms["indices"]:
        build_mesh(ms)


def import_model(md):
    before = set(bpy.data.objects)
    try:
        path = md["file"] if os.path.isabs(md["file"]) else os.path.join(base_dir, md["file"])
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:
        print("model import failed", md.get("name"), e)
        return
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        return
    # World-space bounding box of the imported hierarchy.
    bpy.context.view_layer.update()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            mins = Vector((min(mins[i], w[i]) for i in range(3)))
            maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
    size = maxs - mins
    centre = (mins + maxs) / 2
    sx = md["size"][0] / size.x if size.x > 1e-6 else 1.0
    sy = md["size"][1] / size.y if size.y > 1e-6 else 1.0
    sz = md["size"][2] / size.z if size.z > 1e-6 else 1.0
    pivot = bpy.data.objects.new("model_" + md["name"], None)
    coll.objects.link(pivot)
    roots = [o for o in new if o.parent is None or o.parent not in new]
    for o in roots:
        o.parent = pivot
        o.matrix_parent_inverse = Matrix.Identity(4)
    # Move the box centre (x, y) and base (z) to the pivot origin, scale to the target box,
    # then rotate and place the pivot.
    pre = Matrix.Translation(Vector((-centre.x, -centre.y, -mins.z)))
    for o in roots:
        o.matrix_world = pre @ o.matrix_world
    pivot.scale = (sx, sy, sz)
    pivot.rotation_euler = (0, 0, md["rotationZ"])
    pivot.location = md["position"]


for md in spec["models"]:
    import_model(md)

# ── world ──
w = spec["world"]
world = bpy.data.worlds.new("World")
scn.world = world
world.use_nodes = True
wn = world.node_tree
for n in list(wn.nodes):
    wn.nodes.remove(n)
wout = wn.nodes.new("ShaderNodeOutputWorld")
bg = wn.nodes.new("ShaderNodeBackground")
if w["night"]:
    c = hex_rgb(w["skyBottom"])
    bg.inputs["Color"].default_value = (c[0], c[1], c[2], 1)
    bg.inputs["Strength"].default_value = 0.6
else:
    try:
        sky = wn.nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA"
        sky.sun_disc = False
        sky.sun_elevation = math.radians(max(2.0, w["sunElevation"]))
        sky.sun_rotation = 0.0
        sky.air_density = 1.0
        sky.dust_density = 1.0
        wn.links.new(sky.outputs["Color"], bg.inputs["Color"])
    except Exception:
        c = hex_rgb(w["skyTop"])
        bg.inputs["Color"].default_value = (c[0], c[1], c[2], 1)
    bg.inputs["Strength"].default_value = max(0.05, w["skyStrength"])
wn.links.new(bg.outputs["Background"], wout.inputs["Surface"])

if w["sunStrength"] > 0:
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = w["sunStrength"] * 1.1
    sun_data.angle = math.radians(1.2)
    c = hex_rgb(w["sunColor"])
    sun_data.color = (c[0], c[1], c[2])
    sun = bpy.data.objects.new("Sun", sun_data)
    coll.objects.link(sun)
    direction = Vector(w["sunDirection"]).normalized()
    # A sun lamp shines along its local -Z; aim -Z at the origin from `direction`.
    sun.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()

# ── lights ──
for i, l in enumerate(spec["lights"]):
    kind = l["kind"]
    c = hex_rgb(l["color"])
    if kind == "point":
        d = bpy.data.lights.new("L%d" % i, "POINT")
        d.shadow_soft_size = l.get("size", 0.05)
    elif kind == "spot":
        d = bpy.data.lights.new("L%d" % i, "SPOT")
        d.spot_size = min(math.radians(170), l.get("cone", 1.0))
        d.spot_blend = 0.6
        d.shadow_soft_size = l.get("size", 0.04)
    else:
        d = bpy.data.lights.new("L%d" % i, "AREA")
        d.shape = "SQUARE"
        d.size = l.get("size", 0.6)
    d.energy = float(l["watts"])
    d.color = (c[0], c[1], c[2])
    o = bpy.data.objects.new("L%d" % i, d)
    o.location = l["position"]
    if kind != "point":
        dr = Vector(l.get("direction", [0, 0, -1]))
        o.rotation_euler = dr.to_track_quat("-Z", "Y").to_euler()
    coll.objects.link(o)

# ── camera ──
cam = spec["camera"]
cd = bpy.data.cameras.new("Cam")
cd.clip_start = 0.03
cd.clip_end = 300.0
if cam["projection"] == "orthographic":
    cd.type = "ORTHO"
    ow, oh = max(cam["orthoWidth"], 0.1), max(cam["orthoHeight"], 0.1)
    cd.sensor_fit = "AUTO"
    aspect = width / float(height)
    cd.ortho_scale = max(ow, oh * aspect) if width >= height else max(oh, ow / aspect)
else:
    cd.type = "PERSP"
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = 24.0
    cd.lens = 12.0 / math.tan(math.radians(cam["fov"]) / 2.0)
co = bpy.data.objects.new("Cam", cd)
coll.objects.link(co)
pos = Vector(cam["position"])
fwd = (Vector(cam["target"]) - pos).normalized()
up = Vector(cam["up"]).normalized()
right = fwd.cross(up)
if right.length < 1e-6:
    right = fwd.cross(Vector((0, 1, 0)))
right.normalize()
true_up = right.cross(fwd).normalized()
rot = Matrix(((right.x, true_up.x, -fwd.x), (right.y, true_up.y, -fwd.y), (right.z, true_up.z, -fwd.z)))
co.matrix_world = Matrix.Translation(pos) @ rot.to_4x4()
scn.camera = co

bpy.ops.render.render(write_still=True)
print("RENDER_OK", out_path)
