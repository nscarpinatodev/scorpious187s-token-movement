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
 * step(token, index, sound)
 *   Fired on every client each time an animated token lands on a space.
 *   `sound` is what the landing sounds like, `{src, size, kind}`, or null for
 *   a landing with no sound of its own: a token that glides, or a space in
 *   the middle of a horse's stride. It is the same whether or not this user
 *   has the sounds switched on.
 */
export const HOOKS = Object.freeze({
  getMovementRanges: `${MODULE_ID}.getMovementRanges`,
  getArmorClass: `${MODULE_ID}.getArmorClass`,
  step: `${MODULE_ID}.step`,
});

/** Token document flags, under this module's id. */
export const FLAGS = Object.freeze({
  /** One of STEP_CLASSES: what this token's steps sound like, whatever it is and wears. */
  armor: 'armor',
  /** One of FLIGHT_CLASSES: what this token sounds like in the air, whatever it is. */
  flight: 'flight',
});

/** What a walker is wearing, lightest first. Each has its own step sounds. */
export const ARMOR_CLASSES = Object.freeze(['unarmored', 'light', 'medium', 'heavy']);

/** Every kind of step: what a walker wears, or that it walks on hooves. */
export const STEP_CLASSES = Object.freeze([...ARMOR_CLASSES, 'hooves']);

/** What a token can be said to sound like in the air. */
export const FLIGHT_CLASSES = Object.freeze(['wings', 'none']);

/**
 * Movement actions with no footfalls: nothing touches the ground, so there is
 * no hop and no step. Everything else is assumed to be on foot, which is the
 * right guess for the actions systems add (pf2e moves tokens by "travel"
 * outside encounters).
 */
export const GLIDING_ACTIONS = Object.freeze(['fly', 'swim', 'burrow', 'drive']);

/** The gliding actions that are through the air, where wings are heard. */
export const FLYING_ACTIONS = Object.freeze(['fly']);

/** Value of the step sound setting that picks the set from the token's armor. */
export const STEP_SOUND_AUTO = 'auto';

const variants = (name, count, extension) => Object.freeze(
  Array.from({ length: count }, (_, index) => `modules/${MODULE_ID}/assets/sounds/${name}-${index + 1}.${extension}`),
);

/**
 * The built-in step sounds: one set per kind of step, recorded (see
 * assets/sounds/CREDITS.md), and `classic`, the module's original synthesised
 * tap.
 */
export const STEP_SOUND_SETS = Object.freeze({
  unarmored: variants('steps/unarmored', 4, 'ogg'),
  light: variants('steps/light', 4, 'ogg'),
  medium: variants('steps/medium', 4, 'ogg'),
  heavy: variants('steps/heavy', 4, 'ogg'),
  hooves: variants('steps/hooves', 1, 'ogg'),
  classic: variants('step', 2, 'wav'),
});

/** The built-in sounds of flight. */
export const FLIGHT_SOUND_SETS = Object.freeze({
  wings: variants('flight/wings', 1, 'ogg'),
});

/**
 * Sounds that are more than one footfall, and so are not played on every
 * space.
 *
 *   every     milliseconds of travel from one to the next, at the least. The
 *             sound starts on a landing, so it keeps time with the token; this
 *             is how long it waits before the landing it starts on again.
 *             Hooves are one stride of a gallop, three beats in 460 ms; a wing
 *             beats about once a second.
 *   recorded  the size of the creature in the recording. Big creatures sound
 *             big by being played lower than the recording; a horse is Large
 *             already, so it is only weighted when the token is bigger still.
 */
export const SOUND_RHYTHMS = Object.freeze({
  hooves: Object.freeze({ every: 420, recorded: 'large' }),
  wings: Object.freeze({ every: 900, recorded: 'large' }),
});
