/**
 * Scoreboard V2 i18n label registration.
 * Registers scoreboard translations against the shared i18n module
 * (src/js/shared/i18n.js) and syncs the legacy ScoreboardState.currentLang
 * mirror used by the scoreboard modules.
 */
import { registerLabels, getLang } from '../shared/i18n.js';

const SCOREBOARD_LABELS = {
  en: {
    // Strain/Line Info
    currentStrain: 'Current Strain',
    trimmersLabel: 'Trimmers',

    // Time Periods
    lastHour: 'Last Hour (Completed)',
    currentHour: 'Current Hour',

    // Units
    lbs: 'lbs',
    trimmers: 'trimmers',
    hrs: 'hrs',

    // Targets & Comparisons
    ofTarget: 'vs target',
    lbsTarget: 'lbs target',
    targetRate: 'Target:',
    lbsGoal: 'lbs goal',
    vsYesterday: 'vs Yesterday',
    vs7Day: 'vs 7-Day Avg',
    vsTargetTimer: 'vs Target',

    // Statistics
    avgLbs: 'AVG',
    bestLbs: 'BEST',
    avgToday: 'Avg Today',

    // Progress Indicators
    upBy: 'Up',
    downBy: 'Down',
    onPace: 'On pace',
    hrStreak: 'hr streak',
    lbsHr: 'lbs/hr',
    ofTargetLabel: 'of Target',
    complete: 'COMPLETE',
    shiftComplete: 'SHIFT COMPLETE',

    // Status Headers
    todaysProgress: 'TODAY',
    endOfDay: 'End of day:',
    finalTotal: 'Final total:',
    chartHeader: 'HOURLY PERFORMANCE (LBS/TRIMMER)',

    // Performance Status
    aheadOfTarget: 'AHEAD OF TARGET',
    onTarget: 'ON TARGET',
    behindTarget: 'BEHIND TARGET',
    waiting: 'WAITING TO START',
    onBreak: 'ON BREAK',
    paused: 'PAUSED',
    shiftEnded: 'SHIFT ENDED',

    // Bag Timer
    bagTimer: '5KG BAG TIMER',
    remaining: 'remaining',
    overtime: 'OVERTIME',
    bagComplete: '5KG Bag Complete',
    logged: 'Logged!',
    bagsToday: 'Bags Today',
    todaysCycles: "Today's Cycles",
    noBags: 'No bags completed yet',

    // Rate Info
    strainRate: 'Strain-specific rate',
    fallbackRate: 'Using avg rate',

    // Help Text
    helpTitle: 'Understanding the Scoreboard',
    helpGreen: 'Green = Ahead (105%+)',
    helpYellow: 'Yellow = On Target (90-105%)',
    helpRed: 'Red = Behind (<90%)',

    // Order Queue
    workingOn: 'WORKING ON',
    upNext: 'UP NEXT',
    order: 'Order',
    shipment: 'Shipment',
    customer: 'Customer',
    dueDate: 'Due Date',
    estCompletion: 'Est. Completion',
    fullOrder: 'Full Order Context',

    // Scale
    scaleDisplay: 'Scale Display',
    scaleWeight: 'Scale',
    scaleConnected: 'Connected',
    scaleDisconnected: 'Disconnected'
  },

  es: {
    // Strain/Line Info
    currentStrain: 'Variedad Actual',
    trimmersLabel: 'Triminadores',

    // Time Periods
    lastHour: 'Última Hora (Completa)',
    currentHour: 'Hora Actual',

    // Units
    lbs: 'lbs',
    trimmers: 'triminadores',
    hrs: 'hrs',

    // Targets & Comparisons
    ofTarget: 'vs meta',
    lbsTarget: 'lbs meta',
    targetRate: 'Meta:',
    lbsGoal: 'lbs meta',
    vsYesterday: 'vs Ayer',
    vs7Day: 'vs Prom 7 Días',
    vsTargetTimer: 'vs Meta',

    // Statistics
    avgLbs: 'PROM',
    bestLbs: 'MEJOR',
    avgToday: 'Prom Hoy',

    // Progress Indicators
    upBy: 'Arriba',
    downBy: 'Abajo',
    onPace: 'Al ritmo',
    hrStreak: 'hrs seguidas',
    lbsHr: 'lbs/hr',
    ofTargetLabel: 'de la Meta',
    complete: 'COMPLETO',
    shiftComplete: 'TURNO COMPLETO',

    // Status Headers
    todaysProgress: 'HOY',
    endOfDay: 'Fin del día:',
    finalTotal: 'Total final:',
    chartHeader: 'RENDIMIENTO POR HORA (LBS/TRIMINADOR)',

    // Performance Status
    aheadOfTarget: 'ARRIBA DE LA META',
    onTarget: 'EN LA META',
    behindTarget: 'DEBAJO DE LA META',
    waiting: 'ESPERANDO INICIO',
    onBreak: 'EN DESCANSO',
    paused: 'PAUSADO',
    shiftEnded: 'TURNO TERMINADO',

    // Bag Timer
    bagTimer: 'TEMPORIZADOR 5KG',
    remaining: 'restante',
    overtime: 'TIEMPO EXTRA',
    bagComplete: 'Bolsa 5KG Lista',
    logged: '¡Registrado!',
    bagsToday: 'Bolsas Hoy',
    todaysCycles: 'Ciclos de Hoy',
    noBags: 'Sin bolsas completadas',

    // Rate Info
    strainRate: 'Tasa específica',
    fallbackRate: 'Usando tasa prom',

    // Help Text
    helpTitle: 'Entendiendo el Marcador',
    helpGreen: 'Verde = Adelante (105%+)',
    helpYellow: 'Amarillo = En Meta (90-105%)',
    helpRed: 'Rojo = Atrás (<90%)',

    // Order Queue
    workingOn: 'TRABAJANDO EN',
    upNext: 'SIGUIENTE',
    order: 'Pedido',
    shipment: 'Envío',
    customer: 'Cliente',
    dueDate: 'Fecha de Vencimiento',
    estCompletion: 'Tiempo Estimado',
    fullOrder: 'Contexto Completo del Pedido',

    // Scale
    scaleDisplay: 'Pantalla de Báscula',
    scaleWeight: 'Peso',
    scaleConnected: 'Conectado',
    scaleDisconnected: 'Desconectado'
  }
};

registerLabels(SCOREBOARD_LABELS);

/**
 * Scoreboard modules read ScoreboardState.currentLang as their source of
 * truth for language. Mirror the shared i18n language into state so the
 * legacy code paths keep working, and keep the two in sync on toggle.
 */
function syncState(lang) {
  if (window.ScoreboardState) {
    window.ScoreboardState.currentLang = lang;
  }
}

// Sync immediately (no-op if state.js hasn't defined window.ScoreboardState yet;
// the DOMContentLoaded handler below backstops that case) and also listen for
// subsequent language toggles.
syncState(getLang());
document.addEventListener('ro:langchange', (e) => {
  syncState(e && e.detail ? e.detail.lang : getLang());
});
// By DOMContentLoaded all classic defer scripts (including state.js) have run,
// so ScoreboardState exists — mirror the persisted language into it so initial
// renders use the correct locale.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => syncState(getLang()), { once: true });
} else {
  syncState(getLang());
}
