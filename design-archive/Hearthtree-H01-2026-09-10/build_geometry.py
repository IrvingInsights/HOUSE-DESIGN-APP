"""One geometric source for Blender, drawings and checks. Standard Python only.
All authoring coordinates are feet. Meshes are closed boxes/prisms except glazing.
This is a concept model, not structural or permit documentation.
"""
import json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parent
P=json.loads((ROOT/'parameters.json').read_text())
O=[]; DOORS=[]; WINDOWS=[]; ROOMS=[]; ROUTES=[]
COLORS={'site':'#c4c9b3','foundation':'#a3a09a','frame':'#79543c','envelope':'#e5dcc6','greenhouse':'#b9d5d4','hearth_chimney':'#b49a76','stairs':'#ac835c','tower':'#e5dcc6','decks':'#b3926a','openings':'#92b4bd','furniture':'#bdb4a2','services':'#adbebf','review':'#ce846c'}
FACES=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
def mesh(name,cat,vs,faces=None,**kw):
 o={'name':name,'collection':cat,'vertices':vs,'faces':faces or FACES,'color':COLORS[cat],**kw}; O.append(o);return o
def box(name,cat,x,y,z,w,d,h,**kw):
 return mesh(name,cat,[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],**kw)
def slope(name,cat,x,y,w,d,top,thick,**kw):
 vs=[[a,b,top(a,b)+c] for c in [-thick,0] for a,b in [(x,y),(x+w,y),(x+w,y+d),(x,y+d)]]
 return mesh(name,cat,vs,**kw)
def beam(name,cat,a,b,width,depth,**kw):
 a=list(a);b=list(b); dx=b[0]-a[0];dy=b[1]-a[1];L=math.hypot(dx,dy);nx=-dy/L*width/2;ny=dx/L*width/2
 vs=[[a[0]-nx,a[1]-ny,a[2]-depth],[b[0]-nx,b[1]-ny,b[2]-depth],[b[0]+nx,b[1]+ny,b[2]-depth],[a[0]+nx,a[1]+ny,a[2]-depth],[a[0]-nx,a[1]-ny,a[2]],[b[0]-nx,b[1]-ny,b[2]],[b[0]+nx,b[1]+ny,b[2]],[a[0]+nx,a[1]+ny,a[2]]]
 return mesh(name,cat,vs,**kw)
def wall(name,cat,axis,start,end,pos,t,z,top,opens=()):
 # Each hole splits the wall into actual jamb/sill/lintel solids.
 def part(a,b,z0,z1,suffix):
  if b-a<1e-6 or z1-z0<1e-6:return
  if axis=='x':box(name+suffix,cat,a,pos,z0,b-a,t,z1-z0,role='wall')
  else:box(name+suffix,cat,pos,a,z0,t,b-a,z1-z0,role='wall')
 last=start
 for i,q in enumerate(sorted(opens,key=lambda a:a[0])):
  a,b,sill,head,kind=q
  part(last,a,z,top,f' segment {i}');part(a,b,z,sill,f' sill {i}');part(a,b,head,top,f' lintel {i}');last=b
  opening={'name':name+f' opening {i}','axis':axis,'start':a,'end':b,'pos':pos,'thickness':t,'sill':sill,'head':head,'kind':kind}
  (DOORS if kind=='door' else WINDOWS).append(opening)
  # Glass is a separate object; holes remain when glass is hidden.
  if kind=='window':
   if axis=='x':box(opening['name']+' glass','openings',a,pos+t/2,sill,b-a,.035,head-sill,role='glass')
   else:box(opening['name']+' glass','openings',pos+t/2,a,sill,.035,b-a,head-sill,role='glass')
  else:
   # Park door leaf open through 90 degrees. Swings are also recorded for plan.
   r=b-a
   if axis=='x':box(opening['name']+' open leaf','openings',a,pos+t,z,.12,r,head-z,role='door_leaf')
   else:box(opening['name']+' open leaf','openings',pos+t,a,z,r,.12,head-z,role='door_leaf')
 part(last,end,z,top,' end')
def rail(name,a,b,z,cat='decks',h=3.5):
 beam(name+' top',cat,[*a,z+h],[*b,z+h],.16,.16,role='guard',provisional=True)
 beam(name+' lower',cat,[*a,z+.3],[*b,z+.3],.12,.12,role='guard',provisional=True)
 L=math.dist(a,b);n=math.ceil(L/.32)
 for i in range(n+1):
  q=i/n;x=a[0]+q*(b[0]-a[0]);y=a[1]+q*(b[1]-a[1]);box(name+f' baluster {i}',cat,x-.035,y-.035,z+.25,.07,.07,h-.25,role='guard',provisional=True)
def room(name,x,y,w,d,level=0):ROOMS.append(dict(name=name,x=x,y=y,w=w,d=d,level=level))
def furniture(name,x,y,w,d,h=.5,z=0,color=None):
 o=box(name,'furniture',x,y,z,w,d,h,role='furniture');
 if color:o['color']=color
 return o
H=P['house'];T=P['tower'];D=P['deck'];S=P['stair'];G=P['greenhouse'];HE=P['heater']
roof=lambda x,y:H['roof_south']+(H['roof_north']-H['roof_south'])*y/H['depth']
troof=lambda x,y:T['roof_south']+(T['roof_north']-T['roof_south'])*(y-T['y'])/T['depth']
box('Illustrative flat terrain - no selected property','site',-15,-20,-.85,75,75,.15,role='terrain')
box('East arrival / outdoor cooking patio','site',33,-8,-.12,10,29,.12,role='paving')
box('Main floor platform - foundation type undecided','foundation',0,0,-.5,33,34,.5,role='floor',provisional=True)
for x,y,w,d in [(0,0,33,1),(0,33,33,1),(0,1,1,32),(32,1,1,32)]:box('Foundation support zone - replace after site decision','foundation',x,y,-3,w,d,2.5,provisional=True)
box('Independent masonry bearing zone - engineer required','foundation',16.75,9.25,-3,5,5.5,2.5,provisional=True)
# Envelope: variable-height east/west walls are capped by sloping prisms.
wall('South house wall','envelope','x',0,33,0,1,0,11.25,[(3,6,2.5,7,'window'),(7,10,0,7,'door'),(12,18,9.25,10.75,'window'),(21,24,0,7,'door'),(25,30,3.5,7,'window'),(21,27,9.25,10.75,'window')])
# Overlapping window bands need separate treatment above the lower wall: rebuild south below.
O[:]=[o for o in O if not o['name'].startswith('South house wall')];DOORS[:]=[o for o in DOORS if not o['name'].startswith('South house wall')];WINDOWS[:]=[o for o in WINDOWS if not o['name'].startswith('South house wall')]
wall('South house lower wall','envelope','x',0,33,0,1,0,8.9,[(3,6,2.5,7,'window'),(7,10,0,7,'door'),(21,24,0,7,'door'),(25,30,3.5,7,'window')])
wall('South clerestory wall','envelope','x',0,33,0,1,8.9,11.25,[(3,10,9.25,10.75,'window'),(12,18,9.25,10.75,'window'),(21,29,9.25,10.75,'window')])
wall('North house wall','envelope','x',0,33,33,1,0,8.8,[(5,9,3,7,'window'),(17,21,3,7,'window'),(28,30,4,6.5,'window')])
for side,x,ops in [('West',0,[(3,8,2.5,7,'window'),(13,17,3,7,'window'),(27,31,3,7,'window')]),('East',32,[(3,7,3,7,'window'),(14.25,17.25,0,7,'door'),(27,30,4,6.5,'window')])]:
 wall(side+' house wall','envelope','y',1,33,x,1,0,8.8,ops)
 slope(side+' tapered wall','envelope',x,1,1,32,lambda a,b:roof(a,b)-.75,0,role='wall')
 # Custom lower face at a fixed base, upper face follows roof.
 o=O[-1]
 for v in o['vertices'][:4]:v[2]=8.8
wall('Bedroom front partition','envelope','x',1,25.5,22.5,.5,0,8.5,[(9.5,12.5,0,7,'door'),(14,17,0,7,'door')])
wall('Bedroom divider','envelope','y',23,33,13,.5,0,8.5)
wall('East service partition','envelope','y',12,33,25.5,.5,0,8.5,[(19.25,22.25,0,7,'door')])
wall('Mud south partition','envelope','x',26,32,11.5,.5,0,8.5,[(27,30,0,7,'door')])
wall('Mud north partition','envelope','x',26,32,18.5,.5,0,8.5,[(27,30,0,7,'door')])
wall('Bath south partition','envelope','x',26,32,24.5,.5,0,8.5,[(26.5,29.5,0,7,'door')])
for q in [('Primary bedroom',1,23,12,10),('Bedroom 2',13.5,23,12,10),('Living / dining',1,1,10.5,17.5),('Kitchen',21,1,11,10.5),('Mud entry',26,12,6,6.5),('Laundry / services',26,19,6,5.5),('Bathroom',26,25,6,8),('Bedroom hall',9.5,19,16,3.5)]:room(*q)
# Roof is four slabs around the actual tower/stair shaft void.
for n,x,y,w,d in [('south',-.75,-.75,34.5,3.75),('north',-.75,20,34.5,14.75),('west',-.75,3,11.75,17),('east',28,3,5.75,17)]:slope('Main shed roof '+n,'envelope',x,y,w,d,roof,.75,role='roof')
# Tower walls start on the roof curb, leaving the whole stair shaft open.
for n,x,y,w,d in [('south',11,3,17,1),('north',11,19,17,1),('west',11,4,1,15),('east',27,4,1,15)]:
 o=box('Tower '+n+' lower shaft wall','tower',x,y,0,w,d,16,role='wall')
 for v in o['vertices'][:4]:v[2]=roof(v[0],v[1])-.75
wall('Tower south','tower','x',11,28,3,1,16,24.85,[(13,18.5,18.5,22.5,'window'),(20,23.5,16,23,'door')])
wall('Tower north','tower','x',11,28,19,1,16,23.91,[(13,18,19.5,22.5,'window')])
wall('Tower west','tower','y',4,19,11,1,16,23.85,[(6,11,18.5,22.5,'window')])
wall('Tower east','tower','y',4,19,27,1,16,23.85,[(5,9,18.5,22.5,'window'),(13,17,20.5,23,'window')])
for n,x in [('west',11),('east',27)]:
 slope('Tower upper raked wall '+n,'tower',x,4,1,15,lambda a,b:troof(a,b)-.65,0,role='wall')
 for v in O[-1]['vertices'][:4]:v[2]=23.85
for n,x,y,w,d in [('west',10.5,2.5,8.5,18),('east',21,2.5,7.5,18),('south',19,2.5,2,9),('north',19,13.5,2,7)]:slope('Tower south-high roof '+n,'tower',x,y,w,d,troof,.65,role='roof')
# Tower floor: two orthogonal open strips surround the upper two flights.
sx,sy,sw=S['x'],S['y'],S['width'];run=(S['risers_per_flight']-1)*S['going'];xe=sx+sw+run;yn=sy+sw+run;rise=S['total_rise']/27
box('Tower usable floor south field','tower',12,4,15.25,15,3.5,.75,role='floor')
box('Tower usable floor main work field','tower',12,7.5,15.25,xe-12,yn-7.5,.75,role='floor')
box('Tower floor west return above low flight','tower',12,yn,15.25,3.5,19-yn,.75,role='floor')
# Make a real 2 x 2 chimney void in the work field by splitting that field.
O[:]=[o for o in O if o['name']!='Tower usable floor main work field']
for n,x,y,w,d in [('west',12,7.5,7,yn-7.5),('east',21,7.5,xe-21,yn-7.5),('south',19,7.5,2,4),('north',19,13.5,2,yn-13.5)]:box('Tower floor field '+n,'tower',x,y,15.25,w,d,.75,role='floor')
for f in range(3):
 for i in range(8):
  z=(f*9+i+1)*rise
  if f==0:x,y,w,d=sx,sy+sw+i*S['going'],sw,S['going']
  elif f==1:x,y,w,d=sx+sw+i*S['going'],yn,S['going'],sw
  else:x,y,w,d=xe,yn-(i+1)*S['going'],sw,S['going']
  box(f'Stair F{f+1} tread {i+1:02}','stairs',x,y,z-.15,w,d,.15,role='tread',flight=f+1,walking_z=z)
  # Closed risers prevent the concept reading as an open ladder.
  if f==0:box(f'F1 riser {i+1}','stairs',x,y,z-rise,sw,.06,rise-.15,role='riser')
  elif f==1:box(f'F2 riser {i+1}','stairs',x,y,z-rise,.06,sw,rise-.15,role='riser')
  else:box(f'F3 riser {i+1}','stairs',x,y+d-.06,z-rise,sw,.06,rise-.15,role='riser')
box('Landing 1 at 5ft 4in','stairs',sx,yn,9*rise-.25,sw,sw,.25,role='landing')
box('Landing 2 at 10ft 8in','stairs',xe,yn,18*rise-.25,sw,sw,.25,role='landing')
box('F1 landing riser','stairs',sx,yn,8*rise,sw,.06,rise-.25,role='riser')
box('F2 landing riser','stairs',xe,yn,17*rise,.06,sw,rise-.25,role='riser')
# The actual tower floor edge forms riser 27; no coincident extra face.
for n,a,b,z1,z2 in [('F1',(sx+.14,sy+sw),(sx+.14,yn),rise,9*rise),('F2',(sx+sw,yn+sw-.14),(xe,yn+sw-.14),10*rise,18*rise),('F3',(xe+sw-.14,yn),(xe+sw-.14,sy+sw),19*rise,27*rise)]:
 beam(n+' graspable rail','stairs',[*a,z1+3],[*b,z2+3],.12,.12,role='handrail',provisional=True)
 # A lower stringer on each edge makes the support intention visible.
 beam(n+' stringer concept','stairs',[*a,z1-.10],[*b,z2-.10],.2,.65,role='stringer',provisional=True)
for n,a,b,z1,z2 in [('F1 inner',(15.36,7.5),(15.36,yn),rise,9*rise),('F2 inner',(15.5,yn+.14),(xe,yn+.14),10*rise,18*rise),('F3 inner',(xe+.14,yn),(xe+.14,7.5),19*rise,27*rise)]:
 beam(n+' handrail','stairs',[*a,z1+3],[*b,z2+3],.12,.12,role='handrail',provisional=True)
 for i in range(25):
  t=i/24;x=a[0]+t*(b[0]-a[0]);y=a[1]+t*(b[1]-a[1]);z=z1+t*(z2-z1)
  box(n+f' baluster {i}','stairs',x-.035,y-.035,z,.07,.07,3,role='guard',provisional=True)
rail('Tower north opening guard',(15.5,yn-.08),(xe,yn-.08),16,'stairs')
rail('Tower east opening guard',(xe-.08,7.5),(xe-.08,yn),16,'stairs')
rail('Tower northwest opening guard',(15.5,yn),(15.5,19),16,'stairs')
rail('Landing 1 outer guard',(12,yn+sw),(15.5,yn+sw),9*rise,'stairs')
rail('Landing 2 outer guard',(xe,yn+sw),(xe+sw,yn+sw),18*rise,'stairs')
# Central heater, sculptural shell and structure are independent objects.
box('Masonry heater planning envelope - no appliance selection','hearth_chimney',17.5,10,0,3.5,4,6.75,role='heater',provisional=True,source='FL0 v10.9 hearth relationship; resized proposal')
box('Noncombustible hearth pad concept','hearth_chimney',17,8.5,0,4.5,1.5,.12,role='hearth_pad',provisional=True)
box('Fire-view / loading face south','hearth_chimney',18.2,9.96,1.5,2,.05,2,role='firebox',color='#343330')
box('Kitchen-facing bake oven intent - configuration unverified','hearth_chimney',21,11,3.5,.08,1.75,1.1,role='oven',provisional=True)
box('Straight chimney system envelope','hearth_chimney',19.35,11.85,6.75,1.3,1.3,21.75,role='chimney',provisional=True,color='#4d5556')
for z in [15.1,24.3]:
 for x,y,w,d in [(19,11.5,2,.12),(19,13.38,2,.12),(19,11.62,.12,1.76),(20.88,11.62,.12,1.76)]:box('Chimney penetration collar - listed assembly TBD','hearth_chimney',x,y,z,w,d,.25,role='collar',provisional=True)
# Tapered earthen fin expresses the trunk, without concealing heater or chimney.
mesh('Hearthtree decorative earthen fin - separate from heater and frame','hearth_chimney',[[17.1,14.3,0],[19.2,14.3,0],[19.2,14.65,0],[17.1,14.65,0],[17.8,14.3,15.2],[18.6,14.3,15.2],[18.6,14.65,15.2],[17.8,14.65,15.2]],role='sculpture',provisional=True)
# Tower and deck framing concepts, deliberately named provisional.
posts=[(11.4,3.4),(27.6,3.4),(11.4,18.5),(27.6,18.5),(5,-1),(13.25,-1),(25.75,-1),(34,-1),(5,12),(34,8),(34,20),(0.5,26),(13.25,26),(25.75,26),(32.5,26),(16,14.3)]
for i,(x,y) in enumerate(posts):
 top=troof(x,y)-.65 if i<4 else 14.85
 box(f'P{i+1:02} timber bearing concept 8in - provisional','frame',x-1/3,y-1/3,0,2/3,2/3,top,role='post',provisional=True)
 box(f'P{i+1:02} independent bearing zone','foundation',x-.85,y-.85,-3,1.7,1.7,2.5,provisional=True)
beam('Hearthtree floor bearer - separate from earthen fin','frame',[11.4,14.3,15.25],[22.5,14.3,15.25],.5,.75,role='beam',provisional=True)
for n,x,y,w,d in [('south',5,-3,29,6),('north',5,20,29,6),('west',5,3,6,17),('east',28,3,6,17)]:box('Ring deck '+n,'decks',x,y,15.83,w,d,.17,role='deck',source='current-project r681 full ring topology')
for i,(a,b) in enumerate([((5,-3),(34,-3)),((0.5,26),(32.5,26)),((5,-3),(5,26)),((34,-3),(34,26)),((11,3),(28,3)),((11,20),(28,20)),((11,3),(11,20)),((28,3),(28,20))]):beam(f'Deck primary beam B{i+1} - provisional',[*['frame']][0],[*a,14.85],[*b,14.85],.5,.75,role='deck_beam',provisional=True)
# The east and west primary beams already extend past their front posts.
for x in [13.25,25.75]:beam('South deck outrigger - 2ft cantilever concept','frame',[x,-3,14.85],[x,0,14.85],.5,.75,role='deck_beam',provisional=True)
for i in range(19):
 x=5+i*29/18
 for n,y,d in [('S',-3,6),('N',20,6)]:box(f'Deck {n} joist {i} - provisional','decks',x-.08,y,14.85,.16,d,.98,role='joist',provisional=True)
for i in range(12):
 y=3+i*17/11
 for n,x,w in [('W',5,6),('E',28,6)]:box(f'Deck {n} joist {i} - provisional','decks',x,y-.08,14.85,w,.16,.98,role='joist',provisional=True)
for n,a,b in [('south',(5.25,-2.75),(33.75,-2.75)),('north',(5.25,25.75),(33.75,25.75)),('west',(5.25,-2.75),(5.25,25.75)),('east',(33.75,-2.75),(33.75,25.75))]:rail('Ring '+n+' guard',a,b,16)
# Greenhouse is accessible and can be shut off from the house.
box('Greenhouse drainable floor','greenhouse',1,-8,-.1,24,8,.1,role='floor')
wall('Greenhouse front','greenhouse','x',1,25,-8,.15,0,7.25,[(2,10,1,6.9,'window'),(11,14,0,7,'door'),(15,24,1,6.9,'window')])
for x in [1,24.85]:wall('Greenhouse end '+str(x),'greenhouse','y',-7.85,0,x,.15,0,7.25,[(-6.5,-1,1,6.9,'window')])
slope('Greenhouse glazed roof','greenhouse',1,-8,24,8,lambda x,y:8.5+y*1.25/8,.05,role='glass')
for x in range(1,26,3):beam('Greenhouse roof glazing bar '+str(x),'greenhouse',[x,-8,7.25],[x,0,8.5],.09,.15,role='frame')
for x in [2,5,8,15,18,21]:box('Greenhouse low operable vent - schematic','openings',x,-8.03,.6,2,.08,.7,role='vent')
for x in [3,9,15,21]:box('Greenhouse high roof vent - schematic','openings',x,-1.3,8.25,2.2,1,.08,role='vent')
for x,w in [(1.4,5.1),(10.5,10)]:box('Greenhouse growing bed','furniture',x,-2.4,0,w,2,2,role='planter',color='#739271')
for x in [1.4,15]:box('Greenhouse south growing bench','furniture',x,-7.5,0,9.5,2,2.5,role='planter',color='#739271')
# Simple main-level furniture proves fit without committing to finishes.
furniture('Primary queen mattress 60 x 80in',5.5,26.15,5,80/12,1.4);furniture('Primary wardrobe',1,23,2,10,7)
furniture('Bedroom 2 twin XL / guest bed',17,26.1,3.33,6.67,1.4);furniture('Bedroom 2 wardrobe',23.5,28,1.75,5,7)
furniture('Living sofa',1.5,3,3,7,2.6);furniture('Living chair',7,3,2.8,2.8,2.6);furniture('Living low table',5,6,2.5,3.5,1.3)
furniture('Dining table four seats',4.8,13,4.5,2.8,2.5)
for x,y in [(6,11),(8,11),(5,16.2),(8,16.2)]:furniture('Dining chair',x,y,1.5,1.5,2.7)
furniture('Kitchen east counter / sink',29.5,1,2.5,7.5,3);furniture('Kitchen south counter',25,1,4.5,2.5,3)
furniture('Fridge',29.2,8.5,2.8,2.8,6.5);furniture('Pantry tall cabinet',17.5,1,2.5,2,7)
furniture('Mud bench / cubbies',30.5,12,1.5,2,1.5)
box('Stacked laundry equipment','services',29.5,19.5,0,2.5,2.5,6.5,role='equipment')
box('Service cupboard - equipment selection required','services',29.5,22,0,2.5,2.5,7.5,role='equipment',provisional=True)
box('Shower clear tray 3 x 4ft','services',29,29,0,3,4,.15,role='fixture');box('Shower glazing','openings',29,29,.15,.03,4,6,role='glass')
box('WC','services',26.6,30,0,1.6,2.5,1.5,role='fixture');box('Bathroom vanity','services',30,25.5,0,2,3,2.8,role='fixture')
furniture('Tower work desk',12.5,7.5,2.5,5,2.5,z=16);furniture('Tower work chair',15.5,9,2,2,2.5,z=16)
furniture('Tower reading chair',16,5,2.5,2.5,2.7,z=16);furniture('Tower bookcase',12.4,13,1,3.5,6,z=16)
for x in [7,15]:furniture('South deck lounge chair',x,-2.5,2.5,2.5,2.6,z=16)
furniture('Deck small table',11,-2.2,2,2,2.2,z=16)
# East work shelter is independent from roof deck and greenhouse.
slope('East sheltered work / arrival roof','envelope',33,8,9,13,lambda x,y:10.5-(x-33)*.15,.3,role='canopy')
for x,y in [(41.5,8.5),(41.5,20.5),(33.5,8.5),(33.5,20.5)]:box('Work shelter post - provisional','frame',x-.25,y-.25,0,.5,.5,9,role='post',provisional=True)
furniture('Covered workbench',39.5,11,2,6,3);furniture('Covered wood rack',39.5,18,2,2.5,5)
furniture('Outdoor cooking counter - open air',38,3,4,2.5,3)
ROUTES=[{'name':'Arrival to mud to kitchen to greenhouse','level':0,'points':[[36,0],[36,16],[32,16],[28.5,16],[28.5,14.5],[28,12],[28,6],[23,6],[22.5,0],[22.5,-4]]},{'name':'Living to stair','level':0,'points':[[9,8],[12,5.75],[13.75,7.5]]},{'name':'Bedrooms to bath via service passage','level':0,'points':[[11,23],[11,20.75],[27.5,20.75],[27.5,25],[28,27]]},{'name':'Tower to ring deck','level':16,'points':[[20,9],[21.5,8.5],[21.5,5],[21.75,3],[21.75,1.5],[30.8,1.5],[30.8,23],[8,23],[8,1.5],[21.75,1.5]]}]
# Door hands were corrected after the first route check.
for prefix,high,negative in [('East house wall opening 1',True,True),('Mud south partition opening 0',True,False),('Mud north partition opening 0',False,True),('Bath south partition opening 0',True,False)]:
 q=next(d for d in DOORS if d['name']==prefix);q['hinge_high']=high;q['swing_negative']=negative
 ob=next(o for o in O if o['name']==prefix+' open leaf');a,b,pos,t=q['start'],q['end'],q['pos'],q['thickness'];r=b-a;z=q['sill'];h=q['head']-z
 if q['axis']=='x':x=(b-.12 if high else a);y=pos-r if negative else pos+t;w=.12;d=r
 else:x=pos-r if negative else pos+t;y=(b-.12 if high else a);w=r;d=.12
 ob['vertices']=[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]]
# Stable unique identifiers keep native object names and drawing names identical.
from collections import Counter
counts=Counter(o['name'] for o in O);seen=Counter()
for o in O:
 n=o['name'];seen[n]+=1
 if counts[n]>1:o['name']=f'{n} {seen[n]:02}'
 o['bbox']=[min(v[i] for v in o['vertices']) for i in range(3)]+[max(v[i] for v in o['vertices']) for i in range(3)]
payload={'parameters':P,'objects':O,'doors':DOORS,'windows':WINDOWS,'rooms':ROOMS,'routes':ROUTES}
(ROOT/'geometry.json').write_text(json.dumps(payload,separators=(',',':')))
print(f'Created {len(O)} named meshes; common source geometry.json')
