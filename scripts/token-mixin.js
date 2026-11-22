/**
 * The one place this module touches core's Token class.
 *
 * Rather than patching prototype methods (or depending on libWrapper), the
 * configured Token class is subclassed at `setup` — after every system and
 * module has had its `init` to install its own class. Whatever is configured
 * by then (Token, Token5e, TokenPF2e…) becomes the base, so system behaviour
 * is inherited rather than fought.
 */

import { MODULE_ID } from './constants.js';
import { guarded, log } from './logger.js';
import {
  shouldDecorate, decorate, onLinkSettled, applyLift, captureBaseScale,
} from './animation.js';
import { rangeOverlay } from './overlay.js';
import { routeAround } from './pathfinding.js';
import { advanceTrail } from './trail.js';

const MIXED = Symbol.for(`${MODULE_ID}.mixed`);

export function installTokenMixin() {
  const Base = CONFIG.Token.objectClass;
  if (!Base || Base[MIXED]) return;

  class MovementToken extends Base {
    static [MIXED] = true;

    /** @override */
    animate(to, options = {}) {
      const decorated = guarded('movement animation setup',
        () => (shouldDecorate(this, to, options) ? decorate(this, to, options) : null), null);
      const promise = super.animate(to, decorated ?? options);
      if (decorated) {
        const settle = () => guarded('movement animation settle', () => onLinkSettled(this));
        promise.then(settle, settle);
      }
      return promise;
    }

    /** @override */
    _refreshPosition() {
      super._refreshPosition();
      guarded('lift', () => applyLift(this));
      guarded('trail progress', () => advanceTrail(this));
    }

    /** @override */
    _refreshMeshSizeAndScale() {
      super._refreshMeshSizeAndScale();
      guarded('lift scale', () => captureBaseScale(this));
    }

    /**
     * Whatever the class below finds is used as it is unless it was stopped
     * short, in which case a way round is looked for.
     * @override
     */
    findMovementPath(waypoints, options = {}) {
      const direct = super.findMovementPath(waypoints, options);
      return guarded('pathfinding',
        () => routeAround(this, waypoints, options, direct, (w, o) => super.findMovementPath(w, o)),
        direct);
    }

    /**
     * Core refreshes the ruler whenever the route it is planning for a drag
     * changes, so this is where the overlay hears about a new route.
     * @override
     */
    _refreshRuler() {
      super._refreshRuler();
      guarded('range overlay', () => rangeOverlay.onPlanChanged(this));
    }

    /** @override */
    _initializeDragLeft(event) {
      super._initializeDragLeft(event);
      guarded('range overlay', () => rangeOverlay.onDragStart(this));
    }

    /** @override */
    _finalizeDragLeft(event) {
      super._finalizeDragLeft(event);
      guarded('range overlay', () => rangeOverlay.onDragEnd(this));
    }
  }

  // Keep the base's class name, so anything that reports or keys off
  // `token.constructor.name` sees the same value with or without this module.
  Object.defineProperty(MovementToken, 'name', { value: Base.name });

  CONFIG.Token.objectClass = MovementToken;
  log.debug(`extended ${Base.name}`);
}
