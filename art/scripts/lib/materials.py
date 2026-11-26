"""PBR-материалы (Principled BSDF) — только то, что переживает экспорт в glTF."""

import bpy


def hex_rgb(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # Цвет в Блендере задаётся в линейном пространстве
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def pbr(name, color='#808080', metallic=0.0, roughness=0.5, emission=None, strength=1.0,
        alpha=1.0, transmission=0.0):
    """Материал по имени из ART_BRIEF; повторный вызов возвращает уже созданный."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*hex_rgb(color), 1.0)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if emission:
        b.inputs['Emission Color'].default_value = (*hex_rgb(emission), 1.0)
        b.inputs['Emission Strength'].default_value = strength
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    m.diffuse_color = (*hex_rgb(color), alpha)  # цвет во вьюпорте / Workbench
    return m


def car_set(paint='#1f4fd1'):
    """Стандартный набор материалов машины (имена — контракт с клиентом)."""
    return {
        'paint': pbr('paint', paint, metallic=0.6, roughness=0.25),
        'trim': pbr('trim', '#1a1c22', metallic=0.4, roughness=0.45),
        'dark': pbr('dark', '#0c0d10', roughness=0.7),
        'glass': pbr('glass', '#05070c', metallic=0.1, roughness=0.08, alpha=0.85),
        'chrome': pbr('chrome', '#d8dbe0', metallic=1.0, roughness=0.12),
        'headlight': pbr('headlight', '#f4f7ff', emission='#f4f7ff', strength=4.0),
        'taillight': pbr('taillight', '#701010', emission='#ff2020', strength=2.0),
        'tire': pbr('tire', '#111214', roughness=0.92),
        'rim': pbr('rim', '#c4c8d0', metallic=0.92, roughness=0.22),
        'brake': pbr('brake', '#5a5d63', metallic=0.8, roughness=0.4),
        'interior': pbr('interior', '#141416', roughness=0.85),
    }
