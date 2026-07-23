import React, { createContext, useCallback, useMemo } from 'react';
import { WALL_ASSEMBLIES, CLADDING_TYPES, WALL_SIDES } from '../bim-core';

/**
 * WallsContext: Wall construction, openings, and per-side configuration.
 * Consumed by: Wall editor, opening manager, 3D renderer, cost/carbon.
 * Triggers re-render: assembly changed, cladding changed, opening added/removed, overhang, height.
 */
export const WallsContext = createContext();

export function WallsProvider({ spec, onUpdate, children }) {
  const walls = spec.walls || {};
  const openings = spec.openings || [];
  const shell = spec.shell || {};

  const updateWalls = useCallback(
    (newWalls) => {
      onUpdate({ ...spec, walls: newWalls });
    },
    [spec, onUpdate]
  );

  const updateOpenings = useCallback(
    (newOpenings) => {
      onUpdate({ ...spec, openings: newOpenings });
    },
    [spec, onUpdate]
  );

  const setWallAssembly = useCallback(
    (side, assembly) => {
      if (!WALL_SIDES.includes(side)) return;
      updateWalls({
        ...walls,
        [side]: { ...walls[side], assembly },
      });
    },
    [walls, updateWalls]
  );

  const setWallCladding = useCallback(
    (side, cladding) => {
      if (!WALL_SIDES.includes(side) || !CLADDING_TYPES[cladding]) return;
      updateWalls({
        ...walls,
        [side]: { ...walls[side], cladding },
      });
    },
    [walls, updateWalls]
  );

  const setWallHeight = useCallback(
    (side, heightFt) => {
      if (!WALL_SIDES.includes(side)) return;
      updateWalls({
        ...walls,
        [side]: { ...walls[side], heightFt },
      });
    },
    [walls, updateWalls]
  );

  const setWallSunGlazing = useCallback(
    (side, enabled) => {
      if (!WALL_SIDES.includes(side)) return;
      updateWalls({
        ...walls,
        [side]: {
          ...walls[side],
          sunGlazing: enabled,
          heightFt: enabled ? 2 : walls[side]?.heightFt, // Kneewall when glazed
        },
      });
    },
    [walls, updateWalls]
  );

  const addOpening = useCallback(
    (opening) => {
      updateOpenings([...openings, opening]);
    },
    [openings, updateOpenings]
  );

  const removeOpening = useCallback(
    (index) => {
      updateOpenings(openings.filter((_, i) => i !== index));
    },
    [openings, updateOpenings]
  );

  const updateOpening = useCallback(
    (index, updates) => {
      updateOpenings(
        openings.map((o, i) => (i === index ? { ...o, ...updates } : o))
      );
    },
    [openings, updateOpenings]
  );

  const getWallSide = useCallback(
    (side) => walls[side] || {},
    [walls]
  );

  const getOpeningsByWall = useCallback(
    (wall) => openings.filter((o) => o.wall === wall),
    [openings]
  );

  const value = useMemo(
    () => ({
      walls,
      openings,
      setWallAssembly,
      setWallCladding,
      setWallHeight,
      setWallSunGlazing,
      addOpening,
      removeOpening,
      updateOpening,
      getWallSide,
      getOpeningsByWall,
      openingCount: openings.length,
      wallAssemblyKeys: Object.keys(WALL_ASSEMBLIES),
      claddingTypes: Object.keys(CLADDING_TYPES),
    }),
    [walls, openings, setWallAssembly, setWallCladding, setWallHeight, setWallSunGlazing, addOpening, removeOpening, updateOpening, getWallSide, getOpeningsByWall]
  );

  return <WallsContext.Provider value={value}>{children}</WallsContext.Provider>;
}
