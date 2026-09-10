"""Vector drawings sliced/projected from geometry.json, with explicit annotations."""
import json,math,textwrap
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
R=Path(__file__).resolve().parent;J=json.loads((R/'geometry.json').read_text());Q=json.loads((R/'geometry-checks.json').read_text());O=J['objects']
for name,file in [('Body','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),('Bold','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')]:
 if Path(file).exists():pdfmetrics.registerFont(TTFont(name,file))
 else:
  from reportlab.pdfbase.pdfmetrics import Font
  pdfmetrics.registerFont(Font(name,'Helvetica-Bold' if name=='Bold' else 'Helvetica','WinAnsiEncoding'))
W,H=1191,842;C=canvas.Canvas(str(R/'Hearthtree-H01-Review.pdf'),pagesize=(W,H));C.setTitle('Hearthtree H01 - coordinated concept for layout review');C.setAuthor('Prepared for Daniel Irving')
INK='#273d37';MUTED='#626e68';GREEN='#376f5b';ORANGE='#9d603b';PAPER='#faf8f1'
def txt(x,y,s,size=12,bold=False,color=INK):
 C.setFillColor(HexColor(color));C.setFont('Bold' if bold else 'Body',size);C.drawString(x,y,str(s))
def wrapped(x,y,text,width,size=12,leading=None,color=INK):
 leading=leading or size*1.45
 for para in text.split('\n'):
  line=''
  for word in para.split():
   test=(line+' '+word).strip()
   if pdfmetrics.stringWidth(test,'Body',size)>width and line:txt(x,y,line,size,color=color);y-=leading;line=word
   else:line=test
  if line:txt(x,y,line,size,color=color);y-=leading
  y-=leading*.35
 return y
def page(no,title,sub):
 C.setFillColor(HexColor(PAPER));C.rect(0,0,W,H,fill=1,stroke=0)
 txt(38,805,'HEARTHTREE  /  H01',13,True,GREEN);txt(38,772,title,27,True);txt(38,748,sub,11,color=MUTED)
 C.setStrokeColor(HexColor('#c7cec3'));C.line(38,731,W-38,731);C.line(38,42,W-38,42)
 txt(38,23,'10 SEPTEMBER 2026  |  PROPOSED LAYOUT  |  NOT FOR CONSTRUCTION',9,color=MUTED);txt(W-140,23,f'{no:02} / 07',9,color=MUTED)
def done():C.showPage()
def polygon(pts,fill,stroke=INK,lw=.6,alpha=1):
 if len(pts)<3:return
 C.saveState();C.setFillAlpha(alpha);C.setStrokeAlpha(alpha);C.setFillColor(HexColor(fill));C.setStrokeColor(HexColor(stroke));C.setLineWidth(lw);p=C.beginPath();p.moveTo(*pts[0])
 for a in pts[1:]:p.lineTo(*a)
 p.close();C.drawPath(p,fill=1,stroke=1);C.restoreState()
def line(a,b,color=INK,lw=1,dash=None):
 C.saveState();C.setStrokeColor(HexColor(color));C.setLineWidth(lw)
 if dash:C.setDash(*dash)
 C.line(*a,*b);C.restoreState()
def arrow(a,b,color=GREEN):
 line(a,b,color,1.8);ang=math.atan2(b[1]-a[1],b[0]-a[0]);l=7
 polygon([b,(b[0]-l*math.cos(ang-.4),b[1]-l*math.sin(ang-.4)),(b[0]-l*math.cos(ang+.4),b[1]-l*math.sin(ang+.4))],color,color)
def slice_poly(q,axis,value):
 vs=q['vertices'];points=[]
 for f in q['faces']:
  for a,b in zip(f,f[1:]+f[:1]):
   u,v=vs[a],vs[b];du=u[axis]-value;dv=v[axis]-value
   if abs(du)<1e-7:points.append([u[i] for i in range(3) if i!=axis])
   if du*dv<0:
    t=-du/(dv-du);points.append([u[i]+t*(v[i]-u[i]) for i in range(3) if i!=axis])
 pts=list({tuple(round(a,7) for a in p) for p in points})
 if len(pts)<3:return []
 cx=sum(p[0] for p in pts)/len(pts);cy=sum(p[1] for p in pts)/len(pts)
 return sorted(pts,key=lambda p:math.atan2(p[1]-cy,p[0]-cx))
def dim(a,b,label,offset=0):
 line(a,b,MUTED,.6)
 for p in [a,b]:line((p[0]-3,p[1]-3),(p[0]+3,p[1]+3),MUTED,.8)
 if abs(a[1]-b[1])<.1:txt((a[0]+b[0])/2-pdfmetrics.stringWidth(label,'Body',10)/2,a[1]+5,label,10)
 else:
  C.saveState();C.translate(a[0]-7,(a[1]+b[1])/2);C.rotate(90);txt(-pdfmetrics.stringWidth(label,'Body',10)/2,0,label,10);C.restoreState()
def plan(level,x0,y0,scale):
 tr=lambda x,y:(x0+x*scale,y0+y*scale)
 floor=[q for q in O if (q.get('role') in ['floor','deck']) and abs(q['bbox'][5]-level)<.2]
 for q in floor:
  b=q['bbox'];polygon([tr(b[0],b[1]),tr(b[3],b[1]),tr(b[3],b[4]),tr(b[0],b[4])],'#efe9db','#b9b8ae',.5)
 for q in O:
  role=q.get('role');b=q['bbox'];cat=q['collection']
  if role in ['terrain','paving','floor','roof','canopy','joist','deck','deck_beam','collar','vent']:continue
  pts=[];fill=q['color'];lw=.5;alpha=1
  if role in ['wall','post','heater','chimney','sculpture','guard','glass','door_leaf']:
   pts=slice_poly(q,2,level+4)
   if role=='wall':fill='#6d7162';lw=.4
   if role=='glass':fill='#b8d9df'
  if role in ['furniture','equipment','fixture','planter','hearth_pad'] and level-.1<=b[2]<level+.2:
   pts=[(b[0],b[1]),(b[3],b[1]),(b[3],b[4]),(b[0],b[4])];fill='#d9cfbb' if cat=='furniture' else '#b4c7c6'
  if role in ['tread','landing']:
   if level==0 or b[5]>8:
    pts=[(b[0],b[1]),(b[3],b[1]),(b[3],b[4]),(b[0],b[4])];fill='#ddc4a1';alpha=.75 if level==0 and b[5]>6 else 1
  if role=='guard' and not pts and level<=b[2] and b[5]<=level+3.6:
   pts=[(b[0],b[1]),(b[3],b[1]),(b[3],b[4]),(b[0],b[4])]
  if pts:polygon([tr(*p) for p in pts],fill,INK,lw,alpha)
 # Door arcs encode the same hinge and open direction as the actual leaf.
 for d in J['doors']:
  if abs(d['sill']-level)>.1:continue
  a,b,p,t=d['start'],d['end'],d['pos'],d['thickness'];r=(b-a)*scale;high=d.get('hinge_high',False);neg=d.get('swing_negative',False)
  C.saveState();C.setStrokeColor(HexColor('#718a8e'));C.setLineWidth(.6)
  if d['axis']=='x':
   h=b if high else a;cy=p if neg else p+t;X,Y=tr(h,cy);start=180 if high else 0;extent=(90 if high else -90) if neg else (-90 if high else 90)
  else:
   h=b if high else a;cx=p if neg else p+t;X,Y=tr(cx,h);start=270 if high else 90;extent=-90 if (neg and high) or (not neg and not high) else 90
  C.arc(X-r,Y-r,X+r,Y+r,startAng=start,extent=extent);C.restoreState()
 for r in J['routes']:
  if r['level']==level:
   pts=[tr(*p) for p in r['points']]
   for a,b in zip(pts,pts[1:]):arrow(a,b,GREEN)
 return tr
def label(tr,x,y,s,size=11):
 X,Y=tr(x,y)
 for i,t in enumerate(s.split('\n')):
  ww=pdfmetrics.stringWidth(t,'Bold' if i==0 else 'Body',size if i==0 else size-1)
  txt(X-ww/2,Y-i*(size+3),t,size if i==0 else size-1,i==0)
def section(axis,value,x0,y0,scale):
 tr=lambda x,z:(x0+x*scale,y0+z*scale)
 for q in O:
  if q.get('role') in ['terrain','paving','vent'] or q['collection']=='review':continue
  pts=slice_poly(q,axis,value)
  if not pts:continue
  color=q['color']
  if q.get('role')=='wall':color='#7c7d6c'
  polygon([tr(*p) for p in pts],color,INK,.4)
 return tr
def table(x,y,width,headers,rows,colfractions,size=11):
 xs=[x]
 for f in colfractions:xs.append(xs[-1]+f*width)
 C.setFillColor(HexColor('#e4eadd'));C.rect(x,y-27,width,27,fill=1,stroke=0)
 for i,h in enumerate(headers):txt(xs[i]+8,y-18,h,size,True)
 y-=38
 for row in rows:
  ends=[]
  for i,s in enumerate(row):ends.append(wrapped(xs[i]+8,y,str(s),(xs[i+1]-xs[i])-16,size,leading=size*1.4))
  yy=min(ends)-6;line((x,yy+3),(x+width,yy+3),'#cdd4c8',.5);y=yy-9
 return y
page(1,'One house from three branches','A first design package for Daniel Irving. Dimensions, bedroom program and foundation remain proposals.')
render=R/'renders/01-massing.png'
if render.exists():C.drawImage(str(render),35,178,width=686,height=554,preserveAspectRatio=True,anchor='c')
else:txt(65,410,'See coordinated elevation and sections on following sheets.',16)
y=690;txt(764,y,'The recommended arrangement',17,True);y=wrapped(764,y-30,'Two bedrooms and all daily services on the main floor. A separate upper work / reading room sits over the hearth and stair. A full deck ring surrounds it.',380,14)
y=table(756,y-8,395,['Part','Proposed size'],[['Main enclosure','33 x 34 ft / 1,122 sq ft'],['Tower enclosure','17 x 17 ft / 289 sq ft footprint'],['Upper usable floor','143 sq ft after openings'],['Deck ring','6 ft nominal / 552 sq ft'],['Greenhouse','24 x 8 ft / 192 sq ft']],[.42,.58],11)
y=wrapped(764,y-10,'The deck is substantial: almost half the main-floor footprint. Its support, roof penetrations, snow exposure and waterproofing drive complexity.',380,12,color=ORANGE)
txt(50,142,'Composition: FL0 v4/v5  |  Hearth/stair lessons: v10.9-v10.12  |  Full ring: revision 681',13,True)
wrapped(50,113,'This is a new, traceable synthesis. It preserves the south greenhouse, earthen hearth, exposed timber and upper deck destination. It does not adopt the 36 x 36 ft, three-storey shell or the 30.18 ft deck height from revision 681.',1090,12)
done()
page(2,'A-101  Main floor','North up. Dimensions shown are clear internal dimensions unless marked EXT. Exterior walls 12 in; partitions 6 in.')
tr=plan(0,91,245,13)
for x,y,s in [(7,31,'PRIMARY\n12 x 10 ft'),(19,31,'BEDROOM 2\n12 x 10 ft'),(6.5,9.5,'LIVING'),(6.5,18,'DINING'),(28.5,6,'KITCHEN'),(29,16,'MUD'),(27.8,23.4,'LAUNDRY'),(28,28,'BATH\n6 x 8 ft'),(18,21,'3 ft 6 in HALL'),(18.8,11.3,'HEARTH'),(13.75,9,'F1'),(19,16.4,'F2'),(24.5,11,'F3'),(13,-4,'GREENHOUSE\n24 x 8 ft EXT')]:label(tr,x,y,s,10)
dim(tr(0,36),tr(33,36),'33 ft EXT');dim(tr(-2,0),tr(-2,34),'34 ft EXT');dim(tr(1,-10),tr(25,-10),'24 ft EXT');dim(tr(10,19),tr(10,22.5),'3 ft 6 in')
arrow(tr(38,29),tr(38,33));label(tr,38,34,'N',12)
line(tr(19.9,-8.8),tr(19.9,34.5),ORANGE,.9,[4,4]);label(tr,19.9,35.5,'A-A',9)
line(tr(-.6,12),tr(34,12),ORANGE,.9,[4,4]);label(tr,35,12,'B-B',9)
y=689;txt(665,y,'A daily life that stays downstairs',17,True)
y=wrapped(665,y-30,'Arrival enters the mudroom from the sheltered east side. The kitchen reaches the greenhouse through a closable glazed door. Bedrooms have their own hall; neither becomes a passage.',475,13)
y=table(658,y-7,488,['Space','Clear size / fit'],[['Primary bedroom','12 x 10 ft; queen and 2 ft wardrobe'],['Bedroom 2','12 x 10 ft; single / guest bed shown'],['Living + dining','10 ft 6 in x 17 ft 6 in open zone'],['Open kitchen zone','11 x 10 ft 6 in; pantry on south wall'],['Mud entry','6 x 6 ft 6 in; bench and coat storage'],['Laundry / services','6 x 5 ft 6 in; shared passage to bath'],['Bathroom','6 x 8 ft; 3 x 4 ft shower'],['Bedroom hall','3 ft 6 in nominal; doors 3 ft nominal']],[.37,.63],11)
y=wrapped(665,y-7,'Green arrows are sampled circulation routes. Furniture blocks are sized objects in the model. F2 and F3 are projected above the main floor; they do not occupy its whole area.',475,11,color=MUTED)
wrapped(665,y-5,'The bath is reached through a short shared laundry/service passage. Equipment-door operation and turning space need a more detailed pass. The main-floor program is proposed; the latest larger app save contains three bedrooms.',475,11,color=ORANGE)
done()
page(3,'A-102  Tower and continuous ring deck','Floor and deck at +16 ft. This is the upper destination, with a real floor, stair opening, door and guards.')
tr=plan(16,37,211,18)
dim(tr(5,28),tr(34,28),'29 ft deck EXT');dim(tr(11,21.2),tr(28,21.2),'17 ft tower EXT');dim(tr(5,12),tr(11,12),'6 ft NOM');dim(tr(36,-3),tr(36,26),'29 ft deck EXT')
label(tr,17,10,'WORK / READING\nMain field about 10 ft 10 in square',10);label(tr,19,17.2,'OPEN TO STAIR',9);label(tr,24.55,12,'F3 UP',9);label(tr,24.55,5.5,'LANDING',9);label(tr,20,12.6,'CHASE',8)
label(tr,19,23.2,'NORTH DECK',10);label(tr,18,-1.2,'SITTING EDGE',10)
arrow(tr(39,22),tr(39,26));label(tr,39,27,'N',12)
y=693;txt(800,y,'The ring stays usable',17,True)
y=wrapped(800,y-30,'Four joined deck fields make one level surface. There are no steps or internal guardrails at the corners. The south tower door opens inward.',340,13)
y=table(790,y-5,356,['Check','H01 geometry'],[['Deck depth','6 ft nominal; about 5 ft 8 in inside guard'],['Seating','2 ft 6 in chairs leave 3 ft at inner edge'],['Upper floor','143 sq ft inside after stair/chimney voids'],['Door','3 ft 6 in nominal opening'],['Stair landings','3 ft 6 in square'],['Deck threshold','Same modeled level; drainage detail pending']],[.37,.63],11)
y=wrapped(800,y-8,'The floor opening follows the north and east stair flights. The west return sits above the low first flight, where there is ample modeled clearance.',340,12)
wrapped(800,y-6,'The 17 ft enclosure is larger than the early 10 x 8 ft tower because a comfortable stair and a useful room take real space. There is no separate full middle storey.',340,12,color=ORANGE)
done()
page(4,'A-301  Section A-A: greenhouse, hearth, tower','True north-south mesh section at X = 19.9 ft. South is left. Stair flight 2 is cut; full stair sequence is on A-302.')
tr=section(0,19.9,195,210,14)
for z,labeltext in [(0,'MAIN 0 ft'),(8.5,'GH REAR 8 ft 6 in'),(12,'SOUTH ROOF 12 ft'),(16,'TOWER / DECK 16 ft'),(25.5,'TOWER HIGH 25 ft 6 in')]:
 line(tr(-10,z),tr(35,z),'#b6c1b2',.6,[3,4]);txt(695,210+z*14,labeltext,9,True)
txt(66,672,'SOUTH',12,True);txt(697,672,'NORTH',12,True)
dim(tr(-8,-2.2),tr(0,-2.2),'8 ft greenhouse');dim(tr(0,-2.2),tr(34,-2.2),'34 ft main enclosure')
wrapped(54,121,'The greenhouse closes off from the house and vents independently. Its roof meets the rear wall at 8 ft 6 in; the house clerestory starts at 9 ft 3 in. Greenhouse shading, vent sizing and moisture control remain design work.',705,12)
y=650;txt(868,y,'Vertical decisions',15,True)
y=wrapped(868,y-29,'The deck clears the highest sampled main-roof point below its beams by 2.1 ft. This creates a service space between roof and deck, not another living level.',275,12)
y=wrapped(868,y-8,'The chimney is straight and has actual floor and roof openings. The heater, decorative earthen fin, timber bearer and chimney are separate objects.',275,12)
y=wrapped(868,y-8,'A 4 ft clear zone is reserved in front of the heater. This is a planning allowance, not a verified appliance clearance.',275,12,color=ORANGE)
y=wrapped(868,y-8,'The foundation shown is a support reservation. A basement or walkout could replace it after slope, drainage, groundwater and access are known.',275,12)
done()
page(5,'A-302  The hearth and three-flight stair','Section B-B at Y = 12 ft, plus an unfolded profile from the same tread and landing levels.')
tr=section(1,12,65,425,10)
for z,s in [(0,'0'),(16,'16 ft'),(24.3,'ROOF')]:line(tr(-1,z),tr(36,z),'#b6c1b2',.6,[3,4]);txt(435,425+z*10,s,9)
label(tr,18.9,7.5,'HEATER',10);label(tr,13.75,5,'F1',10);label(tr,24.55,15.5,'F3',10)
# Profile uses exact nine-riser flights and eight goings per flight.
x0,y0,s=75,105,17;z=0;dist=0;r=16/27;g=11/12
pts=[(x0,y0)]
for f in range(3):
 for i in range(9):
  z+=r;pts.append((x0+dist*s,y0+z*s))
  if i<8:dist+=g;pts.append((x0+dist*s,y0+z*s))
 if f<2:dist+=3.5;pts.append((x0+dist*s,y0+z*s))
for a,b in zip(pts,pts[1:]):line(a,b,ORANGE,1.8)
for z,s0 in [(0,'MAIN'),(16/3,'5 ft 4 in'),(32/3,'10 ft 8 in'),(16,'16 ft')]:
 line((70,105+z*17),(606,105+z*17),'#b6c1b2',.5,[3,4]);txt(612,101+z*17,s0,9)
txt(77,78,'UNFOLDED WALKING PROFILE  /  landings are horizontal; no winders',10,True)
y=690;txt(732,y,'Consistent geometry',17,True)
y=table(725,y-18,413,['Item','Modeled result'],[['Risers','27 total: 9 + 9 + 9'],['Each riser','7.11 in'],['Each going','11 in'],['Stair width','42 in nominal; 37.2 in between rails'],['Intermediate landings','42 x 42 in at +5 ft 4 in and +10 ft 8 in'],['Tread headroom',f"Lowest sampled: {Q['minimum_stair_headroom_ft']:.2f} ft"],['Sampling',f"{Q['headroom_sample_count']} tread/landing samples against actual overhead faces"]],[.42,.58],11)
y=wrapped(732,y-4,'The tower floor is genuinely cut away above the upper flights. It is not a transparent marker drawn over a solid slab. A south landing connects the last riser to the room and deck door.',406,12)
wrapped(732,y-8,'The profile proves rise, run and level agreement. Final nosings, guard connections, handrail transitions, landing details and adopted-code review remain open. The sculptural fin is an early massing placeholder.',406,12,color=ORANGE)
done()
page(6,'A-201  South elevation and roof direction','Orthographic projection of the same model. Main house and tower both drain north in the recommended scheme.')
proj=[]
for q in O:
 if q.get('role') in ['terrain','paving','vent'] or q['bbox'][5]<-.2:continue
 for f in q['faces']:
  vs=[q['vertices'][i] for i in f];pts=[(v[0],v[2]) for v in vs]
  area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1])))/2
  if area<1e-6:continue
  proj.append((sum(v[1] for v in vs)/len(vs),pts,q))
for _,pts,q in sorted(proj,key=lambda a:a[0],reverse=True):polygon([(70+x*16,260+z*16) for x,z in pts],q['color'],q['color'],.2,.45 if q.get('role')=='glass' else 1)
dim((70,228),(70+33*16,228),'33 ft main enclosure EXT');txt(75,206,'Glazed growing space',11);txt(390,206,'Upper south glazing',11);txt(688,206,'Sheltered arrival / work',11)
table(65,170,1060,['Criterion','South-high shed: recommended','East-high shed: comparison'],[
 ['Daylight + greenhouse','Continuous south clerestory above the greenhouse roof.','West end loses much of that upper glazing band; staggered openings needed.'],
 ['Tower + deck','Full ring works at +16 ft; main roof stays below it.','Ring also clears; changing slope alone does not reduce the stair climb.'],
 ['Construction + drainage','Two north-draining roof planes; keep runoff away from south growing edge.','Drainage shifts west; greenhouse junction varies across the facade.'],
 ],[.18,.41,.41],10)
done()
page(7,'Evidence, changes and the next decisions','The accessible source files were inspected; archival claims are distinguished from verified geometry.')
y=table(38,706,1115,['Source inspected','Retained','Changed / unresolved'],[
 ['PC v4 README + generation script; Drive v5 complete PDF','South-high shed, southeast kitchen, isolated greenhouse, explicit tower / perch composition.','v4 script raises tower to 14 ft; v5 PDF calls it 10 ft. Older stove substitution is superseded by this brief.'],
 ['Drive v10.9 / v10.10 / v10.11 notes; v10.12 geometry JSON and actual .blend','Central heater/stair relationship; real flights, landings, voids and separate chimney.','230 mesh objects inspected in Blender. The earlier L-shaped perch survives in v10.12; it is not a full ring. Stair geometry is reconstructed.'],
 ['PC current-project r681 and GitHub engine at 986836c','Four connected 6 ft deck fields around an upper work room.','Resolved all four deck tops to 30.18 ft. H01 reduces this to 16 ft; the 36 x 36 ft, three-storey shell is not adopted.'],
 ],[.29,.31,.4],10.5)
y-=10;txt(46,y,'Established preferences',14,True);y=wrapped(46,y-24,'South growing space; central masonry hearth and tree-like expression; timber and natural finishes; useful upper tower with surrounding deck; everyday main-level living.',1090,11.5)
txt(46,y-1,'Recommendations in this package',14,True);y=wrapped(46,y-25,'Two main-level bedrooms; one full bathroom; three equal stair flights; a simple 12 in envelope allowance; low main shed with a separate tower; a full ring at +16 ft; independent east work shelter. Straw bale can be substituted only after rechecking interior dimensions and openings.',1090,11.5)
txt(46,y-1,'Your choices / technical review',14,True);y=wrapped(46,y-25,'Confirm whether two bedrooms meet the household requirement, or whether a third must be designed now. Review the tower and deck size before detailed furnishings. Foundation, basement/walkout, heater configuration, structure, fire clearances, low-slope roofing, drainage and mechanical systems need site/product/professional inputs.',1090,11.5,color=ORANGE)
txt(46,y-1,'What was checked',14,True);y=wrapped(46,y-25,f"Common-source mesh drawings; {Q['headroom_sample_count']} stair/headroom samples; {sum(Q['route_sample_counts'].values())} route-center samples using a 24 in body envelope; deck level and area; 4 ft hearth-front zone; greenhouse/clerestory heights. Route obstructions in the final sample: {len(Q['route_obstructions'])}. This is a bounded geometry review, not exhaustive circulation, structural, fire or accessibility validation.",1090,11.5)
txt(46,y-1,'Files and source paths',14,True);y=wrapped(46,y-25,'Hearthtree-H01.blend + parameters.json + geometry.json + build_geometry.py + build_blender.py + check_geometry.py + make_package.py. The source/decision record contains complete PC paths and Drive/GitHub links. Original app state and archived design files were not overwritten.',1090,11.5)
wrapped(46,y-3,'Workflow reference: developers.openai.com/blog/architectural-visualization-with-astra. Its editable geometry / preview / correction approach informed this package; its architecture was not used as a style template. Detailed materials, the final camera tour and interactive walkthrough follow layout selection.',1090,10.5,color=MUTED)
done();C.save();print(R/'Hearthtree-H01-Review.pdf')
