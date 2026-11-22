/**
 * The trail: where a token has been and where it is on its way to.
 *
 * Core's ruler shows this as a line over solid squares whenever a token is
 * moving (and, in combat, when you hover a token that has moved this turn).
 * In the tiles look it is drawn here instead, in the same language as the
 * route being dragged: the stretch still ahead of the token is a lit strip
 * with a ring on every step, and as the token walks each step it has passed
 * dims to a faint tile with a dot. So a route looks the same the moment after
 * it is dropped as it did the moment before, and then is used up.
 *
 * Core still decides everything about the trail except its look: what is on
 * it, when it is shown and to whom all come from the token's ruler (see
 * ruler-mixin.js), and the distance label stays core's.
 */

import { SETTINGS } from './constants.js';
import { setting } from './settings.js';
import { guarded } from './logger.js';
import { routesStyled } from './overlay-render.js';
import { routeBands, inActiveCombat } from './speed.js';
import { litColor, litAlpha, walkedAlpha, fillStrip, drawSteps } from './route-draw.js';
import { cumulativeLengths, advanceAlong, bandAt } from './shapes.js';

/** A step counts as walked once the token is within this much of it, in spaces. */
const ARRIVED = 0.3;

/** How far off its route a walking token may be and still be "on" a stretch, in spaces. */
const ON_ROUTE = 0.35;

/** One trail per token on the canvas that has one. */
const trails = new Map();

/** Holds every trail; lives with core's grid highlights, under the tokens. */
let layer = null;

function getLayer() {
  if (layer && !layer.destroyed && layer.parent) return layer;
  layer = new PIXI.Container();
  layer.eventMode = 'none';
  canvas.interface.grid.highlight.addChild(layer);
  return layer;
}

/** How many of the steps the token has got to. */
function countWalked(trail) {
  const reach = trail.progress + (ARRIVED * canvas.grid.size);
  let walked = 0;
  while ((walked < trail.passed) && (trail.lengths[walked] <= reach)) walked++;
  return walked;
}

function paint(trail) {
  const grid = canvas.grid;
  const { graphics, steps, walked } = trail;
  graphics.clear();

  // Every step is in the colour of the band its distance falls in: lit ahead
  // of the token, faint behind it. A space the route crosses twice stays lit
  // until its last visit is done, so what is ahead is laid out first.
  const seen = new Set();
  const groups = new Map();
  const lay = (from, to, ahead) => {
    for (let n = from; n < to; n++) {
      const { band, offsets } = steps[n];
      const key = `${ahead ? 'a' : 'b'}${band.color}:${band.alpha}`;
      for (const offset of offsets) {
        const space = `${offset.i},${offset.j}`;
        if (seen.has(space)) continue;
        seen.add(space);
        if (!groups.has(key)) groups.set(key, { band, ahead, polygons: [] });
        groups.get(key).polygons.push(grid.getVertices(offset));
      }
    }
  };
  lay(walked, steps.length, true);
  lay(0, walked, false);
  for (const { band, ahead, polygons } of groups.values()) {
    if (ahead) fillStrip(graphics, polygons, litColor(band.color), litAlpha(band.alpha));
    else fillStrip(graphics, polygons, band.color, walkedAlpha(band.alpha));
  }
  drawSteps(graphics, steps.map((step, n) => ({ x: step.x, y: step.y, jump: step.jump, walked: n < walked })));
}

/**
 * Core has refreshed a token's ruler: redraw its trail from the same data.
 * @param {Token} token
 * @param {{passedWaypoints: object[], pendingWaypoints: object[]}} rulerData
 * @param {boolean} visible   Whether the ruler is showing
 */
export function updateTrail(token, rulerData, visible) {
  const passedWaypoints = rulerData?.passedWaypoints ?? [];
  const pendingWaypoints = rulerData?.pendingWaypoints ?? [];
  const count = passedWaypoints.length + pendingWaypoints.length;
  if (token.isPreview || (count < 2) || !routesStyled()) {
    dropTrail(token);
    return;
  }

  const grid = canvas.grid;
  const document = token.document;
  const steps = [...passedWaypoints, ...pendingWaypoints].map((waypoint) => {
    const center = document.getCenterPoint(waypoint);
    let offsets = guarded('trail footprint', () => document.getOccupiedGridSpaceOffsets(waypoint), null);
    if (!offsets?.length) offsets = [grid.getOffset({ x: center.x, y: center.y })];
    return {
      x: center.x,
      y: center.y,
      offsets,
      jump: !!CONFIG.Token.movement.actions[waypoint.action]?.teleport,
      cost: Number.isFinite(waypoint.cost) ? waypoint.cost : 0,
    };
  });
  const passed = passedWaypoints.length;
  const lengths = cumulativeLengths(steps);

  // While the token is still walking, the last part of what it has "passed"
  // is the move it is in the middle of: the document is already at the end,
  // the token on screen is not.
  const movement = document.movement;
  const animating = token.animationContexts.has(token.movementAnimationName);
  const live = (animating && movement?.showRuler) ? Math.min(movement.passed?.waypoints?.length ?? 0, passed) : 0;
  const firstLive = passed - live;

  let trail = trails.get(token);
  if (!trail || trail.graphics.destroyed) {
    trail = { graphics: getLayer().addChild(new PIXI.Graphics()), progress: 0, animating: false, origin: '' };
    trails.set(token, trail);
  } else if (!trail.graphics.parent) getLayer().addChild(trail.graphics);

  const origin = `${Math.round(steps[0].x)},${Math.round(steps[0].y)}`;
  const end = lengths[Math.max(passed - 1, 0)];
  if (!live) trail.progress = end;
  else {
    // Start from where this move starts, unless the token was already under
    // way along the same trail (a second move queued behind the first).
    const start = lengths[Math.max(firstLive - 1, 0)];
    if (!trail.animating || (trail.origin !== origin)) trail.progress = start;
    trail.progress = Math.min(Math.max(trail.progress, 0), end);
    trail.progress = advanceAlong(steps, lengths, token.center, trail.progress, ON_ROUTE * grid.size);
  }

  // Which band each step falls in. In combat the bands count the whole turn,
  // which is what the trail holds; otherwise just the move under way.
  const { ranges } = routeBands(token, document.movementAction);
  const wholeTurn = inActiveCombat(token) && !!setting(SETTINGS.subtractUsed);
  let used = 0;
  steps.forEach((step, n) => {
    if (wholeTurn || (n >= firstLive)) used += step.cost;
    step.band = bandAt(ranges, used);
  });

  Object.assign(trail, {
    steps,
    lengths,
    passed,
    origin,
    animating: live > 0,
    color: steps[steps.length - 1].band.color,
  });
  trail.walked = countWalked(trail);
  trail.graphics.visible = !!visible;
  paint(trail);
}

/**
 * A token has moved on screen: use up the part of its trail it has walked.
 * Called every frame of a movement animation, so it does nothing unless the
 * token has reached another step.
 * @param {Token} token
 */
export function advanceTrail(token) {
  const trail = trails.get(token);
  if (!trail?.animating || trail.graphics.destroyed) return;
  const end = trail.lengths[Math.max(trail.passed - 1, 0)];
  const progress = Math.min(
    advanceAlong(trail.steps, trail.lengths, token.center, trail.progress, ON_ROUTE * canvas.grid.size), end);
  if (progress === trail.progress) return;
  trail.progress = progress;
  const walked = countWalked(trail);
  if (walked === trail.walked) return;
  trail.walked = walked;
  paint(trail);
}

/** Core has shown or hidden the token's ruler. */
export function showTrail(token, visible) {
  const trail = trails.get(token);
  if (trail && !trail.graphics.destroyed) trail.graphics.visible = !!visible;
}

/** The token's ruler has been cleared or destroyed, or has no trail to show. */
export function dropTrail(token) {
  const trail = trails.get(token);
  if (!trail) return;
  if (!trail.graphics.destroyed) trail.graphics.destroy();
  trails.delete(token);
}

/** A setting the trails depend on changed: have every ruler look again. */
export function refreshTrails() {
  if (!canvas.ready) return;
  for (const token of canvas.tokens.placeables) token.renderFlags.set({ refreshRuler: true });
}

/** The canvas is going away, and our display objects with it. */
export function forgetTrails() {
  for (const trail of trails.values()) if (!trail.graphics.destroyed) trail.graphics.destroy();
  trails.clear();
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  layer = null;
}

/**
 * A token's trail in plain data, for tests and other packages.
 * @param {Token} token
 * @returns {{steps: number, walked: number, ahead: number, visible: boolean, walking: boolean,
 *   color: number, colors: number[]}|null} `color` is that of the last step, `colors` of each
 */
export function trailSnapshot(token) {
  const trail = trails.get(token);
  if (!trail || trail.graphics.destroyed) return null;
  return {
    steps: trail.steps.length,
    walked: trail.walked,
    ahead: trail.steps.length - trail.walked,
    visible: trail.graphics.visible,
    walking: trail.animating,
    color: trail.color,
    colors: trail.steps.map((step) => step.band.color),
  };
}
