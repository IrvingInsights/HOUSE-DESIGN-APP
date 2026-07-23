import { useContext } from 'react';
import { ShellContext } from '../contexts/ShellContext';
import { RoomsContext } from '../contexts/RoomsContext';
import { WallsContext } from '../contexts/WallsContext';
import { SystemsContext } from '../contexts/SystemsContext';
import { CostContext } from '../contexts/CostContext';

/**
 * useSpec: Unified hook for components that need multiple context slices.
 * Avoids prop drilling; use sparingly to keep component coupling low.
 *
 * Example:
 *   const { shell, rooms, cost } = useSpec();
 */
export function useSpec(slices = ['shell', 'rooms', 'walls', 'systems', 'cost']) {
  const result = {};

  if (slices.includes('shell')) {
    result.shell = useContext(ShellContext);
  }
  if (slices.includes('rooms')) {
    result.rooms = useContext(RoomsContext);
  }
  if (slices.includes('walls')) {
    result.walls = useContext(WallsContext);
  }
  if (slices.includes('systems')) {
    result.systems = useContext(SystemsContext);
  }
  if (slices.includes('cost')) {
    result.cost = useContext(CostContext);
  }

  return result;
}

// Individual slice hooks for cleaner code
export const useShell = () => useContext(ShellContext);
export const useRooms = () => useContext(RoomsContext);
export const useWalls = () => useContext(WallsContext);
export const useSystems = () => useContext(SystemsContext);
export const useCost = () => useContext(CostContext);
