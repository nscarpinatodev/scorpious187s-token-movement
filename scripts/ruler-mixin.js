/**
 * Standing core's ruler down where this module draws the route instead.
 *
 * In the "tiles" look two routes are drawn here as a lit strip with a marker
 * on every step: the one this user is dragging (overlay.js) and the trail of
 * a token that is walking or has walked (trail.js). Core's ruler would draw
 * the same routes on top as a thick line over solid squares, so for those its
 * line, waypoint dots and square highlights are switched off.
 *
 * Everything else the ruler does is untouched: the distance labels, when the
 * ruler is shown and to whom, and the routes other users are still planning.
 *
 * One thing is put right for every look. Pathfinding marks each turn of a
 * route with a waypoint (see pathfinding.js), and to a ruler a waypoint is the
 * end of a leg: the "+10 ft" on a label would count from the last turn, and a
 * system's markers for spaces passed on the way would skip the turns. Here a
 * turn is shown to the ruler for what it is, a space on the way.
 * The ruler class is extended the same way the token class is (see
 * token-mixin.js), so a system's ruler stays the base and gets its say first.
 */

import { MODULE_ID } from './constants.js';
import { guarded, log } from './logger.js';
import { rangeOverlay } from './overlay.js';
import { routesStyled } from './overlay-render.js';
import { updateTrail, showTrail, dropTrail } from './trail.js';

const MIXED = Symbol.for(`${MODULE_ID}.ruler`);

/**
 * Does this waypoint only mark a turn of the route? Nobody set it, the move
 * cannot be undone back to it, and it is neither end of the route.
 */
const isTurn = (waypoint) => !!waypoint && !waypoint.explicit && !waypoint.checkpoint && !waypoint.intermediate
  && !!waypoint.previous && !!waypoint.next;

/**
 * Make the "since the last waypoint" part of a label count from the last
 * waypoint someone set, not from the last turn of the route.
 * @param {object} waypoint   The ruler waypoint the label is for
 * @param {object} context    The label's context, as the class below built it
 */
function countFromLastSetWaypoint(waypoint, context) {
  if (context.cost?.delta === undefined) return;
  let cost = waypoint.cost;
  let distance = waypoint.measurement?.backward?.distance ?? 0;
  let turns = 0;
  for (let prior = waypoint.previous; isTurn(prior) && (prior.stage === waypoint.stage); prior = prior.previous) {
    cost += prior.cost;
    distance += prior.measurement?.backward?.distance ?? 0;
    turns++;
  }
  if (!turns) return;
  context.cost.delta = Number.isFinite(cost) ? cost.toNearest(0.01).signedString() : '∞';
  if (context.distance?.delta !== undefined) context.distance.delta = distance.toNearest(0.01).signedString();
  // pf2e adds how much of the leg was extra cost, and works it out the same way.
  if (typeof context.cost.additional?.delta === 'number') context.cost.additional.delta = Math.max(0, cost - distance);
}

export function installRulerMixin() {
  const Base = CONFIG.Token.rulerClass;
  if (!Base || Base[MIXED]) return;

  class MovementRuler extends Base {
    static [MIXED] = true;

    /** Is this waypoint part of a route drawn by this module? */
    #ours(waypoint) {
      try {
        if (this.token.isPreview) return false;
        // The route this user is dragging…
        if (waypoint.stage === 'planned') {
          return (waypoint.userId === game.user.id) && rangeOverlay.drawsRouteFor(this.token);
        }
        // …and where the token has been and is on its way to.
        return routesStyled();
      } catch {
        return false;
      }
    }

    /** @override */
    _getSegmentStyle(waypoint) {
      const style = super._getSegmentStyle(waypoint);
      return this.#ours(waypoint) ? { ...style, width: 0 } : style;
    }

    /** @override */
    _getWaypointStyle(waypoint) {
      const style = super._getWaypointStyle(waypoint);
      return this.#ours(waypoint) ? { ...style, radius: 0 } : style;
    }

    /**
     * A turn is passed down as a space on the way, which is what a system's
     * ruler looks for when it marks such spaces (pf2e: where each action ends).
     * @override
     */
    _getGridHighlightStyle(waypoint, offset) {
      const seen = isTurn(waypoint) ? { ...waypoint, intermediate: true } : waypoint;
      const style = super._getGridHighlightStyle(seen, offset);
      return this.#ours(waypoint) ? { ...style, alpha: 0 } : style;
    }

    /** @override */
    _getWaypointLabelContext(waypoint, state) {
      const context = super._getWaypointLabelContext(waypoint, state);
      if (context) guarded('route label', () => countFromLastSetWaypoint(waypoint, context));
      return context;
    }

    /** @override */
    refresh(rulerData) {
      super.refresh(rulerData);
      guarded('trail', () => updateTrail(this.token, rulerData, this.visible));
    }

    /** @override */
    _onVisibleChange() {
      super._onVisibleChange();
      guarded('trail visibility', () => showTrail(this.token, this.visible));
    }

    /** @override */
    clear() {
      super.clear();
      guarded('trail clear', () => dropTrail(this.token));
    }

    /** @override */
    destroy() {
      super.destroy();
      guarded('trail clear', () => dropTrail(this.token));
    }
  }

  Object.defineProperty(MovementRuler, 'name', { value: Base.name });
  CONFIG.Token.rulerClass = MovementRuler;
  log.debug(`extended ${Base.name}`);
}
