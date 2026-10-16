// /salida page strings, Spanish first. Kept here (not lib/i18n.js) because the
// shared table belongs to another build track; {n}/{m}/{name}/{time} are filled
// in by the page. Values are plain text — the page renders them with textContent.
export const SALIDA_STRINGS = {
  es: {
    title: 'Salida de bolsas', scanHint: 'Escanea la etiqueta o escribe el número',
    camera: 'Cámara', retryCam: 'Abrir cámara', torch: 'Linterna', noCam: 'Sin cámara: escribe el número',
    number: 'Número de bolsa', go: 'SACAR', clear: 'Borrar', undo: 'DESHACER', toStock: 'Inventario',
    change: 'Cambiar pedido', stock: 'Inventario', already: '{name} ya salió a las {time}',
    ambiguous: '¿Cuál bolsa?', voided: 'Etiqueta anulada', not_found: 'No encontrado',
    not_a_tag: 'No es una etiqueta', error: 'Error — intenta otra vez', queued: 'Sin señal — guardado en el teléfono. Se enviará cuando vuelva la señal',
    too_late: 'Ya no se puede deshacer — ya tiene pesos registrados', undone: 'Deshecho', not_out: 'Esa bolsa no estaba fuera',
    today: 'Hoy', count1: '{n} bolsa', count: '{n} bolsas', countOf: '{n} de {m}', cut: 'Corte', pending: 'Pendiente de enviar',
    queue: 'Cola de pedidos', test: 'MODO PRUEBA — no cuenta', pickCultivar: 'Elige la variedad', idle: 'Escanea una etiqueta, o elige variedad y escribe el número', wait: 'Un momento…', stuck: 'Sigue ocupado — espera y vuelve a escanear', waiting: '{n} esperando señal', rowUndo: 'Deshacer', confirm: 'Toca otra vez para deshacer', looking: 'Buscando etiqueta…', clr: 'Borrar todo', more: '{n} más…', less: 'Menos',
    // Cerrar día: the two end-of-day weights, on this screen instead of the form.
    closeTitle: 'Cerrar día', closeHint: 'Sacos de los escaneos, tops y smalls del registro por hora. Solo se escribe el peso de biomasa y trim.',
    closeHours: '{n} horas registradas', closeHours1: '{n} hora registrada', closePoundsOn: 'libras en {cut}', closeNoAlias: 'sin alias — avisa a la oficina',
    closeBio: 'Biomass #2', closeTrim: 'Premium #1', closeGo: 'CERRAR DÍA', closeAgain: 'GUARDAR OTRA VEZ', closeSaving: 'Guardando…',
    closeNeedBoth: 'Escribe los dos pesos', closeSwapped: 'Premium #1 no puede pesar más que Biomass #2 — revisa cuál caja es cuál', closeZero: 'Los dos pesos están en cero',
    closeSaved: 'Día cerrado. Rendimiento de los sacos escaneados:', closeSavedNoYield: 'Guardado. No se pudo calcular el rendimiento; se calcula esta noche.', closeFailed: 'No se guardó — intenta otra vez',
    closeOffline: 'Sin señal — espera a tener señal para cerrar el día', closePerSack: 'por bolsa', closeExisting: 'Ya guardado hoy: bio {b}, trim {t}',
    closeMismatch: 'el conteo escaneado no coincide con el del piso — revisa si faltó un escaneo', closeUnknownStrain: 'cepa desconocida — avisa a la oficina',
    closeOutputNoScans: 'producto sin sacos escaneados', closeScansNoOutput: 'sacos escaneados sin producto', closePool: 'Inventario Shopify no actualizado —',
  },
  en: {
    title: 'Sack scan-out', scanHint: 'Scan the tag or type the number',
    camera: 'Camera', retryCam: 'Open camera', torch: 'Flashlight', noCam: 'No camera: type the number',
    number: 'Sack number', go: 'TAKE OUT', clear: 'Clear', undo: 'UNDO', toStock: 'Stock',
    change: 'Change order', stock: 'Stock', already: '{name} already went out at {time}',
    ambiguous: 'Which sack?', voided: 'Tag voided', not_found: 'Not found',
    not_a_tag: 'Not a tag', error: 'Error — try again', queued: 'No signal — saved on this phone. It will send when signal returns',
    too_late: 'Too late to undo — weights already recorded', undone: 'Undone', not_out: 'That sack was not out',
    today: 'Today', count1: '{n} sack', count: '{n} sacks', countOf: '{n} of {m}', cut: 'Cut', pending: 'Waiting to send',
    queue: 'Order queue', test: 'TEST MODE — does not count', pickCultivar: 'Pick the cultivar', idle: 'Scan a tag, or pick the cultivar and type the number', wait: 'One moment…', stuck: 'Still busy — wait and scan again', waiting: '{n} waiting for signal', rowUndo: 'Undo', confirm: 'Tap again to undo', looking: 'Looking for a tag…', clr: 'Clear all', more: '{n} more…', less: 'Fewer',
    // Close day: the two end-of-day weights, on this screen instead of the form.
    closeTitle: 'Close day', closeHint: 'Sacks from the scans, tops and smalls from the hourly log. Only biomass and trim are typed.',
    closeHours: '{n} hours logged', closeHours1: '{n} hour logged', closePoundsOn: 'pounds on {cut}', closeNoAlias: 'no alias — tell the office',
    closeBio: 'Biomass #2', closeTrim: 'Premium #1', closeGo: 'CLOSE DAY', closeAgain: 'SAVE AGAIN', closeSaving: 'Saving…',
    closeNeedBoth: 'Type both weights', closeSwapped: 'Premium #1 cannot weigh more than Biomass #2 — check which box is which', closeZero: 'Both weights are zero',
    closeSaved: 'Day closed. Yield for the scanned sacks:', closeSavedNoYield: 'Saved. Could not compute the yield; it runs tonight.', closeFailed: 'Not saved — try again',
    closeOffline: 'No signal — wait for signal to close the day', closePerSack: 'per sack', closeExisting: 'Already saved today: bio {b}, trim {t}',
    closeMismatch: 'scanned count differs from the floor count — check for a missed scan', closeUnknownStrain: 'strain unknown — tell the office',
    closeOutputNoScans: 'output with no sacks scanned', closeScansNoOutput: 'sacks scanned with no output', closePool: 'Shopify pool not updated —',
  },
};
