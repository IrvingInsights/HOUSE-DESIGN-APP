"""Deterministic concept geometry checks; no structural/code certification."""
import json, math
from pathlib import Path
R=Path(__file__).resolve().parent;J=json.loads((R/'geometry.json').read_text());O=J['objects'];P=J['parameters']
def tri_z(x,y,a,b,c):
 den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
 if abs(den)<1e-9:return None
 u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
 if min(u,v,1-u-v)<-1e-7:return None
 return u*a[2]+v*b[2]+(1-u-v)*c[2]
def vertical_hits(q,x,y):
 vs=q['vertices'];out=[]
 for f in q['faces']:
  for i in range(1,len(f)-1):
   z=tri_z(x,y,vs[f[0]],vs[f[i]],vs[f[i+1]])
   if z is not None:out.append(z)
 return out
head=[]
over=[q for q in O if q.get('role') in ['roof','floor','beam','deck_beam','wall','canopy','post']]
for q in O+[{'name':'Tower top landing','role':'landing','bbox':[22.833333,4,15.25,26.333333,7.5,16]}]:
 if q.get('role') not in ['tread','landing']:continue
 b=q['bbox'];z=b[5]
 for u in [.2,.5,.8]:
  for v in [.2,.5,.8]:
   x=b[0]+u*(b[3]-b[0]);y=b[1]+v*(b[4]-b[1]);hits=[]
   for e in over:
    if e['name']==q['name']:continue
    bb=e['bbox']
    if bb[0]-1e-7<=x<=bb[3]+1e-7 and bb[1]-1e-7<=y<=bb[4]+1e-7:
     hits += [(h-z,e['name']) for h in vertical_hits(e,x,y) if h>z+.05]
   if hits:head.append({'stair':q['name'],'clear_ft':min(hits)[0],'overhead':min(hits)[1]})
# Circle center samples identify obvious furniture/wall collisions. Door openings
# use a 24in body diameter, not an accessibility turning-space certification.
route_hits=[];route_counts={}
for r in J['routes']:
 count=0
 for a,b in zip(r['points'],r['points'][1:]):
  steps=max(1,math.ceil(math.dist(a,b)/.25))
  for i in range(steps+1):
   t=i/steps;x=a[0]+t*(b[0]-a[0]);y=a[1]+t*(b[1]-a[1]);count+=1
   for q in O:
    bb=q['bbox'];role=q.get('role')
    if role not in ['wall','post','furniture','equipment','fixture','heater','planter','door_leaf','guard']:continue
    if bb[5]<=r['level']+.15 or bb[2]>=r['level']+6.667:continue
    dx=max(bb[0]-x,0,x-bb[3]);dy=max(bb[1]-y,0,y-bb[4]);dist=math.hypot(dx,dy)
    if dist<.99:route_hits.append((r['name'],q['name']))
 route_counts[r['name']]=count
route_hits=sorted(set(route_hits))
deck=[q for q in O if q.get('role')=='deck'];deck_area=sum((q['bbox'][3]-q['bbox'][0])*(q['bbox'][4]-q['bbox'][1]) for q in deck)
tower_floor=[q for q in O if q['collection']=='tower' and q.get('role')=='floor'];tower_area=sum((q['bbox'][3]-q['bbox'][0])*(q['bbox'][4]-q['bbox'][1]) for q in tower_floor)
roof_gap=[]
for q in O:
 if q.get('role')!='deck_beam':continue
 for a in q['vertices'][:4]:
  x,y,z=a
  for roof in [e for e in O if e.get('role')=='roof' and e['collection']=='envelope']:
   vals=vertical_hits(roof,x,y)
   if vals:roof_gap.append(z-max(vals))
heater=next(q for q in O if q.get('role')=='heater');b=heater['bbox'];zone=[b[0],b[1]-4,b[3],b[1]]
hearth_clashes=[]
for q in O:
 if q.get('role') not in ['tread','landing','post','furniture']:continue
 a=q['bbox']
 if a[2]<6.667 and a[5]>.15 and min(a[3],zone[2])-max(a[0],zone[0])>1e-6 and min(a[4],zone[3])-max(a[1],zone[1])>1e-6:hearth_clashes.append(q['name'])
checks={'scope':'Concept geometry only; not a load calculation, code certification, energy simulation or exhaustive accessibility audit.',
 'objects':len(O),'stair_risers':27,'riser_inches':16/27*12,'going_inches':11,'nominal_stair_width_inches':42,'clear_between_rails_inches':(3.5-.28-.12)*12,
 'landing_levels_ft':[16/3,32/3,16],'headroom_sample_count':len(head),'minimum_stair_headroom_ft':min(h['clear_ft'] for h in head),'headroom_lowest':sorted(head,key=lambda x:x['clear_ft'])[:3],
 'route_sample_counts':route_counts,'route_body_diameter_inches':24,'route_obstructions':route_hits,
 'deck_area_sqft':deck_area,'deck_top_levels_ft':sorted(set(q['bbox'][5] for q in deck)),'deck_nominal_depth_ft':6,'deck_clear_depth_inside_guard_ft':5.67,
 'tower_internal_floor_after_openings_sqft':tower_area,'main_enclosure_footprint_sqft':33*34,'tower_enclosure_footprint_sqft':17*17,'main_inside_outer_walls_sqft':31*32,'greenhouse_footprint_sqft':24*8,
 'minimum_sampled_deck_beam_to_roof_gap_ft':min(roof_gap),'hearth_4ft_front_zone_intrusions':hearth_clashes,
 'greenhouse_roof_rear_ft':8.5,'house_clerestory_sill_ft':9.25,'glazing_vertical_separation_inches':9,
 'open_technical_items':['Final stair nosings, guard strength and handrail continuity at corners','Deck joist-to-beam seating and structural sizes/connections; post penetrations through the shed roof','South deck outriggers and rear transfer-beam loads','Heater and bake oven configuration, all listed clearances and chimney termination','Flashing, drained door threshold and waterproof separation above occupied rooms','Whole-house mechanical ventilation, greenhouse controls and condensation management','Foundation/basement choice after survey, soils, groundwater and servicing','Low-slope metal roof product approval, snow, drainage and ice control','Window clear opening/egress and household bedroom count']}
(R/'geometry-checks.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks,indent=2))
