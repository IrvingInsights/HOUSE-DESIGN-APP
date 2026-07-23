import React, { createContext, useMemo } from 'react';
import { deriveDesign } from '../engine';

/**
 * CostContext: Derived cost and carbon calculations.
 * Read-only; depends on Shell, Rooms, Walls, Systems contexts.
 * Consumed by: Cost display, budget alerts, material schedule.
 * Recomputes: whenever any input system changes.
 */
export const CostContext = createContext();

export function CostProvider({ spec, children }) {
  const derived = useMemo(() => {
    try {
      return deriveDesign(spec);
    } catch (e) {
      console.warn('Cost derivation error:', e);
      return {
        costUSD: 0,
        carbonTons: 0,
        waterGalPerDay: 0,
        heatLoadBTUh: 0,
        issues: [],
      };
    }
  }, [spec]);

  const value = useMemo(
    () => ({
      // Totals
      costUSD: derived.costUSD || 0,
      carbonTons: derived.carbonTons || 0,
      waterGalPerDay: derived.waterGalPerDay || 0,
      heatLoadBTUh: derived.heatLoadBTUh || 0,

      // Breakdown by system
      costBySystem: derived.costBySystem || {},
      carbonBySystem: derived.carbonBySystem || {},

      // Financed
      monthlyPayment: derived.monthlyPayment || 0,
      loanAmount: derived.loanAmount || 0,

      // Issues
      issues: derived.issues || [],
      issueCount: (derived.issues || []).length,
      hasBlockingIssues: (derived.issues || []).some((i) => i.severity === 'critical'),

      // Performance
      quality: derived.quality || 0, // 0-100 score
      passRate: derived.passRate || 0, // % of checks passing
    }),
    [derived]
  );

  return <CostContext.Provider value={value}>{children}</CostContext.Provider>;
}
