import { MODULE_ID, SETTINGS, ANIMATION_STYLES, CORE_WALK_SPEED, STEP_SOUND_AUTO } from './constants.js';

const L = (key) => `S187MOVE.Settings.${key}`;

/** Read a setting, tolerating calls made before registration. */
export function setting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

/**
 * Walk speed. Foundry has no setting for how fast tokens travel; the figure
 * lives in CONFIG.Token.movement.defaultSpeed, and core and the game systems
 * all read it from there. So that is where this setting is applied: every
 * movement action keeps its own multiplier (swimming and crawling at half
 * speed, and so on) on top of it.
 *
 * At Foundry's own value the CONFIG entry is left exactly as it was found, so
 * a system or module that has set its own speed is not overruled by default.
 */
let configuredSpeed = null;
export function applyWalkSpeed() {
  const movement = CONFIG.Token.movement;
  configuredSpeed ??= movement.defaultSpeed;
  const chosen = Number(setting(SETTINGS.walkSpeed));
  movement.defaultSpeed = (chosen > 0) && (chosen !== CORE_WALK_SPEED) ? chosen : configuredSpeed;
}

/** Callbacks run whenever a setting that affects the range overlay changes. */
const rangeListeners = new Set();
export function onRangeSettingChange(fn) {
  rangeListeners.add(fn);
}
function rangeChanged() {
  for (const fn of rangeListeners) fn();
}

/** Callbacks run when the choice of step sound changes, to fetch the new files. */
const soundListeners = new Set();
export function onSoundSettingChange(fn) {
  soundListeners.add(fn);
}
function soundChanged() {
  for (const fn of soundListeners) fn();
}

export function registerSettings() {
  const { ColorField } = foundry.data.fields;
  const register = (key, data) => game.settings.register(MODULE_ID, key, {
    name: L(`${key}.Name`),
    hint: L(`${key}.Hint`),
    config: true,
    ...data,
  });

  // ---- Animation (per user: how a move looks is a personal preference, and
  // anyone sensitive to motion needs to be able to switch it off for themselves)
  register(SETTINGS.animationStyle, {
    scope: 'client',
    type: String,
    default: ANIMATION_STYLES.hop,
    choices: {
      [ANIMATION_STYLES.hop]: L('animationStyle.Hop'),
      [ANIMATION_STYLES.glide]: L('animationStyle.Glide'),
      [ANIMATION_STYLES.none]: L('animationStyle.None'),
    },
  });
  register(SETTINGS.liftHeight, {
    scope: 'client',
    type: Number,
    default: 0.25,
    range: { min: 0, max: 0.6, step: 0.05 },
  });
  register(SETTINGS.liftScale, {
    scope: 'client',
    type: Number,
    default: 0.1,
    range: { min: 0, max: 0.3, step: 0.02 },
  });

  // ---- Walk speed (world: every client has to animate a move at the same
  // pace, or the token would be in different places on different screens)
  register(SETTINGS.walkSpeed, {
    scope: 'world',
    type: Number,
    default: CORE_WALK_SPEED,
    range: { min: 2, max: 16, step: 0.5 },
    onChange: applyWalkSpeed,
  });

  // ---- Step sounds
  register(SETTINGS.stepSounds, { scope: 'client', type: Boolean, default: true });
  register(SETTINGS.stepVolume, {
    scope: 'client',
    type: Number,
    default: 0.4,
    range: { min: 0, max: 1, step: 0.05 },
  });
  register(SETTINGS.stepSoundSet, {
    scope: 'client',
    type: String,
    default: STEP_SOUND_AUTO,
    choices: {
      [STEP_SOUND_AUTO]: L('stepSoundSet.Auto'),
      unarmored: L('stepSoundSet.Unarmored'),
      light: L('stepSoundSet.Light'),
      medium: L('stepSoundSet.Medium'),
      heavy: L('stepSoundSet.Heavy'),
      classic: L('stepSoundSet.Classic'),
    },
    onChange: soundChanged,
  });
  register(SETTINGS.stepSound, {
    scope: 'world',
    type: String,
    default: '',
    filePicker: 'audio',
    onChange: soundChanged,
  });

  // ---- Pathfinding (per user: it changes how your own drags are planned)
  register(SETTINGS.pathfinding, { scope: 'client', type: Boolean, default: true });

  // ---- Range overlay: appearance (per user)
  register(SETTINGS.rangeOverlay, {
    scope: 'client', type: Boolean, default: true, onChange: rangeChanged,
  });
  register(SETTINGS.overlayStyle, {
    scope: 'client',
    type: String,
    default: 'tiles',
    choices: {
      tiles: L('overlayStyle.Tiles'),
      flat: L('overlayStyle.Flat'),
    },
    onChange: rangeChanged,
  });
  register(SETTINGS.overlayMotion, {
    scope: 'client', type: Boolean, default: true, onChange: rangeChanged,
  });
  register(SETTINGS.routeMarkers, {
    scope: 'client', type: Boolean, default: true, onChange: rangeChanged,
  });
  register(SETTINGS.colorScheme, {
    scope: 'client',
    type: String,
    default: 'auto',
    choices: {
      auto: L('colorScheme.Auto'),
      hud: L('colorScheme.Hud'),
      custom: L('colorScheme.Custom'),
    },
    onChange: rangeChanged,
  });
  register(SETTINGS.rangeColor, {
    scope: 'client',
    type: new ColorField({ nullable: false, initial: '#3ddc84' }),
    onChange: rangeChanged,
  });
  register(SETTINGS.dashColor, {
    scope: 'client',
    type: new ColorField({ nullable: false, initial: '#ff9d2e' }),
    onChange: rangeChanged,
  });
  register(SETTINGS.farColor, {
    scope: 'client',
    type: new ColorField({ nullable: false, initial: '#ff5a5a' }),
    onChange: rangeChanged,
  });
  register(SETTINGS.rangeOpacity, {
    scope: 'client',
    type: Number,
    default: 0.28,
    range: { min: 0.05, max: 0.6, step: 0.01 },
    onChange: rangeChanged,
  });

  // ---- Range overlay: rules (world)
  register(SETTINGS.speedPath, {
    scope: 'world', type: String, default: '', onChange: rangeChanged,
  });
  register(SETTINGS.speedUnit, {
    scope: 'world',
    type: String,
    default: 'distance',
    choices: {
      distance: L('speedUnit.Distance'),
      spaces: L('speedUnit.Spaces'),
    },
    onChange: rangeChanged,
  });
  register(SETTINGS.defaultSpeed, {
    scope: 'world', type: Number, default: 0, onChange: rangeChanged,
  });
  register(SETTINGS.rangeBands, {
    scope: 'world', type: String, default: '', onChange: rangeChanged,
  });
  register(SETTINGS.subtractUsed, {
    scope: 'world', type: Boolean, default: true, onChange: rangeChanged,
  });
  register(SETTINGS.combatOnly, {
    scope: 'world', type: Boolean, default: false, onChange: rangeChanged,
  });
  register(SETTINGS.maxSpaces, {
    scope: 'world',
    type: Number,
    default: 30,
    range: { min: 5, max: 60, step: 1 },
    onChange: rangeChanged,
  });

  register(SETTINGS.debug, { scope: 'client', type: Boolean, default: false });
}
