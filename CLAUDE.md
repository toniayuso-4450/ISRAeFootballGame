# CLAUDE.md — Reglas obligatorias del proyecto F-TBOL

## Separación CLUBES vs SELECCIONES en estadísticas (obligatorio, 2026-05-27)

**REGLA BLOQUEANTE ABSOLUTA**: las **estadísticas de jugadores** del
**MUNDIALITO de CLUBES** (cfg.id `'mundial'`, slot built-in
`tour_mundial_v1`, format `groups-ko`) y las de los **Torneos de
Verano** (Trofeo Joan Gamper, Soccer Champions Tour, Premier Summer
Series, Asian Tournament, `tx1..tx8`) NO pueden contener jugadores
de SELECCIONES NACIONALES (Mundial 2032 / Rondas Previas /
amistosos de selección). Y viceversa.

### Por qué esta regla existe (bug 2026-05-27)

Captura usuario: `Torneos de Verano · Trofeo Joan Gamper ·
Estadísticas · Goleadores` mostraba:
1. Kylian Mbappe · FRANCIA — 4 goles
2. Jugador B · AL ITTIHAD CLUB — 3 goles
3. Rafael Borre · COLOMBIA — 3 goles
4. Moises Caicedo · ECUADOR — 3 goles
5. Inaki Williams · GHANA — 3 goles
6. Jugador B · HAITI — 3 goles

El leak ocurría porque `rebuildPlayerStatsStore` (Source 3, iteración
de `tour_*_v1`) clasificaba todo cfg con `id !== 'mundial'` al bucket
`torneos`. Los slots `spv1..spv10` (Rondas Previas) y `sfn1..sfn10`
(Rondas Finales) de Selecciones caían igual ahí.

### Reglas de clasificación canónica

| Cfg / matchKey                                  | Bucket          | Store                          | Pantalla            |
|-------------------------------------------------|-----------------|--------------------------------|---------------------|
| `cfg.id === 'mundial'` (Mundialito Clubes)      | `mundial`       | `ef_player_stats_mundial_v1`   | `s-mundial-stats`   |
| `cfg.id ∈ {sct,pss,jg,asia,tx1..tx8}`           | `torneos`       | `ef_player_stats_torneos_v1`   | `s-torneos-stats`   |
| `cfg.id ∈ {spv1..spv10,sfn1..sfn10}` o `format='mundial-48'` | `sel` | `ef_player_stats_sel_v1`       | (per-tour vía `s-tour-stats`) |
| matchKey con `tour_spv` / `tour_sfn`            | `sel`           | mismo                          | mismo               |
| matchKey con `cal-sel*` / `cal-mf-*`            | `sel`           | mismo                          | mismo               |

### Reglas a respetar

1. **PROHIBIDO** modificar el split de Source 3 en
   `rebuildPlayerStatsStore` para que vuelva a clasificar `spv*`/
   `sfn*` o cfgs `format='mundial-48'` al bucket `torneos`. La regla
   "Mundialito de Clubes = clubes / Mundial 2032 = selecciones, JAMÁS
   mezclar" es absoluta.
2. **PROHIBIDO** quitar el check temprano `tour_spv`/`tour_sfn` →
   `sel` de `_competitionFromMatchKey`. Sin él, los matches de
   Mundial 2032 abiertos vía `_tourOpenHumanMatch` (compKey
   `'torneo'` singular) y sus matchKeys (con `|torneos|`) caían a
   `torneos` por el match `tour_` o `|torneo|` de abajo.
3. **PROHIBIDO** dejar `if (!buckets[comp]) comp = 'liga';` sin
   normalización vía `_competitionFromMatchKey`. Los compKeys
   `'torneo'` (singular, Mundial 2032) y `'sel-fin'` (cal-mf-*)
   NO existen como bucket directo (`buckets.torneo` /
   `buckets['sel-fin']` son `undefined`) → caían a `liga`.
4. **Toda comp NUEVA** que añada un slot al motor `_tour*` con
   format de selecciones debe heredar la clasificación a `sel`
   (idealmente añadiendo su id al regex `^(spv|sfn|XXX)\d+$` y/o
   añadiendo su `format` a la detección por format).
5. La regla aplica igual al revés: las pantallas de Selecciones
   (s-tour-stats por cfg, o `s-sel-stats` si existe) NO deben
   recibir jugadores de clubes del Mundialito ni de Torneos de
   Verano. El mapeo es 1-a-1 por id de torneo.

## MISTERS_REGISTRY — fuente única canónica de humanos (obligatorio, 2026-05-27)

**Propuesta usuario 2026-05-27** (foto pantalla `👤 EQUIPOS` del menú
principal): cada caja del menú EQUIPOS mapea un **mister humano** a
**UN club** + **UNA selección**. Es la fuente de verdad para "quién
es humano esta temporada".

### Los 6 misters canónicos

| Pantalla (`screen`) | Club | Mister (emoji) | Selección |
|---------------------|------|----------------|-----------|
| `s-munich`   | Liverpool        | Toñín 💡  | Francia    |
| `s-arsenal`  | Arsenal          | Álvaro 🐭 | Brasil     |
| `s-madrid`   | Real Madrid      | Acsa 🔨   | Inglaterra |
| `s-atletico` | Atlético Madrid  | Isra ✏️   | Noruega    |
| `s-barca`    | FC Barcelona     | Ángel 😈  | Argentina  |
| `s-psg`      | PSG              | Izan 🦆   | España     |

Cada mister dirige **AMBOS** equipos: pulsando su caja del menú se
abre la pantalla con calendario + competiciones del club + la selección.

### Registry canónico

`window._MISTERS_HUMANOS` (definido en `misc_body_1.html`, IIFE
HUMANIDAD POR COMPETICIÓN, JUSTO antes de `SEL_COMPS`):

```js
var MISTERS_HUMANOS = [
  { id:'tonin',  emoji:'💡', mister:'Toñín',  club:'Liverpool',        seleccion:'Francia',    screen:'s-munich'   },
  { id:'alvaro', emoji:'🐭', mister:'Álvaro', club:'Arsenal',          seleccion:'Brasil',     screen:'s-arsenal'  },
  { id:'acsa',   emoji:'🔨', mister:'Acsa',   club:'Real Madrid',      seleccion:'Inglaterra', screen:'s-madrid'   },
  { id:'isra',   emoji:'✏️', mister:'Isra',   club:'Atlético Madrid',  seleccion:'Noruega',    screen:'s-atletico' },
  { id:'angel',  emoji:'😈', mister:'Ángel',  club:'FC Barcelona',     seleccion:'Argentina',  screen:'s-barca'    },
  { id:'izan',   emoji:'🦆', mister:'Izan',   club:'PSG',              seleccion:'España',     screen:'s-psg'      }
];
```

Es **HARDCODED**, **SÍNCRONO**, y NO depende de NADA externo:
- ❌ NO depende de hidratación de `selecciones_squad_v1`
- ❌ NO depende de flag `isHuman` en cfgs del torneo
- ❌ NO depende del DOM del menú EQUIPOS estar renderizado
- ❌ NO depende de fetch del servidor

### Helpers públicos (todos sync, todos infallible)

- `window._isHumanSeleccionCanonica(name)` → bool. ¿Es Francia/Brasil/…?
- `window._isHumanClubCanonico(name)` → bool. ¿Es Liverpool/Arsenal/…?
  Acepta alias legacy ("Bayern Munich" / "Bayern" / "LFC" → Liverpool).
- `window._mhFindMister(name)` → mister object o null. Útil para saber
  qué mister dirige al equipo.
- `window._mhSameMister(a, b)` → bool. ¿`a` y `b` los dirige el mismo
  mister? Ej: `_mhSameMister('Liverpool','Francia')` → true (Toñín).

### `isHumanInComp` consulta el registry primero

`isHumanInComp(name, comp)` ahora tiene una CAPA 0 antes que TODAS las
demás:

```js
window.isHumanInComp = function(name, comp){
  // CAPA 0 — MISTERS_REGISTRY (sync, hardcoded, infallible):
  if (SEL_COMPS[c] && _isHumanSeleccionCanonica(name)) return true;
  if ((EUR_COMPS[c] || DOM_COMPS[c] || c === 'superliga')
      && _isHumanClubCanonico(name)) return true;
  // CAPA 1+ — fallbacks asincrónicos (_esSelHumana, _hasHumanIcon, etc.)
  ...
};
```

Como TODOS los flujos del juego pasan por `isHumanInComp` (gracias a
las defensas previas), la CAPA 0 garantiza que el bug 2026-05-27
JAMÁS pueda reproducirse, incluso aunque el resto de capas estén
rotas.

## Detección de SELECCIONES humanas — fuente única `_esSelHumana` (obligatorio, 2026-05-27)

**REGLA BLOQUEANTE ABSOLUTA**: las **6 selecciones humanas canónicas**
(Francia 💡, Brasil 🐭, Inglaterra 🔨, Noruega ✏️, Argentina 😈,
España 🦆) DEBEN ser detectadas como humanas en TODOS los flujos del
proyecto que toquen partidos de selección, **independientemente de
cualquier estado asincrónico** (hidratación de `selecciones_squad_v1`,
flag `isHuman` en el cfg del torneo, fetch del servidor, etc.).

### Por qué esta regla existe (bug 2026-05-27)

El usuario reportó con captura "Liverpool/Francia · 03 May" que la
card "Próximo partido" del hub mostraba `🌍 SELECCIONES · JUGADORES
FUERA · CONTINUAR ▶` en lugar del partido real `Francia vs Rep.
Checa` (Mundial Grupo — J1). La causa raíz:

1. `_selPair` resolvía al humano con 2 pases: (1) `t.isHuman` flag, y
   (2) `isHumanInComp(name, 'mundial')`.
2. `isHumanInComp('Francia', 'mundial')` cae a `_hasHumanIcon` →
   `humanIcon('Francia')` → depende de `_SEL_HUMAN_ICONS` hidratado
   desde `selecciones_squad_v1`.
3. Si el admin no marcó Francia `isHuman:true` en el cfg del Mundial
   **Y** la hidratación async aún no había corrido al primer render,
   ambos pases fallaban → `_candidates` vacío → `_selPair` retornaba
   null → card del hub mostraba JUGADORES FUERA.
4. **Mismo bug afectaba a 6 sitios más en paralelo**: `_gmHumanInvolved`
   (cronómetro caía a IAIA 90s en vez de HvH 16.5min / HvIA 9.75min),
   `_mlTeamIsHumanEnd` (no se mostraba stats overlay obligatorio),
   `_mlTeamIsHuman` (sanciones mal aplicadas), `_mlPlayerValuationAjax`
   (auto-pick saltaba al jugador del rival), `athRivalIsHuman` (PI
   médicos incorrectos), `_psTeamIsHumanGeneric` (auto-sim fase previa).

### Fuente única canónica

`window._esSelHumana(name)` (definido en `static/js/index.bundle.js`
en el bloque IIFE SANCIONES + LESIONES — SELECCIONES NACIONALES):

```js
var SEL_HUMANAS = ['Francia','Brasil','Inglaterra','Noruega','Argentina','España'];
function esSelHumana(name){
  // Normaliza (sin tildes, lowercase) y compara contra SEL_HUMANAS.
  // Fallback: `_SEL_HUMAN_ICONS` si el usuario añadió otras humanas
  // vía editor (selecciones_squad_v1.teams[].icon).
}
window._esSelHumana = esSelHumana;
```

Es **SÍNCRONO**, **NO depende de hidratación**, y la lista es
**HARDCODED** en el bundle.

### Defensas en capas (todas obligatorias)

1. **`isHumanInComp` parchado** (`misc_body_1.html`, IIFE HUMANIDAD POR
   COMPETICIÓN): para los comps de selección (`SEL_COMPS = {sel,
   sel-fin, mundial, torneo, mundial-48, selecciones}`), `isHumanInComp`
   consulta `_esSelHumana` ANTES que `_hasHumanIcon`. Así CUALQUIER
   código que use `isHumanInComp(name, 'mundial')` queda inmunizado de
   una vez sin tocar el call site.
2. **Pase 3 explícito en `_selPair` y `_findHumanTeam`**: belt-and-
   suspenders. Si el código itera cfg.teams en busca de humanos, tras
   los pases `isHuman` + `isHumanInComp`, hace un Pase 3 con
   `_esSelHumana`. Garantiza detección incluso si alguien rompe
   `isHumanInComp` en el futuro.
3. **`_psTeamIsHumanGeneric` con Pase 3**: el helper que clasifica
   teams como humanos en `_psListPendingGroupMatches` /
   `_psListPendingKoMatches` también añade fallback `_esSelHumana`.
4. **Watchdog en `_psRender`**: cuando la card cae a JUGADORES FUERA
   en un día Mundial Selecciones (`ag-sel` + label contiene 'mundial')
   PERO existe un cfg mundial-48 con una selección humana canónica en
   `cfg.teams`, se hace `console.warn('[F-TBOL] _selPair retornó null
   pero hay humana canónica en cfg mundial-48 — posible REGRESIÓN del
   bug 2026-05-27', diagnosticInfo)`. NO bloquea el render, solo deja
   constancia loud en consola para detectar la próxima regresión al
   instante.
5. **Botón `🔍 RECUPERAR PARTIDO` en `_cardRest`** (2026-05-27,
   propuesta usuario): si la card cae a JUGADORES FUERA pero el scan
   `_scanForCanonicalMundialMatch` detecta que SÍ hay cfg mundial-48
   con humana canónica, el botón `CONTINUAR ▶` se reemplaza por:
   - Aviso ámbar `⚠️ Hay partido programado para <Selección> pero la
     card no lo detectó`.
   - Botón principal `🔍 RECUPERAR PARTIDO` que dispara la cascada:
     (1) `_selSquadHydrate()` (re-cargar selecciones_squad_v1),
     (2) `_invalidateHumanTeamCache()` (limpiar caché),
     (3) `_tourLoadCachedSync` para TODOS los slots,
     (4) `_psAutoChainBuildMundial` (construir brackets KO pendientes),
     (5) scan diagnóstico loggeado en consola,
     (6) `_psRender()` forzado (limpia sig de idempotencia),
     (7) si tras 200ms sigue en JUGADORES FUERA, toast/alert con
         info diagnóstica al usuario.
   - Botón secundario pequeño `CONTINUAR ▶ (saltar día)` para mantener
     la opción legacy si el usuario decide ignorar la recuperación.

   Es la última línea de defensa USER-FACING: si todas las capas
   internas fallan, el usuario tiene un botón visible para forzar la
   recuperación sin recargar la página.

### Reglas a respetar (PROHIBICIONES)

1. **PROHIBIDO** crear código nuevo que detecte humanos de selección
   usando SOLO `t.isHuman` (flag del cfg). Siempre añadir fallback
   `_esSelHumana(t.name)`.
2. **PROHIBIDO** usar SOLO `isHumanInComp` sin entender que para SEL_COMPS
   YA incluye `_esSelHumana`. Para comps que NO están en SEL_COMPS pero
   donde pueden aparecer selecciones (eventos custom), añadir el fallback
   explícito en el call site.
3. **PROHIBIDO** quitar la lista hardcoded `SEL_HUMANAS` o eliminar
   `_esSelHumana` del bundle. Es la última línea de defensa.
4. **PROHIBIDO** añadir selecciones nuevas a `SEL_HUMANAS` sin avisar
   al usuario explícitamente. Las 6 son canónicas (2026-05-24). Si
   el admin marca otras como humanas vía editor, se reconocen vía
   `_SEL_HUMAN_ICONS` automáticamente.
5. **PROHIBIDO** quitar SEL_COMPS de `isHumanInComp` o reordenar el
   chequeo para que `_hasHumanIcon` se ejecute ANTES de `_esSelHumana`
   — eso reintroduce el race con la hidratación.
6. **PROHIBIDO** silenciar / borrar el watchdog en `_psRender`. Es la
   herramienta que descubrirá la próxima regresión sin que el usuario
   tenga que reportar otra captura.
6b. **PROHIBIDO** quitar el botón `🔍 RECUPERAR PARTIDO` de `_cardRest`
   o cambiar su keyword sin acuerdo con el usuario. La keyword
   "RECUPERAR PARTIDO" fue elegida por el usuario para que cuando vea
   la card JUGADORES FUERA en un día con partido, pulse el botón y la
   web auto-diagnostique + auto-recupere sin que él tenga que
   investigar manualmente.
7. **Toda comp NUEVA** donde puedan aparecer selecciones (Eurocopa,
   Copa América, Confederaciones, amistosos de selección, etc.) debe
   añadirse a `SEL_COMPS` Y, si tiene su propio flujo de detección de
   humanos, también heredar el Pase 3 `_esSelHumana`.

### Resumen visual

```
┌─────────────────────────────────────────────────────────────────┐
│ Hub Liverpool/Francia → card "Próximo partido" 03 May          │
│ ├─ day.cls = 'ag-sel'  +  label = 'Mundial Grupo — J1'         │
│ ├─ _selPair(day)                                                │
│ │   ├─ Pase 1: t.isHuman                          ← admin manual│
│ │   ├─ Pase 2: isHumanInComp(name,'mundial')      ← SEL_COMPS  │
│ │   │            → _esSelHumana   ← BLINDAJE 1   │              │
│ │   └─ Pase 3: _esSelHumana(t.name) directo       ← BLINDAJE 2  │
│ ├─ Si TODOS los pases fallan:                                   │
│ │   └─ Watchdog scan: ¿hay humana canónica en algún cfg?       │
│ │       → console.warn loud                       ← BLINDAJE 3  │
│ │   └─ _cardRest detecta SOSPECHA y muestra botón              │
│ │       🔍 RECUPERAR PARTIDO en vez de CONTINUAR ▶ ← BLINDAJE 4 │
│ └─ Render: Francia vs Rep. Checa  (NUNCA JUGADORES FUERA)      │
└─────────────────────────────────────────────────────────────────┘
```

## Jornada / ronda CUMPLIDA → cabecera GRIS (obligatorio, 2026-05-27)

Cuando una jornada de grupo o una ronda KO tiene **TODOS** sus
partidos jugados (con resultado `played === true`), el botón de
cabecera de esa jornada/ronda (`.jbtn` en `.jblock`) debe salir en
**color gris** para distinguirla de las que aún están pendientes.

Aplica a **todas** las competiciones que rinden con el patrón
`.jblock + .jbtn.c-<comp>`:

| comp class       | done style                  | dónde lo añade el JS                                                   |
|------------------|------------------------------|------------------------------------------------------------------------|
| `c-mundialito`   | gris (regla CSS bloqueante)  | _tour engine (Mundialito Clubes)                                       |
| `c-mundial`      | gris (regla CSS bloqueante)  | `_mundialGroupsHtml` (jornadas de grupo) + `row()` de `_mundialKoHtml` (rondas KO) en `misc_body_1.html` |
| `c-superliga`    | oro/trofeo (excepción)       | `s-superliga-clas.html` + `part2/misc_body_2.html` — color de campeón, NO se gris-ifica |

Las reglas CSS gris viven juntas en
`templates/partials/misc_body_1.html` (~líneas 12190-12215), bloque
"Jornada YA JUGADA → botón gris". La gradiente gris es:
```
linear-gradient(90deg,#1a1d22,#2a2e36,#3a3e48,#2a2e36,#1a1d22)
```
con borde `rgba(170,180,195,.45)`, `filter:grayscale(.5) brightness(.85)`
y `color:rgba(255,255,255,.55)`.

### Cómo detectar "todos los partidos jugados"

El JS construye el botón con la clase `done` cuando todos los partidos
de esa jornada / ronda están con resultado. Ejemplos canónicos:

```js
// _mundialGroupsHtml: jornada de grupo
var allDone = true;
jor.forEach(function(_, mi){
  var r = (cfg.results[gKey+ji+'_'+mi]||{});
  if (!r.played) allDone = false;
});
html += '<button class="jbtn c-mundial' + (allDone ? ' done' : '') + '" ...>';
```

### Reglas a respetar

1. **Toda nueva competición** que use el patrón `.jblock + .jbtn.c-<comp>`
   en una pantalla de torneo (`s-<comp>-clas`, `s-<comp>-stats`,
   pantalla del hub `_tour*`, etc.) DEBE:
   - Añadir la clase `done` al `.jbtn` cuando todos los partidos de la
     jornada/ronda estén jugados.
   - Tener su regla `.jbtn.c-<comp>.done` en el bloque CSS gris (o
     reutilizar las existentes si comparte gradient base).
2. **PROHIBIDO** dejar una jornada cumplida con la cabecera del color
   activo de la comp (rojo Liga, rosa Mundial-48, etc.). Eso confunde
   al usuario sobre qué jornadas siguen pendientes.
3. **PROHIBIDO** eliminar la regla `.jbtn.c-mundial.done` /
   `.jbtn.c-mundialito.done` sin reemplazo equivalente. El base color
   de `c-mundial` (`#5a0030 → #c8205a` en `static/css/index.bundle.css`)
   usa `!important`, así que la regla `.jbtn.c-mundial.done` también
   debe llevar `!important` para ganarle (especificidad 0,3,0 vs 0,1,0).
4. **Excepción documentada — Superliga**: el "done" de Superliga
   (`#s-superliga-clas .jbtn.c-superliga.done` en
   `part2/misc_body_2.html:873`) usa gradient **oro/trofeo** en lugar
   de gris. Es intencional (decisión de diseño previa, color trofeo
   `#F1C40F`). NO modificar sin acuerdo con el usuario.

### Histórico

- 2026-05-27: usuario reporta foto del Mundial 2032 (Grupo A:
  Filipinas/Senegal/Kuwait/Jordania) con J1 y J2 cumplidas saliendo
  en color rosa/magenta pese a tener todos los partidos con FIN. El
  JS ya añadía la clase `done` (líneas 20392 y 20643 de
  `misc_body_1.html`) pero faltaba la regla CSS
  `.jbtn.c-mundial.done`. Añadida al bloque junto a
  `.jbtn.c-mundialito.done` (líneas 12200-12215).

## Mundialito de Clubes — diseño AMARILLO + flujo Resto del Mundo (obligatorio, 2026-05-27)

El **Mundialito de Clubes** vive en el slot built-in `'mundial'` del
motor `_tour*` (NO confundir con `mundial-48`, que es Mundial 2032
de selecciones). Spec canónica (CLAUDE.md regla bloqueante):

- **32 equipos** = 16 europeos (admin elige MANUALMENTE) + 16 de la
  liga `ligaExt_resto-mundo` (TOP 16 automáticos tras los 42 partidos).
- **Format**: `'groups-ko'` con `formatConfig.groups=8`, `perGroup=4`,
  `advancePerGroup=2`, `koRounds=['Octavos','Cuartos','Semis','Final']`.
- **Top 2 de cada grupo** → Octavos (16 equipos). Octavos → Cuartos →
  Semis → Final, todo a **PARTIDO ÚNICO con ET + penaltis** (`koExtraTimePens:true`).
- **NO hay 3er/4º puesto.** Solo 4 rondas KO.
- **No excluye ligas**: cualquier equipo europeo (cualquier liga) puede
  ser elegido por el admin como uno de los 16 europeos.
- **Humanos**: los marca el admin manualmente al lanzar el torneo
  (igual que Superliga). Cualquier humano puede ser elegido para el
  Mundialito independientemente de los humanos canónicos de Liga EA.
- **Frecuencia**: lo lanza el admin desde la pantalla Resto del Mundo
  (`s-lext` con `slug==='resto-mundo'`) cuando los 42 partidos están
  completos. El motor NO lo arranca solo cada N temporadas — es
  bajo demanda.

### Color visual: AMARILLO `#ffd633` (no azul cobalto)

Petición usuario 2026-05-27. El Mundialito tiene **el mismo formato
visual que el Mundial 2032** (mismas cards `.mn-card`, mismo layout
de grupos + KO, mismas tablas de clasificación) **pero en amarillo**
en lugar de azul cobalto + dorado.

Ubicación de los overrides amarillo (`#ffd633`):

1. **`#s-mundial .tour-group-block`** (CSS scopeada): grupos en
   gradiente amarillo `#2a1f00 → #5a4408 → #1a0f00` con borde
   `rgba(255,214,51,.55)`.
2. **`.mn-card[data-tour="mundial"]`** (selector per-card via
   `data-tour` que `_koRowHtml` añade): cards KO en amarillo, sin
   afectar a Mundial 2032 (sfn*) ni a otros torneos (jg/asia/sct/pss).
3. **Hub `s-mundial-clubes`** (5 cajas): clase **`c-mundialito`**
   (NO `c-mundial`) con gradiente amarillo. La clase `c-mundial`
   sigue siendo cian/turquesa para Mundial 2032 calendar slots.
4. **gm-modal**: clase **`is-comp-mundialito`** con
   `--comp-color:#ffd633`. La detecta `_gmCompFromState` cuando
   `g._tourId === 'mundial'` (override ANTES de la rama 'torneo'
   genérica que daría violeta).

### Slots del calendario (calendario.json + s-calendario.html)

Las 7 fechas FIJAS del Mundialito en `calendario.json` (icon `🌐` →
clase `ag-inter`):

| Fecha     | event.name                      | Slot s-calendario.html |
|-----------|---------------------------------|------------------------|
| 04 Jul    | Mundialito Clubes - J1          | `cal-mc-g1`           |
| 08 Jul    | Mundialito Clubes - J2          | `cal-mc-g2`           |
| 12 Jul    | Mundialito Clubes - J3          | `cal-mc-g3` (🌧)       |
| 16 Jul    | Mundialito Clubes - Octavos     | `cal-mc-oct`          |
| 20 Jul    | Mundialito Clubes - Cuartos     | `cal-mc-cua`          |
| 24 Jul    | Mundialito Clubes - Semis       | `cal-mc-sf`           |
| 28 Jul    | Mundialito Clubes - FINAL       | `cal-mc-fin`          |

**Conflicto con Mundial 2032 selecciones**: las fechas 04 Jul, 08 Jul,
12 Jul, 20 Jul COINCIDEN con `cal-mf-g3`, `cal-mf-g4`, `cal-mf-rep`,
`cal-mf-fin` (Mundial 2032 grupos J3/J4 + Repesca + FINAL). Asumimos
que **NUNCA se juegan ambos torneos la misma temporada** (cada uno
ocupa una temporada distinta del ciclo de 4 años). Si en el futuro
sí coexisten, habrá que mover las fechas o desolapar.

### Mapeo en `_realPair` (regla bloqueante CLAUDE.md)

`_realPair` detecta los días del Mundialito por la clase `ag-inter`
+ etiqueta `Mundialito Clubes - ...`, fuerza `tid='mundial'`
LOCALMENTE (sin persistir en `d.tour`) y mapea la etiqueta a
`_dayPartidoN`:

- `Mundialito Clubes - J1/J2/J3` → `_dayPartidoN = 1/2/3` → cj=0/1/2
- `Mundialito Clubes - Octavos` → `_dayPartidoN = 4` → _dayInKo, koIdx=0
- `Mundialito Clubes - Cuartos` → `_dayPartidoN = 5` → koIdx=1
- `Mundialito Clubes - Semis`   → `_dayPartidoN = 6` → koIdx=2
- `Mundialito Clubes - FINAL`   → `_dayPartidoN = 7` → koIdx=3

(`grpJors=3` fijo: 4 equipos × round-robin single-leg = 3 jornadas.)

`_cardMatch` también reconoce `_isMundialitoCalDay` (mismo regex) y
fuerza `tourNm = 'Mundialito de Clubes'` en el título de la card.

### Reglas a respetar

1. **PROHIBIDO** renombrar el tourId built-in `'mundial'` o cambiar
   su `format` a algo distinto de `'groups-ko'`. El motor entero
   (CSS, `_realPair`, calendario, hub, gm-modal) depende de esto.
2. **PROHIBIDO** usar la clase `c-mundial` en cualquier card NUEVA
   del Mundialito de Clubes — usar `c-mundialito`. `c-mundial` está
   reservada para Mundial 2032 selecciones (cyan/turquesa).
3. **PROHIBIDO** modificar `data-tour="mundial"` en `_koRowHtml`. Es
   el marker que pinta las cards KO en amarillo via
   `.mn-card[data-tour="mundial"]`.
4. **PROHIBIDO** persistir `d.tour='mundial'` desde `_realPair` en
   días Mundialito. El override es LOCAL al call — el flag
   `_isMundialitoDay` gates el bloque de persistencia.
5. **PROHIBIDO** caer al placeholder `_cardNonTour` en días
   Mundialito. `_cardMatch` debe detectar `_isMundialitoCalDay` y
   rutear al flow de torneo igual que `ag-torneo`.
6. **Si el admin no ha lanzado el torneo** (cfg `mundial` con teams
   vacíos), `_realPair` devuelve null para días Mundialito → la card
   del hub muestra CONTINUAR ▶. NO se inventa partido fantasma.
7. **Toda comp NUEVA cuyas filas usen `ag-inter`** (icono 🌐) ya
   queda enrutada a `_realPair` automáticamente — solo necesita su
   propia rama de parseo de `_dayPartidoN` y override local de `tid`.

## Card "Próximo partido" del hub: el CALENDARIO INDIVIDUAL es la única fuente de verdad (obligatorio, 2026-05-27)

**Principio bloqueante**: la card "Próximo partido" del hub Liverpool
(`#ps-stage` en `s-munich`) SIEMPRE deriva el rival a partir de la fila
actual del CALENDARIO INDIVIDUAL del Liverpool-Francia
(`_calRows()[d.dayIdx]`, las filas `.ag-r` del `#ag-content`). El label
de esa fila (`Partido N`, `Liga — J N`, `Copa — Ronda X`,
`Mundial Octavos`, `Champions — J3`, etc.) dicta qué partido se debe
mostrar, sin excepción.

### Por qué esta regla existe

Los cursores manuales (`d.tour`, `cfg.currentJornadaByGroup`,
`cfg.koCurrentRound`, `currentRound`…) **solo avanzan al pulsar
botones específicos** en la pantalla de cada torneo (🏆 J{N+1},
🏆 Avanzar KO, etc.). El usuario juega su partido desde la card del
hub directamente y NUNCA visita la pantalla del torneo, así que esos
cursores se quedan congelados en 0 → la card mostraba el mismo J1 los
días 08 Jun, 12 Jun, 16 Jun… (bug 2026-05-27 con foto Tigres UANL 1-2
Liverpool repitiéndose).

### Mapeo canónico (en `_realPair`)

1. Leer `d.dayIdx` y `_calRows()[d.dayIdx]`.
2. Extraer el número de la etiqueta:
   - Torneos de verano (JG/SCT/PSS/Asia): regex `Partido\s+(\d+)`.
     `Partido N` mapea a:
     - **Fase de grupos**: jornada `N-1` (0-indexed) de
       `cfg.groupFixtures[gIdx]` (override de `currentJornadaByGroup`).
     - **Fase KO** (si `koBracket` existe): ronda
       `N - groupJors - 1` de `cfg.koBracket` (override de
       `koCurrentRound`).
   - Liga EA Sports: regex `Liga\s*[—\-]\s*J(\d+)` → jornada de liga.
   - Otras competiciones: añadir su rama al parseo y mapeo cuando se
     incorporen.
3. Los cursores manuales (`currentJornadaByGroup`, `koCurrentRound`,
   `currentRound`) son **advisory** — solo se usan como fallback si
   el día actual no se puede derivar del calendario.

### Reglas a respetar

1. **PROHIBIDO** usar `cfg.currentJornadaByGroup[gIdx]` /
   `cfg.koCurrentRound` / `cfg.currentRound` como fuente PRIMARIA
   en la card del hub. Solo fallback cuando no hay día parseable.
2. **PROHIBIDO** crear cursores nuevos que requieran pulsar un botón
   para avanzar y luego usarlos en la card. Si una comp nueva añade
   esa lógica, se vuelve a hardcodear el bug.
3. **Toda comp nueva** que entre por `_realPair` / `_selPair` debe
   tener su rama en el parseo de "Partido N" / "J N" / "Ronda X" del
   calendario individual, ANTES de leer cualquier cursor del cfg.
4. **PROHIBIDO** introducir "auto-avance del cursor al jugar el
   partido" como alternativa a esta regla. Es un parche frágil: si el
   usuario pospone un día, los cursores y el calendario se vuelven a
   desincronizar. La regla `calendario = fuente única` es robusta
   por construcción.
5. **Fix de saves antiguos**: cuando un cfg legacy tenga cursores
   apuntando a una jornada distinta a la que demanda el calendario,
   `_realPair` ignora el cursor y respeta el calendario. La pantalla
   del torneo seguirá pintando el cursor (UI inconsistente con el
   hub si el usuario no pulsa "🏆 J{N+1}"), pero la card del hub
   siempre es correcta. Esto es aceptable — la card es lo crítico,
   la UI del torneo solo afecta a quien entre a la pantalla.

### Beneficios

- Estado-drift IMPOSIBLE: el calendario es inmutable per-temporada y
  todas las cards mapean determinísticamente.
- Funciona en cualquier dispositivo / sesión / hidratación parcial.
- No requiere que el usuario visite pantallas auxiliares para que la
  card del hub avance correctamente.
- Si una temporada futura cambia las fechas del calendario, todas las
  cards se reajustan automáticamente.

## Card "RIVAL PENDIENTE" en eliminatorias (obligatorio, 2026-05-26)

Cuando la card "Próximo partido" del hub Liverpool (`#ps-stage` en
`s-munich`) llega a una ronda KO de una eliminatoria
(Mundial selecciones, Mundialito Clubes, fases finales Champions/EL/
UECL, Recopa, Supercopas, Intercontinental, Copas, torneos de verano
con KO, etc.) pero el rival aún es TBD porque **la FASE PREVIA no se
ha simulado** (grupos pendientes o ronda KO N-1 pendiente), la card
muestra un estado de BLOQUEO en vez del legacy "JUGADORES FUERA ·
CONTINUAR ▶".

### Estado de bloqueo

- Banner ámbar `⚠️ RIVAL PENDIENTE — El admin aún no ha simulado <fase
  previa>. Avísale, o pulsa el botón para auto-simular los IA vs IA
  pendientes y desbloquear el sorteo.`
- Botón 📌 Posponer (top-left, igual que en cards normales): salta el
  día (no añade a PARTIDOS PENDIENTES porque no hay matchKey real).
- Botón principal `🤖 SIMULAR FASE PREVIA · +10 🪙` (turquesa): auto-
  simula los partidos IA-vs-IA de la fase previa con el motor 4-ejes,
  construye el bracket de la siguiente fase y RECOMPENSA al usuario
  con +10 🪙. La recompensa solo se acredita si se simuló ≥1 partido
  (idempotente — re-pulsar sin progreso no da más oro).

### Detección + sim (`misc_body_1.html`)

Helpers canónicos (IIFE PRETEMPORADA, líneas ~4100-4600):

- `_psDetectPendingPrevPhase(cfg, opts)`: detecta si la fase previa
  tiene partidos sin jugar. Recursa hacia atrás si la ronda previa
  tampoco existe (kb[N] empty → kb[N-1] empty → ... → groups empty).
- `_psListPendingGroupMatches(cfg, compKey)`: iteración round-robin
  de groupFixtures, devuelve `[{matchKey, home, away, hHuman, aHuman}]`.
- `_psListPendingKoMatches(cfg, koRoundIdx, bracketProp, compKey)`:
  iteración de pares del bracket. Marca `is2Leg` cuando el formato es
  `ko-2leg` para que la auto-sim los SALTE (el sim batched no replica
  la lógica IDA+VUELTA con desempate por gol visitante / penaltis).
- `_psAutoSimPendingPhase(tourId, pendingInfo)`: itera matches, sim
  solo IA-vs-IA (humanos sin tocar — cada humano debe jugar / posponer
  el suyo), persiste cfg con UN solo `_tourSave` final (batch).
  Devuelve `{simmed, humanRemaining}`.
- `_psBuildNextBracket(cfg, pendingInfo)`: tras la sim, construye el
  bracket de la siguiente fase (grupos → koBracket[0] para
  mundial-48 vía `_mundialQualifiers`; KO N → KO N+1 con
  `_tourRebalanceHumans`). Idempotente: salta si la fase aún tiene
  partidos pendientes.
- `_psAutoChainBuildMundial(cfg, tourId)`: chain-construye TODOS los
  brackets KO que se puedan construir (grupos → kb[0] → kb[1] → ...).
  Se llama al entrar a `_selPair` para sincronizar el estado sin que
  el usuario tenga que visitar la pantalla del torneo.
- `_cardPendingPrevPhase(day, info)`: renderiza la card de bloqueo
  + wire-up de POSPONER y SIMULAR FASE PREVIA.

### Reglas a respetar

1. **Los humanos NUNCA se auto-simulan.** `_psAutoSimPendingPhase`
   los cuenta como `humanRemaining`. Si el grupo / ronda contiene
   partidos con otro humano (Brasil, Inglaterra, Noruega, Argentina,
   España, o cualquier humano de club en otra eliminatoria), el botón
   sigue activo solo si quedan IA-vs-IA; cuando solo restan humanos,
   el botón desaparece y la card muestra "⏳ Quedan N partidos con
   humanos sin jugar."
2. **+10 🪙 fijos por desbloqueo**, NO por partido. Evita farmeo en
   torneos con 70+ partidos previos.
3. **Solo se acredita si `simmed > 0`.** Re-pulsar sin progreso
   (todos sim'd o humanos pendientes) no da oro, solo toast neutro.
4. **No reintroducir el legacy CONTINUAR ▶** sobre "JUGADORES FUERA"
   en cards con rival TBD por fase previa pendiente — eso es el bug
   2026-05-26 que esta regla arregla (el usuario saltaba el día y
   nunca recuperaba su KO).
5. **ko-2leg está fuera de cobertura batch.** Esos torneos (rara vez
   los hay en el hub Liverpool) mantienen su flujo manual / pay-per-leg.
6. **Toda eliminatoria NUEVA** que se añada al juego con KO
   (custom torneo del admin, nueva comp europea, etc.) que vaya por
   `_realPair` o `_selPair` hereda el flujo automáticamente —
   bastará con que su cfg tenga `groupFixtures` (si hay grupos) y un
   `koBracket`/`bracket` con la estructura estándar de pares.

## Resto del Mundo — 1 vuelta + Intercontinental + Mundialito (obligatorio, 2026-05-27)

La liga `ligaExt_resto-mundo` (44 equipos top de América + Asia,
ver "Resto Mundo" seed en `misc_body_1.html`) es **el único caso
especial** del proyecto en estos 3 ejes:

### 1. Se juega a UNA SOLA VUELTA (no doble round-robin)

`ligaExtSimular` en `misc_body_1.html:~30894` añade un guard
`_singleRound = (slug === 'resto-mundo')`. El bucle de pares pasa de
`pj=0` a `pj=pi+1` solo en esta liga: N*(N-1)/2 cruces en vez de
N*(N-1). Con 43 equipos = 42 partidos por equipo (943 cruces totales).

### 2. Las 2 zonas custom de Reglas: Intercontinental + Mundialito

El modal "📜 Reglas de la competición" (`#lext-ov-reglas`) muestra,
SOLO cuando `CURRENT_KEY === 'resto-mundo'`:

- 🟠 **Equipos pasan a Copa Intercontinental**: default 6. Los 6
  primeros de la tabla quedan marcados para Copa Intercontinental
  (la conexión real al bracket de Intercontinental se hace cuando
  cada equipo haya jugado sus 42 partidos de liga — wiring pendiente
  de un cambio futuro). Esta zona NO alimenta a Recopa.
- 🏆 **Equipos clasifican a Mundialito Clubes**: default 16. El
  Mundialito se celebra cada 4 temporadas y el usuario rellena el
  roster a mano. Esta zona es **informativa + visual** (colorea
  los puestos 7–16 de la tabla en azul claro `#50a0dc`) pero NO
  alimenta ningún pool automático.

Las otras 7 zonas (UCL / Previa / Open / E.League / Conference /
WildCard / Descenso) **se ocultan** en Resto del Mundo (su modal y
su leyenda), porque la liga está en `EUROPE_BLACKLIST` (no clasifica
a competiciones europeas estándar).

Coloreo de la tabla (`zoneClass`):

- Posiciones 1–6 → `.lext-row.z-inter` (banda naranja `#ff9020`).
- Posiciones 7–16 → `.lext-row.z-mundial` (banda azul claro
  `#50a0dc`). El cómputo es
  `mundialDelta = max(0, mundialClubes - intercontinental)` para que
  `mundialClubes=16` represente los 16 mejores TOTALES, no 16 plazas
  adicionales tras las 6 de Intercontinental.

Storage: `data.config.zones = {ucl,uclPrev,uclQual,uel,uecl,wildcard,intercontinental,mundialClubes,desc}`.
Migración automática: `_upgradeRestoMundoZones()` parchea saves
antiguos:
- pre-2026-05-26: setea `intercontinental=6` + `mundialClubes=16`.
- 2026-05-26 → 2026-05-27: copia `z.recopa` (6) → `z.intercontinental`
  y borra `z.recopa`. Resto del Mundo dejó de alimentar Recopa.

Lectura legacy: `zoneClass` y el load del modal Reglas leen
`z.intercontinental`, cayendo a `z.recopa` solo si el primero está
ausente (saves nunca abiertos tras la migración).

### 3. La Copa Resto del Mundo NO clasifica a Recopa (2026-05-27)

El bloque "🛡 Recopa de Europa · Plazas" del modal Reglas de la copa
(`_lecRenderReglas` en `misc_body_1.html`) se OMITE cuando
`CURRENT_KEY === 'resto-mundo'`. En su lugar se muestra el texto:
"Esta copa no clasifica a ninguna competición europea — solo se
corona al campeón.". El resto de copas nacionales (FA Cup, Coppa,
etc.) mantienen el bloque clásico con Campeón=1 fijo y Subcampeón
toggle 0/1 hacia Recopa.

### 4. Motor Recopa de Europa — pendiente de rediseño

El `_buildPool` de Recopa (`misc_body_1.html:~12665`) **YA NO**
lee `ligaExt_resto-mundo`. Su pool queda restringido a los manuales
de "EA Sports → Europa" slug 'recopa' (`_meaTeamsFor('recopa')`).
Con solo 2 manuales el bracket de 8 no es sorteable — Recopa
queda pendiente de un rediseño separado (el usuario indicó "se
alimenta de 64 equipos exclusivamente europeos"). Hasta entonces,
las pantallas `s-recopa-rd-*` y los eventos del calendario
(`cal-rec-q`, `cal-rec-s`, `cal-rec-fin`) permanecen pero no se
podrán arrancar sin pool completo.

### Reglas a respetar

1. **No reintroducir el feed `ligaExt_resto-mundo` → Recopa**.
   Resto del Mundo alimenta Copa Intercontinental (a futuro,
   cuando se complete la temporada de liga), no Recopa.
2. **No hardcodear `intercontinental:6` ni `mundialClubes:16`** en
   builders nuevos. Leer siempre de `data.config.zones`. Default
   6/16 lo aplica `_upgradeRestoMundoZones`.
3. **No reintroducir el bloque "Recopa de Europa · Plazas"** en la
   Copa Resto del Mundo. Ninguna copa de esta liga clasifica a
   competiciones europeas.
4. **No quitar `resto-mundo` de `EUROPE_BLACKLIST`**. La liga sigue
   sin clasificar a UCL/UEL/UECL/Open/WildCard/Recopa (esas plazas
   se resuelven SOLO desde las ligas europeas y manual EA Sports).
5. **Cualquier nueva liga que se juegue a UNA vuelta** debe
   replicar el guard `_singleRound` en `ligaExtSimular`. La regla
   por defecto sigue siendo doble round-robin.
6. **El storage key `z.recopa` queda deprecated** para Resto del
   Mundo. Cualquier código que necesite ese cupo debe leer
   `z.intercontinental` con fallback `z.recopa` (solo para saves
   pre-migración que aún no se hayan abierto).

## Hub del usuario: Liverpool (no Bayern) — obligatorio, 2026-05-25

El equipo HUMANO del hub (la pantalla `s-munich`, la card "Próximo
partido", el calendario, los entrenamientos, el menú médico de
inyecciones, las pretemporadas) **es el Liverpool 💡**, NO el
Bayern. Bayern es **IA** y vive en la Liga Alemana
(`ligaExt_resto-de-ligas-*`).

### ¿De dónde viene el nombre "Bayern" en el código?

El hub se construyó originalmente sobre el slot "Bayern Munich" de
Liga EA Sports — los identificadores internos (`s-munich`,
`munich-next-match`, `BAYERN_SHIELD`, `_bayernSquad`, etc.) son
legacy de esa época. El **2026-05-23 el usuario renombró el slot a
Liverpool** vía el editor de Liga EA Sports
(`_ligaEaSubName('Bayern Munich')` devuelve ahora `"Liverpool"`).
Los identificadores con "munich" / "bayern" en el nombre siguen ahí
por compatibilidad, pero el contenido es Liverpool.

### Helpers canónicos para el nombre / plantilla / escudo del hub

```
window._mkHubTeamName               // string canónico del hub humano
_psHumanName()                       // visual (menu_home_v1.ov o _ligaEaSubName)
_psHumanLogicName()                  // lógico (siempre _ligaEaSubName del slot Bayern)
_psHumanShield()                     // URL del escudo
_athHubTeam()                        // equivalente para el menú médico
```

### Reglas a respetar

1. **Nunca hardcodear `/bayern/i` o `'Bayern Munich'`** para resolver
   la plantilla / escudo del usuario. Usa los helpers de arriba.
   Si una función nueva necesita el equipo del hub, debe leer el
   nombre lógico (`_psHumanLogicName` o `_mkHubTeamName`) y resolver
   contra ese.
2. **`_bayernSquad()` ya está parcheado** para hacer 3 lookups en
   `ligaExt_liga-ea-sports`: (1) match exacto por nombre lógico,
   (2) primer team con `isHuman:true`, (3) fallback histórico
   `/bayern/i`. NO eliminar los fallbacks — cubren saves antiguos.
3. **El sistema de bajas / inyecciones / "Bajas — NO convocar" /
   plantilla del HUD / mensajes de la bandeja** se refiere SIEMPRE
   al equipo del hub (Liverpool actualmente). Los 4 emojis humanos
   restantes (🐭 Brasil, 🔨 Inglaterra, ✏️ Noruega, 😈 Argentina,
   🦆 España son SELECCIONES — no aplica) y los OTROS 4 humanos de
   Liga EA Sports (Real Madrid, Barcelona, Atlético, Arsenal — más
   el del slot Bayern que es Liverpool) tienen su propio sistema
   pero NO entran en el hub `s-munich`.
4. **Si un bug futuro reporta "no hay lesiones de entrenamiento" o
   "no aparecen jugadores del hub"**, lo primero es comprobar si
   se está usando `_bayernSquad()` u otra resolución hardcoded a
   Bayern. El usuario renombró el slot y todas las rutas que
   resuelvan el hub deben usar los helpers dinámicos.

### Probabilidades del entrenamiento (referencia, 2026-05-25)

`_rollInjuries()` en `misc_body_1.html:3217-3225`:

| Resultado                  | Probabilidad |
|----------------------------|--------------|
| 2 jugadores lesionados     | 2 %          |
| 1 jugador lesionado        | 5 %          |
| Ninguno (sin bajas)        | 93 %         |

Total: 7 % de los entrenamientos genera al menos una lesión. El
sorteo es **en el segundo 0** (al pulsar ENTRENAR), antes de que la
barra se rellene. Los lesionados se eligen de la plantilla del
**Liverpool** (resuelto vía `_bayernSquad()` que ahora hace lookup
dinámico) y se descartan los que ya tienen baja activa.

## Fecha de la PANTALLA DE PREVIA — fuente única calendario (obligatorio, 2026-05-25)

La fecha que muestra la PANTALLA DE PREVIA junto al icono 🗓️ (línea
`X de <Mes> | 🏆 <comp>`) NO se inventa ni se setea con `new Date()`.
**Fuente única**: el calendario global (filas `.ag-r` del DOM,
generadas por SSR desde `calendario.json`).

### Pipeline

1. `_mmAgDateMap()` lee TODAS las filas `.ag-r` de `#ag-content` y
   construye `{ <label>: {date, wx} }` indexado por el texto del
   `.ag-lbl`.
2. `_mmCalLabel(matchKey, compKey)` resuelve el `<label>` exacto
   que debe coincidir con la entrada del calendario:
   - Liga: `Liga — J<N>` (regex `^lj<N>m`).
   - Copa del Rey: `Copa del Rey — <ronda>` (regex `^copa_<r>_<i>_<l>`).
   - Mundial · 48 selecciones (compKey `'torneo'` + cfg.format
     === `'mundial-48'`): lee `_ppPreviaTeams.tourId/tourKey`, carga
     la cfg vía `_tourLoadCachedSync` / `_TOUR_CACHE` y mapea:
     - Grupo J<N> → `Mundial Grupo — J<N>` (regex `^g\d+_<jor>_`).
     - KO (`ko_<rIdx>_<mIdx>`) → ronda según
       `cfg.formatConfig.koRounds[rIdx]`:
       - `Dieciseisavos` → `Mundial - Dieciseisavos`
       - `Octavos`       → `Mundial Octavos`
       - `Cuartos`       → `Mundial Cuartos`
       - `Semis`         → `Mundial Semis`
       - `Tercer Puesto` → `Mundial Tercer Puesto`
       - `Final`         → `MUNDIAL GRAN FINAL 🏆`
   - Resto (inter/usc/ucl-fin/uel-fin/...): `MAP[compKey]`.
3. `_mmInjectEnv` mete `<dayNum> de <Mes>` en `#pp-env` usando el
   resultado anterior.

### Reglas a respetar

1. **PROHIBIDO hardcodear fechas en la previa** (`"31 de Mayo"`,
   `"25 de Mayo"`, etc.). Si una comp nueva no resuelve fecha, la
   solución es añadir su rama a `_mmCalLabel` para que mapee al
   `.ag-lbl` del calendario, NO escribir la fecha a mano.
2. **PROHIBIDO sustituir el calendario por `new Date()`** en el
   pipeline de la previa. El cálculo "hoy" SOLO se usa como
   fallback degradado cuando no hay match en el calendario.
3. **Toda comp NUEVA con humanos** que abra la previa
   (`showPrePartidoOverlay(matchKey, compKey, ...)`) DEBE tener su
   rama en `_mmCalLabel` para mapear matchKey → `.ag-lbl`.
4. **Toda nueva ronda de Mundial-48** (p. ej. si se añade una
   ronda extra) DEBE tener:
   - Su evento en `calendario.json` con `event.name` exacto.
   - Su entrada en `MUNDIAL_KO_LABELS` de `_mmCalLabel` mapeando
     el nombre de la ronda (tal como aparece en
     `cfg.formatConfig.koRounds`) al `event.name` del calendario.
5. **El `compLabel`** de la previa (después del icono 🏆) en
   partidos de Mundial-48 se construye como:
   - `Mundial 2032 · GRAN FINAL 🏆` para la última ronda.
   - `Mundial 2032 · <RoundName>` para semis/cuartos/octavos/...
   - `Mundial 2032 · Grupo J<N>` para fase de grupos.
   NO mostrar `'torneo'` crudo (bug 2026-05-25).

### Histórico

- 2026-05-25: bug Marruecos vs Francia (GRAN FINAL del Mundial
  2032). La card del hub mostraba `31 May` (correcto) pero la
  previa `25 de Mayo` (HOY) porque `_mmCalLabel` no tenía rama
  para `compKey === 'torneo'`. `_tourOpenHumanMatch` pasa
  `compKey='torneo'` para TODOS los formatos de torneo (mundial-48,
  ko, league, groups-ko, swiss...), así que el matchKey
  `tour_<tourId>_ko_5_0` caía a `MAP[compKey] || null` → null →
  fallback a `new Date()`. Fix: rama `compKey === 'torneo'` que
  usa `_ppPreviaTeams.tourId/tourKey` + `cfg.formatConfig.koRounds`
  para resolver la etiqueta del calendario.

## Tema del gm-modal por competición (obligatorio, 2026-05-24)

El gm-modal (la pantalla del partido HvH/HvIA que ve el usuario) lee
la comp activa vía `_gmCompFromState()` y le aplica la clase
`is-comp-<X>`. Esa clase fija las CSS vars `--comp-color` y
`--comp-color-soft` que pintan TODOS los bordes/glow del modal:
caja exterior `#gm-inner`, FINALIZAR (`.gm-end-moved`), PRÓRROGA
(`#gm-btn-et`) y la franja superior de `gm-finalizar-slot`.

### Mapa comp → tema (obligatorio)

| comp en `_gm.comp`                                | clase            | `--comp-color`  | Justificación                                |
|---------------------------------------------------|------------------|-----------------|-----------------------------------------------|
| `liga`/`ea-sports`/`''`/`null`                    | `is-comp-liga`   | `#ff5060` rojo  | Liga EA SIEMPRE roja (legacy)                |
| `copa`/`copa-fin` (o `_isCopa`)                   | `is-comp-copa`   | `#ffb050` ámbar |                                               |
| `sc`/`sc-final` (o `_isSc`)                       | `is-comp-super`  | `#f0c820` oro   |                                               |
| `recopa` (o `_isRecopa`)                          | `is-comp-recopa` | `#ff8060`       |                                               |
| `superliga` (o `_isSuperliga`)                    | (vacío)          | rojo default    | Sin tema explícito (los 6 humanos)            |
| `ucl`                                             | `is-comp-ucl`    | `#88aaff` azul  |                                               |
| `uel`                                             | `is-comp-uel`    | `#ffaa55`       |                                               |
| `uecl`                                            | `is-comp-uecl`   | `#5fe08a`       |                                               |
| `inter`                                           | `is-comp-inter`  | `#f0a040`       |                                               |
| `torneo`/`mundial`/`mundial-48`/`sel`/`sel-fin`/`selecciones` | `is-comp-mundial` | `#a875e8` violeta | Mundial-48 (compKey `torneo` vía `_tourOpenHumanMatch`) y Selecciones |
| `amistoso`/`wprev`/`mundialito`                   | `is-comp-amistoso` | `#7da7c8` azul grisáceo |                                       |
| `verano`/`sct`/`jg`/`pss`/`asia`                  | `is-comp-verano` | `#5fc6c8` turquesa |                                           |
| **cualquier otra (fallback)**                     | `is-comp-neutral` | `#88a0c0` gris azulado | **PROHIBIDO** caer al rojo de Liga       |

### Reglas a respetar

1. **Toda comp humana NUEVA** que se añada (custom o de un torneo
   nuevo) DEBE tener su rama en `_gmCompFromState()` (en
   `templates/partials/part2/misc_body_2.html`, cerca de la línea del
   bloque "GM-MODAL · tema + colores de equipo").
2. **PROHIBIDO** dejar el fallback en `'liga'`. Cualquier comp no
   reconocida debe caer a `'neutral'` para evitar el bug
   2026-05-24 (Mundial-48 con todos los bordes rojos — foto Francia vs
   RD Congo).
3. **PROHIBIDO hardcodear `border:1px solid red`** o `var(--comp-color)`
   en elementos nuevos del gm-modal sin antes verificar el tema actual.

## Card bicolor del gm-modal (obligatorio, 2026-05-24)

El fondo del gm-modal lleva un **tinte bicolor** según los colores
reales del escudo:

- **Mitad izquierda** = color dominante del escudo LOCAL
  (`--team-a-bg`, alpha 0.25).
- **Mitad derecha** = color dominante del escudo VISITANTE
  (`--team-b-bg`, alpha 0.25).

Las vars las setea `_gmPaint(pa, pb)` en
`templates/partials/part2/misc_body_2.html`. El paint corre 2 veces:
primero con el "seed" (color de `_teamColors` / `_hashColor` por
nombre) para que el bicolor NUNCA esté vacío, y luego repinta cuando
la extracción real del escudo (`_crestPrimary` → `extractColors`)
resuelve.

Si el escudo del rival no se ha cargado aún o no existe, las CSS
vars caen a defaults `rgba(40,60,120,.25)` (azul oscuro local) y
`rgba(60,40,90,.25)` (morado oscuro rival) — petición explícita del
usuario "si no hay escudo todavía del rival pon el color que más te
guste".

### Caja "+ AÑADIR EVENTO" bicolor (obligatorio)

La caja AÑADIR EVENTO (`#gm-add-btn`) usa el mismo bicolor pero a
alpha alto (0.82-0.95) para que sea bien visible. El borde es
`1px solid rgba(255,255,255,.22)` — **PROHIBIDO** usar
`var(--comp-color)` en este borde (creaba el aro rojo del bug
2026-05-24).

### Reglas a respetar

1. **No quitar `background-attachment:fixed`** del bicolor del modal
   — sin él, el degradado se descoloca al hacer scroll del modal.
2. **No subir el alpha por encima de 0.30** en `--team-a-bg`/`--team-b-bg`
   — el texto del modal deja de ser legible.
3. **No reintroducir `border:2px solid var(--comp-color)`** en el botón
   AÑADIR EVENTO — eso es lo que causaba el aro rojo cuando el comp
   caía al fallback liga.
4. Si añades un elemento nuevo dentro del gm-modal con borde, usa
   `var(--comp-color, #88a0c0)` con fallback neutro, NUNCA hardcodear
   rojo.

## Sanciones y lesiones — SELECCIONES NACIONALES (obligatorio, 2026-05-24)

Sistema PARALELO al de clubes (`calcularSancionesPartido` /
`YELLOW_STORE` / `SANCION_STORE` / `LESION_STORE`). **NO se cruzan**:
un jugador sancionado en su selección puede jugar con su club, y
viceversa. Cada selección tiene su propio contador.

### Selecciones humanas (6, canónicas)

Francia💡, Brasil🐭, Inglaterra🔨, Noruega✏️, Argentina😈, España🦆.

La lista vive en `SEL_HUMANAS` en el bloque IIFE
`SANCIONES + LESIONES — SELECCIONES NACIONALES` al final de
`static/js/index.bundle.js`. Helper canónico:
`window._esSelHumana(name)` (también acepta selecciones marcadas
como humanas en el editor vía `selecciones_squad_v1.teams[].icon` →
`_SEL_HUMAN_ICONS`).

### Detección de partido de selección

`window._esCompSel(compKey)` devuelve `true` para:
- `compKey === 'sel'` (clasificación J1-J10, calendario `cal-sel1..10`).
- `compKey === 'sel-fin'` (Mundial fase final, `cal-mf-*`).
- `compKey === 'torneo'` cuando el `_TOUR_CACHE[tourId].format` es
  `'mundial-48'` (partidos del Mundial 2032 abiertos desde el hub).

### Reglas (distintas a clubes)

| Evento                          | Selecciones humanas         | Clubes (referencia)       |
|---------------------------------|-----------------------------|---------------------------|
| Lesión "natural" del motor      | 1 partido (el siguiente)    | 1-7 según grado           |
| ⬇️ marcado por usuario          | 2 partidos (este + siguiente) | 2-10 según roll Mod/Grave |
| Doble amarilla (expulsión)      | **1 partido siguiente**     | SIEMPRE 2 partidos        |
| Roja directa                    | **2 partidos siguientes**   | 2-15 con buckets          |
| Acumulación de amarillas        | **Cada 2 = 1 partido (ciclo 2)** | Cada 3 = 1 partido    |

Notas:
- **Sanciones simultáneas → solo se aplica la MAYOR** (no se suman
  como en clubes). Si llega una sanción menor mientras hay una mayor
  pendiente, se descarta.
- **Reset entre torneos automático**: los stores se anidan por
  `torneoKey` (`'sel-clasif'` para J1-J10, `'sel-mundial'` para la
  fase final). Las amarillas de la clasificación NO viajan al
  Mundial y viceversa. Helper manual:
  `window._selResetTorneo('sel-clasif' | 'sel-mundial')`.
- **No hay amistosos de selección** — el sistema solo aplica a
  partidos oficiales. Si en el futuro se añaden amistosos de
  selección, irán por `compKey='amistoso'` (ya excluido por
  `EXCLUDED_COMPS` del sistema de clubes), no sumarán nada.

### Stores y persistencia

- `window.YELLOW_STORE_SEL[torneoKey][selName][playerName] = { count }`
- `window.SANCION_STORE_SEL[torneoKey][selName] = [ { name, remaining, reason, tipo } ]`
- `window.LESION_STORE_SEL[selName][playerName] = { remaining, reason, timestamp }`
  (NO se anida por torneo — una lesión "sobrevive" entre clasif y
  Mundial; se decrementa partido a partido independientemente).
- `window._FORMA_MATCH_STATES_SEL[selName::playerName] = '⬇️'`

Persistencia en `localStorage` clave `ftbol_sel_sanciones_v1`
(autosave cada 5 s + beforeunload). Separada del store de clubes
(`ftbol_lesiones_v1`).

### Helpers públicos

```
window._esSelHumana(name)
window._canonSelHumana(name)        // 'francia' → 'Francia'
window._esCompSel(compKey)
window._selTorneoKey(compKey)        // 'sel-clasif' | 'sel-mundial' | null
window._selCalcularSancionesPartido(events, humanTeam, teamName, compKey)
window._selAddSancion(torneoKey, selName, playerName, reason, partidos, tipo)
window._selCumplirSancion(torneoKey, selName, playerName)
window._selAddLesion(selName, playerName, partidos, reason)
window._selCumplirLesion(selName, playerName)
window._selResetTorneo(torneoKey)
window._selPendientesPara(home, away, compKey)    // { sanciones, lesiones }
window._selConsumirParaPartido(home, away, compKey)
```

### Hooks instalados sobre el sistema de clubes

El bloque al final de `index.bundle.js` envuelve estas funciones del
sistema de clubes para enrutar al motor SEL cuando `esCompSel(comp)
&& esSelHumana(teamName)`:

- `window.calcularSancionesPartido` — delega a
  `_selCalcularSancionesPartido` en partidos de selección.
- `window._sancionConfirm` — además de la decrementación de clubes,
  llama a `_selConsumirParaPartido` (idempotente por
  `_sancionConsumedFor['SEL_' + mk]`).
- `window._formaToggle` — ⬇️ en selección registra 2 partidos en
  `LESION_STORE_SEL` (no en `LESION_STORE` global como hace en
  clubes), evitando contaminación al club del jugador.
- `window._renderFormaChecklist` — render propio en partidos de
  selección con los rosters de las 6 selecciones humanas.
- `window.showSancionOverlay` — render self-contained desde
  `SANCION_STORE_SEL` + `LESION_STORE_SEL` (el original hace
  early-return si los stores globales están vacíos, que SIEMPRE lo
  están en selección).
- `window._refreshSancionInjList` — en selección re-renderiza desde
  `LESION_STORE_SEL` para no pisar la lista con "Sin lesionados" al
  togglear ⬇️.
- `window._registrarLesionesDesdeEventos` — particiona los eventos
  por equipo: lesiones de selección humana → `LESION_STORE_SEL`
  (1 partido), resto → motor original.

### Reglas a respetar

1. **No mezclar stores de clubes y selecciones.** Las stores SEL son
   independientes. Cualquier código que añada/lea sanciones de
   selección debe usar `*_SEL` o los helpers `_sel*`.
2. **No hardcodear más selecciones en `SEL_HUMANAS`** sin avisar al
   usuario. Las 6 son canónicas (2026-05-24). Selecciones marcadas
   como humanas en el editor (`_SEL_HUMAN_ICONS`) se reconocen
   adicionalmente por el fallback en `esSelHumana`.
3. **No cambiar los partidos de sanción** (1 d-amarilla, 2 roja,
   ciclo 2 amarillas, 2 ⬇️, 1 lesión natural) sin acordarlo con el
   usuario. Son las reglas explícitas pedidas el 2026-05-24.
4. **No introducir amistosos de selección** sin acordarlo. El
   usuario explícitamente dijo "no hay amistosos de selecciones, y
   en el caso de haber no cuentan" — quedan excluidos del cómputo.
5. **No olvidar el reset por torneo.** La separación por
   `torneoKey` es lo que hace que un nuevo torneo arranque en cero.
   Si se añade un nuevo torneo de selecciones (ej. Eurocopa),
   `_selTorneoKey` debe devolver una key distinta para él.

## Balón fijo Selecciones por jornada (obligatorio, 2026-05-24)

Regla "siempre" pedida por el usuario el 2026-05-24:

- **Selecciones J1 a J8** (`cal-sel1`..`cal-sel8`, fase clasificatoria
  africana, septiembre–marzo) → **`Orbita Africa`** SIEMPRE.
- **Selecciones J9 en adelante** (`cal-sel9`, `cal-sel10`, fase de
  mayo) → **`NIKE CONTROL CBF`** SIEMPRE.
- **Mundial fase final** (`cal-mf-g1`..`cal-mf-fin`, compKey
  `sel-fin`) → **`NIKE CONTROL CBF`** (default existente).

Esta regla GANA sobre el override del admin
(`ball_by_comp_v1['sel']`). Solo el balón de nieve
(`eFootball MAX VIS 26`) puede sobrescribirla, igual que para el
resto de comps.

### Resolución

En `_buildItems(matchKey, compKey, …)` de
`static/js/index.bundle.js`, después de aplicar el override del
admin sobre `COMP_BALL[compKey]`, se inyecta un bloque que detecta
`compKey === 'sel'` + jornada (vía `window._ppBlockId` con regex
`cal-sel(\d+)`, fallback al `matchKey`) y reescribe `balon` a
`'Orbita Africa'` o `'NIKE CONTROL CBF'` según la jornada.

**Mundial 2032 vía `_tourOpenHumanMatch`** (compKey `'torneo'`): el
flujo de torneo NO pasa `'sel'`, pasa `'torneo'`. Para que la regla
también se aplique a partidos de Selecciones lanzados desde la card
del hub (Francia-UAE en May, etc.), el bloque comprueba además
`window._TOUR_CACHE[_ppPreviaTeams.tourId].format === 'mundial-48'`
y, si coincide, fuerza `'NIKE CONTROL CBF'` (Mundial fase final).
Sin esto, `COMP_BALL['torneo']` no existe y `balon` caía al default
inicial `"Ligue 1 McDonald's"` (bug reportado por usuario 2026-05-24
con captura: Francia vs UAE mostraba balón de Liga EA).

En la pantalla `s-calendario.html`, los placeholders `<div class=
"minfo">⚽️ …</div>` de `cal-sel1`..`cal-sel8` muestran "Orbita
Africa"; los de `cal-sel9`..`cal-sel10` y `cal-mf-*` mantienen "NIKE
CONTROL CBF".

### Inventario

El balón `Orbita_Africa` está sembrado en `BALL_DB` (entrada
`{key:'sel-clasif', comp:'Selecciones · Clasif. (J1-J8)',
id:'Orbita_Africa'}` en `misc_body_2.html`), así que aparece en
"INVENTARIO DE BALONES" sin que el admin tenga que añadirlo a mano.
`NIKE_CONTROL_CBF` ya estaba sembrado por la entrada
`{key:'selecciones', comp:'Fase Final Selecciones'}`.

### Reglas a respetar

1. **No cambiar el balón hardcoded** sin acuerdo con el usuario:
   J1-J8 = `Orbita Africa`, J9+ = `NIKE CONTROL CBF`.
2. **No quitar el bloque jornada-aware** de `_buildItems`. Aunque
   el admin asigne otro balón vía `s-admin-balls`, esta regla
   debe ganar (es "siempre" por petición explícita).
3. **Si se añaden más jornadas de Selecciones** (J11, J12, …), la
   rama `_selJor >= 9` ya las cubre; no hay que tocar nada.
4. **No borrar `Orbita_Africa` de `BALL_DB`** — si desaparece de
   `BALL_DB` y el inventario no se ha sembrado nunca en el navegador
   del usuario, el picker del admin no lo tendrá disponible.

## Balón asignado por competición (obligatorio, 2026-05-24)

**Cuando el admin asigna un balón a una competición desde "INVENTARIO
DE BALONES" (pantalla `s-admin-balls`, override
`ball_by_comp_v1[compKey] = ballId`), ese balón DEBE aparecer en
TODAS las cards de partidos donde haya un humano implicado en esa
competición.** Aplica a CUALQUIER tipo de torneo: Liga EA Sports,
Copa del Rey, Supercopa de España, Champions League, Europa League,
Conference League, Recopa, Supercopa de Europa, Intercontinental,
Mundialito de Clubes, Selecciones, Superliga, Torneos de Verano,
amistosos, y cualquier competición custom que el admin añada vía
"+ AÑADIR COMPETICIÓN".

### Resolver canónico

El bundle resuelve el balón en `_buildItems(matchKey, compKey, …)`
de `static/js/index.bundle.js` con esta cadena (NO modificar el
orden):

1. `ball_by_comp_v1[compKey]` — **clave RAW del partido**. Cubre
   las 14 comps base + las 3 extras (`superliga`, `verano`,
   `mundialito`) + cualquier comp custom añadida por el admin.
2. `ball_by_comp_v1[_COMP_TO_BDB[compKey]]` — fallback al alias de
   `BALL_DB` (back-compat de las 14 comps base que históricamente
   se guardaban por la clave `champions`/`uel`/etc. en vez de
   `ucl`/`uel`).
3. `ball_by_comp_v1[_COMP_GROUP_ALIAS[compKey]]` — alias de GRUPO
   (2026-05-25): varios compKeys reales comparten una sola fila en
   Ball Storage. Los torneos de verano (Joan Gamper `jg`, Asian
   `asia`, Pre-Season Super `pss`, Soccer Champions Tour `sct` y
   los genéricos `torneo`/`torneos`) caen sobre la extra `verano`;
   `mundial` cae sobre `mundialito`.
4. `COMP_BALL[compKey]` — default hardcoded por comp (incluye
   defaults para `torneo`/`jg`/`asia`/`pss`/`sct`/`mundialito` para
   evitar que caigan al default genérico `Ligue 1 McDonald's`).
5. Override por clima: nieve → `eFootball MAX VIS 26`.
6. Fallback `ml-ball-name` del DOM (`ball-wrap-<matchKey>`).

### Reglas a respetar

1. **Toda card de partido humano** (HvH, HvIA, IAvH) DEBE construir
   sus items vía `_buildItems(matchKey, compKey, …)`. No reimplementar
   la resolución del balón en una nueva ruta.
2. **Toda nueva competición humana** que se añada al juego DEBE
   pasar su `compKey` real al builder de la card, para que el
   override del admin se aplique automáticamente sin tocar
   `_COMP_TO_BDB`.
3. **No hardcodear nombres de balón** en builders nuevos. El balón
   por defecto va en `COMP_BALL`; el override del usuario gana
   siempre.
4. **No romper `ball_by_comp_v1`** en wipes ni migraciones. La clave
   se persiste en localStorage + servidor (`/api/kv/ball_by_comp_v1`,
   ver sección "Inventario de Balones").
5. **El admin elige el balón con un picker ✅** (overlay) en
   `s-admin-balls`. Prohibido reintroducir `<select>` nativo para
   esta selección (bug 2026-05-24: en algunos móviles el `<select>`
   cancelaba la elección al primer toque).

### Persistencia del inventario

- Cache local: `localStorage` (3 claves: `ball_inventory_v1`,
  `ball_by_comp_v1`, `ball_comp_db_v1`).
- Fuente de verdad: servidor (`/api/kv/<key>` en `app.py`).
- Las escrituras locales se marcan con `_ballMarkLocalWrite(key)` y
  durante 5 min `_ballHydrateAll()` NO pisa la cache con la
  respuesta del servidor (evita race con un GET stale anterior al
  POST del usuario).
- Los flujos `adminBallAdd` / `adminBallAddComp` /
  `adminBallSetForComp` esperan la confirmación del POST y muestran
  toast distinto si el servidor no respondió.

## Sanciones por tarjetas (obligatorio, 2026-05-23)

Sistema único cross-competición en `static/js/index.bundle.js`:
`window.calcularSancionesPartido(events, humanTeam, teamName, compKey)`.

### Reglas

1. **Acumulación de amarillas**: **3 amarillas** → el jugador se
   pierde el próximo partido del calendario. El contador se acumula
   GLOBALMENTE entre TODAS las competiciones (Liga + Copa + UCL +
   UEL + UECL + Recopa + USC + Intercontinental + Mundialito Clubes
   + Selecciones + Superliga + …). Al alcanzar 3 → sanción y reset
   del contador a 0.
2. **Doble amarilla** (expulsión en el mismo partido) → **SIEMPRE 2
   partidos** de sanción. No suma al ciclo de amarillas.
3. **Roja directa** → sorteo 2-15 partidos con buckets:
   - 60% → 2–3 partidos (uniforme: 30%/30%)
   - 25% → 4–6 partidos (uniforme: 8.33%/×3)
   - 10% → 7–10 partidos (uniforme: 2.5%/×4)
   -  5% → 11–15 partidos (uniforme: 1%/×5)
4. **Cumplimiento**: la sanción se cumple en el **PRÓXIMO partido
   del calendario sea de la comp que sea** (excepto excluidas).
   `_sancionConfirm` descuenta 1 al confirmar el overlay BAJAS PARA
   EL PARTIDO; al llegar a 0, la entrada se elimina.
5. **Finales** no aplican acumulación de amarillas (se mantiene la
   regla antigua de no sancionar en una final por amarillas);
   expulsiones (d-amarilla, roja) sí.

### Competiciones EXCLUIDAS

Los **torneos de verano** (Soccer Champions Tour, Premier Summer
Series, Trofeo Joan Gamper, Asian Tournament) + amistosos NO suman
amarillas, NO generan sanción y NO consumen sanción. CompKeys:
`amistoso`, `torneo`, `torneos`, `sct`, `jg`, `pss`, `asia`,
`verano`. Set canónico: `EXCLUDED_COMPS` en `index.bundle.js`.

### Stores

- `window.YELLOW_STORE.__global[player::team] = { count }` —
  contador único cross-comp. Las claves legacy
  `YELLOW_STORE[compKey]` quedan ignoradas en escritura pero se leen
  para no romper save-games.
- `window.SANCION_STORE.__global = [ { name, team, reason, remaining,
  srcComp } ]` — cola única cross-comp. `_addSancion` suma a
  `remaining` si ya hay entrada del mismo jugador (acumulación de
  sanciones).

### Reglas a respetar

- Toda nueva ruta que genere amarillas/expulsiones para un humano
  debe pasar por `calcularSancionesPartido` (no escribir
  directamente en YELLOW_STORE / SANCION_STORE).
- Toda nueva competición HUMANA que se añada debe tener entrada en
  `COMP_CONFIG` con `ciclo:3` (o quedar en `EXCLUDED_COMPS` si es de
  verano/amistosa).
- No reintroducir sorteos `0.5 ? 1 : 2` o rangos 2-8 — están
  obsoletos desde 2026-05-23.

## Humanidad por competición (obligatorio, 2026-05-10)

**Un equipo puede ser HUMANO en una competición y IA en otra.** No
hay una lista global de "equipos humanos del proyecto" — la humanidad
depende del contexto. Helper canónico:
`window.isHumanInComp(name, comp)` (definido en `misc_body_1.html`
arriba del IIFE de UCL/UEL/UECL fase de liga).

| Competición                                | Humanos                                                    |
|--------------------------------------------|------------------------------------------------------------|
| `liga` / `copa` / `sc`                     | Solo los **5 humanos canónicos** de Liga EA Sports         |
| `ucl` / `uel` / `uecl` / `recopa` / `usc` / `inter` / `mundial` / `wprev` / `amistoso` / `torneo` | Cualquier equipo con `humanIcon(name)` asignado (por el editor de plantilla) |
| `superliga`                                | Equipos seleccionados al configurar Superliga (los 6)      |

Los **5 humanos canónicos** son: Real Madrid, FC Barcelona, Atlético
Madrid, Arsenal, Bayern Munich. Vienen de `esHumano()` que lee
`ligaExt_liga-ea-sports.teams[].isHuman`.

Los **humanos extra** (PSG, Manchester United, Borussia Dortmund,
Manchester City, RB Leipzig, etc.) tienen un `humanEmoji` asignado
en el editor de plantilla (Resto de Ligas) que `humanIcon(name)`
devuelve. Estos equipos son humanos SOLO en eur/superliga (donde
juega un humano "secundario") y son IA en Liga doméstica.

Reglas obligatorias:
1. **No usar `esHumano(name)` directamente para flujos eur/superliga.**
   Usar `window.isHumanInComp(name, comp)`.
2. **No añadir teams a la lista global de Liga EA solo para forzarlos
   a humano en otras comps.** Añade `humanEmoji` a su plantilla en el
   editor — eso lo hace humano en eur/amistoso/torneo SIN romper Liga.
3. **No hardcodear listas tipo `EUROPEAN_HUMANS = [...]`.** Cualquier
   chequeo de humanidad va por `isHumanInComp`.
4. **Pantalla obligatoria de estadísticas (posesión/tiros/faltas) tras
   FINALIZAR**: en gm-modal usar `_gmHumanInvolved()` (que cubre
   selecciones nacionales vía `cfg.teams[].isHuman`); en ml-card usar
   el helper local `_mlTeamIsHuman*` que respeta `st.homeIsHuman /
   awayIsHuman` y cae a `isHumanInComp(name, st.comp)` → `esHumano`.
   Bug 2026-05-24: `gmEndMatch` y `mlEndMatchGen` usaban `esHumano()`
   directo → Francia (humano) vs UAE (IA) en el Mundial se finalizaba
   sin pedir las stats obligatorias.

## Límites de almacenamiento por carpeta (obligatorio, 2026-05-02)

Cada carpeta y subcarpeta del almacenamiento del navegador
(localStorage namespace) tiene un cap de **2 MB**. Esto aplica a:

- Cada `ligaExt_<slug>` y todas sus claves derivadas
  (`_protected`, `_snap_<ts>`, …) sumadas.
- Cada estado de competición persistido (`wprev_state_v1`,
  `oq_simulation_v1`, `comp_icons_v1`, …).

Reglas a respetar:

1. **No escribir más de 2 MB en una sola clave.** Si una plantilla,
   acta o snapshot pasa de ese tamaño, hay que recortar (truncar
   históricos, reducir JSON, mover datos al servidor).
2. **No acumular tantos derivados que la suma por carpeta supere
   2 MB.** Por eso `saveData` mantiene como mucho `main` +
   `_protected` + 2 snapshots por liga (drop de `_backup` legacy
    2026-05-02 — ver sección de quota más abajo).
3. **Si añades una nueva clave**, calcula su tamaño máximo plausible
   y déjalo bajo 2 MB. Los datos masivos (miles de eventos, históricos
   largos) van al servidor (`GlobalState` row con su clave) o se
   compactan/agregan antes de persistir.

## Copa del Rey — sorteo de cruces (obligatorio, 2026-05-09)

Reglas del cuadro de la Copa del Rey (`static/js/copa-engine.js`,
función `_pairTeamsConstrained`):

1. **EA solo contra PF / Hyp hasta Dieciseisavos.** Cualquier equipo
   de Liga EA Sports (los 5 humanos + 15 EA-IA) debe enfrentarse a un
   equipo de Primera Federación o Hypermotion en r1, r2 y r16. Nunca
   EA-vs-EA antes de Octavos.
2. **EA-vs-EA permitido desde Octavos**, pero `_preferenceFor` prioriza
   rivales no-EA cuando el bombo aún tenga PF/Hyp disponibles para
   demorar el primer EA-vs-EA al máximo.
3. **Cuartos prefiere no-humano** (regla histórica conservada): el
   primer humano-vs-humano cae idealmente en Semifinales.
4. **Local / visitante por nivel** (no se modifica el sistema previo):
   - Single-leg (r1/r2/r16/fin): `hostIsLower=true` → el equipo de
     MENOR poder juega en su campo. El de mayor poder es visitante.
   - Two-leg (oct/cua/sf): `hostIsLower=false` → IDA en campo del de
     MAYOR poder. La VUELTA, vía el swap del engine
     (`esVuelta ? m.v : m.l`), cae siempre en el campo del de MENOR
     poder. Empate de power → desempate alfabético determinista.

Helpers asociados:
- `_isEa(t)` → considera EA a humanos + `liga-ea-sports` + TBDs cuyo
  posible ganador pueda ser EA (`tbdMayBeEa`).
- `_tbdMayBeEa(tbd)` → mira el partido pendiente de la ronda anterior
  y devuelve `true` si alguno de los 2 contendientes es humano o
  pertenece a `liga-ea-sports`.

Si el nº de equipos llega impar al sorteo, `_computeSorteoPayload`
descarta 1 IA respetando estas reglas:
- r1/r2/r16: drop EA-IA → Hyp → PF (último). Quitar un EA-IA reduce
  presión sobre el pool no-EA; quitar un PF/Hyp lo deja más justo.
- oct+: drop PF → Hyp → EA. Descartamos a los más débiles primero.
- NUNCA descartamos humanos ni TBDs (ganadores pendientes).

## Motor único de simulación IA-vs-IA (obligatorio, 2026-05-09)

**Toda simulación IA-vs-IA del proyecto** (independientemente de la
competición — Liga EA Sports, Copa del Rey, Champions League, Europa
League, Conference League, Recopa, Supercopa de Europa, Supercopa de
España, Intercontinental, Mundialito Clubes, Torneos de Verano,
amistosos, Liga Hypermotion, Primera Federación, ligas externas…)
**debe usar el motor 4-ejes de Liga EA Sports** (`_simIAvsIAWithContext`)
para que los resultados sean coherentes con los valores manuales que
el admin pone en el editor (GLOBAL/ATAQUE/MEDIO/DEFENSA + capitán).

Camino canónico:
1. **Live IA-vs-IA**: `iaSimLive(mk, home, away, j[, j1fn])` →
   internamente llama `_simIAvsIAWithContext(home, away, j)`.
2. **Batch IA-vs-IA Liga EA**: `simularJornadaIA(j)` →
   `_simIAvsIAWithContext`.
3. **Auto-sim IA-vs-IA en gm-modal** (amistosos & equivalents):
   `_gmAutoSimulateIAvsIA()` → `_simIAvsIAWithContext`.
4. **Fallback**: `_fallbackIAvsIAScore` (legacy `simSimple` sobre
   TEAM_RATINGS escalar) **solo** si el motor 4-ejes no está disponible
   en el arranque. Nunca llamar directamente a `simSimple` desde rutas
   nuevas.

Reglas a respetar:
- **Prohibido** añadir nuevos paths que llamen `simSimple(rA, rB)` con
  ratings escalares como motor primario. Usar `_simIAvsIAWithContext`
  o, en su defecto, el wrapper `iaSimLive`.
- Las cajas de Champions/EL/ECL/Recopa/USC/Inter cuando reciban su
  módulo de simulación deben hookear `iaSimLive` con prefijo `mk` y
  registrar el persistor en la cadena `__is*SimPersist` de
  `iaSimLive` (igual patrón que Recopa con `recopa_*` o Supercopa de
  España con `sc_*`).
- HvH y HvIA (con humano) NO se simulan — el humano juega en vivo en
  gm-modal o calendar cards. El AI pre-roll de HvIA en Liga EA usa
  `simSimple` (legacy, conservado por el comportamiento histórico
  documentado del flag `_pendingAIEvents`).

Helpers a reutilizar (todos en `window.*`):
- `_simIAvsIAWithContext(home, away, j)` → motor 4-ejes con
  rojas pre-roll, capitán ×1.05, localía variable seeded.
- `_teamOffense(name)` / `_teamDefense(name)` → 60% atk/def + 40%
  mid, leen `ligaExt_*` o `TEAM_RATINGS`.
- `_captainBonus(name)` → 1.05 si hay C titular, 1.0 si no.
- `_aggressivenessFactor(name)` → 0.5–1.49 para densidad de tarjetas.
- `genMatchEventsEnhanced(teamA, teamB, gh, ga, simCtx)` → eventos
  del acta (goles, tarjetas, lesiones, MVP) consistentes con el
  marcador resultante.

## Iconos del equipo y del jugador en la simulación (obligatorio, siempre)

Cada vez que se simule un partido (Liga, Copa, competiciones europeas,
amistosos o cualquier otro torneo), el motor **debe** leer y aplicar los
iconos definidos en la plantilla. Esto aplica tanto al motor Python
(`app.py`, `logica_liga.py`) como al motor JS (`static/js/*.js`,
`templates/partials/**`).

### 🛡 Nivel / valor del equipo (4 ejes manuales del admin, 2026-05-02)

Cada equipo tiene 4 valores numéricos que el admin define en el
editor de Resto de Ligas (Valor-Poder-Nivel equipo): GLOBAL, ATAQUE,
MEDIO y DEFENSA. Esos 4 números son la **fuente de verdad** y los
devuelve `computeLineStats(t)` en
`templates/partials/misc_body_1.html` tal cual — sin auto-derivar
nada de la plantilla de jugadores.

- **ATAQUE**: más ATQ → más goles marca el equipo.
- **MEDIO**: COMPENSA tanto ataque como defensa con peso `0.5` cada
  lado.
- **DEFENSA**: más DEF → menos goles encaja el equipo.
- **GLOBAL**: balance general. Inclina la probabilidad general del
  partido (peso `0.1` en `attackForce` / `defenseForce`).

Si una línea concreta está vacía o a 0, cae a GLOBAL (`t.power`)
como fallback. Si tampoco hay GLOBAL, default 50.

La plantilla de jugadores SIRVE para listar la nómina, marcar
capitán/lanzadores/goleadores y para el acta del partido. **NO** se
usa para recalcular el GLOBAL/ATQ/MED/DEF del equipo.

#### Historial de la regla (por qué llegamos aquí)

- 2026-04-28: se introdujo auto-cálculo desde la plantilla
  (`ATK = media delanteros`, etc.) para automatizar los valores en
  todas las ligas.
- 2026-05-02 (1ª iter.): el GLOBAL pasó a ser `(ATQ+MED+DEF)/3` en
  lugar de "media de top 11" porque incluir al portero inflaba la
  cifra respecto a los chips visibles.
- 2026-05-02 (2ª iter.): se añadió un toggle "🔒 Forzar valores
  manuales" para que el admin pudiera anular el auto-cálculo.
- 2026-05-02 (3ª iter., final): el usuario reportó que sus 87/88/87/86
  para el PSG bajaban a 81/78/80/84 al renderizar la clasificación —
  el toggle estaba desmarcado por defecto. Se eliminó el auto-cálculo
  por completo: `computeLineStats` devuelve siempre los valores
  manuales, sin checkbox ni opción.

El simulador `simulateMatch(tA, tB)` usa la fórmula:
```
attackForce = ATK + 0.5·MID + 0.1·GLOBAL
defenseForce = DEF + 0.5·MID + 0.1·GLOBAL
goles_A = Poisson(1.3 + 0.025·(attackForce_A − defenseForce_B))
```
Local recibe +3 al GLOBAL como ventaja de casa. Se mantiene el bonus
de capitán `×1.05` sobre el valor del equipo donde aplique.

### ⚾ Goleador nato (natGoal)

- Multiplicador `×1.8` al peso del jugador en la elección de goleador.
- El objetivo es que el goleador nato marque **≈30% de los goles del
  equipo** (ajustado 2026-04-26: antes era ×3 → ~50%).

### 🏀 Goleador estrella (natGoalPro) — prioridad máxima

- Multiplicador `×3.0` al peso del jugador en la elección de goleador.
- El objetivo es que el goleador estrella marque **≈48% de los goles
  del equipo** (rango 46-50%).
- **NO se acumula con ⚾**: si un jugador lleva 🏀, ⚾ se ignora — un
  jugador es "goleador estrella" O "goleador nato" a efectos del peso,
  no ambos. Esto evita que el peso se dispare por encima del 48%.

### P (lanzador de penaltis)

- Cuando se resuelve un penalti, el lanzador se elige preferentemente
  entre los jugadores con flag `penalty` antes de caer al algoritmo
  general.
- Además suma puntos fijos al peso de goleador cuando el gol proviene
  de penalti.

### F (lanzador de falta)

- Cuando el gol proviene de una falta directa, el ejecutante se elige
  preferentemente entre los jugadores con flag `freeKick`.
- Suma puntos fijos al peso de goleador en jugadas de falta.

### ⭐ Elite / estrella

- **NO** afecta al resultado del partido.
- Solo influye en premios individuales (MVP) y noticias.

### C (capitán) — modificador de soporte

- Si hay un capitán titular en el campo, el "valor" del equipo recibe
  un `×1.05` adicional.
- Bonus invisible: no se muestra como estadística, pero sí se aplica.

## Propagación de flags al motor

Los flags viven en el editor de plantilla y se guardan en
`window._LIGA_EA_PLAYER_FLAGS` (JS). Toda función que construya entradas
de jugador para la simulación (`sqFromRegistry`, builders similares)
**debe** propagar los 6 flags (`captain`, `freeKick`, `penalty`,
`elite`, `natGoal`, `natGoalPro`) a cada entry. No basta con propagar
solo `elite`/`natGoal`.

## Qué NO hacer

- No cambies los pesos numéricos anteriores (×1.8 natGoal, ×3.0
  natGoalPro, ×1.05 capitán, etc.) sin acordarlo explícitamente con el
  usuario.
- No añadas simulación nueva sin que consuma estos flags.
- No borres flags al serializar/deserializar plantillas.


## Clasificación a competiciones europeas (obligatorio, 2026-05-02)

Para que un equipo de Resto de Ligas vaya a una competición europea
**directa** (UCL fase de liga, Previa Champions, UEL, UECL) basta con
que haya jugado **al menos 1 partido** en su liga. El check per-team
es: `pj === 0` (cuando hay resultados parciales) → SKIP ese equipo y
avanzar al siguiente del ranking. Esto cubre exactamente el bug
original — equipos sin partido jugado que sorteaban al top por
desempate alfabético sobre `pts=0` tras una Sim batched/asíncrona.

Filosofía: una liga parcialmente simulada SÍ debe contribuir sus
equipos "reales" (los que han jugado al menos algo), no solo los
fully-played. Una liga sin simular nada (rN=0) usa `_rankByPower`
como siempre — todos los teams tienen pj=0 pero es la única señal
disponible.

Las zonas **feeder** (`uclQual` = Open Qualifier, `wildcard`) son
permisivas a propósito — alimentan al OQ y al pool de Previa
Champions, NO clasifican directo a una competición europea. Aceptan
teams con pj=0 sin filtro, para no dejar plazas TBD-OQ-XX.

Lógica en `_computeQualifiedFromLeagues(zoneKey)` (`misc_body_1.html`):

1. Para zonas directas (`ucl`/`uclPrev`/`uel`/`uecl`):
   - Si `rN === 0` → ranking por power (rank-by-power), sin filtro.
   - Si `rN > 0` → ranking por resultados (standings); descartamos
     SOLO los teams con `pj === 0` (race condition / data stale).
2. Para zonas feeder (`uclQual`/`wildcard`), no se aplica filtro.
   Aceptan rank-by-power y standings parciales tal cual.
3. Excepciones absolutas (cualquier zona):
   - **Liga EA Sports / Hypermotion / 1ª RFEF** → bloqueadas en
     `EUROPE_BLACKLIST` (manual-only vía pantalla "EA Sports → Europa").

Bug histórico que motivó el filtro per-team: tras pulsar Sim en una
liga, la escritura de resultados era batched/asíncrona. Durante esa
ventana el admin abría la pantalla de Europa y
`_computeQualifiedFromLeagues` veía `rN > 0` pero `pj === 0` para
varios equipos. Esos equipos empataban a `pts=0` y sorteaban a las
primeras posiciones por desempate alfabético sobre el nombre — el
código los enviaba a Europa con 0 partidos jugados. El check
`pj === 0 → continue` los descarta.

Por qué NO hay gate de liga (`rN < needed → skip whole league`) ni
gate per-team estricto (`pj < expectedPj`): ambos se intentaron en
los commits `c983a56` y `3fb9247` pero resultaron demasiado coarse —
descartaban ligas parciales enteras o teams legítimos que habían
jugado varios partidos pero la liga seguía a medias, dejando el pool
de Previa Champions con TBD-50..63 (reportado por el usuario con
fotos). El check `pj === 0` es exactamente la condición del bug
original sin destruir contribuciones legítimas.

## EXENTOS Previa Champions (obligatorio, 2026-05-02)

Los 3 EXENTOS — los equipos que pasan directos a la Ronda Final de la
Previa de Champions sin jugar la Ronda 1 de eliminatorias — siguen una
regla concreta del usuario, no "los 3 mejores por power":

1. **Bye fijo**: el 5º clasificado de Liga EA Sports. Entra al pool de
   Previa por la pantalla manual "EA Sports → Europa" (Liga EA está
   blacklisted del cómputo automático), así que en el pool tiene
   `league: 'ea-sports-manual'`. Si el admin añadió varios manuales
   para `uclPrev`, prevalece el de mayor power.
2. **2 byes aleatorios**: 2 elegidos al azar de entre los 2º
   clasificados de **Bélgica, Turquía, Suiza, Dinamarca y Escocia**.
   En el pool tienen `league` igual al slug del país. El sorteo se
   renueva en cada `Draw` (`splitByesAndR1` en `misc_body_2.html`).
   Una vez sorteados, los byes se persisten en `wprev_state_v1`, así
   que sobreviven a recargas hasta el próximo Draw.
3. **Fallback**: si faltan candidatos (admin no añadió el español o
   alguna de las 5 ligas no está simulada), se rellena con los
   siguientes equipos del pool por power para no dejar plazas vacías.

Los otros 60 equipos del pool (los no-bye) se dividen en CABEZAS de
serie (los 30 mejores por power) y NO CABEZAS (los 30 peores) y
forman las 30 eliminatorias de Ronda 1.

## Cronómetro del partido — BASE INMUTABLE (obligatorio, 2026-05-10)

**PRECEDENTE PERMANENTE**: el cronómetro de simulación tiene que
correr siempre del minuto 0 al minuto 90 (más descuento) en
**TODAS** las competiciones (Liga EA Sports, Superliga, Copa del
Rey, Champions League, Europa League, Conference League, Recopa,
Supercopa España, Supercopa Europa, Intercontinental, Mundialito
Clubes, Torneos de Verano, amistosos, Liga Hypermotion, Primera
Federación, fases finales de Selecciones, eliminatorias únicas, y
cualquier otra que se añada en el futuro), en los 3 modos:

- **IA vs IA** (1 game-min = 1 sec real, total 1m 30s)
- **HvH** (humano vs humano)
- **HvIA** (humano vs IA / IA vs humano)

Esta regla es **bloqueante absoluta** — ninguna PR puede dejar el
cronómetro clavado en 0' en ninguna competición ni modo. Si un
cambio rompe el avance del cronómetro, ese cambio se REVIERTE.

### Anti-patrones prohibidos (que rompieron el cronómetro en 2026-05-10)

1. **MutationObserver global sobre `document.body` con
   `subtree:true`** que dispara funciones costosas en CADA
   mutación del DOM. Crea bucles porque casi cualquier cosa
   modifica el DOM. → Usa polling con `setInterval` o un observer
   restringido a un nodo concreto.

2. **Bucles `observer → setProperty/classList → observer`**
   sin guard. Toda función que aplique estilos/clases debe ser
   IDEMPOTENTE: cachear una firma (`comp|home|away` o similar) en
   el elemento y `return` temprano si no cambió.

3. **Polling agresivo (< 100ms) competiendo con el setInterval
   del cronómetro**. El timer IAvsIA corre a 1 sec/min, HvH a
   ~875ms/tick. Un `setInterval(fn, 50)` que llama a funciones
   DOM-heavy puede bloquear el event loop y saltar ticks del
   cronómetro. Mínimo recomendado: **100ms para hints visuales,
   300ms para escaneos de cards**.

4. **MutationObserver sobre el propio elemento que el observer
   modifica** sin filtro de "cambió de verdad". Ejemplo: observer
   sobre `#gm-modal[attributes]` que dispara `_gmApplyTheme` →
   `_gmApplyTheme` hace `style.setProperty` → mutación → observer
   → loop. → Filtrar por `prevDisplay !== disp` antes de actuar.

### Patrón canónico para post-procesadores UI de las cards

```js
function _applyThing(el){
  if (!el) return;
  var sig = _computeSig();           // p.ej. comp|home|away
  if (el._lastSig === sig) return;   // GUARD — sin mutations
  el._lastSig = sig;
  // … aplicar estilos / clases / atributos …
}
// Observer SOLO de cambios de display:
var prevDisplay = el.style.display;
new MutationObserver(function(){
  if (el.style.display === prevDisplay) return;
  prevDisplay = el.style.display;
  if (el.style.display === 'none'){
    el._lastSig = null;              // reset al cerrar
    return;
  }
  _applyThing(el);
}).observe(el, { attributes:true, attributeFilter:['style'] });
// Polling de respaldo a ≥100ms con classList.contains() check
// antes de add/remove para evitar mutations innecesarias.
```

Las funciones helper deben usar `_setHintIfChanged(btn, want)` —
comprobar el estado actual antes de mutar.

### Histórico

- 2026-05-10: `MutationObserver` en `document.body[subtree:true]`
  + observer en `#gm-modal[attributes]` + `_gmApplyTheme`
  no-idempotente + polling 50/100ms bloquearon el thread JS y los
  cronómetros de TODAS las competiciones se quedaron clavados en
  0'. Fix: guards de idempotencia, observer restringido a `style`
  con filtro `prevDisplay`, eliminado el observer global, polling
  100/300ms con `_setHintIfChanged`. Documentado aquí como
  precedente permanente.

## Duración del cronómetro del partido (obligatorio, siempre)

**TIEMPOS OFICIALES** (definidos en
`templates/partials/part2/misc_body_2.html`, bloque `_MATCH_RULE`):

| Modo  | gameMin | realMin | displayMin (previa) | ms/tick (5s juego) | s/game-min |
|-------|---------|---------|---------------------|--------------------|------------|
| HvH         | 90 | 16.5  | 10 | ≈ 917 ms | 11 s  |
| HvH prórroga| 30 |  5    | —  | ≈ 833 ms | 10 s  |
| HvIA        | 90 | 9.75  |  8 | ≈ 542 ms |  6.5 s|
| IAIA        | 90 |  1.5  | "45 s/parte" | ≈ 83 ms | 1 s |

- HvH = humano vs humano → **16.5 min reales**. Previa: "10 min". 1 game-min = 11 s reales.
- HvIA = humano vs IA / IA vs humano → **9.75 min reales** (9 min
  45 s). Previa: "8 min". 1 game-min = 6.5 s reales.
- IAIA = IA vs IA → **1 min 30 s reales total** (45 s por parte). 1 game-min = 1 seg real.
- HvH_ET = prórroga humana → 5 min reales.

**REGLA DE ORO 2026-05-19**: `displayMin` (lo que la previa MUESTRA)
y `realMin` (lo que el cron REALMENTE dura) están **DESACOPLADOS** por
petición explícita del usuario. El cron va al ritmo eFootball (11 s/6.5 s
por game-min) mientras la previa muestra "10 min" / "8 min" porque ese
es el número "de referencia" en su memoria. La alineación display=real
del 2026-05-10 (HvH 6.67 s, HvIA 5.33 s) quedó rescindida porque el
cron iba más rápido que eFootball y la vida real.

Historial:
- Pre 2026-04-26: HvH 11 s, HvIA 9 s.
- 2026-04-26 (intermedio): HvH 10.5 s, HvIA 6.5 s.
- 2026-05-10 (alineación display=real): HvH 6.67 s, HvIA 5.33 s.
- 2026-05-19: vuelta al pre-mayo (HvH 11 s, HvIA 9 s) con display desacoplado.
- 2026-05-21: HvIA recalibrado a **7.4 s/game-min** (11.1 min reales).
  El usuario midió "min 45 del juego = min 37 del simulador" con el
  cron a 9 s/game-min → `9 × 37/45 = 7.4 s/game-min` es el ritmo real
  de su eFootball. Con web y juego al mismo ritmo, el minuto del cron
  coincide con el del juego. HvH se mantiene en 11 s. Display previa
  HvIA sigue en "8 min".
- 2026-05-22: HvIA recalibrado a **6.5 s/game-min** (9.75 min reales,
  9 min 45 s). El usuario pidió bajar el cron de la 1ª parte de
  "7 segundos con algo" a 6.5 s. Aplica a todo el partido (HvIA =
  IA vs Humano y Humano vs IA, ambos modos). HvH se mantiene en
  11 s. Display previa HvIA sigue en "8 min".

Estos valores los puede ajustar el usuario mediante petición explícita.
No cambiar sin acuerdo.

`realMin` controla el cronómetro real. `displayMin` / `displayLabel`
controlan SOLO el label visible en la pantalla de PREVIA — están
desacoplados a petición del usuario.

### Inicio de la 2ª parte (obligatorio)

Tras el descanso (HT), al pulsar ▶️ "continuar 2ª parte" el cronómetro
de juego debe arrancar SIEMPRE en `45:00` exacto, NO en `45+N` ni en
`46:00`/`47:00`/`48:00`. El descuento de la 1ª parte ya se mostró
durante "45+1, 45+2…" antes del descanso, así que se descarta al
reanudar. Se aplica tanto al flujo `_ml*` (calendar cards,
`_mlResumeFromDescanso`) como al gm-modal (`gmContinueSecondHalf`):
ambos hacen `timerSec = 2700` y re-anclan `_wallStart` /
`_secAtStart` antes de arrancar el interval.

### Descuento FIJO en regulación (obligatorio, 2026-05-19)

`gameMin = 90` significa que el reloj llega a 90:00 en "tiempo normal".
El descuento de cada parte está **FIJADO** (petición usuario
2026-05-19, no event-driven):

- **1ª parte**: SIEMPRE recorre `45+1, 45+2, 45+3, 45+4` y se **CONGELA
  en 45+4** hasta que el humano pulse `🛌 DESCANSO`.
- **2ª parte**: SIEMPRE recorre `90+1, 90+2, … 90+9` y se **CONGELA
  en 90+9** hasta que el humano pulse `🏁 FINALIZAR`.

El botón `🛌 DESCANSO` emerge en el **min 35** (umbral
`timerSec >= 2100`, petición usuario 2026-05-22; antes min 40).
El botón `🏁 FINALIZAR` cambia a **rojo
brillante pulsante** (clase `.is-near-end`) desde el **min 80**
(`timerSec >= 4800`) hasta que el humano la pulse — la fase
`matchOver` (timerSec ≥ fullMax con cron congelado) sigue mostrando
`🏁 VER RESUMEN` en verde-dorado (precedente 2026-05-17).

El botón `⏱ PRÓRROGA` (gm-modal, `gm-btn-et`) solo emerge desde el
**min 80** (`timerSec >= 4800`) y SOLO si el partido va en empate sin
resolver (`_shouldForceET` — contexto eliminatoria, marcador igualado,
ET/penaltis no jugados). Antes del min 80 la única acción es
`🏁 FINALIZAR`. Petición usuario 2026-05-22: "el botón de prórroga
tiene que emerger en el minuto 80 en el caso de que vayan empate, no
durante todo el partido".

Helper: `window._mlCountStoppageHalves(st)` →
- `{first: 4, second: 9}` para HvH/HvIA en regulación
  (`!st.etDone && !st.isIAvsIA`).
- Event-driven (cuenta eventos del acta) para IA vs IA
  (`st.isIAvsIA`) y para prórroga (`st.etDone`).

**HvIA — slowdown ×1.5 durante el descuento** (petición usuario
2026-05-24). En HvIA / IAvH (un humano contra IA), cada game-minute
del descuento dura **1.5× lo que duraría con el ritmo actual**:

- 1ª parte (`45+1..45+4`): rearm del interval al cruzar `timerSec
  >= 2700` con `tickMs *= 1.5`. Solo HvIA, no HvH ni IAIA.
- 2ª parte (`90+1..90+9`): rearm al cruzar `timerSec >= 5400` con
  `tickMs *= 1.5`. Se aplica **encima** del slowdown +0.5 s/min del
  min 65 (multiplicativo).

Flags persistidos en `st` (ml-card) / `_gm` (gm-modal):
`_stop1Applied`, `_stop2Applied`. Se setean al rearmar para evitar
re-arms en cada tick. La detección vive en `_mlResolveClock` cuando
recibe `timerSec`, `htDone`, `etDone`:
- `inStop1 = !htDone && timerSec >= 2700 && timerSec < 5400`
- `inStop2 = htDone && timerSec >= 5400 && timerSec < 7200`

HvH y IAIA NO se ralentizan en el descuento — solo HvIA.

**IA vs IA mantiene descuento event-driven** (petición usuario
2026-05-19): cada gol/tarjeta/lesión/etc. en una parte añade
+1 game-min al tope de esa parte. Los partidos IA-vs-IA no tienen
humano que pulse DESCANSO/FINALIZAR, así que el descuento "natural"
por eventos sigue siendo útil para que partidos con muchos goles
duren un poco más.

PRÓRROGA mantiene el modelo legacy event-driven (no tocado en
2026-05-19). HvH y HvIA en gm-modal: cuando `timerSec ≥ gmHalfMax`
con humano, el reloj se CONGELA en `gmHalfMax` (sin auto-halftime)
— el cron sólo avanza tras pulsar DESCANSO. Misma regla en
ml-cards. IA vs IA mantiene auto-descanso / auto-finalize.

Histórico:
- 2026-05-09: introducido descuento dinámico event-driven (+1
  game-min por evento, sin tope).
- 2026-05-19: usuario pide caps fijos +4 / +9 porque (a) partidos
  con muchos eventos producían descuentos absurdos (90+12, 90+15) y
  (b) partidos sin eventos no tenían descuento alguno. Ahora la
  ventana es predecible y siempre la misma.

### Fuente única

La velocidad del reloj (`tickMs`) SIEMPRE debe salir de
`window._mlResolveClock({ isHvH, etDone, home, away })` o su alias
`window._mlTickMs(st)`. El label visible SIEMPRE debe salir de
`window._mlRealDurationLabel({ isHvH, humanInvolved })`.

**PROHIBIDO**:
- Hardcodear `"15 min 45 s"`, `"9 min 45 s"`, `"10 min"`, `"8 min"` o
  cualquier duración.
- Cachear `tickMs` en variables de módulo al cargar (hay que leerlo en
  cada arranque del reloj porque el admin puede cambiar el override).
- Duplicar tablas `_MATCH_RULE` / `_MATCH_TICKS`.
- Añadir "campo mode" u otros atajos visuales que extiendan la duración
  real de IAIA por encima de 90 s.
- Reintroducir botones ⏪/⏩ de retrasar/adelantar tiempo en partidos
  HvH/HvIA. El usuario los retiró (2026-04-26) porque ocupaban
  demasiado espacio en el header del cronómetro y desplazaban los
  nombres de los equipos. Solo botón ▶ visible.

### Override admin (`_ppDurationMin`)

- Solo aplica a partidos con humano (HvH / HvIA). No toca IAIA.
- Se aplica reescalando `tickMs = realMs / totalTicks`, manteniendo el
  mismo número de ticks totales (no rompe la progresión de eventos).
- El helper `_mlResolveClock` ya lo consume. Cualquier ruta nueva debe
  usar el helper, no leer `_MATCH_TICKS` directamente.
