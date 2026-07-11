import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { pushToBlender, exportIfcViaBlender } from './blenderBridge.js';
import { createFrameDrawingSetHtml } from './frameDrawings.js';
import {
  OPENING_TYPES, FRAME_TYPES, resolveFrameType, FLOORING_TYPES, resolveFlooring, SUBFLOOR_TYPES, resolveSubfloor, INSULATION_TYPES,
  resolveInsulation, footprintPolygon, footprintEdges, hasCustomFootprint, polygonArea, maxFoundationExposureFt, basementInfo, BASEMENT_LEVEL,
  PARTITION_TYPES, CLADDING_TYPES
} from '../backend/bim-core.mjs';
import {
  AlertTriangle, Box, Camera, CheckCircle2, ClipboardCheck, Coins, Download, FileText,
  FileJson, Grid3X3, Hammer, Layers, Plus, Play, RefreshCcw, Ruler,
  Save, Send, ShieldCheck, Sparkles, Trash2, Undo2, Upload, Users,
  Wrench
} from 'lucide-react';
import {
  DASHBOARD_STORAGE_KEY, DEFAULT_PROMPT, DEFAULT_EXPERT_QUESTION, OUTDOOR_SPACE_TYPES, expertCouncil, addToTargets, elementLibrary, seedSpec,
  loadSavedDashboardState, cleanSavedChatMessages, workflowStages, ensureProjectBrain, updateProjectBrainAfterOperation, buildContextPacket, clamp, sitePadRect,
  clampObjectPosition, downloadFile, titleCase, targetLocationForPhrase, roofProfile, storeyInfo, upperPlateRect, floorCount,
  floorLabel, resolveOverhangs, OUTDOOR_ITEMS, FOUNDATION_RUN_TYPES, FOUNDATION_RUN_PRESETS, OUTBUILDING_CONSTRUCTION, OUTBUILDING_PRESETS, outdoorItemPresent,
  interiorFixtures, ROOM_PRESETS, FIX_LABELS, parseLocalRoomAdds, findFreeSpot, planNewRoomPlacements, derivePartitionOps, arrangeRoomsPlan,
  DEFAULT_MODEL_LAYERS, MAINTENANCE_TASKS, buildTimeline, materialsTakeoff, LAYER_PRESETS, siteOf, utilitiesOf, reclaimedOf,
  zipRegionInfo, getWallSections, getSpecialBimObjects, systemFieldForLibraryItem, appliedSystemText, wallAssemblyProfile, WALL_SIDES, WALL_SIDE_LABELS,
  WALL_ASSEMBLIES, wallAssemblyKeyFromText, resolveWallSide, wallsAreMixed, applyNaturalLanguageDesign, interpreterSummary, isConsultativePrompt, buildStudioConversationResponse,
  operationDescription, structuredPlanSummary, buildDashboardStatePayload, normalizeRooms, detectIssues, runCouncil, convertSpecApproach, deriveDesign,
  fmtMoney, fmtNum, SYSTEM_GROUPS, COST_ROWS, SYSTEM_META, expertResponse, wholeTeamResponse, reviseSpec,
  greenLeaf, greenOptStyle,
  requestCurrentProjectState, saveDashboardStateToBackend, requestServerAppliedBim, requestStudioResponse
} from './engine.js';
import { createIfcSummary, createDrawingSetHtml } from './docExports.js';
import { JointDetail, PlanView } from './planView.jsx';
import { ThreeScene, webglAvailable } from './threeScene.jsx';
import './styles.css';

// Vite announces a dev full-reload BEFORE it happens. Mark it so the opening
// card can tell a code-edit reload (stay out of the way) from the user opening
// or refreshing the app themselves (always show the front door).
// A fetch that never reached the server at all (the engine window was closed,
// crashed, or the machine restarted) — different from a server that answered
// with an error. Browsers word it differently: Chrome "Failed to fetch",
// Firefox "NetworkError…", Safari "Load failed".
function isConnectionError(error) {
  return /failed to fetch|networkerror|load failed|connection refused|network request failed/i.test(String(error?.message || error));
}

const ENGINE_OFFLINE_NOTICE = 'I can’t reach the design engine, so changes aren’t saving right now — your last edit didn’t stick. The engine window (the one that says "running at http://127.0.0.1:5184") has stopped. Start it again by double-clicking start.bat in the app folder (Start Mac.command on a Mac), then reload this page. Your design is safe on disk. I’ll say the moment I can reach it again.';

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    try { window.sessionStorage.setItem('nbHmrReload', '1'); } catch { /* storage blocked — card just reopens */ }
  });
}

// One consistent "there's more here" affordance for every system page: the
// plain controls stay visible, the finer grain folds behind this. Native
// <details> — no state to manage, keyboard/AT-friendly for free.
function FineTune({ label, hint, children }) {
  return (
    <details className="fineTune">
      <summary><span className="ftArrow" aria-hidden="true">▸</span>{label}{hint ? <small>{hint}</small> : null}</summary>
      <div className="fineTuneBody">{children}</div>
    </details>
  );
}

function App() {
  const initialSaved = loadSavedDashboardState();
  const [projectId, setProjectId] = useState(() => initialSaved?.projectId || 'current-project');
  const [spec, setSpec] = useState(() => initialSaved?.spec || seedSpec);
  const [systemView, setSystemView] = useState('shell');
  const [wallMoveFt, setWallMoveFt] = useState(2);
  const [wallOpeningType, setWallOpeningType] = useState('window');
  const [windowAddWall, setWindowAddWall] = useState('south');
  const [overhangBreakOpen, setOverhangBreakOpen] = useState(false);
  const [prompt, setPrompt] = useState(() => initialSaved?.prompt || DEFAULT_PROMPT);
  const [selectedRoom, setSelectedRoom] = useState(() => initialSaved?.selectedRoom || 'great');
  const [imagePreview, setImagePreview] = useState('');
  const [attachedImages, setAttachedImages] = useState([]);
  const [chatMessages, setChatMessages] = useState(() => cleanSavedChatMessages(initialSaved?.chatMessages));
  const [chatTarget, setChatTarget] = useState(() => initialSaved?.chatTarget || 'design');
  const [addToTarget, setAddToTarget] = useState(() => initialSaved?.addToTarget || 'auto');
  const [selectedExpertId, setSelectedExpertId] = useState(() => initialSaved?.selectedExpertId || 'team');
  const [expertQuestion, setExpertQuestion] = useState(() => initialSaved?.expertQuestion || DEFAULT_EXPERT_QUESTION);
  const [revisionLog, setRevisionLog] = useState(() => initialSaved?.revisionLog || ['Rev 1: Baseline professional schematic loaded.']);
  const [history, setHistory] = useState(() => initialSaved?.history || []);
  const [lastModelChange, setLastModelChange] = useState(() => initialSaved?.lastModelChange || 'Baseline model loaded.');
  const [operationAudit, setOperationAudit] = useState(() => initialSaved?.operationAudit || []);
  const [projectBrain, setProjectBrain] = useState(() => ensureProjectBrain(initialSaved?.projectBrain, initialSaved?.spec || seedSpec));
  const [clipboardObject, setClipboardObject] = useState(null);
  const [consoleView, setConsoleView] = useState('systems');
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [appMode, setAppMode] = useState('design');
  // No graphics acceleration (WebGL off) → the app starts in the Plan view
  // instead of a broken 3D pane; the 3D tab stays clickable and explains.
  // webglOK also hides every 3D-only overlay control (camera buttons, slice,
  // layers, drag hints) so the fallback pane never shows dead chrome.
  const webglOK = webglAvailable();
  const [viewMode, setViewMode] = useState(() => (webglOK ? '3d' : 'plan'));
  // Room-add queue: rapid preset clicks are applied ONE at a time, each
  // against the spec the previous add returned — never against stale state.
  // pendingRoomAdds is the visible "Adding Bedroom…" acknowledgment.
  const roomQueueRef = useRef({ queue: [], running: false });
  const [pendingRoomAdds, setPendingRoomAdds] = useState([]);
  // Camera flight requests + the section-cut slider — deliberately plain
  // state (not persisted): a fresh open always starts whole and unsliced.
  const [viewRequest, setViewRequest] = useState(null);
  const [sectionCut, setSectionCut] = useState(1);
  const [activeFloor, setActiveFloor] = useState(1);
  const [buildProgress, setBuildProgress] = useState(() => initialSaved?.buildProgress || {});
  const [inspectorView, setInspectorView] = useState('inspect');
  // The inspector lives IN the left control column (portal target) — the model
  // stays the selector surface, the left bar the single control surface.
  const [inspectorDock, setInspectorDock] = useState(null);
  const [selMenuOpen, setSelMenuOpen] = useState(false);
  // The chat column is toggle-able — hidden, the model gets its width.
  // It STARTS closed (the model is the star); once the user chooses, their
  // choice sticks. Messages arriving while it's closed badge the Chat button.
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      const stored = window.localStorage.getItem('nbChatOpen');
      return stored === null ? false : stored !== '0';
    } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('nbChatOpen', chatOpen ? '1' : '0'); } catch { /* private mode */ }
  }, [chatOpen]);
  // Unread badge: count messages that arrive while the chat is closed, so a
  // reply or confirmation never lands unseen. Restores don't count.
  const [chatUnread, setChatUnread] = useState(0);
  const chatRestoringRef = useRef(false);
  const prevChatLenRef = useRef(null);
  // The Inspector is PINNED to the bottom of the left column (no scroll-to-
  // find-it — the old smooth-scroll bridge was cancelled by the 3D rebuild
  // that fires on the same selection, so tapping a wall looked like a no-op).
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // The design journey: systems the user has opened get a quiet sage dot in
  // the nav — a sense of ground covered on the way to a complete design.
  const [visitedSystems, setVisitedSystems] = useState(() => initialSaved?.visitedSystems || ['shell']);
  const [dimensionPreview, setDimensionPreview] = useState(null);
  const [savedAt, setSavedAt] = useState(() => initialSaved?.savedAt || '');
  const [libraryActionMode, setLibraryActionMode] = useState(() => initialSaved?.libraryActionMode || 'apply');
  const [modelLayers, setModelLayers] = useState(() => ({ ...DEFAULT_MODEL_LAYERS, ...(initialSaved?.modelLayers || {}) }));
  const [layersOpen, setLayersOpen] = useState(false);
  // First run (nothing saved anywhere): ask how to begin instead of silently
  // dropping the visitor into a finished sample house. Also reusable as "New".
  // The opening card is the front door: what the app is, how to use it, and
  // continue / start-fresh choices. It shows on every open; Continue is one tap.
  // The opening card is the front door on EVERY real page load — but a code
  // hot-reload mid-session must NOT slam it in the user's face. Vite announces
  // a dev full-reload before it happens (the marker set at module scope below),
  // so only THOSE reloads respect the per-tab dismissal; opening the app or
  // pressing refresh yourself always starts at the front door.
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    try {
      const wasHmrReload = window.sessionStorage.getItem('nbHmrReload');
      window.sessionStorage.removeItem('nbHmrReload');
      if (wasHmrReload) return !window.sessionStorage.getItem('nbWelcomeDismissed');
      return true;
    } catch { return true; }
  });
  useEffect(() => {
    try {
      if (welcomeOpen) window.sessionStorage.removeItem('nbWelcomeDismissed');
      else window.sessionStorage.setItem('nbWelcomeDismissed', '1');
    } catch { /* storage blocked — the card just reopens on HMR */ }
  }, [welcomeOpen]);
  const [welcomeIsFirstRun, setWelcomeIsFirstRun] = useState(() => !initialSaved);
  // Every design ever saved lives in the revision snapshots — the card offers
  // them back ("start other previous model").
  const [previousDesigns, setPreviousDesigns] = useState([]);
  useEffect(() => {
    if (!welcomeOpen) return;
    let cancelled = false;
    fetch('/api/projects/current/designs')
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setPreviousDesigns(data?.designs || []); })
      .catch(() => { /* backend not up yet — the list just stays empty */ });
    return () => { cancelled = true; };
  }, [welcomeOpen]);

  async function restorePreviousDesign(design) {
    try {
      const response = await fetch('/api/projects/current/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: design.file })
      });
      const data = await response.json();
      if (!data?.ok || !data?.state?.spec) throw new Error(data?.error || 'restore failed');
      restoreDashboardState(data.state);
      setWelcomeOpen(false);
      setWelcomeIsFirstRun(false);
      setLastModelChange(`Restored ${design.projectName} (rev ${design.revision}).`);
    } catch (error) {
      window.alert(`Could not restore that design: ${error.message}`);
    }
  }
  const [welcomeName, setWelcomeName] = useState('');
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState([]);
  const [geoStatus, setGeoStatus] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const planDragRevisionRef = useRef(false);
  const chatStreamRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const backendReadyRef = useRef(false);
  // One outage = ONE chat notice + a banner, never a chat reply per failed
  // drag (a dead engine once made the chat "respond" to every model move).
  const backendDownRef = useRef(false);
  const [backendDown, setBackendDown] = useState(false);

  const issues = useMemo(() => detectIssues(spec), [spec]);
  const council = useMemo(() => runCouncil(spec), [spec]);
  const wallSections = useMemo(() => getWallSections(spec), [spec]);
  const specialBimObjects = useMemo(() => getSpecialBimObjects(spec), [spec]);
  const selected = spec.rooms.find((room) => room.id === selectedRoom) || (spec.elements || []).find((element) => element.id === selectedRoom) || wallSections.find((wall) => wall.id === selectedRoom) || specialBimObjects.find((object) => object.id === selectedRoom) || spec.rooms[0];
  const selectedIsElement = Boolean((spec.elements || []).some((element) => element.id === selectedRoom));
  const selectedIsWall = Boolean(wallSections.some((wall) => wall.id === selectedRoom));
  const selectedIsSpecial = Boolean(specialBimObjects.some((object) => object.id === selectedRoom));
  const selectedIsOpening = selected?.category === 'opening';
  const selectedIsPad = selected?.id === 'site-pad';
  const selectedIsGrid = selected?.id === 'outdoor-grid';
  const selectedIsRoof = selected?.id === 'roof-main';
  const selectedExpert = selectedExpertId === 'team' ? null : expertCouncil.find((expert) => expert.id === selectedExpertId);
  const modeledWallProfile = wallAssemblyProfile(spec.systems.envelope);
  const modeledRoofProfile = roofProfile(spec.shell);
  const area = Math.round(spec.shell.widthFt * spec.shell.depthFt);
  const qualityScore = Math.max(42, 100 - issues.filter((item) => item.severity !== 'pass').length * 16);
  const openFlagCount = issues.filter((item) => item.severity !== 'pass').length;
  const flaggedSystems = useMemo(() => new Set(issues.filter((item) => item.severity !== 'pass' && item.system).map((item) => item.system)), [issues]);
  const derived = useMemo(() => deriveDesign(spec, wallSections), [spec, wallSections]);
  const estimatedCost = Math.round(derived.total);
  // How filtered is the model view? (Hidden groups never change the design or
  // the numbers — this powers the "partial view" cue so that stays obvious.)
  const hiddenLayerCount = useMemo(() => {
    const visibilityKeys = ['wallNorth', 'wallSouth', 'wallEast', 'wallWest', 'roof', 'rooms', 'openings', 'elements', 'pad', 'ground', 'labels'];
    if (storeyInfo(spec.shell).storeys > 1) visibilityKeys.push('upperFloors');
    return visibilityKeys.filter((key) => modelLayers[key] === false).length + (modelLayers.hiddenCats || []).length;
  }, [modelLayers, spec]);
  const contextPacket = useMemo(() => buildContextPacket(spec, projectBrain, selected, prompt || expertQuestion), [spec, projectBrain, selected, prompt, expertQuestion]);

  function restoreDashboardState(snapshot) {
    if (!snapshot?.spec?.shell || !Array.isArray(snapshot.spec.rooms)) return;
    setProjectId(snapshot.projectId || 'current-project');
    setSpec(snapshot.spec);
    setPrompt(snapshot.prompt || DEFAULT_PROMPT);
    setSelectedRoom(snapshot.selectedRoom || snapshot.spec.rooms[0]?.id || 'great');
    chatRestoringRef.current = true; // a restored history is not "unread"
    setChatMessages(cleanSavedChatMessages(snapshot.chatMessages));
    setChatTarget(snapshot.chatTarget || 'design');
    setAddToTarget(snapshot.addToTarget || 'auto');
    setSelectedExpertId(snapshot.selectedExpertId || 'team');
    setExpertQuestion(snapshot.expertQuestion || DEFAULT_EXPERT_QUESTION);
    setRevisionLog(snapshot.revisionLog || ['Rev 1: Baseline professional schematic loaded.']);
    setHistory(snapshot.history || []);
    setLastModelChange(snapshot.lastModelChange || 'Baseline model loaded.');
    setOperationAudit(snapshot.operationAudit || []);
    setProjectBrain(ensureProjectBrain(snapshot.projectBrain, snapshot.spec));
    setSavedAt(snapshot.savedAt || '');
    setLibraryActionMode(snapshot.libraryActionMode || 'apply');
    setModelLayers({ ...DEFAULT_MODEL_LAYERS, ...(snapshot.modelLayers || {}) });
    setBuildProgress(snapshot.buildProgress || {});
    setVisitedSystems(snapshot.visitedSystems || ['shell']);
  }

  function currentDashboardState(custom = {}) {
    return buildDashboardStatePayload({
      projectId,
      savedAt,
      spec,
      selectedRoom,
      prompt,
      chatTarget,
      addToTarget,
      selectedExpertId,
      expertQuestion,
      libraryActionMode,
      revisionLog,
      history,
      lastModelChange,
      operationAudit,
      projectBrain,
      chatMessages,
      modelLayers,
      buildProgress,
      visitedSystems,
      ...custom
    });
  }

  function startNewDesign(template) {
    const next = structuredClone(seedSpec);
    next.revision = 1;
    if (template === 'blank') {
      next.rooms = [];
      next.elements = [];
      next.openings = [];
      next.levels = [];
    }
    next.projectName = welcomeName.trim() || (template === 'blank' ? 'My Natural Home' : 'Sample Homestead Study');
    const startLine = template === 'blank'
      ? 'Rev 1: A fresh start — an empty shell on the land. Add rooms, or describe the home you want in the chat.'
      : 'Rev 1: Sample homestead loaded as a starting point — everything in it is yours to change.';
    setSpec(next);
    setHistory([]);
    setRevisionLog([startLine]);
    setChatMessages([]);
    setOperationAudit([]);
    setSelectedRoom(next.rooms[0]?.id || 'site-pad');
    setLastModelChange(template === 'blank' ? 'Fresh start on empty land.' : 'Sample homestead loaded.');
    setProjectBrain(ensureProjectBrain(null, next));
    setModelLayers({ ...DEFAULT_MODEL_LAYERS });
    setWelcomeName('');
    setWelcomeOpen(false);
    setWelcomeIsFirstRun(false);
  }

  // Start from a file or drawing: a fresh design with the sketch/PDF attached
  // to the planner and the ask pre-filled — add scale/orientation, hit Apply.
  function startFromFile(file) {
    if (!file) return;
    startNewDesign('blank');
    handleImage(file);
    setPrompt('Start this design from the attached drawing: read the footprint, the rooms and their sizes, and the windows and doors, and build them.');
    setChatMessages((items) => [
      ...items,
      { role: 'studio', speaker: 'Studio', text: `Fresh design started from ${file.name}. Tell me anything the drawing can't say — overall width in feet, which way is south — then press Apply Design and I'll build it.` }
    ]);
  }

  async function answerConsultativePrompt(submittedPrompt) {
    try {
      const result = await requestStudioResponse({
        prompt: submittedPrompt,
        bim: spec,
        spec,
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        attachedImages,
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(spec, projectBrain, selected, submittedPrompt)
      });
      const reply = result.reply || buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
      const warningText = result.warnings?.length ? `\n\nNotes:\n- ${result.warnings.join('\n- ')}` : '';
      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: `${reply}${warningText}` }
      ]);
      setRevisionLog((items) => [`Studio consult: answered "${submittedPrompt}" without changing the BIM.`, ...items]);
    } catch (error) {
      const reply = buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: `${reply}\n\nNote: Studio vision/analysis was unavailable just now (${error.message}), so I answered from the live BIM state only.` }
      ]);
      setRevisionLog((items) => [`Studio consult fallback: answered "${submittedPrompt}" while studio analysis was unavailable.`, ...items]);
    }
  }

  function markBackendDown(noticeText = ENGINE_OFFLINE_NOTICE) {
    const firstTime = !backendDownRef.current;
    backendDownRef.current = true;
    setBackendDown(true);
    if (firstTime && noticeText) {
      setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: noticeText }]);
    }
    return firstTime;
  }

  function clearBackendDown(announce = false) {
    if (!backendDownRef.current) return;
    backendDownRef.current = false;
    setBackendDown(false);
    if (announce) {
      setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: 'The design engine is back — changes are saving again. Redo your last edit if it didn’t stick.' }]);
    }
  }

  // While the engine is down, quietly knock every few seconds so the app
  // recovers by itself the moment the user restarts it — no reload needed.
  useEffect(() => {
    if (!backendDown) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch('/api/projects/current');
        if (!cancelled && response.ok) clearBackendDown(true);
      } catch { /* still down — keep knocking */ }
    }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [backendDown]);

  async function applyBackendOperations({
    operations,
    promptText,
    logPrefix = 'BIM edit',
    chatText = '',
    nextSelectedId = null,
    persist = true,
    baseSpec = null
  }) {
    // Chained UI actions (add-then-arrange) must apply to the spec returned by
    // the prior step, not stale component state, or the second call clobbers
    // the first. baseSpec lets a caller pass that fresh spec explicitly.
    const source = baseSpec || spec;
    const plan = {
      source: 'manual-ui',
      summary: promptText,
      operations,
      warnings: [],
      assumptions: [],
      questions: []
    };
    let result;
    try {
      result = await requestServerAppliedBim({
        prompt: promptText,
        bim: source,
        spec: source,
        state: currentDashboardState(),
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        addToTarget,
        attachedImages: [],
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(source, projectBrain, selected, promptText),
        plan,
        persist
      });
    } catch (error) {
      // A change must never vanish silently — say so where the user is looking.
      setLastModelChange(`"${promptText}" did not apply — the design service didn't respond. Try it again.`);
      if (isConnectionError(error)) {
        markBackendDown();
      } else {
        setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: `"${promptText}" didn't save (${error?.message || 'no response'}). Nothing changed — try it once more.` }]);
      }
      return null;
    }
    clearBackendDown();
    const report = result.report;
    rememberRevision();
    setSpec(report.spec);
    recordOperationAudit(promptText, plan, report, spec.revision, report.spec.revision);
    const chosenId = nextSelectedId || report.changedIds[0];
    if (chosenId) setSelectedRoom(chosenId);
    // A multi-op batch is ONE transaction — the chip says what the whole batch
    // did ("Set all walls to Straw Bale"), not just its first operation
    // ("set north wall…", which read as a change to one wall).
    const transactionText = report.actions.length > 1 ? `${promptText} (${report.actions.length} changes)` : report.actions[0];
    if (transactionText) setLastModelChange(transactionText);
    if (chatText) {
      setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: chatText || transactionText }]);
    }
    setRevisionLog((items) => [`Rev ${report.spec.revision}: ${logPrefix}${transactionText ? ` - ${transactionText}` : ''}`, ...items]);
    return report;
  }

  useEffect(() => {
    if (activeFloor > floorCount(spec)) setActiveFloor(1);
    if (activeFloor === BASEMENT_LEVEL && !basementInfo(spec.shell).present) setActiveFloor(1);
  }, [spec, activeFloor]);

  useEffect(() => {
    if (appMode !== 'design' || consoleView !== 'systems') return;
    setVisitedSystems((visited) => (visited.includes(systemView) ? visited : [...visited, systemView]));
  }, [systemView, consoleView, appMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await requestCurrentProjectState();
        if (!cancelled && result?.state?.spec) {
          restoreDashboardState(result.state);
          // A design exists — the opening card stays up as the front door,
          // now offering "Continue where you left off."
          setWelcomeIsFirstRun(false);
        }
      } catch (error) {
        console.warn('Backend project load skipped:', error);
      } finally {
        backendReadyRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const now = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const payload = buildDashboardStatePayload({
      projectId,
      savedAt: now,
      spec,
      selectedRoom,
      prompt,
      chatTarget,
      addToTarget,
      selectedExpertId,
      expertQuestion,
      libraryActionMode,
      revisionLog,
      history,
      lastModelChange,
      operationAudit,
      projectBrain,
      chatMessages,
      modelLayers,
      buildProgress,
      visitedSystems
    });
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(payload));
      if (backendReadyRef.current) {
        void saveDashboardStateToBackend(payload).catch((error) => {
          console.warn('Backend autosave skipped:', error);
        });
      }
    }, 250);
    if (!savedAt) setSavedAt(now);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [projectId, spec, selectedRoom, libraryActionMode, chatMessages, chatTarget, addToTarget, selectedExpertId, expertQuestion, prompt, operationAudit, projectBrain, modelLayers, buildProgress, visitedSystems]);

  useEffect(() => {
    const prev = prevChatLenRef.current;
    prevChatLenRef.current = chatMessages.length;
    if (chatRestoringRef.current) { chatRestoringRef.current = false; return; }
    if (prev === null) return;
    if (!chatOpen && chatMessages.length > prev) setChatUnread((n) => n + (chatMessages.length - prev));
  }, [chatMessages, chatOpen]);
  useEffect(() => {
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);

  useEffect(() => {
    const stream = chatStreamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [chatMessages, isPlanning]);

  useEffect(() => {
    function onKeyDown(event) {
      const key = event.key.toLowerCase();
      const active = document.activeElement;
      const isTyping = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
      const isModifier = event.ctrlKey || event.metaKey;

      if (isModifier && key === 's') {
        event.preventDefault();
        saveHouseState();
        return;
      }

      if (isModifier && key === 'enter') {
        event.preventDefault();
        submitChat();
        return;
      }

      if (isModifier && key === 'z' && !isTyping) {
        event.preventDefault();
        goBackRevision();
        return;
      }

      if (isModifier && key === 'c' && !isTyping && selected && !selectedIsWall && !selectedIsSpecial) {
        event.preventDefault();
        setClipboardObject(structuredClone(selected));
        return;
      }

      if (isModifier && key === 'v' && !isTyping && clipboardObject) {
        event.preventDefault();
        pasteClipboardObject();
        return;
      }

      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && !isTyping && selected && !selectedIsWall && !selectedIsSpecial) {
        event.preventDefault();
        const step = event.shiftKey ? 4 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        nudgeSelected(dx, dy);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !isTyping) {
        event.preventDefault();
        removeSelectedRoom();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, selectedRoom, selected, selectedIsWall, selectedIsSpecial, prompt, expertQuestion, chatTarget, addToTarget, attachedImages, chatMessages, isPlanning, clipboardObject]);

  function rememberRevision(currentSpec = spec, currentSelectedRoom = selectedRoom, currentImagePreview = imagePreview, currentAttachedImages = attachedImages) {
    setHistory((items) => [
      {
        spec: structuredClone(currentSpec),
        selectedRoom: currentSelectedRoom,
        imagePreview: currentImagePreview,
        attachedImages: structuredClone(currentAttachedImages)
      },
      ...items
    ].slice(0, 80));
  }

  function goBackRevision() {
    const previous = history[0];
    if (!previous) return;
    setSpec(previous.spec);
    setSelectedRoom(previous.selectedRoom);
    setImagePreview(previous.imagePreview || '');
    setAttachedImages(previous.attachedImages || []);
    setHistory((items) => items.slice(1));
    setRevisionLog((items) => [`Back to Revision ${previous.spec.revision}: restored previous BIM state.`, ...items]);
    setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: `Back to Revision ${previous.spec.revision}.` }]);
  }

  function recordOperationAudit(promptText, plan, report, beforeRevision, afterRevision) {
    const operations = (plan?.operations || []).map((operation) => operationDescription(operation, report?.spec || spec));
    setOperationAudit((items) => [
      {
        id: `${Date.now()}`,
        prompt: promptText,
        source: report?.source || plan?.source || 'planner',
        intent: plan?.intent || report?.summary || 'structured BIM operation',
        confidence: plan?.confidence,
        beforeRevision,
        afterRevision,
        changedIds: report?.changedIds || [],
        operations,
        warnings: report?.warnings || [],
        rejected: report?.rejectedOperations || []
      },
      ...items
    ].slice(0, 60));
    setProjectBrain((current) => updateProjectBrainAfterOperation(current, report?.spec || spec, {
      prompt: promptText,
      source: report?.source || plan?.source || 'planner',
      beforeRevision,
      afterRevision,
      actions: report?.actions || operations,
      changedIds: report?.changedIds || [],
      issues: report?.issues || [],
      summary: report?.summary
    }));
  }

  async function applyPrompt() {
    if (!prompt.trim()) return;
    const submittedPrompt = prompt.trim();
    setPrompt('');

    // Design mode is ACTION-FIRST: everything goes to the planner. Pure
    // questions still get a conversational answer — but only when the plan
    // produces no operations, never by hijacking a build request. (The old
    // "sounds like a question" pre-check swallowed asks like "build the house
    // from this plan" into chat mode — the drawing never reached the planner.)
    const questionOnly = !attachedImages.length && isConsultativePrompt(submittedPrompt, []) && !/\b(apply|build|make|create|add|move|resize|change|set|trace|use|model|draw)\b/i.test(submittedPrompt);
    if (questionOnly) {
      await answerConsultativePrompt(submittedPrompt);
      return;
    }

    // TRUTH GATE: a request that depends on reading an attached drawing must
    // stop honestly when there is nothing readable attached (the earlier read
    // may have failed) — never fall through to a planner that would fabricate
    // a "trace" from the words of the request.
    const needsDrawing = /\battach(?:ed|ment)?\b|\btrace\b|\bfrom\s+(?:the|this|my)\s+(?:drawing|sketch|blueprint|pdf|file|image|photo|plans?)\b|\b(?:the|this)\s+(?:drawing|sketch|blueprint|pdf)\b/i.test(submittedPrompt);
    if (needsDrawing && !attachedImages.length) {
      setChatMessages((items) => [
        ...items,
        { role: 'user', speaker: 'You', text: submittedPrompt },
        { role: 'studio', speaker: 'Studio', text: 'I don\'t have a readable drawing attached, so I haven\'t changed anything. The earlier file may have failed to read — re-attach it (the 📎 button, or Start from a file on the opening card), or tell me the numbers instead: overall width × depth in feet, which way is south, and the rooms with sizes. I\'ll build from those.' }
      ]);
      setRevisionLog((items) => [`No change: "${submittedPrompt}" needs a drawing and none is attached.`, ...items]);
      return;
    }

    // Fast local path: "remove the duplicate/excess windows" is mechanical —
    // the backend dedupes deterministically; no AI needed (and the planner
    // used to choke on exactly this ask). Runs even with a drawing attached.
    if (/\b(remove|delete|clean\s?up|clear|get rid of|fix)\b[^.]*\b(duplicate|duplicated|excess|extra|overlap\w*|redundant)\b[^.]*\b(opening|window|door)/i.test(submittedPrompt)
      || /\b(duplicate|excess|extra|overlapping)\b[^.]*\b(openings?|windows?|doors?)\b[^.]*\b(remove|delete|clean|clear|out)\b/i.test(submittedPrompt)
      || /\bdedupe?\b.*\b(openings?|windows?|doors?)\b/i.test(submittedPrompt)) {
      setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submittedPrompt }]);
      setPrompt('');
      await applyBackendOperations({
        operations: [{ type: 'dedupe_openings' }],
        promptText: 'Clean up duplicate openings',
        logPrefix: 'Openings',
        chatText: 'Cleaned overlapping and duplicate windows/doors — where two openings shared the same stretch of wall, the door (or the wider one) stayed. Instant, no planner needed.'
      });
      return;
    }

    // Fast local path: simple "add a bedroom / a kitchen 14x12" requests skip
    // the slow planner entirely and go straight through the layout engine.
    const localRooms = attachedImages.length ? null : parseLocalRoomAdds(submittedPrompt);
    if (localRooms) {
      await applyLocalRoomAdds(localRooms, submittedPrompt);
      return;
    }

    // Show the user's message and the working state IMMEDIATELY — the planner
    // can take 30-60s on a full drawing takeoff and silence reads as a hang.
    setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submittedPrompt }]);
    setIsPlanning(true);

    try {
      const payload = {
        prompt: submittedPrompt,
        bim: spec,
        spec,
        state: currentDashboardState(),
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        addToTarget,
        attachedImages,
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(spec, projectBrain, selected, submittedPrompt)
      };
      const result = await requestServerAppliedBim(payload);
      const plan = result.plan;
      const structuredReport = result.report;
      recordOperationAudit(submittedPrompt, plan, structuredReport, spec.revision, structuredReport.spec.revision);
      if (structuredReport.actions.length) {
        const next = structuredReport.spec;
        rememberRevision();
        setSpec(next);
        if (structuredReport.changedIds[0]) setSelectedRoom(structuredReport.changedIds[0]);
        setLastModelChange(structuredReport.actions[0]);
        setChatMessages((items) => [
          ...items,
          { role: 'studio', speaker: 'Studio', text: `Applied to Revision ${next.revision}.\n\n${structuredPlanSummary(structuredReport)}` }
        ]);
        setRevisionLog((items) => [`Rev ${next.revision}: Planner applied ${structuredReport.actions.length} structured BIM operation${structuredReport.actions.length === 1 ? '' : 's'}.`, ...items]);
        return;
      }

      setChatMessages((items) => [
        ...items,
        { role: 'studio', speaker: 'Studio', text: isConsultativePrompt(submittedPrompt, attachedImages) ? buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages) : `No BIM change made.\n\n${structuredPlanSummary(structuredReport)}` }
      ]);
      setRevisionLog((items) => [`No change: Planner could not turn "${submittedPrompt}" into a safe BIM operation.`, ...items]);
    } catch (error) {
      if (isConnectionError(error)) {
        // The engine itself is unreachable — nothing about the request or the
        // drawing failed. Say exactly that, with the way out; never pretend
        // this was "a conversation prompt, not a BIM edit".
        markBackendDown(null);
        setChatMessages((items) => [
          ...items,
          { role: 'studio', speaker: 'Studio', text: `I couldn’t reach the design engine, so nothing was changed — this isn’t about your drawing or your request. The engine window (the one that says "running at http://127.0.0.1:5184") has stopped. Start it again by double-clicking start.bat in the app folder (Start Mac.command on a Mac), then reload this page. Your design is safe on disk.${attachedImages.length ? ' After the reload, re-attach the drawing and send your message again.' : ''}` }
        ]);
        setRevisionLog((items) => [`No change: design engine unreachable for "${submittedPrompt}".`, ...items]);
        return;
      }
      const report = applyNaturalLanguageDesign(submittedPrompt, spec, attachedImages, addToTarget, selected);
      if (isConsultativePrompt(submittedPrompt, attachedImages)) {
        const reply = buildStudioConversationResponse(submittedPrompt, spec, selected, issues, attachedImages);
        setChatMessages((items) => [
          ...items,
          { role: 'studio', speaker: 'Studio', text: `${reply}\n\nNote: the BIM planner was unavailable just now (${error.message}), so I stayed in conversation mode instead of pretending that was a geometry request.` }
        ]);
        setRevisionLog((items) => [`Studio consult fallback: answered "${submittedPrompt}" while planner was unavailable.`, ...items]);
        return;
      }
      recordOperationAudit(submittedPrompt, { source: 'browser-emergency-fallback', operations: [] }, report, spec.revision, report.spec.revision);
      if (!report.actions.length) {
        setChatMessages((items) => [
          ...items,
          { role: 'studio', speaker: 'Studio', text: `No BIM change made.\n\nPlanner error: ${error.message}\n\n${interpreterSummary(report)}` }
        ]);
        setRevisionLog((items) => [`No change: Planner failed and fallback could not apply "${submittedPrompt}".`, ...items]);
        return;
      }
      const next = report.spec;
      rememberRevision();
      setSpec(next);
      if (report.changedIds[0]) setSelectedRoom(report.changedIds[0]);
      setLastModelChange(report.actions[0] || 'Revision applied, but no visible geometry command was detected.');
      setChatMessages((items) => [
        ...items,
        { role: 'studio', speaker: 'Studio', text: `Applied to Revision ${next.revision} with fallback parser.\n\nPlanner error: ${error.message}\n\n${interpreterSummary(report)}` }
      ]);
      setRevisionLog((items) => [`Rev ${next.revision}: Fallback parser applied changes after planner error.`, ...items]);
    } finally {
      setIsPlanning(false);
    }
  }

  function loopRevisions() {
    rememberRevision();
    const flaggedBefore = detectIssues(spec).filter((issue) => issue.severity !== 'pass');
    let next = structuredClone(spec);
    let passes = 0;
    while (passes < 4 && detectIssues(next).some((issue) => issue.severity !== 'pass')) {
      next = reviseSpec(next);
      passes += 1;
    }
    const displayedPasses = passes || 1;
    setSpec(next);
    setRevisionLog((items) => [`Rev ${next.revision}: Council loop ran ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'} and resolved available schematic blockers.`, ...items]);
    // The council speaks when ASKED — this button is the ask. Report what it
    // found and what remains, here in the conversation.
    const remaining = detectIssues(next).filter((issue) => issue.severity !== 'pass');
    const foundText = flaggedBefore.length
      ? `The council reviewed the design and flagged:\n${flaggedBefore.slice(0, 6).map((issue) => `- ${issue.owner}: ${issue.title}`).join('\n')}`
      : 'The council reviewed the design and found no blocking issues.';
    const remainText = remaining.length
      ? `\n\nStill open after ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'}:\n${remaining.slice(0, 6).map((issue) => `- ${issue.owner}: ${issue.title}`).join('\n')}\n\nSee Review for one-tap fixes.`
      : flaggedBefore.length ? `\n\nAll of it was resolved automatically in ${displayedPasses} pass${displayedPasses === 1 ? '' : 'es'}.` : '';
    setChatMessages((items) => [...items, { role: 'studio', speaker: 'Council', text: `${foundText}${remainText}` }]);
  }

  function handleImage(file) {
    if (!file) return;
    const studioSays = (text) => setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text }]);
    // Windows often reports an empty MIME type — fall back to the extension.
    const looksLikeImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|tiff?)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isTextDoc = /\.(txt|md|csv)$/i.test(file.name) || ['text/plain', 'text/markdown', 'text/csv'].includes(file.type);
    const attach = (src, kind = 'image') => {
      const image = {
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        src,
        size: file.size,
        kind
      };
      if (kind === 'image') setImagePreview(image.src);
      setAttachedImages((items) => [image, ...items].slice(0, 6));
      setChatMessages((items) => [
        ...items,
        kind === 'image'
          ? { role: 'user', speaker: 'You', text: `Attached reference image: ${file.name}`, image: image.src }
          : { role: 'user', speaker: 'You', text: `Attached document: ${file.name}` },
        { role: 'studio', speaker: 'Studio', text: kind === 'image'
          ? 'Image attached to chat. Tell me what to use from it, such as "trace the handwritten room labels", "match this roof shape", or "turn this sketch into a 32 x 24 plan".'
          : 'Document attached — the planner will read it with your next message. Ask things like "use the setbacks from this survey", "size the house to fit this parcel", or "what does this spec sheet mean for my walls".' }
      ]);
    };
    // Documents: PDFs and plain text go to the planner as themselves.
    if (isPdf || isTextDoc) {
      if (file.size > 15 * 1024 * 1024) {
        studioSays(`"${file.name}" is ${(file.size / 1048576).toFixed(0)} MB — too big to send to the planner. Keep documents under 15 MB (export just the relevant pages).`);
        return;
      }
      const docReader = new FileReader();
      docReader.onerror = docReader.onabort = () => {
        studioSays(`I couldn't read "${file.name}" from disk. If it lives in cloud storage (Google Drive, OneDrive), it may be online-only — open it once or copy it somewhere local, then try again.`);
      };
      docReader.onload = () => {
        let src = String(docReader.result || '');
        if (!src.startsWith('data:')) {
          studioSays(`I couldn't read "${file.name}" — the file came back empty. Try copying it somewhere local first.`);
          return;
        }
        // Empty/odd MIME from Windows: rewrite the data URL to the real type.
        const wantedMime = isPdf ? 'application/pdf' : 'text/plain';
        if (!src.startsWith(`data:${wantedMime}`)) src = src.replace(/^data:[^;,]*/, `data:${wantedMime}`);
        attach(src, isPdf ? 'pdf' : 'text');
      };
      docReader.readAsDataURL(file);
      return;
    }
    if (!looksLikeImage) {
      studioSays(`"${file.name}" isn't a file type I can read. Photos (JPG or PNG), PDFs, and plain text (.txt, .md, .csv) all work.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => {
      studioSays(`I couldn't read "${file.name}" from disk. If it lives in cloud storage (Google Drive, OneDrive), it may be online-only — open it once or copy it somewhere local, then try again.`);
    };
    reader.onload = () => {
      const raw = String(reader.result || '');
      if (!raw.startsWith('data:')) {
        studioSays(`I couldn't read "${file.name}" — the file came back empty. Try copying it somewhere local first.`);
        return;
      }
      // Decode + downscale before attaching: huge photos stay fast, and
      // formats the browser can't decode fail with an explanation instead
      // of silently attaching garbage.
      const probe = new Image();
      probe.onload = () => {
        const longest = Math.max(probe.width, probe.height);
        if (longest > 1600) {
          const scale = 1600 / longest;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(probe.width * scale);
          canvas.height = Math.round(probe.height * scale);
          canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
          attach(canvas.toDataURL('image/jpeg', 0.85));
        } else {
          attach(raw);
        }
      };
      probe.onerror = () => {
        const isHeic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/.test(file.type);
        studioSays(isHeic
          ? `"${file.name}" is a HEIC photo — browsers can't display those. Export it as JPG or PNG (or screenshot it) and add that instead.`
          : `I can't decode "${file.name}" in the browser. A JPG, PNG, or screenshot will work.`);
      };
      probe.src = raw;
    };
    reader.readAsDataURL(file);
  }

  function handleImageInput(event) {
    handleImage(event.target.files?.[0]);
    event.target.value = '';
  }

  function handleChatPaste(event) {
    const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    handleImage(file);
  }

  function removeAttachedImage(id) {
    setAttachedImages((items) => {
      const nextImages = items.filter((item) => item.id !== id);
      setImagePreview(nextImages[0]?.src || '');
      return nextImages;
    });
  }

  function updateShell(field, value) {
    const numeric = Number(value);
    const operations = [];
    if (field === 'roofType') {
      operations.push({ type: 'set_shell', field: 'roofType', value });
      if (value === 'shed') {
        operations.push({ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: spec.shell.southWallHeightFt || spec.shell.wallHeightFt + 2, northWallHeightFt: spec.shell.northWallHeightFt || spec.shell.wallHeightFt });
      }
    } else if (field === 'designApproach') {
      operations.push({ type: 'set_shell', field: 'designApproach', value });
    } else if (field === 'basementHeightFt') {
      // 0 removes the basement — it must NOT hit the generic 18-min shell clamp.
      operations.push({ type: 'set_shell', field, value: String(numeric > 0 ? clamp(numeric, 6, 12) : 0) });
    } else if (field === 'basementHeated') {
      operations.push({ type: 'set_shell', field, value: value === true || value === 'true' ? 'true' : 'false' });
    } else if (field === 'upperStoreyHeightFt') {
      operations.push({ type: 'set_shell', field, value: String(numeric > 0 ? clamp(numeric, 3, 14) : 0) });
    } else if (field === 'southWallHeightFt' || field === 'northWallHeightFt') {
      operations.push({ type: 'set_wall_height', wall: field === 'southWallHeightFt' ? 'south' : 'north', h: clamp(numeric, 2, 24) });
    } else {
      operations.push({ type: 'set_shell', field, value: String(field === 'roofPitch' ? clamp(numeric, 0.08, 0.75) : field === 'wallHeightFt' ? clamp(numeric, 7, 40) : field === 'storeys' ? clamp(numeric, 1, 3) : clamp(numeric, 18, field === 'depthFt' ? 80 : field === 'widthFt' ? 96 : field === 'padExtensionFt' ? 200 : 24)) });
    }
    void applyBackendOperations({ operations, promptText: `Update shell ${field}`, logPrefix: 'Shell edit' });
  }

  // Foundation Type is ONE choice with four answers — the fourth (basement) is
  // also a storey. Switching in creates it; switching away removes it and sets
  // the picked type, in a single dispatch (never two racing calls).
  function setFoundationChoice(value) {
    const hasBasement = basementInfo(spec.shell).present;
    if (value === 'basement') {
      if (!hasBasement) updateShell('basementHeightFt', 8);
      return;
    }
    const operations = [{ type: 'set_utility', field: 'foundationType', value }];
    if (hasBasement) operations.unshift({ type: 'set_shell', field: 'basementHeightFt', value: '0' });
    void applyBackendOperations({
      operations,
      promptText: `Set foundation to ${value}`,
      logPrefix: 'Foundation',
      chatText: hasBasement ? 'Removed the basement — its rooms came up to the ground floor — and set the new foundation type.' : undefined
    });
  }

  // Per-wall edit: system / height / thickness / finish / omit, per N/S/E/W side.
  function updateWallSide(side, field, rawValue, level = 1) {
    let value = rawValue;
    // Per-side heights go down to a 2' kneewall (greenhouse south face).
    if (field === 'heightFt') value = clamp(Number(rawValue), 2, 40);
    else if (field === 'thicknessFt') value = clamp(Number(rawValue), 0.2, 3.5);
    else if (field === 'sunGlazingTiltDeg') value = clamp(Number(rawValue) || 0, 0, 45);
    else if (field === 'sunGlazing' || field === 'omitted') value = Boolean(rawValue);
    void applyBackendOperations({
      operations: [{ type: 'set_wall_side', wall: side, field, value, ...(level > 1 ? { level } : {}) }],
      promptText: `Set ${level > 1 ? 'upper ' : ''}${side} wall ${field}`,
      logPrefix: 'Wall edit',
      nextSelectedId: level > 1 ? `wall-${side}-u` : `wall-${side}`
    });
  }

  // "Assembly (all sides)" on the Walls page. This MUST be a single dispatch —
  // four separate updateWallSide calls each apply to the same stale spec, so
  // only the last (west) would survive (the "goes to West no matter what" bug).
  // One plan with four ops applies them in sequence on the backend.
  function setAllWallsAssembly(value, level = 1) {
    void applyBackendOperations({
      operations: WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'assembly', value, ...(level > 1 ? { level } : {}) })),
      promptText: `Set all ${level > 1 ? 'upper-storey ' : ''}walls to ${WALL_ASSEMBLIES[value]?.label || value}`,
      logPrefix: 'Wall edit'
    });
  }

  function setAllWallsCladding(value) {
    void applyBackendOperations({
      operations: WALL_SIDES.map((side) => ({ type: 'set_wall_side', wall: side, field: 'cladding', value })),
      promptText: `Clad all walls in ${CLADDING_TYPES[value]?.label || value}`,
      logPrefix: 'Wall edit'
    });
  }

  function updateSite(field, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_site', field, value: String(value) }],
      promptText: `Set site ${field}`,
      logPrefix: 'Site'
    });
  }

  function applyZip(zip) {
    const cleaned = String(zip || '').replace(/\D/g, '').slice(0, 5);
    const info = zipRegionInfo(cleaned);
    const operations = [{ type: 'set_site', field: 'zip', value: cleaned }];
    if (info) {
      operations.push({ type: 'set_site', field: 'latitudeDeg', value: String(info.lat) });
      operations.push({ type: 'set_site', field: 'rainInYr', value: String(info.rain) });
    }
    void applyBackendOperations({
      operations,
      promptText: `Set site ZIP ${cleaned}`,
      logPrefix: 'Site',
      chatText: info ? `ZIP ${cleaned} looks like ${info.name} — about ${info.lat.toFixed(1)}°N and ${info.rain}" of rain a year. Fine-tune below if you know better.` : undefined
    });
  }

  function updateUtility(field, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_utility', field, value: String(value) }],
      promptText: `Set ${field} to ${value}`,
      logPrefix: 'Systems'
    });
  }

  function updateFrame(value, level) {
    void applyBackendOperations({
      operations: [{ type: 'set_frame', value, ...(level ? { level } : {}) }],
      promptText: `Set ${level > 1 ? `storey ${level} ` : ''}frame to ${FRAME_TYPES[value]?.label || value}`,
      logPrefix: 'Frame'
    });
  }

  function updateFlooring(value) {
    void applyBackendOperations({
      operations: [{ type: 'set_flooring', value }],
      promptText: `Set flooring to ${FLOORING_TYPES[value]?.label || value}`,
      logPrefix: 'Flooring'
    });
  }

  function updateSubfloor(value) {
    void applyBackendOperations({
      operations: [{ type: 'set_flooring', field: 'subfloor', value }],
      promptText: `Set subfloor to ${SUBFLOOR_TYPES[value]?.label || value}`,
      logPrefix: 'Flooring'
    });
  }

  function updateReclaimed(system, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_reclaimed', system, value: Boolean(value) }],
      promptText: `Mark ${system} as ${value ? 'reclaimed' : 'new'}`,
      logPrefix: 'Reclaimed'
    });
  }

  async function runGeoSearch() {
    const query = geoQuery.trim();
    if (!query) return;
    setGeoResults([]);
    // 5-digit ZIP: apply the offline regional estimate right away, then still
    // try the online geocoder for an exact match.
    if (/^\d{5}$/.test(query)) applyZip(query);
    setGeoStatus('Searching…');
    try {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!data.results?.length) {
        setGeoStatus(/^\d{5}$/.test(query)
          ? 'Regional estimate set from the ZIP. For an exact spot, search the town name.'
          : `No places found for "${query}" — try the nearest town, or set latitude and rain by hand below.`);
        return;
      }
      setGeoResults(data.results);
      setGeoStatus('Pick your place:');
    } catch {
      setGeoStatus('Place search needs internet. Use a 5-digit ZIP for an offline estimate, or set latitude and rain by hand below.');
    }
  }

  async function pickGeoResult(result) {
    setGeoResults([]);
    setGeoStatus(`Looking up rainfall for ${result.name}…`);
    let rain = null;
    try {
      const response = await fetch(`/api/geo/rain?lat=${result.latitude}&lon=${result.longitude}`);
      if (response.ok) rain = (await response.json()).rainInYr;
    } catch { /* rainfall is optional — latitude still applies */ }
    const place = `${result.name}${result.admin1 ? ', ' + result.admin1 : ''}${result.country && result.country !== 'United States' ? ', ' + result.country : ''}`;
    const operations = [
      { type: 'set_site', field: 'placeName', value: place },
      { type: 'set_site', field: 'latitudeDeg', value: String(Math.round(Math.abs(result.latitude) * 10) / 10) },
      ...(rain !== null ? [{ type: 'set_site', field: 'rainInYr', value: String(rain) }] : [])
    ];
    await applyBackendOperations({
      operations,
      promptText: `Set location to ${place}`,
      logPrefix: 'Site',
      chatText: `Site set to ${place} — ${Math.round(Math.abs(result.latitude) * 10) / 10}° latitude${rain !== null ? `, about ${rain}" of rain last year (real weather-station data)` : ' (rainfall lookup failed — set it by hand on the Site page)'}. Sun angles, solar sizing, and catchment all follow.`
    });
    setGeoStatus('');
    setGeoQuery('');
  }

  function updateOverhang(side, value) {
    void applyBackendOperations({
      operations: [{ type: 'set_overhang', wall: side, value: String(clamp(Number(value) || 0, 0, 12)) }],
      promptText: `Set ${side} overhang`,
      logPrefix: 'Roof'
    });
  }

  function removeOpening(index) {
    const opening = spec.openings?.[index];
    if (!opening) return;
    void applyBackendOperations({
      operations: [{ type: 'remove_object', targetId: `opening-${index}`, name: opening.label }],
      promptText: `Remove ${opening.label}`,
      logPrefix: 'Windows'
    });
  }

  function addOpeningOnWall(wall, type) {
    const profile = OPENING_TYPES[type] || OPENING_TYPES.window;
    const widthFt = profile.defaultW;
    const maxAlong = wall === 'north' || wall === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
    const existing = spec.openings.filter((opening) => opening.wall === wall).length;
    const along = clamp(4 + existing * 6, 0, Math.max(0, maxAlong - widthFt));
    void applyBackendOperations({
      operations: [{ type: 'add_opening', wall, openingType: type, widthFt, positionFt: along, name: `${titleCase(wall)} ${profile.label} ${existing + 1}` }],
      promptText: `Add ${profile.label} to ${wall} wall`,
      logPrefix: 'Windows'
    });
  }

  function toggleOutdoorItem(item) {
    if (outdoorItemPresent(spec, item)) {
      const element = (spec.elements || []).find((el) => el.name === item.name);
      if (!element) return;
      void applyBackendOperations({
        operations: [{ type: 'remove_object', targetId: element.id, name: element.name }],
        promptText: `Remove ${item.name}`,
        logPrefix: 'Outdoors'
      });
    } else {
      const placed = (spec.elements || []).length;
      void applyBackendOperations({
        operations: [{ type: 'add_element', name: item.name, category: item.category, x: spec.shell.widthFt + 6 + (placed % 3) * 14, y: 2 + Math.floor(placed / 3) * 14, z: 0, w: item.w, d: item.d, h: item.h, reason: item.note }],
        promptText: `Add ${item.name}`,
        logPrefix: 'Outdoors'
      });
    }
  }

  function updateProjectName(value) {
    setSpec((current) => {
      const next = structuredClone(current);
      next.projectName = value || 'Untitled Natural Building Study';
      return next;
    });
  }

  // The rename box edits a LOCAL draft and commits on blur/Enter. Writing
  // spec.projectName per keystroke autosaved a revision snapshot per letter,
  // littering the designs list with "Tom's Hous"-style stubs.
  const [nameDraft, setNameDraft] = useState(null);
  function commitProjectName() {
    if (nameDraft === null) return;
    const value = nameDraft.trim();
    setNameDraft(null);
    if (!value || value === spec.projectName) return;
    updateProjectName(value);
  }

  // Selecting an object anywhere — the model, a plan, or a system-page summary
  // row — routes it to the ONE editor: the Inspector below the model. This is
  // what makes "click a thing, edit it in a single place" hold across the app.
  function selectObject(id) {
    setSelectedRoom(id);
    setInspectorView('inspect');
    // The editor lives in the Systems column — make sure it's visible when
    // something is picked from the model, the plan, or the selector chip.
    setConsoleView('systems');
    setSelMenuOpen(false);
  }

  function updateSelectedRoom(field, value) {
    const numericFields = ['x', 'y', 'w', 'd', 'h'];
    if (selectedRoom === 'outdoor-grid') return;
    if (selectedRoom === 'site-pad') {
      const currentPad = sitePadRect(spec);
      const updatedPad = { ...currentPad };
      if (field === 'x') updatedPad.x = Number(value);
      if (field === 'y') updatedPad.y = Number(value);
      if (field === 'w') updatedPad.w = Math.max(4, Number(value));
      if (field === 'd') updatedPad.d = Math.max(4, Number(value));
      void applyBackendOperations({
        operations: [{ type: 'set_shell', field: 'sitePad', value: JSON.stringify(updatedPad) }],
        promptText: 'Update site pad',
        logPrefix: 'Pad edit',
        nextSelectedId: 'site-pad'
      });
      return;
    }
    if (selectedRoom === 'roof-main') {
      const operations = [];
      if (field === 'h') operations.push({ type: 'set_shell', field: 'wallHeightFt', value: String(clamp(Number(value), 7, 40)) });
      if (field === 'type') operations.push({ type: 'set_shell', field: 'roofType', value });
      if (operations.length) void applyBackendOperations({ operations, promptText: 'Update roof', logPrefix: 'Roof edit', nextSelectedId: 'roof-main' });
      return;
    }
    if (selectedRoom === 'frame-main') {
      if (field === 'type') {
        void applyBackendOperations({ operations: [{ type: 'set_frame', value }], promptText: `Set frame to ${FRAME_TYPES[value]?.label || value}`, logPrefix: 'Frame', nextSelectedId: 'frame-main' });
      } else if (field === 'baySpacingFt') {
        void applyBackendOperations({ operations: [{ type: 'set_frame', field: 'baySpacingFt', value: String(clamp(Number(value) || 8, 4, 16)) }], promptText: `Set frame bay spacing to ${value}'`, logPrefix: 'Frame', nextSelectedId: 'frame-main' });
      }
      return;
    }
    if (selectedRoom?.startsWith('opening-')) {
      const openingIndex = Number(selectedRoom.replace('opening-', ''));
      const opening = spec.openings?.[openingIndex];
      if (!opening) return;
      const updated = structuredClone(opening);
      if (field === 'name') updated.label = value;
      if (field === 'w') updated.widthFt = clamp(Number(value), 1, 24);
      if (field === 'x' || field === 'y') {
        const maxAlong = updated.wall === 'north' || updated.wall === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
        const along = clamp(Number(value), 0, Math.max(0, maxAlong - Number(updated.widthFt || 3)));
        if (updated.wall === 'north' || updated.wall === 'south') updated.x = along;
        else updated.y = along;
      }
      if (field === 'type') updated.type = value;
      if (field === 'wall') { updated.wall = value; updated.x = 4; updated.y = 4; }
      const operations = [{ type: 'remove_object', targetId: selectedRoom, name: opening.label }, { type: 'add_opening', wall: updated.wall, openingType: OPENING_TYPES[updated.type] ? updated.type : 'window', widthFt: updated.widthFt, positionFt: updated.wall === 'north' || updated.wall === 'south' ? updated.x : updated.y, name: updated.label }];
      void applyBackendOperations({ operations, promptText: `Update opening ${opening.label}`, logPrefix: 'Opening edit', nextSelectedId: selectedRoom });
      return;
    }
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (wall) {
      const lvl = wall.level || 1;
      if (field === 'h' && lvl === 1) updateWallSide(wall.side, 'heightFt', value);
      else if (field === 'w' && lvl > 1) {
        // An upper wall's length IS its storey extent — resize the plate
        // (N/S walls set its width, E/W its depth). No plate = the storey
        // spans the whole footprint, so length follows the shell dimension.
        const plate = upperPlateRect(spec, lvl);
        const horiz = wall.side === 'north' || wall.side === 'south';
        if (plate) {
          void applyBackendOperations({
            operations: [{ type: 'resize_object', targetId: plate.id, w: horiz ? Math.max(6, Number(value) || plate.w) : plate.w, d: horiz ? plate.d : Math.max(6, Number(value) || plate.d) }],
            promptText: `Resize the ${floorLabel(spec, lvl).toLowerCase()} to ${value}′ ${horiz ? 'wide' : 'deep'}`,
            logPrefix: 'Storey',
            nextSelectedId: selectedRoom
          });
        } else updateShell(horiz ? 'widthFt' : 'depthFt', value);
      }
      else if (field === 'w' && wall.edgeKey) {
        // An edge SEGMENT's length is its own — the jog corners slide along
        // the wall line (the whole side still comes from the shell dims).
        void applyBackendOperations({
          operations: [{ type: 'resize_wall_segment', field: wall.edgeKey, value: String(Math.max(1, Number(value) || 1)) }],
          promptText: `Set ${wall.name.toLowerCase()} to ${value}' long`,
          logPrefix: 'Footprint',
          nextSelectedId: selectedRoom
        });
      }
      else if (field === 'startFt' && wall.edgeKey) {
        void applyBackendOperations({
          operations: [{ type: 'resize_wall_segment', field: wall.edgeKey, positionFt: Math.max(0.5, Number(value) || 0.5) }],
          promptText: `Slide ${wall.name.toLowerCase()} to start at ${value}'`,
          logPrefix: 'Footprint',
          nextSelectedId: selectedRoom
        });
      }
      else if (field === 'w') updateShell(wall.side === 'north' || wall.side === 'south' ? 'widthFt' : 'depthFt', value);
      else if (field === 'thickness') updateWallSide(wall.side, 'thicknessFt', value, lvl);
      else if (field === 'assembly') updateWallSide(wall.side, 'assembly', value, lvl);
      else if (field === 'cladding') updateWallSide(wall.side, 'cladding', value, lvl);
      else if (field === 'sunGlazing') updateWallSide(wall.side, 'sunGlazing', value, lvl);
      else if (field === 'sunGlazingTiltDeg') updateWallSide(wall.side, 'sunGlazingTiltDeg', value, lvl);
      else if (field === 'interiorFinish') updateWallSide(wall.side, 'interiorFinish', value, lvl);
      else if (field === 'exteriorFinish') updateWallSide(wall.side, 'exteriorFinish', value, lvl);
      return;
    }
    const object = spec.rooms.find((item) => item.id === selectedRoom) || (spec.elements || []).find((item) => item.id === selectedRoom);
    if (!object) return;
    const operations = [];
    if (field === 'x' || field === 'y') {
      operations.push({ type: 'move_object', targetId: selectedRoom, name: object.name, x: field === 'x' ? Number(value) : Number(object.x || 0), y: field === 'y' ? Number(value) : Number(object.y || 0) });
    } else if (field === 'level') {
      // Level -1 is the basement; 0 is not a floor (ops treat 0 as unset).
      const rawLevel = Math.round(Number(value) || 1);
      const nextLevel = rawLevel <= BASEMENT_LEVEL && basementInfo(spec.shell).present ? BASEMENT_LEVEL : clamp(Math.max(1, rawLevel), 1, 3);
      operations.push({ type: 'update_object', targetId: selectedRoom, name: object.name, field: 'level', value: String(nextLevel) });
    } else if (field === 'w' || field === 'd' || field === 'h') {
      operations.push({ type: 'resize_object', targetId: selectedRoom, name: object.name, w: field === 'w' ? Number(value) : Number(object.w || 1), d: field === 'd' ? Number(value) : Number(object.d || 1), h: field === 'h' ? Number(value) : Number(object.h || 1.2) });
    } else {
      operations.push({ type: 'update_object', targetId: selectedRoom, name: object.name, field: field === 'name' ? 'name' : field, value: String(value) });
    }
    void applyBackendOperations({ operations, promptText: `Update ${object.name}`, logPrefix: 'Inspector edit', nextSelectedId: selectedRoom });
  }

  function addOpeningToSelectedWall(type = 'window') {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (!wall) return;
    const profile = OPENING_TYPES[type] || OPENING_TYPES.window;
    const widthFt = profile.defaultW || 4;
    const maxAlong = wall.side === 'north' || wall.side === 'south' ? spec.shell.widthFt : spec.shell.depthFt;
    const existingOnWall = spec.openings.filter((opening) => opening.wall === wall.side).length;
    const along = clamp(4 + existingOnWall * 6, 0, Math.max(0, maxAlong - widthFt));
    void applyBackendOperations({
      operations: [{ type: 'add_opening', wall: wall.side, openingType: type, widthFt, positionFt: along, name: `${titleCase(wall.side)} ${profile.label} ${existingOnWall + 1}` }],
      promptText: `Add ${profile.label.toLowerCase()} to ${wall.name}`,
      logPrefix: 'Wall edit'
    });
  }

  function removeSelectedWallSection() {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (!wall) return;
    rememberRevision();
    setSpec((current) => {
      const next = structuredClone(current);
      next.shell.omittedWalls = [...new Set([...(next.shell.omittedWalls || []), wall.side])];
      next.revision += 1;
      return next;
    });
    setSelectedRoom(spec.rooms[0]?.id || '');
    setLastModelChange(`Removed ${wall.name} from shell model.`);
    setRevisionLog((items) => [`Wall edit: Removed ${wall.name} from shell model.`, ...items]);
  }

  function beginPlanMove() {
    if (planDragRevisionRef.current) return;
    rememberRevision();
    planDragRevisionRef.current = true;
  }

  function moveObjectPosition(objectId, x, y, finalize = false, label = 'Moved object on plan board.') {
    setSpec((current) => {
      const next = structuredClone(current);
      const object = next.rooms.find((item) => item.id === objectId) || (next.elements || []).find((item) => item.id === objectId);
      if (!object) return current;
      const position = clampObjectPosition(next, object, x, y);
      object.x = position.x;
      object.y = position.y;
      normalizeRooms(next);
      return next;
    });
    setSelectedRoom(objectId);
    if (finalize) {
      planDragRevisionRef.current = false;
      void applyBackendOperations({
        operations: [{ type: 'move_object', targetId: objectId, x, y }],
        promptText: label,
        logPrefix: 'Plan move',
        nextSelectedId: objectId,
        persist: true
      });
    }
  }

  function finishPlanMove(objectId, x, y) {
    // 3D drags route here for EVERYTHING grabbable: openings carry their new
    // position along the wall in x; walls carry their outward offset in x.
    if (objectId.startsWith('opening-')) {
      planMoveOpening(Number(objectId.replace('opening-', '')), x);
      return;
    }
    if (objectId.startsWith('wall-')) {
      const wall = wallSections.find((item) => item.id === objectId);
      const offset = clamp(Number(x) || 0, -48, 48);
      if (!wall || !offset) return;
      void applyBackendOperations({
        operations: [wall.edgeKey
          ? { type: 'move_wall_edge', field: wall.edgeKey, value: String(offset) }
          : { type: 'move_wall_edge', wall: wall.side, value: String(offset) }],
        promptText: `Move ${wall.name.toLowerCase()} ${offset > 0 ? 'out' : 'in'} ${Math.abs(offset)}′`,
        logPrefix: 'Footprint',
        nextSelectedId: objectId
      });
      return;
    }
    const object = spec.rooms.find((item) => item.id === objectId) || (spec.elements || []).find((item) => item.id === objectId);
    if (!object) return;
    const finalX = Number.isFinite(x) ? x : object.x;
    const finalY = Number.isFinite(y) ? y : object.y;
    moveObjectPosition(objectId, finalX, finalY, true, `Moved ${object.name} to X ${finalX}', Y ${finalY}'.`);
  }

  function resizeObjectFootprint(objectId, w, d, finalize = false, label = 'Resized object on plan board.') {
    setSpec((current) => {
      const next = structuredClone(current);
      const object = next.rooms.find((item) => item.id === objectId) || (next.elements || []).find((item) => item.id === objectId);
      if (!object) return current;
      object.w = w;
      object.d = d;
      normalizeRooms(next);
      return next;
    });
    setSelectedRoom(objectId);
    if (finalize) {
      planDragRevisionRef.current = false;
      void applyBackendOperations({
        operations: [{ type: 'resize_object', targetId: objectId, w, d }],
        promptText: label,
        logPrefix: 'Plan resize',
        nextSelectedId: objectId,
        persist: true
      });
    }
  }

  function finishPlanResize(objectId, w, d, x, y) {
    if (objectId === 'site-pad') {
      const currentPad = sitePadRect(spec);
      const finalW = Math.max(4, Number.isFinite(w) ? w : currentPad.w);
      const finalD = Math.max(4, Number.isFinite(d) ? d : currentPad.d);
      const finalX = Number.isFinite(x) ? x : currentPad.x;
      const finalY = Number.isFinite(y) ? y : currentPad.y;
      setSelectedRoom('site-pad');
      planDragRevisionRef.current = false;
      void applyBackendOperations({
        operations: [{ type: 'set_shell', field: 'sitePad', value: JSON.stringify({ x: finalX, y: finalY, w: finalW, d: finalD, h: currentPad.h }) }],
        promptText: `Resize site pad to ${Math.round(finalW * 10) / 10}' x ${Math.round(finalD * 10) / 10}'`,
        logPrefix: 'Pad resize',
        nextSelectedId: 'site-pad'
      });
      return;
    }
    const object = spec.rooms.find((item) => item.id === objectId) || (spec.elements || []).find((item) => item.id === objectId);
    if (!object) return;
    const finalW = Number.isFinite(w) ? w : object.w;
    const finalD = Number.isFinite(d) ? d : object.d;
    const finalX = Number.isFinite(x) ? x : object.x;
    const finalY = Number.isFinite(y) ? y : object.y;
    setSpec((current) => {
      const next = structuredClone(current);
      const target = next.rooms.find((item) => item.id === objectId) || (next.elements || []).find((item) => item.id === objectId);
      if (!target) return current;
      target.w = finalW;
      target.d = finalD;
      const position = clampObjectPosition(next, target, finalX, finalY);
      target.x = position.x;
      target.y = position.y;
      normalizeRooms(next);
      return next;
    });
    setSelectedRoom(objectId);
    planDragRevisionRef.current = false;
    void applyBackendOperations({
      operations: [{ type: 'resize_object', targetId: objectId, w: finalW, d: finalD }, { type: 'move_object', targetId: objectId, x: finalX, y: finalY }],
      promptText: `Resized ${object.name} to ${finalW}' x ${finalD}'.`,
      logPrefix: 'Model resize',
      nextSelectedId: objectId
    });
  }

  function quickMoveSelected(target) {
    if (!selected) return;
    rememberRevision();
    const location = targetLocationForPhrase(spec, selected, target);
    moveObjectPosition(selected.id, location.x, location.y, true, `Moved ${selected.name} to ${target}.`);
  }

  function nudgeSelected(dx, dy) {
    if (!selected) return;
    rememberRevision();
    const position = clampObjectPosition(spec, selected, selected.x + dx, selected.y + dy);
    const x = position.x;
    const y = position.y;
    moveObjectPosition(selected.id, x, y, true, `Nudged ${selected.name} to X ${x}', Y ${y}'.`);
  }

  function pasteClipboardObject() {
    if (!clipboardObject || selectedIsWall || selectedIsSpecial) return;
    const baseName = clipboardObject.name || 'Copied BIM Object';
    const isElementCopy = (spec.elements || []).some((element) => element.id === clipboardObject.id);
    const position = clampObjectPosition(spec, clipboardObject, Number(clipboardObject.x || 0) + 3, Number(clipboardObject.y || 0) + 3);
    const operation = isElementCopy
      ? { type: 'add_element', name: `${baseName} Copy`, category: clipboardObject.category || clipboardObject.type || 'custom', x: position.x, y: position.y, z: Number(clipboardObject.z || 0), w: Number(clipboardObject.w || 10), d: Number(clipboardObject.d || 10), h: Number(clipboardObject.h || 1.2), level: Number(clipboardObject.level || 1) }
      : { type: 'add_room', name: `${baseName} Copy`, category: clipboardObject.type || 'living', x: position.x, y: position.y, z: Number(clipboardObject.z || 0), w: Number(clipboardObject.w || 10), d: Number(clipboardObject.d || 10), h: Number(clipboardObject.h || 0.2), level: Number(clipboardObject.level || 1) };
    void applyBackendOperations({ operations: [operation], promptText: `Paste ${baseName}`, logPrefix: 'Clipboard paste' });
  }

  function addRoom() {
    void addRoomPreset({ name: 'Room', type: 'living', w: 12, d: 12 });
  }

  // Add a room, then re-pack the whole floor plan so nothing overlaps and the
  // house grows to fit — the GUI path that makes building a first floor work.
  // Drop a room into the first free gap without disturbing the rooms already
  // placed (a manual layout survives an add). Only 'auto-arrange' re-packs.
  // Place an interior fixture (heater, tank, stairs…) as an element in a free
  // spot inside the house — then it's draggable in 2D and shows in 3D.
  function placeFixture(fixture) {
    const taken = new Set((spec.elements || []).map((e) => e.name));
    let name = fixture.name;
    let n = 2;
    while (taken.has(name)) { name = `${fixture.name} ${n}`; n += 1; }
    // Fixtures land on the floor you're LOOKING AT — placing a tub while on
    // the 2nd-floor plan puts it upstairs, colliding only with what's up there.
    const lvl = activeFloor === BASEMENT_LEVEL ? BASEMENT_LEVEL : Math.max(1, activeFloor);
    const { baseWallFt } = storeyInfo(spec.shell);
    const basementDrop = basementInfo(spec.shell).heightFt;
    const existing = (spec.rooms || []).concat((spec.elements || []).filter((e) => e.category !== 'floor'))
      .filter((o) => Number(o.level || 1) === lvl)
      .map((o) => ({ x: Number(o.x), y: Number(o.y), w: Number(o.w), d: Number(o.d) }));
    const spot = findFreeSpot(Number(spec.shell.widthFt), Number(spec.shell.depthFt), existing, fixture.w, fixture.d)
      || { x: 2, y: 2 };
    const where = lvl > 1 ? ` on the ${floorLabel(spec, lvl).toLowerCase()}` : '';
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: fixture.category, x: spot.x, y: spot.y, z: lvl === BASEMENT_LEVEL ? -basementDrop + 0.05 : lvl > 1 ? (lvl - 1) * baseWallFt + 0.45 : 0, w: fixture.w, d: fixture.d, h: fixture.h, level: lvl, reason: 'Interior fixture placed from the plan.' }],
      promptText: `Place ${name}${where}`,
      logPrefix: 'Fixture'
    });
  }

  // One click drops partition walls on every shared room edge on the floor
  // you're looking at — a single batched dispatch, skipping covered lines.
  function drawPartitions() {
    const lvl = activeFloor === BASEMENT_LEVEL ? BASEMENT_LEVEL : Math.max(1, activeFloor);
    const ops = derivePartitionOps(spec, lvl);
    if (!ops.length) {
      setChatMessages((current) => [...current, { role: 'studio', speaker: 'Studio', text: 'No new interior walls to draw — every shared room edge on this floor already has a partition (or no rooms touch). Drag rooms edge-to-edge first, or add one wall by hand: “add a wall between the kitchen and the living room.”' }]);
      return;
    }
    void applyBackendOperations({
      operations: ops,
      promptText: `Draw ${ops.length} interior wall${ops.length === 1 ? '' : 's'}`,
      logPrefix: 'Partitions',
      chatText: `Drew ${ops.length} interior wall${ops.length === 1 ? '' : 's'} on shared room edges, each with a 3′ doorway. Tap one to set its construction or move its door; delete any you don't want.`
    });
  }

  // Drop an outbuilding on the site (beside the house) — a real sized element
  // you can resize/move in the plan or model and give its own construction.
  function placeOutbuilding(preset) {
    const taken = new Set((spec.elements || []).map((element) => element.name));
    let name = preset.name;
    let n = 2;
    while (taken.has(name)) { name = `${preset.name} ${n}`; n += 1; }
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: 'outbuilding', x: Number(spec.shell.widthFt) + 6, y: 3, z: 0, w: preset.w, d: preset.d, h: preset.h, construction: preset.construction, reason: 'Outbuilding placed from the Site page.' }],
      promptText: `Add ${name}`,
      logPrefix: 'Outbuilding',
      chatText: `Added a ${preset.name.toLowerCase()} on the site — drag it where you want it, and set its size and construction in the Inspector.`
    });
  }

  // Drop a foundation run near the middle of the plan — the user drags and
  // stretches it under the wall it carries (greenhouse divider, mass heater).
  function placeFoundationRun(preset) {
    const taken = new Set((spec.elements || []).map((e) => e.name));
    let name = preset.name;
    let n = 2;
    while (taken.has(name)) { name = `${preset.name} ${n}`; n += 1; }
    const x = Math.max(1, Number(spec.shell.widthFt) / 2 - preset.w / 2);
    const y = Math.max(1, Number(spec.shell.depthFt) / 2 - preset.d / 2);
    void applyBackendOperations({
      operations: [{ type: 'add_element', name, category: 'foundation', construction: preset.construction, x, y, w: preset.w, d: preset.d, h: preset.h, reason: 'Foundation run under a specific wall line.' }],
      promptText: `Add ${FOUNDATION_RUN_TYPES[preset.construction].label.toLowerCase()}`,
      logPrefix: 'Foundation',
      chatText: `Dropped a ${FOUNDATION_RUN_TYPES[preset.construction].label.toLowerCase()} mid-plan — drag it under the wall it carries in the Plan view and stretch it to length. It prices by the foot on the Foundation page and in Costs.`
    });
  }

  // Every preset click is acknowledged instantly (queued chip) and applied in
  // click order, one at a time. Each add PLANS against and APPLIES onto the
  // spec the previous add returned — the old racing version planned four adds
  // against the same stale spec, so rapid clicks arrived late, out of order,
  // or (when two picked the same free spot) not at all.
  function addRoomPreset(preset) {
    roomQueueRef.current.queue.push(preset);
    setPendingRoomAdds((names) => [...names, preset.name]);
    void processRoomQueue();
  }

  async function processRoomQueue() {
    const q = roomQueueRef.current;
    if (q.running) return;
    q.running = true;
    // The first add starts from the freshest committed spec this closure saw;
    // every later one chains from the report the backend just returned.
    let base = null;
    try {
      while (q.queue.length) {
        const preset = q.queue.shift();
        const source = base || spec;
        const plan = planNewRoomPlacements(source, [preset], activeFloor);
        const where = activeFloor > 1 ? ` on the ${floorLabel(source, activeFloor).toLowerCase()}` : '';
        const report = await applyBackendOperations({
          operations: plan.ops,
          promptText: `Add ${plan.names[0]}${where}`,
          logPrefix: 'Add room',
          baseSpec: base,
          chatText: plan.grew ? `Added the ${plan.names[0]}${where} and grew the house to ${plan.newW}′ × ${plan.newD}′ to fit it — your other rooms stayed put.` : undefined
        });
        if (report) {
          base = report.spec;
          // Reconcile by name: if the room the click asked for isn't in the
          // returned model, say so — never let a click vanish silently.
          if (!report.spec.rooms.some((room) => room.name === plan.names[0])) {
            setChatMessages((items) => [...items, { role: 'studio', speaker: 'Studio', text: `The ${preset.name} didn't make it into the plan — try once more, or add it by chat ("add a ${preset.name.toLowerCase()}").` }]);
          }
        }
        setPendingRoomAdds((names) => {
          const idx = names.indexOf(preset.name);
          return idx === -1 ? names : [...names.slice(0, idx), ...names.slice(idx + 1)];
        });
      }
    } finally {
      q.running = false;
    }
  }

  // One-click fixes for council flags. Each maps a flagged issue to the SAME
  // safe op path a manual control uses — the non-destructive room placement and
  // the standard backend dispatch — so a fix never clobbers a layout or vanishes
  // silently. Only issues with a clean single-intent remedy carry a fixId; the
  // judgment calls (cost over ceiling, undersized water source) stay prose-only.
  function fixIssue(issue) {
    const preset = (name) => ROOM_PRESETS.find((item) => item.name === name);
    switch (issue.fixId) {
      case 'enclose-rooms': {
        // Grow the shell to take in every indoor ground room left outside the
        // walls; rooms on the negative side slide in first. ONE dispatch.
        const strays = spec.rooms.filter((room) => Number(room.level || 1) === 1 && !OUTDOOR_SPACE_TYPES.has(room.type)
          && (room.x < -0.5 || room.y < -0.5 || room.x + room.w > spec.shell.widthFt + 0.5 || room.y + room.d > spec.shell.depthFt + 0.5));
        if (!strays.length) return;
        const moveOps = strays.filter((room) => room.x < 0 || room.y < 0)
          .map((room) => ({ type: 'move_object', targetId: room.id, name: room.name, x: Math.max(0.5, room.x), y: Math.max(0.5, room.y) }));
        const needW = Math.ceil(Math.max(Number(spec.shell.widthFt), ...strays.map((room) => Math.max(0.5, room.x) + room.w + 1)));
        const needD = Math.ceil(Math.max(Number(spec.shell.depthFt), ...strays.map((room) => Math.max(0.5, room.y) + room.d + 1)));
        return void applyBackendOperations({
          operations: [
            ...moveOps,
            { type: 'set_shell', field: 'widthFt', value: String(clamp(needW, 18, 120)) },
            { type: 'set_shell', field: 'depthFt', value: String(clamp(needD, 18, 120)) }
          ],
          promptText: 'Enclose the outside rooms',
          logPrefix: 'Fix',
          chatText: `Grew the walls to ${clamp(needW, 18, 120)} × ${clamp(needD, 18, 120)} ft so every ground room is inside. The upper storey still covers only its Storey extent — resize or drag that on the 2nd-floor Plan tab, and the roof steps down over the single-storey part.`
        });
      }
      case 'give-shed-fall': {
        const hi = Math.max(7, Number(spec.shell.southWallHeightFt || spec.shell.wallHeightFt || 10));
        return void applyBackendOperations({
          operations: [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: hi, northWallHeightFt: Math.max(2, hi - 2) }],
          promptText: 'Give the shed roof its fall',
          logPrefix: 'Fix',
          chatText: `Gave the shed a 2′ fall to the north (south eave ${hi}′, north ${Math.max(2, hi - 2)}′) — the solar-classic slope. Adjust direction and fall on the Roof page.`
        });
      }
      case 'add-wet-core':
        return void addRoomPreset(preset('Bathroom'));
      case 'add-mudroom':
        return void addRoomPreset(preset('Mudroom'));
      case 'add-south-entry':
        return void applyBackendOperations({ operations: [{ type: 'add_opening', wall: 'south', openingType: 'door', widthFt: 3 }], promptText: 'Add a south entry door', logPrefix: 'Fix', chatText: 'Added a south-facing door so the main entry has a clear solar-side approach — position it on the Windows page.' });
      case 'add-south-glass':
        return void applyBackendOperations({ operations: [{ type: 'add_opening', wall: 'south', openingType: 'window', widthFt: 5 }], promptText: 'Add south glazing', logPrefix: 'Fix', chatText: 'Added a south window for winter solar gain — tune the size and summer shading on the Windows page.' });
      case 'add-stair':
        return void placeFixture({ name: 'Stairs', category: 'structure', w: 3.5, d: 10, h: 8 });
      case 'raise-stemwall':
        return void applyBackendOperations({ operations: [{ type: 'set_utility', field: 'stemwallHeightFt', value: 1.5 }], promptText: 'Raise the stem wall', logPrefix: 'Fix', chatText: 'Raised the stem wall to 18″ so the bale base clears splash and grade.' });
      case 'add-stemwall':
        return void applyBackendOperations({ operations: [{ type: 'set_utility', field: 'foundationType', value: 'stemwall' }, { type: 'set_utility', field: 'stemwallHeightFt', value: 1.5 }], promptText: 'Add a stem wall under the bale walls', logPrefix: 'Fix', chatText: 'Switched the foundation to a stem wall, 18″ above grade — the bales now ride clear of splash and rising damp. The Detail view shows the new joint.' });
      case 'well-septic':
        return void applyBackendOperations({ operations: [{ type: 'set_utility', field: 'wellSepticFt', value: 100 }], promptText: 'Separate well and septic', logPrefix: 'Fix', chatText: 'Set the well-to-septic separation to 100 ft. Confirm the exact figure with your local health department.' });
      case 'deepen-overhang':
        return void applyBackendOperations({ operations: [{ type: 'set_overhang', wall: 'all', value: 2 }], promptText: 'Deepen the roof overhangs', logPrefix: 'Fix', chatText: 'Set every roof overhang to 2 ft so the plastered walls shed rain.' });
      case 'reduce-south-overhang':
        return void applyBackendOperations({ operations: [{ type: 'set_overhang', wall: 'south', value: 2.5 }], promptText: 'Trim the south overhang', logPrefix: 'Fix', chatText: 'Trimmed the south overhang to 2.5 ft so winter sun reaches the solar glass.' });
      case 'thicken-bale-wall': {
        if (!issue.side) return;
        const target = issue.fixThicknessFt || 1.5;
        return void applyBackendOperations({ operations: [{ type: 'set_wall_side', wall: issue.side, field: 'thicknessFt', value: target }], promptText: `Thicken the ${issue.side} wall`, logPrefix: 'Fix', chatText: `Thickened the ${issue.side} bale wall to ${Math.round(target * 12)}″ to bring it within the 12:1 slenderness limit.` });
      }
      case 'set-stick-frame':
        return void applyBackendOperations({ operations: [{ type: 'set_frame', value: 'stick' }], promptText: 'Add a light stick frame', logPrefix: 'Fix', chatText: 'Added a light stick frame to carry the framed wall. Adjust it on the Frame page.' });
      default:
        return;
    }
  }

  // Instant local path for simple "add a bedroom" chat lines — one call, rooms
  // slotted into free space, no re-pack of what's already there, no planner.
  async function applyLocalRoomAdds(parsed, submittedPrompt) {
    setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submittedPrompt }]);
    const plan = planNewRoomPlacements(spec, parsed, activeFloor);
    const added = plan.names.join(', ');
    await applyBackendOperations({
      operations: plan.ops,
      promptText: parsed.length === 1 ? `Add ${plan.names[0]}` : `Add ${parsed.length} rooms`,
      logPrefix: 'Add rooms',
      chatText: plan.grew
        ? `Added ${added} into free space and grew the house to ${plan.newW}′ × ${plan.newD}′ to fit — existing rooms didn't move. (Instant — no planner needed.)`
        : `Added ${added} into the open floor space, no overlaps, nothing else moved. (Instant — no planner needed.)`
    });
  }

  // 2D plan editor commit handlers.
  function planMoveObject(id, x, y) {
    const object = spec.rooms.find((r) => r.id === id) || (spec.elements || []).find((e) => e.id === id);
    if (!object) return;
    void applyBackendOperations({
      operations: [{ type: 'move_object', targetId: id, name: object.name, x, y }],
      promptText: `Move ${object.name}`,
      logPrefix: 'Plan edit',
      nextSelectedId: id
    });
  }

  function planResizeObject(id, x, y, w, d) {
    const object = spec.rooms.find((r) => r.id === id) || (spec.elements || []).find((e) => e.id === id);
    if (!object) return;
    void applyBackendOperations({
      operations: [
        { type: 'resize_object', targetId: id, name: object.name, w, d, h: Number(object.h) || 0.22 },
        { type: 'move_object', targetId: id, name: object.name, x, y }
      ],
      promptText: `Resize ${object.name}`,
      logPrefix: 'Plan edit',
      nextSelectedId: id
    });
  }

  // Slide an opening along its wall from the Plan view — one dispatch.
  function planMoveOpening(index, along) {
    const opening = spec.openings?.[index];
    if (!opening || opening.wall === 'roof') return;
    const field = opening.wall === 'north' || opening.wall === 'south' ? 'x' : 'y';
    void applyBackendOperations({
      operations: [{ type: 'update_object', targetId: `opening-${index}`, name: opening.label || '', field, value: along }],
      promptText: `Move ${opening.label || 'opening'} to ${along}′`,
      logPrefix: 'Plan edit',
      nextSelectedId: `opening-${index}`
    });
  }

  // Move one wall edge of the footprint (Plan drag or inspector) — the
  // "move a wall" primitive. One dispatch; the backend keeps rooms/openings
  // anchored and re-derives the bounding box.
  function planMoveEdge(edgeIndex, offsetFt) {
    const edge = footprintEdges(spec)[edgeIndex];
    void applyBackendOperations({
      operations: [{ type: 'move_wall_edge', field: `e${edgeIndex}`, value: String(offsetFt) }],
      promptText: `Move ${edge ? `${edge.facing} wall` : 'wall'} ${offsetFt > 0 ? 'out' : 'in'} ${Math.abs(offsetFt)}′`,
      logPrefix: 'Footprint'
    });
  }

  // Move the selected wall (inspector "Move in/out"): edge segments move by
  // edge index, plain cardinal walls by facing. One dispatch either way.
  function moveSelectedWall(offsetFt) {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    const amount = clamp(Number(offsetFt) || 0, -48, 48);
    if (!wall || !amount) return;
    void applyBackendOperations({
      operations: [wall.edgeKey
        ? { type: 'move_wall_edge', field: wall.edgeKey, value: String(amount) }
        : { type: 'move_wall_edge', wall: wall.side, value: String(amount) }],
      promptText: `Move ${wall.name.toLowerCase()} ${amount > 0 ? 'out' : 'in'} ${Math.abs(amount)}′`,
      logPrefix: 'Footprint',
      chatText: `Moved ${wall.name} ${amount > 0 ? 'outward' : 'inward'} ${Math.abs(amount)} ft. The rooms and openings stayed put; the outline re-anchored around them.`
    });
  }

  // Split the selected wall into three segments so its middle can be moved —
  // the first step of an L-shape or notch. Selection follows the middle piece.
  function splitSelectedWall() {
    const wall = wallSections.find((item) => item.id === selectedRoom);
    if (!wall) return;
    const edgeRef = wall.edgeKey || null;
    const operations = [{
      type: 'split_wall_edge',
      ...(edgeRef ? { field: edgeRef } : { wall: wall.side })
    }];
    const edges = footprintEdges(spec);
    const idx = edgeRef ? Number(edgeRef.slice(1)) : (edges.find((e) => e.facing === wall.side)?.index ?? 0);
    void applyBackendOperations({
      operations,
      promptText: `Split the ${wall.name.toLowerCase()}`,
      logPrefix: 'Footprint',
      nextSelectedId: `wall-e${idx + 1}`,
      chatText: `Split ${wall.name} into three segments. Drag the middle one in the Plan view (or use Move in/out here) to shape an L or a notch.`
    });
  }

  // Resize the whole footprint by dragging its corner in the Foundation plan —
  // one dispatch for both dimensions so they don't race on a stale spec.
  function resizeShellPlan(w, d) {
    void applyBackendOperations({
      operations: [
        { type: 'set_shell', field: 'widthFt', value: String(clamp(Number(w), 12, 96)) },
        { type: 'set_shell', field: 'depthFt', value: String(clamp(Number(d), 12, 80)) }
      ],
      promptText: 'Resize footprint',
      logPrefix: 'Plan edit'
    });
  }

  function addStorey() {
    const next = Math.min(3, floorCount(spec) + 1);
    // Adds the storey AND its extent plate — the plate defines how much of the
    // footprint the storey covers. Full footprint by default; drag/resize it in
    // the Plan (on that floor) to put the storey over only one side. No stair is
    // auto-dropped (a stair depends on the layout — add it when things settle).
    const hasStair = (spec.rooms || []).concat(spec.elements || []).some((o) => /stair|ladder/i.test(o.name || ''));
    const { baseWallFt } = storeyInfo(spec.shell);
    const operations = [{ type: 'set_shell', field: 'storeys', value: String(next) }];
    if (!upperPlateRect(spec, next)) {
      operations.push({
        type: 'add_element',
        name: `Storey ${next} extent`,
        category: 'floor',
        x: 0, y: 0, z: baseWallFt * (next - 1),
        w: Number(spec.shell.widthFt), d: Number(spec.shell.depthFt), h: 0.4,
        level: next,
        reason: 'How much of the footprint this storey covers — resize it in the Plan.'
      });
    }
    void applyBackendOperations({
      operations,
      promptText: `Add a storey (now ${next})`,
      logPrefix: 'Storeys',
      chatText: `Added storey ${next} over the whole footprint — switch to its floor in the Plan and resize its extent plate to put it over only part of the building.${hasStair ? '' : ' Add a stair once the layout settles.'}`
    });
    setActiveFloor(next);
  }

  function removeStorey() {
    const current = floorCount(spec);
    if (current <= 1) return;
    const next = current - 1;
    const operations = [{ type: 'set_shell', field: 'storeys', value: String(next) }];
    // The removed level's extent plates go; rooms up there come down to ground
    // rather than vanishing — removing a storey must never delete living space.
    (spec.elements || []).filter((element) => element.category === 'floor' && Number(element.level || 1) === current)
      .forEach((plate) => operations.push({ type: 'remove_object', targetId: plate.id, name: plate.name }));
    const strandedRooms = (spec.rooms || []).filter((room) => Number(room.level || 1) === current);
    strandedRooms.forEach((room) => operations.push({ type: 'update_object', targetId: room.id, name: room.name, field: 'level', value: '1' }));
    void applyBackendOperations({
      operations,
      promptText: `Remove storey ${current}`,
      logPrefix: 'Storeys',
      chatText: `Removed storey ${current}.${strandedRooms.length ? ` ${strandedRooms.length} room${strandedRooms.length === 1 ? ' that was' : 's that were'} up there moved to the ground floor — delete or rearrange as needed.` : ''}`
    });
    setActiveFloor(Math.min(activeFloor, next));
  }

  async function arrangeRooms() {
    const arrange = arrangeRoomsPlan(spec);
    if (!arrange.ops.length) return;
    await applyBackendOperations({
      operations: arrange.ops,
      promptText: arrange.grew ? `Arrange plan · grew house to ${arrange.newW} × ${arrange.newD}` : 'Arrange floor plan',
      logPrefix: 'Layout',
      chatText: arrange.grew
        ? `Tidied the floor plan and grew the house to ${arrange.newW}′ × ${arrange.newD}′ so every room fits without overlapping.`
        : 'Tidied the floor plan — rooms laid out edge to edge without overlapping.'
    });
  }

  function removeSelectedRoom() {
    if (selectedIsSpecial) {
      if (selectedIsOpening) {
        void applyBackendOperations({
          operations: [{ type: 'remove_object', targetId: selectedRoom, name: selected?.name }],
          promptText: `Remove ${selected?.name || 'opening'}`,
          logPrefix: 'Remove opening'
        });
        setSelectedRoom(spec.rooms[0]?.id || '');
        setLastModelChange(`Removed ${selected.name}.`);
      }
      return;
    }
    if (selectedIsWall) {
      removeSelectedWallSection();
      return;
    }
    if (!selected || (!selectedIsElement && spec.rooms.length <= 1)) return;
    void applyBackendOperations({
      operations: [{ type: 'remove_object', targetId: selectedRoom, name: selected.name }],
      promptText: `Remove ${selected.name}`,
      logPrefix: 'Remove object'
    });
  }

  function useLibraryElement(item, sourceCategory, mode = libraryActionMode) {
    if (mode === 'apply') {
      const field = systemFieldForLibraryItem(item);
      const value = appliedSystemText(item);
      void applyBackendOperations({
        operations: [{ type: 'set_assembly', field, value }],
        promptText: `Apply ${item.name} to house`,
        logPrefix: 'Library apply',
        chatText: `Applied ${item.name} to the house system.`
      });
    } else {
      void applyBackendOperations({
        operations: [{ type: 'add_element', name: item.name, category: item.kind, x: clamp(spec.shell.widthFt + 3, -24, spec.shell.widthFt + 24), y: clamp(spec.shell.depthFt + 3, -24, spec.shell.depthFt + 32), w: item.w, d: item.d, h: item.kind === 'wall' ? 8 : item.kind === 'thermal' ? 5 : item.kind === 'water' ? 6 : 1.2 }],
        promptText: `Place ${item.name}`,
        logPrefix: 'Library place',
        chatText: `Placed ${item.name} as a fresh BIM object.`
      });
    }
  }

  // Team = consult-only, answered by the REAL studio AI in the expert's voice.
  // It never touches the model — that hard line is what keeps Team and Design
  // from muddling. Canned local answers remain only as the offline fallback.
  async function askExpert() {
    if (!expertQuestion.trim()) return;
    const submitted = expertQuestion.trim();
    const speaker = selectedExpert ? selectedExpert.name : 'Whole Team';
    setChatMessages((items) => [...items, { role: 'user', speaker: 'You', text: submitted }]);
    setExpertQuestion('');
    setIsPlanning(true);
    try {
      const persona = selectedExpert
        ? `You are answering as the project's ${selectedExpert.name} (${selectedExpert.concern}). Consult only — do NOT propose model operations; give practical professional guidance grounded in the current design.`
        : 'You are the whole professional council answering together. Consult only — do NOT propose model operations; give practical, multi-discipline guidance grounded in the current design.';
      const result = await requestStudioResponse({
        prompt: `${persona}\n\nQuestion: ${submitted}`,
        bim: spec,
        spec,
        selected,
        selectedObjectId: selected?.id || selectedRoom,
        attachedImages,
        chatMessages: chatMessages.slice(-12),
        projectBrain,
        contextPacket: buildContextPacket(spec, projectBrain, selected, submitted)
      });
      const reply = result.reply || (selectedExpert
        ? expertResponse(selectedExpert, submitted, spec, issues, selectedRoom)
        : wholeTeamResponse(submitted, spec, issues, selectedRoom));
      setChatMessages((items) => [...items, { role: 'expertMsg', speaker, text: reply }]);
    } catch (error) {
      const answer = selectedExpert
        ? expertResponse(selectedExpert, submitted, spec, issues, selectedRoom)
        : wholeTeamResponse(submitted, spec, issues, selectedRoom);
      setChatMessages((items) => [...items, { role: 'expertMsg', speaker, text: `${answer}\n\n(The AI consultant was unreachable — this is the local playbook answer.)` }]);
    } finally {
      setIsPlanning(false);
    }
  }

  function submitChat() {
    if (chatTarget === 'design') applyPrompt();
    else askExpert();
  }

  function chooseChatTarget(target) {
    setChatTarget(target);
    if (target !== 'design') setSelectedExpertId(target === 'team' ? 'team' : target);
  }

  async function saveHouseState() {
    if (typeof window === 'undefined') return;
    const now = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const saveNote = `Saved Revision ${spec.revision}: Current house state stored in this dashboard.`;
    const savedChange = `Saved Revision ${spec.revision} in this dashboard.`;
    const chatWithNotice = [
      ...chatMessages,
      { role: 'studio', speaker: 'Studio', text: `${savedChange} It will restore automatically when you reopen this app in this browser.` }
    ];
    const payload = buildDashboardStatePayload({
      projectId,
      savedAt: now,
      spec,
      selectedRoom,
      prompt,
      chatTarget,
      addToTarget,
      selectedExpertId,
      expertQuestion,
      libraryActionMode,
      revisionLog: [saveNote, ...revisionLog],
      history,
      lastModelChange: savedChange,
      operationAudit,
      projectBrain,
      chatMessages: chatWithNotice,
      modelLayers,
      buildProgress,
      visitedSystems
    });
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(payload));
    setSavedAt(now);
    setLastModelChange(savedChange);
    setRevisionLog((items) => [saveNote, ...items]);
    setChatMessages(chatWithNotice);
    try {
      const result = await saveDashboardStateToBackend(payload);
      if (result?.projectId) setProjectId(result.projectId);
    } catch (error) {
      console.warn('Explicit backend save failed:', error);
    }
  }

  function exportJson() {
    downloadFile(`house-bim-rev-${spec.revision}.json`, JSON.stringify(createIfcSummary(spec), null, 2), 'application/json');
  }

  function exportBrief() {
    const lines = [
      `${spec.projectName} - Revision ${spec.revision}`,
      '',
      'Professional Quality Gate',
      `Score: ${qualityScore}/100 schematic readiness`,
      ...issues.map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.title} (${issue.owner}) - ${issue.fix}`),
      '',
      'BIM Hierarchy',
      '- Site > Building > Level 01 > Foundation, Walls, Roof, Openings, Room Zones, Systems',
      '',
      'Rooms',
      ...spec.rooms.map((room) => `- ${room.name}: ${Math.round(room.w * room.d)} sf, ${room.type}, ${room.floor}`),
      '',
      'Systems',
      ...Object.entries(spec.systems).map(([key, value]) => `- ${key}: ${value}`),
      '',
      'Stamp Track Note',
      'This app produces permit-track BIM and QA artifacts with local code, structural, MEP, and jurisdiction-specific drawing fields.'
    ];
    downloadFile(`schematic-brief-rev-${spec.revision}.md`, lines.join('\n'), 'text/markdown');
  }

  function exportSheetSet() {
    downloadFile(`permit-track-set-rev-${spec.revision}.html`, createDrawingSetHtml(spec, qualityScore, issues), 'text/html');
  }

  // Frame shop drawings: elevation views of the structure (posts/beams/braces/
  // rafters) + frame plan + member schedule, drawn from the live model.
  function exportFrameDrawings() {
    downloadFile(`frame-drawings-rev-${spec.revision}.html`, createFrameDrawingSetHtml(spec), 'text/html');
  }

  const SYSTEM_LABELS = { site: 'Site', rooms: 'Rooms', shell: 'Shell', foundation: 'Foundation', walls: 'Walls', roof: 'Roof', windows: 'Windows', heat: 'Heat', water: 'Water', waste: 'Waste', power: 'Power', outdoors: 'Outdoors' };
  const systemOfRoom = (room) => {
    const t = String(room?.type || '').toLowerCase();
    if (t === 'wet') return 'water';
    if (['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant'].includes(t)) return 'outdoors';
    return 'rooms';
  };
  const systemOfElementCategory = (cat) => {
    const map = { water: 'water', thermal: 'heat', passive: 'heat', roof: 'roof', earthwork: 'foundation', floor: 'foundation', foundation: 'foundation', structure: 'walls', wall: 'walls', partition: 'rooms', chimney: 'heat', deck: 'outdoors', landscape: 'outdoors', garden: 'outdoors', animal: 'outdoors', outbuilding: 'site', loft: 'rooms', tower: 'rooms' };
    return map[String(cat || '').toLowerCase()] || 'outdoors';
  };
  const systemOfSpecialCategory = (cat) => {
    const c = String(cat || '').toLowerCase();
    if (c.includes('open') || c.includes('window') || c.includes('door')) return 'windows';
    if (c.includes('roof')) return 'roof';
    if (c.includes('pad') || c.includes('grid') || c.includes('site')) return 'site';
    if (c.includes('wall')) return 'walls';
    return 'outdoors';
  };
  const systemFocus = consoleView === 'systems' ? systemView : null;

  return (
    <main className={chatOpen ? 'app' : 'app chatClosed'}>
      <aside className="leftPanel">
        <div className="leftScroll">
        <div className="brand">
          <div className="brandMark" aria-hidden="true"><span className="brandGable" /></div>
          <div>
            <h1>Natural Building</h1>
          </div>
          <button type="button" className="brandHelp" title="What is this? — the opening card" onClick={() => setWelcomeOpen(true)}>?</button>
        </div>

        <section className="panelBlock compact consoleSummary">
          <div className="statGrid three">
            <button type="button" title="See the full cost breakdown" onClick={() => { setAppMode('design'); setConsoleView('costs'); }}><strong>${estimatedCost.toLocaleString()}</strong><span>{derived.sweat > 0 ? `est. cost · sweat saves $${Math.round(derived.sweat / 1000)}k` : 'est. cost'}</span></button>
            <button type="button" title="Open the Rooms plan" onClick={() => { setConsoleView('systems'); setSystemView('rooms'); }}><strong>{spec.rooms.length}</strong><span>room{spec.rooms.length === 1 ? '' : 's'} · {area} sf</span></button>
            <button type="button" className={openFlagCount === 0 ? 'stateStat ok' : 'stateStat bad'} title="See the checks in Review" onClick={() => setConsoleView('review')}><strong>{openFlagCount === 0 ? 'All clear' : openFlagCount}</strong><span>{openFlagCount === 0 ? 'checks pass' : `check${openFlagCount === 1 ? '' : 's'} to fix`}</span></button>
          </div>
        </section>

        <nav className="modeTabs" aria-label="Design or build">
          <button className={appMode === 'design' ? 'active' : ''} onClick={() => setAppMode('design')}><Hammer size={15} /> Design</button>
          <button className={appMode === 'build' ? 'active' : ''} onClick={() => setAppMode('build')}><ClipboardCheck size={15} /> Build</button>
        </nav>

        {appMode === 'build' && (() => {
          const phases = buildTimeline(spec, derived);
          const doneCount = phases.filter((phase) => buildProgress[phase.id]).length;
          const totalWeeks = phases.reduce((sum, phase) => sum + phase.weeks, 0);
          const takeoff = materialsTakeoff(spec, derived);
          const maintenance = MAINTENANCE_TASKS.filter((task) => task.when(spec, derived.utilities));
          return (
            <section className="panelBlock consolePanel buildPanel">
              <div className="blockTitle"><ClipboardCheck size={16} /> Build It</div>
              <p className="studioHint">The design, turned into a build: phases in order, what each takes, and the materials list. Check phases off as you go — progress saves with the design.</p>
              <div className="buildSummary">
                <div><strong>{doneCount}/{phases.length}</strong><span>phases done</span></div>
                <div><strong>~{Math.round(totalWeeks)}</strong><span>weeks of work</span></div>
                <div><strong>${Math.round(derived.total).toLocaleString()}</strong><span>after sweat equity</span></div>
              </div>
              <div className="buildBar"><div className="buildBarFill" style={{ width: `${(doneCount / phases.length) * 100}%` }} /></div>

              <div className="sectionHead">Construction phases</div>
              <div className="phaseList">
                {phases.map((phase, index) => (
                  <details key={phase.id} className={buildProgress[phase.id] ? 'phaseCard done' : 'phaseCard'}>
                    <summary>
                      <input type="checkbox" checked={Boolean(buildProgress[phase.id])} onClick={(event) => event.stopPropagation()} onChange={(event) => setBuildProgress((current) => ({ ...current, [phase.id]: event.target.checked }))} />
                      <span className="phaseTitle">{index + 1}. {phase.title}</span>
                      <span className="phaseMeta">{phase.weeks} wk{phase.costPct > 0 ? ` · $${Math.round(derived.total * phase.costPct / 1000)}k` : ''}{phase.inspector ? ' · 🔍 inspection' : ''}</span>
                    </summary>
                    <div className="phaseBody">
                      <p><b>Materials:</b> {phase.materials}</p>
                      <p><b>Tools:</b> {phase.tools}</p>
                      <p><b>Safety:</b> {phase.safety}</p>
                      <p><b>Weather:</b> {phase.weather}</p>
                    </div>
                  </details>
                ))}
              </div>

              <div className="sectionHead">Materials takeoff</div>
              <div className="takeoffTable">
                {takeoff.map(([item, qty, note]) => (
                  <div className="takeoffRow" key={item}>
                    <span>{item}</span>
                    <b>{qty}</b>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
              <p className="systemNote">Directional quantities from the current design — order from these only after your own count.</p>

              <div className="sectionHead">Living with it</div>
              <div className="maintList">
                {maintenance.map((task) => (
                  <div className="maintRow" key={task.title}>
                    <span className="maintInterval">{task.interval}</span>
                    <div><b>{task.title}</b><small>{task.desc}</small></div>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {appMode === 'design' && (() => {
          const moreShown = moreTabsOpen || consoleView === 'os' || consoleView === 'audit';
          return (
            <nav className="consoleTabs" aria-label="Project console">
              <button className={consoleView === 'systems' ? 'active' : ''} onClick={() => setConsoleView('systems')}><Grid3X3 size={14} /> Systems</button>
              <button className={consoleView === 'costs' ? 'active' : ''} onClick={() => setConsoleView('costs')}><Coins size={14} /> Costs</button>
              <button className={consoleView === 'review' ? 'active' : ''} onClick={() => setConsoleView('review')}><ShieldCheck size={14} /> Review</button>
              <button className={`moreToggle${moreShown ? ' active' : ''}`} onClick={() => setMoreTabsOpen((open) => !open)} title="More views" aria-label="More views">⋯</button>
              {moreShown && <button className={consoleView === 'os' ? 'active' : ''} onClick={() => setConsoleView('os')}><ClipboardCheck size={14} /> Project</button>}
              {moreShown && <button className={consoleView === 'audit' ? 'active' : ''} onClick={() => setConsoleView('audit')}><FileJson size={14} /> History</button>}
            </nav>
          );
        })()}


        {appMode === 'design' && consoleView === 'systems' && <section className="panelBlock consolePanel systemsPanel">
          <nav className="systemNav" aria-label="Building systems">
            {SYSTEM_GROUPS.map((group) => (
              <div className="systemNavGroup" key={group.label}>
                <div className="systemNavEyebrow">{group.label}</div>
                <div className="systemTabs">
                  {group.keys.map((key) => (
                    <button key={key} className={systemView === key ? 'active' : ''} onClick={() => setSystemView(key)} title={flaggedSystems.has(key) ? 'A council check is failing in this system' : visitedSystems.includes(key) ? 'You’ve been through this system' : 'Not visited yet'}>
                      <span className={flaggedSystems.has(key) ? 'sysDot flag' : visitedSystems.includes(key) ? 'sysDot done' : 'sysDot'} />{SYSTEM_META[key].label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {systemView === 'shell' && (() => {
            const shellHeights = WALL_SIDES.map((side) => resolveWallSide(spec, side)).filter((r) => !r.omitted).map((r) => r.heightFt);
            const shellHeightsMixed = new Set(shellHeights).size > 1;
            return (
            <div className="systemPage">
              <div className="sectionHead">Design approach</div>
              <div className="controlGrid">
                <label>Building approach
                  <select value={spec.shell.designApproach === 'standard' ? 'standard' : 'natural'} onChange={(event) => updateShell('designApproach', event.target.value)}>
                    <option value="natural">Natural building (straw bale, cob, passive solar…)</option>
                    <option value="standard">Standard construction (conventional framing)</option>
                  </select>
                </label>
              </div>
              <p className="systemNote">{spec.shell.designApproach === 'standard'
                ? 'Standard mode: the assistant models conventional construction and the passive-solar / homestead checks stand down. Natural techniques stay available — just ask for them.'
                : 'Natural mode: the assistant prefers natural systems and the full council watches the design. Switch to Standard when modeling an existing conventional house.'}</p>

              <div className="sectionHead">Overall shape</div>
              <div className="controlGrid">
                <label>Width (ft)<input type="number" value={spec.shell.widthFt} onChange={(event) => updateShell('widthFt', event.target.value)} /></label>
                <label>Length (ft)<input type="number" value={spec.shell.depthFt} onChange={(event) => updateShell('depthFt', event.target.value)} /></label>
                {shellHeightsMixed ? (
                  <label>Wall height
                    <div className="mixedField">
                      <span>Mixed · {Math.min(...shellHeights)}–{Math.max(...shellHeights)}' — set per wall on the Walls page</span>
                    </div>
                  </label>
                ) : (
                  <label>Wall height (ft)<input type="number" value={shellHeights[0] ?? spec.shell.wallHeightFt} onChange={(event) => updateShell('wallHeightFt', event.target.value)} /></label>
                )}
                <label>Storeys
                  <div className="storeyControl">
                    <strong>{floorCount(spec)}</strong>
                    <button type="button" className="secondary" disabled={floorCount(spec) >= 3} title="Add a storey — it gets an extent plate you can resize in the Plan" onClick={addStorey}>+ Add</button>
                    <button type="button" className="secondary" disabled={floorCount(spec) <= 1} title="Remove the top storey — rooms up there move to the ground floor" onClick={removeStorey}>− Remove</button>
                  </div>
                </label>
              </div>
              {basementInfo(spec.shell).present && (
                <div>
                  <div className="sectionHead">Basement — its own controls</div>
                  <div className="controlGrid">
                    <label>Ceiling height (ft)<input type="number" step="0.5" min="6" max="12" value={basementInfo(spec.shell).heightFt} onChange={(event) => updateShell('basementHeightFt', event.target.value)} /></label>
                    <label className="diyToggle"><input type="checkbox" checked={spec.shell.basementHeated !== false} onChange={(event) => updateShell('basementHeated', event.target.checked)} /><span>Heated space</span></label>
                  </div>
                  <p className="systemNote">The basement spans the whole footprint (it IS the foundation) — lay out its rooms on the <b>Basement</b> Plan tab. More on the Foundation page.</p>
                </div>
              )}
              {floorCount(spec) > 1 && (
                <div>
                  <div className="sectionHead">Ground floor</div>
                  <p className="systemNote">The ground storey is the shell itself: Width / Length / Wall height above are its controls, and each side can differ on the <b>Walls</b> page.</p>
                </div>
              )}
              {(() => {
                const plates = (spec.elements || []).filter((el) => el.category === 'floor' && Number(el.level || 1) > 1);
                if (!plates.length) return null;
                return (
                <FineTune label={plates.length > 1 ? 'Fine-tune — each upper storey' : 'Fine-tune — the upper storey'} hint="its exact size, position, and ceiling height">
                {plates.map((plateEl) => {
                const plateDispatch = (ops, label) => applyBackendOperations({ operations: ops, promptText: label, logPrefix: 'Storey', nextSelectedId: plateEl.id });
                const num = (v) => Number(v) || 0;
                return (
                  <div key={plateEl.id}>
                    <div className="sectionHead">{floorLabel(spec, Number(plateEl.level))} — its own size, position, and height</div>
                    <div className="controlGrid">
                      <label>Ceiling height (ft)<input type="number" step="0.5" min="3" max="14" value={storeyInfo(spec.shell).upperFt} onChange={(event) => updateShell('upperStoreyHeightFt', event.target.value)} /></label>
                      <label>From west wall (ft)<input type="number" step="0.5" value={num(plateEl.x)} onChange={(event) => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: num(event.target.value), y: num(plateEl.y) }], 'Move the upper storey')} /></label>
                      <label>From north wall (ft)<input type="number" step="0.5" value={num(plateEl.y)} onChange={(event) => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: num(plateEl.x), y: num(event.target.value) }], 'Move the upper storey')} /></label>
                      <label>Width (ft)<input type="number" step="0.5" min="6" value={num(plateEl.w)} onChange={(event) => plateDispatch([{ type: 'resize_object', targetId: plateEl.id, w: Math.max(6, num(event.target.value)), d: num(plateEl.d) }], 'Resize the upper storey')} /></label>
                      <label>Depth (ft)<input type="number" step="0.5" min="6" value={num(plateEl.d)} onChange={(event) => plateDispatch([{ type: 'resize_object', targetId: plateEl.id, w: num(plateEl.w), d: Math.max(6, num(event.target.value)) }], 'Resize the upper storey')} /></label>
                    </div>
                    <div className="storeyControl">
                      <button type="button" className="secondary" title="Cover the whole ground floor" onClick={() => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: 0.01, y: 0.01 }, { type: 'resize_object', targetId: plateEl.id, w: Number(spec.shell.widthFt), d: Number(spec.shell.depthFt) }], 'Match the storey to the ground floor')}>Match ground floor</button>
                      <button type="button" className="secondary" title="Center the storey over the plan" onClick={() => plateDispatch([{ type: 'move_object', targetId: plateEl.id, x: Math.max(0.01, (Number(spec.shell.widthFt) - num(plateEl.w)) / 2), y: Math.max(0.01, (Number(spec.shell.depthFt) - num(plateEl.d)) / 2) }], 'Center the upper storey')}>Center it</button>
                    </div>
                    <p className="systemNote">The upper storey covers only this rectangle — walls ring it and the roof steps down over the rest. Its wall construction has its own section on the <b>Walls</b> page; its frame on the <b>Frame</b> page. Also draggable on the <b>{floorLabel(spec, Number(plateEl.level))}</b> Plan tab.</p>
                  </div>
                );
                })}
                </FineTune>
                );
              })()}
              <FineTune label="Fine-tune — footprint shape" hint="L-shapes, notches, moving a wall">
              {hasCustomFootprint(spec) ? (
                <>
                  <div className="controlGrid">
                    <label>Outline
                      <div className="mixedField"><span>{footprintPolygon(spec).length} corners · {fmtNum(Math.round(polygonArea(footprintPolygon(spec))))} sf inside {spec.shell.widthFt} × {spec.shell.depthFt} ft</span></div>
                    </label>
                    <label>Back to a rectangle
                      <button type="button" className="secondary" title="Straighten the outline back to the full bounding rectangle" onClick={() => applyBackendOperations({ operations: [{ type: 'set_footprint', value: 'rect' }], promptText: 'Reset footprint to rectangle', logPrefix: 'Footprint' })}>Reset outline</button>
                    </label>
                  </div>
                  <p className="systemNote">The plan is an L / custom shape. <b>Drag any wall edge in the Plan view</b> to move that wall; tap a wall and use <b>Split into 3</b> in the inspector to add another jog. Width/Length above scale the whole outline.</p>
                </>
              ) : (
                <p className="systemNote">The plan is a plain rectangle. To make an <b>L-shape or notch</b>: tap a wall (model, Plan, or the Walls page), press <b>Split into 3</b> in the inspector, then drag the middle segment in the Plan view — or just ask the assistant ("make this an L with a 16×13 porch notch on the southeast corner").</p>
              )}
              <p className="systemNote">Footprint: {spec.shell.widthFt} × {spec.shell.depthFt} ft = {fmtNum(Math.round(derived.floor))} sf{floorCount(spec) > 1 ? ` · ${fmtNum(derived.heatedFloor)} sf heated across ${floorCount(spec)} storeys` : ''}. Each added storey gets an <b>extent plate</b> — switch to that floor in the Plan and resize it to put the storey over only part of the building (the roof steps down over the rest). Per-wall heights and systems live on the <b>Walls</b> page; put a room upstairs by setting its Level in the inspector.</p>
              </FineTune>
            </div>
            );
          })()}

          {systemView === 'rooms' && (
            <div className="systemPage">
              <div className="sectionHead">Add a room</div>
              <div className="roomAddGrid">
                {ROOM_PRESETS.map((preset) => (
                  <button key={preset.name} className="roomAddChip" onClick={() => addRoomPreset(preset)}>
                    <b>{preset.name}</b>
                    <small>{preset.w} × {preset.d}′</small>
                  </button>
                ))}
              </div>
              {pendingRoomAdds.length > 0 && (
                <div className="pendingAdds" aria-live="polite">
                  {pendingRoomAdds.map((name, index) => (
                    <span key={`${name}-${index}`} className="pendingAdd">{index === 0 ? `Adding ${name}…` : `Queued: ${name}`}</span>
                  ))}
                </div>
              )}
              <p className="systemNote">Click to drop a room in — it slots into free space (nothing else moves). Rapid clicks queue up and land in order. Rename or resize any room in the Inspector below, or drag it in the 2D plan. You can also tell the assistant "add a pantry 8 × 10".</p>

              <div className="sectionHead">Add a fixture</div>
              <div className="roomAddGrid">
                {interiorFixtures(spec).map((fixture) => (
                  <button key={fixture.key} className="roomAddChip fixture" onClick={() => placeFixture(fixture)}>
                    <b>{fixture.name}</b>
                    <small>{fixture.w} × {fixture.d}′</small>
                  </button>
                ))}
              </div>
              <p className="systemNote">Heaters, tanks, stairs, counters — placed as objects you can drag in the 2D plan and see in 3D. The heater matches your Heat page choice.</p>

              {spec.rooms.length > 1 && (
                <>
                  <div className="sectionHead">Interior walls</div>
                  <button className="secondary" onClick={drawPartitions}>⌗ Draw walls between rooms</button>
                  <p className="systemNote">Where two rooms share an edge, this drops a real partition wall on the line — with a 3′ doorway so the plan stays walkable. Tap a wall to change its construction (framed / cob / adobe), door width, or door position; drag it in the Plan like anything else. Chat works too: “add a cob wall between the kitchen and the living room.”</p>
                </>
              )}

              {spec.rooms.length > 0 && (
                <>
                  <div className="breakOpenRow">
                    <div className="sectionHead">Floor plan · {spec.rooms.length} room{spec.rooms.length === 1 ? '' : 's'}</div>
                    <button className="breakOpen" onClick={arrangeRooms}>↹ auto-arrange</button>
                  </div>
                  <div className="systemList roomPickList">
                    {spec.rooms.map((room, index) => (
                      <button
                        key={room.id || index}
                        className={room.id === selectedRoom ? 'roomPickRow active' : 'roomPickRow'}
                        onClick={() => setSelectedRoom(room.id)}
                      >
                        <span>{room.name}</span>
                        <small>{room.w} × {room.d}′ · {Math.round(room.w * room.d)} sf{Number(room.level || 1) > 1 ? ' · upstairs' : ''}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {systemView === 'walls' && (() => {
            const resolvedSides = WALL_SIDES.map((side) => ({ side, r: resolveWallSide(spec, side) }));
            // The global selector shows what the four walls actually ARE (the
            // resolved sides), never the legacy envelope text — that field
            // goes stale the moment per-side ops run, and a selector that says
            // "Framed" over four straw-bale walls destroys trust.
            const activeSides = resolvedSides.filter(({ r }) => !r.omitted);
            const assemblyKeys = new Set(activeSides.map(({ r }) => r.assemblyKey));
            const globalKey = assemblyKeys.size === 1 ? activeSides[0]?.r.assemblyKey : '';
            const mixed = assemblyKeys.size > 1;
            const activeHeights = activeSides.map(({ r }) => r.heightFt);
            const heightsMixed = new Set(activeHeights).size > 1;
            const sharedHeight = activeHeights[0] ?? spec.shell.wallHeightFt;
            return (
              <div className="systemPage">
                <div className="sectionHead">The obvious numbers first</div>
                <div className="controlGrid">
                  {heightsMixed ? (
                    <label>Height
                      <div className="mixedField">
                        <span>Mixed · {Math.min(...activeHeights)}–{Math.max(...activeHeights)}' — each side rules below</span>
                        <button className="breakOpen" onClick={() => updateShell('wallHeightFt', Math.max(...activeHeights))}>unify at {Math.max(...activeHeights)}'</button>
                      </div>
                    </label>
                  ) : (
                    <label>Height (ft)<input type="number" min="7" max="40" value={sharedHeight} onChange={(event) => updateShell('wallHeightFt', event.target.value)} /></label>
                  )}
                  <label>Width<span className="readOnlyDim">{spec.shell.widthFt}′ <small>north/south walls</small></span></label>
                  <label>Length<span className="readOnlyDim">{spec.shell.depthFt}′ <small>east/west walls</small></span></label>
                </div>
                <p className="systemNote">Height lives here. Width and Length are the overall shape of the house — <button type="button" className="inlineLink" onClick={() => setSystemView('shell')}>edit the overall shape on the Shell page</button> so there's one place that changes it.</p>

                <div className="sectionHead">Wall system (all sides)</div>
                <div className="controlGrid">
                  <label>Assembly
                    <select value={globalKey} onChange={(event) => setAllWallsAssembly(event.target.value)}>
                      {mixed && <option value="" disabled>Mixed — see per-side</option>}
                      {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                        <option key={assembly.key} value={assembly.key} style={greenOptStyle(assembly)}>{greenLeaf(assembly)}{assembly.label} (R≈{assembly.rValue})</option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const clads = WALL_SIDES.map((side) => resolveWallSide(spec, side).cladding);
                    const cladsMixed = new Set(clads).size > 1;
                    return (
                      <label>Cladding (all sides)
                        <select value={cladsMixed ? '' : clads[0]} onChange={(event) => setAllWallsCladding(event.target.value)}>
                          {cladsMixed && <option value="" disabled>Mixed — tap a wall to set per side</option>}
                          {Object.entries(CLADDING_TYPES).map(([key, c]) => <option key={key} value={key} style={greenOptStyle(c)}>{greenLeaf(c)}{c.label}{c.costPsf ? ` (+$${c.costPsf}/sf)` : ''}</option>)}
                        </select>
                      </label>
                    );
                  })()}
                </div>
                <label className="diyToggle">
                  <input type="checkbox" checked={utilitiesOf(spec).diyWalls} onChange={(event) => updateUtility('diyWalls', event.target.checked)} />
                  <span>I'll raise the walls myself (sweat equity — walls are the most DIY-able system)</span>
                </label>
                <p className="systemNote">While all sides share one height you can set it here; once a side differs, set its height by tapping that wall under Fine-tune below.</p>

                <FineTune label={storeyInfo(spec.shell).storeys > 1 ? 'Fine-tune — wall by wall, ground & upper' : 'Fine-tune — wall by wall'} hint="each side's system, height, thickness, finishes">
                <p className="systemNote">Tap a wall — here or in the model — to edit that side in the Inspector below. Tick “no wall” to leave a side open to an attached greenhouse or porch.</p>
                <div className="pickList">
                  {resolvedSides.map(({ side, r }) => {
                    // On a custom footprint a facing can have several segments —
                    // the row selects its longest one (each is tappable in the
                    // model/plan/chip); construction stays shared per facing.
                    const facingSections = wallSections.filter((wall) => wall.side === side && wall.level === 1);
                    const rowTarget = facingSections.length
                      ? facingSections.reduce((best, wall) => (wall.lengthFt > best.lengthFt ? wall : best)).id
                      : `wall-${side}`;
                    const rowActive = facingSections.some((wall) => wall.id === selectedRoom) || selectedRoom === `wall-${side}`;
                    return (
                      <div key={side} className={`pickRow${r.omitted ? ' muted' : ''}${rowActive ? ' active' : ''}`}>
                        <button type="button" className="pickRowMain" onClick={() => selectObject(rowTarget)} disabled={r.omitted}>
                          <strong>{WALL_SIDE_LABELS[side]}{facingSections.length > 1 ? ` (${facingSections.length} segments)` : ''}</strong>
                          <small>{r.omitted ? 'no wall on this side' : `${r.assembly.label} · ${r.heightFt}′ · ${r.thicknessFt.toFixed(2)}′ · ${spec.openings.filter((opening) => opening.wall === side).length} opening(s)`}</small>
                        </button>
                        <label className="pickRowToggle" title="Leave this side without a wall (open to a greenhouse, porch, or the outdoors)">
                          <input type="checkbox" checked={r.omitted} onChange={(event) => updateWallSide(side, 'omitted', event.target.checked)} />
                          <span>no wall</span>
                        </label>
                      </div>
                    );
                  })}
                </div>

                {storeyInfo(spec.shell).storeys > 1 && (() => {
                  const upperSides = WALL_SIDES.map((side) => ({ side, r: resolveWallSide(spec, side, 2) })).filter(({ r }) => !r.omitted);
                  const upperKeys = new Set(upperSides.map(({ r }) => r.assemblyKey));
                  const upperGlobal = upperKeys.size === 1 ? upperSides[0]?.r.assemblyKey : '';
                  return (
                    <>
                      <div className="sectionHead">Upper storey — each side</div>
                      <div className="controlGrid">
                        <label>Assembly (all upper sides)
                          <select value={upperGlobal} onChange={(event) => setAllWallsAssembly(event.target.value, 2)}>
                            {upperKeys.size > 1 && <option value="" disabled>Mixed — see per-side</option>}
                            {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                              <option key={assembly.key} value={assembly.key} style={greenOptStyle(assembly)}>{greenLeaf(assembly)}{assembly.label} (R≈{assembly.rValue})</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="systemNote">The upper storey can run a different construction — light straw-clay or framed infill over a cob or bale ground floor is a natural-building classic (lighter loads up high).</p>
                      <div className="pickList">
                        {upperSides.map(({ side, r }) => (
                          <div key={`u-${side}`} className={`pickRow${selectedRoom === `wall-${side}-u` ? ' active' : ''}`}>
                            <button type="button" className="pickRowMain" onClick={() => selectObject(`wall-${side}-u`)}>
                              <strong>{WALL_SIDE_LABELS[side]} (upper)</strong>
                              <small>{r.assembly.label} · {r.thicknessFt.toFixed(2)}′ thick</small>
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
                </FineTune>
              </div>
            );
          })()}

          {systemView === 'site' && (
            <div className="systemPage">
              <div className="sectionHead">Where the house sits</div>
              <label className="geoSearchLabel">Find your place
                <div className="geoRow">
                  <input
                    type="text"
                    placeholder="Town, county, or ZIP — e.g. Corning NY"
                    value={geoQuery}
                    onChange={(event) => setGeoQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') runGeoSearch(); }}
                  />
                  <button className="secondary" onClick={runGeoSearch}>Search</button>
                </div>
              </label>
              {geoStatus && <p className="systemNote geoStatus">{geoStatus}</p>}
              {geoResults.length > 0 && (
                <div className="geoResults">
                  {geoResults.map((result, index) => (
                    <button key={`${result.name}-${index}`} onClick={() => pickGeoResult(result)}>
                      <b>{result.name}{result.admin1 ? `, ${result.admin1}` : ''}</b>
                      <small>{result.country} · {result.latitude.toFixed(1)}°, {result.longitude.toFixed(1)}°</small>
                    </button>
                  ))}
                </div>
              )}
              {siteOf(spec).placeName && <p className="systemNote">Current place: <b>{siteOf(spec).placeName}</b> — {siteOf(spec).latitudeDeg}° latitude, {siteOf(spec).rainInYr}" of rain a year.</p>}
              <div className="controlGrid">
                <label>Latitude (°)<input type="number" step="0.5" min="0" max="70" value={siteOf(spec).latitudeDeg} onChange={(event) => updateSite('latitudeDeg', event.target.value)} /></label>
                <label>Yearly rain (in)<input type="number" min="0" max="200" value={siteOf(spec).rainInYr} onChange={(event) => updateSite('rainInYr', event.target.value)} /></label>
                <label>Orientation off south (°) <em className="pitchHint">{(() => { const a = Number(siteOf(spec).azimuthDeg) || 0; return a === 0 ? 'due south' : `${Math.abs(a)}° ${a < 0 ? 'east' : 'west'} of south · ${Math.round(derived.solarFactor * 100)}% sun`; })()}</em><input type="number" step="5" min="-90" max="90" value={Number(siteOf(spec).azimuthDeg) || 0} onChange={(event) => updateSite('azimuthDeg', event.target.value)} /></label>
              </div>
              <p className="systemNote">Search by name for real coordinates and last year's actual rainfall, or fine-tune by hand. Latitude sets sun angles; rain decides whether the roof can supply water. Orientation is how far the south face is turned off true south — the further you rotate, the less winter sun your south glass gathers.</p>

              <FineTune label="Fine-tune — topography" hint="sloped land, walkout basements">
              <div className="controlGrid">
                <label>Fall across the house (ft)
                  <input type="number" step="0.5" min="0" max="60" value={Number(siteOf(spec).slopeFt) || 0} onChange={(event) => updateSite('slopeFt', event.target.value)} />
                </label>
                <label>Downhill direction
                  <select value={siteOf(spec).slopeDir || 'south'} onChange={(event) => updateSite('slopeDir', event.target.value)} disabled={!(Number(siteOf(spec).slopeFt) > 0)}>
                    <option value="north">North</option>
                    <option value="south">South</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                  </select>
                </label>
                <label>Floor above grade, uphill (ft)
                  <input type="number" step="0.25" min="0" max="12" value={Number(siteOf(spec).gradeFt ?? 1.5)} onChange={(event) => updateSite('gradeFt', event.target.value)} />
                </label>
              </div>
              <p className="systemNote">{(Number(siteOf(spec).slopeFt) || 0) > 0
                ? <>The land falls <b>{siteOf(spec).slopeFt}′ toward the {siteOf(spec).slopeDir}</b> across the footprint — the model's terrain slopes to match and the foundation steps down to meet grade, exposing up to <b>{maxFoundationExposureFt(spec).toFixed(1)}′</b> of wall on the downhill side{maxFoundationExposureFt(spec) >= 6 ? ' (a walkout/daylight basement condition)' : ''}. Drawings and sections read this same grade line.</>
                : 'Flat site. Give it a fall in feet (from a survey, contour lines, or pacing it off) and the terrain, foundation, and future drawings will follow the real ground.'}</p>
              </FineTune>

              <div className="sectionHead">Outbuildings</div>
              <div className="roomAddGrid">
                {OUTBUILDING_PRESETS.map((preset) => (
                  <button key={preset.name} className="roomAddChip" onClick={() => placeOutbuilding(preset)}>
                    <b>{preset.name}</b>
                    <small>{preset.w} × {preset.d}′ · {OUTBUILDING_CONSTRUCTION[preset.construction]?.label}</small>
                  </button>
                ))}
              </div>
              <p className="systemNote">Drop a structure on the site — drag it where it belongs in the plan or model, and set its size + construction by tapping it. Each costs by its footprint and how it's built.</p>
              {(() => {
                const outbuildings = (spec.elements || []).filter((element) => element.category === 'outbuilding');
                if (outbuildings.length === 0) return null;
                return (
                  <div className="pickList">
                    {outbuildings.map((element) => (
                      <div className={`pickRow${selectedRoom === element.id ? ' active' : ''}`} key={element.id}>
                        <button type="button" className="pickRowMain" onClick={() => selectObject(element.id)}>
                          <strong>{element.name}</strong>
                          <small>{element.w} × {element.d}′ · {OUTBUILDING_CONSTRUCTION[element.construction]?.label || 'construction: set it'} · {fmtMoney((Number(element.w) * Number(element.d) || 0) * (OUTBUILDING_CONSTRUCTION[element.construction]?.costPsf ?? 60))}</small>
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {systemView === 'foundation' && (
            <div className="systemPage">
              <div className="sectionHead">Foundation size</div>
              <div className="controlGrid">
                <label>Width (ft)<input type="number" value={spec.shell.widthFt} onChange={(event) => updateShell('widthFt', event.target.value)} /></label>
                <label>Length (ft)<input type="number" value={spec.shell.depthFt} onChange={(event) => updateShell('depthFt', event.target.value)} /></label>
              </div>
              <p className="systemNote">The foundation carries the building footprint — <b>{spec.shell.widthFt} × {spec.shell.depthFt} ft = {Math.round(Number(spec.shell.widthFt) * Number(spec.shell.depthFt))} sf</b>, {Math.round(2 * (Number(spec.shell.widthFt) + Number(spec.shell.depthFt)))} ft of perimeter. Set it here, on Shell, or on Walls — they all stay in step.</p>

              <div className="sectionHead">What the house sits on</div>
              <div className="controlGrid">
                <label>Type
                  <select value={basementInfo(spec.shell).present ? 'basement' : utilitiesOf(spec).foundationType} onChange={(event) => setFoundationChoice(event.target.value)}>
                    <option value="rubble" style={greenOptStyle({ green: true })}>🌿 Rubble trench — drained gravel, low cost, low carbon</option>
                    <option value="stemwall">Stem wall — perimeter wall on footing</option>
                    <option value="slab">Insulated slab — simple, the most concrete</option>
                    <option value="basement">Basement — a full storey below grade</option>
                  </select>
                </label>
                {!basementInfo(spec.shell).present && utilitiesOf(spec).foundationType === 'stemwall' && (
                  <label>Stem wall height (ft)<input type="number" step="0.25" min="0.5" max="6" value={utilitiesOf(spec).stemwallHeightFt ?? 1.5} onChange={(event) => updateUtility('stemwallHeightFt', event.target.value)} /></label>
                )}
                <label>Insulation
                  <select value={utilitiesOf(spec).foundationInsulation || 'perimeter'} onChange={(event) => updateUtility('foundationInsulation', event.target.value)}>
                    <option value="none">None — unheated / mass-coupled</option>
                    <option value="perimeter">Perimeter — insulate the edge</option>
                    <option value="full">Full under-slab / sub-grade</option>
                  </select>
                </label>
              </div>
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyFoundation} onChange={(event) => updateUtility('diyFoundation', event.target.checked)} />
                <span>I'll dig and place it myself (sweat equity)</span>
              </label>
              <p className="systemNote">Rubble trench is the natural-building favorite: half the concrete of a slab, and the biggest single carbon saving on the whole build.</p>

              {basementInfo(spec.shell).present && (
                <>
                  <div className="sectionHead">Basement — foundation and storey in one</div>
                  <div className="controlGrid">
                    <label>Ceiling height (ft)<input type="number" step="0.5" min="6" max="12" value={basementInfo(spec.shell).heightFt} onChange={(event) => updateShell('basementHeightFt', event.target.value)} /></label>
                    <label>Finished space<input value={`${Math.round(derived.basementRoomArea)} sf of rooms`} readOnly /></label>
                  </div>
                  <label className="diyToggle">
                    <input type="checkbox" checked={spec.shell.basementHeated !== false} onChange={(event) => updateShell('basementHeated', event.target.checked)} />
                    <span>Heated (conditioned) space — basement rooms count toward heated floor area</span>
                  </label>
                  <p className="systemNote">The basement plays both roles at once: down here it's the <b>foundation</b> (these concrete walls carry the house — priced and carboned on this line), and in the plan it's a <b>storey</b> — switch the preview to the <b>Basement</b> tab to lay out rooms, and give them a stair. A basement bedroom flags for egress.{Number(siteOf(spec).slopeFt) > 0 ? ' Your site slopes — the downhill side is a natural walkout.' : ''} Switching Type above to rubble / stem wall / slab removes the basement and brings its rooms up to ground.</p>
                </>
              )}

              <FineTune label="Fine-tune — runs under specific walls" hint="a strip under a greenhouse wall, heater, or bearing partition">
              <p className="systemNote">The perimeter above carries the outside walls. Heavy INTERIOR lines need their own strip — the wall between the house and an attached greenhouse, a mass heater, a bearing partition. Drop a run, then drag and stretch it under the wall it carries in the <b>Plan</b> view.</p>
              <div className="roomAddGrid">
                {FOUNDATION_RUN_PRESETS.map((preset) => (
                  <button key={preset.construction} className="roomAddChip" onClick={() => placeFoundationRun(preset)}>
                    <b>{FOUNDATION_RUN_TYPES[preset.construction].label}</b>
                    <small>{fmtMoney(FOUNDATION_RUN_TYPES[preset.construction].costLf + FOUNDATION_RUN_TYPES[preset.construction].stemCostLfFt * preset.h)}/ft</small>
                  </button>
                ))}
              </div>
              {(() => {
                const runs = (spec.elements || []).filter((element) => element.category === 'foundation');
                if (!runs.length) return <p className="systemNote">No runs placed yet. The greenhouse detail: a <b>trench + stem</b> run under the shared wall keeps the bales dry on the house side and gives the glazing a curb to sit on.</p>;
                return (
                  <div className="pickList">
                    {runs.map((element) => {
                      const runType = FOUNDATION_RUN_TYPES[element.construction] || FOUNDATION_RUN_TYPES.rubble;
                      const lengthFt = Math.max(Number(element.w) || 0, Number(element.d) || 0);
                      const runCost = lengthFt * (runType.costLf + runType.stemCostLfFt * (Number(element.h) || 0));
                      return (
                        <div key={element.id} className={`pickRow${selectedRoom === element.id ? ' active' : ''}`}>
                          <button type="button" className="pickRowMain" onClick={() => selectObject(element.id)}>
                            <strong>{element.name}</strong>
                            <small>{runType.label} · {lengthFt}′ long · {fmtMoney(runCost)}</small>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              </FineTune>
            </div>
          )}

          {systemView === 'frame' && (() => {
            const reclaimed = reclaimedOf(spec);
            const storeyN = Math.ceil(storeyInfo(spec.shell).storeys);
            const levels = Array.from({ length: storeyN }, (_, i) => i + 1);
            const savings = derived.reclaimedSavings;
            return (
              <div className="systemPage">
                <div className="sectionHead">Structural frame</div>
                {storeyN <= 1 ? (
                  <div className="controlGrid">
                    <label>Frame type
                      <select value={resolveFrameType(spec, 1)} onChange={(event) => updateFrame(event.target.value)}>
                        {Object.entries(FRAME_TYPES).map(([key, f]) => <option key={key} value={key} style={greenOptStyle(f)}>{greenLeaf(f)}{f.label}</option>)}
                      </select>
                    </label>
                    {resolveFrameType(spec, 1) !== 'load-bearing' && (
                      <label>Bay spacing (ft, post to post)<input type="number" step="0.5" min="4" max="16" value={Number(spec.frame?.baySpacingFt) || 8} onChange={(event) => applyBackendOperations({ operations: [{ type: 'set_frame', field: 'baySpacingFt', value: String(clamp(Number(event.target.value) || 8, 4, 16)) }], promptText: 'Set frame bay spacing', logPrefix: 'Frame' })} /></label>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="systemNote">Each storey can frame differently — heavy timber below, light stick above, say.</p>
                    <div className="controlGrid">
                      {levels.map((lvl) => (
                        <label key={lvl}>{lvl === 1 ? 'Ground' : floorLabel(spec, lvl)} frame
                          <select value={resolveFrameType(spec, lvl)} onChange={(event) => updateFrame(event.target.value, lvl)}>
                            {Object.entries(FRAME_TYPES).map(([key, f]) => <option key={key} value={key} style={greenOptStyle(f)}>{greenLeaf(f)}{f.label}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <p className="systemNote">{FRAME_TYPES[resolveFrameType(spec, 1)]?.note} The frame carries the roof and floors; the <b>Walls</b> page sets what fills between it (straw bale, cob, framed insulation…).</p>

                <label className="diyToggle">
                  <input type="checkbox" checked={reclaimed.frame} onChange={(event) => updateReclaimed('frame', event.target.checked)} />
                  <span>The frame timber is reclaimed / salvaged — cuts its cost and most of its embodied carbon</span>
                </label>
                <label className="diyToggle">
                  <input type="checkbox" checked={utilitiesOf(spec).diyFrame} onChange={(event) => updateUtility('diyFrame', event.target.checked)} />
                  <span>I'll raise the frame myself (sweat equity)</span>
                </label>

                <FineTune label="Fine-tune — where materials are reclaimed" hint="salvage cuts cost and embodied carbon">
                <p className="systemNote">Mark each material system you're building from salvaged stock — it flows straight into cost and embodied carbon.</p>
                <div className="reclaimedGrid">
                  {[['frame', 'Frame timber'], ['walls', 'Wall materials'], ['flooring', 'Flooring'], ['windows', 'Windows & doors'], ['roof', 'Roofing']].map(([key, label]) => (
                    <label key={key} className={reclaimed[key] ? 'reclaimedItem on' : 'reclaimedItem'}>
                      <input type="checkbox" checked={reclaimed[key]} onChange={(event) => updateReclaimed(key, event.target.checked)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {savings.count > 0
                  ? <p className="systemNote"><b>♺ Reclaimed materials are saving</b> about {fmtMoney(savings.cost)} and {(savings.carbon / 1000).toFixed(1)} t CO₂e versus buying everything new.</p>
                  : <p className="systemNote">Nothing marked reclaimed yet. Salvaged windows, timber, and roofing are the biggest, cheapest carbon wins on a natural build.</p>}
                </FineTune>

                <div className="sectionHead">Frame drawings</div>
                <p className="systemNote">Shop-drawing sheets of THIS frame — elevation views with posts, plates, braces, and rafters called out and dimensioned, a frame plan, and a member takeoff. Print at 11×17.</p>
                <button type="button" className="secondary" onClick={exportFrameDrawings}><Ruler size={15} /> Download frame drawings</button>
              </div>
            );
          })()}

          {systemView === 'flooring' && (() => {
            const flooringKey = resolveFlooring(spec);
            const subfloorKey = resolveSubfloor(spec);
            const reclaimed = reclaimedOf(spec);
            const isSlab = utilitiesOf(spec).foundationType === 'slab';
            return (
              <div className="systemPage">
                <div className="sectionHead">Subfloor (the deck)</div>
                <div className="controlGrid">
                  <label>Subfloor
                    <select value={subfloorKey} onChange={(event) => updateSubfloor(event.target.value)}>
                      {Object.entries(SUBFLOOR_TYPES).map(([key, f]) => <option key={key} value={key} style={greenOptStyle(f)}>{greenLeaf(f)}{f.label}</option>)}
                    </select>
                  </label>
                  <label>Insulation <em className="pitchHint">R-{derived.floorR}</em>
                    <select value={resolveInsulation(utilitiesOf(spec).floorInsulation, 'cellulose')} onChange={(event) => updateUtility('floorInsulation', event.target.value)}>
                      {Object.entries(INSULATION_TYPES).map(([key, ins]) => <option key={key} value={key} style={greenOptStyle(ins)}>{greenLeaf(ins)}{ins.label} (R≈{ins.r})</option>)}
                    </select>
                  </label>
                </div>
                <p className="systemNote">{SUBFLOOR_TYPES[subfloorKey]?.note} {isSlab ? 'Your slab foundation is its own deck.' : `Your ${utilitiesOf(spec).foundationType} foundation raises the floor, so it needs a deck`}{isSlab ? '' : ` — ${fmtMoney(derived.subfloorCost)} over ${fmtNum(derived.floor)} sf`}. Change the foundation on the Foundation page and this follows.</p>

                <div className="sectionHead">Finished floor</div>
                <div className="controlGrid">
                  <label>Floor type
                    <select value={flooringKey} onChange={(event) => updateFlooring(event.target.value)}>
                      {Object.entries(FLOORING_TYPES).map(([key, f]) => <option key={key} value={key} style={greenOptStyle(f)}>{greenLeaf(f)}{f.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="systemNote">{FLOORING_TYPES[flooringKey]?.note} Covers the whole {fmtNum(derived.heatedFloor)} sf heated floor. Floor assembly (deck + finish): {fmtMoney(derived.cost.flooring)}. A single room can differ — set its floor by tapping it (its floor shows in the schedule).</p>
                <label className="diyToggle">
                  <input type="checkbox" checked={reclaimed.flooring} onChange={(event) => updateReclaimed('flooring', event.target.checked)} />
                  <span>The flooring is reclaimed / salvaged (reclaimed boards or tile — cuts cost and carbon)</span>
                </label>
              </div>
            );
          })()}

          {systemView === 'windows' && (
            <div className="systemPage">
              <div className="sectionHead">All windows</div>
              <div className="controlGrid">
                <label>Glazing quality
                  <select value={utilitiesOf(spec).windowQuality} onChange={(event) => updateUtility('windowQuality', event.target.value)}>
                    <option value="double">Standard double pane — good value</option>
                    <option value="triple">Triple pane / low-e — half the heat loss, pricier</option>
                  </select>
                </label>
              </div>
              <div className="sectionHead">Every opening</div>
              {spec.openings.length === 0 && <p className="systemNote">No windows or doors yet — add one below, or tell the assistant "add a south window 5 ft wide near the kitchen".</p>}
              {spec.openings.length > 0 && <p className="systemNote">Tap an opening — here or in the model — to edit its wall, type, width, and position in the Inspector below.</p>}
              <div className="pickList">
                {spec.openings.map((opening, index) => (
                  <div className={`pickRow${selectedRoom === `opening-${index}` ? ' active' : ''}`} key={`${opening.label || opening.type}-${index}`}>
                    <button type="button" className="pickRowMain" onClick={() => selectObject(`opening-${index}`)}>
                      <strong>{opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)}`}</strong>
                      <small>{titleCase(opening.wall)} · {(OPENING_TYPES[opening.type] || OPENING_TYPES.window).label} · {opening.widthFt}′ wide</small>
                    </button>
                    <button className="ghost pickRowRemove" title="Remove opening" onClick={() => removeOpening(index)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
              <div className="addOpeningBar">
                <label>Add to wall
                  <select value={windowAddWall} onChange={(event) => setWindowAddWall(event.target.value)}>
                    <option value="north">North</option>
                    <option value="south">South</option>
                    <option value="east">East</option>
                    <option value="west">West</option>
                    <option value="roof">Roof (skylight)</option>
                  </select>
                </label>
                <div className="buttonRow openingTypeRow">
                  {Object.entries(OPENING_TYPES).map(([key, profile]) => {
                    const roofOnly = Boolean(profile.roof);
                    const wall = windowAddWall === 'roof' ? 'roof' : (roofOnly ? 'roof' : windowAddWall);
                    return (
                      <button
                        key={key}
                        className="secondary"
                        title={roofOnly ? 'Skylights sit on the roof plane' : `Add a ${profile.label.toLowerCase()} to the ${windowAddWall} wall`}
                        onClick={() => addOpeningOnWall(wall, key)}
                      ><Plus size={15} /> {profile.label}</button>
                    );
                  })}
                </div>
              </div>
              <p className="systemNote">Pick a wall, then a type. Glazed doors (french, sliders) and bay windows count toward your south solar glass; clerestories sit high for daylight and summer venting; skylights always land on the roof (place them with the two plan coordinates).</p>
            </div>
          )}

          {systemView === 'outdoors' && (
            <div className="systemPage">
              <div className="sectionHead">The rest of the homestead</div>
              <div className="outdoorGrid">
                {OUTDOOR_ITEMS.map((item) => {
                  const on = outdoorItemPresent(spec, item);
                  return (
                    <button key={item.key} className={on ? 'outdoorItem on' : 'outdoorItem'} onClick={() => toggleOutdoorItem(item)}>
                      <b>{item.name}</b>
                      <small>{item.note}</small>
                      <span className="outdoorCost">${item.cost.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
              <p className="systemNote">Toggling an item places it on the site next to the house — drag it where it belongs in the model. Each adds its cost to the build.</p>
            </div>
          )}

          {systemView === 'water' && (
            <div className="systemPage">
              <div className="sectionHead">Where water comes from</div>
              <div className="controlGrid">
                <label>Source
                  <select value={utilitiesOf(spec).waterSource} onChange={(event) => updateUtility('waterSource', event.target.value)}>
                    <option value="well">Drilled well — reliable, needs a pump</option>
                    <option value="spring">Spring — cheap if the land has one</option>
                    <option value="catchment" style={greenOptStyle({ green: true })}>🌿 Rain catchment — roof + rain</option>
                    <option value="town">Town main — simplest</option>
                  </select>
                </label>
                <label>Storage tank (gal)<input type="number" min="0" max="50000" step="100" value={utilitiesOf(spec).tankGal} onChange={(event) => updateUtility('tankGal', event.target.value)} /></label>
              </div>
              <p className="systemNote">A well adds a pump to your power load. Catchment leans on the roof area and your site's rainfall — the readouts below show whether it covers the household.</p>
            </div>
          )}

          {systemView === 'waste' && (
            <div className="systemPage">
              <div className="sectionHead">Where used water goes</div>
              <div className="controlGrid">
                <label>Method
                  <select value={utilitiesOf(spec).wasteMethod} onChange={(event) => updateUtility('wasteMethod', event.target.value)}>
                    <option value="septic">Septic + leach field — conventional</option>
                    <option value="composting" style={greenOptStyle({ green: true })}>🌿 Composting toilet + greywater</option>
                    <option value="reedbed">Reed bed / constructed wetland</option>
                  </select>
                </label>
                {utilitiesOf(spec).wasteMethod === 'septic' && (
                  <label>Well → septic distance (ft)<input type="number" min="0" max="2000" step="5" value={utilitiesOf(spec).wellSepticFt} onChange={(event) => updateUtility('wellSepticFt', event.target.value)} /></label>
                )}
              </div>
              <p className="systemNote">A septic field must sit at least 100 ft from a well, and bedrooms size the field. Composting sidesteps most of that.</p>
            </div>
          )}

          {systemView === 'power' && (
            <div className="systemPage">
              <div className="sectionHead">Where electricity comes from</div>
              <div className="controlGrid">
                <label>Mode
                  <select value={utilitiesOf(spec).powerMode} onChange={(event) => updateUtility('powerMode', event.target.value)}>
                    <option value="offgrid">Off-grid — panels + battery, independent</option>
                    <option value="hybrid">Grid + solar — panels, grid as backup</option>
                    <option value="gridtie">Grid only — simplest, no battery</option>
                  </select>
                </label>
                <label>Panels <em className="pitchHint">{Number(utilitiesOf(spec).panelCount) > 0 ? 'manual' : `auto ≈ ${derived.panels}`}</em><input type="number" min="0" max="200" step="1" placeholder={`auto (${derived.panels})`} value={Number(utilitiesOf(spec).panelCount) || ''} onChange={(event) => updateUtility('panelCount', event.target.value || 0)} /></label>
                <label>Battery (kWh) <em className="pitchHint">{Number(utilitiesOf(spec).batteryOverrideKwh) > 0 ? 'manual' : `auto ≈ ${derived.batteryKwh}`}</em><input type="number" min="0" max="500" step="1" placeholder={`auto (${derived.batteryKwh})`} value={Number(utilitiesOf(spec).batteryOverrideKwh) || ''} onChange={(event) => updateUtility('batteryOverrideKwh', event.target.value || 0)} /></label>
              </div>
              <p className="systemNote">The well pump and an electric heater land here as loads; panels and battery are auto-sized against your roof and your site's sun — leave the fields blank for auto, or type a number to override. Roof holds ~{derived.panelRoom} panels.</p>
            </div>
          )}

          {systemView === 'heat' && (
            <div className="systemPage">
              <div className="sectionHead">How you stay warm</div>
              <div className="controlGrid">
                <label>Source
                  <select value={utilitiesOf(spec).heatSource} onChange={(event) => updateUtility('heatSource', event.target.value)}>
                    <option value="rocket_mass" style={greenOptStyle({ green: true })}>🌿 Rocket mass heater — wood, huge mass, very DIY</option>
                    <option value="masonry">Masonry heater — wood, slow steady radiant</option>
                    <option value="wood_stove">Wood stove — simple, familiar</option>
                    <option value="minisplit">Electric mini-split — no wood, draws power</option>
                  </select>
                </label>
              </div>
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyHeat} onChange={(event) => updateUtility('diyHeat', event.target.checked)} />
                <span>I'll build the heater myself (sweat equity)</span>
              </label>
              <p className="systemNote">Your walls, roof, and windows set the heat load below. A mini-split moves the burden onto Power; the wood options need a chimney and clearances.</p>
            </div>
          )}

          {systemView === 'roof' && (
            <div className="systemPage">
              <div className="sectionHead">Roof shape</div>
              <div className="controlGrid">
                <label>Style
                  <select value={spec.shell.roofType || 'gable'} onChange={(event) => updateShell('roofType', event.target.value)}>
                    <option value="gable">Gable</option>
                    <option value="shed">Shed</option>
                    <option value="flat">Flat</option>
                    <option value="hip">Hip</option>
                  </select>
                </label>
                <label>Pitch <em className="pitchHint">≈ {Math.round(Number(spec.shell.roofPitch || 0.32) * 12)}:12</em><input type="number" step="0.01" value={spec.shell.roofPitch} onChange={(event) => updateShell('roofPitch', event.target.value)} /></label>
                <label>Insulation <em className="pitchHint">R-{derived.roofR}</em>
                  <select value={resolveInsulation(utilitiesOf(spec).roofInsulation, 'cellulose')} onChange={(event) => updateUtility('roofInsulation', event.target.value)}>
                    {Object.entries(INSULATION_TYPES).map(([key, ins]) => <option key={key} value={key} style={greenOptStyle(ins)}>{greenLeaf(ins)}{ins.label} (R≈{ins.r})</option>)}
                  </select>
                </label>
              </div>
              {spec.shell.roofType === 'shed' && (() => {
                const sH = Number(spec.shell.southWallHeightFt || spec.shell.wallHeightFt || 10);
                const nH = Number(spec.shell.northWallHeightFt || spec.shell.wallHeightFt || 10);
                const highSide = Math.max(sH, nH);
                const fallNow = Math.round(Math.abs(sH - nH) * 2) / 2;
                const drainsNow = fallNow < 0.25 ? '' : (sH >= nH ? 'north' : 'south');
                const setShedFall = (drainTo, fallFt) => {
                  const hi = Math.max(7, highSide);
                  const lo = Math.max(2, hi - Math.max(0.5, Number(fallFt) || 2));
                  void applyBackendOperations({
                    operations: [{ type: 'set_roof_profile', roofType: 'shed', southWallHeightFt: drainTo === 'north' ? hi : lo, northWallHeightFt: drainTo === 'north' ? lo : hi }],
                    promptText: `Shed roof drains ${drainTo}`,
                    logPrefix: 'Roof',
                    chatText: `Set the shed to drain ${drainTo}: high wall ${hi}′ falling to ${lo}′.`
                  });
                };
                return (
                  <>
                    <div className="sectionHead">Which way the shed falls</div>
                    <div className="controlGrid">
                      <label>Drains to
                        <select value={drainsNow} onChange={(event) => setShedFall(event.target.value, Math.max(2, fallNow))}>
                          {drainsNow === '' && <option value="">Flat — pick a direction</option>}
                          <option value="north">North — high south wall (solar classic)</option>
                          <option value="south">South — high north wall</option>
                        </select>
                      </label>
                      <label>Fall, high eave to low (ft)<input type="number" step="0.5" min="0.5" max="12" value={fallNow} onChange={(event) => setShedFall(drainsNow || 'north', event.target.value)} /></label>
                    </div>
                    {drainsNow === '' && <p className="systemNote">Both eaves are level right now — this “shed” is flat and won't drain. Pick a direction (or set a fall) and the wall heights follow.</p>}
                  </>
                );
              })()}
              <div className="breakOpenRow">
                <div className="sectionHead">Overhang</div>
                <button className="breakOpen" onClick={() => setOverhangBreakOpen((open) => !open)}>
                  {overhangBreakOpen ? '▾ one value all around' : '▸ fine-tune per side (N/S/E/W)'}
                </button>
              </div>
              {!overhangBreakOpen ? (
                <div className="controlGrid">
                  <label>Overhang (ft)<input type="number" step="0.5" min="0" max="12" value={resolveOverhangs(spec.shell).split ? '' : resolveOverhangs(spec.shell).all} placeholder={resolveOverhangs(spec.shell).split ? 'mixed — break open' : undefined} onChange={(event) => updateOverhang('all', event.target.value)} /></label>
                </div>
              ) : (
                <div className="wallSideGrid">
                  {WALL_SIDES.map((side) => (
                    <label key={side} className="wallSideCell">
                      <span className="wallSideLabel">{WALL_SIDE_LABELS[side]}</span>
                      <input type="number" step="0.5" min="0" max="12" value={resolveOverhangs(spec.shell)[side]} onChange={(event) => updateOverhang(side, event.target.value)} />
                      <span className="wallSideUnit">ft</span>
                    </label>
                  ))}
                </div>
              )}
              <label className="diyToggle">
                <input type="checkbox" checked={utilitiesOf(spec).diyRoof} onChange={(event) => updateUtility('diyRoof', event.target.checked)} />
                <span>I'll frame the roof myself (sweat equity)</span>
              </label>
              <p className="systemNote">The overhang shields plastered natural walls (24" minimum) and shades summer sun without blocking winter rays — 2 to 3 ft is the sweet spot on the south. A different north vs south wall height on the Shell page makes a shed roof.</p>
            </div>
          )}

          {SYSTEM_META[systemView] && (() => {
            const meta = SYSTEM_META[systemView];
            const reads = meta.reads ? meta.reads(derived, spec) : [];
            return (
              <div className="systemFeedback">
                <div className="whyNote">{meta.why}</div>
                {reads.length > 0 && (
                  <>
                    <div className="sectionHead readsHead">What this comes to</div>
                    <div className="readsGrid">
                      {reads.map(([key, value, unit, note]) => (
                        <div className="readCell" key={key}>
                          <span className="readKey">{key}</span>
                          <strong className="readValue">{value} {unit && <small>{unit}</small>}</strong>
                          {note && <span className="readNote">{note}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {meta.feeds && meta.feeds.length > 0 && (
                  <div className="feedsRow">
                    <span className="systemNavEyebrow">Feeds</span>
                    {meta.feeds.map((tag) => <span className="feedTag" key={tag}>{tag}</span>)}
                  </div>
                )}
              </div>
            );
          })()}
          {/* The journey rail: every page ends with where you came from and
              where the build order goes next — a gentle hand through the
              whole design, ending at Review. */}
          {(() => {
            const order = SYSTEM_GROUPS.flatMap((group) => group.keys);
            const at = order.indexOf(systemView);
            const prev = order[at - 1];
            const next = order[at + 1];
            return (
              <div className="systemRail">
                {prev ? <button type="button" onClick={() => setSystemView(prev)}>← {SYSTEM_META[prev].label}</button> : <span />}
                {next
                  ? <button type="button" className="railNext" onClick={() => setSystemView(next)}>Next: {SYSTEM_META[next].label} →</button>
                  : <button type="button" className="railNext" onClick={() => setConsoleView('review')}>Review the design →</button>}
              </div>
            );
          })()}
        </section>}

        {appMode === 'design' && consoleView === 'os' && <section className="panelBlock consolePanel projectOS">
            <div className="blockTitle"><ClipboardCheck size={16} /> Project Plan</div>
            <div className="osStage">
              {workflowStages.map((stage) => (
                <span key={stage} className={stage === projectBrain.stage ? 'active' : ''}>{stage}</span>
              ))}
            </div>
            <div className="osBlock">
              <b>Master Brief</b>
              <p>{projectBrain.masterDesignBrief.summary}</p>
            </div>
            <div className="osGrid">
              <div className="osBlock">
                <b>Requirements</b>
                {(projectBrain.requirements || []).slice(0, 4).map((item) => <p key={item.id}>{item.text}</p>)}
              </div>
              <div className="osBlock">
                <b>Open Questions</b>
                {(projectBrain.openQuestions || []).filter((item) => item.status !== 'closed').slice(0, 4).map((item) => <p key={item.id}>{item.text}</p>)}
              </div>
              <div className="osBlock">
                <b>Task Queue</b>
                {(projectBrain.taskQueue || []).slice(0, 5).map((item) => <p key={item.id}><span>{item.priority}</span> {item.title}</p>)}
              </div>
              <div className="osBlock">
                <b>Recent Decisions</b>
                {(projectBrain.decisions || []).slice(0, 5).map((item) => <p key={item.id}>{item.text}</p>)}
              </div>
            </div>
            <details className="contextPacket">
              <summary>Context Packet Preview</summary>
              <pre>{JSON.stringify(contextPacket, null, 2)}</pre>
            </details>
        </section>}

        {appMode === 'design' && consoleView === 'costs' && (() => {
          const rows = COST_ROWS
            .map((row) => ({ ...row, amount: derived.cost[row.key] || 0 }))
            .filter((row) => row.amount > 0)
            .sort((a, b) => b.amount - a.amount);
          const subtotal = derived.totalBeforeSweat;
          const maxAmount = rows.length ? rows[0].amount : 1;
          const perSf = derived.heatedFloor > 0 ? derived.total / derived.heatedFloor : 0;
          const overBy = derived.total - 324700;
          const diyTrades = [
            { field: 'diyWalls', label: 'Walls', costKey: 'walls', frac: 0.8 },
            { field: 'diyRoof', label: 'Roof', costKey: 'roof', frac: 0.55 },
            { field: 'diyHeat', label: 'Heat', costKey: 'heat', frac: 0.45 },
            { field: 'diyFoundation', label: 'Foundation', costKey: 'foundation', frac: 0.5 }
          ];
          const toggleDiy = (field) => void applyBackendOperations({
            operations: [{ type: 'set_utility', field, value: !derived.utilities[field] }],
            promptText: `${derived.utilities[field] ? 'Hire out' : 'Self-build'} the ${field.replace('diy', '').toLowerCase()}`,
            logPrefix: 'Sweat equity'
          });
          return (
            <section className="panelBlock consolePanel costPanel">
              <div className="blockTitle"><Coins size={16} /> Cost breakdown</div>
              <p className="studioHint">Every system's directional cost, biggest first. Tap a row to open that system's controls. Early-design estimates — order from your own counts.</p>
              <div className="costHead">
                <div><strong>{fmtMoney(derived.total)}</strong><span>after sweat equity</span></div>
                <div><strong>{perSf > 0 ? fmtMoney(perSf) : '—'}</strong><span>per heated sf</span></div>
                <div><strong>{(derived.carbonKg / 1000).toFixed(1)} t</strong><span>embodied CO₂e</span></div>
              </div>
              <div className="costRows">
                {rows.map((row) => (
                  <button type="button" className="costRow" key={row.key} onClick={() => { setConsoleView('systems'); setSystemView(row.system); }}>
                    <span className="costRowLabel">{row.label}</span>
                    <span className="costBar"><span className="costBarFill" style={{ width: `${Math.max(3, (row.amount / maxAmount) * 100)}%` }} /></span>
                    <span className="costRowAmt">{fmtMoney(row.amount)}</span>
                    <span className="costRowPct">{subtotal > 0 ? Math.round((row.amount / subtotal) * 100) : 0}%</span>
                  </button>
                ))}
              </div>
              <div className="costTotals">
                <div className="costTotalRow"><span>Subtotal</span><b>{fmtMoney(subtotal)}</b></div>
                {derived.sweat > 0 && <div className="costTotalRow save"><span>Sweat equity</span><b>−{fmtMoney(derived.sweat)}</b></div>}
                <div className="costTotalRow net"><span>Estimated total</span><b>{fmtMoney(derived.total)}</b></div>
              </div>
              {(() => {
                // THIS design, built the other way — same rooms, same footprint,
                // same site services; only the construction systems swap.
                const currentApproach = spec.shell.designApproach === 'standard' ? 'standard' : 'natural';
                const otherApproach = currentApproach === 'standard' ? 'natural' : 'standard';
                const altSpec = convertSpecApproach(spec, otherApproach);
                const alt = deriveDesign(altSpec, getWallSections(altSpec));
                const label = otherApproach === 'standard' ? 'standard construction' : 'natural building';
                const dCost = alt.total - derived.total;
                const dCarbon = (alt.carbonKg - derived.carbonKg) / 1000;
                const dHeat = alt.heatLoadKbtu - derived.heatLoadKbtu;
                const fmtDelta = (v, unit, digits = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}`;
                return (
                  <>
                    <div className="sectionHead">Built the other way</div>
                    <p className="systemNote">The same house — rooms, footprint, site services untouched — built as <b>{label}</b> (walls, frame, foundation, floor, insulation, and heat swapped):</p>
                    <div className="compareGrid">
                      <div className="compareCell">
                        <span>Cost</span>
                        <b>{fmtMoney(alt.total)}</b>
                        <small className={dCost > 0 ? 'worse' : 'better'}>{dCost >= 0 ? '+' : '−'}{fmtMoney(Math.abs(dCost))}</small>
                      </div>
                      <div className="compareCell">
                        <span>Embodied CO₂e</span>
                        <b>{(alt.carbonKg / 1000).toFixed(1)} t</b>
                        <small className={dCarbon > 0 ? 'worse' : 'better'}>{fmtDelta(dCarbon, ' t', 1)}</small>
                      </div>
                      <div className="compareCell">
                        <span>Heat load</span>
                        <b>{Math.round(alt.heatLoadKbtu)} kBTU/h</b>
                        <small className={dHeat > 0 ? 'worse' : 'better'}>{fmtDelta(dHeat, '', 0)}</small>
                      </div>
                      <div className="compareCell">
                        <span>Avg wall R</span>
                        <b>R-{Math.round(alt.wallR)}</b>
                        <small className={alt.wallR < derived.wallR ? 'worse' : 'better'}>{fmtDelta(alt.wallR - derived.wallR, '', 0)}</small>
                      </div>
                    </div>
                    <p className="systemNote compareFine">Directional early-design numbers, both ways. Deltas read {label} minus your current {currentApproach === 'standard' ? 'standard' : 'natural'} design. The Shell page switch changes the checks and the assistant's bias — it never rebuilds your walls; ask the assistant when you want the actual systems changed.</p>
                  </>
                );
              })()}
              <div className="sectionHead">Do it yourself</div>
              <p className="systemNote">Each trade you take on drops the cash cost by its labor share. Toggle what you'll build.</p>
              <div className="diyGrid">
                {diyTrades.map((trade) => {
                  const on = Boolean(derived.utilities[trade.field]);
                  const saves = (derived.cost[trade.costKey] || 0) * trade.frac;
                  return (
                    <label key={trade.field} className={on ? 'diyToggle on' : 'diyToggle'}>
                      <input type="checkbox" checked={on} onChange={() => toggleDiy(trade.field)} />
                      <span>{trade.label}</span>
                      <small>{on ? `saving ${fmtMoney(saves)}` : `save ~${fmtMoney(saves)}`}</small>
                    </label>
                  );
                })}
              </div>
              {derived.reclaimedSavings.count > 0 && (
                <p className="systemNote">♺ Reclaimed materials are already saving about {fmtMoney(derived.reclaimedSavings.cost)} and {(derived.reclaimedSavings.carbon / 1000).toFixed(1)} t CO₂e — mark more on the Frame page.</p>
              )}
              <div className={overBy > 0 ? 'costCeiling over' : 'costCeiling under'}>
                {overBy > 0
                  ? `${fmtMoney(overBy)} over the $324,700 owner-builder loan ceiling — trim the footprint, simplify systems, or take on more sweat equity.`
                  : `${fmtMoney(-overBy)} under the $324,700 owner-builder loan ceiling.`}
              </div>
            </section>
          );
        })()}

        {appMode === 'design' && consoleView === 'review' && <section className="panelBlock consolePanel reviewHub">
            <div className="blockTitle"><ShieldCheck size={16} /> Does it add up</div>
            {(() => {
              const openFlags = issues.filter((item) => item.severity !== 'pass');
              const critical = openFlags.filter((item) => item.severity === 'critical').length;
              const state = openFlags.length === 0 ? 'ok' : critical > 0 ? 'bad' : 'warn';
              return (
                <div className={`checksSummary ${state}`}>
                  <strong>{openFlags.length === 0 ? 'Everything checks out' : `${openFlags.length} thing${openFlags.length === 1 ? '' : 's'} to fix`}</strong>
                  <span>{openFlags.length === 0 ? 'The design passes every check the council runs.' : critical > 0 ? 'At least one check must be fixed before drawings.' : 'Worth fixing, but nothing is blocking yet.'}</span>
                </div>
              );
            })()}
            <div className="issues">
              {issues.map((issue, index) => (
                <div key={`${issue.title}-${index}`} className={`issue ${issue.severity}`}>
                  {issue.severity === 'pass' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <div>
                    <b>{issue.title}</b>
                    <span>{issue.fix}</span>
                    <div className="issueActions">
                      {issue.system && issue.severity !== 'pass' && (
                        <button type="button" className="issueJump" onClick={() => { setConsoleView('systems'); setSystemView(issue.system); }}>Go to {SYSTEM_META[issue.system]?.label || issue.system}</button>
                      )}
                      {issue.fixId && FIX_LABELS[issue.fixId] && (
                        <button type="button" className="issueFix" onClick={() => fixIssue(issue)}><Wrench size={13} /> {FIX_LABELS[issue.fixId]}</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="sectionHead councilHead">Ask a professional</div>
            <div className="council">
              {council.map((expert) => {
                const Icon = expert.icon;
                return (
                  <button key={expert.id} className={`expert ${expert.status}`} onClick={() => chooseChatTarget(expert.id)} title="Aim the chat at this expert, then ask in Studio">
                    <Icon size={17} />
                    <div><b>{expert.name}</b><span>{expert.notes}</span></div>
                  </button>
                );
              })}
            </div>
        </section>}

        {appMode === 'design' && consoleView === 'audit' && <section className="panelBlock consolePanel">
            <div className="blockTitle"><FileJson size={16} /> Change History</div>
            <div className="auditList">
              {operationAudit.length === 0 && <p className="studioHint">No structured operations recorded yet.</p>}
              {operationAudit.map((item) => (
                <article className="auditItem" key={item.id}>
                  <b>{item.prompt}</b>
                  <span>{item.source} · Rev {item.beforeRevision} → {item.afterRevision}</span>
                  {item.changedIds.length > 0 && <small>Changed: {item.changedIds.join(', ')}</small>}
                  {item.operations.length > 0 && <ul>{item.operations.slice(0, 6).map((operation, index) => <li key={`${item.id}-${index}`}>{operation}</li>)}</ul>}
                  {item.warnings.length > 0 && <small>Warnings: {item.warnings.join(' | ')}</small>}
                </article>
              ))}
            </div>
            {revisionLog.length > 0 && (
              <>
                <div className="sectionHead councilHead">Revision log</div>
                <div className="log">
                  {revisionLog.slice(0, 20).map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
                </div>
              </>
            )}
        </section>}
        </div>

        {/* The Inspector — the single per-object editor — is PINNED here at
            the bottom of the left column, always in view when something is
            selected. Fine grain is one glance away, never a scroll away. */}
        {appMode === 'design' && consoleView === 'systems' && <div className={`inspectorDock${inspectorOpen ? '' : ' collapsed'}`} ref={setInspectorDock} />}
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div className="projectIdentity">
            <label>
              <span>Design Name</span>
              <input
                value={nameDraft ?? spec.projectName}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitProjectName}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              />
            </label>
            <p>Revision {spec.revision} · {spec.shell.widthFt}' x {spec.shell.depthFt}' · Blender/IFC export ready</p>
            {savedAt && <p className="saveStatus">Saved in app: {savedAt}</p>}
          </div>
          <div className="exportActions">
            <button className="ghost" title="Start a new design" onClick={() => setWelcomeOpen(true)}><Plus size={16} /> New</button>
            <button className="ghost backButton" onClick={goBackRevision} disabled={history.length === 0}><Undo2 size={16} /> Undo</button>
            <button className="ghost saveButton" onClick={saveHouseState}><Save size={16} /> Save</button>
            <button className="ghost chatToggle" title={chatOpen ? 'Hide the Studio chat — the model gets the room' : 'Show the Studio chat'} onClick={() => setChatOpen((open) => !open)}><Send size={16} /> {chatOpen ? 'Hide chat' : 'Chat'}{!chatOpen && chatUnread > 0 && <span className="chatUnread">{chatUnread > 9 ? '9+' : chatUnread}</span>}</button>
            <div className="exportMenu">
              <button className="ghost" onClick={() => setExportMenuOpen((open) => !open)} title="Export the design"><Download size={16} /> Export ▾</button>
              {exportMenuOpen && (
                <div className="exportMenuPop" onMouseLeave={() => setExportMenuOpen(false)}>
                  <button onClick={() => { setExportMenuOpen(false); exportSheetSet(); }}><FileText size={15} /> Permit set (SVG sheets)</button>
                  <button title="Elevation views of the frame — posts, beams, braces, rafters — with dimensions, callouts, and a member schedule" onClick={() => { setExportMenuOpen(false); exportFrameDrawings(); }}><Ruler size={15} /> Frame drawings (SVG sheets)</button>
                  <button title="Push this design to Blender and write a validated IFC4 file" onClick={async () => { setExportMenuOpen(false); try { const r = await exportIfcViaBlender(spec); window.alert(r && r.ok ? ('IFC written: ' + r.path + ' (' + r.count + ' elements). Open it in any BIM viewer.') : ('IFC export failed: ' + ((r && r.error) || 'unknown'))); } catch (e) { window.alert('Blender backend not reachable. Start Blender 5.1 with the Dashboard add-on, then retry. (' + e.message + ')'); } }}><Box size={15} /> IFC file (Blender)</button>
                  <button title="Rebuild this design in the Blender backend (starts a headless Blender automatically if needed)" onClick={async () => { setExportMenuOpen(false); try { await pushToBlender(spec); window.alert('Synced to Blender: the model is rebuilding in the Natural Building GC backend.'); } catch (e) { window.alert('Blender sync failed: ' + e.message + ' (First start can take up to a minute — try once more.)'); } }}><RefreshCcw size={15} /> Sync to Blender</button>
                  <button onClick={() => { setExportMenuOpen(false); exportBrief(); }}><Download size={15} /> Brief (coordination summary)</button>
                  <button onClick={() => { setExportMenuOpen(false); exportJson(); }}><FileJson size={15} /> BIM JSON (model data)</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="modelShell">
          {/* Real toolbar ABOVE the view — the rev chip, view switch, floor
              tabs, Layers and compass used to float over the model and hid
              plan content underneath. Only transient things still float. */}
          <div className="modelBar">
            <div className="viewModeToggle">
              <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')}>3D</button>
              <button className={viewMode === 'plan' ? 'active' : ''} onClick={() => setViewMode('plan')}>Plan</button>
              <button className={viewMode === 'detail' ? 'active' : ''} title="Connection details — how the selected part is built" onClick={() => setViewMode('detail')}>Detail</button>
            </div>
            {viewMode !== 'detail' && (viewMode !== '3d' || webglOK) && (viewMode === 'plan' || floorCount(spec) > 1 || basementInfo(spec.shell).present) && <div className="floorTabs">
              {[...(basementInfo(spec.shell).present ? [BASEMENT_LEVEL] : []), ...Array.from({ length: floorCount(spec) }, (_, i) => i + 1)].map((floor) => (
                <button key={floor} className={activeFloor === floor ? 'active' : ''} onClick={() => setActiveFloor(floor)} title={`${floorLabel(spec, floor)} — view & edit this floor`}>{floor === 1 ? 'Ground' : floorLabel(spec, floor).replace(' floor', '')}</button>
              ))}
              {floorCount(spec) < 3 && <button className="addFloor" onClick={addStorey} title="Add a storey">+ Floor</button>}
            </div>}
            {/* keyed on the revision ONLY — re-pulsing on every selection made
                the calmest corner of the bar twitch constantly */}
            <div className="changeBadge" key={spec.revision} title={`Rev ${spec.revision}: ${lastModelChange}`}><Sparkles size={14} /> Rev {spec.revision}: {lastModelChange}</div>
            {viewMode === '3d' && webglOK && <button className={`layersToggle${layersOpen ? ' open' : ''}${hiddenLayerCount > 0 || modelLayers.xray ? ' filtered' : ''}`} onClick={() => setLayersOpen((open) => !open)} title="Show / hide model layers">
              <Layers size={14} /> Layers{hiddenLayerCount > 0 ? ` · ${hiddenLayerCount} off` : modelLayers.xray ? ' · x-ray' : ''}
            </button>}
            {viewMode === '3d' && webglOK && <div className="northBadge" title="North">N</div>}
          </div>
          <div className="modelStage">
          {viewMode === 'detail' ? (() => {
            // Connection details live in the preview — the drawing gets the big
            // canvas, and picking another part redraws it in place.
            const detailKind = selectedIsWall ? 'wall'
              : selectedIsRoof ? 'roof'
              : (selectedIsOpening && selected?.wall !== 'roof') ? 'opening'
              : null;
            return (
              <div className="detailStage">
                {detailKind ? (
                  <>
                    <div className="detailTitle">
                      {detailKind === 'wall' ? `${selected?.name} — connection at the foundation`
                        : detailKind === 'roof' ? 'Eave — where the roof meets the wall'
                        : `${selected?.name || 'Opening'} — how it sits in its wall`}
                    </div>
                    <JointDetail
                      spec={spec}
                      derived={derived}
                      kind={detailKind}
                      side={selectedIsWall ? selected?.side : 'south'}
                      opening={selectedIsOpening ? selected : null}
                    />
                    <p className="detailHint">Drawn from the live design — edit the fields in the left bar and the joint redraws. Pick another wall, the roof, or an opening (the chip above lists them all).</p>
                  </>
                ) : (
                  <div className="detailEmpty">Select a wall, the roof, or a window/door — its connection detail draws here at full size.</div>
                )}
              </div>
            );
          })() : viewMode === 'plan' ? (
            <PlanView
              spec={spec}
              selectedRoom={selectedRoom}
              onSelect={selectObject}
              onMove={planMoveObject}
              onResize={planResizeObject}
              onResizeShell={resizeShellPlan}
              onMoveEdge={planMoveEdge}
              onMoveOpening={planMoveOpening}
              context={consoleView === 'systems' ? systemView : null}
              activeFloor={activeFloor}
            />
          ) : (
            <ThreeScene
              spec={spec}
              selectedRoom={selectedRoom}
              layers={modelLayers}
              viewRequest={viewRequest}
              sectionCut={sectionCut}
              onSelectRoom={selectObject}
              onMoveStart={beginPlanMove}
              onMoveEnd={finishPlanMove}
              onResizeEnd={finishPlanResize}
              onDimensionPreview={setDimensionPreview}
              onFallbackNav={setViewMode}
            />
          )}
          {viewMode === '3d' && webglOK && (
            <div className="viewGizmo">
              {[['iso', 'Iso'], ['top', 'Top'], ['front', 'Front'], ['side', 'Side']].map(([mode, label]) => (
                <button key={mode} title={`Look at the model from the ${mode === 'iso' ? 'corner' : mode}`} onClick={() => setViewRequest({ mode, n: Date.now() })}>{label}</button>
              ))}
              <label className="cutSlider" title="Slice the model open — slide to cut away the south side">
                <span>Slice</span>
                <input type="range" min="8" max="100" value={Math.round(sectionCut * 100)} onChange={(event) => setSectionCut(Number(event.target.value) / 100)} />
              </label>
            </div>
          )}
          {(hiddenLayerCount > 0 || modelLayers.xray) && (
            <div className="viewFilterBadge">
              <span>
                {hiddenLayerCount > 0 ? `Partial view — ${hiddenLayerCount} group${hiddenLayerCount === 1 ? '' : 's'} hidden` : 'X-ray view'}
                {hiddenLayerCount > 0 && modelLayers.xray ? ' · x-ray' : ''}. Costs and checks still cover the whole design.
              </span>
              <button onClick={() => setModelLayers({ ...LAYER_PRESETS.all })}>Show all</button>
            </div>
          )}
          {layersOpen && (() => {
            const set = (patch) => setModelLayers((current) => ({ ...current, ...patch }));
            const check = (key, label) => (
              <label className="layerCheck" key={key}>
                <input type="checkbox" checked={Boolean(modelLayers[key])} onChange={(event) => set({ [key]: event.target.checked })} />
                <span>{label}</span>
              </label>
            );
            const presentCats = [...new Set((spec.elements || []).map((element) => element.category || 'custom'))];
            const hiddenCats = modelLayers.hiddenCats || [];
            return (
              <div className="layersPanel">
                <div className="layersPresets">
                  {Object.entries({ all: 'All', structure: 'Structure', frame: 'Frame', plan: 'Plan', interior: 'Interior', site: 'Site' }).map(([key, label]) => (
                    <button key={key} onClick={() => setModelLayers({ ...LAYER_PRESETS[key] })}>{label}</button>
                  ))}
                </div>
                <div className="layersGroup"><span className="layersEyebrow">Building</span>
                  {check('wallNorth', 'North wall')}
                  {check('wallSouth', 'South wall')}
                  {check('wallEast', 'East wall')}
                  {check('wallWest', 'West wall')}
                  {check('roof', 'Roof')}
                  {storeyInfo(spec.shell).storeys > 1 && check('upperFloors', 'Upper floors')}
                  {check('openings', 'Windows & doors')}
                  {check('rooms', 'Rooms')}
                </div>
                <div className="layersGroup"><span className="layersEyebrow">Site</span>
                  {check('pad', 'Site pad')}
                  {check('ground', 'Ground & grid')}
                  {check('elements', 'Elements')}
                  {modelLayers.elements && presentCats.map((cat) => (
                    <label className="layerCheck sub" key={`cat-${cat}`}>
                      <input type="checkbox" checked={!hiddenCats.includes(cat)} onChange={(event) => set({ hiddenCats: event.target.checked ? hiddenCats.filter((item) => item !== cat) : [...hiddenCats, cat] })} />
                      <span>{titleCase(cat)}</span>
                    </label>
                  ))}
                </div>
                <div className="layersGroup"><span className="layersEyebrow">Display</span>
                  {check('labels', 'Labels')}
                  {check('xray', 'X-ray walls & roof')}
                  {check('explode', 'Exploded view — pull the systems apart')}
                </div>
              </div>
            );
          })()}
          {viewMode === '3d' && webglOK && <div className="viewBadge"><Camera size={15} /> drag rooms, drag corner handles to resize</div>}
          {backendDown && (
            <div className="offlineBanner">
              <strong>The design engine has stopped — edits aren’t saving.</strong>
              <span>Double-click start.bat in the app folder (Start Mac.command on a Mac). This notice disappears by itself once it’s back.</span>
            </div>
          )}
          {viewMode === '3d' && dimensionPreview && (
            <div className="dimensionBadge">
              <Ruler size={15} />
              <span>{dimensionPreview.mode === 'resize' ? 'Resizing' : 'Moving'} · {dimensionPreview.w}' x {dimensionPreview.d}' · X {dimensionPreview.x}' Y {dimensionPreview.y}'</span>
            </div>
          )}
          {/* The selector moved into the left panel (BIM Inspector header) —
              the model stays a pure tap-to-select surface. */}
          </div>
        </div>

        {inspectorDock && createPortal(<div className="lowerDeck">
          <section className="bimEditor">
            <div className="bimEditorHead">
              <div className="bimEditorHeadRow">
                <div className="sectionHead"><Grid3X3 size={17} /> BIM Inspector
                  <button type="button" className="dockCollapse" title={inspectorOpen ? 'Tuck the editor away' : 'Open the editor'} onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? '▾ hide' : '▴ edit'}</button>
                </div>
                {inspectorOpen && <nav className="inspectorTabs" aria-label="BIM inspector">
                  <button className={inspectorView === 'inspect' ? 'active' : ''} onClick={() => setInspectorView('inspect')}>Selected</button>
                  <button className={inspectorView === 'schedule' ? 'active' : ''} onClick={() => setInspectorView('schedule')}>Schedule</button>
                  <button className={inspectorView === 'assemblies' ? 'active' : ''} onClick={() => setInspectorView('assemblies')}>Library</button>
                </nav>}
              </div>
              {(() => {
                // The SELECTOR lives here in the left panel (Daniel's ask):
                // the summary is a button; tapping it lists every selectable
                // object — including ones hard to click in the model (far
                // walls, upper bands). The model itself stays tap-to-select.
                const kind = selectedIsWall ? 'Wall'
                  : selectedIsOpening ? ((OPENING_TYPES[selected?.type] || OPENING_TYPES.window).label)
                  : selectedIsRoof ? 'Roof'
                  : selectedIsPad ? 'Site pad'
                  : selectedIsGrid ? 'Reference grid'
                  : selectedIsElement ? titleCase(selected?.category || 'element')
                  : 'Room';
                const detail = selectedIsWall ? `${selected?.lengthFt || 0}′ long`
                  : selectedIsOpening ? `${selected?.widthFt || selected?.w || 0}′ wide · ${titleCase(selected?.wall || '')}`
                  : (selectedIsRoof || selectedIsGrid) ? ''
                  : `${selected?.w || 0}′ × ${selected?.d || 0}′ · ${Math.round((selected?.w || 0) * (selected?.d || 0))} sf`;
                return (
                  <div className="selChipWrap inDock">
                    <button type="button" className={`selChip${selMenuOpen ? ' open' : ''}`} title="What's selected — tap to pick anything" onClick={() => setSelMenuOpen((open) => !open)}>
                      <span className="selChipKind">{kind}</span>
                      <b>{selected?.name || '—'}</b>
                      {detail && <span className="selDetail">{detail}</span>}
                      <span className="selChipCaret">▾</span>
                    </button>
                    {selMenuOpen && (
                      <div className="selMenu" onMouseLeave={() => setSelMenuOpen(false)}>
                        {(() => {
                          // Organized BY STOREY (basement / ground / upper),
                          // then the building shell, then the site — so a
                          // 2nd-floor wall or room is found under its floor.
                          const floors = [...(basementInfo(spec.shell).present ? [BASEMENT_LEVEL] : []), ...Array.from({ length: floorCount(spec) }, (_, i) => i + 1)];
                          const siteCats = new Set(['outbuilding', 'site', 'landscape', 'garden', 'animal', 'earthwork']);
                          return [
                            ...floors.map((floor) => [
                              floor === 1 ? 'Ground floor' : floorLabel(spec, floor),
                              [
                                ...(spec.rooms || []).filter((room) => Number(room.level || 1) === floor).map((room) => ({ id: room.id, label: room.name, sub: `${room.w}×${room.d}′` })),
                                ...(spec.elements || []).filter((el) => el.category !== 'floor' && !siteCats.has(el.category) && Number(el.level || 1) === floor).map((el) => ({ id: el.id, label: el.name, sub: titleCase(el.category || '') })),
                                ...(floor > 1 ? (spec.elements || []).filter((el) => el.category === 'floor' && Number(el.level || 1) === floor).map((el) => ({ id: el.id, label: el.name || 'Storey extent', sub: `${el.w}×${el.d}′ — the storey's footprint` })) : []),
                                ...wallSections.filter((wall) => (wall.level || 1) === floor && (floor > 1 || false)).map((wall) => ({ id: wall.id, label: wall.name, sub: wall.assembly })),
                                ...(floor === 1 ? (spec.openings || []).map((opening, index) => ({ id: `opening-${index}`, label: opening.label || `${titleCase(opening.wall)} ${titleCase(opening.type)}`, sub: `${opening.widthFt}′ · ${titleCase(opening.wall)}` })) : [])
                              ]
                            ]),
                            ['The building', [
                              ...wallSections.filter((wall) => (wall.level || 1) === 1).map((wall) => ({ id: wall.id, label: wall.name, sub: wall.assembly })),
                              { id: 'roof-main', label: 'Roof', sub: spec.shell.roofType || 'gable' },
                              ...(resolveFrameType(spec, 1) !== 'load-bearing' ? [{ id: 'frame-main', label: 'Frame', sub: `${FRAME_TYPES[resolveFrameType(spec, 1)]?.label || ''} · ${Number(spec.frame?.baySpacingFt) || 8}′ bays` }] : [])
                            ]],
                            ['Site & outdoors', [
                              { id: 'site-pad', label: 'Site pad', sub: '' },
                              ...(spec.elements || []).filter((el) => siteCats.has(el.category)).map((el) => ({ id: el.id, label: el.name, sub: titleCase(el.category || '') }))
                            ]]
                          ];
                        })().filter(([, items]) => items.length > 0).map(([groupLabel, items]) => (
                          <div className="selMenuGroup" key={groupLabel}>
                            <span className="selMenuEyebrow">{groupLabel}</span>
                            {items.map((item) => (
                              <button type="button" key={item.id} className={selectedRoom === item.id ? 'active' : ''} onClick={() => { selectObject(item.id); setSelMenuOpen(false); }}>
                                <span>{item.label}</span>
                                {item.sub && <small>{item.sub}</small>}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {inspectorView === 'schedule' && (
              <div className="schedulePane fullPane">
                <div className="miniHead">BIM Space and Element Schedule</div>
                {systemFocus && <div className="scheduleFocus">Focus: {SYSTEM_LABELS[systemFocus] || systemFocus} — showing this system's items. Pick another system on the left, or leave the Systems tab to see everything.</div>}
                {(() => {
                  const rooms = spec.rooms.filter((room) => !systemFocus || systemOfRoom(room) === systemFocus);
                  const elements = (spec.elements || []).filter((element) => !systemFocus || systemOfElementCategory(element.category) === systemFocus);
                  const walls = (!systemFocus || systemFocus === 'walls' || systemFocus === 'shell') ? wallSections : [];
                  const specials = specialBimObjects.filter((object) => !systemFocus || systemOfSpecialCategory(object.category) === systemFocus);
                  // Systems whose reality is design state rather than placed
                  // objects (foundation, heat, water...) still ARE in the
                  // model — show them as derived fact cards, never a false
                  // "nothing here yet".
                  const factCards = (() => {
                    if (!systemFocus) return [];
                    const u = derived.utilities;
                    const money = (n) => `$${Math.round(n).toLocaleString()}`;
                    const perimeter = Math.round(2 * ((Number(spec.shell.widthFt) || 0) + (Number(spec.shell.depthFt) || 0)));
                    const names = {
                      foundation: { rubble: 'Rubble Trench Foundation', stemwall: 'Stem Wall Foundation', slab: 'Insulated Slab Foundation' },
                      heat: { rocket_mass: 'Rocket Mass Heater', masonry: 'Masonry Heater', wood_stove: 'Wood Stove', minisplit: 'Electric Mini-Split' },
                      water: { well: 'Drilled Well', spring: 'Spring Supply', catchment: 'Rain Catchment', town: 'Town Main' },
                      waste: { septic: 'Septic Tank + Leach Field', composting: 'Composting Toilet + Greywater', reedbed: 'Reed Bed Wetland' },
                      power: { offgrid: 'Off-Grid Solar + Battery', hybrid: 'Grid + Solar', gridtie: 'Grid Power' }
                    };
                    switch (systemFocus) {
                      case 'foundation': return [{ key: 'f', name: names.foundation[u.foundationType] || 'Foundation', meta: `${spec.shell.widthFt}' × ${spec.shell.depthFt}' footprint · ${perimeter} lf perimeter${u.foundationType === 'stemwall' ? ` · ${derived.stemwallHeightFt}' stem` : ''} · ${money(derived.cost.foundation)}` }];
                      case 'heat': return [{ key: 'h', name: names.heat[u.heatSource] || 'Heat Source', meta: `covers a ${derived.heatLoadKbtu.toFixed(1)} kBTU/hr design load · ${money(derived.cost.heat)}` }];
                      case 'water': return [{ key: 'w', name: names.water[u.waterSource] || 'Water Source', meta: `${Number.isFinite(derived.supplyGpd) ? `${Math.round(derived.supplyGpd)} gal/day supply` : 'unlimited supply'} vs ${Math.round(derived.waterGpd)} used${u.tankGal ? ` · ${Number(u.tankGal).toLocaleString()} gal tank` : ''} · ${money(derived.cost.water)}` }];
                      case 'waste': return [{ key: 'x', name: names.waste[u.wasteMethod] || 'Waste System', meta: `${Math.round(derived.septicGpd)} gal/day design flow${u.wasteMethod === 'septic' ? ` · ${u.wellSepticFt}' from the well` : ''} · ${money(derived.cost.waste)}` }];
                      case 'power': return [{ key: 'p', name: names.power[u.powerMode] || 'Power', meta: `${derived.loadKwhDay.toFixed(1)} kWh/day${derived.panels ? ` · ${derived.panels} panels` : ''}${derived.batteryKwh ? ` · ${derived.batteryKwh} kWh battery` : ''} · ${money(derived.cost.power)}` }];
                      case 'site': return [{ key: 's', name: derived.site.placeName || 'Site (no place set yet)', meta: `${derived.site.latitudeDeg}° latitude · ${derived.site.rainInYr}" rain/yr · ${derived.peakSunHrs.toFixed(1)} peak sun hrs/day` }];
                      case 'windows': return [{ key: 'g', name: derived.utilities.windowQuality === 'triple' ? 'Triple-Pane Glazing (whole house)' : 'Double-Pane Glazing (whole house)', meta: `${Math.round(derived.southGlass)} sf south glass · ${derived.glassPct.toFixed(1)}% of floor · ${money(derived.cost.windows)}` }];
                      default: return [];
                    }
                  })();
                  if (rooms.length + elements.length + walls.length + specials.length + factCards.length === 0) {
                    return <div className="scheduleEmpty">No {SYSTEM_LABELS[systemFocus] || 'matching'} items in the model yet. Tell the assistant what to add — it will appear here.</div>;
                  }
                  return (
                    <div className="roomTable">
                      {factCards.map((fact) => (
                        <div key={fact.key} className="roomRow systemFact">
                          <span>{fact.name}</span>
                          <small>{fact.meta}</small>
                        </div>
                      ))}
                      {rooms.map((room) => (
                        <button key={room.id} className={room.id === selectedRoom ? 'roomRow active' : 'roomRow'} onClick={() => setSelectedRoom(room.id)}>
                          <span>{room.name}</span>
                          <small>{Math.round(room.w * room.d)} sf · {room.type}</small>
                        </button>
                      ))}
                      {elements.map((element) => (
                        <button key={element.id} className={element.id === selectedRoom ? 'roomRow element active' : 'roomRow element'} onClick={() => setSelectedRoom(element.id)}>
                          <span>{element.name}</span>
                          <small>{Math.round(element.w * element.d)} sf · {element.category}</small>
                        </button>
                      ))}
                      {walls.map((wall) => (
                        <button key={wall.id} className={wall.id === selectedRoom ? 'roomRow wall active' : 'roomRow wall'} onClick={() => setSelectedRoom(wall.id)}>
                          <span>{wall.name}</span>
                          <small>{wall.lengthFt}' long · {wall.heightFt}' high · {wall.assembly}</small>
                        </button>
                      ))}
                      {specials.map((object) => (
                        <button key={object.id} className={object.id === selectedRoom ? 'roomRow special active' : 'roomRow special'} onClick={() => setSelectedRoom(object.id)}>
                          <span>{object.name}</span>
                          <small>{object.category} · {Math.round(object.w * object.d)} sf</small>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {inspectorView === 'inspect' && (
              <div className="editorPane fullPane">
                {selectedIsWall && <p className="elementNote">{selected?.note}</p>}
                {selectedIsElement && <p className="elementNote">{selected?.note}</p>}
                {selectedIsSpecial && <p className="elementNote">{selected?.note}</p>}
                {!selectedIsElement && !selectedIsWall && !selectedIsSpecial && <div className="modelEditHint"><Camera size={15} /> Drag the room body to move it. Drag green corner cubes in the model to resize; dimensions appear live.</div>}
                <div className={selectedIsWall ? 'liveEdit wallEdit' : 'liveEdit'}>
                  <label>Name<input value={selected?.name || ''} onChange={(event) => updateSelectedRoom('name', event.target.value)} /></label>
                  <label>{selectedIsWall ? 'Length' : 'Width'}<input type="number" value={selectedIsWall ? selected?.lengthFt || 0 : selected?.w || 0} disabled={selectedIsRoof || selectedIsGrid} title={selected?.edgeKey ? 'Length of this segment — its jog corners slide along the wall line.' : undefined} onChange={(event) => updateSelectedRoom('w', event.target.value)} /></label>
                  {selectedIsWall && selected?.edgeKey && (() => {
                    const edge = footprintEdges(spec)[Number(String(selected.edgeKey).replace(/^e/, ''))];
                    const startAt = edge ? Math.min(edge.horizontal ? edge.x0 : edge.y0, edge.horizontal ? edge.x1 : edge.y1) : 0;
                    return <label>Starts at (ft along wall)<input type="number" step="0.5" value={startAt} onChange={(event) => updateSelectedRoom('startFt', event.target.value)} /></label>;
                  })()}
                  <label>{selectedIsWall ? 'Thickness' : 'Depth'}<input type="number" step={selectedIsWall ? 0.05 : undefined} value={selectedIsWall ? selected?.thicknessFt ?? modeledWallProfile.thicknessFt : selected?.d || 0} disabled={selectedIsOpening || selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom(selectedIsWall ? 'thickness' : 'd', event.target.value)} /></label>
                  {selectedIsWall && <label>System
                    <select value={selected?.assemblyKey || 'framed'} onChange={(event) => updateSelectedRoom('assembly', event.target.value)}>
                      {Object.values(WALL_ASSEMBLIES).map((assembly) => (
                        <option key={assembly.key} value={assembly.key} style={greenOptStyle(assembly)}>{greenLeaf(assembly)}{assembly.label}</option>
                      ))}
                    </select>
                  </label>}
                  {selectedIsWall && <label>Interior finish<input type="text" value={selected?.interiorFinish || ''} onChange={(event) => updateSelectedRoom('interiorFinish', event.target.value)} /></label>}
                  {selectedIsWall && <label>Exterior cladding
                    <select value={resolveWallSide(spec, selected.side, selected.level || 1).cladding} onChange={(event) => updateSelectedRoom('cladding', event.target.value)}>
                      {Object.entries(CLADDING_TYPES).map(([key, c]) => <option key={key} value={key} style={greenOptStyle(c)}>{greenLeaf(c)}{c.label}{c.costPsf ? ` (+$${c.costPsf}/sf)` : ''}</option>)}
                    </select>
                  </label>}
                  {selectedIsWall && (selected?.level || 1) === 1 && (
                    <label>Move in/out (ft)
                      <span className="wallMoveRow">
                        <input type="number" step="0.5" value={wallMoveFt} onChange={(event) => setWallMoveFt(Number(event.target.value))} />
                        <button type="button" className="secondary" title="Negative pulls the wall inward" onClick={() => moveSelectedWall(wallMoveFt)}>Move</button>
                        <button type="button" className="secondary" title="Split this wall into three segments, then move the middle to shape an L or a notch" onClick={splitSelectedWall}>Split into 3</button>
                      </span>
                    </label>
                  )}
                  {selectedIsWall && (selected?.level || 1) === 1 && !selected?.edgeKey && (() => {
                    const rW = resolveWallSide(spec, selected.side);
                    return (
                      <label>Sun glazing above (greenhouse face)
                        <span className="wallMoveRow">
                          <input type="checkbox" checked={rW.sunGlazing} title="Angled glass from the top of this wall up to the eave, carried by the frame — drop the wall to a kneewall height first (e.g. 3')" onChange={(event) => updateSelectedRoom('sunGlazing', event.target.checked)} />
                          {rW.sunGlazing && <input type="number" step="5" min="0" max="45" title="Glazing tilt in degrees from vertical — steeper aims lower winter sun" value={rW.sunGlazingTiltDeg} onChange={(event) => updateSelectedRoom('sunGlazingTiltDeg', event.target.value)} />}
                          {rW.sunGlazing && <small>° from vertical</small>}
                        </span>
                      </label>
                    );
                  })()}
                  {!selectedIsWall && <label>{selectedIsOpening ? 'Along Wall' : 'X'}<input type="number" value={selectedIsOpening ? (selected.wall === 'north' || selected.wall === 'south' ? selected.x : selected.y) || 0 : selected?.x || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom(selectedIsOpening ? (selected.wall === 'north' || selected.wall === 'south' ? 'x' : 'y') : 'x', event.target.value)} /></label>}
                  {!selectedIsWall && !selectedIsOpening && <label>Y<input type="number" value={selected?.y || 0} disabled={selectedIsRoof || selectedIsGrid} onChange={(event) => updateSelectedRoom('y', event.target.value)} /></label>}
                  {!selectedIsWall && !selectedIsSpecial && !selectedIsElement && (storeyInfo(spec.shell).storeys > 1 || basementInfo(spec.shell).present) && <label>Level ({basementInfo(spec.shell).present ? '-1 = basement' : 'floor'})<input type="number" min={basementInfo(spec.shell).present ? -1 : 1} max={Math.ceil(storeyInfo(spec.shell).storeys)} value={Number(selected?.level || 1)} onChange={(event) => updateSelectedRoom('level', event.target.value)} /></label>}
                  {(selectedIsElement || selectedIsWall || selectedIsRoof) && <label>Height<input type="number" value={selected?.h || 1.2} disabled={selectedIsOpening || selectedIsPad || selectedIsGrid || (selectedIsWall && selected?.storey === 'upper') || (selectedIsWall && spec.shell.roofType === 'shed' && (selected?.side === 'east' || selected?.side === 'west'))} title={selectedIsWall && selected?.storey === 'upper' ? 'Upper wall height comes from the Storeys setting on the Shell page' : selectedIsWall && spec.shell.roofType === 'shed' && (selected?.side === 'east' || selected?.side === 'west') ? 'Raked wall — its ends follow the north and south walls' : undefined} onChange={(event) => updateSelectedRoom('h', event.target.value)} /></label>}
                  {selectedIsOpening && <label>Wall
                    <select value={selected?.wall || 'south'} onChange={(event) => updateSelectedRoom('wall', event.target.value)}>
                      <option value="north">North</option>
                      <option value="south">South</option>
                      <option value="east">East</option>
                      <option value="west">West</option>
                      <option value="roof">Roof</option>
                    </select>
                  </label>}
                  {selectedIsSpecial && !selectedIsPad && <label>{selectedIsRoof ? 'Roof Type' : 'Opening Type'}
                    <select value={selectedIsRoof ? (selected?.type || 'gable') : (OPENING_TYPES[selected?.type] ? selected.type : 'window')} onChange={(event) => updateSelectedRoom('type', event.target.value)}>
                      {selectedIsRoof && <option value="gable">gable</option>}
                      {selectedIsRoof && <option value="shed">shed / lean-to</option>}
                      {!selectedIsRoof && Object.entries(OPENING_TYPES).map(([key, profile]) => (
                        <option key={key} value={key}>{profile.label}</option>
                      ))}
                    </select>
                  </label>}
                  {selectedIsElement && selected?.category === 'outbuilding' && <label>Construction
                    <select value={OUTBUILDING_CONSTRUCTION[selected?.construction] ? selected.construction : 'stick'} onChange={(event) => updateSelectedRoom('construction', event.target.value)}>
                      {Object.entries(OUTBUILDING_CONSTRUCTION).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                    </select>
                  </label>}
                  {selectedIsElement && selected?.category === 'foundation' && <label>Construction
                    <select value={FOUNDATION_RUN_TYPES[selected?.construction] ? selected.construction : 'rubble'} onChange={(event) => updateSelectedRoom('construction', event.target.value)}>
                      {Object.entries(FOUNDATION_RUN_TYPES).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                    </select>
                  </label>}
                  {selectedIsElement && !['foundation', 'floor', 'partition'].includes(selected?.category) && <label>Canopy roof
                    <select value={selected?.roofType || ''} onChange={(event) => updateSelectedRoom('roofType', event.target.value)}>
                      <option value="">None (open)</option>
                      <option value="shed">Shed canopy</option>
                      <option value="gable">Gable canopy</option>
                    </select>
                  </label>}
                  {selected?.id === 'frame-main' && <>
                    <label>Frame system
                      <select value={resolveFrameType(spec, 1)} onChange={(event) => updateSelectedRoom('type', event.target.value)}>
                        {Object.entries(FRAME_TYPES).map(([key, f]) => <option key={key} value={key} style={greenOptStyle(f)}>{greenLeaf(f)}{f.label}</option>)}
                      </select>
                    </label>
                    <label>Bay spacing (ft, post to post)<input type="number" step="0.5" min="4" max="16" value={Number(spec.frame?.baySpacingFt) || 8} onChange={(event) => updateSelectedRoom('baySpacingFt', event.target.value)} /></label>
                  </>}
                  {selectedIsElement && selected?.category === 'partition' && <>
                    <label>Construction
                      <select value={PARTITION_TYPES[selected?.construction] ? selected.construction : 'framed'} onChange={(event) => updateSelectedRoom('construction', event.target.value)}>
                        {Object.entries(PARTITION_TYPES).map(([key, p]) => <option key={key} value={key} style={greenOptStyle(p)}>{greenLeaf(p)}{p.label}</option>)}
                      </select>
                    </label>
                    <label>Door width (ft, 0 = solid)<input type="number" step="0.5" min="0" max="8" value={Number(selected?.doorWFt || 0)} onChange={(event) => updateSelectedRoom('doorWFt', event.target.value)} /></label>
                    {Number(selected?.doorWFt || 0) > 0 && <label>Door position along wall (ft)<input type="number" step="0.5" min="0" value={Number(selected?.doorAtFt || 0)} onChange={(event) => updateSelectedRoom('doorAtFt', event.target.value)} /></label>}
                  </>}
                  {!selectedIsWall && !selectedIsSpecial && <label>{selectedIsElement ? 'Category' : 'Type'}
                    <select value={selectedIsElement ? selected?.category || 'storage' : selected?.type || 'living'} onChange={(event) => updateSelectedRoom(selectedIsElement ? 'category' : 'type', event.target.value)}>
                      {selectedIsElement && <option value="wall">wall</option>}
                      {selectedIsElement && <option value="earthwork">earthwork</option>}
                      {selectedIsElement && <option value="structure">structure</option>}
                      {selectedIsElement && <option value="roof">roof</option>}
                      {selectedIsElement && <option value="passive">passive</option>}
                      {selectedIsElement && <option value="thermal">thermal</option>}
                      {selectedIsElement && <option value="water">water</option>}
                      {selectedIsElement && <option value="landscape">landscape</option>}
                      {selectedIsElement && <option value="garden">garden</option>}
                      {selectedIsElement && <option value="animal">animal</option>}
                      {selectedIsElement && <option value="floor">floor</option>}
                      {selectedIsElement && <option value="loft">loft</option>}
                      {selectedIsElement && <option value="tower">tower</option>}
                      {selectedIsElement && <option value="custom">custom</option>}
                      <option value="living">living</option>
                      <option value="service">service</option>
                      <option value="sleeping">sleeping</option>
                      <option value="wet">wet</option>
                      <option value="work">work</option>
                      <option value="plant">plant</option>
                      <option value="storage">storage</option>
                      <option value="outdoor">outdoor</option>
                      <option value="site">site</option>
                      <option value="garden">garden</option>
                      <option value="animal">animal</option>
                      <option value="paddock">paddock</option>
                      <option value="run">run</option>
                      <option value="landscape">landscape</option>
                      <option value="homestead">homestead</option>
                    </select>
                  </label>}
                  <div className="editActions">
                    {selectedIsSpecial ? (
                      <>
                        {selectedIsOpening && <button className="danger" onClick={removeSelectedRoom}><Trash2 size={15} /> Remove Opening</button>}
                        {selectedIsPad && <button className="secondary" onClick={() => updateSelectedRoom('w', selected.w + 32)}><Plus size={15} /> Expand Pad</button>}
                        {selectedIsGrid && <span className="fixedNote">Fixed scale reference</span>}
                      </>
                    ) : selectedIsWall ? (
                      <>
                        <label className="addOpeningPick">Add opening
                          <select value={wallOpeningType} onChange={(event) => setWallOpeningType(event.target.value)}>
                            {Object.entries(OPENING_TYPES).filter(([, profile]) => !profile.roof).map(([key, profile]) => (
                              <option key={key} value={key}>{profile.label}</option>
                            ))}
                          </select>
                        </label>
                        <button onClick={() => addOpeningToSelectedWall(wallOpeningType)}><Plus size={15} /> Add to this wall</button>
                        <button className="danger" onClick={removeSelectedRoom}><Trash2 size={15} /> Remove Wall</button>
                      </>
                    ) : (
                      <>
                        <button onClick={addRoom}><Plus size={15} /> Add Space</button>
                        <button className="danger" onClick={removeSelectedRoom}><Trash2 size={15} /> Remove</button>
                      </>
                    )}
                  </div>
                </div>
                {(selectedIsWall || selectedIsRoof || (selectedIsOpening && selected?.wall !== 'roof')) && (
                  <button type="button" className="secondary detailJump" onClick={() => setViewMode('detail')}>
                    ⌗ Connection detail — view it in the preview
                  </button>
                )}
              </div>
            )}

            {inspectorView === 'assemblies' && (
              <div className="assembliesPane fullPane">
              <p className="studioHint">Apply a ready-made assembly to the house, or place a catalog object in the model.</p>
              <div className="scheduleElements">
                <div className="libraryMode">
                  <button className={libraryActionMode === 'apply' ? 'active' : ''} onClick={() => setLibraryActionMode('apply')}>Apply to House</button>
                  <button className={libraryActionMode === 'place' ? 'active' : ''} onClick={() => setLibraryActionMode('place')}>Place Object</button>
                </div>
                <div className="elementLibrary">
                  {elementLibrary.map((group) => (
                    <details key={group.category}>
                      <summary>{group.category}</summary>
                      <div className="elementGrid">
                        {group.items.map((item) => (
                          <div
                            key={`${group.category}-${item.name}`}
                            className="elementCard"
                            role="button"
                            tabIndex={0}
                            onClick={() => useLibraryElement(item, group.category)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                useLibraryElement(item, group.category);
                              }
                            }}
                          >
                            <b>{item.name}</b>
                            <span>{item.note}</span>
                            <div className="elementActions">
                              <button className="ghost" onClick={(event) => { event.stopPropagation(); useLibraryElement(item, group.category, 'apply'); }}>Apply to House</button>
                              <button className="ghost" onClick={(event) => { event.stopPropagation(); useLibraryElement(item, group.category, 'place'); }}>Place Object</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
              </div>
            )}

          </section>
        </div>, inspectorDock)}
      </section>

      {welcomeOpen && (
        <div className="welcomeOverlay">
          <div className={`welcomeCard${(!welcomeIsFirstRun || previousDesigns.length > 0) ? ' threeCol' : ''}`}>
            <div className="welcomeSide">
            <div className="welcomeMark" aria-hidden="true"><span className="brandGable" /></div>
            <h2>Natural Building</h2>
            <p className="welcomeIntro">A design studio for natural homes — straw bale, cob, timber — that keeps a real building model with live cost, code checks, and carbon while you work.</p>
            <div className="welcomeHow">
              <div><b>Design by system</b><span>Pick a system on the left — foundation, walls, roof, water — and set its plain numbers first.</span></div>
              <div><b>Tap anything to edit it</b><span>The model is the selector: tap a wall, room, or window (or use the chip on the preview) and its controls open on the left. 3D, Plan, and Detail are three views of the same selection.</span></div>
              <div><b>Ask for the big moves</b><span>The Studio chat adds rooms, moves walls, and consults the council. Review flags what doesn't add up — most flags have a one-tap fix.</span></div>
              <div><b>Take it to the real world</b><span>Export a permit drawing set, an IFC model for any BIM tool, or a build plan with materials.</span></div>
            </div>
            </div>
            <div className="welcomeActions">
            <div className="welcomeDivider">Start a design</div>
            <label className="welcomeName">
              <span>Name your design</span>
              <input
                type="text"
                placeholder="e.g. Cedar Hollow Homestead"
                value={welcomeName}
                onChange={(event) => setWelcomeName(event.target.value)}
              />
            </label>
            <div className="welcomeChoices">
              <button className="welcomeChoice" onClick={() => startNewDesign('blank')}>
                <b>Start on empty land</b>
                <small>Just the shell on the site. Add rooms yourself, or tell the assistant what you need.</small>
              </button>
              <button className="welcomeChoice" onClick={() => startNewDesign('sample')}>
                <b>Start from the sample homestead</b>
                <small>A small working house — rooms, systems, and checks already alive. Change everything.</small>
              </button>
              <label className="welcomeChoice welcomeFile">
                <b>Start from a file or drawing</b>
                <small>A sketch, photo, floor plan, or PDF — the assistant reads it and builds the model from it.</small>
                <input type="file" accept="image/*,application/pdf,.pdf,.txt,.md,.csv" onChange={(event) => { startFromFile(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
            </div>
            {!welcomeIsFirstRun && (
              <div className="welcomeFoot">
                <span>Starting new replaces the design that's open now.</span>
              </div>
            )}
            </div>
            {(!welcomeIsFirstRun || previousDesigns.length > 0) && (
              <div className="welcomeResume">
                {!welcomeIsFirstRun && (
                  <>
                    <div className="welcomeDivider">or continue</div>
                    <button className="welcomeContinue" onClick={() => { setWelcomeName(''); setWelcomeOpen(false); }}>
                      <b>Continue where you left off</b>
                      <small>{spec.projectName} · revision {spec.revision}</small>
                    </button>
                  </>
                )}
                {(() => {
                  const others = previousDesigns.filter((design) => design.projectName !== spec.projectName);
                  if (!others.length) return null;
                  return (
                    <div className="welcomePrevious">
                      <div className="welcomeDivider">or open a previous design</div>
                      {others.slice(0, 5).map((design) => (
                        <button key={design.file} className="welcomePrevRow" onClick={() => restorePreviousDesign(design)}>
                          <b>{design.projectName}</b>
                          <small>rev {design.revision} · {design.shell}′ · {design.roomCount} room{design.roomCount === 1 ? '' : 's'}{design.savedAt ? ` · ${design.savedAt}` : ''}</small>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      <aside className="rightPanel">
        <section className="panelBlock consolePanel chatPanel">
          <div className="blockTitle chatTitle">
            <span><Send size={16} /> Studio</span>
            <button type="button" className="chatClose" title="Close the chat — reopen with the Chat button up top" onClick={() => setChatOpen(false)}>×</button>
          </div>
          <p className="studioHint">Type a design edit, attach a sketch, or consult the team.</p>
          <div className="chatTargets compactTargets">
            <button className={chatTarget === 'design' ? 'chatTarget active' : 'chatTarget'} onClick={() => chooseChatTarget('design')}>
              <Hammer size={15} />
              <span>Design</span>
            </button>
            <button className={chatTarget === 'team' ? 'chatTarget active' : 'chatTarget'} onClick={() => chooseChatTarget('team')}>
              <Users size={15} />
              <span>Team</span>
            </button>
          </div>
          {chatTarget === 'design' && (
            <label className="addToSelector">
              <span>Add to:</span>
              <select value={addToTarget} onChange={(event) => setAddToTarget(event.target.value)}>
                {addToTargets.map((target) => (
                  <option key={target.value} value={target.value}>
                    {target.value === 'selected' && selected?.name ? `Selected: ${selected.name}` : target.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isPlanning && <div className="planningBar" aria-hidden="true"><span /></div>}
          <div className="chatStream" ref={chatStreamRef}>
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`chatBubble ${message.role}`}>
                {message.image && <img src={message.image} alt="Attached design reference" />}
                {message.speaker && <b>{message.speaker}</b>}
                <span>{message.text}</span>
              </div>
            ))}
            {isPlanning && (
              <div className="chatBubble studio planningBubble">
                <b>Studio</b>
                <span><span className="planningWheel" aria-hidden="true" />{chatTarget !== 'design' ? 'Consulting the team' : attachedImages.length ? 'Reading your drawing and building the model' : 'Planning the change'}<span className="planningDots"><i>.</i><i>.</i><i>.</i></span></span>
                <small>{attachedImages.length ? 'a full takeoff runs a trace, a completeness check, then compares its own result against the drawing and corrects itself — allow up to five minutes for a big set' : 'a full drawing takeoff can take up to a minute'}</small>
              </div>
            )}
          </div>
          <textarea
            value={chatTarget === 'design' ? prompt : expertQuestion}
            onChange={(event) => chatTarget === 'design' ? setPrompt(event.target.value) : setExpertQuestion(event.target.value)}
            onPaste={handleChatPaste}
            placeholder={chatTarget === 'design' ? 'Ask for edits: move primary bedroom to NE corner, make kitchen 14 x 12, add pantry 8 x 10...' : 'Ask the team about structure, materials, layout, code, water, farm workflow, cost, or sequencing...'}
          />
          <div className="buttonRow">
            <button onClick={submitChat} disabled={isPlanning}>{chatTarget === 'design' ? <Play size={16} /> : <Send size={16} />} {isPlanning ? 'Planning...' : chatTarget === 'design' ? 'Apply Design' : 'Consult'}</button>
            <button className="secondary" onClick={loopRevisions}><RefreshCcw size={16} /> Council Loop</button>
          </div>
          <label
            className="uploadBox slimUpload"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleImage(event.dataTransfer.files?.[0]);
            }}
          >
            {imagePreview ? (
              <span className="uploadPreview">
                <img src={imagePreview} alt="Uploaded drawing reference" />
                <span>Add another image or document, or drop one here</span>
              </span>
            ) : (
              <>
                <Upload size={20} />
                <span>Add photo, drawing, PDF, or text</span>
              </>
            )}
            <input type="file" accept="image/*,application/pdf,.pdf,.txt,.md,.csv" onChange={handleImageInput} />
          </label>
          {attachedImages.length > 0 && (
            <div className="attachmentTray" aria-label="Chat image attachments">
              {attachedImages.map((image) => (
                <div className="attachmentChip" key={image.id}>
                  {image.kind === 'pdf' || image.kind === 'text' ? (
                    <span className="docChipIcon"><FileText size={15} /></span>
                  ) : (
                    <img src={image.src} alt={image.name} />
                  )}
                  <span>{image.name}</span>
                  <button className="ghost iconButton" onClick={() => removeAttachedImage(image.id)} aria-label={`Remove ${image.name}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

