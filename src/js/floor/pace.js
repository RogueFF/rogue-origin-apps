/**
 * The pace tile — pounds banked so far against where the day should be
 * right now.
 *
 * `actual` and `goal` are the tile's meter: today's whole target and the
 * pounds against it. `cumulativeTarget` is a second, narrower number — what
 * the hours worked so far should have produced — and it is what the
 * behind/ahead verdict in `#paceLine` is measured against, not the full
 * daily goal. Conflating the two would read every morning as badly behind:
 * the day's full target still has most of its hours left to earn it.
 */
import { num } from './format.js';

/** `#paceLine`'s body: a behind/ahead/on-pace verdict, then the projection. */
function buildPaceLine({ diff, projected, t }) {
  const frag = document.createDocumentFragment();
  const absDiff = Math.abs(diff);

  if (absDiff < 0.05) {
    frag.appendChild(document.createTextNode(t('onPace')));
  } else {
    const amount = document.createElement('span');
    amount.className = 'num';
    amount.textContent = `${num(absDiff)} lb`;
    frag.appendChild(amount);
    frag.appendChild(document.createTextNode(` ${diff < 0 ? t('behindPace') : t('aheadPace')}`));
  }

  if (projected > 0) {
    frag.appendChild(document.createTextNode(` · ${t('projected')} `));
    const proj = document.createElement('span');
    proj.className = 'num';
    proj.textContent = num(projected, 0);
    frag.appendChild(proj);
  }

  return frag;
}

/**
 * @param {{
 *   paceActual: HTMLElement, paceGoal: HTMLElement, paceFill: HTMLElement,
 *   paceTick: HTMLElement, paceMeter: HTMLElement, paceLine: HTMLElement,
 * }} els
 * @param {{ actual: number, goal: number, cumulativeTarget: number, projected: number, t: (key: string) => string }} opts
 */
export function renderPace(els, {
  actual = 0,
  goal = 0,
  cumulativeTarget = 0,
  projected = 0,
  t = (k) => k,
} = {}) {
  if (goal <= 0) {
    // No goal yet — no shift start, no trimmers logged today — so there is
    // nothing to plot against; read as empty rather than a divide-by-zero
    // 0% bar.
    els.paceActual.textContent = '—';
    els.paceGoal.textContent = '';
    els.paceMeter.hidden = true;
    els.paceLine.textContent = t('noGoalYet');
    return;
  }

  els.paceMeter.hidden = false;
  els.paceActual.textContent = num(actual);
  els.paceGoal.textContent = `/ ${num(goal)}`;
  els.paceFill.style.width = `${Math.min(100, (actual / goal) * 100)}%`;

  els.paceTick.hidden = cumulativeTarget <= 0;
  if (!els.paceTick.hidden) {
    els.paceTick.style.left = `${Math.min(100, (cumulativeTarget / goal) * 100)}%`;
  }

  els.paceLine.replaceChildren(buildPaceLine({ diff: actual - cumulativeTarget, projected, t }));
}
