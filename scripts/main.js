/**
 * Scorpious187's Token Movement — entry point.
 * Foundry VTT v14.
 */

import { MODULE_ID, HOOKS, SETTINGS } from './constants.js';
import { registerSettings, onRangeSettingChange, onSoundSettingChange, applyWalkSpeed } from './settings.js';
import { installTokenMixin } from './token-mixin.js';
import { installRulerMixin } from './ruler-mixin.js';
import { rangeOverlay } from './overlay.js';
import { refreshTrails, forgetTrails, trailSnapshot } from './trail.js';
import { getMovementRanges, getSpeed } from './speed.js';
import { preloadStepSounds, stepSources, stepWeight, movementSound } from './sounds.js';
import { armorClassOf, stepClassOf } from './armor.js';
import { hasWings } from './creatures.js';
import { registerTokenConfig } from './token-config.js';
import { SYSTEM_PRESETS } from './systems.js';
import { registerFollow } from './follow.js';
import { forgetRoutes } from './pathfinding.js';
import { HUD_ATTRIBUTES } from './theme.js';
import { guarded, log } from './logger.js';

/** Token fields whose change moves or resizes a pinned range. */
const RANGE_FIELDS = ['x', 'y', 'elevation', 'width', 'height', 'movementAction', '_movementHistory', 'level'];

Hooks.once('init', () => {
  registerSettings();

  game.keybindings.register(MODULE_ID, 'toggleRange', {
    name: 'S187MOVE.Keybindings.toggleRange.Name',
    hint: 'S187MOVE.Keybindings.toggleRange.Hint',
    editable: [{ key: 'KeyM' }],
    onDown: () => {
      if (!canvas.ready) return false;
      const token = canvas.tokens.controlled[0] ?? null;
      if (!token && !rangeOverlay.pinned) return false;
      rangeOverlay.togglePin(token);
      return true;
    },
  });

  registerFollow();
  registerTokenConfig();
  onSoundSettingChange(() => { if (game.ready) preloadStepSounds(); });

  game.modules.get(MODULE_ID).api = Object.freeze({
    hooks: HOOKS,
    presets: SYSTEM_PRESETS,
    getSpeed,
    getMovementRanges,
    /** What a token wears: 'unarmored', 'light', 'medium' or 'heavy'. */
    getArmorClass: (token) => armorClassOf(token),
    /** What a token's steps sound like: an armor class, or 'hooves'. */
    getStepClass: (token) => stepClassOf(token),
    /** Whether a token is heard flapping when it flies. */
    hasWings: (token) => hasWings(token),
    /**
     * What a token sounds like moving by an action (its own if none is given),
     * for this user: `{kind, sources, every, size}`, or null for silence.
     */
    getMovementSound: (token, action) => {
      const sound = movementSound(token, action);
      return sound ? { ...sound, sources: [...sound.sources] } : null;
    },
    /** The sound files a token's steps on foot are drawn from, for this user. */
    getStepSounds: (token) => [...stepSources(token)],
    /** The size a token's steps on foot are weighted for: 'large', 'huge', 'gargantuan' or null. */
    getStepWeight: (token) => stepWeight(token),
    /** Redraw the range if one is showing, e.g. after changing an actor's speed. */
    refreshRange: () => rangeOverlay.refresh(),
    /** What the range overlay is showing right now, as plain data; null if nothing. */
    rangeSnapshot: () => rangeOverlay.snapshot(),
    /** The trail drawn for a token, as plain data; null if none. */
    trailSnapshot: (token) => trailSnapshot(token),
    /** Pin (or with no argument, unpin) a token's range. */
    pinRange: (token) => rangeOverlay.togglePin(token ?? null),
  });

  log.info('Initialized');
});

// `setup`, not `init`: systems and other modules install their Token class
// during `init`, and ours has to wrap whichever one won.
Hooks.once('setup', () => {
  installTokenMixin();
  installRulerMixin();
  applyWalkSpeed();
});

Hooks.once('ready', () => {
  preloadStepSounds();

  if (game.user.isGM && !SYSTEM_PRESETS[game.system.id]
    && !game.settings.get(MODULE_ID, SETTINGS.speedPath)
    && !(game.settings.get(MODULE_ID, SETTINGS.defaultSpeed) > 0)) {
    log.warn(`no speed preset for system "${game.system.id}": set a speed data path or fallback speed `
      + 'in the module settings to see movement ranges');
  }

  log.info('Ready');
});

/* -------------------------------------------- */
/*  Keeping a pinned range honest               */
/* -------------------------------------------- */

const refreshSoon = foundry.utils.debounce(() => {
  guarded('range refresh', () => rangeOverlay.refresh());
  // Trails take their look and colour from the same settings.
  guarded('trail refresh', () => refreshTrails());
}, 50);
onRangeSettingChange(refreshSoon);

Hooks.on('updateToken', (document, changed) => {
  if (rangeOverlay.pinned?.document !== document) return;
  if (RANGE_FIELDS.some((field) => field in changed)) refreshSoon();
});

Hooks.on('controlToken', (token, controlled) => {
  if (!controlled && (rangeOverlay.pinned === token)) rangeOverlay.release(token);
});

Hooks.on('deleteToken', (document) => {
  const pinned = rangeOverlay.pinned;
  if (pinned?.document === document) rangeOverlay.release(pinned);
});

// Turn changes clear movement history, which is what "already used" reads.
// Core clears it a moment *after* the combat update, from the GM's client and
// without firing updateToken, so look again once that has had time to land.
const combatChanged = () => {
  refreshSoon();
  setTimeout(refreshSoon, 750);
};
Hooks.on('updateCombat', combatChanged);
Hooks.on('deleteCombat', combatChanged);

// Walls opening or moving changes what is reachable.
for (const hook of ['createWall', 'updateWall', 'deleteWall']) Hooks.on(hook, refreshSoon);

// Pathfinding keeps what it has worked out for the length of a drag. Anything
// that can change where a token may step throws that away: walls, other
// tokens (which block in some systems), regions, and a change of scene.
for (const hook of [
  'createWall', 'updateWall', 'deleteWall',
  'createToken', 'updateToken', 'deleteToken',
  'createRegion', 'updateRegion', 'deleteRegion',
  'updateCombat', 'canvasReady', 'canvasTearDown',
]) Hooks.on(hook, forgetRoutes);

Hooks.on('canvasTearDown', () => {
  rangeOverlay.reset();
  forgetTrails();
});

// The Character HUD recolours the interface by changing attributes on <body>.
// A range that is on screen at that moment should change with it.
Hooks.once('ready', () => {
  new MutationObserver(refreshSoon)
    .observe(document.body, { attributes: true, attributeFilter: HUD_ATTRIBUTES });
});
