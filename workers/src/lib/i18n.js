/**
 * Harvest UI strings — Spanish default, English on request.
 *
 * The harvest crew works in Spanish, so ES is the default and EN is the
 * fallback, not the other way round. Register follows the Riego crew bot:
 * casual Mexican Spanish, informal "tú", "Zona 14" rather than "Sector".
 *
 * CREW VOCABULARY (confirmed with Koa 2026-08-24 — these are the words said
 * out loud, not textbook translations):
 *   bin          -> caja / cajas
 *   supersack    -> bolsa
 *   water spider -> kept in English; it is a job title, not a description
 *   trailer      -> traila
 *
 * "Tops" and "smalls" stay English: they are product tiers used on paperwork,
 * in the tracker and with buyers, so translating them here would break the
 * link to everything downstream.
 *
 * Language never rides in the QR payload — the codes stay short, and ES is the
 * default anyway. ?lang=en switches, and the choice sticks in a cookie.
 */

export const DEFAULT_LANG = 'es';
export const LANGS = ['es', 'en'];

const S = {
  es: {
    // — chrome —
    langOther: 'English', langOtherCode: 'en',

    // — zone entry —
    entered: '✅ Entraste a {zone}',
    cut: 'Corte {n}',
    prevClosed: 'Zona anterior <strong>{lot}</strong> cerrada automáticamente.',
    noPrior: 'No había ninguna zona abierta.',
    howManyCutters: '¿Cuántos cortadores hay ahora?',
    viewLog: 'Ver registro →',
    alreadyEntered: 'Ya entraste a {zone}',
    alreadyEnteredAt: 'Entraste a las {t} UTC — escanea otra vez en unos minutos si querías volver a entrar.',

    // — cultivar picker —
    nCultivars: '{n} cultivares plantados aquí',
    whichCutting: '¿Cuál estás cortando?',

    // — headcount —
    loggedCutters: 'Anotado: {n} cortadores',
    loggedCutter: 'Anotado: 1 cortador',
    wrongNumber: '¿Número equivocado? Toca el correcto:',
    viewStatus: 'Ver estado →',

    // — barn intake —
    barnIntake: 'Recibo de Cargas',
    activeNow: 'Zona activa: <strong>{lot}</strong> (corte {n})',
    noZoneOpen: 'No hay ninguna zona abierta — escoge una abajo.',
    zone: 'Zona',
    binsOnLoad: '¿Cuántas cajas en esta carga?',
    logLoad: 'Anotar carga',
    loggedLoad: 'Anotado: {bins} cajas → {zone}',
    loadNumToday: 'Carga #{n} hoy para {zone}',
    noSessionWarn: '⚠️ No había sesión abierta para {zone} — se anotó sin lote.',
    justMoved: '↩️ La cuadrilla acaba de entrar a {newZone}. Si esta traila se cargó en <strong>{prevZone}</strong>, déjala así — ya viene seleccionada.',
    graceAttributed: '↩️ Anotado al lote de <strong>{zone}</strong> (corte {n}), que acaba de cerrar — la traila ya venía en camino.',
    logAnother: 'Anotar otra carga →',
    crewChanged: '¿Cambió la cuadrilla? →',

    // — crew —
    crew: 'Cuadrilla',
    crewSub: 'Actualiza cuando cambie — no por horario',
    rosterSince: 'Cuadrilla actual, puesta el {t} UTC. Cambia solo lo que cambió.',
    rosterNone: 'Todavía no hay cuadrilla. Pon quién está trabajando.',
    roleDrivers: 'Choferes', whereDrivers: 'Campo ↔ bodega',
    roleCutterWS: 'Water spiders de corte', whereCutterWS: 'Campo — cajas a la traila',
    roleHangers: 'Colgadores', whereHangers: 'Bodega',
    roleHangingWS: 'Water spiders de colgado', whereHangingWS: 'Bodega — cajas a los colgadores',
    note: 'Nota', noteHint: '(opcional — ej. "chofer se fue a trim")',
    saveCrew: 'Guardar cuadrilla',
    cuttersNotHere: 'Los cortadores no van aquí — se cuentan con el escaneo de zona.',
    crewUpdated: 'Cuadrilla actualizada.',
    crewNoChange: 'Sin cambios — la cuadrilla quedó igual.',
    changeAgain: 'Cambiar otra vez →',
    toBarnIntake: 'Recibo de cargas →',

    // — takedown / tags —
    printTags: 'Imprimir Etiquetas',
    pickLotHelp: 'Escoge el lote que <strong>está bajando ahora</strong> — compáralo con la cinta de color en el rack. No es la zona que se está cortando hoy; el material se embolsa ~{n} días después del corte.',
    noLots: 'No hay lotes de los últimos {n} días, así que no hay nada que bajar. Escanea una zona primero.',
    badgeReady: 'LISTO', badgeStarted: 'EMPEZADO', badgeGreen: 'MUY VERDE', badgeOld: 'MUY TARDE',
    noteReady: '{d}d secando — listo',
    noteGreen: 'apenas {d}d secando — muy verde para estar bajando (ciclo ~{typical}d)',
    noteStarted: 'ya se etiquetaron {n} bolsas de este lote',
    noteOld: '{d}d secando — pasado del tiempo normal, revisa que sea correcto',
    cultivar: 'Cultivar', cultivarHint: '(del lote — cámbialo solo si está mal)',
    startTakedown: 'Empezar bajada →',
    printTag: 'IMPRIMIR ETIQUETA',
    printing: 'IMPRIMIENDO…', voiding: 'ANULANDO…',
    tagsForLot: '<strong>{n}</strong> etiquetas impresas para este lote',
    tagForLot: '<strong>1</strong> etiqueta impresa para este lote',
    lastTag: 'Última: <strong>#&nbsp;{id}</strong>',
    noTagsYet: 'Todavía no hay etiquetas',
    reprint: 'Reimprimir', void: 'Anular',
    printSeveral: 'Imprimir varias a la vez',
    printSeveralHelp: 'Solo si estás etiquetando bolsas ya llenas. Las etiquetas de más hay que anularlas o la cuenta del lote se desajusta.',
    printBatch: 'Imprimir tanda',
    changeLot: '← Cambiar lote', viewTags: 'Ver etiquetas →',
    confirmLot: '{lot}\n{note}\n\n¿Etiquetar bolsas con este lote de todos modos?',
    confirmVoid: '¿Anular la etiqueta # {id}?\n\nÚsalo si salió una etiqueta sin bolsa. El número se retira y no se vuelve a usar.',
    printFailed: 'No se pudo imprimir: {e}\n\nNo se etiquetó nada — inténtalo otra vez.',
    voidFailed: 'No se pudo anular: {e}',

    // — sack detail —
    sack: 'Bolsa',
    zoneCut: 'Zona <strong>{zone}</strong> · Corte {n}',
    harvested: 'Cosechada {d}',
    today: 'hoy', dayAgo: 'hace 1 día', daysAgo: 'hace {n} días',
    notOpened: 'Todavía sin abrir.',
    voidedNoOpen: 'Esta bolsa fue anulada — el número se retiró y no hay bolsa que abrir.',
    openSack: 'ABRIR BOLSA',
    sackOpened: 'Bolsa abierta.',
    alreadyOpen: 'Esta bolsa ya estaba abierta.',
    weightsAllocated: 'Repartido de lo que salió del piso ese día',
    weightsMeasured: 'Pesado aparte',
    weightsPending: 'Los pesos se reparten cuando cierre el día.',
    openedAt: 'Abierta el {t}',
    weights: '{tops} lb tops · {smalls} lb smalls',
    topsLbs: 'Tops (lb)', smallsLbs: 'Smalls (lb)',
    recordWeights: 'Guardar pesos',
    weightsRecorded: 'Pesos guardados.',
    reprintTag: 'Reimprimir etiqueta →',
    // — full lineage on scan —
    secOrigin: 'De dónde viene', secBarn: 'En la bodega', secWeights: 'Pesos', secNotes: 'Notas',
    planted: 'Plantado', growTime: '{n} días de crecimiento',
    area: 'Superficie', areaVal: '{ac} ac · ~{plants} plantas',
    dryingFor: 'Secando {n} días', dryingOne: 'Secando 1 día', dryingToday: 'Entró hoy',
    lotTotal: 'Este lote: {n} bolsas etiquetadas',
    lotTotalOne: 'Este lote: 1 bolsa etiquetada',
    addNote: 'Agregar nota', notePlaceholder: 'ej. mancha mojada en el fondo',
    saveNote: 'Guardar nota', noNotes: 'Sin notas todavía.',
    noteSaved: 'Nota guardada.', noteEmpty: 'Escribe algo antes de guardar.',
    approx: 'aprox.',
    // — sack scan page: state pill, tiles, journey, weights bar —
    stateUnopened: 'SIN ABRIR', stateOpened: 'ABIERTA', stateVoided: 'ANULADA',
    kSinceCut: 'Desde el corte', kInLot: 'En el lote', kSacks: 'bolsas', kSack: 'bolsa',
    daysShort: '{n} d',
    tlPlanted: 'Plantado', tlCut: 'Corte', tlBagged: 'Embolsada', tlOpened: 'Abierta', tlToday: 'Hoy',
    tlGrow: '{d} creciendo', tlRack: '{d} en el rack', tlSack: '{d} en bolsa',
    tlNoPlant: 'sin fecha de siembra', tlNoDates: 'Sin fechas todavía.',
    wTotal: 'tops + smalls', wFull: 'bolsa llena',
    wRecovered: '{pct}% de los {fill} lb de la bolsa salió como tops + smalls',
    srcAllocatedBadge: 'REPARTIDO', srcMeasuredBadge: 'PESADO',
    // — buscar bolsa —
    findSack: 'Buscar bolsa',
    findHelp: 'Escanea la etiqueta o escribe el número — nada más <strong>7</strong>, o <strong>SLIFT-7</strong>, o completo <strong>26-SLIFT-7</strong>.',
    findPlaceholder: '7',
    findAmbiguous: 'El número <strong>{n}</strong> existe en varios cultivares. ¿Cuál es?',
    findGo: 'Buscar',
    findNotFound: 'No existe la bolsa <strong>{id}</strong>. Revisa el número en la etiqueta.',
    findRecent: 'Últimas etiquetadas',
    findLink: 'Buscar bolsa →',
    findUnreadable: '¿Etiqueta rota o borrada? Si no se alcanza a leer el número, la bolsa no se puede identificar sola — búscala por el lote de donde salió.',

    // — errors —
    error: 'Error',
    checkQR: 'Revisa el código QR / la liga e inténtalo otra vez.',
    unknownZone: 'Zona desconocida "{z}". Revisa el código QR e inténtalo otra vez.',
    notPlantedHere: '"{cv}" no está plantado en {zone}.',
    zoneNotTracked: 'La zona {zone} no se cuenta en la cosecha — no hace falta escanearla.',
    noSack: 'No se encontró la bolsa "{id}".',
    noSackCheck: 'No se encontró la bolsa "{id}". Revisa la etiqueta e inténtalo otra vez.',
    pickLotFirst: 'Escoge qué lote está bajando antes de imprimir.',
    cultivarRequired: 'El cultivar es obligatorio — se imprime en la etiqueta.',
    qtyRange: 'La cantidad debe ser entre 1 y {max}.',
    binsRange: 'Las cajas deben ser un número entre 1 y 500.',
    headcountRange: 'El número de cortadores debe ser entre 1 y 20.',
    weightRange: '{field} debe ser un número entre 0 y 500.',
    roleRange: '{role} debe ser un número entero entre 0 y 99.',
    noSessionFound: 'No se encontró la sesión {id}.',
    alreadyWeighed: 'La bolsa {id} ya tiene pesos — no se puede anular.',
    unknownAction: 'Acción desconocida: {a}',
    noLotFound: 'No se encontró el lote de la sesión {id}.',
    noSackId: 'No se dio ningún número de bolsa.',
  },

  en: {
    langOther: 'Español', langOtherCode: 'es',

    entered: '✅ Entered {zone}',
    cut: 'Cut {n}',
    prevClosed: 'Previous lot <strong>{lot}</strong> auto-closed.',
    noPrior: 'No prior zone was open.',
    howManyCutters: 'How many cutters here now?',
    viewLog: 'View log →',
    alreadyEntered: 'Already entered {zone}',
    alreadyEnteredAt: 'Entered at {t} UTC — scan again in a few minutes if you meant to re-enter.',

    nCultivars: '{n} cultivars planted here',
    whichCutting: 'Which one are you cutting?',

    loggedCutters: 'Logged: {n} cutters',
    loggedCutter: 'Logged: 1 cutter',
    wrongNumber: 'Wrong number? Tap the right one:',
    viewStatus: 'View status →',

    barnIntake: 'Barn Intake',
    activeNow: 'Currently active: <strong>{lot}</strong> (cut {n})',
    noZoneOpen: 'No zone is currently open — pick one below.',
    zone: 'Zone',
    binsOnLoad: 'Bins on this load',
    logLoad: 'Log load',
    loggedLoad: 'Logged: {bins} bins → {zone}',
    loadNumToday: 'Load #{n} today for {zone}',
    noSessionWarn: '⚠️ No active session was open for {zone} — logged with no lot.',
    justMoved: '↩️ The crew just moved into {newZone}. If this trailer was loaded in <strong>{prevZone}</strong>, leave it — that is already selected.',
    graceAttributed: '↩️ Logged to the <strong>{zone}</strong> lot (cut {n}), which just closed — this trailer was already in transit.',
    logAnother: 'Log another load →',
    crewChanged: 'Crew changed? →',

    crew: 'Crew',
    crewSub: 'Update when it changes — not on a schedule',
    rosterSince: 'Current roster, set {t} UTC. Change only what changed.',
    rosterNone: 'No roster set yet. Fill in who\'s working.',
    roleDrivers: 'Drivers', whereDrivers: 'Field ↔ barn',
    roleCutterWS: 'Cutter water spiders', whereCutterWS: 'Field — bins to trailer',
    roleHangers: 'Hangers', whereHangers: 'Barn',
    roleHangingWS: 'Hanging water spiders', whereHangingWS: 'Barn — bins to hangers',
    note: 'Note', noteHint: '(optional — e.g. "driver pulled to trim")',
    saveCrew: 'Save crew',
    cuttersNotHere: "Cutters aren't here — they're counted by the zone-entry scan.",
    crewUpdated: 'Crew updated.',
    crewNoChange: 'No change — roster left as it was.',
    changeAgain: 'Change again →',
    toBarnIntake: 'Barn intake →',

    printTags: 'Print Sack Tags',
    pickLotHelp: "Pick the lot that's <strong>coming down now</strong> — match it against the tape on the rack. This is not the zone being cut today; material bags ~{n} days after it was cut.",
    noLots: 'No harvest lots recorded in the last {n} days, so there\'s nothing to take down yet. Scan a zone QR first.',
    badgeReady: 'READY', badgeStarted: 'STARTED', badgeGreen: 'TOO GREEN', badgeOld: 'OVERDUE',
    noteReady: '{d}d drying — ready',
    noteGreen: 'only {d}d drying — too green to be coming down (dry cycle ~{typical}d)',
    noteStarted: '{n} sacks already tagged from this lot',
    noteOld: '{d}d drying — past the usual window, check this is right',
    cultivar: 'Cultivar', cultivarHint: '(from the lot — change only if wrong)',
    startTakedown: 'Start takedown →',
    printTag: 'PRINT TAG',
    printing: 'PRINTING…', voiding: 'VOIDING…',
    tagsForLot: '<strong>{n}</strong> tags printed for this lot',
    tagForLot: '<strong>1</strong> tag printed for this lot',
    lastTag: 'Last: <strong>#&nbsp;{id}</strong>',
    noTagsYet: 'No tags printed yet',
    reprint: 'Reprint', void: 'Void',
    printSeveral: 'Print several at once',
    printSeveralHelp: 'Only if you\'re tagging a batch of already-filled sacks. Extra tags with no sack must be voided, or the lot count drifts.',
    printBatch: 'Print batch',
    changeLot: '← Change lot', viewTags: 'View tags →',
    confirmLot: '{lot}\n{note}\n\nTag sacks against this lot anyway?',
    confirmVoid: 'Void tag # {id}?\n\nUse this if a tag printed with no sack to put it on. The number is retired, not reused.',
    printFailed: 'Could not print: {e}\n\nNothing was tagged — try again.',
    voidFailed: 'Could not void: {e}',

    sack: 'Sack',
    zoneCut: 'Zone <strong>{zone}</strong> · Cut {n}',
    harvested: 'Harvested {d}',
    today: 'today', dayAgo: '1 day ago', daysAgo: '{n} days ago',
    notOpened: 'Not yet opened.',
    voidedNoOpen: 'This sack was voided — the number was retired and there is no sack to open.',
    openSack: 'OPEN SACK',
    sackOpened: 'Sack opened.',
    alreadyOpen: 'This sack was already open.',
    weightsAllocated: "Share of the floor's output that day",
    weightsMeasured: 'Weighed separately',
    weightsPending: 'Weights are shared out once the day closes.',
    openedAt: 'Opened {t}',
    weights: '{tops} lb tops · {smalls} lb smalls',
    topsLbs: 'Tops (lbs)', smallsLbs: 'Smalls (lbs)',
    recordWeights: 'Record weights',
    weightsRecorded: 'Weights recorded.',
    reprintTag: 'Reprint this tag →',
    secOrigin: 'Where it came from', secBarn: 'In the barn', secWeights: 'Weights', secNotes: 'Notes',
    planted: 'Planted', growTime: '{n} days growing',
    area: 'Area', areaVal: '{ac} ac · ~{plants} plants',
    dryingFor: 'Drying {n} days', dryingOne: 'Drying 1 day', dryingToday: 'Arrived today',
    lotTotal: 'This lot: {n} sacks tagged',
    lotTotalOne: 'This lot: 1 sack tagged',
    addNote: 'Add note', notePlaceholder: 'e.g. wet spot at the bottom',
    saveNote: 'Save note', noNotes: 'No notes yet.',
    noteSaved: 'Note saved.', noteEmpty: 'Write something before saving.',
    approx: 'approx.',
    stateUnopened: 'NOT OPENED', stateOpened: 'OPENED', stateVoided: 'VOIDED',
    kSinceCut: 'Since cut', kInLot: 'In the lot', kSacks: 'sacks', kSack: 'sack',
    daysShort: '{n} d',
    tlPlanted: 'Planted', tlCut: 'Cut', tlBagged: 'Bagged', tlOpened: 'Opened', tlToday: 'Today',
    tlGrow: '{d} growing', tlRack: '{d} on the rack', tlSack: '{d} in the sack',
    tlNoPlant: 'plant date unknown', tlNoDates: 'No dates yet.',
    wTotal: 'tops + smalls', wFull: 'full sack',
    wRecovered: '{pct}% of the sack\'s {fill} lb came out as tops + smalls',
    srcAllocatedBadge: 'ALLOCATED', srcMeasuredBadge: 'WEIGHED',
    findSack: 'Find a sack',
    findHelp: 'Scan the tag or type the number — just <strong>7</strong>, or <strong>SLIFT-7</strong>, or the full <strong>26-SLIFT-7</strong>.',
    findPlaceholder: '7',
    findAmbiguous: 'Number <strong>{n}</strong> exists in several cultivars. Which one?',
    findGo: 'Find',
    findNotFound: 'No sack <strong>{id}</strong>. Check the number on the tag.',
    findRecent: 'Recently tagged',
    findLink: 'Find a sack →',
    findUnreadable: 'Tag torn or faded? If the number cannot be read at all, the sack cannot identify itself — work back from the lot it came from.',

    error: 'Error',
    checkQR: 'Check the QR code / link and try again.',
    unknownZone: 'Unknown zone "{z}". Check the QR code and try again.',
    notPlantedHere: '"{cv}" isn\'t planted in {zone}.',
    zoneNotTracked: 'Zone {zone} is not counted at harvest — no need to scan it.',
    noSack: 'No sack found with ID "{id}".',
    noSackCheck: 'No sack found with ID "{id}". Check the tag and try again.',
    pickLotFirst: 'Pick which lot is coming down before printing.',
    cultivarRequired: 'Cultivar is required — it prints on the tag.',
    qtyRange: 'Quantity must be between 1 and {max}.',
    binsRange: 'Bins must be a number between 1 and 500.',
    headcountRange: 'Headcount must be a number between 1 and 20.',
    weightRange: '{field} must be a number between 0 and 500.',
    roleRange: '{role} must be a whole number from 0 to 99.',
    noSessionFound: 'No zone-entry session found for id {id}.',
    alreadyWeighed: 'Sack {id} already has weights recorded — it can\'t be voided.',
    unknownAction: 'Unknown harvest action: {a}',
    noLotFound: 'No harvest lot found for session {id}.',
    noSackId: 'No sack ID given.',
  },
};

/**
 * Which language to render in. Explicit ?lang wins so a QR or a shared link can
 * force one; otherwise the cookie remembers the last toggle; otherwise Spanish.
 * Browser Accept-Language is deliberately ignored — the barn tablet's OS locale
 * says nothing about which crew is holding it.
 */
export function pickLang(request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('lang') || '').toLowerCase();
  if (LANGS.includes(q)) return q;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)rf_lang=(es|en)/);
  if (m) return m[1];
  return DEFAULT_LANG;
}

/** Look up a string and interpolate {placeholders}. */
export function t(lang, key, vars) {
  const table = S[lang] || S[DEFAULT_LANG];
  let s = table[key];
  if (s === undefined) s = S[DEFAULT_LANG][key];
  if (s === undefined) return key;          // visible rather than blank
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Set-Cookie value that remembers a language choice for a year. */
export function langCookie(lang) {
  return `rf_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
