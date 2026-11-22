/**
 * Drawing a route in the tiles look: a strip of lit tiles with a marker on
 * every step. Shared by the route being dragged (overlay-render.js) and the
 * trail of a token that is walking (trail.js), so the two cannot drift apart.
 */

import { roundedInsetPolygon, mixColor } from './shapes.js';

/** Proportions, as fractions of one grid space. */
export const TILE = Object.freeze({
  gap: 0.05,        // left clear on each side of a tile
  radius: 0.09,     // corner radius
  glow: [0.08, 0.18, 0.30, 0.44], // widths of the stacked strokes that make the soft edge
  strip: 0.015,     // gap round a tile of the route, which sits closer than the rest
  edge: 0.03,       // the line where one band gives way to the next
  ring: 0.2,        // radius of a step marker
  dot: 0.05,        // radius of the dot inside it
  crumb: 0.07,      // radius of the dot left on a step already walked
  line: 0.025,      // stroke of rings and connectors
});

/** Tint for the part of a route that cannot be reached. */
export const BLOCKED_COLOR = 0xff5a5a;

/** How far a band's colour is lifted towards white for the route. */
export const litColor = (color) => mixColor(color, 0xffffff, 0.4);

/**
 * How solid a tile of the route is, given how solid its band is drawn: well
 * above it, so the route stands out of the range, and in step with it, so a
 * fainter band still gives a fainter stretch of route.
 */
export const litAlpha = (alpha) => Math.min(Math.max(alpha * 1.8, 0.3), 0.8);

/** How solid a tile is once the token has walked it. */
export const walkedAlpha = (alpha) => Math.min(Math.max(alpha * 0.55, 0.1), 0.3);

/**
 * Fill the spaces a route crosses.
 * @param {PIXI.Graphics} graphics
 * @param {{x: number, y: number}[][]} polygons   Vertices of each space
 * @param {number} color
 * @param {number} alpha
 */
export function fillStrip(graphics, polygons, color, alpha) {
  if (!polygons.length) return;
  const size = canvas.grid.size;
  const strip = { inset: size * TILE.strip, radius: size * TILE.radius };
  graphics.lineStyle(0);
  graphics.beginFill(color, alpha);
  for (const vertices of polygons) graphics.drawPolygon(roundedInsetPolygon(vertices, strip));
  graphics.endFill();
}

/**
 * @typedef {object} RouteStep
 * @property {number} x            Centre of the step, in pixels
 * @property {number} y
 * @property {boolean} [blocked]   The step cannot be reached
 * @property {boolean} [walked]    The token has already been here: a small dot, not a ring
 * @property {boolean} [jump]      Arrived at without crossing the map (a teleport): no line in
 */

/**
 * Mark every step of a route and join them up.
 * @param {PIXI.Graphics} graphics
 * @param {RouteStep[]} steps
 */
export function drawSteps(graphics, steps) {
  const size = canvas.grid.size;
  const ring = size * TILE.ring;
  const crumb = size * TILE.crumb;
  const stroke = Math.max(size * TILE.line, 1.5);
  const pale = mixColor(BLOCKED_COLOR, 0xffffff, 0.55);
  const colorOf = (step) => (step.blocked ? pale : 0xffffff);
  const reach = (step) => (step.walked ? crumb : ring);

  for (let n = 0; n < steps.length; n++) {
    const step = steps[n];
    const next = steps[n + 1];
    if (next && !next.jump) {
      const dx = next.x - step.x;
      const dy = next.y - step.y;
      const length = Math.hypot(dx, dy);
      const a = reach(step);
      const b = reach(next);
      if (length > a + b + stroke) {
        // A line takes its look from the step it leads to; the stretch
        // behind the token is as faint as the dots on it.
        const faint = step.walked && next.walked;
        graphics.lineStyle({ width: stroke, color: colorOf(next), alpha: faint ? 0.4 : 0.85 });
        graphics.moveTo(step.x + ((dx / length) * a), step.y + ((dy / length) * a));
        graphics.lineTo(next.x - ((dx / length) * b), next.y - ((dy / length) * b));
      }
    }
    const color = colorOf(step);
    if (step.walked) {
      graphics.lineStyle(0);
      graphics.beginFill(color, 0.5);
      graphics.drawCircle(step.x, step.y, crumb);
      graphics.endFill();
      continue;
    }
    graphics.lineStyle({ width: stroke, color, alpha: 0.9 });
    graphics.drawCircle(step.x, step.y, ring);
    graphics.lineStyle(0);
    graphics.beginFill(color, 0.9);
    graphics.drawCircle(step.x, step.y, size * TILE.dot);
    graphics.endFill();
  }
  graphics.lineStyle(0);
}
