/**
 * Every string the shell itself shows, in English and Spanish: the rail, the
 * topbar controls and the unlock dialog. App screens register their own labels.
 *
 * Pure, like nav.js, so tests/shell-labels.test.mjs can check Spanish parity.
 * English app names come from NAV so there is one place to rename an app.
 */
import { NAV } from './nav.js';

const navEn = Object.fromEntries(NAV.flatMap((group) => [
  [`shell.group.${group.id}`, group.group],
  ...group.items.map((item) => [`shell.nav.${item.id}`, item.label]),
]));

export const SHELL_LABELS = {
  en: {
    ...navEn,
    'shell.connecting': 'Connecting…',
    'shell.menu': 'Open apps menu',
    'shell.themeToLight': 'Switch to light theme',
    'shell.themeToDark': 'Switch to dark theme',
    'shell.langButton': 'ES',
    'shell.langLabel': 'Cambiar a español',
    'unlock.title': 'Unlock',
    'unlock.reason': 'This needs the shared password. It is the same one Wholesale and Consignment use, and it stays on this device.',
    'unlock.placeholder': 'Password',
    'unlock.inputLabel': 'Shared password',
    'unlock.cancel': 'Cancel',
    'unlock.submit': 'Unlock',
    'unlock.empty': 'Enter the shared password.',
    'unlock.wrong': 'That password did not match.',
  },
  es: {
    'shell.group.floor': 'Piso',
    'shell.group.office': 'Oficina',
    'shell.nav.hub': 'Hub',
    'shell.nav.floor-manager': 'Gerente de Piso',
    'shell.nav.floor-manager-new': 'Gerente de Piso (nuevo)',
    'shell.nav.scoreboard': 'Marcador',
    'shell.nav.scale-display': 'Pantalla de Báscula',
    'shell.nav.supersack-tracker': 'Rastreador de Supersacos',
    'shell.nav.supersack-analytics': 'Análisis de Supersacos',
    'shell.nav.wholesale': 'Mayoreo',
    'shell.nav.consignment': 'Consignación',
    'shell.nav.supply-kanban': 'Kanban de Insumos',
    'shell.nav.tag-desk': 'Tag Desk (beta)',
    'shell.nav.sop-manager': 'Procedimientos (SOP)',
    'shell.nav.complaints': 'Quejas',
    'shell.connecting': 'Conectando…',
    'shell.menu': 'Abrir el menú de apps',
    'shell.themeToLight': 'Cambiar a tema claro',
    'shell.themeToDark': 'Cambiar a tema oscuro',
    'shell.langButton': 'EN',
    'shell.langLabel': 'Switch to English',
    'unlock.title': 'Desbloquear',
    'unlock.reason': 'Esto necesita la contraseña compartida. Es la misma que usan Mayoreo y Consignación, y se guarda solo en este equipo.',
    'unlock.placeholder': 'Contraseña',
    'unlock.inputLabel': 'Contraseña compartida',
    'unlock.cancel': 'Cancelar',
    'unlock.submit': 'Desbloquear',
    'unlock.empty': 'Escribe la contraseña compartida.',
    'unlock.wrong': 'Esa contraseña no coincide.',
  },
};

/** One shell string in a language, falling back to English, then to the key. */
export function label(lang, key) {
  return SHELL_LABELS[lang]?.[key] ?? SHELL_LABELS.en[key] ?? key;
}
