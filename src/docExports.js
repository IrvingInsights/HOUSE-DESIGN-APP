// Document exports: IFC summary + permit drawing set HTML (moved verbatim from main.jsx, JOB 0 split).
import {
  titleCase, roofProfile, wallAssemblyProfile, detectIssues
} from './engine.js';

export function createIfcSummary(spec) {
  const modeledWallAssembly = wallAssemblyProfile(spec.systems.envelope);
  const modeledRoof = roofProfile(spec.shell);
  return {
    schema: 'IFC4-oriented schematic summary',
    disclaimer: 'Permit-track BIM data with code, structural, MEP, and jurisdictional coordination fields.',
    project: spec.projectName,
    revision: spec.revision,
    units: 'feet in UI, millimeters in IFC export',
    hierarchy: ['IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSlab', 'IfcWall', 'IfcRoof', 'IfcSpace', 'IfcOpeningElement'],
    spaces: spec.rooms.map((room) => ({
      ifcClass: 'IfcSpace',
      name: room.name,
      areaSf: Math.round(room.w * room.d),
      use: room.type,
      finishFloor: room.floor
    })),
    naturalBuildingElements: (spec.elements || []).map((element) => ({
      ifcClass: element.category === 'wall' ? 'IfcWallType' : element.category === 'roof' ? 'IfcRoof' : 'IfcBuildingElementProxy',
      name: element.name,
      category: element.category,
      areaSf: Math.round(element.w * element.d),
      note: element.note
    })),
    modeledWallAssembly: {
      ifcClass: 'IfcWallType',
      name: modeledWallAssembly.label,
      key: modeledWallAssembly.key,
      thicknessFt: modeledWallAssembly.thicknessFt,
      finish: modeledWallAssembly.finish
    },
    modeledRoof: {
      ifcClass: 'IfcRoof',
      type: modeledRoof.roofType,
      highSide: modeledRoof.highSide,
      axis: modeledRoof.axis,
      southWallHeightFt: modeledRoof.southWallHeightFt,
      northWallHeightFt: modeledRoof.northWallHeightFt,
      eastWallHeightFt: modeledRoof.eastWallHeightFt,
      westWallHeightFt: modeledRoof.westWallHeightFt,
      pitch: modeledRoof.pitch
    },
    systems: spec.systems,
    qualityGate: detectIssues(spec)
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function titleBlock(project, sheet, title, revision) {
  return `
    <aside class="title-block">
      <div class="firm">NATURAL BUILDING DESIGN DASHBOARD</div>
      <div class="stamp-box">PERMIT<br />TRACK SET</div>
      <dl>
        <dt>Project</dt><dd>${escapeHtml(project)}</dd>
        <dt>Sheet</dt><dd>${escapeHtml(sheet)}</dd>
        <dt>Title</dt><dd>${escapeHtml(title)}</dd>
        <dt>Revision</dt><dd>${escapeHtml(revision)}</dd>
        <dt>Date</dt><dd>${new Date().toLocaleDateString()}</dd>
        <dt>Scale</dt><dd>Diagrammatic</dd>
      </dl>
      <div class="stamp-note">Coordinated BIM sheet package with calculation, schedule, and seal-review fields.</div>
    </aside>`;
}

export function createPlanSvg(spec) {
  const pad = 42;
  const scale = Math.min((620 - pad * 2) / spec.shell.widthFt, (430 - pad * 2) / spec.shell.depthFt);
  const planW = spec.shell.widthFt * scale;
  const planD = spec.shell.depthFt * scale;
  const x0 = pad;
  const y0 = pad;
  const roomColors = {
    living: '#dfe9df',
    service: '#eadfca',
    sleeping: '#dce4ee',
    wet: '#d6e9eb',
    work: '#e6ddec',
    plant: '#dcebd2',
    storage: '#eee7d6'
  };
  const roomRects = spec.rooms.map((room) => {
    const x = x0 + room.x * scale;
    const y = y0 + room.y * scale;
    const w = room.w * scale;
    const h = room.d * scale;
    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${roomColors[room.type] || '#e9e4d7'}" stroke="#172a3a" stroke-width="1.2" />
        <text x="${x + w / 2}" y="${y + h / 2 - 4}" text-anchor="middle" class="room-name">${escapeHtml(room.name)}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 10}" text-anchor="middle" class="room-dim">${room.w}' x ${room.d}'</text>
      </g>`;
  }).join('');
  const openingLines = spec.openings.map((opening) => {
    const width = opening.widthFt * scale;
    if (opening.wall === 'north') return `<line x1="${x0 + (opening.x || 0) * scale}" y1="${y0}" x2="${x0 + (opening.x || 0) * scale + width}" y2="${y0}" class="opening ${opening.type}" />`;
    if (opening.wall === 'south') return `<line x1="${x0 + (opening.x || 0) * scale}" y1="${y0 + planD}" x2="${x0 + (opening.x || 0) * scale + width}" y2="${y0 + planD}" class="opening ${opening.type}" />`;
    if (opening.wall === 'east') return `<line x1="${x0 + planW}" y1="${y0 + (opening.y || 0) * scale}" x2="${x0 + planW}" y2="${y0 + (opening.y || 0) * scale + width}" class="opening ${opening.type}" />`;
    return `<line x1="${x0}" y1="${y0 + (opening.y || 0) * scale}" x2="${x0}" y2="${y0 + (opening.y || 0) * scale + width}" class="opening ${opening.type}" />`;
  }).join('');
  return `
    <svg viewBox="0 0 620 430" role="img" aria-label="Schematic floor plan">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="2" orient="auto"><path d="M0,0 L4,4 L8,0 Z" fill="#0c1f33" /></marker>
      </defs>
      <rect x="${x0}" y="${y0}" width="${planW}" height="${planD}" fill="#fbfaf4" stroke="#0c1f33" stroke-width="4" />
      ${roomRects}
      ${openingLines}
      <line x1="${x0}" y1="${y0 + planD + 22}" x2="${x0 + planW}" y2="${y0 + planD + 22}" class="dim-line" />
      <text x="${x0 + planW / 2}" y="${y0 + planD + 40}" text-anchor="middle" class="dim-text">${spec.shell.widthFt}' overall</text>
      <line x1="${x0 + planW + 22}" y1="${y0}" x2="${x0 + planW + 22}" y2="${y0 + planD}" class="dim-line" />
      <text x="${x0 + planW + 40}" y="${y0 + planD / 2}" transform="rotate(90 ${x0 + planW + 40} ${y0 + planD / 2})" text-anchor="middle" class="dim-text">${spec.shell.depthFt}' overall</text>
      <g transform="translate(555 38)"><line x1="0" y1="42" x2="0" y2="8" stroke="#0c1f33" stroke-width="2" marker-end="url(#arrow)" /><text x="0" y="58" text-anchor="middle" class="north">N</text></g>
    </svg>`;
}

export function createWallSectionSvg(spec) {
  const envelope = escapeHtml(spec.systems.envelope);
  const structure = escapeHtml(spec.systems.structure);
  return `
    <svg viewBox="0 0 620 430" role="img" aria-label="Typical wall section">
      <rect x="260" y="74" width="72" height="240" fill="#d9d2bb" stroke="#0c1f33" stroke-width="2" />
      <rect x="236" y="74" width="18" height="240" fill="#eef3f7" stroke="#53687c" />
      <rect x="338" y="74" width="16" height="240" fill="#c9a36b" stroke="#53687c" />
      <rect x="216" y="314" width="160" height="34" fill="#8f8a7a" stroke="#0c1f33" />
      <rect x="192" y="348" width="208" height="42" fill="#c7c1ad" stroke="#0c1f33" />
      <path d="M214 74 L378 74 L320 22 L260 22 Z" fill="#47596b" stroke="#0c1f33" stroke-width="2" />
      <line x1="380" y1="74" x2="468" y2="74" class="dim-line" /><text x="474" y="78" class="dim-text">roof protection</text>
      <line x1="356" y1="172" x2="468" y2="172" class="dim-line" /><text x="474" y="176" class="dim-text">rainscreen / cladding</text>
      <line x1="254" y1="194" x2="130" y2="194" class="dim-line" /><text x="48" y="198" class="dim-text">natural wall body</text>
      <line x1="260" y1="330" x2="118" y2="330" class="dim-line" /><text x="42" y="334" class="dim-text">capillary break</text>
      <text x="35" y="42" class="section-title">Typical Natural Wall Section</text>
      <text x="35" y="386" class="section-note">Envelope: ${envelope.slice(0, 118)}${envelope.length > 118 ? '...' : ''}</text>
      <text x="35" y="405" class="section-note">Structure: ${structure.slice(0, 118)}${structure.length > 118 ? '...' : ''}</text>
    </svg>`;
}

export function createFoundationSvg(spec) {
  return `
    <svg viewBox="0 0 620 430" role="img" aria-label="Foundation and load path diagram">
      <rect x="50" y="64" width="520" height="300" fill="#fbfaf4" stroke="#0c1f33" stroke-width="4" />
      <rect x="74" y="88" width="472" height="252" fill="none" stroke="#8f8a7a" stroke-width="12" />
      <line x1="74" y1="88" x2="546" y2="340" stroke="#c05a45" stroke-width="2" stroke-dasharray="8 5" />
      <line x1="546" y1="88" x2="74" y2="340" stroke="#c05a45" stroke-width="2" stroke-dasharray="8 5" />
      <g fill="#0c1f33">${[110, 230, 350, 470].map((x) => `<circle cx="${x}" cy="96" r="5" /><circle cx="${x}" cy="332" r="5" />`).join('')}</g>
      <text x="50" y="42" class="section-title">Foundation / Load Path Diagram</text>
      <text x="50" y="390" class="section-note">Continuous path: roof to walls/frame to foundation to soil. Footing, slab, reinforcement, hold-down, and lateral values feed the calculation sheet.</text>
      <text x="50" y="408" class="section-note">Shell: ${spec.shell.widthFt}' x ${spec.shell.depthFt}' - wall height ${spec.shell.wallHeightFt}' - roof pitch ${spec.shell.roofPitch}</text>
    </svg>`;
}

export function professionalDocMatrix(spec) {
  const naturalEnvelope = /straw|hemp|cob|earth|cordwood|natural/i.test(spec.systems.envelope);
  return [
    ['Jurisdiction / AHJ', 'Required', 'Not Set', 'County/city, zoning, adopted code year, frost depth, snow/wind/seismic criteria.'],
    ['Code Sheet', 'Required', 'Template Ready', 'Occupancy path, construction type, egress, smoke/CO, fire separation, energy path.'],
    ['Structural Calculations', 'Required', 'Worksheet Ready', 'Gravity, lateral, diaphragm, foundation, connection, and natural-wall restraint worksheets.'],
    ['Foundation Plan', 'Required', 'Permit Track', 'Soil bearing, frost depth, slab/footing/rebar schedule, drainage, vapor/radon strategy.'],
    ['Wall Sections', 'Required', naturalEnvelope ? 'Natural Assembly Flag' : 'Draft', 'Water, air, vapor, thermal, fire, structure, plaster, base, and roof protection layers.'],
    ['MEP Coordination', 'Required', 'Worksheet Ready', 'Wet core, ventilation, combustion air, electrical service, water/waste routes.'],
    ['Door / Window Schedule', 'Required', spec.openings.length ? 'Draft' : 'Missing', 'Exact sizes, operation, headers, U-factor/SHGC, egress and safety glazing.'],
    ['Energy Code', 'Required', 'Not Calculated', 'Climate zone, insulation values, glazing ratio, ventilation, HVAC sizing, compliance path.'],
    ['Seal Workflow', 'Required', 'Reserved', 'Review comments, calculation references, correction log, seal/date fields.']
  ];
}

export function structuralLoadRows(spec) {
  const timber = /timber|post|beam/i.test(spec.systems.structure);
  return [
    ['Roof Loads', 'Snow, dead, wind uplift, roof diaphragm', 'Set local loads and size rafters/trusses/purlins.'],
    ['Gravity Path', timber ? 'Roof to timber bents/posts to beams to footings' : 'Roof to framed walls to slab/footings', 'Show bearing points and tributary areas.'],
    ['Lateral System', timber ? 'Braced timber bents, shear walls, roof diaphragm' : 'Shear walls, hold-downs, wall bracing, roof diaphragm', 'Specify shear schedule and connectors.'],
    ['Foundation', 'Continuous perimeter footing/slab concept', 'Size from soil bearing, frost depth, point loads, drainage, radon, and settlement.'],
    ['Natural Wall Restraint', spec.systems.envelope, 'Show top/bottom restraint, buckling limits, plaster reinforcement, moisture base, and seismic/wind compatibility.']
  ];
}

export function createDrawingSetHtml(spec, qualityScore, issues) {
  const sheetIndex = [
    ['G001', 'Cover Sheet'],
    ['G002', 'Code Matrix'],
    ['A101', 'Schematic Floor Plan'],
    ['A200', 'Assemblies and Schedules'],
    ['A300', 'Wall Section'],
    ['S100', 'Structural Load Path / Foundation'],
    ['M100', 'MEP / Water / Energy Coordination']
  ];
  const systemRows = Object.entries(spec.systems)
    .map(([key, value]) => `<tr><th>${escapeHtml(titleCase(key))}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const roomRows = spec.rooms
    .map((room, index) => `<tr><td>A${String(index + 1).padStart(3, '0')}</td><td>${escapeHtml(room.name)}</td><td>${Math.round(room.w * room.d)} sf</td><td>${escapeHtml(room.type)}</td><td>${escapeHtml(room.floor)}</td></tr>`)
    .join('');
  const issueRows = issues
    .map((issue) => `<tr><td>${escapeHtml(issue.severity.toUpperCase())}</td><td>${escapeHtml(issue.title)}</td><td>${escapeHtml(issue.owner)}</td><td>${escapeHtml(issue.fix)}</td></tr>`)
    .join('');
  const matrixRows = professionalDocMatrix(spec)
    .map(([item, required, status, action]) => `<tr><th>${escapeHtml(item)}</th><td>${escapeHtml(required)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(action)}</td></tr>`)
    .join('');
  const structuralRows = structuralLoadRows(spec)
    .map(([item, concept, action]) => `<tr><th>${escapeHtml(item)}</th><td>${escapeHtml(concept)}</td><td>${escapeHtml(action)}</td></tr>`)
    .join('');
  const openingRows = spec.openings.map((opening, index) => {
    const prefix = opening.type === 'door' ? 'D' : 'W';
    return `<tr><td>${prefix}${String(index + 1).padStart(2, '0')}</td><td>${escapeHtml(opening.label)}</td><td>${escapeHtml(opening.type)}</td><td>${escapeHtml(opening.wall)}</td><td>${opening.widthFt}' nominal</td><td>Operation, header, U-factor/SHGC, egress, safety glazing.</td></tr>`;
  }).join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(spec.projectName)} Drawing Set Rev ${spec.revision}</title>
  <style>
    @page { size: letter landscape; margin: 0.35in; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #d9dde2; color: #0c1f33; font-family: "Inter", "Segoe UI", Arial, sans-serif; }
    .sheet { width: 10.3in; height: 7.8in; margin: 18px auto; background: #fff; display: grid; grid-template-columns: 1fr 1.68in; border: 2px solid #0c1f33; page-break-after: always; }
    .main { padding: 0.22in; border-right: 2px solid #0c1f33; display: grid; grid-template-rows: auto 1fr; gap: 0.14in; }
    .title-block { display: grid; grid-template-rows: auto auto 1fr auto; border-left: 0; font-size: 8px; }
    .firm { background: #0c1f33; color: #fff; padding: 0.12in; font-weight: 800; letter-spacing: 0.04em; writing-mode: vertical-rl; text-orientation: mixed; min-height: 1.45in; }
    .stamp-box { margin: 0.1in; border: 1px solid #0c1f33; border-radius: 50%; width: 0.96in; height: 0.96in; display: grid; place-items: center; text-align: center; font-size: 7px; justify-self: center; }
    dl { margin: 0; border-top: 2px solid #0c1f33; }
    dt, dd { margin: 0; padding: 0.045in 0.06in; border-bottom: 1px solid #8794a3; }
    dt { background: #eef3f7; color: #425161; text-transform: uppercase; font-size: 6.5px; }
    dd { min-height: 0.22in; font-weight: 700; }
    .stamp-note { padding: 0.08in; border-top: 2px solid #0c1f33; font-size: 7px; line-height: 1.25; }
    h1 { margin: 0; font-size: 31px; letter-spacing: 0.08em; text-transform: uppercase; }
    h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #47596b; }
    h3 { margin: 0 0 0.08in; font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; }
    .hero { background: #0c1f33; color: #fff; padding: 0.22in; display: grid; gap: 0.04in; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.14in; }
    .full { grid-column: 1 / -1; }
    .box { border: 1px solid #c6d0da; min-height: 1in; padding: 0.12in; background: #fbfcfd; }
    table { width: 100%; border-collapse: collapse; font-size: 7.5px; }
    th, td { border-bottom: 1px solid #d5dde5; padding: 0.045in; text-align: left; vertical-align: top; }
    th { color: #394b5d; background: #eef3f7; text-transform: uppercase; font-size: 6.5px; }
    .plan { display: grid; grid-template-columns: 1fr 2.35in; gap: 0.12in; align-items: start; }
    svg { width: 100%; height: auto; border: 1px solid #c6d0da; background: #fff; }
    .room-name { font-size: 8px; font-weight: 800; fill: #0c1f33; }
    .room-dim, .dim-text, .north { font-size: 7px; fill: #394b5d; }
    .opening { stroke-width: 7; stroke-linecap: round; }
    .opening.window { stroke: #4b83b7; }
    .opening.door { stroke: #9a633f; }
    .dim-line { stroke: #53687c; stroke-width: 1; stroke-dasharray: 4 3; }
    .section-title { font-size: 15px; font-weight: 900; fill: #0c1f33; text-transform: uppercase; letter-spacing: 1px; }
    .section-note { font-size: 8px; fill: #394b5d; }
    .note { font-size: 8px; line-height: 1.35; color: #394b5d; }
    .score { font-size: 28px; font-weight: 900; color: #0c1f33; }
    @media print { body { background: #fff; } .sheet { margin: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <section class="sheet">
    <main class="main">
      <div class="hero"><h1>${escapeHtml(spec.projectName)}</h1><h2>Natural Building Permit-Track Package - Revision ${spec.revision}</h2></div>
      <div class="grid">
        <div class="box"><h3>Project Data</h3><table>
          <tr><th>Climate</th><td>${escapeHtml(spec.site.climate)}</td></tr>
          <tr><th>Footprint</th><td>${spec.shell.widthFt}' x ${spec.shell.depthFt}'</td></tr>
          <tr><th>Area</th><td>${Math.round(spec.shell.widthFt * spec.shell.depthFt)} sf shell</td></tr>
          <tr><th>Wall Height</th><td>${spec.shell.wallHeightFt}'</td></tr>
        </table></div>
        <div class="box"><h3>Sheet Index</h3><table>${sheetIndex.map(([id, name]) => `<tr><th>${id}</th><td>${name}</td></tr>`).join('')}</table></div>
        <div class="box"><h3>Code / Coordination Basis</h3><p class="note">Permit-track design for BIM coordination, assembly selection, professional calculations, and AHJ review. Track zoning, adopted code year, IRC/IBC path, seismic/wind/snow loads, energy code, wastewater, potable water, and fire separation.</p></div>
        <div class="box"><h3>Revision / QA</h3><div class="score">${qualityScore}</div><p class="note">Document readiness score. Required actions are listed on G002 and A200.</p></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'G001', 'Cover Sheet', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>G002 - Code Matrix / Permit Readiness</h2></div>
      <div class="grid">
        <div class="box full"><h3>Required Permit / Engineering Document Matrix</h3><table><tr><th>Document Area</th><th>Need</th><th>Status</th><th>Next Action</th></tr>${matrixRows}</table></div>
        <div class="box"><h3>Project Criteria To Set</h3><p class="note">Jurisdiction, parcel constraints, design criteria, occupancy path, construction type, frost depth, soil bearing, well/septic/water source, utility service, energy compliance path, wildfire/flood/snow/seismic exposure.</p></div>
        <div class="box"><h3>Seal Workflow</h3><p class="note">Comment log, calculation references, reviewer initials, corrected-sheet dates, and final issue fields are reserved in this package.</p></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'G002', 'Code Matrix', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>A101 - Schematic Floor Plan</h2></div>
      <div class="plan">
        ${createPlanSvg(spec)}
        <div class="box"><h3>Room Schedule</h3><table><tr><th>ID</th><th>Name</th><th>Area</th><th>Use</th><th>Floor</th></tr>${roomRows}</table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'A101', 'Schematic Floor Plan', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>A200 - Assemblies, Schedules, Review Flags</h2></div>
      <div class="grid">
        <div class="box"><h3>Current Assemblies</h3><table>${systemRows}</table></div>
        <div class="box"><h3>Professional Review Flags</h3><table><tr><th>Status</th><th>Item</th><th>Owner</th><th>Resolution</th></tr>${issueRows}</table></div>
        <div class="box"><h3>Natural Building Notes</h3><p class="note">${escapeHtml(spec.notes)}</p></div>
        <div class="box"><h3>Openings</h3><table><tr><th>ID</th><th>Label</th><th>Type</th><th>Wall</th><th>Width</th><th>Schedule Notes</th></tr>${openingRows}</table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'A200', 'Assemblies and Schedules', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>A300 - Typical Wall Section / Natural Assembly</h2></div>
      <div class="plan">
        ${createWallSectionSvg(spec)}
        <div class="box"><h3>Section Notes</h3><table>
          <tr><th>Water</th><td>Bulk water shedding, roof overhang, flashing, capillary break, drainage plane, rainscreen.</td></tr>
          <tr><th>Air</th><td>Continuous air barrier strategy through all transitions.</td></tr>
          <tr><th>Vapor</th><td>Vapor-open drying profile checked for climate and interior humidity.</td></tr>
          <tr><th>Fire / Code</th><td>Plaster thickness, ignition resistance, thermal barrier, and assembly path.</td></tr>
          <tr><th>Structure</th><td>Natural wall infill/restraint and frame/load path coordination.</td></tr>
        </table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'A300', 'Wall Section', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>S100 - Structural Load Path / Foundation Coordination</h2></div>
      <div class="plan">
        ${createFoundationSvg(spec)}
        <div class="box"><h3>Structural Calculation Index</h3><table><tr><th>Item</th><th>Current Concept</th><th>Calculation / Detailing Action</th></tr>${structuralRows}</table></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'S100', 'Structural Load Path', spec.revision)}
  </section>

  <section class="sheet">
    <main class="main">
      <div><h2>M100 - MEP / Water / Energy Coordination</h2></div>
      <div class="grid">
        <div class="box"><h3>Water / Plumbing</h3><p class="note">${escapeHtml(spec.systems.water)}. Add fixture schedule, supply sizing, DWV routes, septic/greywater legality, roof catchment calculations, filtration, overflow, freeze protection, and backflow protection.</p></div>
        <div class="box"><h3>Energy / HVAC</h3><p class="note">${escapeHtml(spec.systems.energy)}. Add heating/cooling loads, ventilation design, combustion air, clearances, energy-code path, and electrical service coordination.</p></div>
        <div class="box"><h3>Electrical</h3><p class="note">Panel location, load calculation, smoke/CO alarms, GFCI/AFCI locations, exterior/weatherproof circuits, equipment circuits, and renewable/backup provisions.</p></div>
        <div class="box"><h3>Natural Building Coordination</h3><p class="note">Coordinate penetrations through straw/hemp/cob/earth assemblies. Avoid hidden wet services in moisture-sensitive walls unless access, sleeves, and drying strategy are resolved.</p></div>
      </div>
    </main>
    ${titleBlock(spec.projectName, 'M100', 'MEP Coordination', spec.revision)}
  </section>
</body>
</html>`;
}

