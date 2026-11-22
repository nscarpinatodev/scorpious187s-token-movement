import { MODULE_ID, FLAGS, ARMOR_CLASSES } from './constants.js';
import { guarded } from './logger.js';

const FIELD = `flags.${MODULE_ID}.${FLAGS.armor}`;
const L = (key) => game.i18n.localize(`S187MOVE.TokenConfig.${key}`);

/**
 * Add "Step sound" to Token Configuration: most monsters and NPCs carry no
 * armor item for the module to read, so a GM needs somewhere to say that the
 * knight clanks. The field is an ordinary form field named after the flag, so
 * the sheet saves it with everything else; the blank choice leaves the flag
 * empty, which means "go by what the actor wears".
 * @param {object} app        The configuration sheet
 * @param {HTMLElement} html  Its root element
 */
function addArmorField(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const tab = root?.querySelector('.tab[data-tab="identity"]') ?? root?.querySelector('.tab[data-tab="appearance"]');
  if (!tab || tab.querySelector(`[name="${FIELD}"]`)) return;

  const document = app.token ?? app.document ?? app.actor?.prototypeToken;
  const current = document?.flags?.[MODULE_ID]?.[FLAGS.armor] ?? '';

  const group = window.document.createElement('div');
  group.className = 'form-group';
  const label = window.document.createElement('label');
  label.textContent = L('armor.Label');
  const fields = window.document.createElement('div');
  fields.className = 'form-fields';
  const select = window.document.createElement('select');
  select.name = FIELD;
  for (const value of ['', ...ARMOR_CLASSES]) {
    const option = window.document.createElement('option');
    option.value = value;
    option.textContent = L(`armor.${value || 'detect'}`);
    option.selected = value === current;
    select.append(option);
  }
  fields.append(select);
  const hint = window.document.createElement('p');
  hint.className = 'hint';
  hint.textContent = L('armor.Hint');
  group.append(label, fields, hint);
  tab.append(group);
  app.setPosition?.({ height: 'auto' });
}

export function registerTokenConfig() {
  for (const hook of ['renderTokenConfig', 'renderPrototypeTokenConfig']) {
    Hooks.on(hook, (app, html) => guarded('token config field', () => addArmorField(app, html)));
  }
}
