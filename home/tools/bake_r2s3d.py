"""The film's lighting of the Real-to-Sim scene as a volume of light probes (used by export_r2s3d.py, in Blender).

The page lights the scene with a few lamps of its own (the ceiling panels and the strip under the wall cabinets, which
cast its real-time shadows). Everything else the film's path tracer adds is baked here, with the film's own lights and
their strengths (render_r2s.py): what those lamps' light does after its first bounce, and all the light of the lamps
the page does not have (window bounce panels, bedroom lamps, pendant bulbs, the kitchen's downlights, the world).

It is baked not onto the meshes but into the air: a grid of probes through the whole home, each a set of six faces
of a millimetre that look along the axes. A surface then takes its light from the probes around it, by
where it is and which way it faces, so the scene's meshes stay as they are and what the run moves is lit where it is.

  run(...)       bakes the probes and returns their irradiance for two states (the run's lights as at its start; what
                 the lights the run switches on add), and the direct light of the page's own lamps for fit_lamps
  volume(...)    from six faces to what the page reads: a colour and a direction per probe, probes inside walls and
                 furniture filled in from their neighbours
  fit_lamps(...) the strength of each of the page's lamps, from their direct light on the probes

Values are irradiance in the film's exposure: a white matte surface under E shows as E / pi before the tone mapping.
"""
import re
import time

import bpy
import numpy as np
from mathutils import Vector

strip = re.compile(r'\.\d{3,}$')
AXES = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], np.float32)      # the six faces of a probe


def log(*a):
    print('R2S3D bake', *a, flush=True)


def film_lights(meta, rec, lightmap, by_path):
    """The film's lights (render_r2s.py): [{object, energy when on, on at the run's start, switched on by the run}]"""
    by_leaf = {}
    for o in bpy.data.objects:
        if o.type == 'LIGHT':
            by_leaf.setdefault(strip.sub('', o.name), []).append(o)
    L, out = rec['light'], []
    for k, p in enumerate(meta['light_paths']):
        c = [o for o in by_path.get(p, []) if o.type == 'LIGHT'] or by_leaf.get(p.rsplit('/', 1)[-1], [])
        if not c or float(L[:, k].max()) <= 0:
            continue
        ob = c[0]
        k_ = 1.0
        for rx, sv in lightmap.items():
            if re.search(rx, ob.name):
                k_ *= sv
        out.append({'ob': ob, 'path': p, 'energy': ob.data.energy * k_, 'start': float(L[0, k]) > 0, 'switched': float(L[0, k]) <= 0})
    return out


def is_panel(ob):
    """A lamp the page has itself: an area light that points straight down (a ceiling panel, or the strip under the wall cabinets)."""
    return ob.data.type == 'AREA' and (ob.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized().z < -0.95


def setup_cycles(gpus, samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind; prefs.get_devices(); break
        except Exception:
            continue
    devs = [d for d in prefs.devices if d.type == prefs.compute_device_type]
    for d in prefs.devices:
        d.use = False
    for g in gpus:
        devs[min(g, len(devs) - 1)].use = True
    sc.cycles.device = 'GPU'; sc.cycles.samples = samples; sc.cycles.use_adaptive_sampling = False; sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 6; sc.cycles.transmission_bounces = 8; sc.cycles.use_light_tree = True; sc.cycles.seed = 7
    sc.render.use_persistent_data = True
    sc.render.bake.target = 'VERTEX_COLORS'; sc.cycles.bake_type = 'DIFFUSE'; sc.render.bake.use_pass_color = False
    log('device', prefs.compute_device_type, [d.name for d in devs if d.use], 'samples', samples)


def probe_mesh(points, size=0.001):
    """One object for all the probes: at each point six triangles of a millimetre, one facing along each of AXES and
    set a little out along it, so that none of them stands in the light of another."""
    n = len(points)
    tri = np.zeros((6, 3, 3), np.float32)
    for f, a in enumerate(AXES):
        b = np.roll(a, 1); c = np.cross(a, b)             # a = b x c
        tri[f] = (np.array([b, c, -(b + c)]) + 3 * a) * size
    co = (points[:, None, None, :] + tri[None]).reshape(-1, 3).astype(np.float32)
    me = bpy.data.meshes.new('R2S3D_probes')
    me.vertices.add(n * 18); me.vertices.foreach_set('co', co.ravel())
    me.loops.add(n * 18); me.loops.foreach_set('vertex_index', np.arange(n * 18, dtype=np.int32))
    me.polygons.add(n * 6); me.polygons.foreach_set('loop_start', np.arange(0, n * 18, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(n * 6, 3, np.int32))
    me.update(calc_edges=True); me.validate()
    mat = bpy.data.materials.new('R2S3D_probe'); mat.use_nodes = True        # (a plain matte surface)
    me.materials.append(mat)
    ob = bpy.data.objects.new('R2S3D_probes', me); bpy.context.scene.collection.objects.link(ob)
    return ob           # (it stays visible to rays: Cycles bakes nothing onto an object its rays do not see; all its faces together are half a square metre)


def run(points, lights, exposure, world_strength, gpus, samples):
    """Bake the probes at `points` (n, 3; the simulator's axes). Returns irradiance arrays (n, 6, 3): 'gi' with the
    run's lights as at its start, 'gk' what the lights the run switches on add, both without the direct light of the
    page's own lamps, which is 'direct'."""
    sc = bpy.context.scene
    setup_cycles(gpus, samples)
    world = bpy.data.worlds.new('R2S3D bake'); world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (1, 1, 1, 1)
    sc.world = world
    P = probe_mesh(points)
    a = P.data.color_attributes.new('r2s_bk', 'FLOAT_COLOR', 'CORNER'); P.data.color_attributes.active_color = a
    for o in bpy.data.objects:
        o.select_set(False)
    P.select_set(True); bpy.context.view_layer.objects.active = P
    glow = []                                             # surfaces that glow light the scene in one pass only
    for m in bpy.data.materials:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes and m.node_tree else None
        if b is not None and b.inputs['Emission Strength'].default_value > 0 and max(b.inputs['Emission Color'].default_value[:3]) > 0:
            glow.append((b.inputs['Emission Strength'], b.inputs['Emission Strength'].default_value))
    was = [(l['ob'], l['ob'].hide_render) for l in lights]

    def bake(name, on, direct, indirect, world_on=False):
        for l in lights:
            l['ob'].data.energy = l['energy'] if on(l) else 0.0
            l['ob'].hide_render = not on(l)
        bg.inputs['Strength'].default_value = world_strength if world_on else 0.0
        for s, v in glow:
            s.default_value = v if world_on else 0.0
        sc.render.bake.use_pass_direct = direct; sc.render.bake.use_pass_indirect = indirect
        t = time.time()
        r = bpy.ops.object.bake(type='DIFFUSE')
        v = np.zeros(len(P.data.loops) * 4, np.float32); P.data.color_attributes['r2s_bk'].data.foreach_get('color', v)
        v = v.reshape(-1, 6, 3, 4)[..., :3].mean(2) * (np.pi * 2.0 ** exposure)      # radiance over albedo -> irradiance, in the film's exposure
        log(name, r, 'lights', sum(1 for l in lights if on(l)), '%.0fs' % (time.time() - t), 'mean %.3f' % float(v.mean()))
        return v

    panel = lambda l: is_panel(l['ob'])
    A = bake('the bounced light of the page\'s lamps', lambda l: l['start'] and panel(l), False, True)
    B = bake('the other lamps and the world', lambda l: l['start'] and not panel(l), True, True, world_on=True)
    C = bake('the bounced light of the switched lamps the page has', lambda l: l['switched'] and panel(l), False, True)
    D = bake('the other switched lamps', lambda l: l['switched'] and not panel(l), True, True)
    E = bake('the direct light of the page\'s lamps', panel, True, False)
    bpy.data.objects.remove(P)
    for l in lights:
        l['ob'].data.energy = l['energy']
    for o, h in was:
        o.hide_render = h
    for s, v in glow:
        s.default_value = v
    return {'gi': A + B, 'gk': C + D, 'direct': E}


def volume(six, dims, lit):
    """(nx*ny*nz, 6, 3) on the faces -> (colour (n, 3), direction (n, 3)): the light on a surface that faces n is
    colour * (1 + direction . n). A probe that is not `lit` (it sits inside a wall or a piece of furniture, or outside
    the home) takes the mean of its lit neighbours, ring after ring, so that a surface next to it is not darkened by
    it. The faces are along the simulator's axes; the direction is returned in glTF's (x, z, -y). The probes are in
    x-fastest order: index = x + nx * (y + ny * z)."""
    nx, ny, nz = dims
    v = six.reshape(nz, ny, nx, 6, 3).astype(np.float64)
    lit = lit.reshape(nz, ny, nx).copy()
    for _ in range(max(dims)):
        if lit.all():
            break
        acc = np.zeros_like(v); cnt = np.zeros(lit.shape)
        pv = np.pad(v * lit[..., None, None], ((1, 1), (1, 1), (1, 1), (0, 0), (0, 0))); pl = np.pad(lit, 1).astype(np.float64)
        for dz in (0, 1, 2):
            for dy in (0, 1, 2):
                for dx in (0, 1, 2):
                    acc += pv[dz:dz + nz, dy:dy + ny, dx:dx + nx]; cnt += pl[dz:dz + nz, dy:dy + ny, dx:dx + nx]
        new = ~lit & (cnt > 0)
        v[new] = acc[new] / cnt[new][:, None, None]
        lit = lit | new
    v = v.reshape(-1, 6, 3)
    c0 = v.mean(1)
    lum = v.sum(2)                                        # (n, 6)
    d = np.stack([lum[:, 0] - lum[:, 1], lum[:, 2] - lum[:, 3], lum[:, 4] - lum[:, 5]], 1) / np.maximum(2 * lum.mean(1, keepdims=True), 1e-6)
    d = np.clip(np.stack([d[:, 0], d[:, 2], -d[:, 1]], 1), -1, 1)
    return c0.astype(np.float32), d.astype(np.float32)


def fit_lamps(pos, up, lamps):
    """The strength (candela, in the film's exposure) of each of the page's lamps, from their direct light on the
    probes' upward faces (`pos` (n, 3), `up` (n,)). A lamp is one or more of the page's spots, each
    (position, axis, reach, cone angle, penumbra) as three.js has them: I * lobe * cos / d2, the lobe going smoothly
    from 1 at angle * (1 - penumbra) off the axis to 0 at the angle, and all fading to nothing at the reach if there is one.
    Each lamp in turn takes the probes within 35 degrees of its axis, 0.4 to 3.5 m away (or to half its reach), where
    it gives most of the light, and the strength that the best lit of them ask for (the 80th percentile: the others
    stand in a shadow). Returns (strengths, probes used, how far those are off, rms)."""
    P, E = pos.astype(np.float64), up.astype(np.float64)
    F = np.zeros((len(P), len(lamps))); near = np.zeros((len(P), len(lamps)), bool)
    for k, spots in enumerate(lamps):
        for p0, axis, reach, angle, penumbra in spots:
            d = P - np.array(p0); r2 = np.maximum((d * d).sum(1), 1e-4); dn = d / np.sqrt(r2)[:, None]
            ca = dn @ np.array(axis)
            u = np.clip((ca - np.cos(angle)) / (np.cos(angle * (1 - penumbra)) - np.cos(angle)), 0, 1)
            f = u * u * (3 - 2 * u) * np.clip(-dn[:, 2], 0, 1) / r2      # (the faces look up)
            if reach:
                f *= np.clip(1 - (r2 / reach ** 2) ** 2, 0, 1) ** 2
            F[:, k] += f
            near[:, k] |= (ca > np.cos(min(np.radians(35), 0.6 * angle))) & (r2 > 0.4 ** 2) & (r2 < (0.5 * reach if reach else 3.5) ** 2)
    I = np.array([float(np.percentile(E[near[:, k]] / F[near[:, k], k], 80)) if near[:, k].sum() >= 20 else 0.0 for k in range(len(lamps))])
    used, err = 0, []
    for _ in range(10):
        used, err = 0, []
        for k in range(len(lamps)):
            mk = F * I; m = mk.sum(1)
            own = near[:, k] & (mk[:, k] > 0.6 * m)
            if own.sum() < 20:
                continue
            r = (E[own] - (m[own] - mk[own, k])) / F[own, k]
            I[k] = max(0.0, float(np.percentile(r, 80)))
            ok = r > 0.7 * I[k]
            used += int(ok.sum()); err.append(float(np.sqrt(((r[ok] - I[k]) ** 2).mean()) / max(1e-9, I[k])))
    return I.tolist(), used, float(np.mean(err)) if err else float('nan')
