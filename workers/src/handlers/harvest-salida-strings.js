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
    queue: 'Cola de pedidos', test: 'MODO PRUEBA — no cuenta', pickCultivar: 'Elige la variedad', idle: 'Escanea una etiqueta, o elige variedad y escribe el número', wait: 'Un momento…', stuck: 'Sigue ocupado — espera y vuelve a escanear', waiting: '{n} esperando señal', rowUndo: 'Deshacer', confirm: 'Toca otra vez para deshacer', looking: 'Buscando etiqueta…', clr: 'Borrar todo',
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
    queue: 'Order queue', test: 'TEST MODE — does not count', pickCultivar: 'Pick the cultivar', idle: 'Scan a tag, or pick the cultivar and type the number', wait: 'One moment…', stuck: 'Still busy — wait and scan again', waiting: '{n} waiting for signal', rowUndo: 'Undo', confirm: 'Tap again to undo', looking: 'Looking for a tag…', clr: 'Clear all',
  },
};
