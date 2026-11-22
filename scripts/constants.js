export const MODULE_ID = 'scorpious187s-token-movement';
export const LIB_ID = 'scorpious187s-lib';

/** Setting keys. Client-scoped unless noted. */
export const SETTINGS = Object.freeze({
  animationStyle: 'animationStyle',
  liftHeight: 'liftHeight',
  liftScale: 'liftScale',
  pathfinding: 'pathfinding',
  rangeOverlay: 'rangeOverlay',
  overlayStyle: 'overlayStyle',
  overlayMotion: 'overlayMotion',
  routeMarkers: 'routeMarkers',
  colorScheme: 'colorScheme',
  rangeColor: 'rangeColor',
  dashColor: 'dashColor',
  farColor: 'farColor',
  rangeOpacity: 'rangeOpacity',
  stepSounds: 'stepSounds',
  stepVolume: 'stepVolume',
  // World-scoped: these decide what the rules are, not how they look.
  stepSound: 'stepSound',
  walkSpeed: 'walkSpeed',
  speedPath: 'speedPath',
  speedUnit: 'speedUnit',
  defaultSpeed: 'defaultSpeed',
  rangeBands: 'rangeBands',
  subtractUsed: 'subtractUsed',
  combatOnly: 'combatOnly',
  maxSpaces: 'maxSpaces',
  debug: 'debug',
});

/** Foundry's own token travel speed, in grid spaces per second. */
export const CORE_WALK_SPEED = 6;

export const ANIMATION_STYLES = Object.freeze({
  hop: 'hop',
  glide: 'glide',
  none: 'none',
});

/**
 * Hooks other packages can listen to.
 *
 * getMovementRanges(tokenDocument, action, ranges)
 *   Push `{distance, color?, alpha?}` entries (distance in scene units) to
 *   replace the bands this module would draw. Leave the array empty to keep
 *   the defaults.
 *
 * step(token, index)
 *   Fired on every client each time an animated token lands on a space.
 */
export const HOOKS = Object.freeze({
  getMovementRanges: `${MODULE_ID}.getMovementRanges`,
  step: `${MODULE_ID}.step`,
});

export const BUILT_IN_STEP_SOUNDS = Object.freeze([
  `modules/${MODULE_ID}/assets/sounds/step-1.wav`,
  `modules/${MODULE_ID}/assets/sounds/step-2.wav`,
]);
