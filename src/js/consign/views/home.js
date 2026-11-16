/** Home: placeholder until the work cards land. */
import { t } from '../../shared/i18n.js';
import { esc } from '../format.js';

export function mount(root) {
  const render = () => { root.innerHTML = `<h2 class="cs-h2">${esc(t('title'))}</h2>`; };
  render();
  return { rerender: render };
}
