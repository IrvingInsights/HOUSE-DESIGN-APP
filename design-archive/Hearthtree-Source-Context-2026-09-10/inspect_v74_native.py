import bpy,json
from pathlib import Path
p=Path('P:/My Drive/07-HOUSE/HOMESTEAD/ARCHIVE - old app versions (July 2026)/6-28-26/FL0-House-Blender-PE-Review/model/FL0-House-v7.4-Finger-Lakes-FPSF.blend')
bpy.ops.wm.open_mainfile(filepath=str(p))
scale=bpy.context.scene.unit_settings.scale_length
feet_per_unit=scale/0.3048
rows=[]
for o in bpy.data.objects:
 if o.type!='MESH' or not o.data.vertices:continue
 if not any(w in o.name.lower() for w in ['tower','loft','perch','stair','roof','slab','floor']):continue
 pts=[o.matrix_world@v.co for v in o.data.vertices]
 bounds=[[round(fn(v[i] for v in pts)*feet_per_unit,4) for i in range(3)] for fn in [min,max]]
 rows.append({'name':o.name,'collection':[c.name for c in o.users_collection],'bbox_ft':bounds})
result={'source':str(p),'blender':bpy.app.version_string,'file_units':{'system':bpy.context.scene.unit_settings.system,'scale_length_metres_per_blender_unit':scale,'feet_per_blender_unit':feet_per_unit,'conversion':'physical feet = world coordinate * scene.unit_settings.scale_length / 0.3048'},'meshes':len([o for o in bpy.data.objects if o.type=='MESH']),'selected_geometry':rows,'limitations':['Bounding boxes do not establish usable area, headroom, structural adequacy or approval.','Source was opened read-only; no save to source was performed.']}
out=Path('C:/Users/danir/HOUSE-DESIGN-APP/.data/hearthtree-review/gallery-context-20260910/v74-native-review.json');out.write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({**{k:v for k,v in result.items() if k!='selected_geometry'},'selected_geometry':[r for r in rows if not any(w in r['name'].lower() for w in ['tread','rafter','stringer','guard','post','window'])]},indent=2))

