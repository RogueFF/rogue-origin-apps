# Scale SOP — Operator Guide / Guía del Operador

**OHAUS Defender 5000** · Rogue Origin Operations

One-page operating procedure for filling and logging 5 kg and 10 lb
bags. Keep this posted near the scale station.

---

## Quick reference / Referencia rápida

| What you're packing | Scale display | Which button appears |
|---|---|---|
| **5 kg bag** | `g` (grams) | **5 KG Bag Complete** |
| **10 lb bag** | `lb` (pounds) | **10 LB Bag Complete** |

| Lo que estás empacando | Pantalla de la báscula | Qué botón aparece |
|---|---|---|
| **Bolsa de 5 kg** | `g` (gramos) | **5 KG Bag Complete** |
| **Bolsa de 10 lb** | `lb` (libras) | **10 LB Bag Complete** |

---

## Before you start the shift / Antes de comenzar el turno

1. Verify the scale is powered on. Display should show `0.000 g` or
   `0.000 lb` with nothing on it.
2. Confirm the scoreboard (TV / tablet / phone) shows a **green** scale
   connection dot. Red dot = scale offline, tell the manager.
3. Place a known test weight (e.g. a 5 lb dumbbell) on the scale.
   Display should match within ±3 g / ±0.005 lb. If it doesn't, tell
   the manager — calibration may be needed.
4. Remove the test weight. Confirm display returns to 0.

**EN ESPAÑOL:**
1. Verifica que la báscula esté encendida. Debe mostrar `0.000 g` o
   `0.000 lb` sin nada encima.
2. Confirma que el tablero (TV / tableta / teléfono) muestre un punto
   **verde** de conexión. Punto rojo = báscula desconectada, avisa al
   gerente.
3. Coloca una pesa de prueba conocida (ej. una pesa de 5 lb). La
   pantalla debe coincidir ±3 g / ±0.005 lb.
4. Retira la pesa. La pantalla debe volver a 0.

---

## Setting the bag size / Seleccionar el tamaño de bolsa

**Only the manager changes the bag size.** The toggle lives on the
**Floor Manager / Hourly Entry** page (manager's tablet or phone) —
above the Log Bag button:

```
[ 5 KG ] [ 10 LB ]
```

Tap **5 KG** or **10 LB** to set the mode for the whole facility. All
scoreboards (TVs), other tablets, and hourly-entry screens update
within ~5 seconds — the matching Log Bag button appears on every
station, the other disappears.

The **scoreboard TV is read-only for floor workers.** It shows the
current bag size but cannot change it.

Operators do **not** change this. If you think it's set wrong, ask the
manager.

> Solo el gerente cambia el tamaño de bolsa. El control está en la
> página **Floor Manager / Hourly Entry** (tableta o teléfono del
> gerente) — arriba del botón Log Bag:
>
> `[ 5 KG ] [ 10 LB ]`
>
> Presiona **5 KG** o **10 LB** para establecer el modo en toda la
> instalación. Todos los tableros (TVs), otras tabletas y pantallas
> de entrada por hora se actualizan en ~5 segundos.
>
> El **tablero TV es solo de lectura para los trabajadores**. Muestra
> el tamaño de bolsa actual pero no lo puede cambiar.
>
> Los operadores **no** cambian esto. Si crees que está mal, pregúntale
> al gerente.

---

## Filling a bag / Llenado de una bolsa

1. Place an empty Grove Bag on the scale.
   - 5 kg workflow: display reads ~136 g
   - 10 lb workflow: display reads ~0.3 lb
2. Fill with product until the weight is in the target range.
   - **5 kg:** target is **5,000 g of product** → scale reads roughly
     **5,200 g gross** (5 kg + bag). Acceptable window: **5,196 –
     5,317 g**.
   - **10 lb:** target is **10.0 lb of product** → scale reads roughly
     **10.3 lb gross**. Acceptable window: **10.24 – 10.50 lb**.
3. The Log Bag button on the scoreboard turns from grey to green/active
   once you're in range.
4. Seal the bag.
5. **Tap the Log button** on the scoreboard / tablet to record the bag.
6. Remove the bag from the scale. Display returns to 0.
7. Place the next empty bag and repeat.

### EN ESPAÑOL:
1. Coloca una bolsa Grove vacía sobre la báscula.
   - Flujo de 5 kg: muestra ~136 g
   - Flujo de 10 lb: muestra ~0.3 lb
2. Llena con producto hasta que el peso esté en el rango objetivo.
   - **5 kg:** meta es **5,000 g de producto** → la báscula muestra
     aproximadamente **5,200 g bruto**. Ventana aceptable: **5,196 –
     5,317 g**.
   - **10 lb:** meta es **10.0 lb de producto** → la báscula muestra
     aproximadamente **10.3 lb bruto**. Ventana aceptable: **10.24 –
     10.50 lb**.
3. El botón Log Bag en el tablero cambia de gris a verde/activo cuando
   estás en rango.
4. Sella la bolsa.
5. **Presiona el botón Log** en el tablero / tableta para registrar la
   bolsa.
6. Retira la bolsa de la báscula. La pantalla vuelve a 0.
7. Coloca la siguiente bolsa vacía y repite.

---

## Switching sizes mid-day (manager only) / Cambio de tamaño durante el día (solo gerente)

1. Confirm the crew has finished the current size's last bag and it's
   logged.
2. On the Floor Manager / Hourly Entry page, tap the
   **[ 5 KG ] [ 10 LB ]** pill to select the new size.
3. Wait ~5 seconds — all stations swap their Log Bag button.
4. Announce the switch to the crew so they know the new size is active.

### EN ESPAÑOL:
1. Confirma que el equipo terminó la última bolsa del tamaño actual y
   que esté registrada.
2. En la página Floor Manager / Hourly Entry, presiona la píldora
   **[ 5 KG ] [ 10 LB ]** para seleccionar el nuevo tamaño.
3. Espera ~5 segundos — todas las estaciones cambian el botón Log Bag.
4. Anúnciale al equipo el cambio para que sepan que el nuevo tamaño
   está activo.

---

## If something's wrong / Si algo no funciona

### The Log button stays grey and won't let me click it.
**Cause:** the weight isn't in the acceptable window. Check the scale
reading. The tooltip on the button tells you the current weight and the
required range. Add or remove a bit of product until the button turns
active.

**Causa:** el peso no está en la ventana aceptable. Revisa la lectura.
La información del botón te dice el peso actual y el rango requerido.
Agrega o retira un poco de producto hasta que el botón se active.

### Both buttons are showing.
Shouldn't happen with the manager-toggle design. If it does, it usually
means the scoreboard just loaded and hasn't finished fetching state
yet. Wait 5-10 seconds and refresh (`Ctrl+Shift+R`). If both remain,
ask the manager.

No debería pasar con el diseño de toggle del gerente. Si pasa,
normalmente significa que el tablero apenas cargó. Espera 5-10 segundos
y actualiza. Si siguen los dos, pregúntale al gerente.

### The Log button is greyed out and the tooltip says "Scale offline".
The scale reader on the station PC isn't pushing weight to the cloud.
You can't log bags until that's fixed. Tell the manager. Possible
causes: USB cable unplugged, station PC turned off, scale-reader
program closed, or network down at the station.

El programa lector de la báscula en la PC de la estación no está
enviando peso a la nube. No puedes registrar bolsas hasta que se
arregle. Avísale al gerente. Posibles causas: cable USB desconectado,
PC apagada, programa cerrado, o sin internet en la estación.

### The wrong button is showing.
The manager set the wrong mode, or hasn't switched it yet. Find the
manager — they'll tap the **[ 5 KG ] [ 10 LB ]** pill on the main
scoreboard. Don't try to force the bag through — the counts will be
wrong.

El gerente puso el modo incorrecto o no lo ha cambiado. Busca al
gerente — presionará la píldora **[ 5 KG ] [ 10 LB ]** en el tablero
principal. No fuerces la bolsa — los conteos saldrán mal.

### Scale shows 0 but there's a bag on it.
The scale may be tared (offset). Press **TARE** on the indicator to
reset to zero, or remove the bag first.

La báscula puede estar tarada. Presiona **TARE** en el indicador para
reiniciar a cero, o retira la bolsa primero.

### Scale reads negative (e.g. -0.5 g).
Drift from the zero point. Press **ZERO** on the indicator to
recalibrate zero. Do this with nothing on the scale.

Deriva del punto cero. Presiona **ZERO** en el indicador para
recalibrar el cero. Hazlo sin nada en la báscula.

### Bag is just slightly over the max window.
Remove a small amount of product until the button turns active. The
overage cap is there to keep product costs consistent. Don't log
overweight bags — they throw off inventory.

Retira un poco de producto hasta que el botón se active. El límite de
sobrepeso existe para mantener costos consistentes. No registres
bolsas sobrepeso — afectan el inventario.

### The scoreboard froze.
Refresh the page (pull down on tablet, or Ctrl+Shift+R on the computer).
If it's still frozen after a refresh, ask the manager.

Actualiza la página (desliza hacia abajo en la tableta, o Ctrl+Shift+R
en la computadora). Si sigue congelado, pide ayuda.

---

## End of shift / Fin del turno

1. Leave the scale powered on — it's fine overnight.
2. Close the browser tab or turn off the TV display, as preferred.
3. No need to "sign out" or stop anything.

No necesitas apagar la báscula ni cerrar sesión.

---

## Reference numbers / Números de referencia

| Item | Value |
|---|---|
| Grove Bag tare weight / Peso tara bolsa Grove | 136 g (0.3 lb) |
| 5 kg bag target / Meta bolsa 5 kg | 5,000 g producto (5,200 g bruto) |
| 5 kg window / Ventana 5 kg | 5,196 – 5,317 g |
| 10 lb bag target / Meta bolsa 10 lb | 10.0 lb producto (10.3 lb bruto) |
| 10 lb window / Ventana 10 lb | 10.24 – 10.50 lb |
| Overage allowance / Permitido sobrepeso | +0.2 lb (91 g) |

---

## Questions / Preguntas

Ask the manager. Show them the scale indicator and the scoreboard if
something looks wrong. / Pregunta al gerente. Muéstrale el indicador
de la báscula y el tablero si algo se ve mal.
