
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanView } from "/sessions/rcw-014qhnpfcodcigarvj1r9t8s/mnt/HOUSE-DESIGN-APP/src/planView.jsx";
export function render(spec, activeFloor, opts = {}) {
  const picked = [];
  const floors = [];
  const markup = renderToStaticMarkup(
    React.createElement(PlanView, {
      spec,
      selectedRoom: opts.selected || null,
      onSelect: (id) => picked.push(id),
      onMove: () => {},
      onResize: () => {},
      onResizeShell: () => {},
      onMoveEdge: () => {},
      onMoveOpening: () => {},
      activeFloor,
      onSelectFloor: opts.noFloorJump ? null : ((f) => floors.push(f)),
    })
  );
  return { markup, picked, floors };
}
