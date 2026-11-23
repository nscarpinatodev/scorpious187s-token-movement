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
  stepSoundSet: 'stepSoundSet',
  stepWeight: 'stepWeight',
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
 * getArmorClass(tokenDocument, result)
 *   Set `result.armor` to 'unarmored', 'light', 'medium' or 'heavy' to say
 *   what a token's steps sound like. Leave it alone to keep what the module
 *   reads from the actor. A class set on the token itself comes first.
 *
 * step(token, index)
 *   Fired on every client each time an animated token lands on a space.
 */
export const HOOKS = Object.freeze({
  getMovementRanges: `${MODULE_ID}.getMovementRanges`,
  getArmorClass: `${MODULE_ID}.getArmorClass`,
  step: `${MODULE_ID}.step`,
});

/** Token document flags, under this module's id. */
export const FLAGS = Object.freeze({
  /** One of ARMOR_CLASSES: what this token sounds like, whatever its actor wears. */
  armor: 'armor',
});

/** What a walker is wearing, lightest first. Each has its own step sounds. */
export const ARMOR_CLASSES = Object.freeze(['unarmored', 'light', 'medium', 'heavy']);

/** Value of the step sound setting that picks the set from the token's armor. */
export const STEP_SOUND_AUTO = 'auto';

const variants = (name, count, extension) => Object.freeze(
  Array.from({ length: count }, (_, index) => `modules/${MODULE_ID}/assets/sounds/${name}-${index + 1}.${extension}`),
);

/**
 * The built-in step sounds: one set per armor class, recorded (see
 * assets/sounds/CREDITS.md), and `classic`, the module's original synthesised
 * tap.
 */
export const STEP_SOUND_SETS = Object.freeze({
  unarmored: variants('steps/unarmored', 4, 'ogg'),
  light: variants('steps/light', 4, 'ogg'),
  medium: variants('steps/medium', 4, 'ogg'),
  heavy: variants('steps/heavy', 4, 'ogg'),
  classic: variants('step', 2, 'wav'),
});
