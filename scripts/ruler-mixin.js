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
 * The ruler class is extended the same way the token class is (see
 * token-mixin.js), so a system's ruler stays the base and gets its say first.
 */

import { MODULE_ID } from './constants.js';
import { guarded, log } from './logger.js';
import { rangeOverlay } from './overlay.js';
import { routesStyled } from './overlay-render.js';
import { updateTrail, showTrail, dropTrail } from './trail.js';

const MIXED = Symbol.for(`${MODULE_ID}.ruler`);

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

    /** @override */
    _getGridHighlightStyle(waypoint, offset) {
      const style = super._getGridHighlightStyle(waypoint, offset);
      return this.#ours(waypoint) ? { ...style, alpha: 0 } : style;
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
