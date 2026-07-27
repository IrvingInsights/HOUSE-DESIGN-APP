// ONE SCALED GRID FOR EVERY DRAWN VIEW.
//
// The plan had its own grid, the wall / storeys / interior views had none, and
// the 3D dropped its grid entirely on sloped ground — so the same house read at
// four different scales depending which way you looked at it. This is the one
// ruler they all use.
//
// Views differ in how they map feet to screen (the plan draws feet directly;
// the elevation flips Y and offsets it), so the caller hands in its own
// mapping functions and the real-world ranges. The component only decides where
// the lines go and what they say — never how big a foot is.
import React from 'react';

// A grid you can actually count: fine lines every `minor` ft, a heavier labelled
// line every `major` ft. Steps grow with the drawing so a 200 ft site doesn't
// turn into a solid grey field.
export function gridSteps(spanFt) {
  if (spanFt <= 24) return { minor: 1, major: 5 };
  if (spanFt <= 60) return { minor: 5, major: 10 };
  if (spanFt <= 150) return { minor: 10, major: 50 };
  return { minor: 25, major: 100 };
}

export function ScaleGrid({
  xFt, yFt,               // [min, max] in FEET for each axis
  mapX = (v) => v,        // feet -> view units
  mapY = (v) => v,
  stroke = 'var(--line)',
  labels = true,
  labelSize = 0.9,
  unitPerFt = 1           // view units per foot, for stroke widths that stay hairline
}) {
  const [x0, x1] = xFt;
  const [y0, y1] = yFt;
  const steps = gridSteps(Math.max(x1 - x0, y1 - y0));
  const thin = 0.06 / unitPerFt;
  const thick = 0.12 / unitPerFt;
  const lines = [];
  const marks = [];
  const start = (v, s) => Math.ceil(v / s) * s;

  for (let x = start(x0, steps.minor); x <= x1 + 1e-6; x += steps.minor) {
    const major = Math.abs(x % steps.major) < 1e-6;
    lines.push(<line key={`vx${x}`} x1={mapX(x)} y1={mapY(y0)} x2={mapX(x)} y2={mapY(y1)}
      stroke={stroke} strokeWidth={major ? thick : thin} opacity={major ? 0.55 : 0.28} />);
    if (labels && major && x > x0 + 1e-6) {
      marks.push(<text key={`lx${x}`} x={mapX(x)} y={mapY(y0)} dy={labelSize * 1.4} textAnchor="middle"
        fontSize={labelSize} fill="var(--ink)" opacity={0.45}>{x}′</text>);
    }
  }
  for (let y = start(y0, steps.minor); y <= y1 + 1e-6; y += steps.minor) {
    const major = Math.abs(y % steps.major) < 1e-6;
    lines.push(<line key={`hy${y}`} x1={mapX(x0)} y1={mapY(y)} x2={mapX(x1)} y2={mapY(y)}
      stroke={stroke} strokeWidth={major ? thick : thin} opacity={major ? 0.55 : 0.28} />);
    if (labels && major && y > y0 + 1e-6) {
      marks.push(<text key={`ly${y}`} x={mapX(x0)} y={mapY(y)} dx={-labelSize * 0.5} dy={labelSize * 0.35}
        textAnchor="end" fontSize={labelSize} fill="var(--ink)" opacity={0.45}>{y}′</text>);
    }
  }
  return <g className="scaleGrid" pointerEvents="none">{lines}{marks}</g>;
}
