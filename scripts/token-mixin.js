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

/**
 * The token a drag is moving, which is not always the one it began on.
 *
 * Core plans a route for each token in the drag, and normally the token under
 * the pointer is one of them. Another module can hand the drag to a different
 * token before it starts: Token Mounting does, so that dragging a rider drags
 * its mount. The range to show is then that token's, and it is that token
 * whose route core goes on to plan.
 * @param {Token} token   The token the drag began on
 * @param {object} event  The drag event, whose data lists the tokens core is dragging
 * @returns {Token}
 */
function draggedToken(token, event) {
  const contexts = event?.interactionData?.contexts;
  if (!contexts || contexts[token.document.id]) return token;
  return Object.values(contexts)[0]?.token ?? token;
}

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
      guarded('range overlay', () => rangeOverlay.onDragStart(draggedToken(this, event)));
    }

    /** @override */
    _finalizeDragLeft(event) {
      super._finalizeDragLeft(event);
      guarded('range overlay', () => rangeOverlay.onDragEnd(draggedToken(this, event)));
    }
  }

  // Keep the base's class name, so anything that reports or keys off
  // `token.constructor.name` sees the same value with or without this module.
  Object.defineProperty(MovementToken, 'name', { value: Base.name });

  CONFIG.Token.objectClass = MovementToken;
  log.debug(`extended ${Base.name}`);
}
