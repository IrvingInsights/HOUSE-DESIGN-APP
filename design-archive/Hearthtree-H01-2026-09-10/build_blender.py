"""Run with Blender --background --factory-startup --python build_blender.py.
No add-ons or external assets required. geometry.json is the drawing source too.
Use -- --render to produce inexpensive review frames. Original sources untouched.
"""
import bpy,json,sys,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent;J=json.loads((R/'geometry.json').read_text());FT=.3048
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
 if c.name!='Collection' and not c.objects:bpy.data.collections.remove(c)
cols={};mats={}
for n in ['site','foundation','frame','envelope','greenhouse','hearth_chimney','stairs','tower','decks','openings','furniture','services','review']:
 c=bpy.data.collections.new(n);bpy.context.scene.collection.children.link(c);cols[n]=c
def material(color,glass=False):
 key=(color,glass)
 if key in mats:return mats[key]
 m=bpy.data.materials.new(('Glazing ' if glass else 'Concept ')+color);m.diffuse_color=(*[int(color[i:i+2],16)/255 for i in [1,3,5]],1)
 m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=m.diffuse_color;bs.inputs['Roughness'].default_value=.65
 if glass:bs.inputs['Transmission Weight'].default_value=.85;bs.inputs['Roughness'].default_value=.12;bs.inputs['IOR'].default_value=1.45
 mats[key]=m;return m
for q in J['objects']:
 me=bpy.data.meshes.new(q['name']);me.from_pydata([[v*FT for v in a] for a in q['vertices']],[],q['faces']);me.update()
 ob=bpy.data.objects.new(q['name'],me);cols[q['collection']].objects.link(ob)
 ob.data.materials.append(material(q['color'],q.get('role')=='glass'));ob.color=ob.data.materials[0].diffuse_color
 for k in ['role','source','provisional','flight','walking_z']:
  if k in q:ob[k]=q[k]
 ob['scheme']='H01 proposal';ob['author_units']='feet; Blender mesh in meters'
 # Vents are coordination markers; they are not opaque lumps over roof glass.
 if q.get('role')=='vent':ob.hide_render=True
scene=bpy.context.scene;scene.unit_settings.system='IMPERIAL';scene.unit_settings.scale_length=1;scene.unit_settings.length_unit='FEET'
scene['north']='+Y';scene['status']='Concept for layout review. No engineering approval.'
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=1300;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.world.color=(.7,.7,.7)
world=scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.84,.9,1);world.node_tree.nodes['Background'].inputs[1].default_value=.7
ld=bpy.data.lights.new('Neutral review sun','SUN');lo=bpy.data.objects.new('Neutral review sun',ld);scene.collection.objects.link(lo);ld.energy=2.5;lo.rotation_euler=(math.radians(25),math.radians(-25),math.radians(-25));ld.angle=math.radians(12)
camd=bpy.data.cameras.new('Review camera');cam=bpy.data.objects.new('Review camera',camd);scene.collection.objects.link(cam);scene.camera=cam;camd.lens=25;camd.clip_end=500
def camera(pos,target,ortho=None):
 cam.location=Vector(pos)*FT;direction=Vector(target)*FT-cam.location;cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler();camd.type='ORTHO' if ortho else 'PERSP'
 if ortho:camd.ortho_scale=ortho*FT
for n,pos in [('Hearth review fill',(17,7,8.5)),('Living review fill',(7,8,8))]:
 ad=bpy.data.lights.new(n,'AREA');ad.energy=150;ad.shape='DISK';ad.size=2
 ao=bpy.data.objects.new(n,ad);scene.collection.objects.link(ao);ao.location=Vector(pos)*FT
 ao['purpose']='Temporary neutral evaluation light, not a daylight simulation or fixture specification'
camera((64,-68,57),(17,10,8),67)
# Saved cameras can be selected in Blender, including normal eye-level checks.
for name,pos,target in [('Arrival eye',(38,2,5.5),(28,15,5)),('Greenhouse eye',(20,-5,5.5),(23,4,4)),('Living hearth eye',(15,3,5.5),(19,11.5,5)),('Tower eye',(17,7,21.5),(23,3,19)),('Deck eye',(31,0,21.5),(22,2,19.5))]:
 cd=camd.copy();co=bpy.data.objects.new(name,cd);scene.collection.objects.link(co);cd.type='PERSP';co.location=Vector(pos)*FT;co.rotation_euler=(Vector(target)*FT-co.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=str(R/'Hearthtree-H01.blend'),compress=True)
if '--render' in sys.argv:
 (R/'renders').mkdir(exist_ok=True)
 def render(name):scene.render.filepath=str(R/'renders'/name);bpy.ops.render.render(write_still=True)
 render('01-massing.png')
 # Roofless untextured inspection of the exact objects, not a rebuilt plan.
 saved_coords={}
 for ob in bpy.data.objects:
  if ob.type=='MESH':
   saved_coords[ob.name]=[tuple(v.co) for v in ob.data.vertices]
   bb=[ob.matrix_world@Vector(v) for v in ob.bound_box]
   if min(v.z for v in bb)>3.3*FT or ob.get('role') in ['roof','canopy','glass'] or any(c.name in ['decks','tower'] for c in ob.users_collection):ob.hide_render=True
   if not ob.hide_render:
    for v in ob.data.vertices:v.co.z=min(v.co.z,4.5*FT)
 camera((58,-52,64),(16,12,1),63);render('02-ground-cutaway.png')
 for ob in bpy.data.objects:
  if ob.type=='MESH':
   ob.hide_render=ob.get('role')=='vent'
   for v,co in zip(ob.data.vertices,saved_coords[ob.name]):v.co=co
 scene.view_settings.exposure=1
 camera((15,3,5.5),(19,11.5,5));render('03-hearth-eye.png')
 scene.view_settings.exposure=0
 camera((31,0,21.5),(22,2,19.5));render('04-deck-eye.png')
 print('H01 four concept review frames rendered')
