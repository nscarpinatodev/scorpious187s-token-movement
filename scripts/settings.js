import { MODULE_ID, SETTINGS, ANIMATION_STYLES } from './constants.js';

const L = (key) => `S187MOVE.Settings.${key}`;

/** Read a setting, tolerating calls made before registration. */
export function setting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

/** Callbacks run whenever a setting that affects the range overlay changes. */
const rangeListeners = new Set();
export function onRangeSettingChange(fn) {
  rangeListeners.add(fn);
}
function rangeChanged() {
  for (const fn of rangeListeners) fn();
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

  // ---- Step sounds
  register(SETTINGS.stepSounds, { scope: 'client', type: Boolean, default: true });
  register(SETTINGS.stepVolume, {
    scope: 'client',
    type: Number,
    default: 0.4,
    range: { min: 0, max: 1, step: 0.05 },
  });
  register(SETTINGS.stepSound, {
    scope: 'world',
    type: String,
    default: '',
    filePicker: 'audio',
  });

  // ---- Range overlay: appearance (per user)
  register(SETTINGS.rangeOverlay, {
    scope: 'client', type: Boolean, default: true, onChange: rangeChanged,
  });
  register(SETTINGS.colorScheme, {
    scope: 'client',
    type: String,
    default: 'hud',
    choices: {
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
