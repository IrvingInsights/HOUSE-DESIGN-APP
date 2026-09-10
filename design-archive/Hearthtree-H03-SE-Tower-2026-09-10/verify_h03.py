import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parent;P=json.loads((R/'parameters.json').read_text());FT=.3048
bpy.ops.wm.open_mainfile(filepath=str(R/'Hearthtree-H03-Form-Study.blend'))
H=P['main'];T=P['tower'];D=P['deck'];G=P['greenhouse'];C=P['hearth']
W,L=H['width'],H['depth'];tx,ty,tw,td=T['x'],T['y'],T['width'],T['depth'];ff=T['floor'];dd=D['depth']
dx,dy=tx-dd,ty-dd;ow,od=tw+2*dd,td+2*dd;ph=(dx-.45,dy-.45,.9,.9)
roof=lambda x,y:H['south_roof']+(H['north_roof']-H['south_roof'])*y/L
bottom=ff-D['deck_thickness']-D['joist_depth']-D['beam_depth']
# Geometry measurements from actual Blender meshes, authoring units restored to feet.
checks={'scope':'Placement/clearance study only; no stair, structural, energy or code certification', 'north':'+Y', 'main_external_ft':[W,L], 'tower_external_ft':[tw,td], 'tower_SE_alignment_ft':{'south':ty,'east_difference':tx+tw-W}, 'tower_floor_ft':ff, 'deck_nominal_width_ft':dd, 'deck_ring_area_sqft':ow*od-tw*td, 'main_roof_south_eave_top_ft':roof(0,-1),'provisional_lowest_deck_beam_bottom_ft':bottom,'minimum_deck_beam_to_main_roof_vertical_gap_ft':bottom-roof(0,-1),'clerestory_head_ft':13.7,'deck_beam_above_clerestory_head_ft':bottom-13.7,'greenhouse_roof_rear_ft':G['rear_roof'],'greenhouse_roof_post_opening_ft':list(ph),'greenhouse_front_bench_to_post_horizontal_gap_ft':dx-.25-7.5,'tower_interior_floor_and_stair':'unresolved; absent; no access claim','objects':len([o for o in bpy.data.objects if o.type=='MESH'])}
checks['deck_panel_tops_ft']={o.name:round(max((o.matrix_world@v.co).z for v in o.data.vertices)/FT,6) for o in bpy.data.objects if o.name.startswith('Ring deck ')}
checks['geometry_bounds_ft']={o.name:[[round(min((o.matrix_world@v.co)[i] for v in o.data.vertices)/FT,6) for i in range(3)],[round(max((o.matrix_world@v.co)[i] for v in o.data.vertices)/FT,6) for i in range(3)]] for o in bpy.data.objects if o.type=='MESH' and (o.name.startswith('Ring deck ') or o.name.startswith('Tower south') or o.name.startswith('Ring edge beam '))}
assert checks['minimum_deck_beam_to_main_roof_vertical_gap_ft']>1
assert checks['tower_SE_alignment_ft']=={'south':0,'east_difference':0}
assert len(checks['deck_panel_tops_ft'])==4
assert max(abs(z-ff) for z in checks['deck_panel_tops_ft'].values())<1e-5
(R/'geometry-checks.json').write_text(json.dumps(checks,indent=2))
print(json.dumps(checks,indent=2))

# Measurements here reopen the delivered native file; rendered output alone is not treated as verification.
actual_bottom=min(min((o.matrix_world@v.co).z/FT for v in o.data.vertices) for o in bpy.data.objects if o.name.startswith('Ring edge beam '))
assert abs(actual_bottom-bottom)<1e-5
print('Native deck beam and panel level readback passed within 0.00001 ft; no structural adequacy claim.')
