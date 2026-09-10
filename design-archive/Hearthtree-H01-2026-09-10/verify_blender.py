"""Run using Blender --background Hearthtree-H01.blend --python verify_blender.py.
Checks the saved native scene against the same geometry used by the PDF.
"""
import bpy, json, math
from pathlib import Path
R = Path(__file__).resolve().parent
J = json.loads((R/'geometry.json').read_text())
FT = .3048
max_error = 0.0
missing = []
different_counts = []
different_faces = []
for q in J['objects']:
    ob = bpy.data.objects.get(q['name'])
    if ob is None or ob.type != 'MESH':
        missing.append(q['name']); continue
    if len(ob.data.vertices) != len(q['vertices']):
        different_counts.append(q['name']); continue
    for v, expected in zip(ob.data.vertices, q['vertices']):
        actual = ob.matrix_world @ v.co
        max_error = max(max_error, *(abs(actual[i]/FT-expected[i]) for i in range(3)))
    faces = [list(p.vertices) for p in ob.data.polygons]
    if faces != q['faces']: different_faces.append(q['name'])
result = dict(source='Saved Hearthtree-H01.blend reopened in Blender',
    blender_version=bpy.app.version_string, expected_meshes=len(J['objects']),
    actual_meshes=sum(o.type=='MESH' for o in bpy.data.objects),
    missing=missing, differing_vertex_counts=different_counts,
    differing_faces=different_faces, maximum_vertex_error_ft=max_error,
    tolerance_ft=.0001, units=bpy.context.scene.unit_settings.system,
    north=bpy.context.scene.get('north'),
    passed=not(missing or different_counts or different_faces) and max_error<.0001,
    scope='Mesh identity and coordinate agreement only; no engineering certification.')
(R/'blender-readback.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
if not result['passed']: raise RuntimeError('Saved Blender geometry differs from drawing source')
