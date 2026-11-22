/**
 * How a token gets from one grid space to the next.
 *
 * Both the range overlay and pathfinding need the same three answers about a
 * pair of adjacent spaces: is the step allowed, what does it cost, and where
 * does the token sit afterwards. A navigator works those out for one token
 * from one starting position, by asking the token itself:
 *
 *  - allowed?  `token.constrainMovementPath` on the one-step path, exactly as
 *    a drag would. That is the system's own answer, so it already includes
 *    whatever the system counts as blocking — walls, surfaces between levels,
 *    dnd5e's enemy-occupied spaces — and core's rule that a player's preview
 *    is only stopped by walls they have actually seen.
 *  - cost?     `document.measureMovementPath` with the token's cost function,
 *    so difficult terrain and movement-action rules are honoured.
 */

import { guarded } from './logger.js';
import { makeStepMetric } from './reachability.js';

/**
 * @param {Token} token
 * @param {object} config
 * @param {string} config.action                    Movement action being planned
 * @param {{x: number, y: number}} [config.from]    Start here instead of where the token stands
 * @param {object} [config.constrainOptions]        Defaults to the token's drag options
 * @param {object} [config.measureOptions]          Defaults to the token's drag options
 */
export function makeNavigator(token, { action, from = null, constrainOptions = null, measureOptions = null }) {
  const grid = canvas.grid;
  const document = token.document;

  // Everything is laid out relative to a snapped starting position. Space
  // centres form a lattice on both square and hex grids, so the token's
  // position for any other space is the start plus the difference of centres.
  const source = from ?? document._source;
  const anchor = document.getSnappedPosition({ x: source.x, y: source.y });
  const tokenCenter = document.getCenterPoint({ x: anchor.x, y: anchor.y });
  const start = grid.getOffset({ x: tokenCenter.x, y: tokenCenter.y });
  const startCenter = grid.getCenterPoint(start);

  const deltas = new Map();
  const deltaOf = (offset) => {
    const key = `${offset.i},${offset.j}`;
    let delta = deltas.get(key);
    if (!delta) {
      const center = grid.getCenterPoint(offset);
      delta = { x: center.x - startCenter.x, y: center.y - startCenter.y };
      deltas.set(key, delta);
    }
    return delta;
  };

  /** The token's top-left position when its reference space is `offset`. */
  const positionOf = (offset) => {
    const delta = deltaOf(offset);
    return { x: Math.round(anchor.x + delta.x), y: Math.round(anchor.y + delta.y) };
  };

  /** The reference space of the token when it stands at `position`. */
  const offsetOf = (position) => {
    const snapped = document.getSnappedPosition({ x: position.x, y: position.y });
    const center = document.getCenterPoint({ x: snapped.x, y: snapped.y });
    return grid.getOffset({ x: center.x, y: center.y });
  };

  // The drag options also carry the GM's "unconstrained movement" toggle.
  const constrain = {
    ...(constrainOptions ?? guarded('constrain options', () => token._getDragConstrainOptions(), {}) ?? {}),
    preview: true,
  };
  const blocked = (from_, to) => {
    const origin = positionOf(from_);
    const destination = positionOf(to);
    const [path] = token.constrainMovementPath([
      { ...origin, action, snapped: true },
      { ...destination, action, snapped: true },
    ], constrain);
    const end = path.at(-1);
    // "Constrained" alone is not "blocked": a token whose centre sits exactly
    // on a wall line is nudged by a pixel and still arrives.
    return !end || (path.length < 2)
      || (Math.abs(end.x - destination.x) > 1) || (Math.abs(end.y - destination.y) > 1);
  };

  // Price of a step relative to open ground, straight from core's measurement.
  const costFunction = guarded('movement cost function', () => token._getMovementCostFunction({
    ...(measureOptions ?? token._getDragMeasureOptions?.() ?? {}),
    preview: true,
  }), undefined);
  const factor = (from_, to) => {
    const measured = document.measureMovementPath([
      { ...positionOf(from_), action },
      { ...positionOf(to), action },
    ], { cost: costFunction });
    if (!(measured.distance > 0)) return 1;
    return measured.cost / measured.distance;
  };

  const bounds = canvas.dimensions.rect;
  const neighbors = (offset) => grid.getAdjacentOffsets(offset).filter((next) => {
    const delta = deltaOf(next);
    return bounds.contains(tokenCenter.x + delta.x, tokenCenter.y + delta.y);
  });

  return {
    grid,
    action,
    anchor,
    start,
    startCenter,
    deltaOf,
    positionOf,
    offsetOf,
    neighbors,
    // The scene's grid carries the world's "Square Grid Diagonals" setting, so
    // the rule in force is whatever the GM has chosen there.
    step: makeStepMetric(grid, CONST.GRID_DIAGONALS),
    /** 1 on open ground, more on difficult terrain, Infinity if not allowed. */
    edge: (from_, to) => (blocked(from_, to) ? Infinity : factor(from_, to)),
  };
}
