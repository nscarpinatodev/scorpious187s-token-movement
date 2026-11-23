import { MODULE_ID, FLAGS, STEP_CLASSES, FLIGHT_CLASSES } from './constants.js';
import { guarded } from './logger.js';

const L = (key) => game.i18n.localize(`S187MOVE.TokenConfig.${key}`);

/**
 * The fields added to Token Configuration, each a choice saved as a flag. The
 * blank choice leaves the flag empty, which means "work it out".
 *
 *   armor   What the token's steps sound like. Most monsters and NPCs carry no
 *           armor item for the module to read, so a GM needs somewhere to say
 *           that the knight clanks; and a creature whose name does not say it
 *           has hooves needs somewhere to be told.
 *   flight  What the token sounds like in the air. Wings are guessed from the
 *           name; this is where a winged thing with an unhelpful name gets
 *           them, and where a "Bat" that is a man in a cape loses them.
 */
const FIELDS = Object.freeze([
  { flag: FLAGS.armor, choices: STEP_CLASSES },
  { flag: FLAGS.flight, choices: FLIGHT_CLASSES },
]);

/**
 * Add one choice to a tab. It is an ordinary form field named after the flag,
 * so the sheet saves it with everything else.
 */
function addField(tab, document, { flag, choices }) {
  const name = `flags.${MODULE_ID}.${flag}`;
  if (tab.querySelector(`[name="${name}"]`)) return;
  const current = document?.flags?.[MODULE_ID]?.[flag] ?? '';

  const group = window.document.createElement('div');
  group.className = 'form-group';
  const label = window.document.createElement('label');
  label.textContent = L(`${flag}.Label`);
  const fields = window.document.createElement('div');
  fields.className = 'form-fields';
  const select = window.document.createElement('select');
  select.name = name;
  for (const value of ['', ...choices]) {
    const option = window.document.createElement('option');
    option.value = value;
    option.textContent = L(`${flag}.${value || 'detect'}`);
    option.selected = value === current;
    select.append(option);
  }
  fields.append(select);
  const hint = window.document.createElement('p');
  hint.className = 'hint';
  hint.textContent = L(`${flag}.Hint`);
  group.append(label, fields, hint);
  tab.append(group);
}

/**
 * Add "Step sound" and "Flight sound" to Token Configuration.
 * @param {object} app        The configuration sheet
 * @param {HTMLElement} html  Its root element
 */
function addFields(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const tab = root?.querySelector('.tab[data-tab="identity"]') ?? root?.querySelector('.tab[data-tab="appearance"]');
  if (!tab) return;
  const document = app.token ?? app.document ?? app.actor?.prototypeToken;
  for (const field of FIELDS) addField(tab, document, field);
  app.setPosition?.({ height: 'auto' });
}

export function registerTokenConfig() {
  for (const hook of ['renderTokenConfig', 'renderPrototypeTokenConfig']) {
    Hooks.on(hook, (app, html) => guarded('token config field', () => addFields(app, html)));
  }
}
