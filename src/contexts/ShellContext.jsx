import React, { createContext, useCallback, useMemo } from 'react';

/**
 * ShellContext: Building envelope state (footprint, roof, foundation, site).
 * Consumed by: Shell page, 3D renderer, cost calculations.
 * Triggers re-render: shell dimensions, roof type, basement, topography.
 */
export const ShellContext = createContext();

export function ShellProvider({ spec, onUpdate, children }) {
  const shell = spec.shell || {};
  const site = spec.site || {};

  const updateShell = useCallback(
    (updates) => {
      onUpdate({
        ...spec,
        shell: { ...shell, ...updates }
      });
    },
    [spec, shell, onUpdate]
  );

  const updateSite = useCallback(
    (updates) => {
      onUpdate({
        ...spec,
        site: { ...site, ...updates }
      });
    },
    [spec, site, onUpdate]
  );

  const value = useMemo(
    () => ({
      // Shell dimensions
      width: Number(shell.widthFt || 36),
      depth: Number(shell.depthFt || 28),
      wallHeight: Number(shell.wallHeightFt || 10),
      storeys: Number(shell.storeys || 1),
      padExtensionFt: Number(shell.padExtensionFt || 16),

      // Roof
      roofType: shell.roofType || 'gable',
      roofPitch: Number(shell.roofPitch || 0.32),
      southWallHeightFt: Number(shell.southWallHeightFt || shell.wallHeightFt || 10),
      northWallHeightFt: Number(shell.northWallHeightFt || shell.wallHeightFt || 10),
      eastWallHeightFt: Number(shell.eastWallHeightFt || shell.wallHeightFt || 10),
      westWallHeightFt: Number(shell.westWallHeightFt || shell.wallHeightFt || 10),

      // Foundation
      basementHeightFt: Number(shell.basementHeightFt || 0),
      basementHeated: Boolean(shell.basementHeated),
      designApproach: shell.designApproach || 'natural',

      // Footprint (custom shape)
      footprint: shell.footprint || null,
      isRound: shell.footprint === 'round',

      // Site context
      latitude: Number(site.latitudeDeg || 43),
      rainfall: Number(site.rainInYr || 38),
      slopeFt: Number(site.slopeFt || 0),
      slopeDir: site.slopeDir || 'south',
      gradeFt: Number(site.gradeFt || 1.5),

      // Update functions
      updateShell,
      updateSite,
      setDimensions: (w, d, h) => updateShell({ widthFt: w, depthFt: d, wallHeightFt: h }),
      setRoof: (type, pitch) => updateShell({ roofType: type, roofPitch: pitch }),
      setBasement: (heightFt) => updateShell({ basementHeightFt: heightFt > 0 ? heightFt : 0 }),
      setFootprint: (vertices) => updateShell({ footprint: vertices }),
    }),
    [shell, site, updateShell, updateSite]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
