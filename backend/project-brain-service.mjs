export const workflowStages = [
  'Intake',
  'Site and constraints',
  'Program / room list',
  'Concept options',
  'Floor plan development',
  '3D / BIM modeling',
  'Rendering',
  'Drawing package',
  'Review',
  'Professional handoff'
];

export function createProjectBrain(spec) {
  return {
    stage: '3D / BIM modeling',
    masterDesignBrief: {
      summary: spec.notes,
      goals: [
        'Design a natural-building residence with professional-grade schematic outputs.',
        'Maintain BIM-ready object hierarchy and export path.',
        'Support homestead, site, and natural-building decisions alongside the house model.'
      ],
      mustHaves: ['editable BIM model', 'natural materials', 'revision history', 'professional handoff package'],
      constraints: ['professional review required before permit or construction use']
    },
    requirements: [
      { id: 'req-natural', text: 'Use vapor-open natural building assemblies where appropriate.', status: 'active', priority: 'high', linkedObjects: ['systems.envelope'] },
      { id: 'req-bim', text: 'Keep rooms, walls, openings, roof, pad, and site elements as selectable BIM objects.', status: 'active', priority: 'high', linkedObjects: ['model'] }
    ],
    constraints: [
      { id: 'con-review', type: 'professional', text: 'Outputs are professional-grade drafts for licensed review, not stamped construction documents.', severity: 'high' },
      { id: 'con-orientation', type: 'modeling', text: 'Coordinate convention: north is Y/Z 0; south is shell depth.', severity: 'high' }
    ],
    decisions: [
      { id: 'dec-seed', text: 'Use a compact natural-building schematic as the starting design state.', rationale: 'Gives the app a complete initial BIM object hierarchy.', revision: spec.revision }
    ],
    openQuestions: [
      { id: 'q-jurisdiction', text: 'What jurisdiction, code year, snow/wind/seismic criteria, frost depth, and soil assumptions apply?', blockingLevel: 'professional handoff', status: 'open' }
    ],
    taskQueue: [
      { id: 'task-code-basis', title: 'Set local code/design criteria', stage: 'Site and constraints', status: 'open', priority: 'high' },
      { id: 'task-output-review', title: 'Review generated drawing package against handoff checklist', stage: 'Review', status: 'open', priority: 'medium' }
    ],
    assetLibrary: [],
    aiSessionHistory: [],
    modelFileVersions: [
      { id: `version-${spec.revision}`, revision: spec.revision, label: 'Initial schematic state', changedObjects: [], createdAt: new Date().toISOString() }
    ],
    outputReview: {
      readiness: 'schematic',
      missing: ['jurisdiction criteria', 'structural calculations', 'MEP coordination', 'final window/door specs'],
      lastReviewedRevision: spec.revision
    },
    professionalHandoffChecklist: [
      { id: 'handoff-code', text: 'Code and jurisdiction basis documented', status: 'missing' },
      { id: 'handoff-structure', text: 'Structural load path and calculation package prepared', status: 'missing' },
      { id: 'handoff-envelope', text: 'Natural wall sections and moisture details documented', status: 'draft' },
      { id: 'handoff-schedules', text: 'Room, opening, assembly, and output schedules reviewed', status: 'draft' }
    ]
  };
}

export function ensureProjectBrain(brain, spec) {
  const base = createProjectBrain(spec);
  if (!brain) return base;
  return {
    ...base,
    ...brain,
    masterDesignBrief: { ...base.masterDesignBrief, ...(brain.masterDesignBrief || {}) },
    outputReview: { ...base.outputReview, ...(brain.outputReview || {}) },
    requirements: Array.isArray(brain.requirements) ? brain.requirements : base.requirements,
    constraints: Array.isArray(brain.constraints) ? brain.constraints : base.constraints,
    decisions: Array.isArray(brain.decisions) ? brain.decisions : base.decisions,
    openQuestions: Array.isArray(brain.openQuestions) ? brain.openQuestions : base.openQuestions,
    taskQueue: Array.isArray(brain.taskQueue) ? brain.taskQueue : base.taskQueue,
    assetLibrary: Array.isArray(brain.assetLibrary) ? brain.assetLibrary : base.assetLibrary,
    aiSessionHistory: Array.isArray(brain.aiSessionHistory) ? brain.aiSessionHistory : base.aiSessionHistory,
    modelFileVersions: Array.isArray(brain.modelFileVersions) ? brain.modelFileVersions : base.modelFileVersions,
    professionalHandoffChecklist: Array.isArray(brain.professionalHandoffChecklist) ? brain.professionalHandoffChecklist : base.professionalHandoffChecklist
  };
}

export function updateProjectBrainAfterOperation(brain, spec, event) {
  const next = structuredClone(ensureProjectBrain(brain, spec));
  const now = new Date().toISOString();
  const actions = event.actions || [];
  const promptText = event.prompt || 'Manual model change';
  next.aiSessionHistory = [
    {
      id: `session-${Date.now()}`,
      prompt: promptText,
      source: event.source || 'local',
      revisionBefore: event.beforeRevision,
      revisionAfter: event.afterRevision,
      operationCount: actions.length,
      summary: actions[0] || event.summary || 'Design state updated.',
      createdAt: now
    },
    ...(next.aiSessionHistory || [])
  ].slice(0, 40);
  if (actions.length) {
    next.decisions = [
      {
        id: `decision-${Date.now()}`,
        text: actions[0],
        rationale: `Applied from: ${promptText}`,
        revision: event.afterRevision,
        affectedObjects: event.changedIds || [],
        source: event.source || 'planner',
        createdAt: now
      },
      ...(next.decisions || [])
    ].slice(0, 60);
    next.modelFileVersions = [
      {
        id: `version-${event.afterRevision}-${Date.now()}`,
        revision: event.afterRevision,
        label: actions[0],
        changedObjects: event.changedIds || [],
        createdAt: now
      },
      ...(next.modelFileVersions || [])
    ].slice(0, 80);
  }
  const issueTasks = (event.issues || [])
    .filter((issue) => issue.severity !== 'pass')
    .map((issue, index) => ({
      id: `task-${event.afterRevision}-${index}-${String(issue.title || 'issue').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: issue.title,
      stage: 'Review',
      status: 'open',
      priority: issue.severity === 'critical' ? 'high' : 'medium',
      description: issue.fix
    }));
  next.taskQueue = [...issueTasks, ...(next.taskQueue || [])]
    .filter((task, index, all) => all.findIndex((item) => item.id === task.id || item.title === task.title) === index)
    .slice(0, 80);
  next.outputReview = {
    ...(next.outputReview || {}),
    readiness: event.issues?.some((issue) => issue.severity === 'critical') ? 'blocked schematic' : 'schematic',
    lastReviewedRevision: event.afterRevision,
    missing: [
      ...new Set([
        ...(next.outputReview?.missing || []),
        ...((event.issues || []).filter((issue) => issue.severity !== 'pass').map((issue) => issue.title))
      ])
    ].slice(0, 12)
  };
  return next;
}

export function buildContextPacket(spec, projectBrain, selected, exactTask = '') {
  const brain = ensureProjectBrain(projectBrain, spec);
  const selectedSummary = selected ? `${selected.name} (${selected.category || selected.type || 'object'})` : 'none';
  return {
    projectSummary: brain.masterDesignBrief.summary,
    currentStage: brain.stage,
    currentDesignState: {
      projectName: spec.projectName,
      revision: spec.revision,
      shell: spec.shell,
      selected: selectedSummary,
      roomCount: spec.rooms.length,
      elementCount: (spec.elements || []).length,
      openingCount: (spec.openings || []).length,
      systems: spec.systems
    },
    relevantDecisions: (brain.decisions || []).slice(0, 5),
    relevantConstraints: (brain.constraints || []).slice(0, 5),
    openQuestions: (brain.openQuestions || []).filter((question) => question.status !== 'closed').slice(0, 5),
    exactTask: exactTask || 'Awaiting user design operation.',
    expectedOutput: 'Validated structured BIM operations plus updated project logs.',
    doNotChange: ['Do not change unrelated rooms or site elements.', 'Do not invent geometry from images without traceable information.']
  };
}
