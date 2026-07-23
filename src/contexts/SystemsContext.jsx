import React, { createContext, useCallback, useMemo } from 'react';

/**
 * SystemsContext: MEP systems (heat, water, power, waste, foundation, utilities).
 * Consumed by: Systems editor, cost/carbon, performance calcs.
 * Triggers re-render: system type changed, configuration changed.
 */
export const SystemsContext = createContext();

export function SystemsProvider({ spec, onUpdate, children }) {
  const utilities = spec.utilities || {};
  const frame = spec.frame || {};
  const flooring = spec.flooring || {};
  const reclaimed = spec.reclaimed || {};

  const updateUtilities = useCallback(
    (updates) => {
      onUpdate({ ...spec, utilities: { ...utilities, ...updates } });
    },
    [spec, utilities, onUpdate]
  );

  const updateFrame = useCallback(
    (updates) => {
      onUpdate({ ...spec, frame: { ...frame, ...updates } });
    },
    [spec, frame, onUpdate]
  );

  const updateFlooring = useCallback(
    (updates) => {
      onUpdate({ ...spec, flooring: { ...flooring, ...updates } });
    },
    [spec, flooring, onUpdate]
  );

  const updateReclaimed = useCallback(
    (updates) => {
      onUpdate({ ...spec, reclaimed: { ...reclaimed, ...updates } });
    },
    [spec, reclaimed, onUpdate]
  );

  const value = useMemo(
    () => ({
      // Heat
      heatSource: utilities.heatSource || 'wood_stove',
      setHeatSource: (source) => updateUtilities({ heatSource: source }),

      // Water
      waterSource: utilities.waterSource || 'well',
      tankGal: Number(utilities.tankGal || 0),
      wellSepticFt: Number(utilities.wellSepticFt || 120),
      setWaterSource: (source) => updateUtilities({ waterSource: source }),
      setTankGal: (gal) => updateUtilities({ tankGal: gal }),

      // Waste
      wasteMethod: utilities.wasteMethod || 'septic',
      setWasteMethod: (method) => updateUtilities({ wasteMethod: method }),

      // Power
      powerMode: utilities.powerMode || 'offgrid',
      panelCount: Number(utilities.panelCount || 0),
      batteryOverrideKwh: Number(utilities.batteryOverrideKwh || 0),
      setPowerMode: (mode) => updateUtilities({ powerMode: mode }),
      setPanelCount: (count) => updateUtilities({ panelCount: count }),

      // Foundation
      foundationType: utilities.foundationType || 'rubble',
      foundationInsulation: utilities.foundationInsulation || 'perimeter',
      stemwallHeightFt: Number(utilities.stemwallHeightFt || 1.5),
      setFoundationType: (type) => updateUtilities({ foundationType: type }),
      setFoundationInsulation: (insul) => updateUtilities({ foundationInsulation: insul }),

      // Insulation
      roofInsulation: utilities.roofInsulation || 'cellulose',
      floorInsulation: utilities.floorInsulation || 'cellulose',
      windowQuality: utilities.windowQuality || 'double',
      setRoofInsulation: (type) => updateUtilities({ roofInsulation: type }),
      setFloorInsulation: (type) => updateUtilities({ floorInsulation: type }),
      setWindowQuality: (q) => updateUtilities({ windowQuality: q }),

      // Frame
      frameType: frame.type || 'load-bearing',
      setFrameType: (type) => updateFrame({ type }),
      baySpacingFt: Number(frame.baySpacingFt || 8),
      setBaySpacingFt: (spacing) => updateFrame({ baySpacingFt: spacing }),

      // Flooring
      flooringType: flooring.type || 'earthen',
      subfloor: flooring.subfloor || 'insulated',
      setFlooringType: (type) => updateFlooring({ type }),
      setSubfloor: (type) => updateFlooring({ subfloor: type }),

      // Reclaimed materials
      reclaimedFrame: Boolean(reclaimed.frame),
      reclaimedWalls: Boolean(reclaimed.walls),
      reclaimedFlooring: Boolean(reclaimed.flooring),
      reclaimedWindows: Boolean(reclaimed.windows),
      reclaimedRoof: Boolean(reclaimed.roof),
      toggleReclaimed: (system) => updateReclaimed({ [system]: !reclaimed[system] }),

      // DIY labor
      diyWalls: Boolean(utilities.diyWalls),
      diyRoof: Boolean(utilities.diyRoof),
      diyHeat: Boolean(utilities.diyHeat),
      diyFoundation: Boolean(utilities.diyFoundation),
      diyFrame: Boolean(utilities.diyFrame),
      toggleDIY: (system) => updateUtilities({ [system]: !utilities[system] }),

      utilities,
      frame,
      flooring,
      reclaimed,
    }),
    [
      utilities,
      frame,
      flooring,
      reclaimed,
      updateUtilities,
      updateFrame,
      updateFlooring,
      updateReclaimed,
    ]
  );

  return <SystemsContext.Provider value={value}>{children}</SystemsContext.Provider>;
}
