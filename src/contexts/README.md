# Context Providers

## Architecture

The app state is split into **5 independent context slices** to avoid megastate re-renders:

### **ShellContext**
- **State**: Building envelope (dimensions, roof, basement, site topography)
- **Triggers re-render**: shell width/depth, wall height, roof type/pitch, basement height, site latitude/rainfall
- **Consumed by**: Shell editor, 3D renderer, plan view, cost calculation
- **Update pattern**: `shell.updateShell({ widthFt: 40, depthFt: 32 })`

### **RoomsContext**
- **State**: Room list and operations (add, remove, move, resize)
- **Triggers re-render**: room list changes (added/removed), position/size changed, type/level changed
- **Consumed by**: Room list, plan view, 3D renderer, inspector
- **Update pattern**: `rooms.moveRoom(roomId, x, y)` or `rooms.resizeRoom(roomId, w, d)`

### **WallsContext**
- **State**: Wall construction, cladding, openings (windows/doors)
- **Triggers re-render**: assembly/cladding changed, opening added/removed, wall height, sun glazing toggle
- **Consumed by**: Wall editor, opening manager, 3D renderer, detail view
- **Update pattern**: `walls.setWallAssembly('south', 'straw-bale')` or `walls.addOpening({ wall: 'south', x: 5, widthFt: 3 })`

### **SystemsContext**
- **State**: MEP systems (heat, water, power, waste, foundation, insulation, frame, flooring, reclaimed materials, DIY labor)
- **Triggers re-render**: system type/config changed, insulation type changed, DIY toggle
- **Consumed by**: Systems editor, cost calculation, performance estimates
- **Update pattern**: `systems.setHeatSource('minisplit')` or `systems.toggleReclaimed('frame')`

### **CostContext** (Read-only, derived)
- **State**: Computed cost, carbon, heat load, water demand, issues, quality score
- **Derives from**: All other contexts (via `deriveDesign(spec)`)
- **Triggers re-render**: Any change to input systems causes recomputation
- **Consumed by**: Cost display, budget alerts, issue flags, material schedule
- **Update pattern**: No direct updates; changes to shell/rooms/walls/systems trigger recalculation

## Usage

### Setup (in `src/main.jsx`)

```jsx
import { ShellProvider } from './contexts/ShellContext';
import { RoomsProvider } from './contexts/RoomsContext';
import { WallsProvider } from './contexts/WallsContext';
import { SystemsProvider } from './contexts/SystemsContext';
import { CostProvider } from './contexts/CostContext';

function App() {
  const [spec, setSpec] = useState(loadInitialSpec());

  return (
    <ShellProvider spec={spec} onUpdate={setSpec}>
      <RoomsProvider spec={spec} onUpdate={setSpec}>
        <WallsProvider spec={spec} onUpdate={setSpec}>
          <SystemsProvider spec={spec} onUpdate={setSpec}>
            <CostProvider spec={spec}>
              <AppLayout />
            </CostProvider>
          </SystemsProvider>
        </WallsProvider>
      </RoomsProvider>
    </ShellProvider>
  );
}
```

### In Components

```jsx
import { useShell, useRooms, useCost } from '../hooks/useSpec';

function ShellEditor() {
  const shell = useShell();
  return (
    <div>
      <input
        value={shell.width}
        onChange={(e) => shell.updateShell({ widthFt: Number(e.target.value) })}
      />
    </div>
  );
}

function RoomList() {
  const rooms = useRooms();
  return (
    <div>
      {rooms.rooms.map((room) => (
        <div
          key={room.id}
          onClick={() => rooms.moveRoom(room.id, room.x + 1, room.y + 1)}
        >
          {room.name}
        </div>
      ))}
    </div>
  );
}

function CostDisplay() {
  const cost = useCost();
  return (
    <div>
      Cost: ${cost.costUSD.toLocaleString()}
      Carbon: {cost.carbonTons.toFixed(1)} t CO₂e
      Issues: {cost.issueCount}
    </div>
  );
}
```

## Performance Notes

- **Memoization**: Each context uses `useMemo` on its value object to prevent unnecessary re-renders.
- **Selective subscription**: Components import only the hooks they need; unused contexts don't cause re-renders.
- **Derived contexts**: `CostContext` recalculates when `spec` changes, but consumers only re-render if the *cost values* actually change (via memoization).
- **Update batching**: Use `spec` to batch updates to multiple systems at once if needed; avoid rapid sequential context calls.

## Refactoring Checklist

- [ ] Remove top-level `spec` prop from component trees
- [ ] Convert `main.jsx` to wrap providers
- [ ] Update `threeScene.jsx` to use `useShell()`, `useRooms()`, `useWalls()` instead of `spec` prop
- [ ] Update `planView.jsx` to use context slices
- [ ] Update inspector panel to use `useRooms()` and update callbacks
- [ ] Update cost display to use `useCost()`
- [ ] Test re-render frequency (use React Profiler to verify memoization works)
