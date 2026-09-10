"""Blender 5.1: exterior form test only, not a resolved house or a plan package.
Run blender --background --factory-startup --python H02_form_study.py
All house dimensions are in parameters.json. No external assets or add-ons.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent; P=json.loads((R/'parameters.json').read_text()); FT=.3048
H=P['main'];T=P['tower'];D=P['deck'];G=P['greenhouse']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
cols={}
for n in ['site','foundation','frame','envelope','greenhouse','hearth_chimney','stairs','tower','decks','openings','furniture','services','review']:
 c=bpy.data.collections.new(n);bpy.context.scene.collection.children.link(c);cols[n]=c
def mat(name,hex,rough=.65,metal=0,glass=False):
 m=bpy.data.materials.new(name);m.diffuse_color=(*[int(hex[i:i+2],16)/255 for i in (0,2,4)],1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=m.diffuse_color;bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 if glass:bs.inputs['Transmission Weight'].default_value=.9;bs.inputs['IOR'].default_value=1.45
 return m
M={
 'plaster':mat('Warm lime plaster - color study','CFC09A'),
 'wood':mat('Exposed timber - color study','61412A'),
 'roof':mat('Dark folded metal - unverified roof system','39443F',.45,.35),
 'deck':mat('Deck boards - color study','8C7050'),
 'glass':mat('Clear greenhouse glazing','B2CDD1',.12,0,True),
 'stone':mat('Stone plinth - generic','6D7065'),
 'ground':mat('Illustrative unselected ground','9EAA86'),
 'earth':mat('Separate sculptural earth - provisional','AF926B'),
 'plant':mat('Growing plants - schematic','3D6337')}
F=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
def mesh(n,c,v,f,m):
 me=bpy.data.meshes.new(n);me.from_pydata([[x*FT for x in p] for p in v],[],f);me.update();o=bpy.data.objects.new(n,me);cols[c].objects.link(o);o.data.materials.append(M[m]);o['status']='H02 form study; dimensions and engineering provisional';return o
def box(n,c,x,y,z,w,d,h,m):
 return mesh(n,c,[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],F,m)
def slope(n,c,x,y,w,d,fun,t,m):
 return mesh(n,c,[[a,b,fun(a,b)+dz] for dz in [-t,0] for a,b in [(x,y),(x+w,y),(x+w,y+d),(x,y+d)]],F,m)
def beam(n,c,a,b,w,d,m='wood'):
 a=Vector(a);b=Vector(b);along=(b-a).normalized();side=along.cross(Vector((0,0,1)))
 if side.length<.01:side=Vector((1,0,0))
 side.normalize();up=side.cross(along).normalized()
 vs=[list(q+sw*side*w/2+sh*up*d/2) for q in [a,b] for sw,sh in [(-1,-1),(1,-1),(1,1),(-1,1)]]
 return mesh(n,c,vs,F,m)
def wall(n,c,axis,lo,hi,pos,t,base,top,ops=()):
 def part(a,b,z,h,s):
  if b>a and h>0:
   if axis=='x':box(n+s,c,a,pos,z,b-a,t,h,'plaster')
   else:box(n+s,c,pos,a,z,t,b-a,h,'plaster')
 last=lo
 for i,(a,b,s,h,kind) in enumerate(sorted(ops)):
  part(last,a,base,top-base,f' pier {i}');part(a,b,base,s-base,f' sill {i}');part(a,b,h,top-h,f' head {i}');last=b
  if kind=='glass':
   if axis=='x':box(n+f' glass {i}','openings',a,pos+t/2,s,b-a,.03,h-s,'glass')
   else:box(n+f' glass {i}','openings',pos+t/2,a,s,.03,b-a,h-s,'glass')
  else:
   if axis=='x':box(n+f' open door {i}','openings',a,pos+t,s,.1,b-a,h-s,'wood')
   else:box(n+f' open door {i}','openings',pos+t,a,s,b-a,.1,h-s,'wood')
 part(last,hi,base,top-base,' last pier')
def guard(n,a,b,z):
 beam(n+' top','decks',(*a,z+D['guard']),(*b,z+D['guard']),.12,.18)
 beam(n+' lower','decks',(*a,z+.25),(*b,z+.25),.10,.12)
 length=math.dist(a,b);count=math.ceil(length/.33)
 for i in range(count+1):
  t=i/count;x=a[0]+t*(b[0]-a[0]);y=a[1]+t*(b[1]-a[1]);box(n+f' upright {i}','decks',x-.035,y-.035,z+.2,.07,.07,D['guard']-.2,'wood')
W,L=H['width'],H['depth'];tx,ty,tw,td=T['x'],T['y'],T['width'],T['depth'];ff=T['floor'];dd=D['depth']
roof=lambda x,y:H['south_roof']+(H['north_roof']-H['south_roof'])*y/L
tr=lambda x,y:T['south_roof']+(T['north_roof']-T['south_roof'])*(y-ty)/td
box('Illustrative ground - no selected site','site',-15,-18,-.8,70,70,.2,'ground')
box('House floor - foundation undecided','foundation',0,0,-.5,W,L,.5,'stone')
box('East arrival and work paving','site',W,-4,-.12,9,L+.5,.12,'stone')
wall('Main south lower wall','envelope','x',0,W,0,1,0,9.8,[(2,6,2.4,7,'glass'),(7,10,0,7,'door'),(11,16,2.4,7,'glass'),(20,23,0,7,'door'),(24,28,3,7,'glass')])
wall('Main south clerestory','envelope','x',0,W,0,1,9.8,H['south_roof']-.7,[(1.5,7,10.6,13.7,'glass'),(8.5,14,10.6,13.7,'glass'),(15.5,21,10.6,13.7,'glass'),(22.5,28.5,10.6,13.7,'glass')])
wall('Main north','envelope','x',0,W,L-1,1,0,H['north_roof']-.7,[(3,8,3,7,'glass'),(16,21,3,7,'glass')])
for name,x,ops in [('West',0,[(3,9,2.5,7,'glass'),(14,18,3,7,'glass'),(24,28,3,7,'glass')]),('East',W-1,[(3,7,3,7,'glass'),(10,13,0,7,'door'),(27,30,3,7,'glass')])]:
 wall('Main '+name,'envelope','y',1,L-1,x,1,0,H['north_roof']-.7,ops)
 o=slope('Main '+name+' raked head','envelope',x,1,1,L-2,lambda a,b:roof(a,b)-.7,0,'plaster')
 for v in o.data.vertices[:4]:v.co.z=(H['north_roof']-.7)*FT
# One dominant shed, cut only at the actual tower intersection.
regions=[('south',-1,-1,W+2,ty+1),('north',-1,ty+td,W+2,L+1-ty-td),('west',-1,ty,tx+1,td)]
if tx+tw<W+1:regions.append(('east',tx+tw,ty,W+1-tx-tw,td))
for n,x,y,w,d in regions:slope('Main shed '+n,'envelope',x,y,w,d,roof,.7,'roof')
for x in [i*1.5-1 for i in range(int((W+2)/1.5)+1)]:
 for n,y,d in [('front',-1,ty+1),('back',ty+td,L+1-ty-td)]:
  if d>0:beam(f'Roof seam {x} {n}','envelope',(x,y,roof(x,y)+.02),(x,y+d,roof(x,y+d)+.02),.025,.045,'roof')
 if x<tx:beam(f'Roof seam west {x}','envelope',(x,ty,roof(x,ty)+.02),(x,ty+td,roof(x,ty+td)+.02),.025,.045,'roof')
# Timber is part of the form study, not applied stripes of unknown support.
for i,x in enumerate([.35,7.5,15,22.5,W-.35]):
 box(f'South frame post {i} - provisional','frame',x-.18,-.04,0,.36,.38,H['south_roof']-.7,'wood')
beam('South continuous frame head - provisional','frame',(.15,.15,H['south_roof']-1),(W-.15,.15,H['south_roof']-1),.45,.55)
beam('South glazing transom','frame',(.15,.15,9.8),(W-.15,.15,9.8),.4,.35)
# Tower enclosure starts at the main-roof curb; room planning is unresolved.
for n,x,y,w,d in [('south',tx,ty,tw,1),('north',tx,ty+td-1,tw,1),('west',tx,ty+1,1,td-2),('east',tx+tw-1,ty+1,1,td-2)]:
 o=box('Tower '+n+' lower enclosure','tower',x,y,0,w,d,ff,'plaster')
 for v in o.data.vertices[:4]:v.co.z=(roof(v.co.x/FT,v.co.y/FT)-.7)*FT
wall('Tower south','tower','x',tx,tx+tw,ty,1,ff,tr(tx,ty)-.6,[(tx+1.5,tx+7,ff+2.5,ff+6.8,'glass'),(tx+9,tx+12.5,ff,ff+7,'door')])
wall('Tower north','tower','x',tx,tx+tw,ty+td-1,1,ff,tr(tx,ty+td)-.6,[(tx+2,tx+7,ff+3,ff+6.8,'glass')])
for n,x in [('west',tx),('east',tx+tw-1)]:
 wall('Tower '+n,'tower','y',ty+1,ty+td-1,x,1,ff,T['north_roof']-.6,[(ty+2,ty+6,ff+2.5,ff+6.8,'glass'),(ty+8,ty+11,ff+3.5,ff+6.8,'glass')])
 o=slope('Tower '+n+' raked head','tower',x,ty+1,1,td-2,lambda a,b:tr(a,b)-.6,0,'plaster')
 for v in o.data.vertices[:4]:v.co.z=(T['north_roof']-.6)*FT
slope('Tower metal shed','tower',tx-.7,ty-.7,tw+1.4,td+1.4,tr,.6,'roof')
for x in [tx-.7+i*1.5 for i in range(int((tw+1.4)/1.5)+1)]:beam('Tower seam '+str(x),'tower',(x,ty-.7,tr(x,ty-.7)+.02),(x,ty+td+.7,tr(x,ty+td+.7)+.02),.025,.045,'roof')
for i,(x,y) in enumerate([(tx+.25,ty+.25),(tx+tw-.25,ty+.25),(tx+.25,ty+td-.25),(tx+tw-.25,ty+td-.25)]):
 box(f'Tower post {i} - structural concept','frame',x-.22,y-.22,0,.44,.44,tr(x,y)-.6,'wood')
 beam(f'Tower brace {i} - provisional','frame',(x,y,ff+5.3),(x+(-1.6 if x>tx+tw/2 else 1.6),y,ff+7.5),.2,.25)
# A complete ring, with corners and door approach kept clear.
dx,dy=tx-dd,ty-dd;ow,od=tw+2*dd,td+2*dd
for n,x,y,w,d in [('south',dx,dy,ow,dd),('north',dx,ty+td,ow,dd),('west',dx,ty,dd,td),('east',tx+tw,ty,dd,td)]:
 box('Ring deck '+n,'decks',x,y,ff-D['deck_thickness'],w,d,D['deck_thickness'],'deck')
bottom=ff-D['deck_thickness']-D['joist_depth']-D['beam_depth']
for n,a,b in [('S',(dx,dy),(dx+ow,dy)),('N',(dx,dy+od),(dx+ow,dy+od)),('W',(dx,dy),(dx,dy+od)),('E',(dx+ow,dy),(dx+ow,dy+od))]:
 beam('Ring edge beam '+n+' - provisional','frame',(*a,bottom+D['beam_depth']/2),(*b,bottom+D['beam_depth']/2),.45,D['beam_depth'])
 guard('Ring guard '+n,(a[0]+(.22 if n=='W' else -.22 if n=='E' else 0),a[1]+(.22 if n=='S' else -.22 if n=='N' else 0)),(b[0]+(.22 if n=='W' else -.22 if n=='E' else 0),b[1]+(.22 if n=='S' else -.22 if n=='N' else 0)),ff)
for i,(x,y) in enumerate([(dx,dy),(dx+ow,dy),(dx,dy+od),(dx+ow,dy+od),(dx+ow,(2*dy+od)/2),(dx,(2*dy+od)/2)]):
 box(f'Outer ring bearing post {i} - planning reservation','frame',x-.25,y-.25,0,.5,.5,bottom+D['beam_depth'],'wood')
 box(f'Outer bearing pad {i} - site unverified','foundation',x-.7,y-.7,-.7,1.4,1.4,.7,'stone')
# Tower floor is intentionally absent: no false claim of a resolved stair opening.
review=box('UPPER FLOOR AND STAIR LAYOUT UNRESOLVED - review marker','review',tx+1,ty+1,ff-.1,tw-2,td-2,.1,'earth');review.hide_render=True;review.display_type='WIRE'
# Greenhouse expressed as repeated timber sash, with real doors to the house.
gw,gd=G['width'],G['depth'];gr=lambda x,y:G['rear_roof']+(G['rear_roof']-G['front_roof'])*y/gd
box('Greenhouse plinth','greenhouse',0,-gd,-.35,gw,gd,.35,'stone')
slope('Greenhouse roof glass','greenhouse',0,-gd,gw,gd,gr,.03,'glass')
for x in range(0,int(gw)+1,4):
 box('Greenhouse front timber '+str(x),'greenhouse',x-.07,-gd,0,.14,.16,G['front_roof'],'wood')
 beam('Greenhouse glazing rafter '+str(x),'greenhouse',(x,-gd,G['front_roof']),(x,0,G['rear_roof']),.14,.18)
for x in [0,4,8,16,20]:box('Greenhouse front pane '+str(x),'greenhouse',x+.07,-gd+.06,.5,3.86,.03,6.45,'glass')
for x in [0,gw]:box('Greenhouse end glass '+str(x),'greenhouse',x,-gd,.5,.035,gd,6.55,'glass')
for z in [.5,3.7,7.1]:beam('Greenhouse front transom '+str(z),'greenhouse',(0,-gd,z),(gw,-gd,z),.12,.13)
box('Greenhouse open entrance leaf','openings',12,-gd,0,.1,3,7,'wood')
for x,w in [(1,5),(10.5,9)]:box('Growing bed back '+str(x),'greenhouse',x,-2.2,0,w,1.8,1.8,'wood')
for x in [1,16]:box('Growing bench front '+str(x),'greenhouse',x,-7.4,0,7,1.5,2,'wood')
for i,x in enumerate([1.6,3.3,5,11.5,13.5,15.5,17.5,19]):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.5*FT,location=(x*FT,-1.3*FT,2.5*FT));o=bpy.context.object;o.name='Schematic growing plant '+str(i);o.scale=(.7,.7,1.4);o.data.materials.append(M['plant'])
 for c in list(o.users_collection):c.objects.unlink(o)
 cols['greenhouse'].objects.link(o)
# Sheltered work uses the outboard deck line as its outer post line.
slope('East work shelter - independent drained canopy','envelope',W,8,dx+ow-W,15,lambda x,y:10-(x-W)*.10,.25,'roof')
box('East covered work bench','furniture',dx+ow-2.3,10,0,1.8,6,3,'wood')
box('Wood storage reserve','furniture',dx+ow-2.3,18,0,1.8,3,4,'wood')
box('Open-air cooking counter','furniture',W+3,1,0,4,2.2,3,'stone')
# The heater and expressive earth remain separate. Their final positions are not resolved.
box('Heater appliance envelope - review only','hearth_chimney',17,16,0,3.5,4,6.5,'earth')
box('Straight chimney envelope - routing unresolved','hearth_chimney',18.5,18,6.5,1.2,1.2,22,'stone')
scene=bpy.context.scene;scene.unit_settings.system='IMPERIAL';scene.unit_settings.scale_length=1;scene.unit_settings.length_unit='FEET'
scene['north']='+Y';scene['scope']='Exterior form study only. No resolved floor plan, upper floor, stair, heater layout or structural design.'
scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=1500;scene.render.resolution_y=1150;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene.world.use_nodes=True;bg=scene.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(.8,.86,.92,1);bg.inputs[1].default_value=.7
ld=bpy.data.lights.new('Neutral evaluation sun','SUN');lo=bpy.data.objects.new('Neutral evaluation sun',ld);scene.collection.objects.link(lo);ld.energy=2.5;ld.angle=math.radians(8);lo.rotation_euler=(math.radians(22),math.radians(-25),math.radians(-35))
cd=bpy.data.cameras.new('Form review');co=bpy.data.objects.new('Form review',cd);scene.collection.objects.link(co);scene.camera=co
def camera(pos,target,scale=None):
 co.location=Vector(pos)*FT;co.rotation_euler=(Vector(target)*FT-co.location).to_track_quat('-Z','Y').to_euler();cd.type='ORTHO' if scale else 'PERSP';cd.lens=32
 if scale:cd.ortho_scale=scale*FT
camera((65,-72,48),(18,10,9),65)
bpy.ops.wm.save_as_mainfile(filepath=str(R/'Hearthtree-H02-Form-Study.blend'),compress=True)
scene.render.filepath=str(R/'H02-southeast.png');bpy.ops.render.render(write_still=True)
camera((52,-40,5.5),(20,11,10));scene.render.filepath=str(R/'H02-arrival-eye.png');bpy.ops.render.render(write_still=True)
print('H02 form study only: main 960 sf; tower enclosure 224 sf; full ring 504 sf; no resolved interior is claimed.')
