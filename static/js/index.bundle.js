/* script block 1 */

// ══ MVP OBLIGATORIO — funciones globales ══════════════════════
window._mvpForceCallback = null;

window.showMvpForce = function(mid, teamA, teamB, sqA, sqB, scoreA, scoreB, onConfirm) {
  window._mvpForceCallback = onConfirm;

  var scoreEl = document.getElementById('mvp-ov-score-' + mid);
  if (scoreEl) scoreEl.textContent = scoreA + ' - ' + scoreB;

  function renderList(listId, sq, team) {
    var el = document.getElementById(listId);
    if (!el) return;
    var html = '';
    sq.forEach(function(p) {
      if (p.h) { html += '<div class="mvp-pl-sec">' + p.h + '</div>'; return; }
      var num = String(p[0]);
      var name = String(p[1]);
      html += '<button class="mvp-pl-btn" data-mid="' + mid + '" data-team="' + team
            + '" data-num="' + num + '" data-name="' + name.replace(/"/g, '&quot;')
            + '" onclick="window.confirmMvpForce(this)">'
            + '<span class="mvp-pl-num">' + num + '</span>'
            + '<span class="mvp-pl-name">' + name + '</span>'
            + '</button>';
    });
    el.innerHTML = html;
  }

  renderList('mvp-list-a-' + mid, sqA, 'a');
  renderList('mvp-list-b-' + mid, sqB, 'b');

  var ov = document.getElementById('mvp-ov-' + mid);
  if (ov) ov.classList.add('show');
};

window.confirmMvpForce = function(btn) {
  var mid  = btn.getAttribute('data-mid');
  var team = btn.getAttribute('data-team');
  var num  = btn.getAttribute('data-num');
  var name = btn.getAttribute('data-name');
  var ov = document.getElementById('mvp-ov-' + mid);
  if (ov) ov.classList.remove('show');
  if (window._mvpForceCallback) {
    window._mvpForceCallback(team, num, name);
    window._mvpForceCallback = null;
  }
};
// ══════════════════════════════════════════════════════════════


// ══ PORTERÍA IMBATIDA OBLIGATORIA ═════════════════════════════
// Helper para el flujo humano (HvIA / HvH): si un equipo ha encajado
// 0 goles y aún no hay evento 'imbat' en el acta, se obliga al usuario
// a elegir al portero. Los equipos IA se resuelven auto con el GK de
// mayor poder vía window.sqFromRegistryFull.
window._imbatForceCallback = null;

window._getTopGk = function(teamName) {
  if (typeof window.sqFromRegistryFull === 'function') {
    var full = window.sqFromRegistryFull(teamName) || [];
    var gks = full.filter(function(p){ return p[2] === 'P'; })
                  .sort(function(a,b){ return (b[3]||0) - (a[3]||0); });
    if (gks.length) return { num: String(gks[0][0]||''), name: String(gks[0][1]||'') };
  }
  return { num: '', name: '' };
};

window.showImbatForce = function(teamName, onConfirm) {
  var prev = document.getElementById('imbat-force-ov');
  if (prev) prev.remove();
  var gks = [];
  if (typeof window.sqFromRegistryFull === 'function') {
    var full = window.sqFromRegistryFull(teamName) || [];
    gks = full.filter(function(p){ return p[2] === 'P'; })
              .sort(function(a,b){ return (b[3]||0) - (a[3]||0); });
  }
  if (!gks.length) {
    // Sin porteros en registry — fallback silencioso con GK por defecto
    if (onConfirm) onConfirm('1', 'Portero');
    return;
  }
  var ov = document.createElement('div');
  ov.id = 'imbat-force-ov';
  ov.className = 'mvp-force-overlay show';
  var btns = gks.map(function(g){
    var num = String(g[0]||'');
    var name = String(g[1]||'');
    return '<button class="mvp-pl-btn" data-num="'+num+'" data-name="'+name.replace(/"/g,'&quot;')
         + '" onclick="window.confirmImbatForce(this)">'
         + '<span class="mvp-pl-num">'+num+'</span>'
         + '<span class="mvp-pl-name">'+name+'</span>'
         + '</button>';
  }).join('');
  /* Botón CANCELAR: sin él el usuario queda atrapado en el overlay (el
     bug "FINALIZAR se bloquea y no funciona"). Al cancelar abortamos la
     cadena de _ensureImbatEvents → no se llama onDone → el partido
     vuelve al estado abierto. */
  ov.innerHTML = '<div class="mvp-force-header">'
    + '<div class="mvp-force-star">🧤</div>'
    + '<div class="mvp-force-title">PORTERÍA IMBATIDA</div>'
    + '<div class="mvp-force-sub">' + teamName + ' no ha encajado goles</div>'
    + '</div>'
    + '<div class="mvp-force-warn">⚠️ Elige el portero que ha mantenido la portería a cero.</div>'
    + '<div class="mvp-force-teams"><div><div class="mvp-pl-list">' + btns + '</div></div></div>'
    + '<button class="ml-pl-ov-close" style="margin-top:20px;" onclick="window.cancelImbatForce()">✕ Cancelar (no finalizar)</button>';
  document.body.appendChild(ov);
  window._imbatForceCallback = onConfirm;
};

window.confirmImbatForce = function(btn) {
  var num = btn.getAttribute('data-num');
  var name = btn.getAttribute('data-name');
  var ov = document.getElementById('imbat-force-ov');
  if (ov) ov.remove();
  if (window._imbatForceCallback) {
    var cb = window._imbatForceCallback;
    window._imbatForceCallback = null;
    cb(num, name);
  }
};

/* Cancelar el overlay: cierra la tarjeta y llama al callback con
   `null` para que _ensureImbatEvents detecte la cancelación y aborte
   la cadena de finalización. */
window.cancelImbatForce = function() {
  var ov = document.getElementById('imbat-force-ov');
  if (ov) ov.remove();
  if (window._imbatForceCallback) {
    var cb = window._imbatForceCallback;
    window._imbatForceCallback = null;
    cb(null, null);
  }
};

// Procesa secuencialmente las dos posibles porterías imbatidas antes
// de llamar a onDone(). pushEv(evObj) es el callback que añade el
// evento al acta del partido y refresca el render.
window._ensureImbatEvents = function(opts, onDone){
  // opts: { events, home, away, scoreA, scoreB, pushEv }
  var evts = opts.events || [];
  var hasA = evts.some(function(e){ return e && e.type==='imbat' && e.team==='a'; });
  var hasB = evts.some(function(e){ return e && e.type==='imbat' && e.team==='b'; });
  var esH = (typeof window.esHumano === 'function') ? window.esHumano : function(){ return false; };

  function _step(side){
    var teamName = side==='a' ? opts.home : opts.away;
    var concededZero = side==='a' ? (opts.scoreB === 0) : (opts.scoreA === 0);
    var already = side==='a' ? hasA : hasB;
    if (!concededZero || already) return Promise.resolve();
    if (esH(teamName)) {
      return new Promise(function(resolve, reject){
        window.showImbatForce(teamName, function(num, name){
          /* num === null → el usuario pulsó CANCELAR en el overlay.
             Rechazamos la promesa para que la cadena salte a .catch y
             abortamos la finalización. Sin esto el overlay no tenía
             escape: el usuario veía el modal de "Portería imbatida" y
             no podía cerrar; el partido parecía bloqueado. */
          if (num === null) return reject(new Error('imbat_cancelled'));
          opts.pushEv({ type:'imbat', ico:'🧤', min:90, team:side, num:num, player:name, name:name });
          resolve();
        });
      });
    } else {
      var gk = window._getTopGk(teamName);
      if (gk.name) opts.pushEv({ type:'imbat', ico:'🧤', min:90, team:side, num:gk.num, player:gk.name, name:gk.name });
      return Promise.resolve();
    }
  }
  _step('a').then(function(){ return _step('b'); }).then(function(){
    if (typeof onDone === 'function') onDone();
  }).catch(function(err){
    /* Cancelación del usuario: cerramos silenciosamente. El partido
       queda como estaba (abierto). No repintamos ni llamamos a onDone. */
    if (err && err.message === 'imbat_cancelled') return;
    /* Cualquier otro error — lo logueamos pero tampoco bloqueamos. */
    try { console.warn('_ensureImbatEvents fallo:', err); } catch(_){}
  });
};
// ══════════════════════════════════════════════════════════════


/* script block 2 */
(function(){
var _sc={a:0,b:0};var _rojas={a:0,b:0};var _events=[];var _timerSec=0;var _timerInterval=null;var _timerRunning=false;
var _htDone=false;var _etDone=false;var _et1Done=false;var _matchFinished=false;var _pendingEvt=null;var _stDone=false;var _inDescanso=false;
var _etPhase=false;
// ═══ REGISTRO GLOBAL DE PLANTILLAS ═══
window.TEAM_RATINGS={
  'Real Madrid':85,
  'FC Barcelona':85,
  'Atlético Madrid':83,
  'Real Sociedad':79,
  'Real Betis':79,
  'Sevilla FC':75,'Sevilla':75,
  'Villarreal CF':80,'Villarreal':80,
  'Athletic Club':79,
  'Girona FC':77,
  'Osasuna':77,
  'Rayo Vallecano':77,
  'Valencia CF':76,
  'Mallorca':76,
  'Getafe CF':75,
  'Celta de Vigo':76,
  'Espanyol':76,
  'Bayern Munich':85,
  'Arsenal':85,
  'Deportivo Alavés':74,
  'Elche CF':74,
  'Levante UD':73,
  'Real Oviedo':73,
  // ── LIGA HYPERMOTION (2ª) ───────────────────────────────
  'Racing Santander':74,
  'Deportivo Coruña':72,
  'Almería':72,
  'Málaga':72,
  'Castellón':71,
  'Las Palmas':71,
  'Burgos':70,
  'Sporting Gijón':70,
  'Ceuta':69,
  'Eibar':69,
  'Córdoba':68,
  'Real Sociedad B U21':68,
  'Andorra':68,
  'Cádiz':67,
  'Granada':67,
  'Albacete':67,
  'Valladolid':67,
  'Leganés':66,
  'Huesca':66,
  'Zaragoza':65,
  'Mirandés':64,
  // ── PRIMERA FEDERACIÓN – GRUPO 1 ────────────────────────
  'Real Madrid Castilla':67,
  'RM Castilla':67,
  'Ponferradina':66,
  'Cultural Leonesa':66,
  'CD Lugo':65,
  'Celta Fortuna':65,
  'Racing Ferrol':65,
  'Gimnàstic Tarragona':64,
  'Osasuna Promesas':63,
  'Bilbao Ath.':62,
  'Unionistas CF':61,
  'AD Mérida':60,
  'Mérida AD':60,
  'Barakaldo':59,
  'Arenteiro':58,
  'Zamora CF':57,
  'Ourense CF':56,
  'CF Talavera':55,
  'CD Guadalajara':54,
  'CP Cacereño':53,
  'Arenas de Getxo':51,
  'Real Avilés Industrial':50,
  // ── PRIMERA FEDERACIÓN – GRUPO 2 ────────────────────────
  'UD Ibiza':67,
  'Real Murcia':66,
  'Eldense':66,
  'Hércules CF':65,
  'Hércules':65,
  'AD Alcorcón':65,
  'Alcorcón':65,
  'FC Cartagena':64,
  'Villarreal B':64,
  'Marbella FC':63,
  'CE Sabadell':62,
  'Betis Deportivo':62,
  'Antequera CF':61,
  'Sevilla At.':60,
  'Sevilla Atlético':60,
  'Algeciras CF':59,
  'Atlético Madrileño':58,
  'At. Sanluqueño':57,
  'Atlético Sanluqueño':57,
  'CE Europa':56,
  'SD Tarazona':55,
  'Tarazona':55,
  'CD Teruel':54,
  'Juventud Torremolinos':52,
  'Estepona':50,
};

/* Nombres duplicados que NO deben aparecer en el lupa de amistosos.
   Se mantienen en TEAM_RATINGS porque otras partes del código (ligas,
   squads, plantillas) los usan como clave canónica, pero la búsqueda del
   lupa los filtra para evitar mostrar dos entradas del mismo equipo.
   De cada pareja dejamos el nombre más fácil de escribir en la lupa
   (o el que lleva escudo activado). */
window.AMS_LUPA_HIDDEN = {
  'Sevilla FC': true,           // usa 'Sevilla'
  'Villarreal CF': true,        // usa 'Villarreal'
  'Real Madrid Castilla': true, // usa 'RM Castilla'
  'Mérida AD': true,            // usa 'AD Mérida'
  'Hércules CF': true,          // usa 'Hércules'
  'AD Alcorcón': true,          // usa 'Alcorcón'
  'Sevilla Atlético': true,     // usa 'Sevilla At.'
  'Atlético Sanluqueño': true,  // usa 'At. Sanluqueño'
  'SD Tarazona': true           // usa 'Tarazona'
};
// ═══ ESTADIOS POR EQUIPO (eFootball 2026) ═══
window.TEAM_STADIUMS = {
  // --- EQUIPOS HUMANOS ---
  'Real Madrid':            'EFOOTBALL STADIUM',
  'FC Barcelona':           'CAMP NOU',
  'Bayern Munich':          'NEW BALANCE ARENA',
  'Arsenal':                'EMIRATES STADIUM',
  'Sporting CP':            'STADIO ORIONE',
  // --- LA LIGA ---
  'Atlético Madrid':        'STADIO ORIONE',
  'Atletico Madrid':        'STADIO ORIONE',
  'Real Sociedad':          'SAITAMA STADIUM 2002',
  'Real Betis':             'MORUMBIS',
  'Betis':                  'MORUMBIS',
  'Sevilla FC':             'ROSE PARK STADIUM',
  'Sevilla':                'ROSE PARK STADIUM',
  'Rayo Vallecano':         'SPORTS PARK',
  'Villarreal CF':          'ESTADIO DEL NUEVO TRIUNFO',
  'Villarreal':             'ESTADIO DEL NUEVO TRIUNFO',
  'Elche CF':               'ESTADIO DEL MARTINGAL',
  'Elche':                  'ESTADIO DEL MARTINGAL',
  'Mallorca':               'ESTADIO AKRON',
  'Valencia CF':            'SAN SIRO',
  'Valencia':               'SAN SIRO',
  'Girona FC':              'ESTADIO URBANO CALDEIRA',
  'Girona':                 'ESTADIO URBANO CALDEIRA',
  'Espanyol':               'ESTADIO DEL NUEVO TRIUNFO',
  'Getafe CF':              'COLISEO DE LOS DEPORTES',
  'Getafe':                 'COLISEO DE LOS DEPORTES',
  'Córdoba CF':             'ESTADIO DEL MARTINGAL',
  'Córdoba':                'ESTADIO DEL MARTINGAL',
  'Celta de Vigo':          'ESTADIO OLÍMPICO',
  'Celta Vigo':             'ESTADIO OLÍMPICO',
  'Celta':                  'ESTADIO OLÍMPICO',
  'Athletic Club':          'SIGNAL IDUNA PARK',
  'Deportivo Alavés':       'BURG STADION',
  'Osasuna':                'BURG STADION',
  // --- SEGUNDA DIVISIÓN ---
  'Albacete Balompié':      'ESTADIO BANORTE',
  'Real Racing Club':       'BURG STADION',
  'Almería':                'ESTADIO AKRON',
  'Deportivo La Coruña':    'STADIO ORIONE',
  'Málaga CF':              'SAITAMA STADIUM 2002',
  'Málaga':                 'SAITAMA STADIUM 2002',
  'Burgos Club de Fútbol':  'SPORTS PARK',
  'Eibar':                  'ESTADIO URBANO CALDEIRA',
  'Huesca':                 'SPORTS PARK',
  'Las Palmas':             'ESTADIO OLÍMPICO UNIVERSITARIO',
  'Leganés':                'COLISEO DE LOS DEPORTES',
  'Levante UD':             'ESTADIO DEL NUEVO TRIUNFO',
  'Levante':                'ESTADIO DEL NUEVO TRIUNFO',
  'Real Oviedo':            'BURG STADION',
  'Sporting Gijón':         'ROSE PARK STADIUM',
  'Real Valladolid':        'ESTADIO DEL MARTINGAL',
  'AD Ceuta':               'ESTADIO BANORTE',
  'Real Sociedad B U21':    'SPORTS PARK',
  'FC Andorra':             'SPORTS PARK',
  'Cádiz CF':               'ESTADIO DEL MARTINGAL',
  'Cádiz':                  'ESTADIO DEL MARTINGAL',
  'Granada':                'ROSE PARK STADIUM',
  'Cultural Leonesa':       'ESTADIO DEL MARTINGAL',
  'Mirandés':               'ESTADIO URBANO CALDEIRA',
  'Real Zaragoza':          'OLD TRAFFORD',
  'CD Castellón':           'ESTADIO DEL MARTINGAL',
  // --- PRIMERA RFEF ---
  'Real Madrid Castilla':   'EFOOTBALL STADIUM',
  'RM Castilla':            'EFOOTBALL STADIUM',
  'Ponferradina':           'BURG STADION',
  'CD Lugo':                'BURG STADION',
  'Celta Fortuna':          'SPORTS PARK',
  'Racing Ferrol':          'ESTADIO DEL NUEVO TRIUNFO',
  'Gimnàstic Tarragona':    'ROSE PARK STADIUM',
  'Osasuna Promesas':       'SPORTS PARK',
  'Bilbao Ath.':            'SPORTS PARK',
  'Bilbao Athletic':        'SPORTS PARK',
  'Unionistas CF':          'SPORTS PARK',
  'AD Mérida':              'ESTADIO OLÍMPICO',
  'Mérida AD':              'ESTADIO OLÍMPICO',
  'Barakaldo':              'BURG STADION',
  'Barakaldo CF':           'BURG STADION',
  'Arenteiro':              'ESTADIO URBANO CALDEIRA',
  'CD Arenteiro':           'ESTADIO URBANO CALDEIRA',
  'Zamora CF':              'ESTADIO BANORTE',
  'Ourense CF':             'ESTADIO BANORTE',
  'CF Talavera':            'ESTADIO BANORTE',
  'CD Guadalajara':         'ESTADIO BANORTE',
  'Guadalajara':            'ESTADIO BANORTE',
  'CP Cacereño':            'ESTADIO DEL MARTINGAL',
  'Arenas de Getxo':        'SPORTS PARK',
  'Real Avilés Industrial': 'ESTADIO OLÍMPICO UNIVERSITARIO',
  // --- PRIMERA RFEF GRUPO 2 ---
  'UD Ibiza':               'ESTADIO AKRON',
  'Real Murcia':            'STADIO ORIONE',
  'Eldense':                'ESTADIO DEL NUEVO TRIUNFO',
  'Hércules CF':            'MORUMBIS',
  'Hércules':               'MORUMBIS',
  'AD Alcorcón':            'BURG STADION',
  'Alcorcón':               'BURG STADION',
  'FC Cartagena':           'ESTADIO DEL MARTINGAL',
  'Villarreal B':           'ESTADIO DEL NUEVO TRIUNFO',
  'Marbella FC':            'ESTADIO AKRON',
  'CE Sabadell':            'ESTADIO DEL MARTINGAL',
  'Betis Deportivo':        'ESTADIO DEL MARTINGAL',
  'Antequera CF':           'ESTADIO BANORTE',
  'Sevilla At.':            'ESTADIO DEL MARTINGAL',
  'Sevilla Atlético':       'ESTADIO DEL MARTINGAL',
  'Algeciras CF':           'STADIO ORIONE',
  'Atlético Madrileño':     'SPORTS PARK',
  'At. Sanluqueño':         'ESTADIO URBANO CALDEIRA',
  'Atlético Sanluqueño':    'ESTADIO URBANO CALDEIRA',
  'CE Europa':              'ESTADIO URBANO CALDEIRA',
  'SD Tarazona':            'SPORTS PARK',
  'Tarazona':               'SPORTS PARK',
  'CD Teruel':              'SPORTS PARK',
  'Juventud Torremolinos':  'ESTADIO BANORTE',
  'Estepona':               'ESTADIO BANORTE',
  // --- EUROPEOS / INTERNACIONALES ---
  'PSG':                    'PARC DES PRINCES',
  'Paris Saint-Germain':    'PARC DES PRINCES',
};

window.getTeamStadium = function(name) {
  if (!name || !window.TEAM_STADIUMS) return '';
  return window.TEAM_STADIUMS[name] || window.TEAM_STADIUMS[name.trim()] || '';
};

window.SQUAD_REGISTRY={};
window.sqFromRegistry = function(teamName, opts) {
  // opts: { excluded: ['NombreJugador',...] }  ← lesionados/sancionados
  // Resolver alias (ej: 'Sevilla' → 'Sevilla FC', 'Villarreal' → 'Villarreal CF')
  var aliases = window.TEAM_ALIASES || {};
  var trimmed = (teamName || '').trim();
  var resolved = aliases[trimmed.toLowerCase()] || trimmed;
  var reg = window.SQUAD_REGISTRY[resolved] || window.SQUAD_REGISTRY[trimmed] || window.SQUAD_REGISTRY[teamName];
  if (!reg) {
    /* Lazy fallback 1: si SQUAD_REGISTRY aún no está poblado (p.ej. el
       usuario abre el partido antes del setTimeout de
       applyEngineOverrides) tiramos del editor ahora mismo. */
    if (typeof window.applyEngineOverrides === 'function') {
      try { window.applyEngineOverrides(); } catch(_){}
      reg = window.SQUAD_REGISTRY[resolved] || window.SQUAD_REGISTRY[trimmed] || window.SQUAD_REGISTRY[teamName];
    }
  }
  if (!reg) {
    /* Lazy fallback 2: escanear TODAS las tiendas `ligaExt_*`. Antes
       sólo leíamos `ligaExt_liga-ea-sports`, con lo que un equipo
       guardado en Hypermotion / Primera Fed / cualquiera de las 51
       ligas externas (Premier, Bundesliga, etc.) caía al placeholder
       "Jugador A/B" en amistosos, IA vs IA, Humano vs IA y Humano vs
       Humano. Ahora iteramos todas las claves `ligaExt_*` y, para la
       primera con un equipo cuyo nombre coincida con `teamName` o
       `resolved`, montamos el sq en línea — sin depender de que
       applyEngineOverrides haya corrido antes. */
    try {
      function _normAmSq(s){ return String(s||'').trim().toLowerCase(); }
      /* Normalización agresiva: minúsculas, sin diacríticos, sin
         sufijos comunes (FC, F.C., CF, AC, etc.), sin puntuación.
         Para que "Liverpool" matchee "Liverpool FC", "Atlético"
         matchee "Atletico", etc. Mejora encontrar plantillas de
         equipos europeos en `ligaExt_*`. 2026-05-11. */
      function _normAggro(s){
        var x = String(s||'').trim().toLowerCase();
        try { x = x.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch(_){}
        x = x.replace(/\b(fc|f\.c\.|cf|c\.f\.|ac|a\.c\.|sc|s\.c\.|club|the)\b/gi, '');
        x = x.replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
        return x;
      }
      var target = _normAmSq(teamName);
      var targetResolved = _normAmSq(resolved);
      var targetAggro = _normAggro(teamName);
      var targetAggroR = _normAggro(resolved);
      var match = null;
      for (var li = 0; li < localStorage.length && !match; li++) {
        var lk = localStorage.key(li);
        if (!lk || lk.indexOf('ligaExt_') !== 0) continue;
        if (lk.indexOf('_backup') !== -1) continue;
        var raw = localStorage.getItem(lk);
        if (!raw) continue;
        var data; try { data = JSON.parse(raw); } catch(_e){ continue; }
        var teams = (data && Array.isArray(data.teams)) ? data.teams : [];
        for (var ti = 0; ti < teams.length; ti++) {
          var tn = _normAmSq(teams[ti] && teams[ti].name);
          if (!tn) continue;
          if (tn === target || tn === targetResolved) { match = teams[ti]; break; }
        }
        /* Segunda pasada tolerante (substring) sólo si no hubo match
           exacto, para evitar que "Real Madrid" pille "Real Madrid
           Castilla" por contener la cadena. */
        if (!match) {
          for (var ti2 = 0; ti2 < teams.length; ti2++) {
            var tn2 = _normAmSq(teams[ti2] && teams[ti2].name);
            if (!tn2) continue;
            if (tn2.indexOf(target) !== -1 || target.indexOf(tn2) !== -1 ||
                tn2.indexOf(targetResolved) !== -1 || targetResolved.indexOf(tn2) !== -1) {
              match = teams[ti2]; break;
            }
          }
        }
        /* Tercera pasada: match agresivo sin sufijos/diacríticos.
           Cubre "Liverpool" ↔ "Liverpool FC", "Atletico" ↔ "Atlético",
           "Bayern" ↔ "Bayern München", etc. */
        if (!match) {
          for (var ti3 = 0; ti3 < teams.length; ti3++) {
            var tn3a = _normAggro(teams[ti3] && teams[ti3].name);
            if (!tn3a) continue;
            if (tn3a === targetAggro || tn3a === targetAggroR ||
                tn3a.indexOf(targetAggro) !== -1 || targetAggro.indexOf(tn3a) !== -1 ||
                tn3a.indexOf(targetAggroR) !== -1 || targetAggroR.indexOf(tn3a) !== -1) {
              match = teams[ti3]; break;
            }
          }
        }
      }
      /* Fallback adicional: plantilla de Selecciones (`selecciones_squad_v1`).
         Los torneos de Selecciones (spv-/sfn-, formato mundial-48) guardan
         sus equipos ahí, NO en `ligaExt_`. Sin este lookup la sim auto
         IA-vs-IA caía a placeholders "Jugador A/B" en el acta y stats.
         Solo se consulta si el scan de `ligaExt_` no devolvió match — así
         no afecta a clubs con nombres coincidentes. El team `players[]`
         viene en el mismo formato {name,num,pos,power,captain,penalty,
         freeKick,elite,natGoal,natGoalPro}, así que el parser de abajo
         lo digiere igual. 2026-05-24. */
      if (!match) {
        try {
          var _selRaw = localStorage.getItem('selecciones_squad_v1');
          if (_selRaw) {
            var _selData = JSON.parse(_selRaw);
            var _selTeams = (_selData && Array.isArray(_selData.teams)) ? _selData.teams : [];
            for (var si = 0; si < _selTeams.length && !match; si++) {
              var _sn = _normAmSq(_selTeams[si] && _selTeams[si].name);
              if (!_sn) continue;
              if (_sn === target || _sn === targetResolved) match = _selTeams[si];
            }
            if (!match) {
              for (var si2 = 0; si2 < _selTeams.length && !match; si2++) {
                var _sn2 = _normAggro(_selTeams[si2] && _selTeams[si2].name);
                if (!_sn2) continue;
                if (_sn2 === targetAggro || _sn2 === targetAggroR ||
                    _sn2.indexOf(targetAggro) !== -1 || targetAggro.indexOf(_sn2) !== -1 ||
                    _sn2.indexOf(targetAggroR) !== -1 || targetAggroR.indexOf(_sn2) !== -1) {
                  match = _selTeams[si2];
                }
              }
            }
          }
        } catch(_){}
      }
      if (match && Array.isArray(match.players) && match.players.length) {
        var POS_HEADER_DIRECT = {P:'🧤 PORTEROS', D:'🛡 DEFENSAS', M:'⚙️ MEDIOS', F:'⚡ DELANTEROS'};
        var POS_MAP_DIRECT = {POR:'P', DEF:'D', MED:'M', DEL:'F'};
        var POS_ORDER_DIRECT = ['P','D','M','F'];
        var DEFAULT_NUMS_SQ = {
          P: [1, 13, 25, 12, 31],
          D: [2, 3, 4, 5, 15, 16, 22, 24, 23, 18, 26],
          M: [6, 8, 10, 14, 17, 19, 20, 21, 27, 28],
          F: [7, 9, 11, 29, 30, 32, 33]
        };
        var groupsD = {P:[], D:[], M:[], F:[]};
        match.players.forEach(function(p){
          if (!p || !p.name) return;
          var ps = POS_MAP_DIRECT[p.pos] || 'M';
          groupsD[ps].push(p);
        });
        /* Auto-numerar dorsales — sin esto el picker mostraba sin
           número. Reportado 2026-05-07. */
        var usedNumsSQ = {};
        Object.keys(groupsD).forEach(function(ps){
          groupsD[ps].forEach(function(p){
            var n = Number(p.num);
            if (n > 0 && !usedNumsSQ[n]) usedNumsSQ[n] = true;
          });
        });
        function _nextFreeNumSQ(ps){
          var pool = DEFAULT_NUMS_SQ[ps] || [];
          for (var k = 0; k < pool.length; k++) {
            if (!usedNumsSQ[pool[k]]) { usedNumsSQ[pool[k]] = true; return pool[k]; }
          }
          for (var n = 1; n <= 99; n++) {
            if (!usedNumsSQ[n]) { usedNumsSQ[n] = true; return n; }
          }
          return 99;
        }
        var built = [];
        POS_ORDER_DIRECT.forEach(function(ps){
          var pool = groupsD[ps];
          if (!pool.length) return;
          pool.sort(function(a,b){ return (Number(b.power)||0) - (Number(a.power)||0); });
          built.push({h: POS_HEADER_DIRECT[ps]});
          pool.forEach(function(p){
            var pw = Math.max(1, Math.min(99, Number(p.power)||70));
            var num = (Number(p.num) > 0) ? Number(p.num) : _nextFreeNumSQ(ps);
            var entry = [String(num), String(p.name || '?'), pw];
            if (p.elite)      entry.elite      = true;
            if (p.natGoal)    entry.natGoal    = true;
            if (p.natGoalPro) entry.natGoalPro = true;
            if (p.captain)    entry.captain    = true;
            if (p.freeKick)   entry.freeKick   = true;
            if (p.penalty)    entry.penalty    = true;
            built.push(entry);
          });
        });
        if (built.length) {
          /* Cache en SQUAD_REGISTRY bajo el nombre que nos pidieron +
             el canónico (alias) para no repetir este parseo en la
             misma sesión. Además, rellenamos el sidecar de flags por
             si la sim necesita C/F/P/⭐/⚾ más abajo. */
          window.SQUAD_REGISTRY[teamName] = built;
          if (resolved !== teamName) window.SQUAD_REGISTRY[resolved] = built;
          match.players.forEach(function(p){
            if (!p || !p.name) return;
            if (p.captain || p.freeKick || p.penalty || p.elite || p.natGoal || p.natGoalPro){
              var fmap = window._LIGA_EA_PLAYER_FLAGS = window._LIGA_EA_PLAYER_FLAGS || {};
              var fkey = String(match.name) + '::' + String(p.name);
              fmap[fkey] = {
                captain:    !!p.captain,
                freeKick:   !!p.freeKick,
                penalty:    !!p.penalty,
                elite:      !!p.elite,
                natGoal:    !!p.natGoal,
                natGoalPro: !!p.natGoalPro
              };
            }
          });
          reg = built;
        }
      }
    } catch(_){}
    if (!reg) {
      console.warn('sqFromRegistry: equipo no encontrado:', teamName, '(resolved:', resolved, ')');
      return [];
    }
  }
  var posMap = {'🧤 PORTEROS':'P','🛡 DEFENSAS':'D','⚙️ MEDIOS':'M','⚡ DELANTEROS':'F',
                '⚙️CENTROCAMPISTAS':'M','⚙️ CENTROCAMPISTAS':'M'};
  var excluded = (opts && opts.excluded) ? opts.excluded.slice() : [];
  /* CLAUDE.md: los jugadores lesionados NO juegan sus partidos pendientes.
     Antes sqFromRegistry solo excluía lo que el caller pasara en
     opts.excluded — pero ningún caller (simularJornadaIA, Copa,
     genMatchEvents, HvIA) lo hacía, así que los lesionados salían en
     los 11 titulares, marcaban goles y ganaban MVPs. Ahora leemos
     automáticamente window.LESION_STORE y añadimos a `excluded` a
     todos los jugadores del equipo con `partidos > 0`. El admin no
     tiene que acordarse de propagar nada — cualquier camino que use
     sqFromRegistry los saltará. */
  try {
    var _lesMap = window.LESION_STORE || {};
    var _teamNorm = String(teamName || '').trim().toLowerCase();
    /* Alias del hub: si el slot del hub está renombrado (p.ej. usuario
       cambió "Bayern Munich" → "Liverpool" en 2026-05-23), las entradas
       legacy de LESION_STORE pueden tener equipo:'Bayern Munich' aunque
       el jugador ya pertenezca al slot renombrado. Resolvemos el nombre
       lógico del hub para tratar ambas variantes como equivalentes y
       que el simulador IA-vs-IA NUNCA elija a un lesionado como
       goleador / MVP por un equipo desincronizado. Bug 2026-05-27:
       Hugo Ekitiké marcó pagando la simulación del Joan Gamper estando
       lesionado 3 partidos. */
    var _hubAliases = null;
    function _hubAliasSet() {
      if (_hubAliases) return _hubAliases;
      _hubAliases = {};
      var lg = '';
      try { lg = typeof window._psHumanLogicName === 'function' ? (window._psHumanLogicName() || '') : ''; } catch(_){ lg = ''; }
      var lgN = String(lg).trim().toLowerCase();
      if (lgN) _hubAliases[lgN] = 1;
      try { if (window._mkHubTeamName) _hubAliases[String(window._mkHubTeamName).trim().toLowerCase()] = 1; } catch(_){}
      /* Solo añadimos 'bayern munich' como alias legacy si el hub ya
         fue RENOMBRADO a otro nombre — sin esto un usuario con hub aún
         en Bayern obtendría falsos positivos al cruzar con otro equipo
         IA inexistente. La heurística es: el hub lógico no es Bayern. */
      if (lgN && lgN !== 'bayern munich' && lgN !== 'bayern múnich') {
        _hubAliases['bayern munich'] = 1;
        _hubAliases['bayern múnich'] = 1;
      }
      return _hubAliases;
    }
    Object.keys(_lesMap).forEach(function(pn){
      var rec = _lesMap[pn];
      if (!rec || !(Number(rec.partidos) > 0)) return;
      /* Match por nombre de equipo normalizado — cubre "Atlético
         Madrid" / "Atletico Madrid" / "Atl Madrid" consistentemente. */
      var eqNorm = String(rec.equipo || '').trim().toLowerCase();
      var match = (!eqNorm || eqNorm === _teamNorm);
      if (!match) {
        var al = _hubAliasSet();
        if (al[eqNorm] && al[_teamNorm]) match = true;
      }
      if (!match) return;
      if (excluded.indexOf(pn) === -1) excluded.push(pn);
    });
  } catch(_){}

  // 1. Parsear plantilla completa con posición y poder
  var full = []; var curPos = 'M';
  for (var i = 0; i < reg.length; i++) {
    var e = reg[i];
    if (e.h) { curPos = posMap[e.h] || 'M'; }
    else {
      var poder = (e.length >= 3) ? (e[2] || 70) : 70;
      var nombre = e[1];
      // Saltar lesionados/sancionados
      if (excluded.indexOf(nombre) !== -1) continue;
      /* Propagamos los 6 flags (⭐ elite, ⚾ natGoal, 🏀 natGoalPro,
         C captain, F freeKick, P penalty) como propiedades del array. Los
         scorers y el motor de equipo los consumen sin alterar los índices
         posicionales que usan los demás consumidores del formato.
         Obligatorio (CLAUDE.md). */
      var row = [e[0], nombre, curPos, poder];
      if (e && e.elite)      row.elite      = true;
      if (e && e.natGoal)    row.natGoal    = true;
      if (e && e.natGoalPro) row.natGoalPro = true;
      if (e && e.captain)    row.captain    = true;
      if (e && e.freeKick)   row.freeKick   = true;
      if (e && e.penalty)    row.penalty    = true;
      full.push(row);
    }
  }

  // 2. Separar porteros y de campo, ordenar por poder desc
  var gks      = full.filter(function(p){ return p[2]==='P'; })
                     .sort(function(a,b){ return b[3]-a[3]; });
  var outfield = full.filter(function(p){ return p[2]!=='P'; })
                     .sort(function(a,b){ return b[3]-a[3]; });

  // 3. Convocatoria de 18: 2 porteros + 16 de campo (11 titulares + 7 banquillo, mínimo 1 portero siempre)
  var conv = [];
  // Portero titular + 1 suplente portero (si hay)
  var gk1 = gks[0] || null;
  var gk2 = gks[1] || null;
  if (gk1) conv.push(gk1);
  if (gk2) conv.push(gk2);
  // Top 16 de campo por poder
  var fieldSlots = 18 - conv.length; // 16 si hay 2 porteros
  for (var fi = 0; fi < outfield.length && conv.length < 18; fi++) {
    conv.push(outfield[fi]);
  }
  // Si hay menos de 18 disponibles, usamos los que hay
  // Si hay más de 18, ya está limitado por el bucle

  // 4. Marcar titulares (pos 0-10) y suplentes (pos 11-17)
  //    Los primeros 11 son: portero titular + los 10 de campo de más poder
  //    El resto son banquillo
  for (var ci = 0; ci < conv.length; ci++) {
    var wasElite      = !!conv[ci].elite;
    var wasNatGoal    = !!conv[ci].natGoal;
    var wasNatGoalPro = !!conv[ci].natGoalPro;
    var wasCaptain    = !!conv[ci].captain;
    var wasFreeKick   = !!conv[ci].freeKick;
    var wasPenalty    = !!conv[ci].penalty;
    conv[ci] = [conv[ci][0], conv[ci][1], conv[ci][2], conv[ci][3], ci < 11 ? 'titular' : 'suplente'];
    if (wasElite)      conv[ci].elite      = true;
    if (wasNatGoal)    conv[ci].natGoal    = true;
    if (wasNatGoalPro) conv[ci].natGoalPro = true;
    if (wasCaptain)    conv[ci].captain    = true;
    if (wasFreeKick)   conv[ci].freeKick   = true;
    if (wasPenalty)    conv[ci].penalty    = true;
  }

  return conv;
};

// Versión SIN límite de 18 — para partidos manuales (humano)
window.sqFromRegistryFull = function(teamName) {
  var aliases = window.TEAM_ALIASES || {};
  var trimmed = (teamName || '').trim();
  var resolved = aliases[trimmed.toLowerCase()] || trimmed;
  var reg = window.SQUAD_REGISTRY[resolved] || window.SQUAD_REGISTRY[trimmed] || window.SQUAD_REGISTRY[teamName];
  if (!reg) {
    /* Fallback: disparar applyEngineOverrides + un re-check en
       SQUAD_REGISTRY. sqFromRegistry ya tiene un fallback robusto que
       escanea todas las ligaExt_*, así que llamándola forzamos que
       cachee el sq del equipo bajo SQUAD_REGISTRY[teamName]. Luego
       releemos y seguimos. Así ningún partido (humano manual, event
       picker, MVP override, clean-sheet, etc.) cae al placeholder
       "Jugador A/B". */
    if (typeof window.applyEngineOverrides === 'function') {
      try { window.applyEngineOverrides(); } catch(_){}
    }
    try { if (typeof window.sqFromRegistry === 'function') window.sqFromRegistry(teamName); } catch(_){}
    reg = window.SQUAD_REGISTRY[resolved] || window.SQUAD_REGISTRY[trimmed] || window.SQUAD_REGISTRY[teamName];
  }
  if (!reg) {
    console.warn('sqFromRegistryFull: equipo no encontrado:', teamName, '(resolved:', resolved, ')');
    return [];
  }
  var posMap = {'🧤 PORTEROS':'P','🛡 DEFENSAS':'D','⚙️ MEDIOS':'M','⚡ DELANTEROS':'F',
                '⚙️CENTROCAMPISTAS':'M','⚙️ CENTROCAMPISTAS':'M'};
  var full = []; var curPos = 'M';
  for (var i = 0; i < reg.length; i++) {
    var e = reg[i];
    if (e.h) { curPos = posMap[e.h] || 'M'; }
    else {
      var row = [e[0], e[1], curPos, (e.length>=3 ? e[2] : 70)];
      if (e && e.elite)      row.elite      = true;
      if (e && e.natGoal)    row.natGoal    = true;
      if (e && e.natGoalPro) row.natGoalPro = true;
      if (e && e.captain)    row.captain    = true;
      if (e && e.freeKick)   row.freeKick   = true;
      if (e && e.penalty)    row.penalty    = true;
      full.push(row);
    }
  }
  return full;
};
// ════════════════════════════════════
var TEAM_A_NAME="Real Madrid";var TEAM_B_NAME="FC Barcelona";
var TEAM_A_OPTS='<option value="1|Thibaut Courtois">1. Thibaut Courtois</option><option value="13|Andriy Lunin">13. Andriy Lunin</option><option value="26|Fran González">26. Fran González</option><option value="43|Sergio Mestre">43. Sergio Mestre</option><option value="9|Kylian Mbappé">9. Kylian Mbappé</option><option value="38|César Palacios">38. César Palacios</option><option value="5|Jude Bellingham">5. Jude Bellingham</option><option value="7|Vinicius Júnior">7. Vinicius Júnior</option><option value="8|Federico Valverde">8. Federico Valverde</option><option value="12|Trent Alexander-Arnold">12. Trent Alexander-Arnold</option><option value="2|Daniel Carvajal">2. Daniel Carvajal</option><option value="22|Antonio Rüdiger">22. Antonio Rüdiger</option><option value="3|Éder Militão">3. Éder Militão</option><option value="14|Aurélien Tchouaméni">14. Aurélien Tchouaméni</option><option value="11|Rodrygo">11. Rodrygo</option><option value="24|Dean Huijsen">24. Dean Huijsen</option><option value="6|Eduardo Camavinga">6. Eduardo Camavinga</option><option value="15|Arda Güler">15. Arda Güler</option><option value="28|Jorge Cestero">28. Jorge Cestero</option><option value="4|David Alaba">4. David Alaba</option><option value="23|Ferland Mendy">23. Ferland Mendy</option><option value="21|Brahim Díaz">21. Brahim Díaz</option><option value="18|Álvaro Carreras">18. Álvaro Carreras</option><option value="19|Dani Ceballos">19. Dani Ceballos</option><option value="17|Raúl Asencio">17. Raúl Asencio</option><option value="20|Fran García">20. Fran García</option><option value="30|Franco Mastantuono">30. Franco Mastantuono</option><option value="16|Gonzalo García">16. Gonzalo García</option><option value="37|Manuel Ángel Morán">37. Manuel Ángel Morán</option><option value="48|Lamini Fati">48. Lamini Fati</option><option value="45|Thiago Pitarch">45. Thiago Pitarch</option><option value="27|Diego Aguado">27. Diego Aguado</option>';var TEAM_B_OPTS='<option value="13|Joan García">13. Joan García</option><option value="31|Diego Kochen">31. Diego Kochen</option><option value="25|Wojciech Szczęsny">25. Wojciech Szczęsny</option><option value="8|Pedri">8. Pedri</option><option value="10|Lamine Yamal">10. Lamine Yamal</option><option value="11|Raphinha">11. Raphinha</option><option value="21|Frenkie de Jong">21. Frenkie de Jong</option><option value="9|Robert Lewandowski">9. Robert Lewandowski</option><option value="23|Jules Koundé">23. Jules Koundé</option><option value="2|João Cancelo">2. João Cancelo</option><option value="36|Álvaro Cortés">36. Álvaro Cortés</option><option value="20|Dani Olmo">20. Dani Olmo</option><option value="7|Ferran Torres">7. Ferran Torres</option><option value="3|Alejandro Balde">3. Alejandro Balde</option><option value="24|Eric García">24. Eric García</option><option value="6|Pablo Gavi">6. Pablo Gavi</option><option value="16|Fermín López">16. Fermín López</option><option value="43|Tomás Marqués">43. Tomás Marqués</option><option value="4|Ronald Araújo">4. Ronald Araújo</option><option value="5|Pau Cubarsí">5. Pau Cubarsí</option><option value="14|Marcus Rashford">14. Marcus Rashford</option><option value="15|Andreas Christensen">15. Andreas Christensen</option><option value="17|Marc Casadó">17. Marc Casadó</option><option value="18|Gerard Martín">18. Gerard Martín</option><option value="22|Marc Bernal">22. Marc Bernal</option><option value="28|Roony Bardghji">28. Roony Bardghji</option><option value="42|Xavi Espart">42. Xavi Espart</option>';
var MAX_NORMAL=5400;var MAX_ET=7200;
/* Fuente única de verdad: _mlResolveClock (definido en misc_body_2.html).
   Lee _MATCH_TICKS/_MATCH_RULE + override admin _ppDurationMin. NO cachear
   en variables de módulo (eso era el bug antiguo: al cambiar la duración
   el reloj seguía con el valor anterior). CLAUDE.md: obligatorio.

   BUG HISTÓRICO: antes solo detectábamos `.hvh`. Un partido HvIA
   lleva la clase `.hvia`, no `.hvh`, así que caía al flujo "no-HvH"
   SIN pasar home/away ni humanInvolved → _mlResolveClock asumía
   IAIA (83 ms tick) y el partido HvIA terminaba en 1:30 en vez de
   los 13:30 reales. Fix: detectar también `.hvia` y pasar
   humanInvolved=true cuando corresponde. */
function _j1m1ResolveSpd(){
  var _w = document.getElementById('mlw-j1m1');
  var _isHvH  = !!(_w && _w.classList && _w.classList.contains('hvh'));
  var _isHvIA = !!(_w && _w.classList && _w.classList.contains('hvia'));
  if (typeof window._mlResolveClock === 'function') {
    var info = window._mlResolveClock({
      isHvH: _isHvH,
      humanInvolved: _isHvH || _isHvIA,
      etDone: !!_etPhase
    });
    return info.tickMs;
  }
  /* Fallback defensivo si misc_body_2 no cargó aún. Valores oficiales:
     HvH=16.5 min real → 917 ms, HvIA=13.5 min → 750 ms, ET=5 min → 833 ms,
     IAIA=1.5 min → 83 ms. (label previa HvH=10 min, HvIA=8 min). */
  var t = window._MATCH_TICKS || {};
  if (_etPhase) return t.HvH_ET || 833;
  if (_isHvH)  return t.HvH  || 917;
  if (_isHvIA) return t.HvIA || 750;
  return t.IAIA || 83;
}
window.mlTimerClick_j1m1=function(){if(_matchFinished||_inDescanso)return;if(_timerRunning){clearInterval(_timerInterval);_timerRunning=false;_renderTimer_j1m1();}else{_timerRunning=true;_startInterval_j1m1();}};
/* Reloj de muralla (wall-clock) anti-throttling para el j1m1. Antes
   hacía _timerSec+=5 en cada tick — si setInterval se ralentizaba
   (móvil, background tab, throttling del navegador) el reloj de
   juego iba más lento que la realidad. El usuario reportó que 1
   minuto real ≈ 1 minuto de juego (cuando debía ser 11 seg reales
   por game-min en HvH). Ahora calculamos _timerSec a partir de
   Date.now() desde el arranque, igual que _mlStartIntervalGen. */
function _startInterval_j1m1(){
  var spd=_j1m1ResolveSpd();
  var MAX_ST=5820;
  /* Rebase del reloj de muralla: cada vez que ARRANCAMOS el interval
     (primer kickoff o reanudación tras pausa/descanso), anclamos
     Date.now() al _timerSec actual. Así el tiempo durante la pausa
     no se suma al reloj del partido. */
  window._j1m1_wallStart = Date.now();
  window._j1m1_secAtStart = _timerSec;
  /* _ML_TICK_SEC viene de misc_body_2; fallback a 5. */
  var GS = (window._ML_TICK_SEC || 5);
  var _gameSecPerMs = GS / spd;
  _timerInterval=setInterval(function(){
    /* Avanzar timerSec con el tiempo REAL transcurrido desde el
       arranque (no sumando 5 por tick). Esto compensa ráfagas y
       throttling: si el navegador nos da ticks cada 1000 ms en vez
       de 917, el elapsed real sigue siendo correcto. */
    var elapsedMs = Date.now() - window._j1m1_wallStart;
    _timerSec = window._j1m1_secAtStart + Math.round(elapsedMs * _gameSecPerMs);
    var maxSec=_etDone?MAX_ET:(_stDone?MAX_ST:MAX_NORMAL);
    if(!_htDone&&_timerSec>=2700){_htDone=true;clearInterval(_timerInterval);_timerRunning=false;_inDescanso=true;_addMarker_j1m1("— DESCANSO (45 min) —");_renderTimer_j1m1();setTimeout(function(){if(!_matchFinished){_inDescanso=false;_timerRunning=true;window._j1m1_wallStart=0;_startInterval_j1m1();}},20000);return;}
    if(!_etDone&&!_stDone&&_timerSec>=MAX_NORMAL){_stDone=true;_addMarker_j1m1("— TIEMPO DE DESCUENTO (90') —");}
    if(_etDone&&!_et1Done&&_timerSec>=6300){_et1Done=true;_addMarker_j1m1("— DESCANSO PRÓRROGA (105 min) —");}
    if(_timerSec>=maxSec){_timerSec=maxSec;clearInterval(_timerInterval);_timerRunning=false;if(_etDone){_checkPenalties_j1m1();}}
    _renderTimer_j1m1();
  }, Math.min(spd, 500));
};
function _renderTimer_j1m1(){var btn=document.getElementById('ml-timer-j1m1');if(!btn)return;var totalMin=Math.floor(_timerSec/60);if(_matchFinished){btn.textContent='🏁 FIN';btn.className='ml-timer finished';if(window._setScoreState)window._setScoreState('j1m1','finished');return;}if(_inDescanso){btn.textContent='⏸ HT';btn.className='ml-timer running';if(window._setScoreState)window._setScoreState('j1m1','playing');return;}var isStop=!_etDone&&_timerSec>5400;var dispStr=isStop?('90+'+Math.ceil((_timerSec-5400)/60)+"'"):(totalMin+"'");var maxForLabel=_etDone?MAX_ET:(_stDone?5820:MAX_NORMAL);var label=_timerRunning?'⏸ ':(_timerSec>=maxForLabel?'🔁 ':'▶ ');btn.textContent=label+dispStr;btn.className='ml-timer'+(_timerRunning?' running':'');if(window._setScoreState)window._setScoreState('j1m1',_timerRunning?'playing':'pending');var _bl=document.getElementById('ball-j1m1');if(_bl){if(_timerRunning){_bl.classList.remove('spinning');_bl.classList.add('static');}else{_bl.classList.remove('static');_bl.classList.add('spinning');}}};
function _currentMin_j1m1(){return Math.min(_etDone?120:(_stDone?97:90),Math.floor(_timerSec/60));};
function _addMarker_j1m1(txt){var list=document.getElementById('ml-acta-list-j1m1');var div=document.createElement('div');div.className='ml-ht';div.textContent=txt;list.appendChild(div);_removeEmpty_j1m1();};
window.mlActivateET_j1m1=function(){if(_etDone||_matchFinished)return;_etDone=true;_etPhase=true;if(_timerRunning){clearInterval(_timerInterval);_startInterval_j1m1();}if(_timerSec<MAX_NORMAL)_timerSec=MAX_NORMAL;_addMarker_j1m1('— PRÓRROGA —');var btn=document.getElementById('ml-btn-et-j1m1');if(btn){btn.disabled=true;btn.style.opacity='0.35';}var penBtn=document.getElementById('ml-btn-pen-j1m1');if(penBtn)penBtn.style.display='';_renderTimer_j1m1();};
window.mlShowPenPanel_j1m1=function(){var pp=document.getElementById('ml-pen-panel-j1m1');if(pp)pp.classList.add('show');var penBtn=document.getElementById('ml-btn-pen-j1m1');if(penBtn){penBtn.disabled=true;penBtn.style.opacity='0.35';}var addBtn=document.getElementById('ml-add-btn-j1m1');if(addBtn){addBtn.disabled=true;addBtn.style.opacity='0.35';}};
window.mlEndMatch_j1m1=function(winner){if(_matchFinished)return;
  // ── Portería imbatida obligatoria antes del MVP ──
  var _needsImb=((_sc.b===0&&!_events.some(function(e){return e&&e.type==='imbat'&&e.team==='a';}))
              ||(_sc.a===0&&!_events.some(function(e){return e&&e.type==='imbat'&&e.team==='b';})));
  if(_needsImb&&typeof window._ensureImbatEvents==='function'){
    window._ensureImbatEvents({
      events:_events, home:TEAM_A_NAME, away:TEAM_B_NAME,
      scoreA:_sc.a, scoreB:_sc.b,
      pushEv:function(ev){
        _events.push({min:90,label:'🧤 Portería Imbatida',type:'imbat',team:ev.team,num:ev.num,name:ev.player,ico:'🧤',id:Date.now()+Math.random()});
        _renderActa_j1m1();
      }
    }, function(){ window.mlEndMatch_j1m1(winner); });
    return;
  }
  // ── MVP obligatorio ──
  var hasMvp=_events.some(function(e){return e.type==='mvp';});
  if(!hasMvp){
    var sqA_=_sqA_j1m1;
    var sqB_=_sqB_j1m1;
    window.showMvpForce('j1m1','Real Madrid','FC Barcelona',sqA_,sqB_,_sc.a,_sc.b,function(team,num,name){
      var icons={gol:'⚽',propia:'⚽🚫','pen-gol':'⚽🥅','pen-fallo':'❌🥅','pen-prov':'🤦🥅','pen-parado':'🖐🥅','falta-gol':'⚽🎯',amarilla:'🟨','d-amarilla':'🟨🟥',roja:'🟥',lesion:'🩹',mvp:'⭐'};
      _events.push({min:90,label:'MVP del Partido',type:'mvp',team:team,num:num,name:name,ico:'⭐',id:Date.now()});
      _renderActa_j1m1();
      window.mlEndMatch_j1m1(winner);
    });
    return;
  }
clearInterval(_timerInterval);_timerRunning=false;_matchFinished=true;var penWinner=null;if(winner==='a'||winner==='b'){if(_sc.a===_sc.b)penWinner=winner;}if(!winner){if(_sc.a>_sc.b)winner='a';else if(_sc.b>_sc.a)winner='b';else winner='draw';}var btn=document.getElementById('ml-btn-end-j1m1');if(btn){btn.disabled=true;btn.style.opacity='0.35';}var etBtn=document.getElementById('ml-btn-et-j1m1');if(etBtn){etBtn.disabled=true;etBtn.style.opacity='0.35';}var penBtn=document.getElementById('ml-btn-pen-j1m1');if(penBtn){penBtn.disabled=true;penBtn.style.opacity='0.35';}var _ta_a=_events.filter(function(e){return e.team==='a'&&e.type==='amarilla';}).length;var _tr_a=_events.filter(function(e){return e.team==='a'&&(e.type==='roja'||e.type==='d-amarilla');}).length;var _ta_b=_events.filter(function(e){return e.team==='b'&&e.type==='amarilla';}).length;var _tr_b=_events.filter(function(e){return e.team==='b'&&(e.type==='roja'||e.type==='d-amarilla');}).length;var _mvp_a=_events.filter(function(e){return e.team==='a'&&e.type==='mvp';}).length;var _mvp_b=_events.filter(function(e){return e.team==='b'&&e.type==='mvp';}).length;if(typeof window.registrarResultadoLiga==='function')window.registrarResultadoLiga('j1m1',TEAM_A_NAME,TEAM_B_NAME,_sc.a,_sc.b,_ta_a,_tr_a,_ta_b,_tr_b,_mvp_a,_mvp_b,penWinner); if(typeof window.registrarLigaPlayerStats==='function')window.registrarLigaPlayerStats('j1m1',TEAM_A_NAME,TEAM_B_NAME,_events.map(function(ev){return {type:(ev.type==='amarilla'||ev.type==='roja'||ev.type==='d-amarilla')?'card':ev.type,ico:ev.ico,team:ev.team,player:[ev.num,ev.name]};}),(_events.find(function(e){return e.type==='mvp';})||{}).name||'',(_events.find(function(e){return e.type==='mvp';})||{}).team==='a'?TEAM_A_NAME:((_events.find(function(e){return e.type==='mvp';})||{}).team==='b'?TEAM_B_NAME:'')); _renderTimer_j1m1(); if(typeof window._generarLesionHumano==='function')window._generarLesionHumano(TEAM_A_NAME,TEAM_B_NAME); if(typeof window.procesarSancionesPostPartido==='function')window.procesarSancionesPostPartido(_events,'a',TEAM_A_NAME,'liga');};
function _checkPenalties_j1m1(){if(_sc.a===_sc.b){_addMarker_j1m1("— EMPATE AL 120' —");var pp=document.getElementById("ml-pen-panel-j1m1");if(pp)pp.classList.add("show");var addBtn=document.getElementById("ml-add-btn-j1m1");if(addBtn){addBtn.disabled=true;addBtn.style.opacity="0.35";}}else{mlEndMatch_j1m1();}};window.mlConfirmPen_j1m1=function(){var pa=parseInt(document.getElementById("ml-pen-a-j1m1").value)||0;var pb=parseInt(document.getElementById("ml-pen-b-j1m1").value)||0;if(pa===pb){alert("⚠️ Los penaltis no pueden terminar en empate. Introduce un resultado válido.");return;}var penWinner=pa>pb?"a":"b";var psEl=document.getElementById("pen-score-j1m1");if(psEl){psEl.textContent=pa+"–"+pb;psEl.classList.add("show");}var pp=document.getElementById("ml-pen-panel-j1m1");if(pp)pp.classList.remove("show");mlEndMatch_j1m1(penWinner);};
window.mlShowEvOv_j1m1=function(){document.getElementById("ml-ev-overlay-j1m1").classList.add("show");};window.mlHideEvOv_j1m1=function(){document.getElementById("ml-ev-overlay-j1m1").classList.remove("show");};window.mlEvPick_j1m1=function(label,type){document.getElementById("ml-ev-overlay-j1m1").classList.remove("show");mlShowTP_j1m1(label,type);};window.mlShowTP_j1m1=function(label,type){_pendingEvt={label:label,type:type};document.getElementById("ml-tp-ov-evt-j1m1").textContent=label;document.getElementById("ml-tp-overlay-j1m1").classList.add("show");};window.mlHideTP_j1m1=function(){document.getElementById("ml-tp-overlay-j1m1").classList.remove("show");_pendingEvt=null;};window.mlTPSelect_j1m1=function(team){document.getElementById("ml-tp-overlay-j1m1").classList.remove("show");mlDirectPick_j1m1(_pendingEvt.label,_pendingEvt.type,team);};window.mlTogglePanel_j1m1=function(){mlShowEvOv_j1m1();};
var _sqA_j1m1=[];var _sqB_j1m1=[];(function(){  var regA=window.sqFromRegistryFull('Real Madrid');  var regB=window.sqFromRegistryFull('FC Barcelona');  function toOverlayFmt(sq){    if(!sq||!sq.length)return [];    var out=[];    var posLabels={P:'🧤 PORTEROS',D:'🛡 DEFENSAS',M:'⚙️ MEDIOS',F:'⚡ DELANTEROS'};    var curPos=null;    sq.forEach(function(p){      if(p[2]!==curPos){curPos=p[2];out.push({h:posLabels[curPos]||curPos});}       out.push([p[0],p[1]]);    });    return out;  }  if(regA){var fmt=toOverlayFmt(regA);fmt.forEach(function(p){_sqA_j1m1.push(p);});}  if(regB){var fmt2=toOverlayFmt(regB);fmt2.forEach(function(p){_sqB_j1m1.push(p);});}})();window._sqA_j1m1=_sqA_j1m1;window._sqB_j1m1=_sqB_j1m1;window.mlShowPl_j1m1=function(){var ov=document.getElementById("ml-pl-overlay-j1m1");var e=_pendingEvt;var sq=(e.team==="a")?(_sqA_j1m1):(_sqB_j1m1);var tname=(e.team==="a")?TEAM_A_NAME:TEAM_B_NAME;document.getElementById("ml-pl-ov-evt-j1m1").textContent=e.label;document.getElementById("ml-pl-ov-team-j1m1").textContent=tname;var list=document.getElementById("ml-pl-ov-list-j1m1");list.innerHTML=sq.map(function(p){if(p.h)return '<div class="ml-pl-ov-sec">'+p.h+'</div>';return '<button class="ml-pl-ov-btn" onclick="mlPlConfirm_j1m1(\''+p[0]+'\',\''+p[1].replace(/\'/g,"\\'")+ '\')">'+'<span class="ml-pl-ov-num">'+p[0]+'</span>'+'<span class="ml-pl-ov-name">'+p[1]+'</span>'+'</button>';}).join("");ov.classList.add("show");};window.mlHidePl_j1m1=function(){document.getElementById("ml-pl-overlay-j1m1").classList.remove("show");};window.mlPlConfirm_j1m1=function(num,name){document.getElementById("ml-pl-overlay-j1m1").classList.remove("show");if(!_pendingEvt)return;var e=_pendingEvt;var min=_currentMin_j1m1();if(e.type==="d-amarilla"){var hasYellow=_events.some(function(ev){return ev.type==="amarilla"&&ev.team===e.team&&ev.num===num;});if(!hasYellow){_pendingEvt=null;return;}}var scoringTypes=["gol","propia","pen-gol","falta-gol"];if(scoringTypes.indexOf(e.type)!==-1){var st=(e.type==="propia")?(e.team==="a"?"b":"a"):e.team;_sc[st]++;document.getElementById("sc-j1m1-a").textContent=_sc.a;document.getElementById("sc-j1m1-b").textContent=_sc.b;}if((e.type==="d-amarilla"||e.type==="roja")&&(e.type!=="roja"||_events.filter(function(ev){return(ev.type==="roja"||ev.type==="d-amarilla")&&ev.team===e.team;}).length===0)){_rojas=_rojas||{};_rojas[e.team]=(_rojas[e.team]||0)+1;}var icons={gol:"⚽",propia:"⚽🚫","pen-gol":"⚽🥅","pen-fallo":"❌🥅","pen-prov":"🤦🥅","pen-parado":"🖐🥅","falta-gol":"⚽🎯",amarilla:"🟨","d-amarilla":"🟨🟥",roja:"🟥",lesion:"🩹",mvp:"⭐"};_events.push({min:min,label:e.label,type:e.type,team:e.team,num:num,name:name,ico:icons[e.type]||"•",id:Date.now()});_renderActa_j1m1();  _pendingEvt=null;};window.mlDirectPick_j1m1=function(label,type,team){_pendingEvt={label:label,type:type,team:team};mlShowPl_j1m1();};
window.mlCloseModal_j1m1=function(){document.getElementById('ml-modal-j1m1').classList.remove('show');_pendingEvt=null;};
var _evtToStat={gol:'gol',amarilla:'yel','d-amarilla':'yel',roja:'red',mvp:'mvp','pen-prov':'pen-prov','pen-parado':'pen-parado','pen-gol':'pen-gol','falta-gol':'falta-gol',propia:'propia'};
function _removeEmpty_j1m1(){var emp=document.querySelector('#ml-acta-list-j1m1 .ml-acta-empty');if(emp)emp.remove();};
window.mlConfirmEvt_j1m1=function(){if(!_pendingEvt)return;var sel=document.getElementById('ml-modal-sel-j1m1');var parts=sel.value.split('|');var num=parts[0],name=parts[1];var e=_pendingEvt;var min=_currentMin_j1m1();var scoringTypes=['gol','propia','pen-gol','falta-gol'];if(scoringTypes.indexOf(e.type)!==-1){var st=(e.type==='propia')?(e.team==='a'?'b':'a'):e.team;_sc[st]++;document.getElementById('sc-j1m1-a').textContent=_sc.a;document.getElementById('sc-j1m1-b').textContent=_sc.b;}var icons={gol:'⚽',propia:'⚽🚫','pen-gol':'⚽🥅','pen-fallo':'❌🥅','pen-prov':'🤦🥅','pen-parado':'🖐🥅','falta-gol':'⚽🎯',amarilla:'🟨','d-amarilla':'🟨🟥',roja:'🟥',lesion:'🩹',mvp:'⭐'};_events.push({min:min,label:e.label,type:e.type,team:e.team,num:num,name:name,ico:icons[e.type]||'•',id:Date.now()});_renderActa_j1m1();  mlCloseModal_j1m1();};
function _renderActa_j1m1(){var list=document.getElementById('ml-acta-list-j1m1');var sorted=_events.slice().sort(function(a,b){return a.min-b.min;});list.innerHTML='';if(sorted.length===0){list.innerHTML='<div class="ml-acta-empty">Sin eventos registrados</div>';return;}sorted.forEach(function(ev){var row=document.createElement('div');row.className='ml-evt-item';row.setAttribute('data-team',ev.team);row.setAttribute('data-type',ev.type);var tl=(ev.team==='a')?TEAM_A_NAME:TEAM_B_NAME;var _penFalloExtra='';if(ev.type==='pen-parado'){var _contrario=ev.team==='a'?'b':'a';var _fallado=sorted.find(function(e){return e.type==='pen-fallo'&&e.team===_contrario&&e.min===ev.min;});if(_fallado){_penFalloExtra='<span class="ml-evt-pen-fallo">❌ '+_fallado.num+'. '+_fallado.name+'</span>';}}row.innerHTML='<span class="ml-evt-min">'+ev.min+"'</span>"+'<span class="ml-evt-ico">'+ev.ico+'</span>'+'<span class="ml-evt-name">'+ev.num+'. '+ev.name+'</span>'+_penFalloExtra+'<span class="ml-evt-team">'+tl+'</span>'+'<button class="ml-evt-edit" onclick="window._openEditModal(\'j1m1\','+ev.id+')" title="Editar">🖍</button>'+'<button class="ml-evt-del" onclick="mlDelEvt_j1m1('+ev.id+')">✕</button>';list.appendChild(row);});};
window.mlDelEvt_j1m1=function(id){var ev=_events.find(function(e){return e.id===id;});if(!ev)return;var scoringTypes=['gol','propia','pen-gol','falta-gol'];if(scoringTypes.indexOf(ev.type)!==-1){var st=(ev.type==='propia')?(ev.team==='a'?'b':'a'):ev.team;_sc[st]=Math.max(0,_sc[st]-1);document.getElementById('sc-j1m1-a').textContent=_sc.a;document.getElementById('sc-j1m1-b').textContent=_sc.b;}_events=_events.filter(function(e){return e.id!==id;});_renderActa_j1m1();};
window.mlPenWizardCommit_j1m1=function(wiz){var now=Date.now();var min=_currentMin_j1m1();var commitSide=wiz.attackTeam;var shootSide=wiz.defendTeam;_events.push({min:min,label:'Pen. Provocado',type:'pen-prov',team:commitSide,num:wiz.provocador.num,name:wiz.provocador.name,ico:'🤦🥅',id:now});if(wiz.sancion&&wiz.provocador){var cardIco=wiz.sancion==='amarilla'?'🟨':'🟥';var cardLbl=wiz.sancion==='amarilla'?'Tarjeta Amarilla':'Roja Directa';_events.push({min:min,label:cardLbl,type:wiz.sancion,team:commitSide,num:wiz.provocador.num,name:wiz.provocador.name,ico:cardIco,id:now+1});if(wiz.sancion==='roja'){_rojas=_rojas||{};_rojas[commitSide]=(_rojas[commitSide]||0)+1;}}if(wiz.resultado==='gol'){_sc[shootSide]++;document.getElementById('sc-j1m1-a').textContent=_sc.a;document.getElementById('sc-j1m1-b').textContent=_sc.b;_events.push({min:min,label:'Penalti Gol',type:'pen-gol',team:shootSide,num:wiz.tirador.num,name:wiz.tirador.name,ico:'⚽🥅',id:now+2});}else{_events.push({min:min,label:'Penalti Fallado',type:'pen-fallo',team:shootSide,num:wiz.tirador.num,name:wiz.tirador.name,ico:'❌🥅',id:now+2});if(wiz.falladoTipo==='parado'&&wiz.portero){_events.push({min:min,label:'Penalti Parado',type:'pen-parado',team:commitSide,num:wiz.portero.num,name:wiz.portero.name,ico:'🖐🥅',id:now+3});}}  _renderActa_j1m1();};
})();

/* ══ ESCUDOS EN JORNADAS — tamaño unificado + aliases sólidos ═══════ */
(function(){
  function getCleanTeamName(el){
    if(!el) return '';
    var txt = (el.getAttribute('data-team-name') || el.textContent || '').trim();
    return txt.replace(/\s+\d+\s*\/\s*100$/,'').trim();
  }

  function upsertShield(el){
    if(!el) return;
    var teamName = getCleanTeamName(el);
    if(!teamName || teamName === 'Por definir') return;
    var logoUrl = window.getTeamLogoUrl ? window.getTeamLogoUrl(teamName) : '';
    if(!logoUrl) return;

    var textEl = el.querySelector('.jornada-team-text');
    if(!textEl){
      textEl = document.createElement('span');
      textEl.className = 'jornada-team-text';
    }
    textEl.textContent = teamName;

    var logoEl = el.querySelector('img.escudo-jornada');
    if(!logoEl){
      logoEl = document.createElement('img');
      logoEl.className = 'escudo-jornada';
      logoEl.loading = 'lazy';
      logoEl.decoding = 'async';
    }
    logoEl.src = logoUrl;
    logoEl.alt = 'Escudo de ' + teamName;
    logoEl.onerror = function(){ this.style.display = 'none'; };
    logoEl.style.display = '';

    el.setAttribute('data-team-name', teamName);
    el.textContent = '';
    el.appendChild(logoEl);
    el.appendChild(textEl);
  }

  function injectJornadaShields(){
    document.querySelectorAll('.mrow .mn').forEach(upsertShield);
  }

  window.injectJornadaShields = injectJornadaShields;

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(injectJornadaShields, 120);
  });

  var _origGoShields = window.go;
  window.go = function(id){
    if(_origGoShields) _origGoShields.apply(this, arguments);
    setTimeout(injectJornadaShields, 120);
  };

  if (typeof MutationObserver !== 'undefined') {
    /* Debounce 400ms — antes este observer agendaba setTimeout NUEVOS
       en cada mutación. Las cards live IA generan dozens de mutaciones
       por segundo → injectJornadaShields se ejecutaba decenas de veces
       en paralelo, saturando el thread JS y parando los cronómetros.
       Fix 2026-05-11. */
    var _injShields = null;
    var obs = new MutationObserver(function(){
      if (_injShields) return;
      _injShields = setTimeout(function(){ _injShields = null; try { injectJornadaShields(); } catch(_){} }, 400);
    });
    document.addEventListener('DOMContentLoaded', function(){
      obs.observe(document.body, { childList:true, subtree:true });
    });
  }
})();

/* script block 12 */

(function(){
  var LIGA_TEAMS = [
    'Arsenal','Athatic__TEMP__', 'Athletic Club','Atlético Madrid','Celta de Vigo','Deportivo Alavés','Elche CF','Espanyol','FC Barcelona','Getafe CF','Girona FC','Liverpool','Mallorca','Osasuna','Rayo Vallecano','Real Betis','Real Madrid','Real Sociedad','Sevilla','Valencia CF','Villarreal'
  ].filter(function(t){ return t !== 'Athatic__TEMP__'; }).sort(function(a,b){ return a.localeCompare(b,'es'); });

  var LIGA_EXTRAS = {};
  window.LIGA_EXTRAS = LIGA_EXTRAS;

  // Almacén directo de resultados simulados por jornada
  var LIGA_J1_RESULTS = [];
  window.LIGA_J1_RESULTS = LIGA_J1_RESULTS;

  // Registra resultado de un partido y actualiza clasificación en tiempo real
  window.registrarResultadoLiga = function(matchKey, teamA, teamB, ga, gb, ta_a, tr_a, ta_b, tr_b, mvp_a, mvp_b, penWinner){
    // Guardar resultado directo (sin depender del calendario DOM)
    // Dedup por PAR home/away, no por matchKey — porque `restoreJ1()`
    // rehidrata entradas de sesiones previas con una clave distinta
    // (`ls-j1-<home>`) y si comparamos por matchKey nos queda una
    // entrada "vieja" + una "nueva" para el MISMO partido → la
    // clasificación los cuenta dos veces (PJ=2 para equipos que solo
    // jugaron 1 partido en J1, puntos y goles dobles, etc.).
    var existing = -1;
    for(var i=0;i<LIGA_J1_RESULTS.length;i++){
      var _r = LIGA_J1_RESULTS[i];
      if(_r && _r.home===teamA && _r.away===teamB){existing=i;break;}
    }
    var result = {key:matchKey, home:teamA, away:teamB, gh:ga, ga_:gb, ta_h:ta_a, tr_h:tr_a, ta_a_:ta_b, tr_a_:tr_b, mvp_h:mvp_a, mvp_a:mvp_b, penWinner:penWinner||null};
    if(existing>=0)LIGA_J1_RESULTS[existing]=result; else LIGA_J1_RESULTS.push(result);
    // También actualizar LIGA_EXTRAS (TA, TR, MVP)
    function addEx(t,ta,tr,mvp){
      if(!LIGA_EXTRAS[t])LIGA_EXTRAS[t]={};
      LIGA_EXTRAS[t].ta=(Number(LIGA_EXTRAS[t].ta)||0)+ta;
      LIGA_EXTRAS[t].tr=(Number(LIGA_EXTRAS[t].tr)||0)+tr;
      LIGA_EXTRAS[t].mvp=(Number(LIGA_EXTRAS[t].mvp)||0)+mvp;
    }
    // Reset extras for ALL teams before recalculating to avoid double-counting on re-simulations
    Object.keys(LIGA_EXTRAS).forEach(function(t){ LIGA_EXTRAS[t]={ta:0,tr:0,mvp:0}; });
    // Recalculate extras from all stored results
    LIGA_J1_RESULTS.forEach(function(r){
      if(!LIGA_EXTRAS[r.home])LIGA_EXTRAS[r.home]={ta:0,tr:0,mvp:0};
      if(!LIGA_EXTRAS[r.away])LIGA_EXTRAS[r.away]={ta:0,tr:0,mvp:0};
      LIGA_EXTRAS[r.home].ta=(LIGA_EXTRAS[r.home].ta||0)+r.ta_h;
      LIGA_EXTRAS[r.home].tr=(LIGA_EXTRAS[r.home].tr||0)+r.tr_h;
      LIGA_EXTRAS[r.home].mvp=(LIGA_EXTRAS[r.home].mvp||0)+r.mvp_h;
      LIGA_EXTRAS[r.away].ta=(LIGA_EXTRAS[r.away].ta||0)+r.ta_a_;
      LIGA_EXTRAS[r.away].tr=(LIGA_EXTRAS[r.away].tr||0)+r.tr_a_;
      LIGA_EXTRAS[r.away].mvp=(LIGA_EXTRAS[r.away].mvp||0)+r.mvp_a;
    });
    if(typeof buildLigaClas==='function')buildLigaClas();
  };

  function ensureTeam(store, name){
    if(!name || name === 'Por definir') return null;
    name = String(name).trim();
    if(!store[name]){
      store[name] = {name:name, pts:0, pj:0, v:0, e:0, p:0, gf:0, gc:0, dg:0, ta:0, tr:0, mvp:0, form:[]};
    }
    return store[name];
  }

  function parseScore(scoreText){
    if(!scoreText) return null;
    var clean = String(scoreText).replace(/–/g,'-').replace(/\s+/g,'');
    var m = clean.match(/^(\d+)-(\d+)$/);
    if(!m) return null;
    return {home:parseInt(m[1],10), away:parseInt(m[2],10)};
  }

  function addForm(team, result){
    team.form.push(result);
    if(team.form.length > 5) team.form = team.form.slice(team.form.length - 5);
  }

  function getExtrasForTeam(name){
    /* MVP / TA / TR ahora se calculan desde LIGA_PLAYER_MATCH_STORE
       (fuente de verdad con los eventos completos por partido) en
       vez del cache LIGA_EXTRAS, que solo se rellenaba desde
       LIGA_J1_RESULTS y se reseteaba a 0 al cerrar partidos de
       J2+, perdiendo MVPs. Con este cambio, Atléti con 9 MVPs
       deja de salir como "0 MVP" en la clasificación.
       Solo si la store está vacía caemos al cache vivo (preserva
       comportamiento legacy en arranques en frío). */
    var canon = (typeof canonicalTeamName === 'function')
                  ? canonicalTeamName(name) : String(name||'').trim();
    var store = window.LIGA_PLAYER_MATCH_STORE;
    if (store && Object.keys(store).length) {
      var ta = 0, tr = 0, mvp = 0;
      Object.keys(store).forEach(function(k) {
        var entry = store[k];
        if (!entry) return;
        var canonA = (typeof canonicalTeamName === 'function') ? canonicalTeamName(entry.teamA || '') : (entry.teamA || '');
        var canonB = (typeof canonicalTeamName === 'function') ? canonicalTeamName(entry.teamB || '') : (entry.teamB || '');
        var teamSide = (canonA === canon) ? 'a' : (canonB === canon ? 'b' : null);
        if (!teamSide) return;
        var evts = Array.isArray(entry.evts) ? entry.evts : [];
        var hasMvpInEvts = false;
        evts.forEach(function(ev) {
          if (!ev) return;
          /* realTeam (canonical) tiene prioridad sobre team (a/b)
             para evitar mismatches cuando el orden home/away se invierte
             en la 2ª vuelta. */
          var sideOk = ev.realTeam
            ? (canonicalTeamName(ev.realTeam) === canon)
            : (ev.team === teamSide);
          if (!sideOk) return;
          var t = ev.type;
          if (t === 'amarilla') ta++;
          /* Doble amarilla = 2ª amarilla + roja por expulsión. Suma
             a AMBOS contadores (petición usuario 2026-05-05): el
             jugador se lleva 2 tarjetas en su acta personal. */
          else if (t === 'd-amarilla') { ta++; tr++; }
          else if (t === 'roja') tr++;
          else if (t === 'mvp') { mvp++; hasMvpInEvts = true; }
          else if (t === 'card') {
            /* Bundled flow legacy mapea amarilla/roja/d-amarilla → 'card'
               + ico distintivo. 🟨 = amarilla; 🟥 = roja directa;
               🟨🟥 = doble amarilla (suma 1 amarilla + 1 roja). */
            var ico = String(ev.ico || '');
            if (ico === '🟨') ta++;
            else if (ico === '🟨🟥') { ta++; tr++; }
            else tr++;
          }
        });
        /* Fallback MVP: algunas rutas guardan el MVP en mvpName/mvpTeam
           top-level pero NO como evento dentro de evts. */
        if (!hasMvpInEvts && entry.mvpTeam) {
          var canonMvpT = (typeof canonicalTeamName === 'function')
                            ? canonicalTeamName(entry.mvpTeam)
                            : entry.mvpTeam;
          if (canonMvpT === canon) mvp++;
        }
      });
      return { ta: ta, tr: tr, mvp: mvp };
    }
    var ex = LIGA_EXTRAS[name] || {};
    return {
      ta: Number(ex.ta || 0),
      tr: Number(ex.tr || 0),
      mvp: Number(ex.mvp || 0)
    };
  }

  function collectStandings(){
    var teams = {};
    LIGA_TEAMS.forEach(function(name){ ensureTeam(teams, name); });

    // Leer resultados directos del almacén (simulados en esta sesión)
    var j1SimPairs = {};
    LIGA_J1_RESULTS.forEach(function(r){
      j1SimPairs[r.home+'·'+r.away] = true;
      var home = ensureTeam(teams, r.home);
      var away = ensureTeam(teams, r.away);
      if(!home || !away) return;
      home.pj++; away.pj++;
      home.gf += r.gh; home.gc += r.ga_;
      away.gf += r.ga_; away.gc += r.gh;
      if(r.penWinner){
        // Victoria en penaltis: 3pts ganador, 0pts perdedor
        if(r.penWinner==='a'){
          home.v++; home.pts += 3; away.p++;
          addForm(home,'W'); addForm(away,'L');
        }else{
          away.v++; away.pts += 3; home.p++;
          addForm(home,'L'); addForm(away,'W');
        }
      }else if(r.gh > r.ga_){
        home.v++; home.pts += 3; away.p++;
        addForm(home,'W'); addForm(away,'L');
      }else if(r.gh < r.ga_){
        away.v++; away.pts += 3; home.p++;
        addForm(home,'L'); addForm(away,'W');
      }else{
        home.e++; away.e++; home.pts++; away.pts++;
        addForm(home,'D'); addForm(away,'D');
      }
    });

    // Leer del calendario DOM (jornadas 2-38, y J1 solo si no está ya en el almacén)
    for(var j=1;j<=38;j++){
      var round = document.getElementById('l-j' + j);
      if(!round) continue;
      var rows = round.querySelectorAll('.mrow');
      rows.forEach(function(row){
        var homeEl = row.querySelector('.mn:not(.r)');
        var awayEl = row.querySelector('.mn.r');
        var scoreEl = row.querySelector('.ms');
        if(!homeEl || !awayEl || !scoreEl || scoreEl.classList.contains('p')) return;
        // Nombre canónico desde el atributo data-team (se inyecta en
        // jornadaTeamHtml con el nombre SIN emoji ni \u00a0). Usar
        // textContent daría "🔨\u00a0Real Madrid" y rompería la
        // deduplicación contra LIGA_J1_RESULTS → el partido quedaría
        // contado dos veces (una desde el almacén directo y otra desde
        // el DOM), hinchando PJ/GF/GC para los equipos de J1.
        var homeName = (homeEl.dataset && homeEl.dataset.team) || homeEl.textContent.trim();
        var awayName = (awayEl.dataset && awayEl.dataset.team) || awayEl.textContent.trim();
        // Si ya fue procesado desde el almacén directo, omitir para no duplicar
        if(j===1 && j1SimPairs[homeName+'·'+awayName]) return;
        var home = ensureTeam(teams, homeName);
        var away = ensureTeam(teams, awayName);
        var score = parseScore(scoreEl.textContent);
        if(!home || !away || !score) return;
        home.pj++; away.pj++;
        home.gf += score.home; home.gc += score.away;
        away.gf += score.away; away.gc += score.home;
        if(score.home > score.away){
          home.v++; home.pts += 3; away.p++;
          addForm(home,'W'); addForm(away,'L');
        }else if(score.home < score.away){
          away.v++; away.pts += 3; home.p++;
          addForm(home,'L'); addForm(away,'W');
        }else{
          home.e++; away.e++; home.pts++; away.pts++;
          addForm(home,'D'); addForm(away,'D');
        }
      });
    }

    Object.keys(teams).forEach(function(name){
      var team = teams[name];
      team.dg = team.gf - team.gc;
      var extras = getExtrasForTeam(name);
      team.ta = extras.ta;
      team.tr = extras.tr;
      team.mvp = extras.mvp;
    });

    return Object.keys(teams).map(function(name){ return teams[name]; }).sort(function(a,b){
      if(b.pts !== a.pts) return b.pts - a.pts;
      if(b.dg !== a.dg) return b.dg - a.dg;
      if(b.gf !== a.gf) return b.gf - a.gf;
      return a.name.localeCompare(b.name,'es');
    });
  }

  function formHtml(form){
    var last = form.slice(-5);
    if(!last.length){
      return '<span class="clas-dot pending" title="Sin resultados"></span>';
    }
    return last.map(function(r){
      if(r === 'W') return '<span class="clas-dot win" title="Victoria"></span>';
      if(r === 'D') return '<span class="clas-dot draw" title="Empate"></span>';
      return '<span class="clas-dot loss" title="Derrota"></span>';
    }).join('');
  }

  function rowZoneClass(pos, total){
    // Lee las plazas configuradas por el admin desde Reglas de la
    // competición (modal lext-ov-reglas, slug 'liga-ea-sports'). Si no
    // hay config guardada, usa el reparto clásico de Liga EA Sports
    // (4 UCL + 1 Previa + 0 Open + 2 UEL + 1 Conference + 4 Descenso).
    if(typeof window._ligaEaZoneClass === 'function'){
      return window._ligaEaZoneClass(pos, total || 20);
    }
    if(pos >= 1 && pos <= 4) return 'zone-ucl';
    if(pos === 5) return 'zone-ucl-prev';
    if(pos === 6 || pos === 7) return 'zone-uel';
    if(pos === 8) return 'zone-conf';
    if(pos >= 17) return 'zone-desc';
    return '';
  }

  var TEAM_DATA = {
    'Arsenal':          {abbr:'ARS', bg:'#ef0107', fg:'#ffffff'},
    'Athletic Club':    {abbr:'ATH', bg:'#cc1010', fg:'#ffffff'},
    'Atlético Madrid':  {abbr:'ATM', bg:'#c50f1f', fg:'#ffffff'},
    'Bayern Munich':    {abbr:'FCB', bg:'#dc052d', fg:'#ffffff'},
    'Celta de Vigo':    {abbr:'CEL', bg:'#6fc6e2', fg:'#003da5'},
    'Elche CF':         {abbr:'ELC', bg:'#006633', fg:'#ffffff'},
    'Espanyol':         {abbr:'ESP', bg:'#003da5', fg:'#ffffff'},
    'FC Barcelona':     {abbr:'BAR', bg:'#a50044', fg:'#edbb00'},
    'Getafe CF':        {abbr:'GET', bg:'#003da5', fg:'#ffffff'},
    'Girona FC':        {abbr:'GIR', bg:'#c8102e', fg:'#ffffff'},
    'Mallorca':         {abbr:'MAL', bg:'#c8102e', fg:'#ffcc00'},
    'Osasuna':          {abbr:'OSA', bg:'#c8102e', fg:'#ffffff'},
    'Rayo Vallecano':   {abbr:'RAY', bg:'#e8000d', fg:'#ffffff'},
    'Real Betis':       {abbr:'BET', bg:'#00a650', fg:'#ffd700'},
    'Real Madrid':      {abbr:'RMA', bg:'#003087', fg:'#f0c040'},
    'Real Sociedad':    {abbr:'RSO', bg:'#003f8a', fg:'#d0dcf4'},
    'Sevilla':          {abbr:'SEV', bg:'#c60b1e', fg:'#ffffff'},
    'Deportivo Alavés': {abbr:'AVS', bg:'#0052a3', fg:'#ffffff'},
    'Valencia CF':      {abbr:'VAL', bg:'#ef7d00', fg:'#ffffff'},
    'Villarreal':       {abbr:'VIL', bg:'#ffd700', fg:'#1a1a1a'}
  };
  /* Exponer TEAM_DATA y un helper getTeamAbbr para que otros
     módulos (acta WhatsApp, badges) puedan abreviar nombres largos
     ("Atlético Madrid" → "ATM") sin duplicar el mapa. Si no hay
     entrada para un equipo, generamos una sigla con las iniciales
     de las palabras significativas (saltando "FC", "CF", "de",
     "Real" cuando sobra) — fallback: 3 primeras letras en
     mayúsculas. */
  try { window.TEAM_DATA = TEAM_DATA; } catch(_){}
  window.getTeamAbbr = function(name) {
    if (!name) return '';
    var n = String(name).trim();
    if (TEAM_DATA[n] && TEAM_DATA[n].abbr) return TEAM_DATA[n].abbr;
    /* Resolver alias canónico (ej. "Alavés" → "Deportivo Alavés"). */
    try {
      var aliases = window.TEAM_ALIASES || {};
      var canon = aliases[n.toLowerCase()] || n;
      if (TEAM_DATA[canon] && TEAM_DATA[canon].abbr) return TEAM_DATA[canon].abbr;
    } catch(_){}
    var STOP = { fc:1, cf:1, cd:1, ud:1, ad:1, sd:1, ca:1, sad:1, real:1, de:1, del:1, la:1, los:1, club:1, atletico:1, athletic:1 };
    var parts = n.normalize('NFD').replace(/[̀-ͯ]/g,'')
                 .replace(/[^A-Za-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
    var sig = parts.filter(function(p){ return !STOP[p.toLowerCase()]; });
    var abbr = '';
    if (sig.length >= 2) {
      abbr = sig.slice(0, 3).map(function(p){ return p.charAt(0).toUpperCase(); }).join('');
    } else if (sig.length === 1) {
      abbr = sig[0].substring(0, 3).toUpperCase();
    } else if (parts.length) {
      abbr = parts[0].substring(0, 3).toUpperCase();
    }
    return abbr || n.substring(0, 3).toUpperCase();
  };

  // Team logo URLs — rutas locales explícitas (evita fallos por nombres/tildes/espacios)
  window.TEAM_LOGOS = {
    // ── La Liga 1ª ──────────────────────────────────────────
    'Real Madrid':        '/static/img/escudos-1/spain_real-madrid.football-logos.cc.svg',
    'Real Madrid CF':     '/static/img/escudos-1/spain_real-madrid.football-logos.cc.svg',
    'FC Barcelona':       '/static/img/escudos-1/spain_barcelona.football-logos.cc.svg',
    'Barcelona':          '/static/img/escudos-1/spain_barcelona.football-logos.cc.svg',
    'Barça':              '/static/img/escudos-1/spain_barcelona.football-logos.cc.svg',
    'Athletic Club':      '/static/img/escudos-1/spain_athletic-club.football-logos.cc.svg',
    'Real Betis':         '/static/img/escudos-1/spain_real-betis.football-logos.cc.svg',
    'Real Sociedad':      '/static/img/escudos-1/spain_real-sociedad.football-logos.cc.svg',
    'Atlético Madrid':    '/static/img/escudos-1/spain_atletico-madrid.football-logos.cc.svg',
    'Atlético de Madrid': '/static/img/escudos-1/spain_atletico-madrid.football-logos.cc.svg',
    'Atletico de Madrid': '/static/img/escudos-1/spain_atletico-madrid.football-logos.cc.svg',
    'Villarreal':         '/static/img/escudos-1/spain_villarreal.football-logos.cc.svg',
    'Villarreal CF':      '/static/img/escudos-1/spain_villarreal.football-logos.cc.svg',
    'Sevilla':            '/static/img/escudos-1/sevilla-fc.svg',
    'Sevilla FC':         '/static/img/escudos-1/sevilla-fc.svg',
    'Valencia CF':        '/static/img/escudos-1/spain_valencia.football-logos.cc.svg',
    'Girona FC':          '/static/img/escudos-1/spain_girona.football-logos.cc.svg',
    'Rayo Vallecano':     '/static/img/escudos-1/spain_rayo-vallecano.football-logos.cc.svg',
    'Rayo':               '/static/img/escudos-1/spain_rayo-vallecano.football-logos.cc.svg',
    'Getafe CF':          '/static/img/escudos-1/spain_getafe.football-logos.cc.svg',
    'Mallorca':           '/static/img/escudos-1/spain_mallorca.football-logos.cc.svg',
    'Osasuna':            '/static/img/escudos-1/spain_osasuna.football-logos.cc.svg',
    'Espanyol':           '/static/img/escudos-1/spain_espanyol.football-logos.cc.svg',
    'Celta de Vigo':      '/static/img/escudos-1/spain_celta.football-logos.cc.svg',
    'Bayern Munich':      '/static/img/escudos-1/germany_bayern-munchen.football-logos.cc.svg',
    'Bayern de Múnich':   '/static/img/escudos-1/germany_bayern-munchen.football-logos.cc.svg',
    'Arsenal':            '/static/img/escudos-1/england_arsenal.football-logos.cc.svg',
    'Deportivo Alavés': '/static/img/escudos-1/spain_deportivo-alaves.svg',
    'Sporting de Portugal':'/static/img/escudos-1/portugal_sporting-cp.football-logos.cc.svg',
    'PSG':                'https://cdn.resfu.com/img_data/equipos/1924.png?size=120x&lossy=1',
    'Paris Saint-Germain':'https://cdn.resfu.com/img_data/equipos/1924.png?size=120x&lossy=1',
    // ── Serie A (Italia) — equipos extranjeros usados en torneos de
    // verano / amistosos. Solo añadimos los que han salido en la previa
    // con el 🛡️ silver (Samsung) por NO estar en ninguna ligaExt_*
    // ni en TEAM_LOGOS. El resto de italianos comunes (Juventus, AC
    // Milan, Inter, Napoli, Roma, Lazio) ya viven en plantillas
    // editadas por el admin → window._ligaEaShields los resuelve.
    'Como':               'https://commons.wikimedia.org/wiki/Special:FilePath/Como_1907.svg',
    'Como 1907':          'https://commons.wikimedia.org/wiki/Special:FilePath/Como_1907.svg',
    'Como Calcio':        'https://commons.wikimedia.org/wiki/Special:FilePath/Como_1907.svg',
    'Elche CF':           '/static/img/escudos-1/spain_elche.football-logos.cc.svg',
    'Elche':              '/static/img/escudos-1/spain_elche.football-logos.cc.svg',
    'Levante UD':         '/static/img/escudos-2/spain_levante.football-logos.cc.svg',
    'Levante':            '/static/img/escudos-2/spain_levante.football-logos.cc.svg',
    'Real Oviedo':        '/static/img/escudos-1/spain_oviedo.football-logos.cc.svg',
    'Oviedo':             '/static/img/escudos-1/spain_oviedo.football-logos.cc.svg',
    // ── Liga Hypermotion (2ª) ───────────────────────────────
    'Real Racing Club':   '/static/img/escudos-2/spain_racing.football-logos.cc.svg',
    'Racing Santander':   '/static/img/escudos-2/spain_racing.football-logos.cc.svg',
    'RC Deportivo':       '/static/img/escudos-2/spain_deportivo-la-coruna.football-logos.cc.svg',
    'Deportivo Coruña':   '/static/img/escudos-2/spain_deportivo-la-coruna.football-logos.cc.svg',
    'Deportivo La Coruña':'/static/img/escudos-2/spain_deportivo-la-coruna.football-logos.cc.svg',
    'UD Almería':         '/static/img/escudos-2/spain_almeria.football-logos.cc.svg',
    'Almería':            '/static/img/escudos-2/spain_almeria.football-logos.cc.svg',
    'Málaga CF':          '/static/img/escudos-2/spain_malaga.football-logos.cc.svg',
    'Málaga':             '/static/img/escudos-2/spain_malaga.football-logos.cc.svg',
    'CD Castellón':       '/static/img/escudos-2/spain_castellon.football-logos.cc.svg',
    'Castellón':          '/static/img/escudos-2/spain_castellon.football-logos.cc.svg',
    'UD Las Palmas':      '/static/img/escudos-2/spain_las-palmas.football-logos.cc.svg',
    'Las Palmas':         '/static/img/escudos-2/spain_las-palmas.football-logos.cc.svg',
    'Burgos CF':          '/static/img/escudos-2/spain_burgos.football-logos.cc.svg',
    'Burgos':             '/static/img/escudos-2/spain_burgos.football-logos.cc.svg',
    'Burgos Club de Fútbol': '/static/img/escudos-2/spain_burgos.football-logos.cc.svg',
    'Real Sporting de Gijón': '/static/img/escudos-2/spain_sporting-gijon.football-logos.cc.svg',
    'Sporting Gijón':     '/static/img/escudos-2/spain_sporting-gijon.football-logos.cc.svg',
    'Ceuta':              '/static/img/escudos-2/spain_ceuta.football-logos.cc.svg',
    'AD Ceuta':           '/static/img/escudos-2/spain_ceuta.football-logos.cc.svg',
    'SD Eibar':           '/static/img/escudos-2/spain_eibar.football-logos.cc.svg',
    'Eibar':              '/static/img/escudos-2/spain_eibar.football-logos.cc.svg',
    'Córdoba CF':         'https://commons.wikimedia.org/wiki/Special:FilePath/C%C3%B3rdoba_CF.svg',
    'Córdoba':            'https://commons.wikimedia.org/wiki/Special:FilePath/C%C3%B3rdoba_CF.svg',
    'Real Sociedad B':    '/static/img/escudos-1/spain_real-sociedad.football-logos.cc.svg',
    'Real Sociedad B U21':'/static/img/escudos-1/spain_real-sociedad.football-logos.cc.svg',
    'FC Andorra':         '/static/img/escudos-2/spain_fc-andorra.football-logos.cc.svg',
    'Andorra':            '/static/img/escudos-2/spain_fc-andorra.football-logos.cc.svg',
    'Cádiz CF':           '/static/img/escudos-2/spain_cadiz.football-logos.cc.svg',
    'Cádiz':              '/static/img/escudos-2/spain_cadiz.football-logos.cc.svg',
    'Granada':            '/static/img/escudos-2/spain_granada.football-logos.cc.svg',
    'Albacete BP':        '/static/img/escudos-2/spain_albacete.football-logos.cc.svg',
    'Albacete':           '/static/img/escudos-2/spain_albacete.football-logos.cc.svg',
    'Albacete Balompié':  '/static/img/escudos-2/spain_albacete.football-logos.cc.svg',
    'Real Valladolid':    '/static/img/escudos-2/spain_valladolid.football-logos.cc.svg',
    'Valladolid':         '/static/img/escudos-2/spain_valladolid.football-logos.cc.svg',
    'Leganés':            '/static/img/escudos-2/spain_leganes.football-logos.cc.svg',
    'Huesca':             '/static/img/escudos-2/spain_huesca.football-logos.cc.svg',
    'Deportivo Alavés':   '/static/img/escudos-1/spain_deportivo-alaves.svg',
    'Real Zaragoza':      '/static/img/escudos-2/spain_zaragoza.football-logos.cc.svg',
    'Zaragoza':           '/static/img/escudos-2/spain_zaragoza.football-logos.cc.svg',
    'Cultural Leonesa':   '/static/img/escudos-2/spain_cultural-leonesa.football-logos.cc.svg',
    'Mirandés':           '/static/img/escudos-3/spain_mirandes.football-logos.cc.svg',
    // ── Primera Federación ──────────────────────────────────
    'Real Madrid Castilla': '/static/img/escudos-1/spain_real-madrid.football-logos.cc.svg',
    'Ponferradina':       '/static/img/escudos-3/spain_ponferradina.football-logos.cc.svg',
    'CD Lugo':            '/static/img/escudos-2/spain_lugo.football-logos.cc.svg',
    'Celta Fortuna':      '/static/img/escudos-1/spain_celta.football-logos.cc.svg',
    'Cultural Leonesa':   '/static/img/escudos-2/spain_cultural-leonesa.football-logos.cc.svg',
    'Racing Ferrol':      '/static/img/escudos-3/spain_racing-club-ferrol.football-logos.cc.svg',
    'Gimnàstic Tarragona': '/static/img/escudos-3/spain_gimnastic-de-tarragona.football-logos.cc.svg',
    'Osasuna Promesas':   '/static/img/escudos-1/spain_osasuna.football-logos.cc.svg',
    'Bilbao Ath.':        '/static/img/escudos-1/spain_athletic-club.football-logos.cc.svg',
    'Unionistas CF':      '/static/img/escudos-3/spain_unionistas-de-salamanca.football-logos.cc.svg',
    'AD Mérida':          '/static/img/escudos-3/spain_ad-merida.football-logos.cc.svg',
    'Barakaldo':          '/static/img/escudos-3/spain_barakaldo.football-logos.cc.svg',
    'Arenteiro':          '/static/img/escudos-2/spain_cd-arenteiro.football-logos.cc.svg',
    'Zamora CF':          '/static/img/escudos-3/spain_zamora.football-logos.cc.svg',
    'Ourense CF':         '/static/img/escudos-3/spain_ourense-cf.football-logos.cc.svg',
    'CF Talavera':        '/static/img/escudos-3/spain_cf-talavera-de-la-reina.football-logos.cc.svg',
    'CD Guadalajara':     '/static/img/escudos-3/spain_cd-guadalajara.football-logos.cc.svg',
    'CP Cacereño':        '/static/img/escudos-3/spain_cacereno.football-logos.cc.svg',
    'Arenas de Getxo':    '/static/img/escudos-3/spain_arenas-club.football-logos.cc.svg',
    'Real Avilés Industrial': '/static/img/escudos-3/spain_real-aviles-industrial.football-logos.cc.svg',
    'Real Unión':         '/static/img/escudos-3/spain_real-union.football-logos.cc.svg',
    'UD Ibiza':           '/static/img/escudos-2/spain_ud-ibiza.football-logos.cc.svg',
    'Real Murcia':        '/static/img/escudos-3/spain_murcia.football-logos.cc.svg',
    'Eldense':            '/static/img/escudos-3/spain_eldense.football-logos.cc.svg',
    'Hércules CF':        '/static/img/escudos-3/spain_hercules.football-logos.cc.svg',
    'AD Alcorcón':        '/static/img/escudos-3/spain_alcorcon.football-logos.cc.svg',
    'FC Cartagena':       '/static/img/escudos-2/spain_fc-cartagena.football-logos.cc.svg',
    'Villarreal B':       '/static/img/escudos-1/spain_villarreal.football-logos.cc.svg',
    'Marbella FC':        '/static/img/escudos-2/spain_ud-marbella.football-logos.cc.svg',
    'CE Sabadell':        '/static/img/escudos-3/spain_sabadell.football-logos.cc.svg',
    'Betis Deportivo':    '/static/img/escudos-1/spain_real-betis.football-logos.cc.svg',
    'Antequera CF':       '/static/img/escudos-3/spain_antequera.football-logos.cc.svg',
    'Sevilla At.':        '/static/img/escudos-1/sevilla-fc.svg',
    'Sevilla Atlético':   '/static/img/escudos-1/sevilla-fc.svg',
    'Algeciras CF':       '/static/img/escudos-3/spain_algeciras.football-logos.cc.svg',
    'Atlético Madrileño': '/static/img/escudos-1/spain_atletico-madrid.football-logos.cc.svg',
    'At. Sanluqueño':     '/static/img/escudos-3/spain_atletico-sanluqueno.football-logos.cc.svg',
    'CE Europa':          '/static/img/escudos-3/spain_ce-europa.football-logos.cc.svg',
    'SD Tarazona':        '/static/img/escudos-2/spain_tarazona.football-logos.cc.svg',
    'CD Teruel':          '/static/img/escudos-3/spain_teruel.football-logos.cc.svg',
    'Juventud Torremolinos': '/static/img/escudos-2/spain_juventud-torremolinos.football-logos.cc.svg',
    'Estepona':           '/static/img/escudos-fallback/estepona.svg',
    'Recreativo de Huelva': 'https://commons.wikimedia.org/wiki/Special:FilePath/Recreativo_de_Huelva.svg',
    'Mérida AD':          '/static/img/escudos-3/spain_ad-merida.football-logos.cc.svg',
    'Algeciras CF':       '/static/img/escudos-3/spain_algeciras.football-logos.cc.svg',
  };

  function normalizeTeamKey(name){
    return String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  var TEAM_LOGOS_NORMALIZED = {};
  Object.keys(window.TEAM_LOGOS || {}).forEach(function(teamName){
    TEAM_LOGOS_NORMALIZED[normalizeTeamKey(teamName)] = window.TEAM_LOGOS[teamName];
  });

  window.getTeamLogoUrl = function(name){
    var aliases = window.TEAM_ALIASES || {};
    var clean = String(name || '').trim();
    var normalizedClean = normalizeTeamKey(clean);
    var canonical = aliases[normalizedClean] || aliases[clean.toLowerCase()] || clean;
    // ── Prioridad 1: escudo definido por el admin en el editor de Liga
    // EA Sports (ligaExt_liga-ea-sports). Si el usuario puso una URL de
    // escudo personalizada, gana sobre el TEAM_LOGOS hardcodeado.
    // Fuzzy match: si el nombre canónico es "Deportivo Alavés" y el
    // admin guardó el escudo bajo "Alavés", se busca como substring.
    if(window._ligaEaShields){
      var s = window._ligaEaShields[canonical] || window._ligaEaShields[clean] || window._ligaEaShields[normalizedClean];
      if(!s){
        var _shKeys = Object.keys(window._ligaEaShields);
        for(var _si=0; _si<_shKeys.length; _si++){
          var _sk = _shKeys[_si];
          if(!window._ligaEaShields[_sk]) continue;
          if(canonical.indexOf(_sk)!==-1 || _sk.indexOf(canonical)!==-1 ||
             normalizedClean.indexOf(_sk)!==-1 || _sk.indexOf(normalizedClean)!==-1){
            s = window._ligaEaShields[_sk]; break;
          }
        }
      }
      if(s) return s;
    }
    var logos = window.TEAM_LOGOS || {};
    if (logos[canonical]) return logos[canonical];
    if (logos[clean]) return logos[clean];
    if (TEAM_LOGOS_NORMALIZED[normalizeTeamKey(canonical)]) return TEAM_LOGOS_NORMALIZED[normalizeTeamKey(canonical)];
    if (TEAM_LOGOS_NORMALIZED[normalizedClean]) return TEAM_LOGOS_NORMALIZED[normalizedClean];
    var ratings = window.TEAM_RATINGS || {};
    var meta = ratings[canonical] || ratings[clean];
    if (meta && typeof meta === 'object' && meta.shield) return meta.shield;
    return '';
  };

  function getTeamBadgeLabel(name){
    return String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(function(part){ return part.charAt(0).toUpperCase(); })
      .join('') || 'CLB';
  }

  // Letter-badge fallback (extraído para que el onerror del <img> pueda
  // degradar sin reintentar la URL que falló — antes el onerror llamaba
  // de nuevo a getTeamBadgeHtml con el mismo nombre y, como el admin
  // shield seguía en window._ligaEaShields, devolvía el mismo <img>
  // roto y el navegador entraba en un bucle de 404 sin que el escudo
  // llegase nunca a mostrar nada).
  window.getTeamBadgeHtmlLetter = function(name){
    var safeName = String(name || '').trim();
    var aliases = window.TEAM_ALIASES || {};
    var ratings = window.TEAM_RATINGS || {};
    var canonical = aliases[safeName.toLowerCase()] || safeName;
    var meta = ratings[canonical] || ratings[safeName] || {};
    var bg = (meta && meta.color) || '#24324a';
    return '<span class="clas-team-logo clas-team-logo-fallback" role="img" aria-label="Escudo de ' + safeName.replace(/"/g, '&quot;') + '" style="background:' + bg + ';">' + getTeamBadgeLabel(safeName) + '</span>';
  };

  // Hardcoded-only lookup (salta _ligaEaShields). Se usa en la cascada
  // de fallback cuando la URL del admin da 404.
  function _hardcodedLogoUrl(name){
    var aliases = window.TEAM_ALIASES || {};
    var clean = String(name || '').trim();
    var normalizedClean = normalizeTeamKey(clean);
    var canonical = aliases[normalizedClean] || aliases[clean.toLowerCase()] || clean;
    var logos = window.TEAM_LOGOS || {};
    if (logos[canonical]) return logos[canonical];
    if (logos[clean]) return logos[clean];
    if (TEAM_LOGOS_NORMALIZED[normalizeTeamKey(canonical)]) return TEAM_LOGOS_NORMALIZED[normalizeTeamKey(canonical)];
    if (TEAM_LOGOS_NORMALIZED[normalizedClean]) return TEAM_LOGOS_NORMALIZED[normalizedClean];
    var ratings = window.TEAM_RATINGS || {};
    var meta = ratings[canonical] || ratings[clean];
    if (meta && typeof meta === 'object' && meta.shield) return meta.shield;
    return '';
  }

  window.getTeamBadgeHtml = function(name, skipAdmin){
    var safeName = String(name || '').trim();
    var fallbackName = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var logoUrl = skipAdmin
      ? _hardcodedLogoUrl(name)
      : (window.getTeamLogoUrl ? window.getTeamLogoUrl(name) : '');
    if (logoUrl) {
      // Cascada en onerror: primero salta al escudo hardcodeado si el
      // admin URL ha fallado (skipAdmin=true); si también falla, cae al
      // badge de letras. Esto rompe el bucle infinito de 404.
      var onerrorHandler = skipAdmin
        ? 'this.outerHTML=window.getTeamBadgeHtmlLetter(\'' + fallbackName + '\')'
        : 'this.outerHTML=window.getTeamBadgeHtml(\'' + fallbackName + '\', true)';
      return '<img class="clas-team-logo" src="' + logoUrl + '" onerror="' + onerrorHandler + '" alt="Escudo de ' + safeName.replace(/"/g, '&quot;') + '"/>';
    }
    return window.getTeamBadgeHtmlLetter(name);
  };

  var SHORT_NAMES = {
    'Bayern Munich':    'Bayern',
    'Atlético Madrid':  'Atl Madrid',
    'Celta de Vigo':    'Celta',
    'Elche CF':         'Elche',
    'Rayo Vallecano':   'Rayo',
    'Deportivo Alavés': 'Alavés',
    'Valencia CF':      'Valencia'
  };
  // HUMAN_TEAMS dinámico desde ligaExt
  var HUMAN_TEAMS = (function(){
    var ht = {};
    try {
      var raw = localStorage.getItem('ligaExt_liga-ea-sports');
      if(raw){
        var d = JSON.parse(raw);
        if(d && Array.isArray(d.teams)){
          d.teams.forEach(function(t){ if(t.isHuman && t.humanEmoji) ht[t.name] = t.humanEmoji; });
        }
      }
    } catch(_){}
    if(!Object.keys(ht).length) ht = {'Bayern Munich':'💡','Arsenal':'🐭','Atlético Madrid':'✏️','Real Madrid':'🔨','FC Barcelona':'👿'};
    return ht;
  })();

  function buildLigaClas(){
    var list = collectStandings();
    var el = document.getElementById('clas-liga-content');
    if(!el) return;

  var html = ''
      + '<div class="clas-legend">'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#3160ff"></span>🔵 Champions</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#a855f7"></span>🟣 Previa Ch.</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#ff8214"></span>🟠 E.League</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#3cc878"></span>🟢 Conference</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#e03c3c"></span>🔴 Descenso</span>'
      + '</div>'
      + '<div class="clas-scroll-outer">'
      +   '<div class="clas-hdr-scroll" id="clas-hdr-scroll">'
      +     '<div class="clas-table">'
      +       '<div class="clas-hdr">'
      +         '<span class="clas-hdr-team">Equipo</span><span>PTS</span><span>PJ</span><span>V</span><span>E</span><span>P</span><span>GF</span><span>GC</span><span>DG</span><span>TA</span><span>TR</span><span>MVP</span><span>%</span>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="clas-scroll" id="clas-body-scroll">'
      +     '<div class="clas-table">';

    var _total1 = list.length;
    list.forEach(function(team, idx){
      var pos = idx + 1;
      var zone = rowZoneClass(pos, _total1);
      var dgClass = 'clas-val dg ' + (team.dg > 0 ? 'pos' : team.dg < 0 ? 'neg' : 'zer');
      // Escudo antes del nombre + emoji humano después del nombre.
      var badgeHtml = (typeof window.getTeamBadgeHtml === 'function') ? window.getTeamBadgeHtml(team.name) : '';
      var displayName = SHORT_NAMES[team.name] || team.name;
      var humanEmoji = HUMAN_TEAMS[team.name] || '';
      var suffixHtml = humanEmoji ? '<span class="clas-team-human-suffix">'+humanEmoji+'</span>' : '';
      html += ''
        + '<div class="clas-row ' + zone + '">'
        +   '<div class="clas-team-cell">'
        +     '<span class="clas-pos-n">' + pos + '</span>'
        +     badgeHtml
        +     '<span class="clas-team-name"><span class="clas-team-name-text">' + displayName + '</span>' + suffixHtml + '</span>'
        +   '</div>'
        +   '<div class="clas-pts">' + team.pts + '</div>'
        +   '<div class="clas-pj">' + team.pj + '</div>'
        +   '<div class="clas-val">' + team.v + '</div>'
        +   '<div class="clas-val">' + team.e + '</div>'
        +   '<div class="clas-val">' + team.p + '</div>'
        +   '<div class="clas-val gf">' + team.gf + '</div>'
        +   '<div class="clas-val gc">' + team.gc + '</div>'
        +   '<div class="' + dgClass + '">' + (team.dg > 0 ? '+' : '') + team.dg + '</div>'
        +   '<div class="clas-val ta">' + team.ta + '</div>'
        +   '<div class="clas-val tr">' + team.tr + '</div>'
        +   '<div class="clas-mvp">' + team.mvp + '</div>'
        +   '<div class="clas-pct">' + (team.pj > 0 ? Math.round((team.v / team.pj) * 100) : 0) + '%</div>'
        + '</div>';
    });

    html += '    </div>'   // clas-table
      +   '</div>'         // clas-scroll
      + '</div>';          // clas-scroll-outer

    el.innerHTML = html;

    // Sincronizar scroll horizontal header <-> body
    var hdrScroll = document.getElementById('clas-hdr-scroll');
    var bodyScroll = document.getElementById('clas-body-scroll');
    if(hdrScroll && bodyScroll){
      bodyScroll.addEventListener('scroll', function(){ hdrScroll.scrollLeft = bodyScroll.scrollLeft; });
    }
  }

  window.buildLigaClas = buildLigaClas;
  window.collectStandings = collectStandings;
  document.addEventListener('DOMContentLoaded', buildLigaClas);

  var leagueObserverBound = false;
  function bindLeagueObserver(){
    if(leagueObserverBound || typeof MutationObserver === 'undefined') return;
    var root = document.getElementById('s-liga-cal');
    if(!root) return;
    /* Debounce 500ms + filtrar mutaciones cosméticas (is-jugar-hint,
       running, finished...). Sin esto, las cards live IA-vs-IA y el
       polling de _refreshJugarHints saturaban el thread JS y los
       cronómetros se quedaban a 0'. Fix crítico 2026-05-11. */
    var _bldDeb = null;
    var _IGN_CLS = /\b(is-jugar-hint|running|finished|is-pp-env-hint|state-playing|state-finished)\b/;
    function _bldSched(){
      if (_bldDeb) return;
      _bldDeb = setTimeout(function(){ _bldDeb = null; try { buildLigaClas(); } catch(_){} }, 500);
    }
    var observer = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++){
        var m = muts[i];
        if (m.type === 'attributes' && m.attributeName === 'class'){
          var oC = (m.oldValue || '').replace(_IGN_CLS, '').replace(/\s+/g, ' ').trim();
          var nC = ((m.target && m.target.className) || '').replace(_IGN_CLS, '').replace(/\s+/g, ' ').trim();
          if (oC === nC) continue;
        }
        _bldSched();
        return;
      }
    });
    observer.observe(root, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class'], attributeOldValue:true});
    leagueObserverBound = true;
  }
  bindLeagueObserver();
})();


/* script block 13 */

(function(){
  var SCREEN_TEAM_FALLBACK = {
    's-munich': 'Bayern Munich',
    's-arsenal': 'Arsenal',
    's-sporting': 'Sporting CP',
    's-madrid': 'Real Madrid',
    's-barca': 'FC Barcelona',
    's-atletico': 'Atlético Madrid',
    's-albacete': 'Albacete BP',
    's-villarreal': 'Villarreal CF',
    's-sevilla': 'Sevilla FC',
    's-espanyol': 'Espanyol',
    's-getafe': 'Getafe CF',
    'celta-screen': 'Celta de Vigo',
    'osasuna-screen': 'Osasuna',
    'alaves-screen': 'Deportivo Alavés',
    'girona-screen': 'Girona FC',
    'oviedo-screen': 'Real Oviedo',
    'levante-screen': 'Levante UD',
    'mallorca-screen': 'Mallorca',
    'elche-screen': 'Elche CF',
    'valencia-screen': 'Valencia CF',
    'rayo-screen': 'Rayo Vallecano',
    'athletic-screen': 'Athletic Club',
    'betis-screen': 'Real Betis',
    'sociedad-screen': 'Real Sociedad'
  };



var STAT_CLASS_MAP = {
    'gol': 'ps-gol',
    'yel': 'ps-yel',
    'red': 'ps-red',
    'mvp': 'ps-mvp',
    'cs':  'ps-cs',
    'pen-prov': 'ps-pen-prov',
    'pen-parado': 'ps-pen-parado',
    'pen-gol': 'ps-pen-gol',
    'falta-gol': 'ps-falta-gol',
    'propia': 'ps-propia',
    'pen-fallado': 'ps-pen-fallado'
  };

  var LIGA_STAT_CATEGORIES = [
    { key:'goles-total', title:'Goleadores',            icon:'⚽️', top:6 },
    { key:'cs',          title:'Portería imbatida',     icon:'🧤', top:6 },
    { key:'yel',         title:'Tarjetas amarillas',    icon:'🟨', top:6 },
    { key:'red',         title:'Tarjetas rojas',        icon:'🟥', top:6 },
    { key:'pen-prov',    title:'Penaltis provocados',   icon:'🤦‍♂️🥅', top:6 },
    { key:'pen-gol',     title:'Goles de penalti',      icon:'⚽🥅', top:6 },
    { key:'pen-fallado', title:'Penaltis fallados',     icon:'❌️🥅', top:6 },
    { key:'pen-parado',  title:'Penaltis parados',      icon:'🖐🥅', top:6 },
    { key:'falta-gol',   title:'Goles de falta',        icon:'⚽🎯', top:6 },
    { key:'propia',      title:'Autogoles',             icon:'⚽🚫', top:6 },
    { key:'mvp',         title:'MVP',                   icon:'⭐️', top:6 }
  ];

  function normalizeText(str){
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function canonicalTeamName(name){
    var key = normalizeText(name);
    return (window.TEAM_ALIASES||{})[key] || String(name || '').trim();
  }

  function ensureExtraStatSpans(){
    document.querySelectorAll('.plant-row').forEach(function(row){
      ['ps-pen-fallado'].forEach(function(cls){
        if(row.querySelector('.' + cls)) return;
        var span = document.createElement('span');
        span.className = cls;
        span.hidden = true;
        span.setAttribute('data-global', '0');
        span.setAttribute('data-liga', '0');
        span.setAttribute('data-copa', '0');
        span.setAttribute('data-ucl', '0');
        span.setAttribute('data-uecl', '0');
        span.setAttribute('data-europa', '0');
        span.setAttribute('data-super', '0');
        row.appendChild(span);
      });
    });
  }

  function getPlantillaScreens(){
    ensureExtraStatSpans();
    var out = [];
    document.querySelectorAll('.screen[id]').forEach(function(screen){
      var rows = screen.querySelectorAll('.plant-row');
      if(!rows.length) return;
      var team = SCREEN_TEAM_FALLBACK[screen.id] || '';
      if(!team){
        var h2 = screen.querySelector('.sec-hdr h2');
        if(h2) team = h2.textContent.trim();
      }
      team = canonicalTeamName(team);
      out.push({ id: screen.id, team: team, rows: rows });
    });
    return out;
  }

  function getRosterIndex(){
    var idx = {};
    getPlantillaScreens().forEach(function(screen){
      Array.prototype.forEach.call(screen.rows, function(row){
        var nameEl = row.querySelector('.plant-name');
        if(!nameEl) return;
        var key = canonicalTeamName(screen.team) + '::' + normalizeText(nameEl.textContent);
        idx[key] = row;
      });
    });
    return idx;
  }

  function ensureStatSpan(row, key){
    var cls = STAT_CLASS_MAP[key];
    if(!cls) return null;
    var span = row.querySelector('.' + cls);
    if(!span){
      span = document.createElement('span');
      span.className = cls;
      span.hidden = true;
      span.setAttribute('data-global', '0');
      span.setAttribute('data-liga', '0');
      row.appendChild(span);
    }
    return span;
  }

  function setLigaStat(row, key, amount){
    amount = Number(amount || 0);
    if(!amount) return;
    var span = ensureStatSpan(row, key);
    if(!span) return;
    var liga = Number(span.getAttribute('data-liga') || 0);
    span.setAttribute('data-liga', String(liga + amount));

    if(key === 'pen-gol' || key === 'pen-fallado'){
      var penSpan = ensureStatSpan(row, 'pen-gol');
      var tirado = Number(penSpan.getAttribute('data-tirado') || 0);
      penSpan.setAttribute('data-tirado', String(tirado + amount));
    }
    if(key === 'pen-parado'){
      var stopSpan = ensureStatSpan(row, 'pen-parado');
      var faced = Number(stopSpan.getAttribute('data-tirado') || 0);
      stopSpan.setAttribute('data-tirado', String(faced + amount));
    }
  }

  function resetLigaPlayerStats(){
    ensureExtraStatSpans();
    document.querySelectorAll('.plant-row').forEach(function(row){
      Object.keys(STAT_CLASS_MAP).forEach(function(key){
        var span = row.querySelector('.' + STAT_CLASS_MAP[key]);
        if(span) span.setAttribute('data-liga', '0');
      });
      var penGoal = row.querySelector('.ps-pen-gol');
      var penStop = row.querySelector('.ps-pen-parado');
      if(penGoal) penGoal.setAttribute('data-tirado', '0');
      if(penStop) penStop.setAttribute('data-tirado', '0');
    });
  }

  var LIGA_PLAYER_MATCH_STORE = window.LIGA_PLAYER_MATCH_STORE || {};
  window.LIGA_PLAYER_MATCH_STORE = LIGA_PLAYER_MATCH_STORE;

  function applyEventToRoster(roster, teamName, playerName, type, ico){
    teamName = canonicalTeamName(teamName);
    playerName = String(playerName || '').replace(/^\s*\d+\.?\s*/, '').trim();
    if(!teamName || !playerName) return;
    var row = roster[teamName + '::' + normalizeText(playerName)];
    if(!row) return;

    if(type === 'gol') setLigaStat(row, 'gol', 1);
    else if(type === 'falta-gol') setLigaStat(row, 'falta-gol', 1);
    else if(type === 'pen-gol') setLigaStat(row, 'pen-gol', 1);
    else if(type === 'pen-fallo') setLigaStat(row, 'pen-fallado', 1);
    else if(type === 'pen-parado') setLigaStat(row, 'pen-parado', 1);
    else if(type === 'pen-prov') setLigaStat(row, 'pen-prov', 1);
    else if(type === 'propia') setLigaStat(row, 'propia', 1);
    else if(type === 'mvp') setLigaStat(row, 'mvp', 1);
    else if(type === 'card'){
      if(ico === '🟨') setLigaStat(row, 'yel', 1);
      else if(ico === '🟥') setLigaStat(row, 'red', 1);
      else if(ico === '🟨🟥'){
        // Doble amarilla: la amarilla previa del jugador en este partido ya fue contada como yel.
        // Se cancela restando 1 yel, y se registra solo como expulsión (red).
        setLigaStat(row, 'yel', -1);
        setLigaStat(row, 'red', 1);
      }
    }
  }

  function rebuildLigaPlayerStats(){
    resetLigaPlayerStats();
    var roster = getRosterIndex();
    var processedMatches = {};

    function normalizeIcon(ico){
      return String(ico || '').replace(/️/g, '').trim();
    }

    function parseEventTypeFromIcon(ico){
      ico = normalizeIcon(ico);
      if(ico === '⚽' || ico === '⚽️') return 'gol';
      if(ico === '🟨' || ico === '🟥' || ico === '🟨🟥') return 'card';
      if(ico === '🤦🥅' || ico === '🤦‍♂🥅' || ico === '🤦‍♂️🥅') return 'pen-prov';
      if(ico === '⚽🥅') return 'pen-gol';
      if(ico === '❌🥅' || ico === '❌️🥅') return 'pen-fallo';
      if(ico === '🖐🥅') return 'pen-parado';
      if(ico === '⚽🎯') return 'falta-gol';
      if(ico === '⚽🚫') return 'propia';
      if(ico === '⭐' || ico === '⭐️') return 'mvp';
      return null;
    }

    function applyStoredMatch(matchKey, data){
      if(!data || processedMatches[matchKey]) return;
      processedMatches[matchKey] = true;
      (data.evts || []).forEach(function(ev){
        var ico = normalizeIcon(ev && ev.ico);
        var type = ev && ev.type ? ev.type : parseEventTypeFromIcon(ico);
        if(type === 'amarilla' || type === 'roja' || type === 'd-amarilla') type = 'card';
        if(type === 'pen-fallado') type = 'pen-fallo';
        if(!type) type = parseEventTypeFromIcon(ico);
        if(!type) return;

        var playerName = '';
        if(Array.isArray(ev && ev.player)) playerName = ev.player[1] || ev.player[0] || '';
        else playerName = (ev && (ev.name || ev.playerName || ev.jugador || ev.player)) || '';
        playerName = String(playerName || '').replace(/^\s*\d+\.?\s*/, '').trim();
        if(!playerName) return;

        var teamName = canonicalTeamName((ev && (ev.realTeam || ev.teamName || ev.team_label)) || '');
        if(!teamName){
          if(ev && ev.team === 'a') teamName = canonicalTeamName(data.teamA || '');
          else if(ev && ev.team === 'b') teamName = canonicalTeamName(data.teamB || '');
          else teamName = canonicalTeamName(ev && ev.team || '');
        }
        if(!teamName) return;
        applyEventToRoster(roster, teamName, playerName, type, ico);
      });

      // MVP ya viene dentro de data.evts como type:'mvp' — NO aplicar de nuevo desde mvpName/mvpTeam
      // para evitar doble conteo
    }

    Object.keys(LIGA_PLAYER_MATCH_STORE).forEach(function(matchKey){
      applyStoredMatch(matchKey, LIGA_PLAYER_MATCH_STORE[matchKey]);
    });

    document.querySelectorAll('[id^="ml-acta-list-j"]').forEach(function(list){
      var wrap = list.closest('.match-live-wrap');
      var matchKey = '';
      if(wrap && wrap.id) matchKey = wrap.id.replace(/^mlw-/, '');
      if(matchKey && processedMatches[matchKey]) return;

      var teamA = '';
      var teamB = '';
      if(matchKey){
        var aEl = document.getElementById('ml-team-a-' + matchKey);
        var bEl = document.getElementById('ml-team-b-' + matchKey);
        if(aEl) teamA = canonicalTeamName(aEl.textContent.trim());
        if(bEl) teamB = canonicalTeamName(bEl.textContent.trim());
      }

      list.querySelectorAll('.ml-evt-item').forEach(function(item){
        var icoEl = item.querySelector('.ml-evt-ico');
        var nameEl = item.querySelector('.ml-evt-name');
        var teamEl = item.querySelector('.ml-evt-team');
        if(!icoEl || !nameEl) return;

        var ico = normalizeIcon(icoEl.textContent);
        var type = parseEventTypeFromIcon(ico);
        if(!type) return;

        var playerName = String(nameEl.textContent || '')
          .replace(/^\s*\d+\.?\s*/, '')
          .replace(/\s*\(\d+⚽\)\s*$/, '')
          .trim();

        var teamName = canonicalTeamName(teamEl ? teamEl.textContent.trim() : '');
        if(!teamName){
          var keyA = teamA + '::' + normalizeText(playerName);
          var keyB = teamB + '::' + normalizeText(playerName);
          if(teamA && roster[keyA]) teamName = teamA;
          else if(teamB && roster[keyB]) teamName = teamB;
        }

        if(!teamName) return;
        applyEventToRoster(roster, teamName, playerName, type, ico);
      });
    });

    buildLigaStatsDashboard();
  }

  window.registrarLigaPlayerStats = function(matchKey, teamA, teamB, evts, mvpName, mvpTeam, compKey){
    /* Clave canónica por pareja (home|away canónicos) en vez de usar
       el matchKey tal cual viene del caller. Distintos flujos producen
       claves distintas para el MISMO partido:
         - live match:   `mk = mlw-j1-Home-Away` / 'ams-N-...'
         - IA auto-sim:  rKey(j,home,away) = 'j|Home|Away'
       Si el usuario simulaba el mismo partido dos veces por vías
       distintas, LIGA_PLAYER_MATCH_STORE acababa con dos entradas y
       las stats de jugadores se sumaban doble (p.ej. Real Sociedad
       con GF=1 en la clasificación pero 4 goles repartidos en la
       plantilla). Al usar 'canonA|canonB' la re-simulación sobreescribe
       la entrada previa, igual que ya hacía LIGA_J1_RESULTS con su
       dedup por home/away. Doble round-robin no interfiere porque cada
       jornada vuela con home/away invertidos → claves distintas. */
    var canonA = canonicalTeamName(teamA);
    var canonB = canonicalTeamName(teamB);
    /* Si el caller indica una competición distinta (p.ej. compKey='copa'
       desde Copa del Rey), añadimos un sufijo único al storeKey para
       que NO colisione con la entrada de Liga del mismo enfrentamiento.
       Ejemplo: Real Madrid vs Atlético en Liga J5 y en Copa 1ª Ronda
       → 2 entradas distintas → ambos goles cuentan en plantilla y
       dashboard. Liga sigue usando "canonA|canonB" (sin sufijo) →
       sin double-counting con la rama existente. */
    var compTag = compKey ? ('|' + compKey + '|' + (matchKey || 'm')) : '';
    var storeKey = (canonA && canonB) ? (canonA + '|' + canonB + compTag) : matchKey;
    /* Fallback de portería imbatida (2026-05-08): si el match terminó
       con clean sheet para algún equipo y NO hay evento `imbat` para
       ese lado, sintetizamos uno con el portero de mayor valor del
       equipo. Cubre los casos donde el flujo del partido humano no
       llamó a `_ensureImbatEvents` (p.ej. el user cerró el overlay
       sin elegir, o el flujo de Copa terminó por una rama distinta).
       Sin esto, el partido 0-2 ganado al rival deja a Neuer con 0
       imbat aunque haya jugado la final. */
    var _evtsList = evts || [];
    var _golA = 0, _golB = 0;
    var _hasImbA = false, _hasImbB = false;
    _evtsList.forEach(function(ev){
      if (!ev) return;
      var ty = ev.type || '';
      if (ty === 'gol' || ty === 'pen-gol' || ty === 'falta-gol') {
        if (ev.team === 'a') _golA++;
        else if (ev.team === 'b') _golB++;
      } else if (ty === 'propia') {
        /* Gol en propia: cuenta para el equipo CONTRARIO. */
        if (ev.team === 'a') _golB++;
        else if (ev.team === 'b') _golA++;
      } else if (ty === 'imbat') {
        if (ev.team === 'a') _hasImbA = true;
        else if (ev.team === 'b') _hasImbB = true;
      }
    });
    function _addSyntheticImbat(side, teamName){
      if (typeof window._getTopGk !== 'function') return;
      try {
        var gk = window._getTopGk(teamName);
        if (!gk || !gk.name) return;
        _evtsList = _evtsList.concat([{
          type:'imbat', ico:'🧤', min:90, team:side,
          num: gk.num, player: gk.name, name: gk.name
        }]);
      } catch(_){}
    }
    /* scoreA = goles del equipo A (local). Para clean sheet de B:
       _golA debe ser 0. */
    if (_golA === 0 && !_hasImbB && canonB) _addSyntheticImbat('b', canonB);
    if (_golB === 0 && !_hasImbA && canonA) _addSyntheticImbat('a', canonA);
    LIGA_PLAYER_MATCH_STORE[storeKey] = {
      teamA: canonA,
      teamB: canonB,
      evts: _evtsList.map(function(ev){
        var copy = {};
        Object.keys(ev || {}).forEach(function(k){ copy[k] = ev[k]; });
        copy.realTeam = canonicalTeamName(ev && ev.team === 'a' ? teamA : ev && ev.team === 'b' ? teamB : (ev && ev.realTeam) || '');
        return copy;
      }),
      mvpName: mvpName || '',
      mvpTeam: canonicalTeamName(mvpTeam || '')
    };
    rebuildLigaPlayerStats();
    // Also run the fixed version (block 24) for individual player stats
    if (typeof window.rebuildLigaPlayerStatsFixed === 'function') {
      window.rebuildLigaPlayerStatsFixed();
    }
    // Fase 2: sincronizar stats al storage ligaExt
    if(typeof window.syncLigaEaPlayerStats === 'function'){
      try { window.syncLigaEaPlayerStats(); } catch(_){}
    }
    /* Refrescar la tabla de Clasificación: getExtrasForTeam ahora
       calcula MVP/TA/TR desde LIGA_PLAYER_MATCH_STORE, que se acaba
       de actualizar arriba. Sin esta llamada la tabla se quedaba
       con valores viejos hasta el siguiente registrarResultadoLiga
       o navegación — el usuario percibía "tarda mucho en actualizarse". */
    if (typeof window.buildLigaClas === 'function') {
      try { window.buildLigaClas(); } catch(_){}
    }
  };

  function getLigaStatFromRow(row, key){
    function valueFor(statKey){
      var cls = STAT_CLASS_MAP[statKey];
      var statEl = cls ? row.querySelector('.' + cls) : null;
      return statEl ? Number(statEl.getAttribute('data-liga') || 0) : 0;
    }
    if(key === 'goles-total'){
      return valueFor('gol') + valueFor('pen-gol') + valueFor('falta-gol');
    }
    return valueFor(key);
  }

  /* Agrega stats de TODOS los eventos del store LIGA_PLAYER_MATCH_STORE
     directamente, sin depender del lookup en plant-rows DOM. Esto hace
     que el dashboard "Liga EA Sports · Estadísticas" no dependa de que
     el nombre/dorsal del jugador del simulador case con el de la
     plantilla HTML: cada gol/tarjeta/MVP cuenta tal cual aparece en el
     acta, que es lo que el usuario ve al abrir el partido. Para casos
     donde dos variantes del mismo jugador (p.ej. "Iago Aspas" vs
     "I. Aspas") aparecen en matches distintos, priorizamos la versión
     más larga del nombre como etiqueta final.  */
  function collectLigaPlayerStatsFromStore(){
    var store = window.LIGA_PLAYER_MATCH_STORE || {};
    var byKey = {}; // teamCanon::nameNorm → {team,name,stats}
    function _norm(s){
      return String(s||'')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'')
        .replace(/[^\w\s]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .toLowerCase();
    }
    function _ensure(team, name){
      var tc = canonicalTeamName(team);
      var nn = _norm(name);
      if(!tc || !nn) return null;
      var key = tc + '::' + nn;
      if(!byKey[key]){
        var empty = {};
        LIGA_STAT_CATEGORIES.forEach(function(cat){ empty[cat.key] = 0; });
        byKey[key] = { team: tc, name: String(name||'').trim(), stats: empty };
      } else {
        // preferir la versión del nombre más larga como etiqueta
        var cur = byKey[key].name || '';
        var cand = String(name||'').trim();
        if(cand.length > cur.length) byKey[key].name = cand;
      }
      return byKey[key];
    }
    function _incr(rec, statKey, amount){
      if(!rec || !rec.stats) return;
      rec.stats[statKey] = (rec.stats[statKey] || 0) + (amount || 1);
    }
    Object.keys(store).forEach(function(matchKey){
      var match = store[matchKey]; if(!match) return;
      var tA = match.teamA || '', tB = match.teamB || '';
      (match.evts || []).forEach(function(ev){
        if(!ev) return;
        var type = String(ev.type || '').trim().toLowerCase();
        if(!type || type === 'played' || type === 'ht' || type === 'sub' || type === 'mvp') return;
        // MVP lo metemos vía match.mvpName/mvpTeam más abajo (consistente con countEventExtras).
        var team = ev.realTeam || '';
        if(!team){
          if(ev.team === 'a') team = tA;
          else if(ev.team === 'b') team = tB;
        }
        var nameVal = '';
        if(Array.isArray(ev.player)) nameVal = String(ev.player[1]||ev.player[0]||'').trim();
        else if(typeof ev.player === 'string') nameVal = ev.player.trim();
        else nameVal = String(ev.name || ev.playerName || '').trim();
        // Normalizar player 'N. Apellido' cuando viene con número pegado: '10. Aspas'
        nameVal = nameVal.replace(/^\s*\d+\s*[\.\-]?\s*/, '').trim();
        if(!nameVal) return;
        var rec = _ensure(team, nameVal);
        if(!rec) return;
        if(type === 'gol') _incr(rec, 'goles-total');
        else if(type === 'falta-gol'){ _incr(rec, 'goles-total'); _incr(rec, 'falta-gol'); }
        else if(type === 'pen-gol'){ _incr(rec, 'goles-total'); _incr(rec, 'pen-gol'); _incr(rec, 'pen-prov'); }
        else if(type === 'pen-fallo' || type === 'pen-fallado') _incr(rec, 'pen-fallado');
        else if(type === 'pen-parado') _incr(rec, 'pen-parado');
        else if(type === 'pen-prov') _incr(rec, 'pen-prov');
        else if(type === 'propia') _incr(rec, 'propia');
        else if(type === 'amarilla' || type === 'card') _incr(rec, 'yel');
        else if(type === 'roja') _incr(rec, 'red');
        else if(type === 'd-amarilla'){ _incr(rec, 'yel'); _incr(rec, 'red'); }
        else if(type === 'imbat') _incr(rec, 'cs');
      });
      // MVP y clean-sheet implícito
      if(match.mvpName && match.mvpTeam){
        var mvpRec = _ensure(match.mvpTeam, match.mvpName);
        if(mvpRec) _incr(mvpRec, 'mvp');
      }
    });
    return Object.keys(byKey).map(function(k){ return byKey[k]; });
  }

  function collectLigaPlayerStats(){
    /* Preferimos la fuente basada en eventos (acta) — es la misma
       fuente de verdad que usa el asignador de PJ y la clasificación,
       así que si aparece en la clasificación, aparece en el dashboard.
       Si el store está vacío (primera carga sin simular aún) caemos al
       lookup clásico por plant-rows. */
    var storeStats = collectLigaPlayerStatsFromStore();
    if(storeStats.length) return storeStats;
    var players = [];
    getPlantillaScreens().forEach(function(screen){
      Array.prototype.forEach.call(screen.rows, function(row){
        var nameEl = row.querySelector('.plant-name');
        if(!nameEl) return;
        var stats = {};
        LIGA_STAT_CATEGORIES.forEach(function(cat){
          stats[cat.key] = getLigaStatFromRow(row, cat.key);
        });
        players.push({
          team: canonicalTeamName(screen.team),
          name: nameEl.textContent.trim(),
          stats: stats
        });
      });
    });
    return players;
  }

  function topPlayersByStat(players, key, limit){
    return players
      .map(function(p){
        return { name: p.name, team: p.team, value: Number(p.stats[key] || 0) };
      })
      .filter(function(p){ return p.value > 0; })
      .sort(function(a,b){
        if(b.value !== a.value) return b.value - a.value;
        if(a.team !== b.team) return a.team.localeCompare(b.team, 'es');
        return a.name.localeCompare(b.name, 'es');
      })
      .slice(0, limit);
  }

  function buildLigaStatsDashboard(){
    var root = document.getElementById('liga-stats-dashboard');
    if(!root) return;
    var players = collectLigaPlayerStats();
    var html = '';

    function escapeHtml(str){
      return String(str == null ? '' : str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
    }

    function renderRows(rows, startIndex){
      return rows.map(function(item, idx){
        var humanCls = (typeof window._humanPlayerClass === 'function')
          ? window._humanPlayerClass(item.team) : '';
        return '<div class="liga-stat-row"><div class="liga-stat-rank">' + (startIndex + idx) + '</div><div class="liga-stat-player"><div class="liga-stat-name' + humanCls + '">' + escapeHtml(item.name) + '</div><div class="liga-stat-team">' + escapeHtml(item.team) + '</div></div><div class="liga-stat-value">' + item.value + '</div></div>';
      }).join('');
    }

    LIGA_STAT_CATEGORIES.forEach(function(cat){
      var allRows = topPlayersByStat(players, cat.key, 9999);
      var top = allRows.slice(0, 6);
      var rest = allRows.slice(6);
      html += '<div class="liga-stat-card"><div class="liga-stat-head"><div class="liga-stat-ico">' + cat.icon + '</div><div class="liga-stat-title">' + cat.title + '</div></div><div class="liga-stat-body">';
      if(!allRows.length){
        html += '<div class="liga-stat-empty">Sin datos todavía</div>';
      } else {
        html += renderRows(top, 1);
        if(rest.length){
          html += '<details class="liga-stat-more"><summary>Ver todos (' + allRows.length + ')</summary><div class="liga-stat-more-list">' + renderRows(rest, 7) + '</div></details>';
        }
      }
      html += '</div></div>';
    });
    root.innerHTML = html;
  }

  window.buildLigaStatsDashboard = buildLigaStatsDashboard;
  document.addEventListener('DOMContentLoaded', function(){
    ensureExtraStatSpans();
    buildLigaStatsDashboard();
  });

  var ligaStatsObserverBound = false;
  function bindLigaStatsObserver(){
    if(ligaStatsObserverBound || typeof MutationObserver === 'undefined') return;
    var targets = [document.getElementById('s-liga-cal')].concat(
      getPlantillaScreens().map(function(x){ return document.getElementById(x.id); })
    ).filter(Boolean);

    if(!targets.length) return;

    /* Debounce 500ms + filtrar mutaciones cosméticas. Mismo patrón
       que bindLeagueObserver. Fix crítico 2026-05-11. */
    var _stDeb = null;
    var _IGN2 = /\b(is-jugar-hint|running|finished|is-pp-env-hint|state-playing|state-finished)\b/;
    function _stSched(){
      if (_stDeb) return;
      _stDeb = setTimeout(function(){ _stDeb = null; try { buildLigaStatsDashboard(); } catch(_){} }, 500);
    }
    var observer = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++){
        var m = muts[i];
        if (m.type === 'attributes' && m.attributeName === 'class'){
          var oC = (m.oldValue || '').replace(_IGN2, '').replace(/\s+/g, ' ').trim();
          var nC = ((m.target && m.target.className) || '').replace(_IGN2, '').replace(/\s+/g, ' ').trim();
          if (oC === nC) continue;
        }
        _stSched();
        return;
      }
    });

    targets.forEach(function(t){
      observer.observe(t, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','data-state','data-finished'], attributeOldValue:true });
    });
    ligaStatsObserverBound = true;
  }

  bindLigaStatsObserver();
})();


/* script block 14 */
function go(id) { var _prevActive = document.querySelector('.screen.active'); var _isSame = _prevActive && _prevActive.id === id; document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); var el = document.getElementById(id); if (el) { el.classList.add('active'); /* No resetear scroll cuando se re-navega a la MISMA pantalla (p.ej. openIAJornada refrescándose mientras el usuario mira un partido en vivo) ni cuando hay un flag de refresh-in-place activo. Eso evita que la vista salte arriba cada vez que un partido IA termina y dispara buildIAresults → openIAJornada. */ if (!_isSame && !window._iaRefreshInPlace) window.scrollTo(0,0); } if (id === 's-munich' && typeof athCheckSeasonRewards === 'function') { athCheckSeasonRewards(); } } function entTog(id) { var body = document.getElementById(id); var arr = document.getElementById(id + '-arr'); if (!body) return; var isOpen = body.classList.contains('open'); body.classList.toggle('open'); if (arr) arr.classList.toggle('open', !isOpen); } function subTog(id) { var body = document.getElementById(id); var arr = document.getElementById(id + '-arr'); if (!body) return; body.classList.toggle('open'); if (arr) arr.classList.toggle('open'); } function derbyTog(id) { var body = document.getElementById(id); var arr = document.getElementById(id + '-arr'); var btn = document.getElementById(id + '-btn'); if (!body) return; body.classList.toggle('open'); if (arr) arr.classList.toggle('open'); if (btn) btn.classList.toggle('open'); } var athPrevSuperado = false; var athPrevDone = 0; var athSeasonRewardQueue = []; function athIsSeasonObjective(txt) { var t = (txt || '').toLowerCase(); return /liga|copa|champions|mundial|supercopa|gran final europea|título|titulo|balón de oro|balon de oro/.test(t); } function athQueueSeasonObjective(name) { if (!name) return; if (athSeasonRewardQueue.indexOf(name) === -1) athSeasonRewardQueue.push(name); } function athCheckSeasonRewards() { if (!athSeasonRewardQueue.length) return; var pending = athSeasonRewardQueue.slice(); athSeasonRewardQueue = []; setTimeout(function(){ athCelebrarObjetivo('MEGA CELEBRACIÓN DE TEMPORADA · ' + pending.length + ' OBJETIVOS', 5600, true); }, 220); } function athCelebrarObjetivo(nombre, duracion, mega) { var overlay = document.getElementById('celebracion-overlay'); var txt = document.getElementById('celebracion-txt'); var detalle = document.getElementById('celebracion-detalle'); if (txt) { txt.textContent = '¡OBJETIVO CUMPLIDO!'; txt.classList.remove('is-mega'); if (mega) txt.classList.add('is-mega'); } if (detalle) { detalle.textContent = nombre || 'GLORIA Y PROGRESO BÁVARO'; detalle.style.display = 'block'; } if (overlay) { overlay.classList.add('celebracion-bayern'); } var moneyIcon = document.getElementById('ath-money-icon'); var rankIcon = document.getElementById('ath-rank-icon'); var rankVal = parseFloat((document.getElementById('ath-pts-val') || {}).textContent || '0') || 0; if (rankIcon) { rankIcon.textContent = rankVal >= 9.10 ? '👑' : '💼'; rankIcon.classList.remove('pulse-rank'); void rankIcon.offsetWidth; rankIcon.classList.add('pulse-rank'); } if (moneyIcon) { moneyIcon.classList.remove('pulse-cash'); void moneyIcon.offsetWidth; moneyIcon.classList.add('pulse-cash'); } var coinRain = document.getElementById('celebracion-coin-rain'); if (coinRain) { coinRain.innerHTML = ''; for (var i = 0; i < 14; i++) { var c = document.createElement('span'); c.className = 'coin'; c.style.left = (6 + Math.random() * 88) + '%'; c.style.animationDelay = (Math.random() * 0.6).toFixed(2) + 's'; c.textContent = '🪙'; coinRain.appendChild(c); } } if (typeof lanzarFuegos === 'function') { window._mmTeamColors = ['#dc052d','#ffffff','#f0c040','#dc052d']; window._mmUseTeamColors = true; lanzarFuegos(duracion || 5000); setTimeout(function(){ window._mmUseTeamColors = false; }, (duracion || 5000) + 500); } setTimeout(function(){ if (overlay) overlay.classList.remove('celebracion-bayern'); if (moneyIcon) moneyIcon.classList.remove('pulse-cash'); if (rankIcon) rankIcon.classList.remove('pulse-rank'); }, (duracion || 5000) + 1400); } function athObjCount() { var items = document.querySelectorAll('#ath-obj-club .obj-item'); var total = items.length; var done = 0; var newlyDone = []; items.forEach(function(lbl) { var cb = lbl.querySelector('input[type=checkbox]'); if (cb && cb.checked) { done++; if (!lbl.classList.contains('done')) { newlyDone.push(lbl.textContent.replace(/\s+/g, ' ').trim()); } lbl.classList.add('done'); } else { lbl.classList.remove('done'); } }); var countEl = document.getElementById('ath-obj-count'); if (countEl) countEl.textContent = done + ' / ' + total; var PTS_POR_OBJ = 0.40; var MONEY_POR_OBJ = 60; var MAX_PTS = 9.10; var MAX_MONEY = 1300; var pts = parseFloat((done * PTS_POR_OBJ).toFixed(2)); var money = done * MONEY_POR_OBJ; var pctPts = Math.min(100, (pts / MAX_PTS) * 100); var pctMoney = Math.min(100, (money / MAX_MONEY) * 100); var superadoPts = pts >= MAX_PTS; var superadoMoney = money >= MAX_MONEY; var superadoAmbos = superadoPts && superadoMoney; var ptsEl = document.getElementById('ath-pts-val'); var moneyEl = document.getElementById('ath-money-val'); if (ptsEl) { ptsEl.textContent = pts.toFixed(2); ptsEl.classList.remove('pulse'); void ptsEl.offsetWidth; ptsEl.classList.add('pulse'); ptsEl.classList.toggle('superado', superadoPts); } if (moneyEl) { moneyEl.textContent = money; moneyEl.classList.remove('pulse'); void moneyEl.offsetWidth; moneyEl.classList.add('pulse'); moneyEl.classList.toggle('superado', superadoMoney); } var rankIcon = document.getElementById('ath-rank-icon'); if (rankIcon) rankIcon.textContent = superadoPts ? '👑' : '💼'; var tPts = document.getElementById('ath-pts-target'); var tMoney = document.getElementById('ath-money-target'); if (tPts) tPts.classList.toggle('superado', superadoPts); if (tMoney) tMoney.classList.toggle('superado', superadoMoney); var barPts = document.getElementById('ath-bar-pts'); var barMoney = document.getElementById('ath-bar-money'); if (barPts) { barPts.style.width = pctPts + '%'; barPts.classList.toggle('superado', superadoPts); } if (barMoney) { barMoney.style.width = pctMoney + '%'; barMoney.classList.toggle('superado', superadoMoney); } if (done > athPrevDone && newlyDone.length) { newlyDone.forEach(function(name, i){ if (athIsSeasonObjective(name)) { athQueueSeasonObjective(name); } else { setTimeout(function(){ athCelebrarObjetivo(name, 5000, false); }, i * 280); } }); } athPrevDone = done; if (superadoAmbos) { if (!athPrevSuperado) { athPrevSuperado = true; setTimeout(function() { athCelebrarObjetivo('RANGO LEYENDA ALCANZADO', 5200, true); }, 280); } } else { athPrevSuperado = false; } } var athPlantComp = 'global'; function athSetComp(comp) { athPlantComp = comp; document.querySelectorAll('.plant-filter-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.comp === comp); }); document.querySelectorAll('.plant-row').forEach(function(row) { var tipos = row.classList.contains('por') ? ['cs','yel','red','mvp','poder','pen-parado','pen-prov','pen-gol','falta-gol','propia'] : ['gol','yel','red','mvp','poder','pen-gol','pen-prov','pen-parado','falta-gol','propia']; var cols = row.querySelectorAll('.plant-stat'); tipos.forEach(function(tipo, i) { var el = row.querySelector('.ps-' + tipo); if (!el || !cols[i]) return; var v = parseInt(el.getAttribute('data-' + comp) || el.getAttribute('data-global') || '0'); cols[i].textContent = v; cols[i].className = 'plant-stat' + (v > 0 ? (' ' + tipo) : ' zero'); if (el) el.setAttribute('data-' + comp, v); }); var anyActive = Array.from(row.querySelectorAll('.plant-stat')).some(function(c){ return !c.classList.contains('zero'); }); row.classList.toggle('has-stat', anyActive); }); } function tog(id) { var el = document.getElementById(id); if (!el) return; if (id === 'comp-box') { var isOpen = el.style.display !== 'none' && el.style.display !== ''; el.style.display = isOpen ? 'none' : 'block'; var arr = document.getElementById('comp-arr'); if (arr) arr.style.transform = isOpen ? '' : 'rotate(180deg)'; } else { el.classList.toggle('open'); } }

/* script block 15 */

var atmPrevSuperado = false;
function atmSetComp(comp) {
  document.querySelectorAll('#s-atletico .plant-row').forEach(function(row){
    var tipos = row.classList.contains('por') ? ['cs','yel','red','mvp','poder','pen-parado','pen-prov','pen-gol','falta-gol','propia'] : ['gol','yel','red','mvp','poder','pen-gol','pen-prov','pen-parado','falta-gol','propia'];
    tipos.forEach(function(tipo){
      var el = row.querySelector('.ps-'+tipo);
      if(!el) return;
      var col = el.closest('.plant-stat');
      if(!col) return;
      var v = parseInt(el.getAttribute('data-'+comp)||el.getAttribute('data-global')||'0');
      col.textContent = (tipo === 'pen-parado' || tipo === 'pen-gol') ? v+'/'+parseInt(el.getAttribute('data-tirado')||'0') : v;
      col.className = 'plant-stat'+(v>0?(' '+tipo):' zero');
    });
  });
}
var atmPlantComp = 'global';


/* script block 16 */
var fwCanvas = document.getElementById('fireworks-canvas'); var fwCtx = fwCanvas ? fwCanvas.getContext('2d') : null; var fwParticles = []; var fwRunning = false; var fwTimer = null; function fwResize() { if (!fwCanvas) return; fwCanvas.width = window.innerWidth; fwCanvas.height = window.innerHeight; } window.addEventListener('resize', fwResize); function fwCreateBurst(x, y) { var colors = (window._mmUseTeamColors && window._mmTeamColors) ? window._mmTeamColors : ['#f0c040','#4fc86a','#ff6060','#60b0ff','#ff80ff','#ffffff','#ffaa20']; for (var i = 0; i < 60; i++) { var angle = (Math.PI * 2 / 60) * i + Math.random() * 0.3; var speed = 2 + Math.random() * 5; fwParticles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, alpha: 1, size: 2 + Math.random() * 3, color: colors[Math.floor(Math.random() * colors.length)], decay: 0.012 + Math.random() * 0.012 }); } } function fwLoop() { if (!fwRunning || !fwCtx) return; fwCtx.clearRect(0, 0, fwCanvas.width, fwCanvas.height); fwParticles = fwParticles.filter(function(p) { return p.alpha > 0.02; }); fwParticles.forEach(function(p) { p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.99; p.alpha -= p.decay; fwCtx.save(); fwCtx.globalAlpha = Math.max(0, p.alpha); fwCtx.fillStyle = p.color; fwCtx.shadowBlur = 6; fwCtx.shadowColor = p.color; fwCtx.beginPath(); fwCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); fwCtx.fill(); fwCtx.restore(); }); requestAnimationFrame(fwLoop); } var fwBurstInterval = null; function lanzarFuegos(duracion) { if (!fwCanvas || !fwCtx) return; fwResize(); fwCanvas.style.display = 'block'; var overlay = document.getElementById('celebracion-overlay'); if (overlay) { overlay.style.display = 'flex'; } fwRunning = true; fwParticles = []; fwLoop(); var w = fwCanvas.width; var h = fwCanvas.height; fwBurstInterval = setInterval(function() { var x = 0.15 * w + Math.random() * 0.7 * w; var y = 0.1 * h + Math.random() * 0.6 * h; fwCreateBurst(x, y); }, 220); setTimeout(function() { clearInterval(fwBurstInterval); fwRunning = false; setTimeout(function() { fwCanvas.style.display = 'none'; if (overlay) overlay.style.display = 'none'; }, 1200); }, duracion || 3000); }
function triggerShootingBall(gf, team) {
  var ball = gf.querySelector('.ml-shooting-ball');
  if (!ball) return;
  // Direction: team 'a' = left side → ball goes LEFT (right-to-left)
  // team 'b' = right side → ball goes RIGHT (left-to-right, default)
  ball.classList.remove('shoot','shoot-left','shoot-right');
  ball.style.animation = 'none';
  void ball.offsetWidth;
  var goLeft = (team === 'a');
  ball.style.animation = '';
  if (goLeft) {
    ball.style.cssText = 'position:absolute;font-size:28px;opacity:0;filter:drop-shadow(0 0 8px rgba(255,220,50,0.9)) drop-shadow(0 0 20px rgba(255,180,0,0.7));pointer-events:none;animation:shootBallLeft 2.8s cubic-bezier(.18,.7,.42,.98) forwards;right:-80px;left:auto;top:-40%;';
  } else {
    ball.style.cssText = 'position:absolute;font-size:28px;opacity:0;filter:drop-shadow(0 0 8px rgba(255,220,50,0.9)) drop-shadow(0 0 20px rgba(255,180,0,0.7));pointer-events:none;animation:shootBallRight 2.8s cubic-bezier(.18,.7,.42,.98) forwards;left:-80px;top:110%;';
  }
  setTimeout(function(){
    ball.style.cssText = 'position:absolute;font-size:28px;opacity:0;filter:drop-shadow(0 0 8px rgba(255,220,50,0.9)) drop-shadow(0 0 20px rgba(255,180,0,0.7));pointer-events:none;';
  }, 3100);
}

/* script block 17 */
/* ── Guard global contra scroll-to-top mientras el usuario está
   viendo simulaciones IA vs IA ──────────────────────────────────
   Hay múltiples rutas (overlays post-partido, re-renders, animaciones)
   que llaman window.scrollTo(0,0) y mandan la vista al top mientras
   el usuario intenta seguir un partido en la pantalla
   #s-liga-ia-jornada. Parchamos window.scrollTo para ignorar esos
   saltos cuando esa pantalla está activa; si otra pantalla necesita
   scroll al top seguirá funcionando normalmente. */
(function(){
  var _origScrollTo = window.scrollTo.bind(window);
  window.scrollTo = function(){
    try {
      var iaScr = document.getElementById('s-liga-ia-jornada');
      var active = iaScr && iaScr.classList.contains('active');
      if (active) {
        /* scrollTo(0, 0) o scrollTo({top:0, ...}) → ignorar. */
        var x = arguments[0], y = arguments[1];
        if (typeof x === 'object' && x) { y = x.top; }
        if ((y === 0 || y === '0') && !window._iaAllowScrollTop) return;
      }
    } catch(_){}
    return _origScrollTo.apply(window, arguments);
  };
})();

window.addEventListener('scroll',function(){ var b=document.getElementById('goto-top'); if(window.scrollY>300)b.classList.add('show'); else b.classList.remove('show'); }); var _origGo=window.go; window.go=function(id){ if(_origGo)_origGo(id); else{document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');}); var el=document.getElementById(id);if(el)el.classList.add('active');} if(id==='s-liga-clas' && typeof window.buildLigaClas==='function'){ window.buildLigaClas(); } if(id==='s-liga-stats' && typeof window.buildLigaStatsDashboard==='function'){ window.buildLigaStatsDashboard(); } };

/* script block 18 */
function showChampionsIntro() { var overlay = document.getElementById('ucl-intro'); if (!overlay) return; overlay.classList.add('show'); setTimeout(function(){ overlay.classList.remove('show'); }, 1300); } var _origGoChamp = window.go; window.go = function(id) { if (id === 's-champions') { showChampionsIntro(); } if (_origGoChamp) _origGoChamp(id); else { document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');}); var el = document.getElementById(id); if(el) el.classList.add('active'); } };

/* script block 19 */
var _compSoundMap = { 's-champions': { snd:'snd-ucl', flash:'flash-ucl' }, 's-superliga': { snd:'snd-kdb', flash:'flash-kdb' } }; var _lastCompScreen = null; function playCompSound(targetId) { var cfg = _compSoundMap[targetId]; if (!cfg) return; var snd = document.getElementById(cfg.snd); if (snd) { snd.currentTime = 0; snd.play().catch(function(){}); } var fl = document.getElementById('comp-flash'); if (fl) { fl.className = ''; fl.style.display = 'block'; fl.offsetWidth; fl.className = cfg.flash; setTimeout(function(){ fl.style.display='none'; fl.className=''; }, 950); } } function goWithSound(id, sndKey) { var fromId = _lastCompScreen; _lastCompScreen = id; if (fromId !== id) { var cfg = _compSoundMap[id]; if (cfg) playCompSound(id); } go(id); } var _prevGoFn = window.go; window.go = function(id) { var prev = _lastCompScreen; if (_compSoundMap[id]) { if (prev !== id) { playCompSound(id); } } _lastCompScreen = id; if (_prevGoFn) _prevGoFn(id); else { document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');}); var el=document.getElementById(id); if(el)el.classList.add('active'); } };

/* script block 20 */

/* Bloque LIGA_TEAMS_EQ eliminado: era el populator del grid
   #equipos-grid (overlay del antiguo Team Manager del Panel Admin).
   El overlay y la card del Panel Admin se borraron porque eran
   duplicado de LaLiga · Clasificación → click en equipo, que ya abre
   la plantilla EDITABLE y refleja la simulación. */


/* script block 21 */

(function(){

  /* ── PROBABILIDADES CANÓNICAS ──────────────────────────────────────
     Estas son las únicas probabilidades válidas para TODOS los
     partidos IA vs IA de CUALQUIER competición.
     NUNCA cambiar estos valores sin actualizar este bloque único.

     🟥  1 roja directa          → 15% de los partidos
     🟨🟥 Doble amarilla          → 10% (jugador con amarilla previa)
     🟥🟥 2+ rojas directas       →  5% de los partidos
     🤦  Penalti provocado        → 30% de los partidos
         └ 🟨 al que provoca      → 65% de esas veces
         └ 🟥 al que provoca      → 10% de esas veces
         └ ⚽🥅 Gol del penalti     → 70% de los penaltis tirados
         └ 🖐🥅 Parado por portero  → 20% de los penaltis fallados
         └ ⚽❌ Fallado             → 10% de los penaltis fallados
     ⚽🎯  Gol de falta             →  8% de los partidos
     ⚽🚫  Autogol                  →  8% de los partidos

     ── PUNTUACIÓN MVP ──────────────────────────────────────────────
     ⚽  Gol normal        → 3 pts
     ⚽🎯  Gol de falta      → 4 pts
     ⚽🥅  Penalti gol       → 2 pts
     🖐🥅  Penalti parado    → 3 pts
     ⚽🚫  Autogol           → -1 pt (penaliza al que lo mete)
     🏆  Gol decisivo      → +2 pts extra
     Hat-trick o más: se muestra en acta → Mbappé (3⚽)
     Sin goles/paradas: MVP aleatorio de campo del equipo ganador.
  ────────────────────────────────────────────────────────────────── */

  window.mlSimEngine = function(cfg) {
    var TEAM_A  = (cfg.teamA || '').trim();
    var TEAM_B  = (cfg.teamB || '').trim();
    var sqA     = cfg.sqA;
    var sqB     = cfg.sqB;
    var matchKey= cfg.matchKey;
    var btn     = document.getElementById(cfg.btnId);
    var list    = document.getElementById(cfg.listId);

    if (!btn || !list) return;
    btn.textContent = "0'"; btn.className = 'ml-timer running';

    // ── Guardia null: si sqFromRegistry no encuentra el equipo ────────
    if (!sqA || !sqA.length) {
      btn.textContent = '⚠️ ERROR'; btn.className = 'ml-timer';
      var errDiv = document.createElement('div'); errDiv.className = 'ml-ht';
      errDiv.textContent = '⚠️ Plantilla no encontrada: ' + TEAM_A;
      list.appendChild(errDiv);
      return;
    }
    if (!sqB || !sqB.length) {
      btn.textContent = '⚠️ ERROR'; btn.className = 'ml-timer';
      var errDiv2 = document.createElement('div'); errDiv2.className = 'ml-ht';
      errDiv2.textContent = '⚠️ Plantilla no encontrada: ' + TEAM_B;
      list.appendChild(errDiv2);
      return;
    }

    // ── CONVOCATORIA 18: split titulares / banquillo ─────────────────
    // sqFromRegistry ya devuelve p[4]='titular'|'suplente'
    var activeA = sqA.filter(function(p){ return !p[4]||p[4]==='titular'; });
    var benA    = sqA.filter(function(p){ return p[4]==='suplente'; });
    var activeB = sqB.filter(function(p){ return !p[4]||p[4]==='titular'; });
    var benB    = sqB.filter(function(p){ return p[4]==='suplente'; });
    if(!activeA.length) activeA = sqA.slice();
    if(!activeB.length) activeB = sqB.slice();
    // Índices para sustituciones (hasta 4 por equipo desde min 46)
    var subIdxA=0, subIdxB=0;
    var subMinsA=(function(n){var m=[];for(var i=0;i<n;i++)m.push(46+Math.floor(Math.random()*44));return m.sort(function(a,b){return a-b;});})(Math.min(4,benA.length));
    var subMinsB=(function(n){var m=[];for(var i=0;i<n;i++)m.push(46+Math.floor(Math.random()*44));return m.sort(function(a,b){return a-b;});})(Math.min(4,benB.length));
    function applySubsUpTo(min){
      while(subIdxA<subMinsA.length&&subMinsA[subIdxA]<=min){
        var outfA=activeA.filter(function(p){return p[2]!=='P';});
        if(outfA.length&&subIdxA<benA.length){
          var wA=outfA.reduce(function(a,b){return(a[3]||70)<(b[3]||70)?a:b;});
          var iA=activeA.indexOf(wA); if(iA>=0) activeA.splice(iA,1);
          activeA.push(benA[subIdxA]);
        }
        subIdxA++;
      }
      while(subIdxB<subMinsB.length&&subMinsB[subIdxB]<=min){
        var outfB=activeB.filter(function(p){return p[2]!=='P';});
        if(outfB.length&&subIdxB<benB.length){
          var wB=outfB.reduce(function(a,b){return(a[3]||70)<(b[3]||70)?a:b;});
          var iB=activeB.indexOf(wB); if(iB>=0) activeB.splice(iB,1);
          activeB.push(benB[subIdxB]);
        }
        subIdxB++;
      }
    }

    // ── helpers ──────────────────────────────────────────────────────
    // ── PODER BASADO EN RATINGS REALES ─────────────────────────────
    var _teamAliases = window.TEAM_ALIASES || {};
    var _resolvedA = _teamAliases[TEAM_A.toLowerCase()] || TEAM_A;
    var _resolvedB = _teamAliases[TEAM_B.toLowerCase()] || TEAM_B;
    /* CLAUDE.md: rating = SUMA del poder de los titulares de la
       plantilla real. Preferimos _sumTitularsPower (expuesto desde
       misc_body_2.html) antes que TEAM_RATINGS hardcodeado. Así la
       plantilla editada por el admin decide el resultado en este
       camino (usado por partidos humano-vs-IA y amistosos). */
    function _ratingFromSquad(name){
      if (typeof window._sumTitularsPower !== 'function') return -1;
      try { var v = window._sumTitularsPower(name); return v; } catch(_){ return -1; }
    }
    var rA = _ratingFromSquad(_resolvedA);
    if (rA < 0) rA = _ratingFromSquad(TEAM_A);
    if (rA < 0) rA = window.TEAM_RATINGS ? (window.TEAM_RATINGS[_resolvedA] || window.TEAM_RATINGS[TEAM_A] || 76) : 76;
    var rB = _ratingFromSquad(_resolvedB);
    if (rB < 0) rB = _ratingFromSquad(TEAM_B);
    if (rB < 0) rB = window.TEAM_RATINGS ? (window.TEAM_RATINGS[_resolvedB] || window.TEAM_RATINGS[TEAM_B] || 76) : 76;
    // Último fallback: media de la plantilla si no hay rating ninguno
    if (!rA || rA < 1) {
      var sumA=0,cntA=0; sqA.forEach(function(p){if(p[3]&&p[2]!=='P'){sumA+=p[3];cntA++;}});
      if(cntA>0) rA=Math.round(sumA/cntA);
    }
    if (!rB || rB < 1) {
      var sumB=0,cntB=0; sqB.forEach(function(p){if(p[3]&&p[2]!=='P'){sumB+=p[3];cntB++;}});
      if(cntB>0) rB=Math.round(sumB/cntB);
    }
    /* Bonus de Capitán (C): +5% al valor del equipo — modificador
       invisible obligatorio (CLAUDE.md). Aplica a cualquier partido
       (Liga, Copa, Europa, amistoso). */
    var _capBonus = (typeof window._captainBonus === 'function') ? window._captainBonus : function(){ return 1.0; };
    rA = rA * _capBonus(_resolvedA);
    rB = rB * _capBonus(_resolvedB);
    // probA = probabilidad de que marque equipo A en cada evento de gol
    // ── VENTAJA LOCAL: equipo A es siempre el local (+10% sobre su poder) ──
    var _baseA = (rA * 1.10) / ((rA * 1.10) + rB);
    var probA = Math.min(0.82, _baseA);
    function rndSq(sq){
      var hasW=sq.some(function(p){return p[3]!==undefined;});
      if(!hasW) return sq[Math.floor(Math.random()*sq.length)];
      var tot=sq.reduce(function(s,p){return s+(p[3]||30);},0);
      var r=Math.random()*tot; var c=0;
      for(var wi=0;wi<sq.length;wi++){c+=(sq[wi][3]||30);if(r<c)return sq[wi];}
      return sq[sq.length-1];
    }
    // Usa activeA/activeB (jugadores en campo en ese momento)
    function rndActive(team){return team==='a'?activeA:activeB;}
    // Peso de gol por posición (basado en estadísticas LaLiga)
    function _posGoalWeight(pos, poder) {
      var base;
      if (pos === 'P') base = 0.001;       // Portero: 0.1%
      else if (pos === 'D') base = 0.075;   // Defensa: 5-10% → media 7.5%
      else if (pos === 'M') base = 0.175;   // Medio: 15-20% → media 17.5%
      else base = 0.70;                      // Delantero: 65-75% → media 70%
      // Boost por poder del jugador (normalizado: poder 70=base, 90=+15%)
      var poderBoost = ((poder || 70) - 70) / 20 * 0.15;
      return Math.max(0.001, base + poderBoost);
    }
    function rndSqNonGK(sq, atMin){
      var team=sq===sqA?'a':(sq===sqB?'b':null);
      var active=sq===sqA?activeA:(sq===sqB?activeB:sq);
      if(!active||!active.length) return ['0','Jugador','M',70];
      var f=active.filter(function(p){
        if(p[2]==='P') return false;
        if(team!==null && atMin!==undefined && isExpelledBefore(team,p[1],atMin)) return false;
        return true;
      });
      if(!f.length)f=active.filter(function(p){
        if(team!==null && atMin!==undefined && isExpelledBefore(team,p[1],atMin)) return false;
        return true;
      });
      if(!f.length)f=active.filter(function(p){return p[2]!=='P';});
      if(!f.length)f=active;
      // Usar peso combinado: poder × peso_posición
      var tot=f.reduce(function(s,p){
        return s + (p[3]||70) * _posGoalWeight(p[2], p[3]);
      },0);
      if(!tot)return f[Math.floor(Math.random()*f.length)];
      var r=Math.random()*tot;var c=0;
      for(var wi=0;wi<f.length;wi++){
        c+=(f[wi][3]||70)*_posGoalWeight(f[wi][2],f[wi][3]);
        if(r<c)return f[wi];
      }
      return f[f.length-1];
    }
    function rndGK(sq){
      var active=sq===sqA?activeA:(sq===sqB?activeB:sq);
      if(!active||!active.length) return ['1','Portero','P',70];
      var g=active.filter(function(p){return p[2]==='P';});
      return g.length?g[0]:rndSq(active);
    }
    function rndTeam(){return Math.random()<probA?'a':'b';}
    var extraA = Math.floor(Math.random()*4)+1;
    var extraB = Math.floor(Math.random()*8)+1;
    var ht45   = 45+extraA;
    var ft90   = 90+extraB;
    function rndMin(){return Math.floor(Math.random()*ft90)+1;}
    function rndMinAfter(m){var r=m+Math.floor(Math.random()*2)+1;return r>ft90?ft90:r;}

    var sa=0, sb=0, evts=[];
    var yellowLog={a:[],b:[]};
    var expelledLog={a:{},b:{}}; // { playerName -> expulsionMinute }
    function isExpelledBefore(team, name, atMin) {
      var m = expelledLog[team][name];
      return m !== undefined && m <= atMin;
    }
    var usedYellow=[];
    var redCardTeam=null, redCardMin=999;

    // ── AMARILLAS SIMPLES (1-4) ───────────────────────────────────────
    var numYellow = Math.floor(Math.random()*4)+1;
    for(var j=0;j<numYellow;j++){
      var ct=rndTeam(); var csq=ct==='a'?sqA:sqB;
      applySubsUpTo(rndMin()); // actualizar activos antes de elegir jugador
      var cp=rndSqNonGK(csq);
      var key=ct+cp[1];
      if(usedYellow.indexOf(key)!==-1)continue;
      usedYellow.push(key);
      yellowLog[ct].push(cp[1]);
      evts.push({min:rndMin(),ico:'🟨',team:ct,player:cp,type:'card'});
    }

    // ── EXPULSIONES (dado único, mutuamente excluyentes) ─────────────
    // 2% → 2+ rojas | 5% → 1 roja directa | 5% → doble amarilla | 88% → sin expulsión
    var cardRoll = Math.random();
    if(cardRoll < 0.02){
      // 2+ rojas directas
      var rt=rndTeam(); var rsq=rt==='a'?sqA:sqB; var rp=rndSqNonGK(rsq);
      redCardMin=rndMin(); redCardTeam=rt;
      evts.push({min:redCardMin,ico:'🟥',team:rt,player:rp,type:'card'});
      expelledLog[rt][rp[1]]=redCardMin;
      var rt2=rndTeam(); var rsq2=rt2==='a'?sqA:sqB; var rp2=rndSqNonGK(rsq2);
      var rt2Min=rndMin();
      if(expelledLog[rt2][rp2[1]]===undefined){
        evts.push({min:rt2Min,ico:'🟥',team:rt2,player:rp2,type:'card'});
        expelledLog[rt2][rp2[1]]=rt2Min;
      }
    } else if(cardRoll < 0.07){
      // 1 roja directa (5%)
      var rt=rndTeam(); var rsq=rt==='a'?sqA:sqB; var rp=rndSqNonGK(rsq);
      redCardMin=rndMin(); redCardTeam=rt;
      evts.push({min:redCardMin,ico:'🟥',team:rt,player:rp,type:'card'});
      expelledLog[rt][rp[1]]=redCardMin;
    } else if(cardRoll < 0.12){
      // Doble amarilla (5%) — el jugador DEBE tener amarilla previa
      var daTeam=null, daPlayer=null;
      var teams2=['a','b'];
      for(var ti=0;ti<2;ti++){if(yellowLog[teams2[ti]].length>0){daTeam=teams2[ti];break;}}
      if(!daTeam) daTeam=rndTeam();
      var dasq=daTeam==='a'?sqA:sqB;
      if(yellowLog[daTeam].length>0){
        var ynm=yellowLog[daTeam][Math.floor(Math.random()*yellowLog[daTeam].length)];
        daPlayer=dasq.find(function(p){return p[1]===ynm;})||rndSqNonGK(dasq);
      } else {
        daPlayer=rndSqNonGK(dasq);
        if(daPlayer){
          // Generar la 🟨 en un minuto temprano, la 🟨🟥 vendrá después
          var firstYellowMin=1+Math.floor(Math.random()*44); // min 1-44
          yellowLog[daTeam].push(daPlayer[1]);
          evts.push({min:firstYellowMin,ico:'🟨',team:daTeam,player:daPlayer,type:'card'});
        }
      }
      if(daPlayer){
        // Garantizar que 🟨🟥 va DESPUÉS de la 🟨 existente
        // Buscar el minuto de la amarilla previa de este jugador
        var prevYellowEvt=evts.find(function(e){return e.type==='card'&&e.ico==='🟨'&&e.team===daTeam&&e.player&&e.player[1]===daPlayer[1];});
        var daMinStart=prevYellowEvt?prevYellowEvt.min+1:1;
        var daMin2=daMinStart+Math.floor(Math.random()*(90-daMinStart));
        if(daMin2>90)daMin2=90;
        evts.push({min:daMin2,ico:'🟨🟥',team:daTeam,player:daPlayer,type:'card'});
        yellowLog[daTeam].splice(yellowLog[daTeam].indexOf(daPlayer[1]),1);
        expelledLog[daTeam][daPlayer[1]]=daMin2;
        redCardTeam=daTeam; redCardMin=daMin2;
      }
    }
    // 70% restante: sin expulsiones

    // ── PENALTI (30% de los partidos) ─────────────────────────────────
    if(Math.random()<0.30){
      var foul_t  = rndTeam();               // equipo que COMETE la falta
      var prov_t  = foul_t==='a'?'b':'a';   // equipo que RECIBE y TIRA
      var foul_sq = foul_t==='a'?sqA:sqB;
      var prov_sq = prov_t==='a'?sqA:sqB;
      var pen_min = rndMin();
      var foul_p  = rndSqNonGK(foul_sq, pen_min);
      var kick_p  = rndSqNonGK(prov_sq, pen_min);
      // Tarjeta al que comete la falta
      var r2=Math.random();
      if(r2<0.65){
        if(expelledLog[foul_t][foul_p[1]]===undefined){
          if(yellowLog[foul_t].indexOf(foul_p[1])!==-1){
            evts.push({min:pen_min,ico:'🟨🟥',team:foul_t,player:foul_p,type:'card'});
            yellowLog[foul_t].splice(yellowLog[foul_t].indexOf(foul_p[1]),1);
            expelledLog[foul_t][foul_p[1]]=pen_min;
            if(!redCardTeam){redCardTeam=foul_t;redCardMin=pen_min;}
          } else {
            evts.push({min:pen_min,ico:'🟨',team:foul_t,player:foul_p,type:'card'});
            yellowLog[foul_t].push(foul_p[1]);
          }
        }
      } else if(r2<0.75){
        if(expelledLog[foul_t][foul_p[1]]===undefined){
          evts.push({min:pen_min,ico:'🟥',team:foul_t,player:foul_p,type:'card'});
          expelledLog[foul_t][foul_p[1]]=pen_min;
          if(!redCardTeam){redCardTeam=foul_t;redCardMin=pen_min;}
        }
      }
      evts.push({min:pen_min,ico:'🤦🥅',team:foul_t,player:foul_p,type:'pen-prov'});
      // Resultado del penalti: equipo RIVAL (prov_t) tira
      var pen_kick_min = rndMinAfter(pen_min);
      var pr=Math.random();
      if(pr<0.70){
        // ⚽🥅 Gol — suma al equipo que tira (prov_t)
        if(prov_t==='a')sa++;else sb++;
        evts.push({min:pen_kick_min,ico:'⚽🥅',team:prov_t,player:kick_p,type:'pen-gol'});
      } else if(pr<0.90){
        // 🖐🥅 Parado por portero del equipo que cometió la falta (foul_t)
        var gk=rndGK(foul_t==='a'?sqA:sqB);
        evts.push({min:pen_kick_min,ico:'🖐🥅',team:foul_t,player:gk,type:'pen-parado'});
      } else {
        // ❌🥅 Fuera/poste — lo tira el equipo rival (prov_t)
        evts.push({min:pen_kick_min,ico:'❌🥅',team:prov_t,player:kick_p,type:'pen-fallo'});
      }
    }

    // ── GOL DE FALTA (8%) ────────────────────────────────────────────
    if(Math.random()<0.08){
      var fgt=rndTeam(); var fgsq=fgt==='a'?sqA:sqB; var fkMin=rndMin(); var fgp=rndSqNonGK(fgsq,fkMin);
      if(fgt==='a')sa++;else sb++;
      evts.push({min:fkMin,ico:'⚽🎯',team:fgt,player:fgp,type:'falta-gol'});
    }

    // ── AUTOGOL (8%) ─────────────────────────────────────────────────
    if(Math.random()<0.08){
      var agt=rndTeam(); var agsq=agt==='a'?sqA:sqB; var agMin=rndMin(); var agp=rndSqNonGK(agsq,agMin);
      if(agt==='a')sb++;else sa++;
      evts.push({min:agMin,ico:'⚽🚫',team:agt,player:agp,type:'propia'});
    }

    // ── GOLES NORMALES con influencia real del rating ───────────────
    // Antes solo se repartían los goles con probA; ahora también cambia
    // la CANTIDAD esperada de goles de cada equipo según nivel.
    function _clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
    function _poisson(lambda){
      lambda = Math.max(0.05, lambda || 0.05);
      var L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L && k < 12);
      return k - 1;
    }
    function _avgOutfieldPower(sq){
      var pool=(sq||[]).filter(function(p){ return p && p[2] !== 'P'; });
      if(!pool.length) return 70;
      var sum=pool.reduce(function(acc,p){ return acc + (p[3] || 70); }, 0);
      return sum / pool.length;
    }
    var _powA = _avgOutfieldPower(activeA.length ? activeA : sqA);
    var _powB = _avgOutfieldPower(activeB.length ? activeB : sqB);
    var _strengthA = (rA * 1.10) + ((_powA - 75) * 0.35); // bonus local 10%
    var _strengthB = rB + ((_powB - 75) * 0.35);
    var _shareA = _clamp(_strengthA / Math.max(1, (_strengthA + _strengthB)), 0.22, 0.78);
    var _baseTotalGoals = 1.7 + (((rA + rB) / 2) - 74) * 0.05;
    var _gapBoost = Math.abs(rA - rB) * 0.035;
    var _expectedA = _clamp(_baseTotalGoals * _shareA + Math.max(0, rA - rB) * 0.018 + 0.10, 0.15, 3.8);
    var _expectedB = _clamp(_baseTotalGoals * (1 - _shareA) + Math.max(0, rB - rA) * 0.018, 0.10, 3.3);
    if (Math.abs(rA - rB) >= 8) {
      if (rA > rB) _expectedA += _gapBoost * 0.35;
      else _expectedB += _gapBoost * 0.35;
    }
    var _maxGoals = (rA >= 88 || rB >= 88) ? 7 : (rA >= 84 || rB >= 84) ? 6 : 5;
    var goalsA = Math.min(_maxGoals, _poisson(_expectedA));
    var goalsB = Math.min(_maxGoals, _poisson(_expectedB));
    var _normalGoalTeams = [];
    for (var ga = 0; ga < goalsA; ga++) _normalGoalTeams.push('a');
    for (var gb = 0; gb < goalsB; gb++) _normalGoalTeams.push('b');
    _normalGoalTeams.sort(function(){ return Math.random() - 0.5; });
    var _goalScorers = {}; // tracking goles por jugador
    for(var i=0;i<_normalGoalTeams.length;i++){
      var gt=_normalGoalTeams[i]; var gsq=gt==='a'?sqA:sqB;
      var gMin=rndMin(); applySubsUpTo(gMin);
      // Elegir goleador: puede repetir con prob decreciente (Poisson)
      var gp;
      // ¿Hay ya un goleador de este equipo que pueda repetir?
      var prevScorers = Object.keys(_goalScorers).filter(function(k){ return _goalScorers[k].team===gt; });
      var reusePlayer = false;
      if (prevScorers.length) {
        var topScorer = prevScorers.reduce(function(a,b){ return _goalScorers[a].count > _goalScorers[b].count ? a : b; });
        var prevCount = _goalScorers[topScorer].count;
        // Prob de doblete: 1.5% | hat-trick: 0.2% | póker: 0.01% | repóker: 0.001%
        var reuseProb = prevCount === 1 ? 0.015 : prevCount === 2 ? 0.002 : prevCount === 3 ? 0.0001 : prevCount >= 4 ? 0.00001 : 0;
        // Boost por poder del jugador
        var scorer = _goalScorers[topScorer].player;
        var poderBonus = ((scorer[3]||70) - 70) / 20 * 0.005;
        reuseProb += poderBonus;
        if (Math.random() < reuseProb && !isExpelledBefore(gt, scorer[1], gMin)) {
          gp = scorer;
          reusePlayer = true;
        }
      }
      if (!reusePlayer) gp = rndSqNonGK(gsq, gMin);
      // Registrar goleador
      var gpKey = gt + '::' + gp[1];
      if (!_goalScorers[gpKey]) _goalScorers[gpKey] = { player: gp, team: gt, count: 0 };
      _goalScorers[gpKey].count++;
      if(gt==='a')sa++;else sb++;
      evts.push({min:gMin,ico:'⚽',team:gt,player:gp,type:'gol'});
    }

    // ── LESIONES EN PARTIDO IA vs IA ────────────────────────────────
    if (typeof window.generarLesionesPartido === 'function') {
      var _lesionesIA = window.generarLesionesPartido(TEAM_A, TEAM_B, activeA, activeB, benA, benB, ft90);
      _lesionesIA.forEach(function(les) {
        if (typeof window.aplicarLesionEnSimulacion === 'function') {
          var evLes = window.aplicarLesionEnSimulacion(les, activeA, activeB);
          evts.push(evLes);
        }
      });
    }

    // ── EFECTO ROJA: reduce goles del equipo sancionado tras la roja ─
    if(redCardTeam){
      evts.sort(function(a,b){return a.min-b.min;});
      var adjEvts=[];
      for(var ri=0;ri<evts.length;ri++){
        var rev=evts[ri];
        var isGoalByRed=(rev.team===redCardTeam&&rev.min>redCardMin&&
          (rev.type==='gol'||rev.type==='falta-gol'||rev.type==='pen-gol'));
        if(isGoalByRed&&Math.random()<0.55)continue; // 55% chance goal removed
        adjEvts.push(rev);
      }
      evts=adjEvts;
      sa=0;sb=0;
      evts.forEach(function(ev){
        if(ev.type==='gol'||ev.type==='falta-gol'||ev.type==='pen-gol'){if(ev.team==='a')sa++;else sb++;}
        if(ev.type==='propia'){if(ev.team==='a')sb++;else sa++;}
      });
    }

    // ── Sustituciones gestionadas al inicio del engine ─────────────

    evts.sort(function(a,b){return a.min-b.min;});

    // ── VAR: etiquetar eventos según probabilidad ─────────────────
    if(window.mlVARSystem&&typeof window.mlVARSystem.tagEvents==='function'){
      window.mlVARSystem.tagEvents(evts);
    }

    // ── MVP ───────────────────────────────────────────────────────────
    // Sistema de puntuación:
    //   ⚽ gol=3 | ⚽🎯 falta-gol=4 | ⚽🥅 pen-gol=2 | 🖐🥅 pen-parado=3 | ⚽🚫 propia=-1
    //   🏆 gol decisivo +2 extra
    var mvpName='', mvpTeam='';
    var mvpScores={}, mvpTeams={}, mvpGoals={};
    evts.forEach(function(e){
      if(!e.player)return;
      var k=e.player[1]; var w=0;
      if(e.type==='gol'){w=3;mvpGoals[k]=(mvpGoals[k]||0)+1;}
      else if(e.type==='falta-gol'){w=4;mvpGoals[k]=(mvpGoals[k]||0)+1;}
      else if(e.type==='pen-gol'){w=2;mvpGoals[k]=(mvpGoals[k]||0)+1;}
      else if(e.type==='pen-parado'){w=3;}
      else if(e.type==='propia'){w=-1;}
      if(w!==0){
        mvpScores[k]=(mvpScores[k]||0)+w;
        mvpTeams[k]=(e.team==='a'?TEAM_A:TEAM_B);
      }
    });
    // Bonus +2 al gol decisivo
    var diff=sa-sb;
    if(diff!==0){
      var winTeam=diff>0?'a':'b';
      var runA=0,runB=0,decisivePlayer=null;
      var goalEvts=evts.filter(function(e){
        return(e.type==='gol'||e.type==='falta-gol'||e.type==='pen-gol'||e.type==='propia')&&e.player;
      });
      goalEvts.forEach(function(e){
        if(e.type==='propia'){if(e.team==='a')runB++;else runA++;}
        else{if(e.team==='a')runA++;else runB++;}
        var curDiff=winTeam==='a'?runA-runB:runB-runA;
        if(curDiff===1&&!decisivePlayer){
          decisivePlayer=(e.type==='propia')?null:e.player[1];
        }
      });
      if(decisivePlayer){
        if(mvpScores[decisivePlayer]!==undefined){mvpScores[decisivePlayer]+=2;}
        else{mvpScores[decisivePlayer]=2; mvpTeams[decisivePlayer]=(winTeam==='a'?TEAM_A:TEAM_B);}
      }
    }
    // Elegir MVP: 90% del equipo ganador
    var winnerTeam=sa>sb?'a':(sb>sa?'b':null);
    var forceWinnerMVP=(winnerTeam&&Math.random()<0.90);
    Object.keys(mvpScores).forEach(function(k){
      if(mvpScores[k]<=0)return;
      var kIsWinner=winnerTeam&&mvpTeams[k]===(winnerTeam==='a'?TEAM_A:TEAM_B);
      if(!mvpName){mvpName=k;return;}
      var curIsWinner=mvpTeams[mvpName]===(winnerTeam==='a'?TEAM_A:TEAM_B);
      if(forceWinnerMVP){
        if(kIsWinner&&!curIsWinner){mvpName=k;return;}
        if(!kIsWinner&&curIsWinner){return;}
      }
      if(mvpScores[k]>mvpScores[mvpName]){mvpName=k;}
    });
    mvpTeam=mvpTeams[mvpName]||'';
    // Fallback: sin goles/paradas → jugador de campo aleatorio del ganador
    if(!mvpName){
      var winner0=sa>sb?'a':(sb>sa?'b':'draw');
      var mvpSq=winner0==='b'?sqB:(winner0==='a'?sqA:(Math.random()<0.5?sqA:sqB));
      var outfieldMvp=mvpSq.filter(function(p){return p[2]!=='P';});
      var pool=outfieldMvp.length?outfieldMvp:mvpSq;
      var mvpP=pool[Math.floor(Math.random()*pool.length)];
      mvpName=mvpP[1]; mvpTeam=mvpSq===sqA?TEAM_A:TEAM_B;
    }
    var mvpGoalCount=mvpGoals[mvpName]||0;
    var mvpGoalStr=mvpGoalCount>1?' ('+mvpGoalCount+'⚽)':'';

    // ── LIVE TICKER ───────────────────────────────────────────────────
    // Fuente única: _MATCH_RULE.IAIA.realMin → 30 s total (15 s por parte).
    // CLAUDE.md: es obligatorio respetar esta duración, sin excepciones de
    // "campo mode" u otros atajos que la alarguen y desincronicen el
    // cronómetro de los eventos.
    var _iaiaInfo = (typeof window._mlResolveClock === 'function')
      ? window._mlResolveClock({ isHvH: false, humanInvolved: false })
      : { realMs: 30000 };
    var _totalRealMs = _iaiaInfo.realMs || 30000;
    var _halfDuration = _totalRealMs / 2;   // ms por parte (15000 por defecto)
    var _tickTotal = 30;                     // 30 ticks fijos (contador fluido)
    var _tickMs = Math.max(50, Math.round(_totalRealMs / _tickTotal));
    var msPerMinFH = _halfDuration / ht45;
    var msPerMinSH = _halfDuration / (ft90-45);
    list.innerHTML='';

    var _tick=0;
    var _tickInterval=setInterval(function(){
      _tick++;
      var _half = Math.floor(_tickTotal / 2);  // mitad exacta → sincroniza con _halfDuration
      if(_tick<=_half){
        var dm=Math.round(_tick*ht45/_half); if(dm>ht45)dm=ht45;
        btn.textContent=(_tick<_half?dm:ht45+'+'+extraA)+"'";
      } else if(_tick<=_tickTotal){
        var t2=_tick-_half; var dm2=45+Math.round(t2*(ft90-45)/(_tickTotal-_half)); if(dm2>ft90)dm2=ft90;
        btn.textContent=(dm2<=90?dm2:'90+'+extraB)+"'";
      }
      if(_tick>=_tickTotal)clearInterval(_tickInterval);
    },_tickMs);

    function renderEvtEl(ev){
      if(ev.type==='ht'||ev.type==='sub'||ev.type==='played'||ev.type==='sust')return;
      // Lesión grave: STOP en timer
      if(ev.type==='lesion'&&ev.grave){
        var _btnTimer=document.getElementById(cfg.btnId);
        if(_btnTimer){_btnTimer.textContent='🛑 STOP';_btnTimer.classList.add('grave-stop');}
        setTimeout(function(){
          var _btnT2=document.getElementById(cfg.btnId);
          if(_btnT2){_btnT2.classList.remove('grave-stop');}
        },4000);
      }
      var d=document.createElement('div'); d.className='ml-evt-item';
      d.setAttribute('data-team', ev.team);
      d.setAttribute('data-type', ev.type);
      var teamName=ev.team==='a'?TEAM_A:TEAM_B;
      var _iaFalloExtra='';
      if(ev.type==='pen-parado'){var _iaContrario=ev.team==='a'?'b':'a';var _iaFallado=evts.find(function(e){return e.type==='pen-fallo'&&e.team===_iaContrario&&e.min===ev.min;});if(_iaFallado){_iaFalloExtra='<span class="ml-evt-pen-fallo">❌ '+_iaFallado.player[1]+'</span>';}}
      // Lesión: mostrar grado y partidos de baja
      if(ev.type==='lesion'){
        var _lColor=ev.grave?'#ff4444':(ev.tipo&&ev.tipo.grado===2?'#ff8c00':'#ffd700');
        d.innerHTML='<span class="ml-evt-min">'+ev.min+"'</span>"
          +'<span class="ml-evt-ico">🩹</span>'
          +'<span class="ml-evt-name" style="color:'+_lColor+'">'+ev.player[1]
          +'<span style="font-size:10px;color:rgba(255,255,255,0.5);margin-left:6px;">'+ev.gradoNombre+' · '+ev.partidos+'P</span></span>'
          +'<span class="ml-evt-team">'+teamName+'</span>';
        list.appendChild(d);
        return;
      }
      var _varLabel='';
      if(ev.var&&window.mlVARSystem&&typeof window.mlVARSystem.varLogSuffix==='function'){
        _varLabel='<span class="ml-evt-var">'+window.mlVARSystem.varLogSuffix(ev.type)+'</span>';
      }
      d.innerHTML='<span class="ml-evt-min">'+ev.min+"'</span>"
        +'<span class="ml-evt-ico">'+ev.ico+'</span>'
        +'<span class="ml-evt-name">'+ev.player[1]+_varLabel+'</span>'
        +_iaFalloExtra
        +'<span class="ml-evt-team">'+teamName+'</span>';
      list.appendChild(d);
    }

    evts.forEach(function(ev){
      var ms;
      if(ev.type==='ht'){ms=_halfDuration;}
      else if(ev.min<=ht45){ms=Math.round(ev.min*msPerMinFH);}
      else{ms=_halfDuration+Math.round((ev.min-45)*msPerMinSH);}
      ms=Math.min(ms,_halfDuration*2-500);
      var _isGoalType=ev.type==='gol'||ev.type==='falta-gol'||ev.type==='pen-gol'||ev.type==='propia';
      var _isCardType=ev.ico==='🟨'||ev.ico==='🟥'||ev.ico==='🟨🟥';
      var _isPenProv=ev.type==='pen-prov';
      if(ev.var&&(_isGoalType||_isCardType||_isPenProv)){
        (function(evSnap,msDelay,isGoal){
          setTimeout(function(){
            var _scAEl=document.getElementById(cfg.scAId);
            var _scoreEl=_scAEl?_scAEl.closest('.ml-score'):null;
            var _timerEl=document.getElementById(cfg.btnId);
            function _doUpdate(){
              renderEvtEl(evSnap);
              if(isGoal){
                var _sA=document.getElementById(cfg.scAId);
                var _sB=document.getElementById(cfg.scBId);
                if(_sA)_sA.textContent=evts.filter(function(e){return(e.type==='gol'||e.type==='falta-gol'||e.type==='pen-gol')&&e.team==='a'&&e.min<=evSnap.min;}).length+evts.filter(function(e){return e.type==='propia'&&e.team==='b'&&e.min<=evSnap.min;}).length;
                if(_sB)_sB.textContent=evts.filter(function(e){return(e.type==='gol'||e.type==='falta-gol'||e.type==='pen-gol')&&e.team==='b'&&e.min<=evSnap.min;}).length+evts.filter(function(e){return e.type==='propia'&&e.team==='a'&&e.min<=evSnap.min;}).length;
                var gf=document.getElementById(cfg.gfId);
                if(gf){gf.classList.add('show');if(typeof triggerShootingBall==='function')triggerShootingBall(gf,(evSnap.type==='propia'?(evSnap.team==='a'?'b':'a'):evSnap.team));setTimeout(function(){gf.classList.remove('show');},3000);}
                if(window.goalNotificationImproved){var _gnt=evSnap.type==='propia'?(evSnap.team==='a'?'b':'a'):evSnap.team;var _gnp=evSnap.player?evSnap.player[1]:'';window.goalNotificationImproved.show(cfg.matchKey,_gnt,_gnp);}
              }
            }
            if(_scoreEl){
              var _origHTML=_scoreEl.innerHTML;
              var _varMs=(window.mlVARSystem&&window.mlVARSystem.REVIEW_MS)||3000;
              _scoreEl.innerHTML='<span class="ml-var-text">📺 VAR</span>';
              if(_timerEl)_timerEl.classList.add('ml-var-reviewing');
              setTimeout(function(){
                _scoreEl.innerHTML=_origHTML;
                if(_timerEl)_timerEl.classList.remove('ml-var-reviewing');
                _doUpdate();
              },_varMs);
            } else {
              _doUpdate();
            }
          },msDelay);
        })(ev,ms,_isGoalType);
      } else {
        setTimeout(function(){renderEvtEl(ev);},ms);
        if(_isGoalType){
          setTimeout(function(){
            var scAEl=document.getElementById(cfg.scAId);
            var scBEl=document.getElementById(cfg.scBId);
            if(scAEl) scAEl.textContent=evts.filter(function(e){return(e.type==='gol'||e.type==='falta-gol'||e.type==='pen-gol')&&e.team==='a'&&e.min<=ev.min;}).length+evts.filter(function(e){return e.type==='propia'&&e.team==='b'&&e.min<=ev.min;}).length;
            if(scBEl) scBEl.textContent=evts.filter(function(e){return(e.type==='gol'||e.type==='falta-gol'||e.type==='pen-gol')&&e.team==='b'&&e.min<=ev.min;}).length+evts.filter(function(e){return e.type==='propia'&&e.team==='a'&&e.min<=ev.min;}).length;
            var gf=document.getElementById(cfg.gfId);
            if(gf){gf.classList.add('show');if(typeof triggerShootingBall==='function')triggerShootingBall(gf,(ev.type==='propia'?(ev.team==='a'?'b':'a'):ev.team));setTimeout(function(){gf.classList.remove('show');},3000);}
            if(window.goalNotificationImproved){var _gnt=ev.type==='propia'?(ev.team==='a'?'b':'a'):ev.team;var _gnp=ev.player?ev.player[1]:'';window.goalNotificationImproved.show(cfg.matchKey,_gnt,_gnp);}
          },ms+50);
        }
      }
    });

    // Descanso
    setTimeout(function(){
      btn.textContent=ht45+"'+"; btn.className='ml-timer';
    },_halfDuration);

    // Tiempo reglamentario
    setTimeout(function(){
      var scAEl=document.getElementById(cfg.scAId);
      var scBEl=document.getElementById(cfg.scBId);
      if(scAEl) scAEl.textContent=sa;
      if(scBEl) scBEl.textContent=sb;
      btn.textContent='🏁 FIN'; btn.className='ml-timer finished';
      // MVP
      var mvpDiv=document.createElement('div'); mvpDiv.className='ml-evt-item';
      mvpDiv.innerHTML='<span class="ml-evt-min">FIN</span><span class="ml-evt-ico">⭐</span>'
        +'<span class="ml-evt-name">'+mvpName+mvpGoalStr+'</span>'
        +'<span class="ml-evt-team">'+mvpTeam+'</span>';
      list.appendChild(mvpDiv);
      // Resultado final
      var winner=sa>sb?TEAM_A:(sb>sa?TEAM_B:'Empate');
      var r=document.createElement('div'); r.className='ml-ht ml-ht-fin';
      r.textContent='🏁 FIN · '+TEAM_A+' '+sa+' – '+sb+' '+TEAM_B
        +(winner==='Empate'?' · EMPATE':' · 🏆 '+winner.toUpperCase()+' GANA');
      // Añadir MVP a evts para que se contabilice en estadísticas igual que en partidos manuales
      if(mvpName){
        var mvpTeamKey = mvpTeam===TEAM_A?'a':'b';
        evts.push({min:90,ico:'⭐',team:mvpTeamKey,player:['',mvpName],type:'mvp'});
      }
      // Conteo tarjetas/MVP para clasificación
      var _ta_a=evts.filter(function(e){return e.team==='a'&&e.ico==='🟨';}).length;
      var _tr_a=evts.filter(function(e){return e.team==='a'&&(e.ico==='🟥'||e.ico==='🟨🟥');}).length;
      var _ta_b=evts.filter(function(e){return e.team==='b'&&e.ico==='🟨';}).length;
      var _tr_b=evts.filter(function(e){return e.team==='b'&&(e.ico==='🟥'||e.ico==='🟨🟥');}).length;
      var _mvp_a=mvpTeam===TEAM_A?1:0;
      var _mvp_b=mvpTeam===TEAM_B?1:0;
      /* Emitir 'played' por cada jugador que ha pisado el campo
         (titulares + suplentes que entraron en sustitución). Sin esto,
         sólo los jugadores con al menos 1 evento (gol/tarjeta/MVP)
         acababan con una entrada en el dashboard de estadísticas → los
         demás quedaban fuera y no sumaban PJ, ni los suplentes que
         entraron en el partido. El tipo 'played' no incrementa ningún
         contador en applyEvent; simplemente crea la entrada stats[team::
         jugador] para que el asignador posterior de PJ (misc_body_1.html)
         le dé el partido que le corresponde. */
      (function _pushPlayedEvts(){
        function _pushSide(teamLetter, sq, benchIn){
          var pushed = {};
          (sq||[]).forEach(function(p){
            if(!p) return;
            if(p[4] === 'suplente') return; /* titulares */
            var key = String(p[0]||'') + '|' + String(p[1]||'');
            if(pushed[key]) return;
            pushed[key] = true;
            evts.push({min:0, team:teamLetter, player:[p[0]||'', p[1]||'', p[2]||''], type:'played'});
          });
          (benchIn||[]).forEach(function(p){
            if(!p) return;
            var key = String(p[0]||'') + '|' + String(p[1]||'');
            if(pushed[key]) return;
            pushed[key] = true;
            evts.push({min:0, team:teamLetter, player:[p[0]||'', p[1]||'', p[2]||''], type:'played'});
          });
        }
        try {
          _pushSide('a', sqA, benA.slice(0, subIdxA));
          _pushSide('b', sqB, benB.slice(0, subIdxB));
        } catch(_){}
      })();
      // registrarLigaPlayerStats MUST be called first so that patchRegistrar can use the
      // already-stored events (with pen-gol, falta-gol, propia) instead of falling back
      // to genMatchEvents which lacks those set-piece event types.
      if(typeof window.registrarLigaPlayerStats==='function')
        window.registrarLigaPlayerStats(matchKey,TEAM_A,TEAM_B,evts,mvpName,mvpTeam);
      if(typeof window.registrarResultadoLiga==='function')
        window.registrarResultadoLiga(matchKey,TEAM_A,TEAM_B,sa,sb,_ta_a,_tr_a,_ta_b,_tr_b,_mvp_a,_mvp_b);
      list.appendChild(r);
      if(typeof cfg.onEnd==='function') cfg.onEnd(sa,sb,evts,mvpName,mvpTeam);
      // Mostrar overlay de lesiones post-partido IA
      var _lesEvts = evts.filter(function(ev){ return ev.type === 'lesion'; });
      if(_lesEvts.length && typeof window.showLesionPostOverlay === 'function'){
        var _lesData = _lesEvts.map(function(ev){
          return {
            nombre: ev.player ? ev.player[1] : '',
            equipo: ev.team === 'a' ? TEAM_A : TEAM_B,
            grado: ev.grado || 1,
            gradoNombre: ev.gradoNombre || 'Leve',
            gradoEmoji: ev.gradoEmoji || '🟡',
            descripcion: ev.descripcion || '',
            partidos: ev.partidos || 1
          };
        });
        setTimeout(function(){ window.showLesionPostOverlay(_lesData, null); }, 800);
      }
    },_halfDuration*2);
  };

})();


/* script block 22 */

function actaTog(matchKey) {
  var toggle = document.getElementById('acta-toggle-' + matchKey);
  var body   = document.getElementById('acta-body-'   + matchKey);
  if (!toggle || !body) return;
  var open = body.classList.contains('open');
  body.classList.toggle('open', !open);
  toggle.classList.toggle('open', !open);
}

// ── Botón CONFIGURACIÓN: cuestionario pre-partido → sanciones ──
function mlPreviaClick(matchKey) {
  if (typeof window._mlEnsureLegacyPreMatchStructure === 'function') {
    window._mlEnsureLegacyPreMatchStructure(matchKey);
  }
  var wrap = document.getElementById('mlw-' + matchKey);
  var compKey = 'liga';
  var isHvH = wrap && wrap.classList.contains('hvh');
  window._ppBlockId = null;
  if (wrap) {
    var jm = wrap.closest('.jmatches');
    if (jm && jm.id) {
      var jid = jm.id;
      window._ppBlockId = jid;
      if (jid === 'cal-copa-fin')              compKey = 'copa-fin';
      else if (jid === 'sc-final')             compKey = 'sc-final';
      else if (jid === 'cal-usc-f')            compKey = 'usc-fin';
      else if (jid === 'ucl-fin')              compKey = 'ucl-fin';
      else if (jid === 'uel-fin')              compKey = 'uel-fin';
      else if (jid === 'uecl-fin')             compKey = 'uecl-fin';
      else if (jid === 'cal-inter-f')          compKey = 'inter-fin';
      else if (jid === 'cal-rec-fin')          compKey = 'recopa-fin';
      else if (jid === 'cal-eu-fin')           compKey = 'eur-fin';
      else if (jid === 'sc-semis')             compKey = 'sc';
      else if (jid.startsWith('cal-sc-'))      compKey = 'sc';
      else if (jid.startsWith('cal-usc-'))     compKey = 'usc';
      else if (jid.startsWith('cal-copa-'))    compKey = 'copa';
      else if (jid.startsWith('cal-l'))        compKey = 'liga';
      else if (jid.startsWith('cl-j'))         compKey = 'liga';
      else if (jid.startsWith('ucl-'))         compKey = 'ucl';
      else if (jid.startsWith('cal-ucl-'))     compKey = 'ucl';
      else if (jid.startsWith('uel-'))         compKey = 'uel';
      else if (jid.startsWith('uecl-'))        compKey = 'uecl';
      else if (jid.startsWith('cal-sl'))       compKey = 'superliga';
      else if (jid.startsWith('cal-inter-'))   compKey = 'inter';
      else if (jid.startsWith('cal-rec-'))     compKey = 'recopa';
      else if (jid.startsWith('cal-eu-g'))     compKey = 'eur-grupo';
      else if (jid.startsWith('cal-eu-'))      compKey = 'eur-ko';
      else if (jid.startsWith('cal-ams'))      compKey = 'amistoso';
      else if (jid.startsWith('cal-sel'))      compKey = 'sel';
      else if (jid.startsWith('cal-mf-'))      compKey = 'sel-fin';
    }
  }
  // Determinar prórroga automática según reglas
  // HvH: siempre hay prórroga y penaltis, EXCEPTO en Liga/grupos/amistoso
  // HvIA: Copa 1r/2r/dieciseisavos, USC, SC, Inter, Fases finales selecciones → sí
  // HvIA: Liga y fase de grupos europeos → NO
  var prorroga;
  var sinProrrogaComp = ['liga', 'liga-2', 'amistoso', 'eur-grupo', 'superliga'];
  if (isHvH && sinProrrogaComp.indexOf(compKey) === -1) {
    prorroga = 'Sí';
  } else {
    var conProrroga = ['copa','copa-fin','sc','sc-final','usc','usc-fin','inter','inter-fin','ucl-fin','uel-fin','uecl-fin','recopa','recopa-fin','eur-ko','eur-fin','sel','sel-fin'];
    prorroga = (conProrroga.indexOf(compKey) !== -1) ? 'Sí' : 'No';
  }
  // Duración real según spec (_MATCH_RULE): HvH=16.5 min, HvIA=13.5 min.
  // CLAUDE.md: NUNCA hardcodear minutos — leer siempre del helper.
  var duracion = (typeof window._mlRealDurationLabel === 'function')
    ? window._mlRealDurationLabel({ isHvH: isHvH, humanInvolved: !isHvH })
    : (isHvH ? '16.5 min' : '13.5 min');
  // Mostrar cuestionario
  if (typeof window.showPrePartidoOverlay === 'function') {
    window.showPrePartidoOverlay(matchKey, compKey, prorroga, duracion, isHvH);
  }
}

// ── Compatibilidad: restaurar flujo antiguo CONFIGURACIÓN → ajustes → partido ──
(function() {
  function _resolveWrap(matchKey) {
    return document.getElementById('mlw-' + matchKey);
  }

  function _ensureIds(matchKey) {
    var wrap = _resolveWrap(matchKey);
    if (!wrap) return;
    var venue = wrap.querySelector('.ml-venue-bar');
    if (venue && !venue.id) venue.id = 'venue-bar-' + matchKey;
    var ballWrap = wrap.querySelector('.ml-score-wrap');
    if (ballWrap && !ballWrap.id) ballWrap.id = 'ball-wrap-' + matchKey;
  }

  function _setPreMatchStage(matchKey, unlocked) {
    var wrap = _resolveWrap(matchKey);
    if (!wrap) return;
    _ensureIds(matchKey);
    var timerBtn = document.getElementById('ml-timer-' + matchKey);
    var timerRow = document.getElementById('ml-timer-row-' + matchKey);
    var addBtn = document.getElementById('ml-add-btn-' + matchKey);
    var actBar = document.getElementById('ml-actions-bar-' + matchKey);
    var previaBtn = document.getElementById('ml-previa-' + matchKey);
    if (previaBtn) previaBtn.style.display = unlocked ? 'none' : '';
    /* La fila inline ⏪ [▶/⏸ min] ⏩ es lo que se oculta/muestra como
       unidad. El botón interior sigue el estado del wrapper. */
    if (timerRow) timerRow.style.display = unlocked ? '' : 'none';
    if (timerBtn) timerBtn.disabled = !unlocked;
    if (addBtn) addBtn.style.visibility = unlocked ? '' : 'hidden';
    if (actBar) actBar.style.visibility = unlocked ? '' : 'hidden';
    if (unlocked) wrap.setAttribute('data-prepartido-ready', '1');
    if (typeof window._mlRenderTimerGen === 'function') {
      try { window._mlRenderTimerGen(matchKey); } catch(_){}
    }
  }

  window._mlEnsureLegacyPreMatchStructure = function(matchKey) {
    var wrap = _resolveWrap(matchKey);
    if (!wrap) return;
    _ensureIds(matchKey);
    var scoreWrap = wrap.querySelector('.ml-score-wrap');
    var timerBtn = document.getElementById('ml-timer-' + matchKey);
    if (scoreWrap && timerBtn && !document.getElementById('ml-previa-' + matchKey)) {
      var previaBtn = document.createElement('button');
      previaBtn.id = 'ml-previa-' + matchKey;
      previaBtn.className = 'ml-previa-btn';
      previaBtn.innerHTML = '⚙️ CONFIGURACIÓN';
      previaBtn.onclick = function() { mlPreviaClick(matchKey); };
      if (timerBtn.nextSibling) scoreWrap.insertBefore(previaBtn, timerBtn.nextSibling);
      else scoreWrap.appendChild(previaBtn);
    }
    var unlocked = wrap.getAttribute('data-prepartido-ready') === '1';
    _setPreMatchStage(matchKey, unlocked);
  };

  function _initAllPreviaButtons() {
    document.querySelectorAll('.match-live-wrap.hvh[id^="mlw-"]').forEach(function(wrap) {
      var matchKey = wrap.id.replace('mlw-', '');
      window._mlEnsureLegacyPreMatchStructure(matchKey);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initAllPreviaButtons);
  } else {
    _initAllPreviaButtons();
  }
})();

function _renderSancionBanner(matchKey, bodyEl) {
  var humanKeys = ['j1m1','j1m2','j1m3'];
  if (humanKeys.indexOf(matchKey) === -1) return;
  if (!window.SANCION_STORE) return;
  // j1m1/j1m2/j1m3 son todos Liga en Jornada 1
  var compKey = 'liga';
  var sancionCompConfig = {
    liga:{ label:'Liga EA Sports', esFinal:false },
    copa:{ label:'Copa del Rey', esFinal:false },'copa-fin':{ label:'Copa del Rey · Final', esFinal:true },
    sc:{ label:'Supercopa de España', esFinal:false },'sc-final':{ label:'Supercopa · Final', esFinal:true },
    usc:{ label:'UEFA Super Cup', esFinal:false },'usc-fin':{ label:'UEFA Super Cup · Final', esFinal:true },
    ucl:{ label:'Champions League', esFinal:false },'ucl-fin':{ label:'Champions League · Final', esFinal:true },
    uel:{ label:'Europa League', esFinal:false },'uel-fin':{ label:'Europa League · Final', esFinal:true },
    uecl:{ label:'Conference League', esFinal:false },'uecl-fin':{ label:'Conference League · Final', esFinal:true },
    superliga:{ label:'Superliga', esFinal:false },
    inter:{ label:'Copa Intercontinental', esFinal:false },'inter-fin':{ label:'Intercontinental · Final', esFinal:true }
  };
  var cfg = sancionCompConfig[compKey] || { label: compKey, esFinal: false };
  /* 2026-05-23: el banner se alimenta del bucket __global cross-comp.
     En finales las acumulaciones de amarillas no aplican (solo
     expulsiones); torneos de verano / amistosos no se filtran aquí
     porque este banner solo se renderiza para j1m1/j1m2/j1m3 (Liga). */
  var globalQ = window.SANCION_STORE.__global || [];
  var sanciones = cfg.esFinal
    ? globalQ.filter(function(s){ return !/acumulad/i.test(s.reason || ''); })
    : globalQ;
  /* Filtrar por los 2 equipos del partido en curso */
  var wrap = document.getElementById('mlw-' + matchKey);
  if (wrap) {
    var names = wrap.querySelectorAll('.ml-team-name');
    var hName = ((names[0]||{}).textContent||'').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
    var aName = ((names[1]||{}).textContent||'').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
    var normFn = window._ppNormTeam || function(s){ return String(s||'').toLowerCase(); };
    var nH = normFn(hName), nA = normFn(aName);
    sanciones = sanciones.filter(function(s) {
      var nt = normFn(s.team || '');
      return nt === nH || nt === nA
        || (nt && (nt.indexOf(nH) !== -1 || nH.indexOf(nt) !== -1))
        || (nt && (nt.indexOf(nA) !== -1 || nA.indexOf(nt) !== -1));
    });
  }
  // Eliminar banner anterior
  var prev = bodyEl.querySelector('.sancion-acta-banner');
  if (prev) prev.remove();
  if (!sanciones || !sanciones.length) return;
  var banner = document.createElement('div');
  banner.className = 'sancion-acta-banner';
  banner.innerHTML =
    '<div class="sab-header"><span class="sab-icon">🚫</span><span class="sab-title">JUGADORES SANCIONADOS · ' + cfg.label.toUpperCase() + '</span></div>' +
    sanciones.map(function(s) {
      return '<div class="sab-row">'
        + '<span class="sab-name">' + s.name + '</span>'
        + '<span class="sab-sep">·</span>'
        + '<span class="sab-team">' + s.team + '</span>'
        + '<span class="sab-reason">' + s.reason + '</span>'
        + '</div>';
    }).join('');
  var list = document.getElementById('ml-acta-list-' + matchKey);
  if (list) bodyEl.insertBefore(banner, list);
  else bodyEl.appendChild(banner);
}
// Acta observers
(function() {
  var humanKeys = ['j1m1','j1m2','j1m3'];
  var iaKeys    = ['j1m4','j1m5','j1m6','j1m7','j1m8','j1m9','j1m10'];

  // Human matches: auto-open on first event, stay open
  humanKeys.forEach(function(mk) {
    var listEl = document.getElementById('ml-acta-list-' + mk);
    if (!listEl) return;
    var obs = new MutationObserver(function() {
      var body   = document.getElementById('acta-body-'   + mk);
      var toggle = document.getElementById('acta-toggle-' + mk);
      var hasContent = listEl.querySelector('.ml-evt-item, .ml-ht, .ml-ht-fin');
      if (hasContent && body && !body.classList.contains('open')) {
        body.classList.add('open');
        if (toggle) toggle.classList.add('open');
      }
    });
    obs.observe(listEl, { childList: true, subtree: true });
  });

  // IA matches: open while simulating, auto-close when FIN banner appears
  iaKeys.forEach(function(mk) {
    var listEl = document.getElementById('ml-acta-list-' + mk);
    if (!listEl) return;
    var obs = new MutationObserver(function() {
      var body   = document.getElementById('acta-body-'   + mk);
      var toggle = document.getElementById('acta-toggle-' + mk);
      if (!body) return;
      var hasFin = listEl.querySelector('.ml-ht-fin');
      if (hasFin) {
        // Partido terminado → plegar
        body.classList.remove('open');
        if (toggle) toggle.classList.remove('open');
      } else {
        // Simulando → abrir para ver eventos en vivo
        var hasContent = listEl.querySelector('.ml-evt-item, .ml-ht');
        if (hasContent && !body.classList.contains('open')) {
          body.classList.add('open');
          if (toggle) toggle.classList.add('open');
        }
      }
    });
    obs.observe(listEl, { childList: true, subtree: true });
  });
})();


/* script block 23 */

// --- FIX v6: collect stats from all acta events (manual + simulated) ---
(function(){
const ICON_MAP = {
"⚽":"gol",
"🟨":"amarilla",
"🟥":"roja",
"🤦‍♂️🥅":"pen-prov",
"⚽🥅":"pen-gol",
"❌🥅":"pen-fallado",
"🖐🥅":"pen-parado",
"⚽🎯":"falta-gol",
"⚽🚫":"autogol",
"⭐":"mvp"
};

function normal(n){
 return (n||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
}

function getAllActaEvents(){
 const events=[];
 document.querySelectorAll('[id^="ml-acta-list"]').forEach(list=>{
   list.querySelectorAll("li").forEach(li=>{
     const txt=li.innerText.trim();
     const icon=Object.keys(ICON_MAP).find(i=>txt.startsWith(i));
     if(!icon) return;
     const player=txt.replace(icon,"").trim();
     events.push({type:ICON_MAP[icon],player});
   });
 });
 return events;
}

function rebuildLigaStats(){
 if(!window.LIGA_STATS) window.LIGA_STATS={};
 const ev=getAllActaEvents();
 const map={};

 ev.forEach(e=>{
   const p=normal(e.player);
   if(!map[p]) map[p]={name:e.player,stats:{}};
   map[p].stats[e.type]=(map[p].stats[e.type]||0)+1;
 });

 window.LIGA_STATS=map;
 if(window.buildLigaStatsDashboard) window.buildLigaStatsDashboard();
}

window.rebuildLigaStats=rebuildLigaStats;

document.addEventListener("click",function(e){
 if(e.target.closest(".simulate-btn") || e.target.closest(".guardar-acta")){
   setTimeout(rebuildLigaStats,300);
 }
});

document.addEventListener("DOMContentLoaded",rebuildLigaStats);
})();


/* script block 24 */

// --- FIX v8: ligar estadísticas por equipo + dorsal (y nombre como apoyo) ---
(function(){
  function norm(str){
    return String(str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g,'')
      .replace(/[^\w\s]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .toLowerCase();
  }

  var TEAM_ALIASES = {
    'real madrid':'Real Madrid',
    'real madrid cf':'Real Madrid',
    'fc barcelona':'FC Barcelona',
    'barcelona':'FC Barcelona',
    'barca':'FC Barcelona',
    'barça':'FC Barcelona',
    'athletic club':'Athletic Club',
    'real betis':'Real Betis',
    'betis':'Real Betis',
    'real sociedad':'Real Sociedad',
    'atletico madrid':'Atlético Madrid',
    'atlético madrid':'Atlético Madrid',
    'atletico de madrid':'Atlético Madrid',
    'atlético de madrid':'Atlético Madrid',
    'arsenal':'Arsenal',
    'arsenal fc':'Arsenal',
    'bayern munich':'Bayern Munich',
    'bayern de munich':'Bayern Munich',
    'bayern de múnich':'Bayern Munich',
    'fc bayern':'Bayern Munich',
    'fc bayern munich':'Bayern Munich',
    'sporting cp':'Sporting CP',
    'sporting de portugal':'Sporting CP',
    'sporting lisboa':'Sporting CP',
    'sporting de lisboa':'Sporting CP',
    'albacete bp':'Albacete BP',
    'villarreal':'Villarreal CF',
    'villarreal cf':'Villarreal CF',
    'sevilla':'Sevilla FC',
    'sevilla fc':'Sevilla FC',
    'espanyol':'Espanyol',
    'getafe':'Getafe CF',
    'getafe cf':'Getafe CF',
    'rc celta':'Celta de Vigo',
    'celta de vigo':'Celta de Vigo',
    'celta':'Celta de Vigo',
    'ca osasuna':'Osasuna',
    'osasuna':'Osasuna',
    'deportivo alaves':'Deportivo Alavés',
    'deportivo alavés':'Deportivo Alavés',
    'girona':'Girona FC',
    'girona fc':'Girona FC',
    'real oviedo':'Real Oviedo',
    'levante ud':'Levante UD',
    'rcd mallorca':'Mallorca',
    'mallorca':'Mallorca',
    'elche':'Elche CF',
    'elche cf':'Elche CF',
    'valencia':'Valencia CF',
    'valencia cf':'Valencia CF',
    'rayo vallecano':'Rayo Vallecano'
  };

  var SCREEN_TEAM_FALLBACK = {
    's-munich': 'Bayern Munich',
    's-arsenal': 'Arsenal',
    's-sporting': 'Sporting CP',
    's-madrid': 'Real Madrid',
    's-barca': 'FC Barcelona',
    's-atletico': 'Atlético Madrid',
    's-albacete': 'Albacete BP',
    's-villarreal': 'Villarreal CF',
    's-sevilla': 'Sevilla FC',
    's-espanyol': 'Espanyol',
    's-getafe': 'Getafe CF',
    'celta-screen': 'Celta de Vigo',
    'osasuna-screen': 'Osasuna',
    'alaves-screen': 'Deportivo Alavés',
    'girona-screen': 'Girona FC',
    'oviedo-screen': 'Real Oviedo',
    'levante-screen': 'Levante UD',
    'mallorca-screen': 'Mallorca',
    'elche-screen': 'Elche CF',
    'valencia-screen': 'Valencia CF',
    'rayo-screen': 'Rayo Vallecano',
    'athletic-screen': 'Athletic Club',
    'betis-screen': 'Real Betis',
    'sociedad-screen': 'Real Sociedad'
  };

  var STAT_CLASS_MAP = {
    'cs': 'ps-cs',
    'gol': 'ps-gol',
    'yel': 'ps-yel',
    'red': 'ps-red',
    'mvp': 'ps-mvp',
    'pen-prov': 'ps-pen-prov',
    'pen-parado': 'ps-pen-parado',
    'pen-gol': 'ps-pen-gol',
    'falta-gol': 'ps-falta-gol',
    'propia': 'ps-propia',
    'pen-fallado': 'ps-pen-fallado'
  };

  function canonicalTeamName(name){
    var key = norm(name);
    var aliases = Object.assign({}, TEAM_ALIASES, window.TEAM_ALIASES || {});
    return aliases[key] || String(name || '').trim();
  }

  function ensureSpan(row, cls){
    var span = row.querySelector('.' + cls);
    if(!span){
      span = document.createElement('span');
      span.className = cls;
      span.hidden = true;
      span.setAttribute('data-global', '0');
      span.setAttribute('data-liga', '0');
      row.appendChild(span);
    }
    if(!span.hasAttribute('data-liga')) span.setAttribute('data-liga','0');
    return span;
  }

  function getPlantillaRows(){
    var rows = [];
    document.querySelectorAll('.screen[id]').forEach(function(screen){
      var team = SCREEN_TEAM_FALLBACK[screen.id] || '';
      if(!team){
        var h2 = screen.querySelector('.sec-hdr h2');
        if(h2) team = h2.textContent.trim();
      }
      team = canonicalTeamName(team);
      screen.querySelectorAll('.plant-row').forEach(function(row){
        var nameEl = row.querySelector('.plant-name');
        var numEl = row.querySelector('.plant-num');
        if(!nameEl) return;
        Object.keys(STAT_CLASS_MAP).forEach(function(k){ ensureSpan(row, STAT_CLASS_MAP[k]); });
        rows.push({
          team: team,
          num: numEl ? String(numEl.textContent || '').trim() : '',
          name: String(nameEl.textContent || '').trim(),
          row: row
        });
      });
    });
    return rows;
  }

  function buildRosterIndex(){
    var byNum = {};
    var byName = {};
    getPlantillaRows().forEach(function(p){
      if(p.team && p.num) byNum[p.team + '::' + p.num] = p.row;
      if(p.team && p.name) byName[p.team + '::' + norm(p.name)] = p.row;
    });
    return { byNum: byNum, byName: byName };
  }

  function resetLigaStats(){
    document.querySelectorAll('.plant-row').forEach(function(row){
      Object.keys(STAT_CLASS_MAP).forEach(function(k){
        ensureSpan(row, STAT_CLASS_MAP[k]).setAttribute('data-liga','0');
      });
    });
  }

  function inc(row, key, amount){
    amount = Number(amount || 1);
    if(!row || !STAT_CLASS_MAP[key]) return;
    var span = ensureSpan(row, STAT_CLASS_MAP[key]);
    span.setAttribute('data-liga', String((Number(span.getAttribute('data-liga') || 0)) + amount));
  }

  function parseType(ev){
    var type = String((ev && ev.type) || '').trim();
    var ico = String((ev && ev.ico) || '').replace(/️/g,'').trim();
    if(type === 'amarilla' || type === 'roja' || type === 'd-amarilla' || type === 'card') return 'card';
    if(type === 'pen-fallo' || type === 'pen-fallado') return 'pen-fallado';
    if(type) return type;
    if(ico === '⚽') return 'gol';
    if(ico === '🟨' || ico === '🟥' || ico === '🟨🟥') return 'card';
    if(ico === '🤦🥅' || ico === '🤦‍♂🥅' || ico === '🤦‍♂️🥅') return 'pen-prov';
    if(ico === '⚽🥅') return 'pen-gol';
    if(ico === '⚽❌') return 'pen-fallado';
    if(ico === '🖐🥅') return 'pen-parado';
    if(ico === '⚽🎯') return 'falta-gol';
    if(ico === '⚽🚫') return 'propia';
    if(ico === '⭐') return 'mvp';
    return '';
  }

  function applyEvent(index, teamName, ev){
    var canonicalTeam = canonicalTeamName(teamName);
    if(!canonicalTeam) return;
    var num = '';
    var name = '';
    if(Array.isArray(ev && ev.player)){
      num = String(ev.player[0] || '').trim();
      name = String(ev.player[1] || '').trim();
    } else {
      num = String((ev && (ev.num || ev.dorsal)) || '').trim();
      name = String((ev && (ev.name || ev.playerName || ev.jugador || ev.player)) || '').trim();
    }
    var row = null;
    /* Orden de match: nombre > apellido > número.
       Antes probábamos el número PRIMERO, pero los equipos cuya
       plantilla HTML y la del simulador tienen dorsales distintos
       (p.ej. Celta: HTML Carreira #14 vs simulador Iago Aspas #14,
       HTML Á. Núñez #17 vs simulador F. López #17...) acababan
       atribuyendo eventos al jugador equivocado — y el correcto se
       perdía silenciosamente. Con nombre primero, solo caemos al
       número cuando no tenemos nombre. */
    if(name) row = index.byName[canonicalTeam + '::' + norm(name)] || null;
    /* Fallback por apellido: "Swiderski" ↔ "G. Swiderski",
       "Iago Aspas" ↔ "I. Aspas". Solo aceptamos si hay UN único match
       dentro del equipo, para no asignar a un jugador al azar cuando
       el apellido está repetido. */
    if(!row && name){
      var nname = norm(name);
      var tokens = nname.split(' ').filter(Boolean);
      var lastToken = tokens.length ? tokens[tokens.length - 1] : '';
      if(lastToken && lastToken.length >= 4){
        var prefix = canonicalTeam + '::';
        var matched = [];
        var allKeys = Object.keys(index.byName);
        for(var _ki=0; _ki<allKeys.length; _ki++){
          var _k = allKeys[_ki];
          if(_k.indexOf(prefix) !== 0) continue;
          var rowName = _k.substring(prefix.length);
          var rowTokens = rowName.split(' ').filter(Boolean);
          var rowLast = rowTokens.length ? rowTokens[rowTokens.length - 1] : '';
          if(rowLast === lastToken) matched.push(index.byName[_k]);
        }
        if(matched.length === 1) row = matched[0];
      }
    }
    /* Último recurso: número. Solo si no había nombre o no matcheó. */
    if(!row && num && !name) row = index.byNum[canonicalTeam + '::' + num] || null;
    if(!row) return;

    var type = parseType(ev);
    var ico = String((ev && ev.ico) || '').replace(/️/g,'').trim();
    if(type === 'gol') inc(row, 'gol', 1);
    else if(type === 'falta-gol') inc(row, 'falta-gol', 1);
    else if(type === 'pen-gol') inc(row, 'pen-gol', 1);
    else if(type === 'pen-fallado') inc(row, 'pen-fallado', 1);
    else if(type === 'pen-parado') inc(row, 'pen-parado', 1);
    else if(type === 'pen-prov') inc(row, 'pen-prov', 1);
    else if(type === 'propia') inc(row, 'propia', 1);
    else if(type === 'mvp') inc(row, 'mvp', 1);
    else if(type === 'imbat') inc(row, 'cs', 1);
    else if(type === 'card'){
      if(ico === '🟨') inc(row, 'yel', 1);
      else if(ico === '🟥') inc(row, 'red', 1);
      else if(ico === '🟨🟥') { inc(row, 'yel', 1); inc(row, 'red', 1); }
    }
  }


  function scoreFromEvents(data){
    var scoreA = 0;
    var scoreB = 0;
    (data && data.evts || []).forEach(function(ev){
      var t = parseType(ev);
      var team = ev && ev.team;
      if(t !== 'gol' && t !== 'pen-gol' && t !== 'falta-gol' && t !== 'propia') return;
      if(team !== 'a' && team !== 'b') return;
      var scoringTeam = (t === 'propia') ? (team === 'a' ? 'b' : 'a') : team;
      if(scoringTeam === 'a') scoreA += 1;
      else if(scoringTeam === 'b') scoreB += 1;
    });
    return {a: scoreA, b: scoreB};
  }

  function firstGoalkeeperRow(teamName){
    var team = canonicalTeamName(teamName);
    if(!team) return null;
    var found = null;
    document.querySelectorAll('.screen[id]').forEach(function(screen){
      if(found) return;
      var st = canonicalTeamName(SCREEN_TEAM_FALLBACK[screen.id] || ((screen.querySelector('.sec-hdr h2')||{}).textContent || ''));
      if(st !== team) return;
      found = screen.querySelector('.plant-row.por');
    });
    return found;
  }

  function applyCleanSheetFromMatch(data){
    if(!data) return;
    var sc = scoreFromEvents(data);
    if(sc.b === 0){
      var gkA = firstGoalkeeperRow(data.teamA);
      if(gkA) inc(gkA, 'cs', 1);
    }
    if(sc.a === 0){
      var gkB = firstGoalkeeperRow(data.teamB);
      if(gkB) inc(gkB, 'cs', 1);
    }
  }

  function extractDomFallbackEvents(){
    var out = [];
    document.querySelectorAll('[id^="ml-acta-list-j"] .ml-evt-item').forEach(function(item){
      var list = item.closest('[id^="ml-acta-list-j"]');
      var matchKey = list ? String(list.id).replace('ml-acta-list-','') : '';
      var wrap = list ? list.closest('.match-live-wrap') : null;
      var teamA = '';
      var teamB = '';
      if(matchKey){
        var aEl = document.getElementById('ml-team-a-' + matchKey);
        var bEl = document.getElementById('ml-team-b-' + matchKey);
        if(aEl) teamA = aEl.textContent.trim();
        if(bEl) teamB = bEl.textContent.trim();
      }
      var teamTxt = item.querySelector('.ml-evt-team');
      var icoEl = item.querySelector('.ml-evt-ico');
      var nameEl = item.querySelector('.ml-evt-name');
      if(!icoEl || !nameEl) return;
      var raw = String(nameEl.textContent || '').trim();
      var m = raw.match(/^(\d+)\.\s*(.*)$/);
      out.push({
        matchKey: matchKey,
        teamName: teamTxt ? teamTxt.textContent.trim() : '',
        ev: {
          ico: icoEl.textContent.trim(),
          player: [m ? m[1] : '', m ? m[2] : raw]
        }
      });
    });
    return out;
  }

  function rebuildLigaPlayerStatsFixed(){
    resetLigaStats();
    var index = buildRosterIndex();
    var done = {};
    var store = window.LIGA_PLAYER_MATCH_STORE || {};

    Object.keys(store).forEach(function(matchKey){
      var data = store[matchKey] || {};
      done[matchKey] = true;
      var hasImbatEvt = (data.evts || []).some(function(e){ return e && e.type === 'imbat'; });
      (data.evts || []).forEach(function(ev){
        var teamName = canonicalTeamName(ev && (ev.realTeam || ev.teamName || ev.team_label || (ev.team === 'a' ? data.teamA : ev.team === 'b' ? data.teamB : ev.team)) || '');
        applyEvent(index, teamName, ev);
      });
      // Sólo aplicar el cálculo por marcador si el acta no trae el evento
      // 'imbat' explícito — evita doble conteo ahora que el motor lo emite.
      if (!hasImbatEvt) applyCleanSheetFromMatch(data);
      // MVP ya viene dentro de data.evts — NO aplicar de nuevo para evitar doble conteo
    });

    extractDomFallbackEvents().forEach(function(x){
      if(x.matchKey && done[x.matchKey]) return;
      applyEvent(index, x.teamName, x.ev);
    });

    if(typeof window.buildLigaStatsDashboard === 'function') window.buildLigaStatsDashboard();
    // Refresh visible plant-stat columns for the active competition filter
    _refreshVisiblePlantStats();
  }

  function _refreshVisiblePlantStats() {
    // Update visible cell text from data-liga attributes
    var comp = 'liga';
    document.querySelectorAll('.plant-row').forEach(function(row) {
      var isPor = row.classList.contains('por');
      var tipos = isPor
        ? ['cs','yel','red','mvp','poder','pen-parado','pen-prov','pen-gol','falta-gol','propia']
        : ['gol','yel','red','mvp','poder','pen-gol','pen-prov','pen-parado','falta-gol','propia'];
      var cols = row.querySelectorAll('.plant-stat');
      tipos.forEach(function(tipo, i) {
        if (!cols[i]) return;
        if (tipo === 'poder') return; // poder is static
        var span = row.querySelector('.ps-' + tipo);
        if (!span) return;
        var v = parseInt(span.getAttribute('data-' + comp) || span.getAttribute('data-global') || '0');
        cols[i].textContent = v;
        cols[i].className = 'plant-stat' + (v > 0 ? (' ' + tipo) : ' zero');
      });
      var anyActive = Array.from(row.querySelectorAll('.plant-stat'))
        .some(function(c){ return !c.classList.contains('zero'); });
      row.classList.toggle('has-stat', anyActive);
    });
  }
  window._refreshVisiblePlantStats = _refreshVisiblePlantStats;

  window.rebuildLigaPlayerStatsFixed = rebuildLigaPlayerStatsFixed;

  // No se envuelve registrarLigaPlayerStats para evitar doble reconstrucción al editar MVP

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(function(){ (window.rebuildLigaPlayerStatsFixed || rebuildLigaPlayerStatsFixed)(); }, 150);
  });

  var _origGo2 = window.go;
  if(typeof _origGo2 === 'function'){
    window.go = function(id){
      var res = _origGo2.apply(this, arguments);
      if(id === 's-liga-stats') setTimeout(rebuildLigaPlayerStatsFixed, 0);
      // Also refresh visible plant stats when visiting any team screen
      var teamScreens = ['s-madrid','s-barca','s-munich','s-atletico','s-arsenal','alaves-screen',
        's-sevilla','s-villarreal','s-getafe','s-espanyol','s-albacete',
        'celta-screen','osasuna-screen','alaves-screen','girona-screen',
        'oviedo-screen','levante-screen','mallorca-screen','elche-screen','valencia-screen','rayo-screen'];
      if (teamScreens.indexOf(id) !== -1) {
        setTimeout(function() {
          if (typeof window._refreshVisiblePlantStats === 'function') window._refreshVisiblePlantStats();
        }, 300);
      }
      return res;
    };
  }
})();


/* script block 25 */

(function(){

  /* ─────────────────────────────────────────────────
     1. ESTADO DEL MARCADOR: GRIS / ROJO / AMARILLO
     ─────────────────────────────────────────────── */
  var ALL_MIDS = ['j1m1','j1m2','j1m3','j1m4','j1m5','j1m6','j1m7','j1m8','j1m9','j1m10'];

  function getScoreEl(mid) {
    var a = document.getElementById('sc-' + mid + '-a');
    return a ? a.closest('.ml-score') : null;
  }

  function setScoreState(mid, state) {
    var el = getScoreEl(mid);
    if (!el) return;
    el.classList.remove('state-pending','state-playing','state-finished');
    el.classList.add('state-' + state);
  }
  // Expose globally so _renderTimer functions can call it directly
  window._setScoreState = setScoreState;

  // Init all to pending
  function initStates() {
    ALL_MIDS.forEach(function(mid) { setScoreState(mid, 'pending'); });
  }

  /* Patch human match timers (j1m1-j1m3) */
  function patchHumanTimers() {
    ['j1m1','j1m2','j1m3'].forEach(function(mid) {
      var clickName = 'mlTimerClick_' + mid;
      var origClick = window[clickName];
      if (typeof origClick !== 'function') return; // safe guard
      window[clickName] = function() {
        var res;
        try { res = origClick.apply(this, arguments); } catch(e) {}
        setTimeout(function() { syncHumanState(mid); }, 50);
        return res;
      };
    });
  }

  function syncHumanState(mid) {
    var btn = document.getElementById('ml-timer-' + mid);
    if (!btn) return;
    if (btn.classList.contains('finished') || btn.textContent.indexOf('FIN') !== -1) {
      setScoreState(mid, 'finished');
    } else if (btn.classList.contains('running')) {
      setScoreState(mid, 'playing');
    } else {
      // If timer has been started at least once (seconds > 0), keep as pending
      // We use a data attribute to track "ever started"
      var ever = btn.getAttribute('data-ever-started');
      if (ever) {
        setScoreState(mid, 'pending'); // paused but not finished
      }
    }
  }

  /* Patch IA simulate functions (j1m4-j1m10) */
  function patchIASimulate() {
    ['j1m4','j1m5','j1m6','j1m7','j1m8','j1m9','j1m10'].forEach(function(mid) {
      var simName = 'mlSimulate_' + mid;
      var origSim = window[simName];
      if (typeof origSim !== 'function') return;
      window[simName] = function() {
        setScoreState(mid, 'playing');
        var res = origSim.apply(this, arguments);
        // After ~30s simulation finishes (max sim time is ~30500ms)
        setTimeout(function() { setScoreState(mid, 'finished'); }, 31000);
        return res;
      };
    });
  }

  /* Watch timer buttons for human matches via MutationObserver */
  function watchTimerBtns() {
    ['j1m1','j1m2','j1m3'].forEach(function(mid) {
      var btn = document.getElementById('ml-timer-' + mid);
      if (!btn) return;
      var obs = new MutationObserver(function() {
        if (btn.classList.contains('finished') || btn.textContent.indexOf('FIN') !== -1) {
          setScoreState(mid, 'finished');
        } else if (btn.classList.contains('running')) {
          btn.setAttribute('data-ever-started','1');
          setScoreState(mid, 'playing');
        } else {
          var ever = btn.getAttribute('data-ever-started');
          if (!ever) setScoreState(mid, 'pending');
          // If paused, keep current (playing→paused still shows red is fine,
          // but let's keep grey until first start)
        }
      });
      obs.observe(btn, { attributes: true, characterData: true, subtree: true, childList: true });
    });
  }

  /* Watch IA timer btn text for "FIN" */
  function watchIATimers() {
    ['j1m4','j1m5','j1m6','j1m7','j1m8','j1m9','j1m10'].forEach(function(mid) {
      var btn = document.getElementById('ml-timer-' + mid);
      if (!btn) return;
      var obs = new MutationObserver(function() {
        var txt = btn.textContent || '';
        if (txt.indexOf('FIN') !== -1 || btn.classList.contains('finished')) {
          setScoreState(mid, 'finished');
        } else if (txt.indexOf('SIMULAR') === -1 && txt !== '') {
          // Simulation running
          setScoreState(mid, 'playing');
        }
      });
      obs.observe(btn, { attributes: true, characterData: true, subtree: true, childList: true });
    });
  }

  /* ─────────────────────────────────────────────────
     2. MODAL DE EDICIÓN DE EVENTOS
     ─────────────────────────────────────────────── */
  var _editState = { mid: null, evId: null };

  var ICONS = {
    gol:'⚽', propia:'⚽🚫', 'pen-gol':'⚽🥅', 'pen-fallo':'❌🥅',
    'pen-prov':'🤦🥅', 'pen-parado':'🖐🥅', 'falta-gol':'⚽🎯',
    amarilla:'🟨', 'd-amarilla':'🟨🟥', roja:'🟥', lesion:'🩹', mvp:'⭐'
  };
  var SCORING = ['gol','propia','pen-gol','falta-gol'];

  /* Get _events array for a given match (they live in separate scopes,
     but are exposed on the match's HTML via a registry we build) */
  function getEventsRegistry() {
    if (!window._matchEventsRegistry) window._matchEventsRegistry = {};
    return window._matchEventsRegistry;
  }

  /* ─────────────────────────────────────────────────
     REGISTRY: captura referencias vivas a _events y _sc
     de cada partido humano parcheando sus funciones
     ─────────────────────────────────────────────── */
  window.__eventsRegistry = {};

  function buildEventsRegistry() {
    ['j1m1','j1m2','j1m3'].forEach(function(mid) {

      // Patch mlPlConfirm (player-picker confirm) to register live refs
      var origConfirm = window['mlPlConfirm_' + mid];
      if (typeof origConfirm === 'function') {
        window['mlPlConfirm_' + mid] = function(num, name) {
          origConfirm.apply(this, arguments);
          // After push, snapshot the live arrays via the del function closure trick
          _captureRegistry(mid);
        };
      }

      // Patch mlDelEvt to register live refs (it has access to _events/_sc in closure)
      var origDel = window['mlDelEvt_' + mid];
      if (typeof origDel === 'function') {
        window['mlDelEvt_' + mid] = function(id) {
          origDel.apply(this, arguments);
          _captureRegistry(mid);
        };
      }

      // Also patch _renderActa to expose it globally for the save function
      var origRender = window['_renderActa_' + mid];
      if (typeof origRender === 'function') {
        window['_renderActa_' + mid] = function() {
          var res = origRender.apply(this, arguments);
          _captureRegistry(mid);
          return res;
        };
      }
    });
  }

  /* Capture the live _events array and _sc object by reading from the DOM
     and keeping a registry that _saveEditModal can mutate directly.
     Since we can't access the IIFE vars, we maintain a PARALLEL registry
     that stays in sync via patched functions. */
  function _captureRegistry(mid) {
    // Read current state from DOM
    var list = document.getElementById('ml-acta-list-' + mid);
    if (!list) return;
    var items = list.querySelectorAll('.ml-evt-item');
    var events = [];
    items.forEach(function(item) {
      var delBtn = item.querySelector('.ml-evt-del');
      // Lee data-id directamente; soporta ids string (window._evtId())
      // y números legacy. Fallback al onclick si no hay data-id.
      var rawId = item.getAttribute('data-id');
      var id = null;
      if (rawId !== null && rawId !== '') {
        id = /^-?\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
      } else if (delBtn) {
        var oc = delBtn.getAttribute('onclick') || '';
        var mNum = oc.match(/\((\d+)\)/);
        if (mNum) id = parseInt(mNum[1], 10);
        else { var mStr = oc.match(/\(['"]([^'"]+)['"]\)/); if (mStr) id = mStr[1]; }
      }
      if (id === null || id === '') return;
      var minEl  = item.querySelector('.ml-evt-min');
      var icoEl  = item.querySelector('.ml-evt-ico');
      var nameEl = item.querySelector('.ml-evt-name');
      var minTxt = minEl ? minEl.textContent.replace("'",'').trim() : '0';
      var nameTxt = nameEl ? nameEl.textContent.trim() : '';
      var dotPos = nameTxt.indexOf('. ');
      var num  = dotPos !== -1 ? nameTxt.slice(0, dotPos).trim() : '';
      var name = dotPos !== -1 ? nameTxt.slice(dotPos + 2).trim() : nameTxt;
      var scAEl = document.getElementById('sc-' + mid + '-a');
      var scBEl = document.getElementById('sc-' + mid + '-b');
      events.push({
        id: id,
        min: parseInt(minTxt) || 0,
        type: item.getAttribute('data-type') || '',
        team: item.getAttribute('data-team') || 'a',
        ico: icoEl ? icoEl.textContent.trim() : '',
        num: num,
        name: name
      });
      if (!window.__eventsRegistry[mid]) {
        window.__eventsRegistry[mid] = { events: events, sc: {a:0,b:0}, renderActa: null };
      }
    });
    // Recalculate score from events
    var sa = 0, sb = 0;
    events.forEach(function(ev) {
      var scoring = ['gol','propia','pen-gol','falta-gol'];
      if (scoring.indexOf(ev.type) !== -1) {
        var st = ev.type === 'propia' ? (ev.team === 'a' ? 'b' : 'a') : ev.team;
        if (st === 'a') sa++; else sb++;
      }
    });
    if (!window.__eventsRegistry[mid]) {
      window.__eventsRegistry[mid] = { events: [], sc: {a:0,b:0}, renderActa: null };
    }
    window.__eventsRegistry[mid].events = events;
    window.__eventsRegistry[mid].sc = {a: sa, b: sb};
    window.__eventsRegistry[mid].renderActa = window['_renderActa_' + mid];
  }

  /* Read events from DOM (data-team, data-type already set + we need id from onclick) */
  function getEventsFromDOM(mid) {
    var list = document.getElementById('ml-acta-list-' + mid);
    if (!list) return [];
    var items = list.querySelectorAll('.ml-evt-item');
    var evs = [];
    items.forEach(function(item) {
      var editBtn = item.querySelector('.ml-evt-edit');
      var delBtn  = item.querySelector('.ml-evt-del');
      if (!editBtn && !delBtn) return;
      // El id se lee de data-id (más robusto que parsear el onclick).
      // Soporta tanto strings (formato `<ms36>-<rand>` del helper
      // window._evtId() introducido para que el merge backend pueda
      // unionar eventos por id entre dispositivos) como números legacy.
      var rawId = item.getAttribute('data-id');
      var id = null;
      if (rawId !== null && rawId !== '') {
        id = /^-?\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
      } else {
        // Fallback legacy: extraer del onclick. Soporta `(123)` y `('abc')`.
        var oc = delBtn ? (delBtn.getAttribute('onclick')||'') : '';
        var mNum = oc.match(/\((\d+)\)/);
        if (mNum) {
          id = parseInt(mNum[1], 10);
        } else {
          var mStr = oc.match(/\(['"]([^'"]+)['"]\)/);
          if (mStr) id = mStr[1];
        }
      }
      var minEl   = item.querySelector('.ml-evt-min');
      var icoEl   = item.querySelector('.ml-evt-ico');
      var nameEl  = item.querySelector('.ml-evt-name');
      var teamEl  = item.querySelector('.ml-evt-team');
      var minTxt  = minEl ? minEl.textContent.replace("'",'').trim() : '0';
      var nameTxt = nameEl ? nameEl.textContent.trim() : '';
      var numPart = nameTxt.split('.')[0] || '';
      var namePart = nameTxt.indexOf('. ') !== -1 ? nameTxt.split('. ').slice(1).join('. ') : nameTxt;
      evs.push({
        id: id,
        min: parseInt(minTxt)||0,
        type: item.getAttribute('data-type') || '',
        team: item.getAttribute('data-team') || 'a',
        ico: icoEl ? icoEl.textContent.trim() : '',
        num: numPart.trim(),
        name: namePart.trim(),
        teamLabel: teamEl ? teamEl.textContent.trim() : ''
      });
    });
    return evs;
  }

  /* Get squads for a match */
  function getSquadsForMatch(mid) {
    var sqA = [], sqB = [], nameA = '', nameB = '';
    var scA = document.getElementById('sc-' + mid + '-a');
    if (scA) {
      var header = scA.closest('.ml-header');
      if (header) {
        var names = header.querySelectorAll('.ml-team-name');
        if (names[0]) nameA = names[0].textContent.trim();
        if (names[1]) nameB = names[1].textContent.trim();
      }
    }
    // Try SQUAD_REGISTRY first
    if (nameA && window.SQUAD_REGISTRY && window.SQUAD_REGISTRY[nameA]) sqA = window.SQUAD_REGISTRY[nameA];
    else if (window['_sqA_' + mid]) sqA = window['_sqA_' + mid];
    if (nameB && window.SQUAD_REGISTRY && window.SQUAD_REGISTRY[nameB]) sqB = window.SQUAD_REGISTRY[nameB];
    else if (window['_sqB_' + mid]) sqB = window['_sqB_' + mid];
    return { sqA: sqA, sqB: sqB, nameA: nameA, nameB: nameB };
  }

  /* Build optgroup options for a squad array (legacy <select>, kept para
     back-compat). El picker actual (overlay #_editPlOv) usa
     _editBuildPickerList directamente. */
  function buildSquadOptions(sq, teamName) {
    var html = '<optgroup label="——  ' + teamName + '  ——">';
    sq.forEach(function(p) {
      if (p.h) {
        html += '</optgroup><optgroup label="' + p.h + '">';
      } else {
        html += '<option value="' + p[0] + '|' + p[1].replace(/"/g,'&quot;') + '">' + p[0] + '. ' + p[1] + '</option>';
      }
    });
    html += '</optgroup>';
    return html;
  }

  /* When player selected from legacy <select>, fill manual field */
  window._onEditPlayerSel = function(val) {
    if (!val) return;
    var parts = val.split('|');
    var num = parts[0] || '';
    var name = parts.slice(1).join('|') || '';
    document.getElementById('_editManual').value = num + '. ' + name;
  };

  /* ───────────────────────────────────────────────────────────────────
     Picker overlay para «JUGADOR DE PLANTILLA» del modal EDITAR EVENTO.
     Reemplaza al <select> nativo (que en Samsung Internet descartaba la
     elección al primer toque, dejando el goleador erróneo — bug
     reportado 2026-05-24 con capturas Francia vs UAE).
     - Solo muestra los jugadores del equipo actualmente seleccionado
       en #_editTeam.
     - Soporta selecciones nacionales (los teams se buscan en
       SQUAD_REGISTRY o se hidratan desde selecciones_squad_v1 via
       sqFromRegistry).
     - Incluye «➕ AÑADIR JUGADOR NUEVO A LA PLANTILLA» con dorsal,
       nombre y valor-poder. El alta persiste vía
       _addManualPlayerToRoster (ligaExt o selecciones).
     ─────────────────────────────────────────────────────────────────── */
  window._editPickerCtx = {
    teamA: { name: '', sq: [] },
    teamB: { name: '', sq: [] },
    current: 'a'
  };

  function _editBuildPickerList() {
    var ctx = window._editPickerCtx || { teamA:{}, teamB:{}, current:'a' };
    var team = (ctx.current === 'b') ? ctx.teamB : ctx.teamA;
    var teamEl = document.getElementById('_editPlOv-team');
    if (teamEl) teamEl.textContent = team && team.name ? team.name : (ctx.current === 'b' ? 'Visitante' : 'Local');
    var listEl = document.getElementById('_editPlOv-list');
    if (!listEl) return;
    var sq = (team && team.sq) ? team.sq : [];
    var html = '';
    for (var i = 0; i < sq.length; i++) {
      var p = sq[i];
      if (!p) continue;
      if (p.h) {
        html += '<div class="ml-pl-ov-sec">' + p.h + '</div>';
      } else if (Array.isArray(p) && p.length >= 2) {
        var n = String(p[0] == null ? '' : p[0]).replace(/'/g, "\\'");
        var nmEsc = String(p[1] == null ? '' : p[1]).replace(/'/g, "\\'");
        var nDisp = String(p[0] == null ? '' : p[0]);
        var nmDisp = String(p[1] == null ? '' : p[1])
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += '<button class="ml-pl-ov-btn" type="button" onclick="window._editPickPl(\'' + n + '\',\'' + nmEsc + '\')">'
          + '<span class="ml-pl-ov-num">' + nDisp + '</span>'
          + '<span class="ml-pl-ov-name">' + nmDisp + '</span>'
          + '</button>';
      }
    }
    if (!html) {
      html = '<div style="text-align:center;color:rgba(255,255,255,.5);padding:30px 12px;font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;">⚠️ Sin jugadores en la plantilla de este equipo.<br><br>Cierra y usa «➕ AÑADIR JUGADOR NUEVO» en el modal para sembrar la plantilla.</div>';
    }
    listEl.innerHTML = html;
  }

  window._editOpenPlOv = function() {
    _editBuildPickerList();
    var ov = document.getElementById('_editPlOv');
    if (ov) ov.classList.add('show');
  };
  window._editClosePlOv = function() {
    var ov = document.getElementById('_editPlOv');
    if (ov) ov.classList.remove('show');
  };
  window._editPickPl = function(num, name) {
    var n = String(num == null ? '' : num).trim();
    var nm = String(name == null ? '' : name).trim();
    var manual = n ? (n + '. ' + nm) : nm;
    var mEl = document.getElementById('_editManual');
    if (mEl) mEl.value = manual;
    var btn = document.getElementById('_editPlPick');
    if (btn) btn.textContent = '✓ ' + manual;
    /* También actualizamos el <select> oculto para que el workaround
       de _saveEditModal (que prefiere _editPlayerSel.value sobre el
       campo manual) siga funcionando si quedara código que lo lea. */
    var sel = document.getElementById('_editPlayerSel');
    if (sel) {
      var v = n + '|' + nm;
      sel.innerHTML = '<option value="' + v.replace(/"/g,'&quot;') + '" selected>' + (n ? (n + '. ') : '') + nm + '</option>';
      try { sel.value = v; } catch(_){}
    }
    window._editClosePlOv();
  };

  /* Si el usuario escribe en #_editManual, la elección previa del picker
     queda obsoleta — limpiamos _editPlayerSel.value (el workaround de
     _saveEditModal lo prefiere sobre manualVal cuando tiene valor) y
     reseteamos el botón. Sin esto, una edición manual posterior a un
     pick del picker se ignoraba al guardar. */
  window._onEditManualInput = function() {
    var sel = document.getElementById('_editPlayerSel');
    if (sel) {
      sel.innerHTML = '<option value=""></option>';
      try { sel.value = ''; } catch(_){}
    }
    var btn = document.getElementById('_editPlPick');
    if (btn) btn.textContent = '— Toca para elegir jugador —';
  };

  /* Cambio de equipo en el modal → repobla el picker con el roster del
     nuevo equipo y resetea el botón. NO limpia _editManual (el usuario
     puede haber escrito a mano). */
  window._onEditTeamChange = function(val) {
    var ctx = window._editPickerCtx || {};
    ctx.current = (val === 'b') ? 'b' : 'a';
    var btn = document.getElementById('_editPlPick');
    if (btn) btn.textContent = '— Toca para elegir jugador —';
    var sel = document.getElementById('_editPlayerSel');
    if (sel) { sel.innerHTML = '<option value=""></option>'; try { sel.value = ''; } catch(_){} }
    /* Si el overlay está abierto, refrescar la lista al vuelo. */
    var ov = document.getElementById('_editPlOv');
    if (ov && ov.classList.contains('show')) _editBuildPickerList();
  };

  /* Toggle del formulario «➕ AÑADIR JUGADOR NUEVO». */
  window._editAddNewToggle = function() {
    var form = document.getElementById('_editAddNewForm');
    if (!form) return;
    var isHidden = form.style.display === 'none' || !form.style.display;
    form.style.display = isHidden ? '' : 'none';
    if (isHidden) {
      var n = document.getElementById('_editNewNum'); if (n) n.value = '';
      var nm = document.getElementById('_editNewName'); if (nm) nm.value = '';
      var pw = document.getElementById('_editNewPw'); if (pw) pw.value = '';
      try { (document.getElementById('_editNewName') || {}).focus && document.getElementById('_editNewName').focus(); } catch(_){}
    }
  };

  /* Confirmar el alta del jugador nuevo → persiste en la plantilla del
     equipo (ligaExt o selecciones) y auto-selecciona en el picker. */
  window._editAddNewConfirm = function() {
    var ctx = window._editPickerCtx || {};
    var team = (ctx.current === 'b') ? ctx.teamB : ctx.teamA;
    if (!team || !team.name) { alert('⚠️ Selecciona primero el equipo del evento.'); return; }
    var num  = (document.getElementById('_editNewNum').value || '').trim();
    var name = (document.getElementById('_editNewName').value || '').trim();
    var pw   = (document.getElementById('_editNewPw').value || '').trim();
    if (!name) { alert('⚠️ Escribe el nombre del jugador.'); return; }
    var ok = window._addManualPlayerToRoster(team.name, name, num, pw);
    if (!ok) {
      alert('⚠️ Ese jugador ya existe en la plantilla, o el equipo «' + team.name + '» no se encontró en ligaExt ni en selecciones_squad_v1. Revísalo.');
      return;
    }
    /* Refrescar el roster cacheado del equipo desde el registry (que ya
       lee de selecciones_squad_v1 / ligaExt). Si no hay datos, append
       manual para feedback inmediato. */
    var refreshed = null;
    try {
      if (typeof window.sqFromRegistry === 'function') {
        refreshed = window.sqFromRegistry(team.name) || null;
      }
    } catch(_){}
    if (refreshed && refreshed.length) {
      team.sq = refreshed;
    } else {
      var arr = (team.sq || []).slice();
      arr.push([num || '', name]);
      team.sq = arr;
    }
    /* Auto-seleccionar al jugador recién creado. */
    window._editPickPl(num || '', name);
    /* Cerrar el form. */
    var form = document.getElementById('_editAddNewForm');
    if (form) form.style.display = 'none';
  };

  window._openEditModal = function(mid, evId) {
    var evs = getEventsFromDOM(mid);
    var ev  = evs.find(function(e){ return e.id === evId; });
    if (!ev) return;

    _editState.mid  = mid;
    _editState.evId = evId;

    // Set type, team, min
    document.getElementById('_editType').value = ev.type || 'gol';
    document.getElementById('_editMin').value  = ev.min  || 1;

    // Update team labels
    var sq = getSquadsForMatch(mid);
    var selTeam = document.getElementById('_editTeam');
    selTeam.options[0].text = (sq.nameA || 'Local') + ' (local)';
    selTeam.options[1].text = (sq.nameB || 'Visitante') + ' (visitante)';
    selTeam.value = ev.team || 'a';

    /* Configurar el picker overlay (filtrado por equipo del evento). El
       <select> nativo se mantiene oculto solo por back-compat. */
    window._editPickerCtx = {
      teamA: { name: sq.nameA || 'Local',     sq: sq.sqA || [] },
      teamB: { name: sq.nameB || 'Visitante', sq: sq.sqB || [] },
      current: ev.team || 'a'
    };
    var pkBtn = document.getElementById('_editPlPick');
    if (pkBtn) pkBtn.textContent = '— Toca para elegir jugador —';
    var legacySel = document.getElementById('_editPlayerSel');
    if (legacySel) {
      legacySel.innerHTML = '<option value="">— seleccionar jugador —</option>';
      try { legacySel.value = ''; } catch(_){}
    }
    var addForm = document.getElementById('_editAddNewForm');
    if (addForm) addForm.style.display = 'none';

    // Fill manual field with current num. name
    var manual = ev.num ? (ev.num + '. ' + ev.name) : ev.name;
    document.getElementById('_editManual').value = manual || '';

    var m = document.getElementById('_editModal');
    m.style.display = '';
    m.classList.add('show');
  };

  function updateTeamLabels(mid) {
    // kept for compatibility but now handled in _openEditModal
  }

  window._closeEditModal = function() {
    var m = document.getElementById('_editModal');
    if (m) { m.classList.remove('show'); m.style.display = 'none'; }
    _editState.mid  = null;
    _editState.evId = null;
  };

  /* Añade un jugador escrito manualmente en el acta (campo #_editManual)
     a la plantilla del equipo correspondiente. Busca primero en
     `ligaExt_<slug>.teams[i].players`; si no lo encuentra, intenta en
     `selecciones_squad_v1.teams[i].players` (selecciones nacionales —
     Francia, UAE, etc. usan ese store, NO ligaExt). Si ya existe un
     jugador con el mismo nombre normalizado, no se duplica. Persiste en
     localStorage y POSTea al servidor (best-effort).
     2026-05-24: añadido `power` (1-99) y fallback a selecciones_squad_v1
     para que el "+ AÑADIR JUGADOR NUEVO" del overlay de editar evento
     funcione también con selecciones nacionales. */
  window._addManualPlayerToRoster = function(teamName, playerName, dorsal, power) {
    if (!teamName || !playerName) return false;
    var nm = String(playerName).trim();
    if (!nm) return false;
    var dnum = String(dorsal == null ? '' : dorsal).trim();
    var pwNum = parseInt(power, 10);
    if (isNaN(pwNum) || pwNum < 1) pwNum = 0;
    if (pwNum > 99) pwNum = 99;
    function _norm(s){
      try {
        return String(s||'').toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g,' ').trim();
      } catch(_){
        return String(s||'').toLowerCase().trim();
      }
    }
    var canon = (typeof window.canonicalTeamName === 'function')
      ? window.canonicalTeamName(teamName) : String(teamName||'').trim();
    var targets = [_norm(teamName), _norm(canon)];
    var foundSlug = null, foundData = null, foundTeam = null;
    for (var i = 0; i < localStorage.length; i++) {
      var k;
      try { k = localStorage.key(i); } catch(_){ continue; }
      if (!k || k.indexOf('ligaExt_') !== 0) continue;
      if (/(_protected|_backup|_snap_\d+)$/.test(k)) continue;
      var raw;
      try { raw = localStorage.getItem(k); } catch(_){ continue; }
      if (!raw) continue;
      var data;
      try { data = JSON.parse(raw); } catch(_){ continue; }
      if (!data || !Array.isArray(data.teams)) continue;
      for (var ti = 0; ti < data.teams.length; ti++) {
        var t = data.teams[ti];
        if (!t || !t.name) continue;
        var nt = _norm(t.name);
        var ntCanon = (typeof window.canonicalTeamName === 'function')
          ? _norm(window.canonicalTeamName(t.name)) : nt;
        if (targets.indexOf(nt) !== -1 || targets.indexOf(ntCanon) !== -1) {
          foundSlug = k.slice('ligaExt_'.length);
          foundData = data;
          foundTeam = t;
          break;
        }
      }
      if (foundTeam) break;
    }
    /* Fallback: buscar en selecciones_squad_v1 (selecciones nacionales).
       2026-05-24. Sin esto, añadir jugador desde el overlay editar evento
       en partidos de Selecciones (Francia vs UAE, etc.) fallaba en
       silencio porque esos equipos no están en ligaExt_*. */
    var selData = null, selTeam = null;
    if (!foundTeam) {
      try {
        var selRaw = localStorage.getItem('selecciones_squad_v1');
        if (selRaw) {
          selData = JSON.parse(selRaw);
          if (selData && Array.isArray(selData.teams)) {
            for (var si = 0; si < selData.teams.length; si++) {
              var st = selData.teams[si];
              if (!st || !st.name) continue;
              var sn = _norm(st.name);
              var snCanon = (typeof window.canonicalTeamName === 'function')
                ? _norm(window.canonicalTeamName(st.name)) : sn;
              if (targets.indexOf(sn) !== -1 || targets.indexOf(snCanon) !== -1) {
                selTeam = st; break;
              }
            }
          }
        }
      } catch(_){}
    }
    var targetTeam = foundTeam || selTeam;
    if (!targetTeam) return false;
    if (!Array.isArray(targetTeam.players)) targetTeam.players = [];
    var nName = _norm(nm);
    for (var pi = 0; pi < targetTeam.players.length; pi++) {
      var p = targetTeam.players[pi];
      if (p && _norm(p.name) === nName) return false;
    }
    var newPlayer = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      name: nm,
      num: dnum,
      pos: '',
      power: pwNum,
      captain: false,
      freeKick: false,
      penalty: false,
      elite: false,
      natGoal: false,
      natGoalPro: false,
      pj: 0, gol: 0, pen: 0, fk: 0, mvp: 0, ta: 0, tr: 0, imbat: 0, penSaved: 0,
      manualFromActa: true
    };
    targetTeam.players.push(newPlayer);
    if (foundTeam) {
      try { localStorage.setItem('ligaExt_' + foundSlug, JSON.stringify(foundData)); } catch(_){}
      if (foundData.teams && foundData.teams.length > 0) {
        try { localStorage.setItem('ligaExt_' + foundSlug + '_protected', JSON.stringify(foundData)); } catch(_){}
      }
      try {
        if (typeof fetch === 'function') {
          fetch('/api/liga-ext/' + encodeURIComponent(foundSlug), {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({data: foundData})
          }).catch(function(){});
        }
      } catch(_){}
    } else if (selTeam && selData) {
      try { localStorage.setItem('selecciones_squad_v1', JSON.stringify(selData)); } catch(_){}
      try {
        if (typeof fetch === 'function') {
          fetch('/api/kv/selecciones_squad_v1', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({value: selData})
          }).catch(function(){});
        }
      } catch(_){}
      try { if (typeof window._selSquadHydrate === 'function') window._selSquadHydrate(); } catch(_){}
    }
    try {
      if (window.SQUAD_REGISTRY) {
        delete window.SQUAD_REGISTRY[targetTeam.name];
        if (canon) delete window.SQUAD_REGISTRY[canon];
        delete window.SQUAD_REGISTRY[teamName];
      }
    } catch(_){}
    try { window.__importLeaguesHash = ''; } catch(_){}
    if (typeof window._invalidateLineStatsCache === 'function') {
      try { window._invalidateLineStatsCache(); } catch(_){}
    }
    if (typeof window.applyEngineOverrides === 'function') {
      try { window.applyEngineOverrides(); } catch(_){}
    }
    return true;
  };

  window._saveEditModal = function() {
    var mid   = _editState.mid;
    var evId  = _editState.evId;
    if (!mid || !evId) return;

    var newType   = document.getElementById('_editType').value;
    var newTeam   = document.getElementById('_editTeam').value;
    var newMin    = parseInt(document.getElementById('_editMin').value) || 1;
    /* Bug 2026-05-24: en algunos navegadores móviles (Samsung Internet)
       el onchange del <select id="_editPlayerSel"> no dispara al elegir
       un jugador → _onEditPlayerSel no rellena _editManual → el guardado
       leía el nombre antiguo y el cambio "se quedaba" en el goleador
       erróneo. Fix: si el dropdown tiene un valor (no placeholder) lo
       usamos como verdad por encima del campo manual. */
    var _selPlEl = document.getElementById('_editPlayerSel');
    var _pickedVal = (_selPlEl && _selPlEl.value) ? String(_selPlEl.value) : '';
    var manualVal = document.getElementById('_editManual').value.trim();
    if (_pickedVal) {
      var _pParts = _pickedVal.split('|');
      var _pNum = _pParts[0] || '';
      var _pName = _pParts.slice(1).join('|') || '';
      if (_pName) manualVal = (_pNum ? (_pNum + '. ' + _pName) : _pName);
    }

    if (!manualVal) { alert('⚠️ Escribe el jugador manualmente o selecciónalo de la plantilla.'); return; }

    var newNum = '', newName = '';
    var dotIdx = manualVal.indexOf('. ');
    if (dotIdx !== -1) {
      newNum  = manualVal.slice(0, dotIdx).trim();
      newName = manualVal.slice(dotIdx + 2).trim();
    } else {
      newName = manualVal;
    }
    if (!newName) { alert('⚠️ El nombre del jugador es obligatorio.'); return; }

    /* Si el nombre escrito a mano no coincide con ningún jugador de la
       plantilla, persistirlo: queda guardado para futuros partidos sin
       tener que reescribirlo. Sin dorsal/pos/power — el admin los
       completa luego desde el editor. */
    try {
      var _sqInfo = getSquadsForMatch(mid);
      var _teamFullName = newTeam === 'a' ? _sqInfo.nameA : _sqInfo.nameB;
      if (_teamFullName) window._addManualPlayerToRoster(_teamFullName, newName, newNum);
    } catch(_){}

    var humanMids = ['j1m1','j1m2','j1m3'];
    if (humanMids.indexOf(mid) !== -1) {
      // Step 1: delete old event — correctly updates internal _events[] and _sc{}
      var delFn = window['mlDelEvt_' + mid];
      if (typeof delFn === 'function') delFn(evId);

      // Step 2: inject the new event directly using mlPlConfirm after setting _pendingEvt
      // via mlDirectPick (which sets the IIFE-scoped _pendingEvt), then suppress the UI.
      // We temporarily replace mlShowPl to be a no-op so no picker overlay opens,
      // and replace _currentMin to return our desired minute.
      var origShowPl   = window['mlShowPl_' + mid];
      var origMinFn    = window['_currentMin_' + mid];

      window['mlShowPl_' + mid]    = function() {}; // suppress picker UI
      window['_currentMin_' + mid] = function() { return newMin; };

      // mlDirectPick sets scoped _pendingEvt then calls mlShowPl (now no-op)
      var directPickFn = window['mlDirectPick_' + mid];
      if (typeof directPickFn === 'function') directPickFn(ICONS[newType] || newType, newType, newTeam);

      // mlPlConfirm reads the scoped _pendingEvt and pushes to _events[]
      var confirmFn = window['mlPlConfirm_' + mid];
      if (typeof confirmFn === 'function') confirmFn(newNum || '0', newName);

      // Restore patched functions
      window['mlShowPl_' + mid]    = origShowPl;
      window['_currentMin_' + mid] = origMinFn;

      window._closeEditModal();
      return;
    }

    // Fallback para partidos dinámicos (HvIA, IA-vs-Humano en Liga/Copa/
    // amistosos): usa el estado real `_mlStates[mid]` y NO solo el DOM.
    // Antes esto llamaba a `injectEventDOM` que solo pintaba un `<div>`
    // en la lista del acta → la edición "desaparecía" al siguiente
    // poll/re-render porque el array `st.events` se quedaba sin
    // actualizar. Ahora editamos in-place (mismo id) y sincronizamos
    // vía _liveStore para que el otro móvil vea el cambio.
    var st = (typeof window._mlGetState === 'function') ? window._mlGetState(mid) : null;
    if (st && Array.isArray(st.events)) {
      var idx = -1, oldEvt = null;
      for (var k = 0; k < st.events.length; k++) {
        if (st.events[k] && String(st.events[k].id) === String(evId)) {
          idx = k; oldEvt = st.events[k]; break;
        }
      }
      if (idx >= 0 && oldEvt) {
        // Ajustar marcador: restar el gol antiguo si aplicaba, sumar el
        // nuevo si aplica. Tipos que cuentan como gol directo al equipo:
        var DIRECT = {'gol':1,'falta-gol':1,'pen-gol':1};
        function scMove(type, team, sign) {
          if (!st.sc) st.sc = {a:0,b:0};
          if (DIRECT[type]) {
            st.sc[team] = Math.max(0, (st.sc[team]||0) + sign);
          } else if (type === 'propia') {
            var other = (team === 'a') ? 'b' : 'a';
            st.sc[other] = Math.max(0, (st.sc[other]||0) + sign);
          }
        }
        scMove(oldEvt.type, oldEvt.team, -1);
        scMove(newType, newTeam, +1);
        // Reflejar marcador en la UI
        var scA_el = document.getElementById('sc-'+mid+'-a');
        var scB_el = document.getElementById('sc-'+mid+'-b');
        if (scA_el) scA_el.textContent = st.sc.a || 0;
        if (scB_el) scB_el.textContent = st.sc.b || 0;

        // Actualizar el evento en su sitio (conservando id para que el
        // merge backend por id funcione y no duplique).
        var ICO_MAP = { gol:'⚽', propia:'🚫⚽', 'falta-gol':'🎯⚽',
          'pen-gol':'🥅⚽', 'pen-fallo':'❌🥅', 'pen-prov':'🤦🥅',
          'pen-parado':'🖐🥅', amarilla:'🟨', 'd-amarilla':'🟨🟥',
          damarilla:'🟨🟥', roja:'🟥', lesion:'🩹', mvp:'⭐' };
        oldEvt.type = newType;
        oldEvt.team = newTeam;
        oldEvt.min  = newMin;
        oldEvt.num  = newNum;
        oldEvt.name = newName;
        oldEvt.player = newName; // algunos paths usan `player`, otros `name`
        oldEvt.ico  = ICO_MAP[newType] || oldEvt.ico || '📋';
        oldEvt.label = ICO_MAP[newType] ? oldEvt.label : (oldEvt.label || newType);

        // Redibujar la fila del acta: quitamos la antigua y la volvemos
        // a insertar (reutiliza el mismo id, así los handlers de editar/
        // borrar siguen válidos).
        var list = document.getElementById('ml-acta-list-' + mid);
        if (list) {
          var oldRow = list.querySelector('.ml-evt-item[data-id="' + String(oldEvt.id).replace(/"/g,'') + '"]');
          if (oldRow && oldRow.parentNode) oldRow.parentNode.removeChild(oldRow);
        }
        var teamLabel = newTeam === 'a' ? (st.home || 'Local') : (st.away || 'Visitante');
        if (typeof window._mlAddActaRow === 'function') {
          try { window._mlAddActaRow(mid, newMin, oldEvt.ico, newName, newNum, teamLabel, newType, oldEvt.id); } catch(_){}
        }

        // Sincronizar con el servidor para que los otros dispositivos
        // vean la edición (merge por id en backend).
        if (window._liveStore && typeof window._liveStore.save === 'function') {
          try { window._liveStore.save(); } catch(_){}
        }
        window._closeEditModal();
        return;
      }
    }

    // Último recurso si no hay estado (partido muy legacy o error):
    // borrar + inyectar en DOM (no persiste, pero al menos no rompe).
    var delFnIA = window['mlDelEvt_' + mid];
    if (typeof delFnIA === 'function') delFnIA(evId);
    injectEventDOM(mid, newType, newTeam, newMin, newNum, newName);
    window._closeEditModal();
  };

  /* Inject event directly into DOM as fallback */
  function injectEventDOM(mid, type, team, min, num, name) {
    var list = document.getElementById('ml-acta-list-' + mid);
    if (!list) return;
    var emp = list.querySelector('.ml-acta-empty');
    if (emp) emp.remove();
    var ico = ICONS[type] || '•';
    var scA = document.getElementById('sc-' + mid + '-a');
    var header = scA ? scA.closest('.ml-header') : null;
    var names = header ? header.querySelectorAll('.ml-team-name') : [];
    var teamLabel = team === 'a' ? (names[0] ? names[0].textContent : 'Local') : (names[1] ? names[1].textContent : 'Visitante');
    var newId = Date.now();
    var row = document.createElement('div');
    row.className = 'ml-evt-item';
    row.setAttribute('data-team', team);
    row.setAttribute('data-type', type);
    row.innerHTML = '<span class="ml-evt-min">'+min+"'</span>"
      + '<span class="ml-evt-ico">'+ico+'</span>'
      + '<span class="ml-evt-name">'+num+'. '+name+'</span>'
      + '<span class="ml-evt-team">'+teamLabel+'</span>'
      + '<button class="ml-evt-edit" onclick="window._openEditModal(\''+mid+'\','+newId+')" title="Editar">🖍</button>'
      + '<button class="ml-evt-del" onclick="mlDelEvt_'+mid+'('+newId+')">✕</button>';
    // Insert in sorted position
    var items = list.querySelectorAll('.ml-evt-item');
    var inserted = false;
    for (var i = 0; i < items.length; i++) {
      var m = parseInt((items[i].querySelector('.ml-evt-min')||{}).textContent||'999');
      if (min < m) { list.insertBefore(row, items[i]); inserted = true; break; }
    }
    if (!inserted) list.appendChild(row);
  }

  /* Expose _pushEvent_jXmX for each human match so saveEditModal can use it.
     This function needs to access the match's closed-scope _events and _sc.
     We do this by patching the existing render function which is in scope. */
  function exposePushEvent(mid) {
    /* We intercept _renderActa to capture the events reference.
       But since _events is a var in IIFE scope, we need another trick:
       We parse the current acta DOM to reconstruct score deltas. */

    /* The cleanest way without touching the original IIFE is to:
       1. Count current score from acta DOM
       2. After delFn removes the event, recalculate score from remaining events
       3. Push new event by calling the existing add pathway (mlDirectPick + mlPlConfirm) */

    window['_pushEvent_' + mid] = function(type, team, min, num, name) {
      /* Recalculate scores from DOM after deletion */
      setTimeout(function() {
        var list = document.getElementById('ml-acta-list-' + mid);
        if (!list) return;
        var items = list.querySelectorAll('.ml-evt-item');
        var sa = 0, sb = 0;
        items.forEach(function(item) {
          var t = item.getAttribute('data-type');
          var te = item.getAttribute('data-team');
          if (t === 'gol' || t === 'falta-gol' || t === 'pen-gol') {
            if (te === 'a') sa++; else sb++;
          } else if (t === 'propia') {
            if (te === 'a') sb++; else sa++;
          }
        });

        /* Now add the new event score contribution */
        var scoringTypes = ['gol','propia','pen-gol','falta-gol'];
        if (scoringTypes.indexOf(type) !== -1) {
          var st = (type === 'propia') ? (team === 'a' ? 'b' : 'a') : team;
          if (st === 'a') sa++; else sb++;
        }

        /* Update score display */
        var scAEl = document.getElementById('sc-' + mid + '-a');
        var scBEl = document.getElementById('sc-' + mid + '-b');
        if (scAEl) scAEl.textContent = sa;
        if (scBEl) scBEl.textContent = sb;

        /* Inject the event row */
        injectEventDOM(mid, type, team, min, num, name);

      }, 60);
    };
  }

  /* ─────────────────────────────────────────────────
     INIT — compatible con archivos locales (content://)
     ─────────────────────────────────────────────── */
  function _doInit() {
    initStates();
    patchIASimulate();
    watchIATimers();
    buildEventsRegistry();
    ['j1m1','j1m2','j1m3'].forEach(exposePushEvent);
  }

  // Ejecutar con múltiples estrategias para garantizar que funcione
  // en Android con content:// o file://
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(_doInit, 100);
    });
  } else {
    // Ya cargado (inline script ejecutado después del DOM)
    setTimeout(_doInit, 100);
  }

  // Close Twitch menus on outside click
  document.addEventListener('click', function() {
    document.querySelectorAll('.ml-twitch-menu.open').forEach(function(m){ m.classList.remove('open'); });
  });

  // Close modal on backdrop click
  document.getElementById('_editModal').addEventListener('click', function(e) {
    if (e.target === this) window._closeEditModal();
  });

})();


/* script block 26 */

(function(){

  // ══ STORES GLOBALES ══════════════════════════════════════════
  /* 2026-05-23 (cross-comp accumulation): YELLOW_STORE pasa a tener
     un único bucket __global que acumula amarillas de TODAS las
     competiciones (Liga + Copa + Europa + Mundialito + …). El ciclo
     es siempre 3 amarillas → 1 partido de sanción. Las claves de comp
     antiguas (YELLOW_STORE['liga'] etc.) ya no se escriben pero se
     mantienen leíbles para no romper save-games existentes.

     SANCION_STORE también pasa a tener un bucket único __global —
     array de { name, team, reason, remaining } — para que una sanción
     generada en Liga se vea (y se cumpla) en la próxima Copa o Champions.
     Cada confirmación del overlay pre-partido (_sancionConfirm) decrementa
     `remaining`; cuando llega a 0 la entrada se elimina.

     Torneos de verano + amistosos NO suman amarillas ni consumen sanción
     (ver EXCLUDED_COMPS más abajo). */
  window.YELLOW_STORE   = window.YELLOW_STORE   || {};  // acumulación amarillas (__global)
  window.SANCION_STORE  = window.SANCION_STORE  || {};  // sanciones pendientes pre-partido (__global)
  window._sancionShownFor = window._sancionShownFor || {};
  window._sancionConsumedFor = window._sancionConsumedFor || {};
  window._sancionCallback = null;
  window._spostCallback   = null;

  /* Competiciones EXCLUIDAS del sistema de sanciones (2026-05-23):
     torneos de verano (Soccer Champions Tour, Premier Summer Series,
     Trofeo Joan Gamper, Asian Tournament) + amistosos. No suman
     amarillas al contador, no generan sanción y no consumen sanciones
     pendientes — el jugador puede jugar aunque tenga sanción en Liga. */
  var EXCLUDED_COMPS = {
    'amistoso':1, 'torneo':1, 'torneos':1,
    'sct':1, 'jg':1, 'pss':1, 'asia':1, 'verano':1
  };

  // ══ CONFIG CICLOS POR COMPETICIÓN ════════════════════════════
  /* 2026-05-23: ciclo = 3 amarillas → 1 partido de sanción para
     TODAS las competiciones (antes era 3 en Liga y 2 en el resto).
     La acumulación es ahora CROSS-COMP (ver YELLOW_STORE.__global). */
  var COMP_CONFIG = {
    'liga':       { label:'Liga EA Sports',            ciclo:3, esFinal:false },
    'copa':       { label:'Copa del Rey',              ciclo:3, esFinal:false },
    'copa-fin':   { label:'Copa del Rey · Final',      ciclo:3, esFinal:true  },
    'sc':         { label:'Supercopa de España',       ciclo:3, esFinal:false },
    'sc-final':   { label:'Supercopa · Final',         ciclo:3, esFinal:true  },
    'usc':        { label:'UEFA Super Cup',            ciclo:3, esFinal:false },
    'usc-fin':    { label:'UEFA Super Cup · Final',    ciclo:3, esFinal:true  },
    'ucl':        { label:'Champions League',          ciclo:3, esFinal:false },
    'ucl-fin':    { label:'Champions League · Final',  ciclo:3, esFinal:true  },
    'uel':        { label:'Europa League',             ciclo:3, esFinal:false },
    'uel-fin':    { label:'Europa League · Final',     ciclo:3, esFinal:true  },
    'uecl':       { label:'Conference League',         ciclo:3, esFinal:false },
    'uecl-fin':   { label:'Conference League · Final', ciclo:3, esFinal:true  },
    'superliga':  { label:'Superliga',                 ciclo:3, esFinal:false },
    'inter':      { label:'Copa Intercontinental',     ciclo:3, esFinal:false },
    'inter-fin':  { label:'Intercontinental · Final',  ciclo:3, esFinal:true  },
    /* Añadidos 2026-05-23 para que toda comp "no de verano" acumule */
    'recopa':     { label:'Recopa',                    ciclo:3, esFinal:false },
    'recopa-fin': { label:'Recopa · Final',            ciclo:3, esFinal:true  },
    'mundial':    { label:'Mundialito de Clubes',      ciclo:3, esFinal:false },
    'mundial-fin':{ label:'Mundialito · Final',        ciclo:3, esFinal:true  },
    'eur-grupo':  { label:'Fase de grupos europea',    ciclo:3, esFinal:false },
    'eur-ko':     { label:'Eliminatoria europea',      ciclo:3, esFinal:false },
    'eur-fin':    { label:'Final europea',             ciclo:3, esFinal:true  },
    'sel':        { label:'Selecciones',               ciclo:3, esFinal:false },
    'sel-fin':    { label:'Selecciones · Final',       ciclo:3, esFinal:true  },
  };

  // ══ MAPEO BLOQUE-ID → COMP KEY ═══════════════════════════════
  function getCompFromBlockId(id) {
    if (!id) return null;
    if (id === 'cal-copa-fin')     return 'copa-fin';
    if (id === 'sc-final')         return 'sc-final';
    if (id === 'cal-usc-f')        return 'usc-fin';
    if (id === 'ucl-fin')          return 'ucl-fin';
    if (id === 'uel-fin')          return 'uel-fin';
    if (id === 'uecl-fin')         return 'uecl-fin';
    if (id === 'cal-inter-f')      return 'inter-fin';
    if (id === 'sc-semis')         return 'sc';
    if (id.startsWith('cal-sc-'))  return 'sc';
    if (id.startsWith('cal-usc-')) return 'usc';
    if (id.startsWith('cal-copa-'))return 'copa';
    if (id.startsWith('cal-l'))    return 'liga';
    if (id.startsWith('ucl-'))     return 'ucl';
    if (id.startsWith('uel-'))     return 'uel';
    if (id.startsWith('uecl-'))    return 'uecl';
    if (id.startsWith('cal-sl'))   return 'superliga';
    if (id.startsWith('cal-inter-'))return 'inter';
    return null;
  }

  // ══ SORTEO DE PARTIDOS DE SUSPENSIÓN ════════════════════════
  /* 2026-05-23 (petición usuario):
       · Doble amarilla → SIEMPRE 2 partidos (antes 1 ó 2 al 50%).
       · Roja directa → 2-15 partidos con histograma de buckets:
           60% → 2-3   (uniforme: 30% / 30%)
           25% → 4-6   (uniforme: 8.33% / 8.33% / 8.33%)
           10% → 7-10  (uniforme: 2.5% × 4)
            5% → 11-15 (uniforme: 1% × 5) */
  function sorteoDobleAmarilla() {
    return 2;
  }
  function sorteoRojaDirecta() {
    var r = Math.random();
    if (r < 0.60) return 2 + Math.floor(Math.random() * 2);   // 2-3
    if (r < 0.85) return 4 + Math.floor(Math.random() * 3);   // 4-6
    if (r < 0.95) return 7 + Math.floor(Math.random() * 4);   // 7-10
    return 11 + Math.floor(Math.random() * 5);                // 11-15
  }

  // ══ MOTOR: calcular sanciones de un partido ══════════════════
  // events: array de eventos del partido
  // humanTeam: 'a' o 'b' (el equipo humano)
  // teamName: nombre del equipo humano
  // compKey: clave de competición
  // Devuelve array de { name, team, reason, partidos, tipo }
  window.calcularSancionesPartido = function(events, humanTeam, teamName, compKey) {
    var result = [];
    if (!events || !events.length) return result;
    /* Torneos de verano + amistosos: no suman amarillas ni generan
       sanción (2026-05-23). */
    if (EXCLUDED_COMPS[compKey]) return result;

    var cfg = COMP_CONFIG[compKey] || { label: compKey, ciclo: 3, esFinal: false };
    /* Bucket global cross-comp para acumulación de amarillas. */
    var globalYS = window.YELLOW_STORE.__global = window.YELLOW_STORE.__global || {};
    var processedExpulsion = {};

    events.forEach(function(ev) {
      if (ev.team !== humanTeam) return;
      var key = ev.num + '::' + ev.name;

      // ── Amarilla simple ──
      if (ev.type === 'amarilla') {
        var playerKey = ev.name + '::' + teamName;
        if (!globalYS[playerKey]) globalYS[playerKey] = { name: ev.name, team: teamName, count: 0 };
        globalYS[playerKey].count++;

        // Comprobar si alcanzó ciclo (3 amarillas → 1 partido)
        if (globalYS[playerKey].count >= cfg.ciclo) {
          globalYS[playerKey].count = 0; // reset ciclo
          if (!processedExpulsion[key]) {
            processedExpulsion[key] = true;
            result.push({
              name: ev.name,
              team: teamName,
              tipo: 'acumulacion',
              reason: cfg.ciclo + ' 🟨 acumuladas (ciclo completado)',
              partidos: 1
            });
            _addSancion(ev.name, teamName, compKey, 'Ciclo de amarillas — 1 partido', 1);
          }
        }
      }

      // ── Doble amarilla (expulsión, NO suma ciclo) → SIEMPRE 2 partidos ──
      else if (ev.type === 'd-amarilla') {
        if (!processedExpulsion[key]) {
          processedExpulsion[key] = true;
          /* Si la alerta in-game ya hizo el sorteo, reusamos su
             valor para que el número del overlay live y el del
             post-partido coincidan. */
          var liveD = window._LIVE_SANCION_DRAW && window._LIVE_SANCION_DRAW[ev.name + '::' + teamName];
          var partidos = (liveD && liveD.type === 'd-amarilla') ? liveD.partidos : sorteoDobleAmarilla();
          result.push({
            name: ev.name,
            team: teamName,
            tipo: 'd-amarilla',
            reason: 'Doble amarilla — expulsión',
            partidos: partidos
          });
          _addSancion(ev.name, teamName, compKey, 'Doble amarilla — ' + partidos + (partidos === 1 ? ' partido' : ' partidos'), partidos);
        }
      }

      // ── Roja directa → 2-15 partidos (sorteoRojaDirecta) ──
      else if (ev.type === 'roja') {
        if (!processedExpulsion[key]) {
          processedExpulsion[key] = true;
          var liveR = window._LIVE_SANCION_DRAW && window._LIVE_SANCION_DRAW[ev.name + '::' + teamName];
          var pts = (liveR && liveR.type === 'roja') ? liveR.partidos : sorteoRojaDirecta();
          result.push({
            name: ev.name,
            team: teamName,
            tipo: 'roja',
            reason: 'Roja directa',
            partidos: pts
          });
          _addSancion(ev.name, teamName, compKey, 'Roja directa — ' + pts + ' partido' + (pts > 1 ? 's' : ''), pts);
        }
      }
    });

    /* Limpiar la cache live tras consumirla — evita que valores de
       este partido se filtren al siguiente si el jugador repite. */
    window._LIVE_SANCION_DRAW = {};
    return result;
  };

  /* _addSancion(player, team, comp, reason, partidos)
     Empuja la sanción a SANCION_STORE.__global con contador `remaining`.
     Si ya había una entrada del mismo jugador (sanción acumulada sobre
     otra sin cumplir), SUMA `partidos` al remaining para que cumpla
     ambas en serie. `comp` se conserva como `srcComp` solo para
     trazabilidad (la sanción se cumple en CUALQUIER comp no excluida). */
  function _addSancion(playerName, teamName, comp, reason, partidos) {
    var queue = window.SANCION_STORE.__global = window.SANCION_STORE.__global || [];
    var n = Math.max(1, parseInt(partidos, 10) || 1);
    var existing = null;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].name === playerName && queue[i].team === teamName) { existing = queue[i]; break; }
    }
    if (existing) {
      existing.remaining = (existing.remaining || 0) + n;
      existing.reason = reason;
      existing.srcComp = comp;
    } else {
      queue.push({ name: playerName, team: teamName, reason: reason, remaining: n, srcComp: comp });
    }
  }

  /* Decrementa la sanción de un jugador en 1 partido (lo "cumple").
     Cuando llega a 0, se elimina del store. compKey se ignora (la
     sanción es global cross-comp desde 2026-05-23) salvo que la comp
     esté EXCLUIDA, en cuyo caso NO se descuenta (los amistosos /
     torneos de verano no consumen sanción). */
  window.cumplirSancion = function(playerName, teamName, compKey) {
    if (EXCLUDED_COMPS[compKey]) return;
    var queue = window.SANCION_STORE.__global || [];
    for (var i = queue.length - 1; i >= 0; i--) {
      var s = queue[i];
      if (s.name === playerName && s.team === teamName) {
        s.remaining = (s.remaining || 1) - 1;
        if (s.remaining <= 0) queue.splice(i, 1);
      }
    }
  };

  /* Helper: lista de sanciones pendientes globales que aplican al
     partido actual. Filtra por equipos en juego (home/away). */
  window._sancionesPendientesPara = function(homeTeam, awayTeam) {
    var queue = window.SANCION_STORE.__global || [];
    if (!queue.length) return [];
    var normFn = window._ppNormTeam || function(s){ return String(s||'').toLowerCase(); };
    var nH = normFn(homeTeam || ''), nA = normFn(awayTeam || '');
    return queue.filter(function(s) {
      var nt = normFn(s.team || '');
      return nt === nH || nt === nA;
    });
  };

  /* ── Helpers de POSICIÓN (P/D/M/F) para agrupar lesionados/forma
     en BAJAS PARA EL PARTIDO (Foto 3 + Foto 5 2026-05-27).
     `_injPosOf(name, team?)` busca al jugador en SQUAD_REGISTRY y
     en TODAS las claves `ligaExt_*` del localStorage, devuelve el
     código P/D/M/F (Portero / Defensa / Medio / Delantero) o 'M'
     por defecto si no se encuentra. */
  window._injPosLabels = { P:'🧤 PORTEROS', D:'🛡 DEFENSAS', M:'⚙️ MEDIOS', F:'⚡ DELANTEROS' };
  window._injPosShort  = { P:'POR', D:'DEF', M:'MED', F:'DEL' };
  window._injPosOrder  = ['P','D','M','F'];
  window._injPosOf = function(playerName, teamHint){
    if (!playerName) return 'M';
    var tNorm = teamHint ? String(teamHint).trim().toLowerCase() : '';
    /* (1) SQUAD_REGISTRY del equipo conocido o de cualquiera. */
    try {
      if (window.SQUAD_REGISTRY) {
        var sr = window.SQUAD_REGISTRY;
        var keys = teamHint
          ? Object.keys(sr).filter(function(k){
              return String(k).trim().toLowerCase() === tNorm;
            })
          : Object.keys(sr);
        if (!keys.length) keys = Object.keys(sr);
        for (var i = 0; i < keys.length; i++){
          var arr = sr[keys[i]] || [];
          for (var j = 0; j < arr.length; j++){
            var p = arr[j];
            if (Array.isArray(p) && p[1] === playerName && p[2]) {
              var c = String(p[2]).toUpperCase().charAt(0);
              if (c==='P'||c==='D'||c==='M'||c==='F') return c;
            }
          }
        }
      }
    } catch(_){}
    /* (2) sqFromRegistryFull si tenemos team. */
    if (teamHint && typeof window.sqFromRegistryFull === 'function') {
      try {
        var full = window.sqFromRegistryFull(teamHint) || [];
        for (var k = 0; k < full.length; k++){
          var fp = full[k];
          if (Array.isArray(fp) && fp[1] === playerName && fp[2]) {
            var cc = String(fp[2]).toUpperCase().charAt(0);
            if (cc==='P'||cc==='D'||cc==='M'||cc==='F') return cc;
          }
        }
      } catch(_){}
    }
    /* (3) Escaneo de TODAS las ligaExt_* en localStorage. */
    try {
      for (var li = 0; li < localStorage.length; li++){
        var lk = localStorage.key(li);
        if (!lk || lk.indexOf('ligaExt_') !== 0) continue;
        if (lk.indexOf('_backup') !== -1) continue;
        var raw = localStorage.getItem(lk);
        if (!raw) continue;
        var data; try { data = JSON.parse(raw); } catch(_e){ continue; }
        var teams = (data && Array.isArray(data.teams)) ? data.teams : [];
        for (var ti = 0; ti < teams.length; ti++){
          var tm = teams[ti];
          if (!tm) continue;
          if (tNorm && String(tm.name||'').trim().toLowerCase() !== tNorm) continue;
          var pls = Array.isArray(tm.players) ? tm.players : [];
          for (var pi = 0; pi < pls.length; pi++){
            var pl = pls[pi];
            if (pl && pl.name === playerName && pl.pos) {
              var ccc = String(pl.pos).toUpperCase().charAt(0);
              if (ccc==='P'||ccc==='D'||ccc==='M'||ccc==='F') return ccc;
            }
          }
        }
      }
    } catch(_){}
    return 'M';
  };
  /* Agrupa una lista de objetos `{name, team?}` por posición y
     devuelve los grupos en orden POR→DEF→MED→DEL, vacíos eliminados. */
  window._injGroupByPos = function(items, getName, getTeam){
    var buckets = { P:[], D:[], M:[], F:[] };
    (items || []).forEach(function(it){
      var nm = getName ? getName(it) : (it && it.name);
      var tm = getTeam ? getTeam(it) : (it && (it.team || it.equipo));
      var c = window._injPosOf(nm, tm) || 'M';
      if (!buckets[c]) buckets[c] = [];
      buckets[c].push(it);
    });
    var out = [];
    window._injPosOrder.forEach(function(code){
      if (buckets[code] && buckets[code].length) {
        out.push({ code: code, label: window._injPosLabels[code], items: buckets[code] });
      }
    });
    return out;
  };

  // ══ OVERLAY PRE-PARTIDO ══════════════════════════════════════
  window.showSancionOverlay = function(compKey, blockId, onConfirm) {
    var cfg = COMP_CONFIG[compKey] || { label: compKey, esFinal: false };
    /* 2026-05-23: sanciones leídas del bucket __global (cross-comp).
       En FINALES no se aplica acumulación de amarillas — solo expulsiones —
       igual que antes. En torneos de verano / amistosos no se aplica
       NADA: el overlay no muestra sanciones (EXCLUDED_COMPS). */
    var isExcluded = !!EXCLUDED_COMPS[compKey];
    var sanciones = (!cfg.esFinal && !isExcluded && window.SANCION_STORE.__global) ? window.SANCION_STORE.__global : [];
    if (cfg.esFinal && !isExcluded && window.SANCION_STORE.__global) {
      /* En finales: las expulsiones (d-amarilla, roja) sí cuentan; las
         acumulaciones de amarillas NO. Filtramos por reason. */
      sanciones = window.SANCION_STORE.__global.filter(function(s){
        return !/acumulad/i.test(s.reason || '');
      });
    }
    var compLbl = document.getElementById('sancion-ov-comp-lbl');
    var warnEl  = document.getElementById('sancion-ov-warn');
    var listYel = document.getElementById('sancion-ov-list-yel');
    var listRed = document.getElementById('sancion-ov-list-red');
    var listInj = document.getElementById('sancion-ov-list-inj');
    if (!listYel) { if (onConfirm) onConfirm(); return; }

    // Añadir jornada/ronda al label de competición
    var ROUND_MAP = {
      'cal-l1':'J1','cal-l2':'J2','cal-l3':'J3','cal-l4':'J4',
      'cal-l5':'J5','cal-l6':'J6','cal-l7':'J7','cal-l8':'J8',
      'cal-l9':'J9','cal-l10':'J10','cal-l11':'J11','cal-l12':'J12',
      'cal-eu1':'Grupo J1','cal-eu2':'Grupo J2','cal-eu3':'Grupo J3','cal-eu4':'Grupo J4',
      'cal-copa-1r':'1ª Ronda','cal-copa-2r':'2ª Ronda','cal-copa-16':'Dieciseisavos',
      'cal-copa-8':'Octavos','cal-copa-4':'Cuartos','cal-copa-sf':'Semis','cal-copa-fin':'Final',
      'cal-sc-s':'Semis','sc-semis':'Semis','sc-final':'Final',
      'cal-usc-s':'Semis','cal-usc-f':'Final',
      'cal-rm1':'J1','cal-rm2':'J2','cal-rm3':'J3',
      'cal-sl1':'J1','cal-sl2':'J2','cal-sl3':'J3',
      'ucl-fin':'Final','uel-fin':'Final','uecl-fin':'Final','cal-inter-f':'Final'
    };
    var resolvedBlockId = blockId || window._ppBlockId || null;
    var compLabel = cfg.label;
    if (resolvedBlockId && ROUND_MAP[resolvedBlockId]) {
      compLabel += ' · ' + ROUND_MAP[resolvedBlockId];
    }
    if (compLbl) compLbl.textContent = compLabel;
    window._sancionCallback = onConfirm || null;

    /* ═══════════════════════════════════════════════════════════════
       FILTRO "SOLO EQUIPOS HUMANOS DEL PARTIDO"
       Pedido explícito del usuario: en BAJAS PARA EL PARTIDO solo
       deben aparecer bajas (sancionados/expulsados/lesionados) de los
       equipos humanos que disputan ESTE partido, no de toda la liga.
       · HvIA → solo el equipo humano.
       · HvH  → los dos equipos humanos.
       · IAvIA → no se usa este overlay (ya había early-return).
       Si tenemos contexto de partido pero esHumano falla por
       normalización (MAYÚSCULAS vienen de .ml-team-name), caemos a
       filtrar por los DOS equipos del partido — peor que solo el
       humano, pero MUCHO mejor que mostrar bajas de la liga entera.
       Sólo mostramos "todo" cuando no hay contexto de partido en
       absoluto (caso legacy). */
    var _matchTeams = (typeof window._ppGetCurrentMatchTeams === 'function')
      ? window._ppGetCurrentMatchTeams() : null;
    function _normTm(s){
      return (typeof window._ppNormTeam === 'function')
        ? window._ppNormTeam(s)
        : String(s||'').trim().toLowerCase();
    }
    /* Check tolerante a case + acentos contra HUMANOS / HUMANOS_AMS.
       esHumano() es estricto y falla con "ATLÉTICO MADRID" mientras
       HUMANOS guarda "Atlético Madrid". Aquí normalizamos ambos. */
    function _looseIsHuman(nm){
      if (!nm) return false;
      if (typeof window.esHumano === 'function' && window.esHumano(nm)) return true;
      var n = _normTm(nm);
      if (!n) return false;
      var hum = (window.HUMANOS || []).concat(window.HUMANOS_AMS || []);
      for (var i = 0; i < hum.length; i++) {
        if (_normTm(hum[i]) === n) return true;
      }
      return false;
    }
    var _allowedTeams = null;  /* null = sin filtro */
    if (_matchTeams) {
      _allowedTeams = [];
      if (_matchTeams.home && _looseIsHuman(_matchTeams.home)) _allowedTeams.push(_matchTeams.home);
      if (_matchTeams.away && _looseIsHuman(_matchTeams.away)) _allowedTeams.push(_matchTeams.away);
      if (!_allowedTeams.length) {
        /* Caso edge: partido conocido pero ningún equipo se detecta
           como humano por el loose check. Filtramos por los DOS
           equipos del partido para no mostrar bajas ajenas. */
        if (_matchTeams.home) _allowedTeams.push(_matchTeams.home);
        if (_matchTeams.away) _allowedTeams.push(_matchTeams.away);
      }
    }
    function _belongsToHumanOfMatch(teamName){
      if (!_allowedTeams) return true;        /* sin match context → no filtramos */
      if (!_allowedTeams.length) return false;/* match conocido pero vacío → no mostrar */
      var tn = _normTm(teamName);
      if (!tn) return false;
      for (var i = 0; i < _allowedTeams.length; i++) {
        var an = _normTm(_allowedTeams[i]);
        if (tn === an) return true;
        if (an && (tn.indexOf(an) !== -1 || an.indexOf(tn) !== -1)) return true;
      }
      return false;
    }

    // Separar sanciones por tipo — filtradas a los humanos del partido
    var san = sanciones.filter(function(s){
      if (!(s.tipo === 'amarilla' || !s.tipo)) return false;
      return _belongsToHumanOfMatch(s.team);
    });
    var exp = sanciones.filter(function(s){
      if (!(s.tipo === 'roja' || s.tipo === 'd-amarilla')) return false;
      return _belongsToHumanOfMatch(s.team);
    });


    function renderCard(s, ico) {
      var partidos = s.partidos ? s.partidos : null;
      return '<div class="sancion-card">'
        + '<div class="sancion-card-icon">' + ico + '</div>'
        + '<div class="sancion-card-info">'
        + '<div class="sancion-card-name">' + s.name + '</div>'
        + '<div class="sancion-card-team">' + s.team + '</div>'
        + '<div class="sancion-card-reason">' + s.reason + '</div>'
        + '</div>'
        + (partidos ? '<div class="sancion-card-partidos"><span class="sancion-card-pnum">' + partidos + '</span><span class="sancion-card-plbl">PARTIDO' + (partidos > 1 ? 'S' : '') + '</span></div>' : '')
        + '</div>';
    }
    function renderEmpty(txt) {
      return '<div class="sancion-empty">' + txt + '</div>';
    }

    // Lesionados desde LESION_STORE — filtrados a los humanos del partido
    var injList = window.LESION_STORE ? Object.keys(window.LESION_STORE).filter(function(nm){
      var l = window.LESION_STORE[nm];
      if (!l) return false;
      /* Solo lesiones con partidos pendientes (>0). Las que ya
         expiraron quedan en el store pero no se muestran. */
      if (!(Number(l.partidos) > 0)) return false;
      return _belongsToHumanOfMatch(l.equipo);
    }) : [];

    /* Foto 4 (2026-05-27): si SANCIONADOS / EXPULSADOS están vacíos,
       OCULTAMOS toda la sección (no se muestra "Sin sancionados"
       — el usuario no quiere ruido en pantalla). LESIONADOS sigue
       mostrándose siempre. */
    var secYel = listYel && listYel.parentNode;
    var secRed = listRed && listRed.parentNode;
    if (san.length) {
      listYel.innerHTML = san.map(function(s){ return renderCard(s,'🟨'); }).join('');
      if (secYel) secYel.style.display = '';
    } else if (secYel) {
      secYel.style.display = 'none';
    }
    if (exp.length) {
      listRed.innerHTML = exp.map(function(s){ return renderCard(s,'🟥'); }).join('');
      if (secRed) secRed.style.display = '';
    } else if (secRed) {
      secRed.style.display = 'none';
    }

    if (injList.length) {
      /* Foto 3 (2026-05-27): cards agrupadas por posición
         (POR/DEF/MED/DEL), icono real por grado (🩹/💉/🚑),
         label de posición en lugar del legacy "🇪🇸 1P 🏆 1P 🌍 1P"
         y botón 💊 PI debajo del recuadro "N PARTIDOS" para gastar
         inyecciones (athOpenMedicalMenu). */
      var _piAvail = 0;
      try { if (typeof window.athGetMedicalPI === 'function') _piAvail = Math.floor((window.athGetMedicalPI()||0) + 1e-9); } catch(_){}
      var injObjs = injList.map(function(nombre){
        return { name: nombre, equipo: (window.LESION_STORE[nombre] && window.LESION_STORE[nombre].equipo) || '' };
      });
      var grouped = window._injGroupByPos(injObjs,
        function(it){ return it.name; },
        function(it){ return it.equipo; }
      );
      listInj.innerHTML = grouped.map(function(grp){
        var hdr = '<div class="sancion-pos-hdr">' + grp.label + '</div>';
        var cards = grp.items.map(function(it){
          var nombre = it.name;
          var l = window.LESION_STORE[nombre];
          var colorGrado = l.grado === 3 ? '#ff4444' : l.grado === 2 ? '#ff8c00' : '#ffd700';
          var ico = l.gradoEmoji || (l.grado===3?'🚑':l.grado===2?'💉':'🩹');
          var rem = parseInt(l.partidos || 0, 10) || 0;
          var posShort = window._injPosShort[grp.code] || '';
          var pillDisabled = _piAvail <= 0;
          var pill = '<button type="button" class="sancion-card-pi"'
            + (pillDisabled
                ? ' disabled title="Sin PI disponibles"'
                : ' title="Gastar 💊 PI para recuperar al jugador"'
              )
            + ' onclick="event.stopPropagation();if(window.athOpenMedicalMenu)window.athOpenMedicalMenu();"'
            + '>💊 ' + _piAvail + '</button>';
          return '<div class="sancion-card">'
            + '<div class="sancion-card-icon">' + ico + '</div>'
            + '<div class="sancion-card-info">'
            + '<div class="sancion-card-name">' + nombre + '</div>'
            + '<div class="sancion-card-team">' + (l.equipo || '') + '</div>'
            + '<div class="sancion-card-reason" style="color:' + colorGrado + '">' + ico + ' ' + l.gradoNombre + ' — ' + l.descripcion + '</div>'
            + (posShort ? '<div class="sancion-card-pos">' + posShort + '</div>' : '')
            + '</div>'
            + '<div class="sancion-card-partidos-wrap">'
            +   '<div class="sancion-card-partidos"><span class="sancion-card-pnum" style="color:' + colorGrado + '">' + rem + '</span><span class="sancion-card-plbl">PARTIDO' + (rem===1?'':'S') + '</span></div>'
            +   pill
            + '</div>'
            + '</div>';
        }).join('');
        return hdr + cards;
      }).join('');
    } else {
      listInj.innerHTML = renderEmpty('🚑 Sin lesionados');
    }

    var hayBajas = san.length || exp.length || injList.length;
    // En modo "previa-share" SIEMPRE mostramos el overlay (aunque no haya bajas),
    // porque el botón de cerrar es el que dispara el WhatsApp.
    var forceShow = !!window._ppForceSancionShareMode;
    if (!hayBajas && !forceShow) {
      if (onConfirm) onConfirm();
      return;
    }
    if (warnEl) warnEl.style.display = hayBajas ? 'block' : 'none';

    /* Cambiar el botón de confirmar al modo "Compartir Partido en WhatsApp" */
    var okBtn = document.getElementById('sancion-ov-ok');
    if (okBtn) {
      if (forceShow) {
        okBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" style="vertical-align:middle;margin-right:8px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.554 4.122 1.528 5.855L0 24l6.336-1.508A11.948 11.948 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.014-1.374l-.36-.214-3.727.977.995-3.634-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>Compartir Partido en WhatsApp';
        okBtn.setAttribute('data-share-mode','1');
      } else {
        okBtn.textContent = '✓ ENTENDIDO';
        okBtn.removeAttribute('data-share-mode');
      }
    }

    document.getElementById('sancion-overlay').classList.add('show');
    window.scrollTo(0, 0);
  };

  window._sancionConfirm = function() {
    /* REORDEN 2026-05-15: el share de WhatsApp dispara `window.open` a
       una URL `https://chat.whatsapp.com/...` que en Android Chrome
       lanza el intent → la app de WhatsApp toma el foco y la pestaña
       original queda en background. Si la pestaña se pausa/throttlea
       o (con memoria baja) se mata antes de que gmOpen marque el
       gm-modal como `display:flex`, al volver el usuario NO ve la
       card de simulación y aparece la pantalla anterior (Grupos de
       UCL, etc.). Solución: abrir el gm-modal SÍNCRONAMENTE PRIMERO
       (vía _sancionCallback → _afterShare → _ppCustomCallback →
       abrirEurFase/abrirCopa/etc. → gmOpen) y SOLO DESPUÉS lanzar el
       share. Así el DOM queda con el modal visible antes del switch
       a WhatsApp y, al volver, el usuario sigue viendo la simulación. */
    var okBtn = document.getElementById('sancion-ov-ok');
    var shouldShare = !!(okBtn && okBtn.getAttribute('data-share-mode') === '1');
    window._ppForceSancionShareMode = false;
    /* 2026-05-23: al confirmar el overlay, descontamos 1 partido a las
       sanciones pendientes globales que aplican a los equipos del
       partido actual. Idempotente por matchKey — si el usuario reabre
       el overlay para el mismo partido, no se descuenta dos veces. */
    try {
      var mk = window._ppMatchKey || null;
      var comp = window._ppCompKey || null;
      if (mk && !window._sancionConsumedFor[mk] && !EXCLUDED_COMPS[comp]) {
        window._sancionConsumedFor[mk] = true;
        var teams = (typeof window._ppGetCurrentMatchTeams === 'function') ? window._ppGetCurrentMatchTeams() : null;
        if (teams && teams.home && teams.away) {
          var pend = window._sancionesPendientesPara(teams.home, teams.away);
          pend.forEach(function(s) {
            window.cumplirSancion(s.name, s.team, comp);
          });
        }
      }
    } catch(_){}
    document.getElementById('sancion-overlay').classList.remove('show');
    if (window._sancionCallback) { var _cb = window._sancionCallback; window._sancionCallback = null; try { _cb(); } catch(_){} }
    if (shouldShare) {
      try { if (typeof window._ppShareWA === 'function') window._ppShareWA(); } catch(_){}
    }
  };

  /* Volver: cierra el overlay BAJAS PARA EL PARTIDO y cancela el
     callback pendiente (no arranca el partido). Útil cuando el
     usuario entra en la previa por error o cambia de idea — antes
     no había forma de salir sin confirmar. */
  window._sancionVolver = function() {
    window._ppForceSancionShareMode = false;
    window._sancionCallback = null;
    var ov = document.getElementById('sancion-overlay');
    if (ov) ov.classList.remove('show');
  };

  // ══ OVERLAY POST-PARTIDO ═════════════════════════════════════
  window.showSancionPostOverlay = function(sanciones, compKey, onConfirm) {
    var cfg = COMP_CONFIG[compKey] || { label: compKey };
    var listEl  = document.getElementById('spost-list');
    var compLbl = document.getElementById('spost-comp-lbl');
    var subEl   = document.getElementById('spost-sub');
    var iconEl  = document.getElementById('spost-icon');
    if (!listEl) { if (onConfirm) onConfirm(); return; }

    window._spostCallback = onConfirm || null;
    compLbl.textContent = cfg.label;

    if (!sanciones || !sanciones.length) {
      // Sin sanciones — no mostrar overlay
      if (onConfirm) onConfirm();
      return;
    }

    // Icono según tipo de sanción más grave
    var tieneRoja = sanciones.some(function(s){ return s.tipo === 'roja'; });
    var tieneDAmr = sanciones.some(function(s){ return s.tipo === 'd-amarilla'; });
    iconEl.textContent = tieneRoja ? '🟥' : tieneDAmr ? '🟨🟥' : '🟨';
    subEl.textContent  = sanciones.length === 1 ? 'UN JUGADOR SANCIONADO' : sanciones.length + ' JUGADORES SANCIONADOS';

    listEl.innerHTML = sanciones.map(function(s) {
      var tipoLabel = s.tipo === 'roja'         ? 'ROJA DIRECTA'
                    : s.tipo === 'd-amarilla'    ? 'DOBLE AMARILLA'
                    : 'ACUMULACIÓN DE AMARILLAS';
      return '<div class="spost-card">'
        + '<div class="spost-card-badge">' + tipoLabel + '</div>'
        + '<div class="spost-card-ico">' + (s.tipo==='roja'?'🟥': s.tipo==='d-amarilla'?'🟨🟥':'🟨') + '</div>'
        + '<div class="spost-card-info">'
        + '<div class="spost-card-name">' + s.name + '</div>'
        + '<div class="spost-card-team">' + s.team + '</div>'
        + '<div class="spost-card-reason">' + s.reason + '</div>'
        + '</div>'
        + '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">'
        + '<div class="spost-card-partidos">' + s.partidos + '</div>'
        + '<div class="spost-card-partidos-lbl">PARTIDO' + (s.partidos > 1 ? 'S' : '') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    document.getElementById('sancion-post-overlay').classList.add('show');
    window.scrollTo(0, 0);
  };

  window._spostConfirm = function() {
    document.getElementById('sancion-post-overlay').classList.remove('show');
    if (window._spostCallback) { window._spostCallback(); window._spostCallback = null; }
  };

  // tog() sin intercepción de sanciones — los desplegables abren directamente
  // (el overlay de sanciones solo se muestra desde el botón PREVIA)

  // ══ HOOK EN mlEndMatch: llamar tras registrar resultado ══════
  // Se llama como: window.procesarSancionesPostPartido(events, humanTeam, teamName, compKey)
  window.procesarSancionesPostPartido = function(events, humanTeam, teamName, compKey) {
    var sanciones = window.calcularSancionesPartido(events, humanTeam, teamName, compKey);
    window.showSancionPostOverlay(sanciones, compKey, null);
  };

})();


/* script block 27 */

(function(){

  // ── PRE-PARTIDO OVERLAY ──────────────────────────────────────────
  var _ppMatchKey = null;
  var _ppCompKey  = null;
  var _ppChecked  = {};

  /* ── Helper global: obtener los 2 equipos del partido actual ── */
  window._ppGetCurrentMatchTeams = function() {
    var mk = _ppMatchKey;
    if (!mk) return null;
    var wrap = document.getElementById('mlw-' + mk);
    if (wrap) {
      var names = wrap.querySelectorAll('.ml-team-name');
      var h = ((names[0]||{}).textContent||'').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
      var a = ((names[1]||{}).textContent||'').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
      if (h && a) return { home: h, away: a };
    }
    if (window._ppPreviaTeams) return { home: window._ppPreviaTeams.home, away: window._ppPreviaTeams.away };
    return null;
  };

  /* ── Helper global: normalizar nombre de equipo para comparación ── */
  window._ppNormTeam = function(s) {
    return String(s||'').trim().toLowerCase()
      .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u').replace(/ñ/g,'n')
      .replace(/\s+cf$|\s+fc$|\s+ud$/i,'')
      .replace(/^(fc|cf|ud)\s+/,'');
  };

  /* ── Helper global: ¿un jugador pertenece a alguno de los 2 equipos del partido? ── */
  window._ppPlayerBelongsToMatch = function(playerName) {
    var teams = window._ppGetCurrentMatchTeams();
    if (!teams) return true; /* no match context → show everything (fallback) */
    var normHome = window._ppNormTeam(teams.home);
    var normAway = window._ppNormTeam(teams.away);
    function matches(teamName) {
      var nt = window._ppNormTeam(teamName);
      return nt === normHome || nt === normAway
        || (nt && (nt.indexOf(normHome) !== -1 || normHome.indexOf(nt) !== -1))
        || (nt && (nt.indexOf(normAway) !== -1 || normAway.indexOf(nt) !== -1));
    }
    /* LESION_STORE.equipo */
    var les = window.LESION_STORE && window.LESION_STORE[playerName];
    if (les && les.equipo && matches(les.equipo)) return true;
    /* SANCION_STORE[comp][i].team */
    var sancionStore = window.SANCION_STORE || {};
    for (var comp in sancionStore) {
      if (!sancionStore.hasOwnProperty(comp)) continue;
      var arr = sancionStore[comp] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].name === playerName && matches(arr[i].team)) return true;
      }
    }
    /* SQUAD_REGISTRY fallback */
    if (window.SQUAD_REGISTRY) {
      var candidateTeams = Object.keys(window.SQUAD_REGISTRY).filter(matches);
      for (var t = 0; t < candidateTeams.length; t++) {
        var sq = window.SQUAD_REGISTRY[candidateTeams[t]] || [];
        for (var p = 0; p < sq.length; p++) {
          var pl = sq[p];
          if (!pl || pl.h) continue;
          if (Array.isArray(pl) && pl[1] === playerName) return true;
          if (pl && pl.nombre === playerName) return true;
        }
      }
    }
    return false;
  };
  var _ppItems    = [];

  /* ══ SISTEMA DE ESTADO DE FORMA ══════════════════════════════ */
  /* 6 variantes: 🎲 Al azar, ⬆️ Excelente, ↗️ Buena, ➡️ Normal, ↘️ Mala, ⬇️ Pésima */
  window._ppFormStates = { home: '🎲', away: '🎲' };
  window._ppFormAdminUnlocked = false;
  window._ppDurationMin = null; /* override manual de duración */
  var FORM_VARIANTS = [
    { ico: '🎲', name: 'Al azar',   color: 'rgba(255,255,255,.85)' },
    { ico: '⬆️', name: 'Excelente', color: '#5aa9ff' },
    { ico: '↗️', name: 'Buena',     color: '#4fd87a' },
    { ico: '➡️', name: 'Normal',    color: '#f0c040' },
    { ico: '↘️', name: 'Mala',      color: '#ff9040' },
    { ico: '⬇️', name: 'Pésima',    color: '#ff5050' }
  ];
  window._ppFormVariants = FORM_VARIANTS;

  /* Reset a 🎲 al abrir una nueva previa */
  window._ppResetFormStates = function() {
    window._ppFormStates = { home: '🎲', away: '🎲' };
    window._ppFormAdminUnlocked = false;
    window._ppDurationMin = null;
  };

  /* ── Modal de admin PIN dedicado (no depende del pG existente) ── */
  function _ensureAdminModal() {
    if (document.getElementById('pp-admin-modal')) return;
    var m = document.createElement('div');
    m.id = 'pp-admin-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.92);align-items:center;justify-content:center;';
    m.innerHTML =
      '<div style="background:linear-gradient(160deg,#0d1117,#161b22);border:1px solid rgba(240,192,64,.4);border-radius:14px;padding:24px 20px;width:280px;max-width:90vw;text-align:center;box-shadow:0 0 40px rgba(0,0,0,.9);">'
      + '<div id="pp-admin-title" style="font-family:Oswald,sans-serif;font-size:14px;letter-spacing:2px;color:#f0c040;margin-bottom:16px;">🔒 MODO ADMIN</div>'
      + '<div id="pp-admin-display" style="font-family:\'Courier New\',monospace;font-size:28px;letter-spacing:12px;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:12px;margin-bottom:14px;min-height:52px;">●●●</div>'
      + '<div id="pp-admin-err" style="display:none;color:#ff5555;font-size:11px;margin-bottom:10px;letter-spacing:1px;">PIN INCORRECTO</div>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">'
        + '<button class="pp-pk" data-k="1" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">1</button>'
        + '<button class="pp-pk" data-k="2" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">2</button>'
        + '<button class="pp-pk" data-k="3" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">3</button>'
        + '<button class="pp-pk" data-k="4" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">4</button>'
        + '<button class="pp-pk" data-k="5" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">5</button>'
        + '<button class="pp-pk" data-k="6" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">6</button>'
        + '<button class="pp-pk" data-k="7" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">7</button>'
        + '<button class="pp-pk" data-k="8" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">8</button>'
        + '<button class="pp-pk" data-k="9" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">9</button>'
        + '<button id="pp-pk-del" style="background:rgba(255,100,100,.1);border:1px solid rgba(255,100,100,.25);border-radius:8px;color:#ff9090;font-size:18px;padding:14px 0;cursor:pointer;">⌫</button>'
        + '<button class="pp-pk" data-k="0" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:18px;font-family:Rajdhani,sans-serif;font-weight:700;padding:14px 0;cursor:pointer;">0</button>'
        + '<button id="pp-pk-ok" style="background:rgba(30,180,80,.2);border:1px solid rgba(60,220,100,.4);border-radius:8px;color:#5fe08a;font-size:18px;padding:14px 0;cursor:pointer;">✓</button>'
      + '</div>'
      + '<button id="pp-pk-cancel" style="background:none;border:none;color:rgba(255,255,255,.4);font-size:12px;font-family:Rajdhani,sans-serif;letter-spacing:1.5px;cursor:pointer;padding:6px 10px;">CANCELAR</button>'
      + '</div>';
    document.body.appendChild(m);
    var buffer = '';
    function render() {
      var disp = document.getElementById('pp-admin-display');
      if (disp) disp.textContent = buffer.length === 0 ? '●●●' : '●'.repeat(buffer.length);
    }
    m.querySelectorAll('.pp-pk').forEach(function(btn){
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (buffer.length >= 6) return;
        buffer += btn.getAttribute('data-k');
        render();
      });
    });
    document.getElementById('pp-pk-del').addEventListener('click', function(e){
      e.stopPropagation();
      buffer = buffer.slice(0, -1);
      render();
    });
    document.getElementById('pp-pk-ok').addEventListener('click', function(e){
      e.stopPropagation();
      if (buffer === '747') {
        window._adm = true;
        window._ppFormAdminUnlocked = true;
        m.style.display = 'none';
        buffer = ''; render();
        var cb = window._ppAdminCb;
        window._ppAdminCb = null;
        if (typeof cb === 'function') setTimeout(cb, 50);
      } else {
        var err = document.getElementById('pp-admin-err');
        if (err) err.style.display = 'block';
        var disp = document.getElementById('pp-admin-display');
        if (disp) disp.style.color = '#ff5555';
        setTimeout(function(){
          buffer = ''; render();
          if (disp) disp.style.color = '#fff';
          if (err) err.style.display = 'none';
        }, 900);
      }
    });
    document.getElementById('pp-pk-cancel').addEventListener('click', function(e){
      e.stopPropagation();
      buffer = ''; render();
      m.style.display = 'none';
      window._ppAdminCb = null;
    });
  }

  /* Llamar con callback — pide PIN 747 (o ejecuta directo si ya unlocked) */
  window._ppAdminGate = function(cb) {
    if (window._adm === true || window._ppFormAdminUnlocked) {
      window._ppFormAdminUnlocked = true;
      if (typeof cb === 'function') cb();
      return;
    }
    _ensureAdminModal();
    var m = document.getElementById('pp-admin-modal');
    if (!m) return;
    window._ppAdminCb = cb;
    m.style.display = 'flex';
  };

  /* Prompt PIN 747 antes de cambiar el estado de forma */
  window._ppRequestFormAdmin = function(side) {
    window._ppAdminGate(function() {
      window._ppOpenFormDropdown(side);
    });
  };

  /* Modal para seleccionar duración (1-30 min) — reemplaza prompt() nativo */
  function _ensureDurationModal() {
    if (document.getElementById('pp-dur-modal')) return;
    var m = document.createElement('div');
    m.id = 'pp-dur-modal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.92);align-items:center;justify-content:center;padding:16px;';
    var opts = '';
    for (var i = 1; i <= 30; i++) {
      opts += '<button class="pp-dur-opt" data-min="' + i + '" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-family:Oswald,sans-serif;font-size:14px;font-weight:700;padding:12px 0;cursor:pointer;transition:all .15s;">' + i + "'</button>";
    }
    m.innerHTML =
      '<div style="background:linear-gradient(160deg,#0d1117,#161b22);border:1px solid rgba(240,192,64,.4);border-radius:14px;padding:22px 20px 16px;width:320px;max-width:92vw;text-align:center;box-shadow:0 0 40px rgba(0,0,0,.9);">'
      + '<div style="font-family:Oswald,sans-serif;font-size:14px;letter-spacing:2px;color:#f0c040;margin-bottom:16px;">⏱️ DURACIÓN DEL PARTIDO</div>'
      + '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;max-height:260px;overflow-y:auto;padding:4px;">' + opts + '</div>'
      + '<button id="pp-dur-cancel" style="background:none;border:none;color:rgba(255,255,255,.4);font-size:12px;font-family:Rajdhani,sans-serif;letter-spacing:1.5px;cursor:pointer;padding:10px;margin-top:12px;">CANCELAR</button>'
      + '</div>';
    document.body.appendChild(m);
    m.querySelectorAll('.pp-dur-opt').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var mins = parseInt(btn.getAttribute('data-min'), 10);
        window._ppDurationMin = mins;
        /* Re-renderizar items */
        var isHvH = false;
        if (_ppMatchKey) {
          var w = document.getElementById('mlw-' + _ppMatchKey);
          isHvH = w && w.classList.contains('hvh');
        }
        _ppItems = _buildItems(_ppMatchKey, _ppCompKey, 'No', mins + ' min', isHvH);
        _renderList(_ppItems);
        _updateBtn();
        m.style.display = 'none';
      });
    });
    document.getElementById('pp-dur-cancel').addEventListener('click', function(e) {
      e.stopPropagation();
      m.style.display = 'none';
    });
  }

  /* Editar duración del partido — requiere PIN admin */
  window._ppEditDuration = function() {
    window._ppAdminGate(function() {
      _ensureDurationModal();
      var m = document.getElementById('pp-dur-modal');
      if (m) m.style.display = 'flex';
    });
  };

  /* Mostrar dropdown con las 6 variantes */
  window._ppOpenFormDropdown = function(side) {
    var existing = document.getElementById('pp-form-dropdown');
    if (existing) existing.remove();
    var btn = document.getElementById('pp-form-' + side);
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var dd = document.createElement('div');
    dd.id = 'pp-form-dropdown';
    /* z-index MAX para que esté encima del prepartido-overlay (10010) */
    dd.style.cssText = 'position:fixed;z-index:2147483646;background:rgba(10,10,24,.98);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:6px;box-shadow:0 8px 32px rgba(0,0,0,.7);min-width:180px;';
    dd.style.left = Math.max(10, Math.min(window.innerWidth - 200, rect.left - 30)) + 'px';
    dd.style.top = (rect.bottom + 6) + 'px';
    dd.innerHTML = FORM_VARIANTS.map(function(v) {
      return '<div class="pp-form-opt" data-ico="' + v.ico + '" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-radius:6px;color:' + v.color + ';font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;transition:background .15s;"><span style="font-size:20px;">' + v.ico + '</span>' + v.name.toUpperCase() + '</div>';
    }).join('');
    document.body.appendChild(dd);
    dd.querySelectorAll('.pp-form-opt').forEach(function(el) {
      el.addEventListener('mouseenter', function(){ el.style.background = 'rgba(255,255,255,.08)'; });
      el.addEventListener('mouseleave', function(){ el.style.background = ''; });
      el.addEventListener('click', function() {
        var ico = el.getAttribute('data-ico');
        window._ppSetFormState(side, ico);
        dd.remove();
      });
    });
    setTimeout(function() {
      function off(e) {
        if (!dd.contains(e.target) && e.target !== btn) {
          dd.remove();
          document.removeEventListener('click', off, true);
        }
      }
      document.addEventListener('click', off, true);
    }, 50);
  };

  /* Asignar estado y re-renderizar */
  window._ppSetFormState = function(side, ico) {
    window._ppFormStates[side] = ico;
    var btn = document.getElementById('pp-form-' + side);
    if (btn) {
      var variant = null;
      for (var i = 0; i < FORM_VARIANTS.length; i++) {
        if (FORM_VARIANTS[i].ico === ico) { variant = FORM_VARIANTS[i]; break; }
      }
      if (!variant) variant = FORM_VARIANTS[0];
      btn.textContent = variant.ico;
      btn.style.borderColor = variant.color;
      btn.style.boxShadow = '0 0 10px ' + variant.color + '55';
    }
    /* Pésima → lesión automática */
    if (ico === '⬇️') window._ppTriggerInjury(side);
    /* Refrescar estado del botón WhatsApp */
    if (typeof window._ppRefreshUnlock === 'function') window._ppRefreshUnlock();
  };

  /* Pésima → lesiona a un jugador aleatorio del equipo */
  window._ppTriggerInjury = function(side) {
    var teams = window._ppGetCurrentMatchTeams && window._ppGetCurrentMatchTeams();
    if (!teams) return;
    var teamName = side === 'home' ? teams.home : teams.away;
    if (!teamName) return;
    var HUMANOS_FORM = (function(){ try { var r=localStorage.getItem('ligaExt_liga-ea-sports'); if(r){var d=JSON.parse(r); if(d&&d.teams){var h=d.teams.filter(function(t){return t.isHuman}).map(function(t){return t.name}); if(h.length) return h;}} } catch(_){} return ['Real Madrid','FC Barcelona','Bayern Munich','Arsenal','Atlético Madrid']; })();
    var normFn = window._ppNormTeam || function(s){return (s||'').toLowerCase();};
    var normTeam = normFn(teamName);
    var canonicalTeam = null;
    for (var k = 0; k < HUMANOS_FORM.length; k++) {
      if (normFn(HUMANOS_FORM[k]) === normTeam) { canonicalTeam = HUMANOS_FORM[k]; break; }
    }
    if (!canonicalTeam) {
      alert('⚠️ El estado Pésima solo aplica lesiones a equipos humanos');
      return;
    }
    var squad = (window.SQUAD_REGISTRY && window.SQUAD_REGISTRY[canonicalTeam]) || [];
    var pool = squad.filter(function(p) {
      if (!p || p.h) return false;
      if (!Array.isArray(p)) return false;
      if (p[2] === 'P') return false;
      var name = p[1];
      if (window.BAJA_STORE && window.BAJA_STORE[name]) return false;
      return true;
    });
    if (!pool.length) {
      alert('⚠️ No hay jugadores disponibles en ' + canonicalTeam + ' para lesionar');
      return;
    }
    var chosen = pool[Math.floor(Math.random() * pool.length)];
    var playerName = chosen[1];
    /* Asignar severidad aleatoria */
    var r = Math.random();
    var grado, gradoNombre, gradoEmoji, partidos, lesionesList;
    if (r < 0.55) {
      grado = 1; gradoNombre = 'Leve'; gradoEmoji = '🩹'; partidos = 1 + Math.floor(Math.random()*2);
      lesionesList = ['Sobrecarga muscular','Contusión en el cuádriceps','Esguince de tobillo Grado I','Calambre persistente','Elongación en el aductor'];
    } else if (r < 0.85) {
      grado = 2; gradoNombre = 'Moderada'; gradoEmoji = '💉'; partidos = 2 + Math.floor(Math.random()*3);
      lesionesList = ['Microrrotura de fibras','Esguince de tobillo Grado II','Edema óseo','Contractura severa','Distensión del ligamento lateral'];
    } else {
      grado = 3; gradoNombre = 'Grave'; gradoEmoji = '🚑'; partidos = 5 + Math.floor(Math.random()*6);
      lesionesList = ['Rotura fibrilar Grado III','Fisura en el metatarsiano','Rotura parcial del ligamento','Luxación de hombro','Rotura del tendón de Aquiles'];
    }
    var descripcion = lesionesList[Math.floor(Math.random() * lesionesList.length)];
    if (!window.LESION_STORE) window.LESION_STORE = {};
    if (!window.BAJA_STORE) window.BAJA_STORE = {};
    window.LESION_STORE[playerName] = {
      equipo: canonicalTeam, grado: grado, gradoNombre: gradoNombre,
      gradoEmoji: gradoEmoji, descripcion: descripcion, partidos: partidos,
      timestamp: Date.now()
    };
    window.BAJA_STORE[playerName] = {
      tipo: 'lesion', liga: partidos, copa: partidos, europa: partidos
    };
    alert('🏥 ' + gradoEmoji + ' LESIÓN ' + gradoNombre.toUpperCase() + '\n' +
          playerName + ' (' + canonicalTeam + ')\n' +
          descripcion + '\n' +
          partidos + ' partido(s) de baja');
    /* Refrescar el banner de alertas en la previa */
    if (_ppMatchKey && typeof _renderPreviaMeta === 'function') {
      _renderPreviaMeta(_ppMatchKey, false);
    }
  };

  /* Líneas de baja (lesión / sanción / expulsión) de los jugadores
     del equipo del hub que disputa la previa actual. Devuelve [] si
     el hub no juega este partido o no tiene bajas. Lo consume la card
     obligatoria de bajas en `_buildItems`. */
  function _ppHubBajasLines() {
    var hub = String(window._mkHubTeamName || '').trim().toLowerCase();
    if (!hub) return [];
    var teams = null;
    if (window._ppPreviaTeams && window._ppPreviaTeams.home) teams = window._ppPreviaTeams;
    else if (typeof window._ppGetCurrentMatchTeams === 'function') teams = window._ppGetCurrentMatchTeams();
    if (!teams || !teams.home) return [];
    var hL = String(teams.home || '').trim().toLowerCase();
    var aL = String(teams.away || '').trim().toLowerCase();
    if (hL !== hub && aL !== hub) return [];        /* el hub no juega aquí */
    var lines = [], seen = {};
    /* Lesionados: LESION_STORE.equipo === hub */
    var LS = window.LESION_STORE || {};
    Object.keys(LS).forEach(function(name){
      var l = LS[name];
      if (!l || String(l.equipo || '').trim().toLowerCase() !== hub) return;
      var rem = parseInt(l.partidos || 0, 10) || 0;
      if (rem <= 0) return;
      seen[name] = true;
      /* 2026-05-25: formato corto pedido por usuario — "Nombre · N Partidos baja"
         (sin gradoNombre redundante; la gravedad ya sale en la card LESIONADO). */
      lines.push((l.gradoEmoji || '🩹') + ' ' + name + ' · ' + rem + ' Partido' + (rem===1?'':'s') + ' baja');
    });
    /* Sanción / expulsión: BAJA_STORE no guarda equipo → cruzamos con
       SQUAD_REGISTRY del hub para saber si el jugador es de su plantilla. */
    var BS = window.BAJA_STORE || {};
    var hubSquad = {};
    if (window.SQUAD_REGISTRY) {
      Object.keys(window.SQUAD_REGISTRY).forEach(function(tn){
        if (String(tn).trim().toLowerCase() !== hub) return;
        (window.SQUAD_REGISTRY[tn] || []).forEach(function(p){
          if (Array.isArray(p) && p[1]) hubSquad[p[1]] = true;
          else if (p && p.nombre) hubSquad[p.nombre] = true;
        });
      });
    }
    Object.keys(BS).forEach(function(name){
      if (seen[name]) return;
      var b = BS[name];
      if (!b) return;
      var tipo = b.tipo || b;
      if (tipo !== 'sancion' && tipo !== 'expulsion') return;
      if (!hubSquad[name]) return;
      var n = Math.max(parseInt(b.liga || 0, 10) || 0, parseInt(b.copa || 0, 10) || 0, parseInt(b.europa || 0, 10) || 0);
      lines.push((tipo === 'expulsion' ? '🟥' : '🟨') + ' ' + name + ' · ' + n + ' Partido' + (n===1?'':'s') + ' baja');
    });
    return lines;
  }

  function _buildItems(matchKey, compKey, prorroga, duracion, isHvH) {
    // Fixed items for Liga Jornada 1
    var estadio  = 'eFootball Stadium'; // fallback — overwritten below from venue-bar or TEAM_STADIUMS
    var estacion = 'Verano';
    var tiempo   = 'Soleado';
    var balon    = "Ligue 1 McDonald's";
    var sust     = '6';
    var ventanas = '6';

    // Get real values from venue-bar if possible
    var vbar = document.getElementById('venue-bar-' + matchKey);
    if (vbar) {
      var nm = vbar.querySelector('.ml-venue-name');
      var wt = vbar.querySelector('.ml-venue-weather');
      if (nm) estadio = nm.textContent.trim();
      if (wt) {
        var wtext = wt.textContent.replace(/\s+/g,' ').trim();
        var parts = wtext.replace(/[\u2600-\u27FF\uFE0F]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDFFF]/g,'').trim().split('\u00B7');
        if (parts.length >= 2) {
          tiempo   = parts[0].trim();
          estacion = parts[1].trim();
        }
      }
    }
    // Ball name por competición
    var COMP_BALL = {
      'liga':       "Ligue 1 McDonald's Official Match Ball",
      'copa':       "TSUBASA J PRO",
      'copa-fin':   "TSUBASA J PRO",
      'sc':         "Puma Orbita MFL 1",
      'sc-final':   "Puma Orbita MFL 1",
      'usc':        "eFootball Contact 26",
      'usc-fin':    "eFootball Contact 26",
      'ucl':        "PARADISE Morado",
      'ucl-fin':    "PARADISE Morado",
      'uel':        "Resmi Maç Topudur",
      'uel-fin':    "Resmi Maç Topudur",
      'uecl':       "The Brillant Super USL v25",
      'uecl-fin':   "The Brillant Super USL v25",
      'inter':      "Derbystar Globall 2025/26",
      'inter-fin':  "Derbystar Globall 2025/26",
      'recopa':     "PARADISE Azul",
      'recopa-fin': "PARADISE Azul",
      'eur-grupo':  "PARADISE Morado",
      'eur-ko':     "PARADISE Morado",
      'eur-fin':    "PARADISE Morado",
      'sel':        "NIKE CONTROL CBF",
      'sel-fin':    "NIKE CONTROL CBF",
      'amistoso':   "eFootball Origin",
      'superliga':  "PARADISE Morado",
      /* Torneos de Verano — todas las variantes (Joan Gamper, Asian,
         Pre-Season Super, Soccer Champions Tour, genéricos…)
         comparten balón con la fila "verano" de Ball Storage. Sin
         este default las cards salían con `Ligue 1 McDonald's`
         porque COMP_BALL['torneo'] no estaba definido (bug
         FOTO 2026-05-25). */
      'torneo':     "eFootball Origin",
      'torneos':    "eFootball Origin",
      'sct':        "eFootball Origin",
      'jg':         "eFootball Origin",
      'pss':        "eFootball Origin",
      'asia':       "eFootball Origin",
      'verano':     "eFootball Origin",
      /* Mundialito de Clubes — compKey real del partido. */
      'mundialito': "Vantaggio 5000",
      'mundial':    "Vantaggio 5000"
    };
    /* Override del admin desde "Ball Storage" (s-admin-balls) — el
       admin puede elegir un balón distinto por competición y se
       persiste en localStorage `ball_by_comp_v1`. Petición usuario
       2026-05-05: hasta que el admin re-edite, ese balón es el que
       se usa por defecto en cualquier partido humano de esa
       competición. La key del override coincide con el `key` de
       BALL_DB (liga / copa / sc / champions / etc.). Mapping
       compKey → BALL_DB.key para los aliases más comunes. */
    var _COMP_TO_BDB = {
      'liga':'liga','copa':'copa','copa-fin':'copa',
      'sc':'supercopa','sc-final':'supercopa',
      'ucl':'champions','ucl-fin':'champions',
      'uel':'uel','uel-fin':'uel',
      'uecl':'uecl','uecl-fin':'uecl',
      'recopa':'recopa','recopa-fin':'recopa',
      'usc':'usc','usc-fin':'usc',
      'inter':'intercontinental','inter-fin':'intercontinental',
      'sel':'selecciones','sel-fin':'selecciones',
      'amistoso':'amistosos',
      'superliga':'champions',
      'eur-grupo':'champions','eur-ko':'champions','eur-fin':'champions'
    };
    /* Alias de GRUPO (2026-05-25): varios compKeys reales del juego
       comparten la MISMA fila en Ball Storage (los torneos de verano
       — Joan Gamper, Asian, Pre-Season Super, Soccer Champions Tour
       y los genéricos `torneo`/`torneos` — viven todos bajo la
       extra `verano`). Sin este map, las cards salían con el balón
       por defecto porque `ball_by_comp_v1['torneo']` no existe. */
    var _COMP_GROUP_ALIAS = {
      'torneo':'verano', 'torneos':'verano',
      'sct':'verano', 'jg':'verano', 'pss':'verano', 'asia':'verano',
      'mundial':'mundialito'
    };
    try {
      var _ovRaw = localStorage.getItem('ball_by_comp_v1');
      if (_ovRaw) {
        var _ov = JSON.parse(_ovRaw) || {};
        var _bdbKey   = _COMP_TO_BDB[compKey];
        var _groupKey = _COMP_GROUP_ALIAS[compKey];
        /* Resolución robusta (2026-05-17, ampliada 2026-05-25):
           1) clave RAW del partido (compKey) — comps base + extras
              + customs añadidas por el admin.
           2) alias BALL_DB (back-compat de las 14 comps base).
           3) alias de GRUPO (torneos de verano → `verano`,
              variantes mundialito → `mundialito`). */
        var _ovBall = _ov[compKey]
                   || (_bdbKey   && _ov[_bdbKey])
                   || (_groupKey && _ov[_groupKey]);
        if (_ovBall && typeof _ovBall === 'string') {
          /* El admin ha guardado un balón distinto para esta comp →
             gana sobre el default hardcoded. */
          COMP_BALL[compKey] = _ovBall.replace(/_/g, ' ');
        }
      }
    } catch(_){}
    if (COMP_BALL[compKey]) {
      balon = COMP_BALL[compKey];
    }
    /* Selecciones por jornada (regla obligatoria CLAUDE.md 2026-05-24):
       J1-J8 = "Orbita Africa" (fase clasificatoria).
       J9+   = "NIKE CONTROL CBF" (en mayo).
       Gana SOBRE el override del admin para mantener la regla "siempre".
       Solo nieve (más abajo) puede sobrescribirla.

       Aplica también a partidos lanzados vía `_tourOpenHumanMatch`
       (compKey='torneo') cuando el torneo es una competición de
       Selecciones (formato `mundial-48`) — sin esto el partido
       Francia-UAE de Mundial 2032 caía al default "Ligue 1
       McDonald's". Reportado por el usuario 2026-05-24 con captura. */
    var _isSelCtx = (compKey === 'sel');
    var _selFromTour = false;
    if (!_isSelCtx && compKey === 'torneo') {
      try {
        var _ppPT = window._ppPreviaTeams;
        var _tcfg = (_ppPT && _ppPT.tourId && window._TOUR_CACHE)
          ? window._TOUR_CACHE[_ppPT.tourId] : null;
        if (_tcfg && _tcfg.format === 'mundial-48') {
          _isSelCtx = true;
          _selFromTour = true;
        }
      } catch(_){}
    }
    if (_isSelCtx) {
      var _selJor = 0;
      try {
        var _bidSel = String(window._ppBlockId || '');
        var _mSel = /cal-sel(\d+)/.exec(_bidSel);
        if (_mSel) _selJor = parseInt(_mSel[1], 10) || 0;
        if (!_selJor) {
          var _mSel2 = /sel[^\d]*?(\d+)/i.exec(String(matchKey || ''));
          if (_mSel2) _selJor = parseInt(_mSel2[1], 10) || 0;
        }
      } catch(_){}
      if (_selFromTour) {
        /* Mundial 2032 fase final → siempre NIKE CONTROL CBF (no hay
           subdivisión J1-J8 dentro del bracket de Mundial-48). */
        balon = 'NIKE CONTROL CBF';
      } else if (_selJor >= 1 && _selJor <= 8) {
        balon = 'Orbita Africa';
      } else if (_selJor >= 9) {
        balon = 'NIKE CONTROL CBF';
      } else {
        /* Selecciones sin jornada detectable (p.ej. ruta nueva sin
           `_ppBlockId`): usar el default `sel` ya aplicado por
           COMP_BALL — NO caemos al "Ligue 1 McDonald's" inicial. */
        if (!COMP_BALL[compKey]) balon = 'NIKE CONTROL CBF';
      }
    }
    /* Liga/partido en nieve → balón amarillo especial "eFootball MAX VIS 26".
       Antes solo se comprobaba `tiempo` (parte 0 del texto del venue-bar),
       pero la UI guarda "Invierno · ❄ Nieve" donde "Invierno" es el
       tiempo/estación y "Nieve" es el clima real. Así que revisamos
       AMBOS strings + el texto completo original como tercer salvavidas.
       El balón de nieve aplica en TODAS las competiciones (liga, copa,
       europa, amistoso) porque el clima no distingue competición. */
    var _snowDetect = function(){
      try {
        if (tiempo && String(tiempo).toLowerCase().indexOf('nieve') !== -1) return true;
        if (estacion && String(estacion).toLowerCase().indexOf('nieve') !== -1) return true;
        /* Leer el texto completo del venue-bar como último recurso. */
        var _vb = document.getElementById('venue-bar-' + matchKey);
        if (_vb) {
          var _vt = (_vb.textContent || '').toLowerCase();
          if (_vt.indexOf('nieve') !== -1 || _vt.indexOf('❄') !== -1) return true;
        }
      } catch(_){}
      return false;
    };
    if (_snowDetect()) {
      balon = 'eFootball MAX VIS 26';
    }
    // Fallback: leer del DOM si existe un balón personalizado
    var bwrap = document.getElementById('ball-wrap-' + matchKey);
    if (bwrap) {
      var bn = bwrap.querySelector('.ml-ball-name');
      if (bn && bn.textContent.trim()) balon = bn.textContent.trim();
    }
    /* Duración real según spec (_MATCH_RULE). Admin puede sobrescribir vía
       _ppDurationMin (minutos reales). CLAUDE.md: obligatorio usar helper. */
    var durLabel;
    if (window._ppDurationMin) {
      durLabel = window._ppDurationMin + ' min';
    } else if (typeof window._mlRealDurationLabel === 'function') {
      durLabel = window._mlRealDurationLabel({ isHvH: isHvH, humanInvolved: !isHvH });
    } else {
      durLabel = isHvH ? '16.5 min' : '13.5 min';
    }
    var items = [
      { id:'balon',   ico:'⚽️', lbl:'Balón',         val:balon }
    ];
    /* La card "🏥 Bajas — NO convocar" SE HA RETIRADO de la PREVIA
       (petición usuario 2026-05-27, Foto 2). En esta pantalla el
       usuario aún está configurando estadio/clima/balón/duración —
       las bajas viven exclusivamente en la pantalla BAJAS PARA EL
       PARTIDO (siguiente paso) donde sí se elige alineación. */
    return items;
  }

  function _ppClickSfx() { try { var Ctx=window.AudioContext||window.webkitAudioContext; if(!Ctx) return; var ctx=window.__ppAudio||(window.__ppAudio=new Ctx()); var o=ctx.createOscillator(); var g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); var t=ctx.currentTime; o.frequency.setValueAtTime(1180,t); g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.05); o.start(t); o.stop(t+0.05);} catch(_){} }

  window._renderPreviaMeta = function(matchKey, isHvH){ return _renderPreviaMeta(matchKey, isHvH); };
  function _renderPreviaMeta(matchKey, isHvH) {
    var home, away;
    var wrap = document.getElementById('mlw-' + matchKey);
    /* PRIORIDAD 1: equipos explícitos pasados vía _ppPreviaTeams
       (para casos como el click en PREVIA desde la pantalla de resultados IA
       donde el matchKey es genérico tipo 'lj2m0' y no corresponde al partido real) */
    var _teamsFromOverride = false;
    if (window._ppPreviaTeams && window._ppPreviaTeams.home && window._ppPreviaTeams.away) {
      home = window._ppPreviaTeams.home;
      away = window._ppPreviaTeams.away;
      _teamsFromOverride = true;
    } else if (wrap) {
      /* PRIORIDAD 2: leer del DOM (mlw-{matchKey}) */
      home = ((wrap.querySelectorAll('.ml-team-name')[0]||{}).textContent||'LOCAL').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
      away = ((wrap.querySelectorAll('.ml-team-name')[1]||{}).textContent||'VISITANTE').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
    } else {
      return;
    }
    var env = document.getElementById('pp-env');
    /* Supercopa España (_ppCompKey 'sc'/'sc-final'): campo NEUTRAL
       elegido por el admin en sc_state_v1.stadium — pasado vía
       _ppPreviaTeams.stadium. NO usar el local.
       Mundial · 48 selecciones (_ppCompKey 'sel-fin'): campo NEUTRAL
       de las 4 sedes elegidas por el admin (sel_fin_stadiums_v1).
       Rotación determinista por hash del matchKey vía
       window._selFinStadiumFor. Petición usuario 2026-05-24. */
    var _ppStadium;
    /* Mundial · 48 selecciones: el partido es en una de las 4 sedes
       elegidas (rotación por hash). Cubre los 2 caminos: card del
       calendario (compKey 'sel-fin') y card del torneo (compKey
       'torneo' + cfg.format === 'mundial-48'). */
    function _isSelFinPreviaCtx(){
      if (_ppCompKey === 'sel-fin') return true;
      try {
        var pt = window._ppPreviaTeams;
        if (pt && pt.tourId && typeof window._tourLoadCachedSync === 'function') {
          var _cfgP = window._tourLoadCachedSync(pt.tourId);
          if (_cfgP && _cfgP.format === 'mundial-48') return true;
        }
      } catch(_){}
      return false;
    }
    if ((_ppCompKey === 'sc' || _ppCompKey === 'sc-final') && window._ppPreviaTeams && window._ppPreviaTeams.stadium) {
      _ppStadium = window._ppPreviaTeams.stadium;
    } else if (typeof window._selFinStadiumFor === 'function' && _isSelFinPreviaCtx()) {
      var _sfHashKey = (window._ppPreviaTeams && window._ppPreviaTeams.tourKey)
                       || _ppMatchKey
                       || ((window._ppPreviaTeams && window._ppPreviaTeams.home) || '') + '|' + ((window._ppPreviaTeams && window._ppPreviaTeams.away) || '');
      var _sfSt = window._selFinStadiumFor(_sfHashKey);
      _ppStadium = _sfSt || ((typeof window.getTeamStadium === 'function') ? (window.getTeamStadium(home) || 'eFootball Stadium') : 'eFootball Stadium');
    } else {
      _ppStadium = (typeof window.getTeamStadium === 'function') ? (window.getTeamStadium(home) || 'eFootball Stadium') : 'eFootball Stadium';
    }
    /* Solo pintamos el estadio aquí — la estación (Verano/Invierno) y el
       clima (Sol/Lluvia/Nieve) los rellena `_mmInjectEnv()` 60 ms después
       a partir de la fecha real del calendario. Antes esta línea los
       hardcodeaba a "🌝 Verano · ☀️ Soleado" y tapaba el resultado
       correcto, por eso al abrir la previa desaparecían. */
    if (env) env.innerHTML = '🏟️ <b>' + _ppStadium + '</b>';
    var vs = document.getElementById('pp-vs');
    if (vs) {
      /* Si los equipos vinieron de _ppPreviaTeams, NO usar las <img> del wrap
         (matchKey es genérico tipo "lj8m0" y apunta al primer partido de la
         jornada, no al partido real → los escudos del wrap son los del PRIMER
         partido). Resolver siempre por nombre vía la cadena de fallbacks. */
      var _svgImgs = (wrap && !_teamsFromOverride) ? wrap.querySelectorAll('.ml-team-svg') : [];
      function _pickLogo(img, name) {
        if (img && img.src && img.src.indexOf('estepona') === -1 && img.src.length > 10) return img.src;
        var byAlt = document.querySelector('.ml-team-svg[alt="' + name.replace(/"/g,'&quot;') + '"]');
        if (byAlt && byAlt.src && byAlt.src.indexOf('estepona') === -1) return byAlt.src;
        var tlu = (typeof window.getTeamLogoUrl === 'function') ? window.getTeamLogoUrl(name) : '';
        if (tlu) return tlu;
        return (typeof getLogoEquipo === 'function') ? getLogoEquipo(name) : '';
      }
      /* Override de escudo: el caller (p.ej. copaAbrirPrevia) puede
         pre-resolver el escudo y pasarlo en _ppPreviaTeams.homeLogo/
         awayLogo. Necesario para equipos de PF / Hypermotion, cuyas
         plantillas viven fuera del main key y no llegan a
         getTeamLogoUrl/getLogoEquipo — sin esto salían con el 🛡️
         genérico apagado en la previa de Copa. */
      var _ovLogoA = (window._ppPreviaTeams && window._ppPreviaTeams.homeLogo) || '';
      var _ovLogoB = (window._ppPreviaTeams && window._ppPreviaTeams.awayLogo) || '';
      var lA = _ovLogoA || _pickLogo(_svgImgs[0], home);
      var lB = _ovLogoB || _pickLogo(_svgImgs[1], away);
      /* Fallback procedural: insignia con iniciales del equipo (vía
         iaShieldSVG de misc_body_2). Sustituye al antiguo `🛡️` emoji
         que en Samsung One UI se renderizaba como un escudo plateado
         con remaches feo (reportado 2026-05-23: el Como sin shield
         hardcodeado salía así en la previa Liverpool vs Como). El
         onerror llama a window._ppShieldFallback para cubrir también
         las URLs hardcodeadas que fallen (404, red caída). */
      function _ppShieldFallback(nm, size){
        size = size || 84;
        if (typeof window.iaShieldSVG === 'function') {
          return '<span style="display:inline-block;width:'+size+'px;height:'+size+'px;">' + window.iaShieldSVG(nm) + '</span>';
        }
        return '<span style="font-size:54px;">🛡️</span>';
      }
      /* Helper expuesto a window para que el onerror del <img> pueda
         hacer el swap sin necesidad de embeber comillas raras en el
         atributo. Sobrescribe outerHTML por el SVG procedural. */
      window._ppShieldFallbackSwap = window._ppShieldFallbackSwap || function(imgEl, nm, size){
        try { imgEl.outerHTML = _ppShieldFallback(nm, size); } catch(_){ try { imgEl.style.display = 'none'; } catch(__){} }
      };
      function _ppImg(url, nm, size){
        var safeNm = String(nm||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var safeJs = String(nm||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return '<img src="'+url+'" alt="'+safeNm+'" onerror="window._ppShieldFallbackSwap(this,\''+safeJs+'\','+size+')" style="width:'+size+'px;height:'+size+'px;object-fit:contain;display:block;margin:0 auto;"/>';
      }
      var imgA = lA ? _ppImg(lA, home, 84) : _ppShieldFallback(home, 84);
      var imgB = lB ? _ppImg(lB, away, 84) : _ppShieldFallback(away, 84);
      /* Nivel por equipo: Crack / Leyenda (solo humanos) */
      function _teamLevel(name) {
        var normFn = window._ppNormTeam || function(s){return String(s||'').toLowerCase();};
        var n = normFn(name);
        /* Override explícito del editor 🖍 para el equipo humano: si la
           caja del menú fijó un nivel (CRACK / LEYENDA / vacío=ninguno)
           Y `name` es el slot humano, ese override manda sobre todo. */
        try {
          var rawL = localStorage.getItem('menu_home_v1');
          if (rawL) {
            var dL = JSON.parse(rawL);
            var ovL = dL && dL.ov && dL.ov['go:s-munich'];
            if (ovL && Object.prototype.hasOwnProperty.call(ovL, 'level')) {
              var isHumanSide = false;
              if (ovL.label && normFn(ovL.label) === n) isHumanSide = true;
              if (!isHumanSide && typeof window._ligaEaSubName === 'function') {
                var subN = window._ligaEaSubName('Bayern Munich');
                if (subN && normFn(subN) === n) isHumanSide = true;
              }
              if (!isHumanSide && normFn('Bayern Munich') === n) isHumanSide = true;
              if (isHumanSide) {
                if (ovL.level === 'CRACK')    return { lbl: '⭐ CRACK',    color: '#a0e0ff', short: 'CRACK' };
                if (ovL.level === 'LEYENDA')  return { lbl: '🏅 LEYENDA',  color: '#ffbb33', short: 'LEYENDA' };
                if (ovL.level === 'ESTRELLA') return { lbl: '🌟 ESTRELLA', color: '#ff77c2', short: 'ESTRELLA' };
                if (ovL.level === '') return null; /* admin eligió "Ninguno" */
              }
            }
          }
        } catch(_){}
        if (normFn('Atlético Madrid') === n || normFn('Atletico Madrid') === n) return { lbl: '🏅 LEYENDA', color: '#ffbb33', short: 'LEYENDA' };
        if (normFn('Real Madrid') === n) return { lbl: '⭐ CRACK', color: '#a0e0ff', short: 'CRACK' };
        if (normFn('FC Barcelona') === n || normFn('Barcelona') === n) return { lbl: '⭐ CRACK', color: '#a0e0ff', short: 'CRACK' };
        if (normFn('Bayern Munich') === n) return { lbl: '⭐ CRACK', color: '#a0e0ff', short: 'CRACK' };
        if (normFn('Arsenal') === n) return { lbl: '⭐ CRACK', color: '#a0e0ff', short: 'CRACK' };
        /* Slot humano #5 (Bayern) renombrado: si la caja del menú o el
           reemplazo de Liga EA apuntan a `name`, hereda el badge CRACK
           del Bayern (es el mismo slot humano). */
        try {
          var humN = '';
          var raw = localStorage.getItem('menu_home_v1');
          if (raw) {
            var d = JSON.parse(raw);
            var ov = d && d.ov && d.ov['go:s-munich'];
            if (ov && ov.label) humN = normFn(ov.label);
          }
          if (!humN && typeof window._ligaEaSubName === 'function') {
            var s = window._ligaEaSubName('Bayern Munich');
            if (s) humN = normFn(s);
          }
          if (humN && humN === n) return { lbl: '⭐ CRACK', color: '#a0e0ff', short: 'CRACK' };
        } catch(_){}
        return null; /* IA teams → no badge */
      }
      var lvlA = _teamLevel(home);
      var lvlB = _teamLevel(away);
      /* Form state buttons — bajo cada escudo */
      function _formBtnHtml(side) {
        var ico = (window._ppFormStates && window._ppFormStates[side]) || '🎲';
        /* Si la caja del menú fijó un estado de forma para el humano,
           sembrarlo como default cuando este lado es el humano y no
           se ha tocado en esta sesión (aún en 🎲). El admin puede
           seguir cambiándolo tocando el botón (PIN 747). */
        try {
          var rawF = localStorage.getItem('menu_home_v1');
          if (rawF && ico === '🎲') {
            var dF = JSON.parse(rawF);
            var ovF = dF && dF.ov && dF.ov['go:s-munich'];
            if (ovF && (ovF.formState || ovF.formRival)) {
              var teamSide  = side === 'home' ? home : away;
              var otherSide = side === 'home' ? away : home;
              var normSF = window._ppNormTeam || function(s){return String(s||'').toLowerCase();};
              function _isHumanT(t){
                if (ovF.label && normSF(ovF.label) === normSF(t)) return true;
                if (typeof window._ligaEaSubName === 'function') {
                  var ss = window._ligaEaSubName('Bayern Munich');
                  if (ss && normSF(ss) === normSF(t)) return true;
                }
                if (normSF('Bayern Munich') === normSF(t)) return true;
                return false;
              }
              if (_isHumanT(teamSide) && ovF.formState) {
                ico = ovF.formState;
              } else if (_isHumanT(otherSide) && ovF.formRival) {
                /* Este lado es el rival del humano → forma del rival. */
                ico = ovF.formRival;
              }
              try { if (window._ppFormStates && ico !== '🎲') window._ppFormStates[side] = ico; } catch(__){}
            }
          }
        } catch(_){}
        var variants = window._ppFormVariants || [];
        var variant = null;
        for (var v = 0; v < variants.length; v++) { if (variants[v].ico === ico) { variant = variants[v]; break; } }
        if (!variant) variant = { color: 'rgba(255,255,255,.85)' };
        return '<button id="pp-form-' + side + '" type="button" title="Estado de forma (admin)" style="margin-top:10px;background:rgba(10,10,24,.6);border:2px solid ' + variant.color + ';border-radius:10px;padding:8px 18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 0 10px ' + variant.color + '55;transition:all .2s;pointer-events:auto;position:relative;z-index:10;font-size:22px;line-height:1;">' + ico + '</button>';
      }
      /* Center column: NIVEL + VS + Duración */
      var nivelHtml = '';
      if (lvlA || lvlB) {
        var aTxt = lvlA ? '<span style="color:'+lvlA.color+';">'+lvlA.short+'</span>' : '<span style="color:rgba(255,255,255,.35);">—</span>';
        var bTxt = lvlB ? '<span style="color:'+lvlB.color+';">'+lvlB.short+'</span>' : '<span style="color:rgba(255,255,255,.35);">—</span>';
        nivelHtml = '<div style="font-family:Oswald,sans-serif;font-size:11px;letter-spacing:2px;color:#5aa9ff;text-align:center;">NIVEL</div>'
          + '<div style="font-family:Oswald,sans-serif;font-size:11px;font-weight:700;letter-spacing:.5px;text-align:center;margin-top:2px;">' + aTxt + ' · ' + bTxt + '</div>';
      }
      /* Duración central — tap para editar con admin PIN. Fuente única:
         _MATCH_RULE → helper _mlRealDurationLabel (CLAUDE.md obligatorio).
         Detectamos HvH comprobando esHumano(home) && esHumano(away)
         directamente, NO por la clase del wrap. Cuando se abre la
         previa desde el calendario (via _ppPreviaTeams), el wrap
         puede no tener la clase 'hvh' correcta y el usuario veía
         "8 MIN" en partidos HvH que deberían mostrar "10 MIN". */
      var _humHome = (typeof window.esHumano === 'function') ? !!window.esHumano(home) : false;
      var _humAway = (typeof window.esHumano === 'function') ? !!window.esHumano(away) : false;
      var isHvHCenter = _humHome && _humAway;
      var _humanInvolved = _humHome || _humAway;
      /* Alias en eFootball: bajo el nombre del equipo IA cuando el rival
         es humano. Petición usuario 2026-05-02 — cuando un humano juega
         contra un equipo de Resto de Ligas que no existe en eFootball,
         se debe ver el nombre real arriba y el alias del juego debajo
         (p.ej. "BACKA TOPOLA" + "🎮 2ª SAMPDORIA"). En HvH y IAvIA no
         se muestra alias. */
      var _aliasFor = (typeof window.getTeamEfootballAlias === 'function')
        ? window.getTeamEfootballAlias : function(){ return ''; };
      var _ppHomeAliasTxt = (_humAway && !_humHome) ? _aliasFor(home) : '';
      var _ppAwayAliasTxt = (_humHome && !_humAway) ? _aliasFor(away) : '';
      function _ppAliasHtml(txt){
        if(!txt) return '';
        /* ❓ animado renderizado DIRECTAMENTE en el primer paint de la
           previa — NO esperamos al swap async de copa-engine (que tardaba
           hasta confirmar el balón). Así el rival eFootball es visible
           desde que se abre la previa. El alias completo se ve al pulsar
           → window._copaShowAlias. `data-copa-alias-replaced` evita que
           copa-engine reprocese el bloque. */
        var _aSafe = String(txt).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return '<div data-copa-alias-replaced="1" style="text-align:center;line-height:1;margin-top:3px;">'
          + '<button type="button" class="copa-alias-help" onclick="window._copaShowAlias&&window._copaShowAlias(this)" '
          + 'data-copa-alias-full="'+_aSafe+'" aria-label="Ver alias eFootball completo" '
          + 'style="background:none;border:none;color:#ffd54a;font-size:20px;cursor:pointer;padding:2px 8px;line-height:1;animation:copaAliasPulse 1.4s ease-in-out infinite;">❓</button>'
          + '</div>';
      }
      var _ppHomeAliasHtml = _ppAliasHtml(_ppHomeAliasTxt);
      var _ppAwayAliasHtml = _ppAliasHtml(_ppAwayAliasTxt);
      var durText;
      if (window._ppDurationMin) {
        durText = window._ppDurationMin + ' min';
      } else if (typeof window._mlRealDurationLabel === 'function') {
        durText = window._mlRealDurationLabel({ isHvH: isHvHCenter, humanInvolved: _humanInvolved, home: home, away: away });
      } else {
        durText = (isHvHCenter ? 10 : (_humanInvolved ? 8 : 1)) + ' min';
      }
      var durHtml = '<div style="font-family:Oswald,sans-serif;font-size:11px;letter-spacing:2px;color:#f0c040;text-align:center;margin-top:10px;">DURACIÓN</div>'
        + '<div id="pp-dur-center" onclick="window._ppEditDuration&&window._ppEditDuration()" style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;color:#fff;text-align:center;cursor:pointer;margin-top:2px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:rgba(240,192,64,.08);border:1px solid rgba(240,192,64,.35);border-radius:6px;padding:2px 10px;">' + durText + '<span style="font-size:13px;opacity:.8;">🖍</span></div>';
      var centerHtml = '<div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 6px;min-width:110px;">'
        + nivelHtml
        + '<div class="pp-vs-mid" style="padding:10px 0 0;font-size:28px;">VS</div>'
        + durHtml
        + '</div>';
      var _hiPvA = (typeof window.humanIcon === 'function') ? (window.humanIcon(home)||'') : '';
      var _hiPvB = (typeof window.humanIcon === 'function') ? (window.humanIcon(away)||'') : '';
      vs.innerHTML = '<div style="flex:1;text-align:center;min-width:0;">'+imgA+'<div style="font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;margin-top:6px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+_hiPvA+home.toUpperCase()+'</div>'+_ppHomeAliasHtml+_formBtnHtml('home')+'</div>'
        + centerHtml
        + '<div style="flex:1;text-align:center;min-width:0;">'+imgB+'<div style="font-family:Oswald,sans-serif;font-size:13px;letter-spacing:1px;margin-top:6px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+_hiPvB+away.toUpperCase()+'</div>'+_ppAwayAliasHtml+_formBtnHtml('away')+'</div>';
      /* Wire form buttons via addEventListener (more reliable on mobile than inline onclick) */
      ['home','away'].forEach(function(side) {
        var b = document.getElementById('pp-form-' + side);
        if (!b) return;
        b.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          window._ppRequestFormAdmin(side);
        });
        b.addEventListener('touchend', function(e) {
          e.preventDefault();
          e.stopPropagation();
          window._ppRequestFormAdmin(side);
        }, { passive: false });
      });
    }
    var alerts = document.getElementById('pp-alerts');
    if (alerts) {
      var alertsHtml = '';
      var bajas = window.BAJA_STORE || {};
      var lesionesStore = window.LESION_STORE || {};
      /* Solo jugadores de los 2 equipos del partido actual */
      var belongs = window._ppPlayerBelongsToMatch || function(){ return true; };
      var sancionados = Object.keys(bajas).filter(function(n){ var b=bajas[n]; return b && (b.tipo||b)==='sancion' && belongs(n); });
      var expulsados   = Object.keys(bajas).filter(function(n){ var b=bajas[n]; return b && (b.tipo||b)==='expulsion' && belongs(n); });
      var lesionados   = Object.keys(lesionesStore).filter(function(n){ return belongs(n); });
      sancionados.forEach(function(n) {
        var b=bajas[n]; var pts=(b&&b.liga)?b.liga+'P Liga':'';
        alertsHtml += '<div class="pp-alert-row pp-alert-yel">🟨 SANCIONADO: '+n+(pts?' · '+pts:'')+'</div>';
      });
      expulsados.forEach(function(n) {
        var b=bajas[n]; var pts=(b&&b.liga)?b.liga+' partido(s) restante(s)':'';
        alertsHtml += '<div class="pp-alert-row pp-alert-red">🟥 EXPULSADO: '+n+(pts?' · '+pts:'')+'</div>';
      });
      /* La lista detallada de LESIONADOS se ha retirado de la PREVIA
         (petición usuario 2026-05-27, Foto 2). Los lesionados se ven
         exclusivamente en la pantalla BAJAS PARA EL PARTIDO con el
         botón 💊 integrado por jugador, no aquí. Se conservan las
         alertas de SANCIONADO/EXPULSADO porque son menos frecuentes y
         útiles como aviso inmediato. */
      if (!alertsHtml) alertsHtml = '<div class="pp-alert-row pp-alert-ok">✅ Plantilla al 100% — Sin sancionados ni expulsados</div>';
      alerts.innerHTML = alertsHtml;
    }
  }

  function _renderList(items) {
    var list = document.getElementById('pp-list');
    if (!list) return;
    list.innerHTML = items.map(function(item) {
      var checked = _ppChecked[item.id];
      var icoCls = 'pp-ico';
      if (item.id === 'balon' && !checked) icoCls += ' pp-ball-bouncing';
      /* vstack: el valor va DEBAJO del label (2 l\u00edneas), no a la derecha.
         Usado para listas largas como "Bajas \u2014 NO convocar". */
      if (item.vstack) {
        return '<div class="pp-item pp-item-vstack' + (checked ? ' checked' : '') + '" data-ppid="' + item.id + '" style="flex-wrap:wrap;align-items:flex-start;">'
          + '<span class="pp-item-lbl" style="flex:1 1 auto;"><span class="' + icoCls + '">' + item.ico + '</span>' + item.lbl + '</span>'
          + '<span class="pp-check" style="flex-shrink:0;">' + (checked ? '\u2705' : '\u{1F533}') + '</span>'
          + '<span class="pp-item-val" style="flex:1 1 100%;margin-left:32px;margin-top:4px;text-align:left;font-size:12px;line-height:1.5;">' + item.val + '</span>'
          + '</div>';
      }
      return '<div class="pp-item' + (checked ? ' checked' : '') + '" data-ppid="' + item.id + '">'
        + '<span class="pp-item-lbl"><span class="' + icoCls + '">' + item.ico + '</span>' + item.lbl + '</span>'
        + '<span class="pp-item-val">' + item.val + '</span>'
        + '<span class="pp-check">' + (checked ? '\u2705' : '\u{1F533}') + '</span>'
        + '</div>';
    }).join('');
    var divs = list.querySelectorAll('.pp-item');
    for (var i = 0; i < divs.length; i++) {
      (function(d) {
        d.addEventListener('click', function(e) {
          /* Si se clicó el botón de editar, ignorar el toggle */
          if (e.target && e.target.closest && e.target.closest('[data-edit]')) return;
          window._ppToggle(d.getAttribute('data-ppid'));
        });
      })(divs[i]);
    }
    /* Wire edit buttons */
    list.querySelectorAll('[data-edit="duracion"]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (typeof window._ppEditDuration === 'function') window._ppEditDuration();
      });
    });
  }

  function _checkAllDone() {
    return _ppItems.every(function(item) { return _ppChecked[item.id]; });
  }

  function _updateBtn() {
    var btn = document.getElementById('pp-confirm-btn');
    if (!btn) return;
    var done = _checkAllDone();
    /* Twitch ELIMINADO como requisito obligatorio (2026-05-10
       — petición usuario). El selector se ha movido a otra
       pantalla y ya no debe bloquear el confirm. */
    var ok = done;
    btn.disabled = !ok;
    /* Si ya estamos en etapa 2 (Comenzar Partido), no sobreescribir el label */
    if (btn.getAttribute('data-pp-stage') !== '2') {
      if (ok) btn.textContent = '🎮 CONFIRMAR CONFIGURACIÓN';
      else btn.textContent = '🔒 MARCA TODAS LAS CASILLAS';
    }
    /* Hide pre-confirm WhatsApp button (now lives in sancion overlay) */
    var waBtn = document.getElementById('pp-wa-btn');
    if (waBtn) waBtn.style.display = 'none';
  }
  /* Expose to global so external handlers can refresh the unlock state */
  window._ppRefreshUnlock = _updateBtn;

  window._ppToggle = function(id) {
    _ppChecked[id] = !_ppChecked[id];
    _ppClickSfx();
    _renderPreviaMeta(_ppMatchKey, false);
    _renderList(_ppItems);
    _updateBtn();
    /* La línea de estación + clima ya se inyecta visible por defecto en
       `_mmInjectEnv`; no la toggle-amos aquí. */
    // If all done, reveal venue-bar and ball immediately
    if (_checkAllDone() && _ppMatchKey) {
      var vbar = document.getElementById('venue-bar-' + _ppMatchKey);
      var bwrap = document.getElementById('ball-wrap-' + _ppMatchKey);
      if (vbar) vbar.classList.remove('pre-hidden');
      if (bwrap) bwrap.classList.remove('pre-hidden');
    }
  };

  window.showPrePartidoOverlay = function(matchKey, compKey, prorroga, duracion, isHvH) {
    _ppMatchKey = matchKey;
    _ppCompKey  = compKey;
    /* Sync a window para que el menú médico (otra IIFE) pueda
       re-renderizar la card LESIONADO tras curar a un jugador. */
    window._ppMatchKey = matchKey;
    window._ppCompKey  = compKey;
    _ppChecked  = {};
    /* Reset form state for new match */
    if (typeof window._ppResetFormStates === 'function') window._ppResetFormStates();
    /* "Recuperado" es transitorio: solo se muestra durante la previa en la
       que el usuario curó al jugador. Al abrir una nueva previa, reset. */
    window._ppJustCured = {};
    /* Reset del canal Twitch AL ABRIR la previa (antes estaba en
       `_mmInjectEnv`, que corre 60 ms después; si el usuario abría la
       previa del siguiente partido rápido, veía el canal del partido
       anterior "anclado" hasta que llegaba el reset diferido). */
    try {
      window._ppSelectedTwitch = '';
      var _selReset = document.getElementById('pp-twitch-select');
      if (_selReset) _selReset.value = '';
    } catch(_){}
    _ppItems    = _buildItems(matchKey, compKey, prorroga, duracion, isHvH);

    var COMP_LABELS = {
      'liga':'Liga EA Sports','copa':'Copa del Rey','copa-fin':'Copa del Rey · Final',
      'sc':'Semis Supercopa España','sc-final':'Final Supercopa España',
      'usc':'UEFA Super Cup','usc-fin':'UEFA Super Cup · Final',
      'ucl':'Champions League','ucl-fin':'Champions League · Final',
      'uel':'Europa League','uel-fin':'Europa League · Final',
      'uecl':'Conference League','uecl-fin':'Conference League · Final',
      'superliga':'Superliga','inter':'Copa Intercontinental','inter-fin':'Intercontinental · Final',
      'amistoso':'Partido Amistoso'
    };

    var sub = document.getElementById('pp-subtitle');
    if (sub) sub.textContent = (COMP_LABELS[compKey] || compKey).toUpperCase();

    _renderPreviaMeta(matchKey, isHvH);
    _renderList(_ppItems);
    _updateBtn();
    /* Reset etapa del botón Confirmar (vuelve a "CONFIRMAR CONFIGURACIÓN") */
    var _btnReset = document.getElementById('pp-confirm-btn');
    if (_btnReset) {
      _btnReset.removeAttribute('data-pp-stage');
      _btnReset.style.background = '';
      _btnReset.style.color = '';
      _btnReset.style.borderColor = '';
      _btnReset.style.boxShadow = '';
    }
    document.getElementById('prepartido-overlay').classList.add('show');
    window.scrollTo(0, 0);
  };

  window._ppConfirm = function() {
    if (!_checkAllDone()) return;
    /* Twitch ELIMINADO como requisito (2026-05-10 — petición usuario).
       Se movió a otra pantalla y ya no debe bloquear el flujo. */
    /* ── Etapa 1 → Etapa 2: convertir el botón en "▶ COMENZAR PARTIDO" ── */
    var btn = document.getElementById('pp-confirm-btn');
    if (btn && btn.getAttribute('data-pp-stage') !== '2') {
      btn.setAttribute('data-pp-stage', '2');
      btn.textContent = '▶ COMENZAR PARTIDO';
      btn.style.background = 'linear-gradient(135deg,rgba(61,204,110,.28),rgba(40,180,90,.18))';
      btn.style.color = '#5fe08a';
      btn.style.borderColor = 'rgba(95,224,138,.6)';
      btn.style.boxShadow = '0 0 22px rgba(95,224,138,.35)';
      return;
    }
    // Reveal venue-bar and ball (in case not yet revealed)
    if (_ppMatchKey) {
      if (typeof window._mlEnsureLegacyPreMatchStructure === 'function') {
        window._mlEnsureLegacyPreMatchStructure(_ppMatchKey);
      }
      var vbar = document.getElementById('venue-bar-' + _ppMatchKey);
      var bwrap = document.getElementById('ball-wrap-' + _ppMatchKey);
      if (vbar) vbar.classList.remove('pre-hidden');
      if (bwrap) bwrap.classList.remove('pre-hidden');
      // Ocultar botón de configuración, dejar solo el timer
      var previaBtn = document.getElementById('ml-previa-' + _ppMatchKey);
      if (previaBtn) previaBtn.style.display = 'none';
    }
    document.getElementById('prepartido-overlay').classList.remove('show');
    // Mostrar SIEMPRE el overlay obligatorio de bajas; al confirmar (= compartir
    // por WhatsApp), revelar el timer.
    var mk = _ppMatchKey;
    function _afterShare() {
      var timerBtn = document.getElementById('ml-timer-' + mk);
      var timerRow = document.getElementById('ml-timer-row-' + mk);
      if (timerRow) timerRow.style.display = '';
      if (timerBtn) timerBtn.disabled = false;
      var addBtn = document.getElementById('ml-add-btn-' + mk);
      if (addBtn) addBtn.style.visibility = '';
      var actBar = document.getElementById('ml-actions-bar-' + mk);
      if (actBar) actBar.style.visibility = '';
      var wrap = document.getElementById('mlw-' + mk);
      if (wrap) wrap.setAttribute('data-prepartido-ready', '1');
      /* Mostrar la fila del cronómetro ⏪ [▶/⏸] ⏩ junto con el ▶. */
      if (typeof window._mlRenderTimerGen === 'function') {
        try { window._mlRenderTimerGen(mk); } catch(_){}
      }
      if (window._ppCustomCallback) { var fn=window._ppCustomCallback; window._ppCustomCallback=null; fn(); }
    }
    /* Marcar el overlay como "modo previa" para que sancion-ov-ok comparta WA */
    window._ppForceSancionShareMode = true;
    /* Amistosos: NO mostrar el panel de SANCIONADOS / EXPULSADOS /
       LESIONADOS / ESTADO DE FORMA tras la previa (petición usuario).
       En amistosos ese panel no tiene sentido — son partidos de
       exhibición que no afectan a sanciones acumuladas en Liga.
       Saltamos directo a `_afterShare` para revelar el ▶. */
    if (_ppCompKey === 'amistoso') {
      _afterShare();
      return;
    }
    if (typeof window.showSancionOverlay === 'function') {
      window.showSancionOverlay(_ppCompKey, null, _afterShare);
      /* Si por cualquier motivo el overlay se omitió (sin bajas), forzar mostrarlo */
      var ov = document.getElementById('sancion-overlay');
      if (ov && !ov.classList.contains('show')) {
        ov.classList.add('show');
        window._sancionCallback = _afterShare;
      }
    } else {
      _afterShare();
    }
  };

  /* Abrir partido del calendario pasando primero por la PANTALLA DE PREVIA */
  window._openMatchWithPrevia = function(j, home, away) {
    /* ── Si el partido YA está vivo en el gm-modal activo (__GM_LIVE),
       reabrimos el modal directamente sin pasar por la pantalla de
       pre-partido para no reiniciar el estado. */
    var gm = window.__GM_LIVE;
    if (gm && !gm.finished && gm.j === j && gm.home === home && gm.away === away) {
      /* Actualizamos returnScreen para que al cerrar el modal con
         ☰ Menú · 🔴 LIVE se vuelva a la jornada actual en lugar de a
         la pantalla en la que se abrió originalmente. */
      try {
        var _active = document.querySelector('.screen.active');
        if (_active && _active.id) gm.returnScreen = _active.id;
      } catch(_) {}
      if (typeof window.gmReopen === 'function') {
        try { window.gmReopen(); return; } catch(_) {}
      }
      var modal = document.getElementById('gm-modal');
      if (modal) { modal.style.display = ''; return; }
    }
    /* ── Si el partido está en segundo plano (otro partido humano que
       se quedó pausado en _gmBg mientras el usuario abría otro), lo
       restauramos via gmOpenFromLive, que hace snapshot-el-actual y
       load-el-pedido en un solo paso. */
    var bg = window._gmBg;
    if (bg) {
      var bgKey = (j || 0) + '|' + (home || '') + '|' + (away || '');
      if (bg[bgKey] && typeof window.gmOpenFromLive === 'function') {
        try { window.gmOpenFromLive(bgKey); return; } catch(_) {}
      }
    }
    var isHvH = (typeof esHumano === 'function') && esHumano(home) && esHumano(away);
    /* Duración real según spec (_MATCH_RULE) — CLAUDE.md obligatorio. */
    var duracion = (typeof window._mlRealDurationLabel === 'function')
      ? window._mlRealDurationLabel({ isHvH: isHvH, humanInvolved: !isHvH })
      : (isHvH ? '16.5 min' : '13.5 min');
    /* Guardar equipos + jornada para que _renderPreviaMeta y _ppShareWA
       los usen. Incluimos `j` porque _ppShareWA necesita la jornada
       para pintar "Jornada N" en la primera línea del mensaje de
       WhatsApp — antes sólo llegaba por el regex sobre matchKey y en
       algunos dispositivos fallaba, dejando "🏆 Liga EA Sports" sin
       el número de jornada. */
    window._ppPreviaTeams = { home: home, away: away, j: j };
    window._ppCustomCallback = function() {
      window._ppPreviaTeams = null;
      if (typeof window.abrirResultadoLiga === 'function') {
        window.abrirResultadoLiga(j, home, away);
      }
    };
    if (typeof window.showPrePartidoOverlay === 'function') {
      window.showPrePartidoOverlay('lj' + j + 'm0', 'liga', 'No', duracion, isHvH);
    }
  };

})();


/* script block 28 */

(function(){
  // ── Enhance submenu-cards with background icon ──────────────────
  document.querySelectorAll('.submenu-card').forEach(function(card){
    // Skip already enhanced
    if(card.querySelector('[data-bg-enhanced]')) return;
    card.style.position='relative';
    card.style.overflow='hidden';

    var emojiEl=card.querySelector('.sc-emoji');
    var imgEl=card.querySelector('.sc-img');
    var txt=emojiEl?emojiEl.textContent:'';

    // Choose better icon by label
    var label=(card.querySelector('.sc-label')||{}).textContent||'';
    var ico={
      'Liga EA Sports':'⚽','Copa del Rey':'🏆','Supercopa de España':'👑','Estadísticas':'📊',
      'Clasificación':'📊','Champions League':'⭐','Europa League':'🔶',
      'Conference League':'🟢','UEFA Supercup':'🥇','Intercontinental':'🌎',
      'Superliga':'⭐','Fase de Liga':'⭐','Fase Grupos':'🏆','Playoffs / Final':'🥇',
      'Fase Previa':'🔶','Playoffs Final':'🥇','Cuadro de Eliminatorias':'🗂️',
      'Calendario':'📅'
    }[label.trim()]||txt||'⚽';

    // Background element
    if(imgEl&&imgEl.src){
      var bg=document.createElement('img');
      bg.src=imgEl.src;
      bg.setAttribute('aria-hidden','true');
      bg.setAttribute('data-bg-enhanced','1');
      bg.style.cssText='position:absolute;right:-12px;top:50%;transform:translateY(-50%);height:175%;width:auto;object-fit:contain;opacity:0.22;pointer-events:none;z-index:0;';
      card.insertBefore(bg,card.firstChild);
    } else {
      var bg=document.createElement('span');
      bg.textContent=ico;
      bg.setAttribute('aria-hidden','true');
      bg.setAttribute('data-bg-enhanced','1');
      bg.style.cssText='position:absolute;right:-10px;top:50%;transform:translateY(-50%);font-size:70px;opacity:0.2;pointer-events:none;line-height:1;z-index:0;';
      card.insertBefore(bg,card.firstChild);
    }

    // Overlay
    var ov=document.createElement('div');
    ov.setAttribute('aria-hidden','true');
    ov.style.cssText='position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0.52) 0%,rgba(0,0,0,0.15) 55%,rgba(0,0,0,0) 100%);pointer-events:none;z-index:1;';
    card.insertBefore(ov,card.children[1]);

    // Lift content above overlay
    Array.from(card.children).forEach(function(c){
      if(!c.getAttribute('data-bg-enhanced')&&!c.style.cssText.includes('inset')){
        c.style.position='relative';
        c.style.zIndex='2';
      }
    });
  });

  // ── Enhance Resto de Ligas flag cards ───────────────────────────
  var ligasEl=document.getElementById('s-ligas');
  if(!ligasEl)return;
  ligasEl.querySelectorAll('.menu-card').forEach(function(card){
    if(card.querySelector('[data-flag-bg]')) return;
    // Skip already enhanced team/main cards
    if(card.querySelector('.mc-equipo-badge-bg,.mc-main-bg')) return;
    card.style.position='relative';
    card.style.overflow='hidden';

    var emojiEl=card.querySelector('.mc-emoji');
    if(!emojiEl)return;

    var bg=document.createElement('span');
    bg.textContent=emojiEl.textContent;
    bg.setAttribute('aria-hidden','true');
    bg.setAttribute('data-flag-bg','1');
    bg.style.cssText='position:absolute;right:-10px;top:50%;transform:translateY(-50%);font-size:54px;opacity:0.38;pointer-events:none;line-height:1;z-index:0;';
    card.insertBefore(bg,card.firstChild);

    var ov=document.createElement('div');
    ov.setAttribute('aria-hidden','true');
    ov.style.cssText='position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0.48) 0%,rgba(0,0,0,0.12) 55%,rgba(0,0,0,0) 100%);pointer-events:none;z-index:1;';
    card.insertBefore(ov,card.children[1]);

    Array.from(card.children).forEach(function(c){
      if(!c.getAttribute('data-flag-bg')&&!c.style.cssText.includes('inset')){
        c.style.position='relative';
        c.style.zIndex='2';
      }
    });
  });
})();


/* script block 29 */

(function() {
'use strict';

// ══════════════════════════════════════════════════════════
// 1. BAJA STORE — persiste en sesión
// ══════════════════════════════════════════════════════════
// Estructura: { 'Nombre Jugador': { tipo:'lesion'|'sancion'|'expulsion', liga:N, copa:N, europa:N } }
window.BAJA_STORE = window.BAJA_STORE || {};

// Helper: obtener tipo de baja
function _bajaTipo(nombre) {
  var b = window.BAJA_STORE[nombre];
  if (!b) return null;
  return (typeof b === 'string') ? b : b.tipo;
}
// Helper: obtener partidos restantes
function _bajaPartidos(nombre) {
  var b = window.BAJA_STORE[nombre];
  if (!b) return {liga:0,copa:0,europa:0};
  if (typeof b === 'string') return {liga:0,copa:0,europa:0};
  return { liga: b.liga||0, copa: b.copa||0, europa: b.europa||0 };
}
// Helper: texto resumen de partidos restantes para mostrar en la fila
function _bajaBadgeText(nombre) {
  var p = _bajaPartidos(nombre);
  var parts = [];
  if (p.liga > 0)   parts.push('L' + p.liga);
  if (p.copa > 0)   parts.push('C' + p.copa);
  if (p.europa > 0) parts.push('E' + p.europa);
  return parts.join(' ');
}

// ══════════════════════════════════════════════════════════
// 2. MODAL DE BAJA
// ══════════════════════════════════════════════════════════
var _bajaRow   = null;
var _bajaName  = null;

window.openBajaModal = function(row, nombre) {
  _bajaRow  = row;
  _bajaName = nombre;
  document.getElementById('baja-modal-name').textContent = nombre.toUpperCase();

  // Mostrar panel de partidos si hay baja activa
  var tipo = _bajaTipo(nombre);
  var panel = document.getElementById('baja-partidos-panel');
  if (tipo) {
    panel.style.display = 'block';
    var p = _bajaPartidos(nombre);
    document.getElementById('baja-p-liga').textContent   = p.liga;
    document.getElementById('baja-p-copa').textContent   = p.copa;
    document.getElementById('baja-p-europa').textContent = p.europa;
  } else {
    panel.style.display = 'none';
  }
  document.getElementById('baja-modal').classList.add('show');
};

// Ajuste de partidos restantes desde los botones +/-
window._bajaPartidosAdj = function(comp, delta) {
  if (!_bajaName) return;
  var b = window.BAJA_STORE[_bajaName];
  if (!b || typeof b === 'string') {
    // Convertir a objeto si era string antiguo
    var tipo = (typeof b === 'string') ? b : 'lesion';
    b = window.BAJA_STORE[_bajaName] = { tipo: tipo, liga:0, copa:0, europa:0 };
  }
  b[comp] = Math.max(0, (b[comp]||0) + delta);
  document.getElementById('baja-p-' + comp).textContent = b[comp];
  // Actualizar badge en la fila
  _updateBajaBadge(_bajaRow, _bajaName);
  if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
};

function _updateBajaBadge(row, nombre) {
  if (!row) return;
  var badge = row.querySelector('.plant-baja-badge');
  var txt = _bajaBadgeText(nombre);
  if (badge) {
    badge.textContent = txt;
    badge.style.display = txt ? 'inline' : 'none';
  }
}

window._bajaClose = function() {
  document.getElementById('baja-modal').classList.remove('show');
  document.querySelectorAll('.plant-row.row-longpress').forEach(function(r){
    r.classList.remove('row-longpress');
  });
  _bajaRow = null; _bajaName = null;
};

window._bajaPick = function(tipo) {
  if (!_bajaRow || !_bajaName) { window._bajaClose(); return; }
  if (tipo === 'clear') {
    delete window.BAJA_STORE[_bajaName];
    _bajaRow.classList.remove('baja-lesion','baja-sancion','baja-expulsion');
    var btn = _bajaRow.querySelector('.plant-baja-btn');
    if (btn) { btn.textContent = ''; btn.className = 'plant-baja-btn'; }
    var badge = _bajaRow.querySelector('.plant-baja-badge');
    if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
  } else {
    // Preservar partidos si ya existía la baja
    var prev = window.BAJA_STORE[_bajaName];
    var prevPartidos = (prev && typeof prev === 'object') ? { liga: prev.liga||0, copa: prev.copa||0, europa: prev.europa||0 } : { liga:0, copa:0, europa:0 };
    window.BAJA_STORE[_bajaName] = { tipo: tipo, liga: prevPartidos.liga, copa: prevPartidos.copa, europa: prevPartidos.europa };
    _bajaRow.classList.remove('baja-lesion','baja-sancion','baja-expulsion');
    _bajaRow.classList.add('baja-' + tipo);
    var btn = _bajaRow.querySelector('.plant-baja-btn');
    var ico = tipo === 'lesion' ? '🚑' : tipo === 'sancion' ? '🟨' : '🟥';
    if (btn) { btn.textContent = ico; btn.className = 'plant-baja-btn ' + tipo; }
    // Mostrar panel de partidos inmediatamente
    document.getElementById('baja-partidos-panel').style.display = 'block';
    document.getElementById('baja-p-liga').textContent   = prevPartidos.liga;
    document.getElementById('baja-p-copa').textContent   = prevPartidos.copa;
    document.getElementById('baja-p-europa').textContent = prevPartidos.europa;
    _updateBajaBadge(_bajaRow, _bajaName);
    // NO cerrar el modal — dejar al usuario ajustar partidos
    if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
    return; // no cerrar
  }
  window._bajaClose();
  if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
};

// ══════════════════════════════════════════════════════════
// 3. SINCRONIZAR PLANT-ROWS DESDE SQUAD_REGISTRY
//    — actualiza nombre, valor 🛡, y añade botón baja
// ══════════════════════════════════════════════════════════
var POS_MAP_H = {
  '🧤 PORTEROS': 'por',
  '🛡 DEFENSAS': 'def',
  '⚙️ MEDIOS':   'med',
  '⚡ DELANTEROS':'del'
};
var POS_LABEL = {
  'por': '🧤 PORTEROS',
  'def': '🛡 DEFENSAS',
  'med': '⚙️ MEDIOS',
  'del': '⚡ DELANTEROS'
};

function makePlantRow(num, nombre, posClass, poder, stats) {
  var baja = _bajaTipo(nombre) || '';
  var bajaClass = baja ? ' baja-' + baja : '';
  var bajaIco   = baja === 'lesion' ? '🚑' : baja === 'sancion' ? '🟨' : baja === 'expulsion' ? '🟥' : '';
  var btnClass  = 'plant-baja-btn' + (baja ? ' ' + baja : '');
  var badgeTxt  = _bajaBadgeText(nombre);
  /* `stats` (si se pasa) es el objeto devuelto por getPlayerStats():
     {pj,gol,pen,fk,mvp,ta,tr,imbat,penSaved}. Si no hay datos se
     rellena con 0s, como antes. La clase .zero se quita cuando el
     valor es >0 para quitar el color apagado y dejarlo destacado. */
  var s = stats || {};
  var n = function(k){ var v = parseInt(s[k], 10); return isNaN(v) ? 0 : v; };
  var span = function(cls, val) {
    var v = parseInt(val, 10) || 0;
    var zero = v > 0 ? '' : ' zero';
    return '<span class="plant-stat' + zero + '"><span class="' + cls + '" data-global="' + v + '" data-liga="' + v + '" data-copa="0" data-uecl="0" data-super="0" hidden></span>' + v + '</span>';
  };
  var pens   = n('pen');      /* penaltis marcados */
  var pensT  = n('penTirados'); if (!pensT) pensT = pens;
  var penFrac = '<span class="plant-stat' + (pens > 0 ? '' : ' zero') + ' frac"><span class="ps-pen-gol" data-global="' + pens + '" data-liga="' + pens + '" data-copa="0" data-uecl="0" data-super="0" data-tirado="' + pensT + '" hidden></span>' + pens + '/' + pensT + '</span>';
  return '<div class="plant-row ' + posClass + bajaClass + '" data-player="' + nombre.replace(/"/g,'&quot;') + '">'
    + '<span class="plant-num">' + num + '</span>'
    + '<span class="plant-name">' + nombre
      + (badgeTxt ? ' <span class="plant-baja-badge">' + badgeTxt + '</span>' : '<span class="plant-baja-badge" style="display:none"></span>')
    + '</span>'
    + (posClass === 'por' ? span('ps-cs', n('imbat')) : span('ps-gol', n('gol')))
    + span('ps-yel', n('ta'))
    + span('ps-red', n('tr'))
    + span('ps-mvp', n('mvp'))
    + '<span class="plant-stat poder zero">' + (poder || 70) + '</span>'
    + penFrac
    + span('ps-pen-prov', n('penProv'))
    + span('ps-pen-parado', n('penSaved'))
    + span('ps-falta-gol', n('fk'))
    + span('ps-propia', n('propia'))
    + '<button class="' + btnClass + '" title="Marcar baja" onclick="window.openBajaModal(this.closest(\'.plant-row\'),\'' + nombre.replace(/'/g,"\\'") + '\')">' + bajaIco + '</button>'
    + '</div>';
}

function makePosHdr(posClass, screenEl) {
  // Intentar detectar color del equipo desde el screen
  var hdrStyle = '';
  var h2 = screenEl ? screenEl.querySelector('.sec-hdr h2') : null;
  return '<div class="plant-pos-hdr"><i class="ico">' + POS_LABEL[posClass].split(' ')[0] + '</i> '
    + POS_LABEL[posClass].replace(/^[^\s]+\s/,'').toUpperCase() + '</div>';
}

function syncSquadToScreen(screenId, teamName) {
  var reg = window.SQUAD_REGISTRY && window.SQUAD_REGISTRY[teamName];
  if (!reg || !reg.length) return;

  // Buscar el contenedor de la plantilla en este screen
  var screen = document.getElementById(screenId);
  if (!screen) return;
  var plantBody = screen.querySelector('.ent-body[id$="-plantilla"], .ent-body[id*="plantilla"], .ent-body[class*="body-plantilla"]');
  if (!plantBody) {
    // Fallback seguro para pantallas dedicadas tipo "s-xxx-plantilla"
    // (evitar capturar contenedores genéricos como ".ath-box-plantilla").
    var secHdr = screen.querySelector('.sec-hdr');
    if (secHdr && secHdr.nextElementSibling && secHdr.nextElementSibling.tagName === 'DIV') {
      plantBody = secHdr.nextElementSibling;
    }
  }
  if (!plantBody) return;

  // Construir HTML desde registry
  var posMap = {
    '🧤 PORTEROS':'por', '🛡 DEFENSAS':'def',
    '⚙️ MEDIOS':'med',   '⚡ DELANTEROS':'del',
    '⚙️CENTROCAMPISTAS':'med','⚙️ CENTROCAMPISTAS':'med'
  };
  var html = '';
  var curPos = 'med';
  var prevPos = null;
  for (var i = 0; i < reg.length; i++) {
    var e = reg[i];
    if (e.h) {
      curPos = posMap[e.h] || 'med';
      if (curPos !== prevPos) {
        html += makePosHdr(curPos, screen);
        var statIcon = (curPos === 'por') ? '🧤' : '⚽';
        html += '<div class="pos-mini-hdr ' + curPos + '"><span>#</span><span>Jugador</span><span>' + statIcon + '</span><span>🟨</span><span>🟥</span><span>⭐</span><span>🛡️</span></div>';
        prevPos = curPos;
      }
    } else {
      /* Si existe `getPlayerStats` (definido en misc_body_1.html),
         pasamos los stats reales del storage compartido
         `ef_player_stats_v1` — la MISMA fuente que usa el modal del
         editor de Liga. Así goles/tarjetas/MVP suben en ambas vistas.
         Si no existe, makePlantRow rellena 0s. */
      var playerStats = null;
      if (typeof window.getPlayerStats === 'function') {
        try { playerStats = window.getPlayerStats(teamName, e[0]); } catch(_){}
      }
      html += makePlantRow(e[0], e[1], curPos, e[2] || 70, playerStats);
    }
  }

  // Preservar el filter-bar y col-hdr si existen, reemplazar solo las rows+headers de posición
  var filterBar = plantBody.querySelector('.plant-filter-bar');
  var colHdr    = plantBody.querySelector('.plant-col-hdr');
  var badge     = plantBody.querySelector('.badge-total,[class*="badge-total"]');

  // Limpiar solo filas de jugadores y headers de posición
  var toRemove = plantBody.querySelectorAll('.plant-row, .plant-pos-hdr, .pos-mini-hdr');
  toRemove.forEach(function(el) { el.parentNode.removeChild(el); });

  // Insertar nuevo HTML
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  while (tmp.firstChild) {
    plantBody.appendChild(tmp.firstChild);
  }

  // Actualizar badge total
  var totalBadge = plantBody.querySelector('[class*="badge-total"]');
  var total = reg.filter(function(e){ return !e.h; }).length;
  if (totalBadge) totalBadge.textContent = total;

  // Restaurar bajas visuales
  plantBody.querySelectorAll('.plant-row[data-player]').forEach(function(row) {
    var nombre = row.getAttribute('data-player');
    var baja = nombre && window.BAJA_STORE[nombre];
    if (baja) {
      row.classList.add('baja-' + baja);
      var btn = row.querySelector('.plant-baja-btn');
      var ico = baja === 'lesion' ? '🚑' : baja === 'sancion' ? '🟨' : '🟥';
      if (btn) { btn.textContent = ico; btn.className = 'plant-baja-btn ' + baja; }
    }
  });
}

// Mapa screenId → teamName
var SCREEN_SQUAD_MAP = {
  /* 's-munich' se omite a propósito: la pantalla del Bayern es un
     HUD tipo Arena (no un listado de jugadores), y dejarla aquí hace
     que `syncSquadToScreen` inyecte los porteros/defensas/medios del
     Bayern Munich debajo del HUD (usa el fallback .sec-hdr + siguiente
     DIV). El usuario no quiere ver la plantilla en esa pantalla.
     's-bayern-plantilla' también se omite: tiene su propio renderer
     en `misc_body_1.html` (`renderBayernPlantillaScreen`) que reusa
     el layout EXACTO del modal del editor EA Sports (lext-sq-*) y
     suma stats de TODAS las competiciones oficiales. Mantenerla aquí
     duplica el render con dos layouts distintos. */
  's-arsenal':       'Arsenal',
  's-sporting':      'Sporting CP',
  's-madrid':        'Real Madrid',
  's-barca':         'FC Barcelona',
  's-atletico':      'Atlético Madrid',
  's-albacete':      'Albacete BP',
  's-villarreal':    'Villarreal CF',
  's-sevilla':       'Sevilla FC',
  's-espanyol':      'Espanyol',
  's-getafe':        'Getafe CF',
  'celta-screen':    'Celta de Vigo',
  'osasuna-screen':  'Osasuna',
  'alaves-screen':   'Deportivo Alavés',
  'girona-screen':   'Girona FC',
  'oviedo-screen':   'Real Oviedo',
  'levante-screen':  'Levante UD',
  'mallorca-screen': 'Mallorca',
  'elche-screen':    'Elche CF',
  'valencia-screen': 'Valencia CF',
  'rayo-screen':     'Rayo Vallecano',
  'athletic-screen': 'Athletic Club',
  'betis-screen':    'Real Betis',
  'sociedad-screen': 'Real Sociedad'
};

// Sincronizar al abrir cada pantalla de equipo
var _syncedScreens = {};
var _origGo = window.go;
window.go = function(screenId) {
  if (_origGo) _origGo(screenId);
  if (SCREEN_SQUAD_MAP[screenId] && !_syncedScreens[screenId]) {
    _syncedScreens[screenId] = true;
    // Pequeño delay para asegurar que la pantalla es visible
    setTimeout(function() {
      syncSquadToScreen(screenId, SCREEN_SQUAD_MAP[screenId]);
    }, 80);
  }
};

// También sincronizar en DOMContentLoaded para la pantalla activa inicial
document.addEventListener('DOMContentLoaded', function() {
  var active = document.querySelector('.screen.active');
  if (active && SCREEN_SQUAD_MAP[active.id] && !_syncedScreens[active.id]) {
    _syncedScreens[active.id] = true;
    syncSquadToScreen(active.id, SCREEN_SQUAD_MAP[active.id]);
  }
});

// ══════════════════════════════════════════════════════════
// 4. sqFromRegistry RESPETA BAJA_STORE
//    — parcha la función existente para excluir bajas
// ══════════════════════════════════════════════════════════
var _origSqFromRegistry = window.sqFromRegistry;
window.sqFromRegistry = function(teamName, opts) {
  // Obtener bajas del BAJA_STORE para este equipo
  var reg = window.SQUAD_REGISTRY && (
    window.SQUAD_REGISTRY[teamName] ||
    window.SQUAD_REGISTRY[(window.TEAM_ALIASES||{})[teamName]] 
  );
  var bajaNames = [];
  if (reg) {
    reg.forEach(function(e) {
      if (!e.h && window.BAJA_STORE[e[1]]) {
        bajaNames.push(e[1]);
      }
    });
  }
  // Fusionar con excluded recibido
  var existingExcluded = (opts && opts.excluded) ? opts.excluded : [];
  var allExcluded = existingExcluded.concat(bajaNames);
  var newOpts = { excluded: allExcluded };
  if (opts) {
    for (var k in opts) {
      if (k !== 'excluded') newOpts[k] = opts[k];
    }
  }
  return _origSqFromRegistry ? _origSqFromRegistry(teamName, newOpts) : [];
};

// sqFromRegistryFull también respeta bajas (devuelve todos pero marca los que están de baja)
var _origSqFromRegistryFull = window.sqFromRegistryFull;
window.sqFromRegistryFull = function(teamName) {
  var result = _origSqFromRegistryFull ? _origSqFromRegistryFull(teamName) : [];
  // Marcar jugadores en baja — los mantiene en la lista (humano ve todos)
  // pero con una propiedad 'baja' para que el overlay los muestre tachados
  result.forEach(function(p) {
    var baja = window.BAJA_STORE[p[1]];
    if (baja) p[5] = baja; // p[5] = tipo de baja
  });
  return result;
};

// ══════════════════════════════════════════════════════════
// 5. CONECTAR LESIONADOS AL OVERLAY PRE-PARTIDO
// ══════════════════════════════════════════════════════════
window._refreshSancionInjList = function() {
  var listInj = document.getElementById('sancion-ov-list-inj');
  if (!listInj) return;
  /* Filtro "solo humanos del partido": usamos _ppGetCurrentMatchTeams
     para los 2 equipos y esHumano para saber cuáles son humanos. Un
     jugador pasa el filtro si su equipo (LESION_STORE.equipo) coincide
     con alguno de esos humanos. Sin contexto → no filtramos (fallback
     seguro). */
  var matchTeams = (typeof window._ppGetCurrentMatchTeams === 'function')
    ? window._ppGetCurrentMatchTeams() : null;
  var humansOfMatch = null;
  if (matchTeams && typeof window.esHumano === 'function') {
    var _hm = [];
    if (matchTeams.home && window.esHumano(matchTeams.home)) _hm.push(matchTeams.home);
    if (matchTeams.away && window.esHumano(matchTeams.away)) _hm.push(matchTeams.away);
    if (_hm.length) humansOfMatch = _hm;
  }
  function _normT(s){
    return (typeof window._ppNormTeam === 'function')
      ? window._ppNormTeam(s) : String(s||'').trim().toLowerCase();
  }
  function _belongsHuman(playerName){
    if (!humansOfMatch) return true;
    var les = window.LESION_STORE && window.LESION_STORE[playerName];
    var eq  = les && les.equipo ? _normT(les.equipo) : '';
    if (!eq) {
      /* Sin equipo conocido: si existe SQUAD_REGISTRY, buscamos su team */
      if (window.SQUAD_REGISTRY) {
        var found = null;
        Object.keys(window.SQUAD_REGISTRY).some(function(tn){
          var sq = window.SQUAD_REGISTRY[tn] || [];
          for (var i = 0; i < sq.length; i++) {
            var p = sq[i];
            if (Array.isArray(p) && p[1] === playerName) { found = tn; return true; }
          }
          return false;
        });
        if (found) eq = _normT(found);
      }
    }
    if (!eq) return false;
    for (var i = 0; i < humansOfMatch.length; i++) {
      var hn = _normT(humansOfMatch[i]);
      if (eq === hn) return true;
      if (hn && (eq.indexOf(hn) !== -1 || hn.indexOf(eq) !== -1)) return true;
    }
    return false;
  }
  var bajas = Object.keys(window.BAJA_STORE).filter(_belongsHuman);
  var cardsHtml = '';
  if (!bajas.length) {
    cardsHtml = '<div class="sancion-empty">🚑 Sin lesionados</div>';
  } else {
    cardsHtml = bajas.map(function(nombre) {
      var b    = window.BAJA_STORE[nombre];
      var tipo = (typeof b === 'string') ? b : b.tipo;
      var ico  = tipo === 'lesion' ? '🚑' : tipo === 'sancion' ? '🟨' : (tipo === 'forma' ? '↘️' : '🟥');
      var lbl  = tipo === 'lesion' ? 'LESIONADO' : tipo === 'sancion' ? 'SANCIONADO' : (tipo === 'forma' ? 'BAJA FORMA' : 'EXPULSADO');
      var p    = (typeof b === 'object') ? b : {liga:0,copa:0,europa:0};
      var partsTxt = '';
      if (p.liga > 0)   partsTxt += '<span style="margin-right:8px">🇪🇸 ' + p.liga + 'P</span>';
      if (p.copa > 0)   partsTxt += '<span style="margin-right:8px">🏆 ' + p.copa + 'P</span>';
      if (p.europa > 0) partsTxt += '<span>🌍 ' + p.europa + 'P</span>';
      return '<div class="sancion-card">'
        + '<div class="sancion-card-icon">' + ico + '</div>'
        + '<div class="sancion-card-info">'
        + '<div class="sancion-card-name">' + nombre + '</div>'
        + '<div class="sancion-card-reason">' + lbl + '</div>'
        + (partsTxt ? '<div style="font-family:Oswald,sans-serif;font-size:11px;color:#f0c040;margin-top:3px;letter-spacing:1px;">' + partsTxt + '</div>' : '')
        + '</div></div>';
    }).join('');
  }
  listInj.innerHTML = cardsHtml + (typeof window._renderFormaChecklist === 'function' ? window._renderFormaChecklist() : '');
  var warnEl = document.getElementById('sancion-ov-warn');
  if (warnEl) warnEl.style.display = 'block';
};

// ══════════════════════════════════════════════════════════
// 5B. AÑADIR LESIONADOS MANUALMENTE EN LA PREVIA — ⬇️
//    - ⬇️ = el usuario marca al jugador como lesionado.
//      Severidad aleatoria MODERADA 💉 (65%) o GRAVE 🚑 (35%).
//    Sin acumulador ↘️ — directo al grano. Estado solo por partido,
//    no se persiste entre sesiones.
// ══════════════════════════════════════════════════════════
window._FORMA_MATCH_STATES = window._FORMA_MATCH_STATES || {};

function _formaHumanTeamsInMatch() {
  /* Devuelve hasta 2 nombres de equipos HUMANOS implicados en el partido
     actual. Hacemos múltiples intentos defensivos porque la lista no
     puede salir vacía: el usuario reportó "no se ve" cuando alguno de
     los pasos fallaba en silencio. */
  var HUMANOS = (function(){
    try {
      var r = localStorage.getItem('ligaExt_liga-ea-sports');
      if (r) { var d = JSON.parse(r); if (d && d.teams) {
        var h = d.teams.filter(function(t){return t.isHuman;}).map(function(t){return t.name;});
        if (h.length) return h;
      } }
    } catch(_){}
    return ['Real Madrid','FC Barcelona','Bayern Munich','Arsenal','Atlético Madrid','PSG'];
  })();
  var normFn = window._ppNormTeam || function(s){
    return String(s||'').trim().toLowerCase()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');
  };

  /* Intento 1: API oficial _ppGetCurrentMatchTeams (lee mlw-{mk} o
     _ppPreviaTeams). */
  var teams = null;
  try { teams = (typeof window._ppGetCurrentMatchTeams === 'function') ? window._ppGetCurrentMatchTeams() : null; } catch(_){}

  /* Intento 2: si la API falló, inspeccionamos el wrap por _ppMatchKey
     o _ppPreviaTeams directamente. */
  if (!teams) {
    if (window._ppPreviaTeams && window._ppPreviaTeams.home && window._ppPreviaTeams.away) {
      teams = { home: window._ppPreviaTeams.home, away: window._ppPreviaTeams.away };
    } else if (window._ppMatchKey) {
      var wrap = document.getElementById('mlw-' + window._ppMatchKey);
      if (wrap) {
        var names = wrap.querySelectorAll('.ml-team-name');
        var hRaw = (names[0] && names[0].textContent) || '';
        var aRaw = (names[1] && names[1].textContent) || '';
        var stripPrefix = function(s){ return String(s||'').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+\s*/, '').trim(); };
        var h = stripPrefix(hRaw), a = stripPrefix(aRaw);
        if (h && a) teams = { home: h, away: a };
      }
    }
  }

  if (!teams) return [];

  /* Match contra HUMANOS por nombre normalizado. Devuelve los nombres
     CANÓNICOS (los del HUMANOS) para que sqFromRegistry los encuentre. */
  var found = [];
  [teams.home, teams.away].forEach(function(tname){
    var nt = normFn(tname);
    for (var i = 0; i < HUMANOS.length; i++) {
      if (normFn(HUMANOS[i]) === nt) { found.push(HUMANOS[i]); return; }
    }
    /* Fallback laxo: comparar incluyendo si uno contiene al otro
       (ej. "FC Barcelona" vs "Barcelona"). Solo lo aplicamos para
       evitar falsos positivos cuando el nombre exacto no está. */
    for (var j = 0; j < HUMANOS.length; j++) {
      var nh = normFn(HUMANOS[j]);
      if (nh && nt && (nh.indexOf(nt) !== -1 || nt.indexOf(nh) !== -1)) {
        found.push(HUMANOS[j]); return;
      }
    }
  });
  return found;
}

function _formaRosterForTeam(teamName) {
  /* Resolver roster con varios fallbacks. SQUAD_REGISTRY puede no
     tener el equipo aún si applyEngineOverrides no se ha ejecutado.
     sqFromRegistryFull tiene su propia lógica de carga. */
  var roster = [];
  try {
    if (typeof window.sqFromRegistryFull === 'function') {
      roster = window.sqFromRegistryFull(teamName) || [];
    }
  } catch(_){}
  if (!roster.length) {
    var squad = (window.SQUAD_REGISTRY && (window.SQUAD_REGISTRY[teamName] || window.SQUAD_REGISTRY[(window.TEAM_ALIASES||{})[String(teamName||'').toLowerCase()]])) || [];
    /* SQUAD_REGISTRY tiene formato mixto: header rows {h:'...'} +
       arrays [num, nombre, poder]. Filtramos solo las arrays. */
    roster = squad.filter(function(p){ return p && !p.h && Array.isArray(p); });
  }
  return roster.filter(function(p){ return p && Array.isArray(p) && p[1]; });
}

window._renderFormaChecklist = function() {
  var humans = _formaHumanTeamsInMatch();
  if (!humans.length) {
    return '<div style="margin-top:14px;padding:10px 12px;border:1px solid rgba(255,80,80,.25);border-radius:10px;background:rgba(255,80,80,.04);font-family:Oswald,sans-serif;font-size:11px;color:rgba(255,80,80,.85);text-align:center;letter-spacing:.5px;">🩹 Añadir lesionados — abre la previa de un partido con equipo humano para ver la lista</div>';
  }
  var matchStates = window._FORMA_MATCH_STATES || {};
  var html = '<div style="margin-top:16px;padding:12px;border:1px solid rgba(255,80,80,.45);border-radius:10px;background:rgba(255,80,80,.08);">'
    + '<div style="font-family:Oswald,sans-serif;font-size:13px;letter-spacing:2px;color:#ff5050;margin-bottom:8px;font-weight:700;">🩹 AÑADIR LESIONADOS DEL EQUIPO HUMANO</div>'
    + '<div style="font-family:Oswald,sans-serif;font-size:10px;color:rgba(255,255,255,.6);margin-bottom:10px;letter-spacing:.5px;line-height:1.4;">Pulsa ⬇️ para marcar al jugador como lesionado. Se asignará una lesión MODERADA 💉 o GRAVE 🚑 automática.</div>';
  humans.forEach(function(team){
    var roster = _formaRosterForTeam(team);
    if (!roster.length) {
      html += '<div style="font-family:Rajdhani,sans-serif;font-size:12px;color:rgba(255,255,255,.55);margin:8px 0;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">⚔️ ' + team + ' — plantilla no cargada todavía. Recarga la página y vuelve a abrir la previa.</div>';
      return;
    }
    html += '<div style="font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;color:#fff;margin:10px 0 6px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">⚔️ ' + team + ' <span style="font-size:10px;color:rgba(255,255,255,.45);font-weight:400;margin-left:6px;">' + roster.length + ' jugadores</span></div>';
    html += '<div style="display:flex;flex-direction:column;gap:4px;">';
    roster.forEach(function(p){
      var name = p[1] || '?';
      var num  = p[0] || '';
      var cur  = matchStates[name] || '';
      var isLesionado = !!(window.BAJA_STORE && window.BAJA_STORE[name] && window.BAJA_STORE[name].tipo === 'lesion' && cur !== '⬇️');
      var dis = isLesionado ? 'disabled' : '';
      var rowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 8px;background:rgba(255,255,255,.04);border-radius:6px;' + (isLesionado ? 'opacity:.4;' : '');
      var safeTeam = team.replace(/\\/g,'\\\\').replace(/\'/g,"\\'");
      var safeName = name.replace(/\\/g,'\\\\').replace(/\'/g,"\\'");
      html += '<label style="' + rowStyle + '">'
        + '<span style="font-family:Oswald,sans-serif;font-size:12px;color:#fff;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
        +   (num ? '<span style="color:rgba(255,255,255,.4);margin-right:6px;">' + num + '</span>' : '')
        +   name
        + '</span>'
        + '<span style="display:flex;gap:4px;flex-shrink:0;">'
        +   '<button type="button" ' + dis + ' onclick="window._formaToggle(\'' + safeTeam + '\',\'' + safeName + '\')" '
        +     'style="background:' + (cur === '⬇️' ? 'rgba(255,80,80,.35)' : 'rgba(255,255,255,.06)') + ';border:1px solid ' + (cur === '⬇️' ? '#ff5050' : 'rgba(255,255,255,.15)') + ';color:#fff;border-radius:6px;padding:4px 10px;font-size:14px;cursor:pointer;">⬇️</button>'
        + '</span>'
        + '</label>';
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
};

function _formaRandomAnyInjury(teamName, playerName) {
  /* ⬇️ Pésima: SIEMPRE cae en MODERADA o GRAVE (nunca Leve).
     Distribución: 65% Moderada, 35% Grave. Requisito del usuario. */
  var r = Math.random();
  var grado, gradoNombre, gradoEmoji, partidos, lesionesList;
  if (r < 0.65) {
    grado = 2; gradoNombre = 'Moderada'; gradoEmoji = '💉'; partidos = 2 + Math.floor(Math.random()*3);
    lesionesList = ['Microrrotura de fibras','Esguince de tobillo Grado II','Edema óseo','Contractura severa','Distensión del ligamento lateral'];
  } else {
    grado = 3; gradoNombre = 'Grave'; gradoEmoji = '🚑'; partidos = 5 + Math.floor(Math.random()*6);
    lesionesList = ['Rotura fibrilar Grado III','Fisura en el metatarsiano','Rotura parcial del ligamento','Luxación de hombro','Rotura del tendón de Aquiles'];
  }
  var descripcion = lesionesList[Math.floor(Math.random() * lesionesList.length)];
  if (!window.LESION_STORE) window.LESION_STORE = {};
  if (!window.BAJA_STORE)   window.BAJA_STORE   = {};
  window.LESION_STORE[playerName] = {
    equipo: teamName, grado: grado, gradoNombre: gradoNombre, gradoEmoji: gradoEmoji,
    descripcion: descripcion, partidos: partidos, timestamp: Date.now()
  };
  window.BAJA_STORE[playerName] = { tipo: 'lesion', liga: partidos, copa: partidos, europa: partidos };
  return { grado: grado, gradoNombre: gradoNombre, gradoEmoji: gradoEmoji, descripcion: descripcion, partidos: partidos };
}

window._formaToggle = function(teamName, playerName) {
  if (!window.BAJA_STORE)          window.BAJA_STORE = {};
  if (!window._FORMA_MATCH_STATES) window._FORMA_MATCH_STATES = {};

  var existing = window._FORMA_MATCH_STATES[playerName];
  // Toggle off: si ya estaba marcado, retiramos la lesión asignada
  if (existing === '⬇️') {
    delete window._FORMA_MATCH_STATES[playerName];
    if (window.BAJA_STORE[playerName])     delete window.BAJA_STORE[playerName];
    if (window.LESION_STORE && window.LESION_STORE[playerName]) delete window.LESION_STORE[playerName];
    window._refreshSancionInjList();
    return;
  }

  window._FORMA_MATCH_STATES[playerName] = '⬇️';
  var inj = _formaRandomAnyInjury(teamName, playerName);
  alert('🏥 ' + inj.gradoEmoji + ' LESIÓN ' + inj.gradoNombre.toUpperCase() + '\n'
    + playerName + ' (' + teamName + ')\n'
    + inj.descripcion + '\n'
    + inj.partidos + ' partido(s) de baja');
  window._refreshSancionInjList();
};

// Parchar showSancionOverlay para refrescar bajas reales al abrir
var _origShowSancionOverlay = window.showSancionOverlay;
window.showSancionOverlay = function(compKey, blockId, onConfirm) {
  if (_origShowSancionOverlay) _origShowSancionOverlay(compKey, blockId, onConfirm);
  window._refreshSancionInjList();
};

// ══════════════════════════════════════════════════════════
// 6. SUSTITUCIÓN EXTRA EN PRÓRROGA — IA vs IA
//    Se aplica al simulador global (window.simularPartido)
//    La 5ª sustitución ocurre entre min 91-120, invisible en acta
// ══════════════════════════════════════════════════════════
// Parcheamos la función de simulación para añadir sub extra en ET
// La lógica está en window.runIASimulation o en el bloque inline
// Como está inline, parcheamos applySubsUpTo via el evento global

// Añadir un hook post-simulación que, si hubo prórroga, aplica sub extra
// Esto se hace extendiendo el cfg.onEnd
var _origRunSimulation = window.runIASimulation;
if (_origRunSimulation) {
  window.runIASimulation = function(cfg) {
    var _origOnEnd = cfg.onEnd;
    cfg.onEnd = function(sa, sb, evts, mvpName, mvpTeam) {
      // La prórroga extra ya está gestionada internamente; solo llamar original
      if (_origOnEnd) _origOnEnd(sa, sb, evts, mvpName, mvpTeam);
    };
    return _origRunSimulation(cfg);
  };
}

// Para los simuladores inline (que ya tienen applySubsUpTo),
// extendemos la lógica de sustituciones para agregar la 5ª en prórroga
// Esto se aplica directamente al bloque de código inline del simulador IA vs IA
// que ya usa benA/benB. Añadimos la función global para ser llamada si hay ET:
window.applyETSub = function(activeA, activeB, benA, benB, subIdxA, subIdxB) {
  // Sub extra equipo A en prórroga (min 91-120)
  if (subIdxA < benA.length) {
    var outfA = activeA.filter(function(p){ return p[2] !== 'P'; });
    if (outfA.length) {
      var wA = outfA.reduce(function(a,b){ return (a[3]||70)<(b[3]||70)?a:b; });
      var iA = activeA.indexOf(wA);
      if (iA >= 0) activeA.splice(iA, 1);
      activeA.push(benA[subIdxA]);
    }
  }
  // Sub extra equipo B en prórroga
  if (subIdxB < benB.length) {
    var outfB = activeB.filter(function(p){ return p[2] !== 'P'; });
    if (outfB.length) {
      var wB = outfB.reduce(function(a,b){ return (a[3]||70)<(b[3]||70)?a:b; });
      var iB = activeB.indexOf(wB);
      if (iB >= 0) activeB.splice(iB, 1);
      activeB.push(benB[subIdxB]);
    }
  }
};

// ══════════════════════════════════════════════════════════
// 7. MOSTRAR CONVOCATORIA EN OVERLAY DE PARTIDO (HvH / HvIA)
//    — Jugadores en baja aparecen tachados y no son seleccionables
// ══════════════════════════════════════════════════════════
// Parchar el renderizado del overlay de selección de jugador
// para mostrar bajas visualmente
var _styleOverlay = document.createElement('style');
_styleOverlay.textContent =
  '.ml-pl-ov-btn.jugador-baja { opacity:.4; text-decoration:line-through; pointer-events:none; cursor:not-allowed; }'
  + '.ml-pl-ov-btn.jugador-baja::after { content:" ⚽🚫"; font-size:10px; }';
document.head.appendChild(_styleOverlay);

// Parchar mlShowPl_* para marcar bajas en overlay de jugadores
// Usamos MutationObserver en los overlays de selección de jugador
document.addEventListener('click', function(e) {
  // Detectar cuando se abre un overlay de plantilla
  setTimeout(function() {
    document.querySelectorAll('.ml-pl-ov-list').forEach(function(list) {
      list.querySelectorAll('.ml-pl-ov-btn').forEach(function(btn) {
        var nameEl = btn.querySelector('.ml-pl-ov-name');
        if (!nameEl) return;
        var nombre = nameEl.textContent.trim();
        if (window.BAJA_STORE[nombre]) {
          btn.classList.add('jugador-baja');
          btn.disabled = true;
          btn.title = 'Jugador no disponible (' + window.BAJA_STORE[nombre] + ')';
        }
      });
    });
  }, 100);
}, true);

// ══════════════════════════════════════════════════════════
// 8. INTEGRAR SUSTITUCIÓN EXTRA ET EN LOS SIMULADORES INLINE
//    Esto se inyecta en el contexto del simulador IA via
//    la variable global _etSubApplied
// ══════════════════════════════════════════════════════════
// Los simuladores inline ya calculan ft90/ht45/sa/sb
// Cuando sa===sb al ft90 en competiciones con prórroga,
// el sistema existente maneja ET. Aquí añadimos la sub extra:
window._etSubApplied = window._etSubApplied || {};
// La sub extra se aplica automáticamente a través del hook
// window.applyETSub que es llamado por el simulador si detecta ET

// ══════════════════════════════════════════════════════════
// 9. FORZAR SINCRONIZACIÓN DE PLANTILLAS AL HACER go()
//    para equipos que ya tienen plant-rows en el HTML
// ══════════════════════════════════════════════════════════
// Re-sincronizar al volver a entrar en una pantalla de equipo
// (el _syncedScreens evita re-renderizar innecesariamente,
//  pero si se actualizó BAJA_STORE sí debe refrescar el visual)
window.refreshPlantBajas = function(screenId) {
  var screen = document.getElementById(screenId);
  if (!screen) return;
  screen.querySelectorAll('.plant-row[data-player]').forEach(function(row) {
    var nombre = row.getAttribute('data-player');
    if (!nombre) {
      // Intentar obtener desde plant-name
      var nameEl = row.querySelector('.plant-name');
      if (nameEl) nombre = nameEl.textContent.trim();
    }
    if (!nombre) return;
    var baja = window.BAJA_STORE[nombre];
    row.classList.remove('baja-lesion','baja-sancion','baja-expulsion');
    var btn = row.querySelector('.plant-baja-btn');
    if (baja) {
      row.classList.add('baja-' + baja);
      var ico = baja === 'lesion' ? '🚑' : baja === 'sancion' ? '🟨' : '🟥';
      if (btn) { btn.textContent = ico; btn.className = 'plant-baja-btn ' + baja; }
    } else {
      if (btn) { btn.textContent = ''; btn.className = 'plant-baja-btn'; }
    }
  });
};

// ══════════════════════════════════════════════════════════
// 10. AÑADIR BOTÓN BAJA A PLANT-ROWS EXISTENTES (HTML FIJO)
//     + LONG PRESS para mostrar el botón
// ══════════════════════════════════════════════════════════
var _lpTimer = null;
var _lpRow   = null;

function addLongPressToRow(row) {
  if (row._lpBound) return;
  row._lpBound = true;
  function onStart(e) {
    _lpRow = row;
    _lpTimer = setTimeout(function() {
      row.classList.add('row-longpress');
      // Auto-quitar el highlight tras 3s si no se pulsa el botón
      setTimeout(function() {
        if (!document.getElementById('baja-modal') || !document.getElementById('baja-modal').classList.contains('show')) {
          row.classList.remove('row-longpress');
        }
      }, 3000);
    }, 500);
  }
  function onEnd() {
    clearTimeout(_lpTimer);
    _lpTimer = null;
  }
  row.addEventListener('touchstart', onStart, {passive:true});
  row.addEventListener('touchend',   onEnd,   {passive:true});
  row.addEventListener('touchmove',  onEnd,   {passive:true});
  row.addEventListener('mousedown',  onStart);
  row.addEventListener('mouseup',    onEnd);
  row.addEventListener('mouseleave', onEnd);
}

// Limpiar longpress al cerrar modal
var _origBajaClose = window._bajaClose;
window._bajaClose = function() {
  if (_origBajaClose) _origBajaClose();
  document.querySelectorAll('.plant-row.row-longpress').forEach(function(r){
    r.classList.remove('row-longpress');
  });
};
function addBajaButtonsToExistingRows() {
  document.querySelectorAll('.plant-row').forEach(function(row) {
    // Añadir long press a todas las filas
    addLongPressToRow(row);
    if (row.querySelector('.plant-baja-btn')) return; // ya tiene botón
    var nameEl = row.querySelector('.plant-name');
    if (!nameEl) return;
    var nombre = nameEl.textContent.trim();
    if (!nombre) return;
    row.setAttribute('data-player', nombre);
    var baja = _bajaTipo(nombre);
    var bajaIco = baja === 'lesion' ? '🚑' : baja === 'sancion' ? '🟨' : baja === 'expulsion' ? '🟥' : '';
    var btnClass = 'plant-baja-btn' + (baja ? ' ' + baja : '');
    if (baja) {
      row.classList.remove('baja-lesion','baja-sancion','baja-expulsion');
      row.classList.add('baja-' + baja);
    }
    // Añadir badge de partidos si no existe
    if (!nameEl.querySelector('.plant-baja-badge')) {
      var badge = document.createElement('span');
      badge.className = 'plant-baja-badge';
      var badgeTxt = _bajaBadgeText(nombre);
      badge.textContent = badgeTxt;
      badge.style.display = badgeTxt ? 'inline' : 'none';
      nameEl.appendChild(badge);
    }
    var btn = document.createElement('button');
    btn.className = btnClass;
    btn.textContent = bajaIco;
    btn.title = 'Marcar baja';
    btn.setAttribute('onclick', "window.openBajaModal(this.closest('.plant-row'),'" + nombre.replace(/'/g,"\\'") + "')");
    row.appendChild(btn);
  });
}

// Ejecutar al cargar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addBajaButtonsToExistingRows);
} else {
  addBajaButtonsToExistingRows();
}

// También ejecutar después de cada go() para asegurar rows de nuevas pantallas
var _origGo2 = window.go;
window.go = function(screenId) {
  if (_origGo2) _origGo2(screenId);
  setTimeout(addBajaButtonsToExistingRows, 150);
  if (SCREEN_SQUAD_MAP[screenId]) {
    setTimeout(function() {
      syncSquadToScreen(screenId, SCREEN_SQUAD_MAP[screenId]);
    }, 200);
  }
};

console.log('[eFootball] Sistema de Bajas + Sincronización de Plantillas + ET Sub activado ✓');

})();


/* ══════════════════════════════════════════════════════════════════════
   SISTEMA DE LESIONES — Motor completo
   ══════════════════════════════════════════════════════════════════════ */
(function(){

  // ── STORE global ──────────────────────────────────────────────────
  window.LESION_STORE = window.LESION_STORE || {};
  // Estructura: { 'NombreJugador': { equipo, grado, partidos, descripcion, timestamp } }

  // ── Tipos de lesión ───────────────────────────────────────────────
  var LESION_TIPOS = [
    { grado:1, nombre:'Leve',     emoji:'🟡', prob:0.42,
      ejemplos:['Sobrecarga muscular','Contusión leve','Molestias musculares'],
      minPartidos:1, maxPartidos:2 },
    { grado:2, nombre:'Moderada', emoji:'🟠', prob:0.55,
      ejemplos:['Rotura fibrilar','Esguince de tobillo Grado II','Distensión isquiotibial'],
      minPartidos:3, maxPartidos:5 },
    { grado:3, nombre:'Grave',    emoji:'🔴', prob:0.03,
      ejemplos:['Rotura LCA','Fractura tibia/peroné','Rotura de menisco'],
      minPartidos:6, maxPartidos:12 }
  ];

  // Probabilidad base de lesión por partido por equipo: ~6%
  // Sube a ~9% si el equipo juega en competición europea
  var PROB_LESION_BASE = 0.06;
  var PROB_LESION_EURO = 0.09; // fatiga acumulada

  var EQUIPOS_EUROPEOS = [
    'Real Madrid','FC Barcelona','Atlético Madrid','Real Sociedad','Athletic Club',
    'Villarreal CF','Real Betis','Sevilla FC','Girona FC'
  ];

  function tieneEuropa(teamName) {
    return EQUIPOS_EUROPEOS.indexOf(teamName) !== -1;
  }

  function sortearGrado() {
    var r = Math.random();
    if (r < 0.42) return LESION_TIPOS[0]; // Leve
    if (r < 0.97) return LESION_TIPOS[1]; // Moderada
    return LESION_TIPOS[2];               // Grave
  }

  function sortearPartidos(tipo) {
    var min = tipo.minPartidos;
    var max = tipo.maxPartidos;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function sortearEjemplo(tipo) {
    return tipo.ejemplos[Math.floor(Math.random() * tipo.ejemplos.length)];
  }

  // ── Registrar lesión en BAJA_STORE + LESION_STORE ─────────────────
  function registrarLesion(nombreJugador, equipoNombre, partidos, tipo) {
    // BAJA_STORE: partidos en todas las competiciones = partidos totales
    window.BAJA_STORE[nombreJugador] = {
      tipo: 'lesion',
      liga:   partidos,
      copa:   partidos,
      europa: partidos
    };
    // LESION_STORE: detalle
    window.LESION_STORE[nombreJugador] = {
      equipo:      equipoNombre,
      grado:       tipo.grado,
      gradoNombre: tipo.nombre,
      gradoEmoji:  tipo.emoji,
      descripcion: sortearEjemplo(tipo),
      partidos:    partidos,
      timestamp:   Date.now(),
      /* El partido en que se registra la lesión NO descuenta baja
         (el jugador ya estaba fuera de ese partido). */
      _skipFirstDecrement: true
    };
    // Actualizar visual en plantilla
    _actualizarPlantillaLesion(nombreJugador, partidos, tipo);
    _persistInjuries();
    try { if (window.athRefreshInjuryHud) window.athRefreshInjuryHud(); } catch (_) {}
  }

  function _actualizarPlantillaLesion(nombre, partidos, tipo) {
    document.querySelectorAll('.plant-row[data-player="' + nombre.replace(/"/g,'&quot;') + '"]').forEach(function(row) {
      row.classList.remove('baja-lesion','baja-sancion','baja-expulsion');
      row.classList.add('baja-lesion');
      var btn = row.querySelector('.plant-baja-btn');
      if (btn) {
        btn.textContent = '🩹';
        btn.className = 'plant-baja-btn lesion';
        btn.title = tipo.gradoNombre + ' · ' + partidos + ' partidos';
      }
      var badge = row.querySelector('.plant-baja-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'plant-baja-badge';
        var nameEl = row.querySelector('.plant-name');
        if (nameEl) nameEl.appendChild(badge);
      }
      badge.textContent = tipo.emoji + ' +' + partidos;
      badge.style.display = 'inline';
      badge.style.color = tipo.grado === 3 ? '#ff4444' : tipo.grado === 2 ? '#ff8c00' : '#ffd700';
    });
    if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
  }

  // ── Motor de lesiones para IA vs IA ───────────────────────────────
  // Llamado desde mlSimEngine al generar eventos
  window.generarLesionesPartido = function(TEAM_A, TEAM_B, activeA, activeB, benA, benB, ft90) {
    var lesiones = [];

    function intentarLesion(equipo, teamName, active, ben, subIdx) {
      var probBase = tieneEuropa(teamName) ? PROB_LESION_EURO : PROB_LESION_BASE;
      if (Math.random() > probBase) return null;

      // Solo jugadores de campo titulares activos no ya lesionados
      var candidatos = active.filter(function(p) {
        return p[2] !== 'P' && !window.BAJA_STORE[p[1]];
      });
      if (!candidatos.length) return null;

      var lesionado = candidatos[Math.floor(Math.random() * candidatos.length)];
      var tipo = sortearGrado();
      var partidos = sortearPartidos(tipo);
      var minLesion = 5 + Math.floor(Math.random() * (ft90 - 10));

      // Sustituto: mismo puesto que el lesionado (D→D, M→M, F→F).
      // Fallback: cualquier jugador de campo disponible, o por último
      // cualquier jugador. Antes usábamos "el mejor del banquillo" sin
      // mirar la posición, así que un delantero lesionado podía acabar
      // sustituido por un central, lo cual no tiene sentido táctico.
      var posLesion = (lesionado && lesionado[2]) || 'F';
      var sustituto = null;
      for (var i = subIdx; i < ben.length; i++) {
        var b = ben[i];
        if (!b || window.BAJA_STORE[b[1]]) continue;
        if (b[2] === posLesion) { sustituto = b; break; }
      }
      if (!sustituto) {
        // Sin suplente de la misma posición: tirar de cualquier jugador
        // de campo (no portero) que no esté de baja.
        for (var j = subIdx; j < ben.length; j++) {
          var b2 = ben[j];
          if (!b2 || window.BAJA_STORE[b2[1]]) continue;
          if (b2[2] !== 'P') { sustituto = b2; break; }
        }
      }
      if (!sustituto) {
        // Último recurso: el primero disponible (puede ser portero si
        // fuera un lesionado con el banquillo agotado).
        for (var k = subIdx; k < ben.length; k++) {
          if (!window.BAJA_STORE[ben[k][1]]) { sustituto = ben[k]; break; }
        }
      }

      return {
        equipo: equipo, teamName: teamName,
        jugador: lesionado, sustituto: sustituto,
        tipo: tipo, partidos: partidos, min: minLesion
      };
    }

    var lesA = intentarLesion('a', TEAM_A, activeA, benA, 0);
    var lesB = intentarLesion('b', TEAM_B, activeB, benB, 0);
    if (lesA) lesiones.push(lesA);
    if (lesB) lesiones.push(lesB);
    return lesiones;
  };

  // ── Aplicar lesión en el simulador ─────────────────────────────────
  // Devuelve evento para insertar en evts[]
  window.aplicarLesionEnSimulacion = function(lesion, activeA, activeB) {
    var active = lesion.equipo === 'a' ? activeA : activeB;

    // Quitar al lesionado del campo
    var idx = active.indexOf(lesion.jugador);
    if (idx >= 0) active.splice(idx, 1);

    // Añadir sustituto si hay
    if (lesion.sustituto) active.push(lesion.sustituto);

    // Registrar en BAJA_STORE
    registrarLesion(lesion.jugador[1], lesion.teamName, lesion.partidos, lesion.tipo);

    // Crear evento para el acta (SIN sustitución visible)
    var _lesDesc = (window.LESION_STORE && window.LESION_STORE[lesion.jugador[1]]) ? window.LESION_STORE[lesion.jugador[1]].descripcion : '';
    return {
      min: lesion.min,
      ico: '🩹',
      team: lesion.equipo,
      player: lesion.jugador,
      type: 'lesion',
      grado: lesion.tipo.grado,
      gradoNombre: lesion.tipo.nombre,
      gradoEmoji: lesion.tipo.emoji,
      partidos: lesion.partidos,
      descripcion: _lesDesc,
      grave: lesion.tipo.grado === 3
    };
  };

  // ── Overlay de lesiones post-partido (HvH / IA vs H) ──────────────
  window.LESIONES_PARTIDO_ACTUAL = [];

  window.showLesionPostOverlay = function(lesiones, onConfirm) {
    var el = document.getElementById('lesion-post-overlay');
    if (!el) {
      // Crear el overlay si no existe en el HTML
      el = document.createElement('div');
      el.id = 'lesion-post-overlay';
      el.className = 'lesion-post-ov';
      el.innerHTML = _buildLesionOverlayHTML();
      document.body.appendChild(el);
    }

    // Rellenar contenido
    var listEl = document.getElementById('lpost-list');
    var subEl  = document.getElementById('lpost-sub');
    var iconEl = document.getElementById('lpost-icon');

    if (!lesiones || !lesiones.length) {
      if (onConfirm) onConfirm();
      return;
    }

    window._lesionPostCallback = onConfirm || null;

    var hayGrave = lesiones.some(function(l) { return l.grado === 3 || (l.tipo && l.tipo.grado === 3); });
    iconEl.textContent = hayGrave ? '🔴' : '🩹';
    subEl.textContent  = lesiones.length === 1 ? 'UN JUGADOR LESIONADO' : lesiones.length + ' JUGADORES LESIONADOS';

    listEl.innerHTML = lesiones.map(function(l) {
      var grado   = l.grado || (l.tipo && l.tipo.grado) || 1;
      var gradoNm = l.gradoNombre || (l.tipo && l.tipo.nombre) || 'Leve';
      var gradoEm = l.gradoEmoji  || (l.tipo && l.tipo.emoji) || '🟡';
      var nombre  = l.jugador ? l.jugador[1] : (l.nombre || '');
      var equipo  = l.teamName || l.equipo || '';
      var desc    = l.descripcion || (l.tipo && sortearEjemplo(l.tipo)) || '';
      var parts   = l.partidos || 1;
      var colorGrado = grado === 3 ? '#ff4444' : grado === 2 ? '#ff8c00' : '#ffd700';
      return '<div class="lpost-card">'
        + '<div class="lpost-card-badge" style="background:' + colorGrado + '22;color:' + colorGrado + ';border-color:' + colorGrado + '44">' + gradoEm + ' LESIÓN ' + gradoNm.toUpperCase() + '</div>'
        + '<div class="lpost-card-body">'
        + '<div class="lpost-card-name">' + nombre + '</div>'
        + '<div class="lpost-card-team">' + equipo + '</div>'
        + '<div class="lpost-card-desc">' + desc + '</div>'
        + '</div>'
        + '<div class="lpost-card-partidos">'
        + '<div class="lpost-partidos-num" style="color:' + colorGrado + '">' + parts + '</div>'
        + '<div class="lpost-partidos-lbl">PARTIDO' + (parts > 1 ? 'S' : '') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    el.classList.add('show');
    window.scrollTo(0, 0);
  };

  window._lesionPostConfirm = function() {
    var el = document.getElementById('lesion-post-overlay');
    if (el) el.classList.remove('show');
    if (window._lesionPostCallback) { window._lesionPostCallback(); window._lesionPostCallback = null; }
  };

  function _buildLesionOverlayHTML() {
    return '<div class="lpost-inner">'
      + '<div class="lpost-icons"><span id="lpost-icon">🩹</span></div>'
      + '<div class="lpost-title">PARTE MÉDICO</div>'
      + '<div class="lpost-sub" id="lpost-sub">JUGADORES LESIONADOS</div>'
      + '<div class="lpost-list" id="lpost-list"></div>'
      + '<button class="lpost-btn" onclick="window._lesionPostConfirm()">✓ ENTENDIDO</button>'
      + '</div>';
  }

  // ── CSS inline para el overlay ────────────────────────────────────
  var _lesionStyle = document.createElement('style');
  _lesionStyle.textContent = [
    '.lesion-post-ov{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);',
    'overflow-y:auto;padding:20px 16px 40px;}',
    '.lesion-post-ov.show{display:flex;flex-direction:column;align-items:center;}',
    '.lpost-inner{width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;gap:8px;}',
    '.lpost-icons{font-size:48px;margin-bottom:4px;filter:drop-shadow(0 0 12px rgba(255,100,100,0.6));}',
    '.lpost-title{font-family:Oswald,sans-serif;font-size:26px;font-weight:700;letter-spacing:4px;',
    'color:#fff;text-transform:uppercase;margin-bottom:2px;}',
    '.lpost-sub{font-family:Oswald,sans-serif;font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.5);',
    'text-transform:uppercase;margin-bottom:12px;}',
    '.lpost-list{width:100%;display:flex;flex-direction:column;gap:10px;margin-bottom:20px;}',
    '.lpost-card{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);',
    'border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;}',
    '.lpost-card-badge{font-family:Oswald,sans-serif;font-size:9px;letter-spacing:2px;padding:3px 8px;',
    'border-radius:4px;border:1px solid;text-align:center;white-space:nowrap;flex-shrink:0;}',
    '.lpost-card-body{flex:1;min-width:0;}',
    '.lpost-card-name{font-family:Oswald,sans-serif;font-size:15px;font-weight:600;color:#fff;}',
    '.lpost-card-team{font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:3px;}',
    '.lpost-card-desc{font-size:12px;color:rgba(255,255,255,0.6);font-style:italic;}',
    '.lpost-card-partidos{display:flex;flex-direction:column;align-items:center;flex-shrink:0;min-width:40px;}',
    '.lpost-partidos-num{font-family:Oswald,sans-serif;font-size:28px;font-weight:700;line-height:1;}',
    '.lpost-partidos-lbl{font-family:Oswald,sans-serif;font-size:8px;letter-spacing:1px;color:rgba(255,255,255,0.4);}',
    '.lpost-btn{width:100%;max-width:340px;padding:16px;background:#e03c3c;border:none;border-radius:10px;',
    'color:#fff;font-family:Oswald,sans-serif;font-size:16px;font-weight:700;letter-spacing:3px;',
    'cursor:pointer;text-transform:uppercase;}',
    '.lpost-btn:active{opacity:0.8;}',
    // Grave: animación STOP en timer
    '.ml-timer.grave-stop{animation:grave-pulse 0.8s ease-in-out infinite;color:#ff4444 !important;}',
    '@keyframes grave-pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}'
  ].join('');
  document.head.appendChild(_lesionStyle);

  // ── Conectar con procesarSancionesPostPartido ─────────────────────
  // Después de sanciones → mostrar lesiones si las hay
  var _origProcesarSanciones = window.procesarSancionesPostPartido;
  window.procesarSancionesPostPartido = function(events, humanTeam, teamName, compKey) {
    var sanciones = window.calcularSancionesPartido(events, humanTeam, teamName, compKey);
    // Lesiones registradas en este partido (HvH / IA vs H)
    var lesiones = window.LESIONES_PARTIDO_ACTUAL || [];
    window.LESIONES_PARTIDO_ACTUAL = []; // reset para el siguiente partido

    if (sanciones && sanciones.length) {
      // Primero sanciones, luego lesiones
      window.showSancionPostOverlay(sanciones, compKey, function() {
        if (lesiones.length) {
          window.showLesionPostOverlay(lesiones, null);
        }
      });
    } else if (lesiones.length) {
      // Solo lesiones
      window.showLesionPostOverlay(lesiones, null);
    }
    // Si nada, no mostrar nada (no llamar al original)
  };

  // ── Actualizar _refreshSancionInjList con LESION_STORE ────────────
  var _origRefresh = window._refreshSancionInjList;
  window._refreshSancionInjList = function() {
    var listInj = document.getElementById('sancion-ov-list-inj');
    if (!listInj) return;
    var belongs = window._ppPlayerBelongsToMatch || function(){ return true; };
    var lesiones = Object.keys(window.LESION_STORE).filter(belongs);
    if (!lesiones.length) {
      listInj.innerHTML = '<div class="sancion-empty">🚑 Sin lesionados</div>';
      return;
    }
    /* Foto 3 (2026-05-27): mismo layout que showSancionOverlay —
       agrupado por posición, icono real por grado, label POR/DEF/MED/DEL
       y botón 💊 PI por jugador. */
    var _piAvail = 0;
    try { if (typeof window.athGetMedicalPI === 'function') _piAvail = Math.floor((window.athGetMedicalPI()||0) + 1e-9); } catch(_){}
    var injObjs = lesiones.map(function(nombre){
      return { name: nombre, equipo: (window.LESION_STORE[nombre] && window.LESION_STORE[nombre].equipo) || '' };
    });
    var grouped = window._injGroupByPos(injObjs,
      function(it){ return it.name; },
      function(it){ return it.equipo; }
    );
    listInj.innerHTML = grouped.map(function(grp){
      var hdr = '<div class="sancion-pos-hdr">' + grp.label + '</div>';
      var cards = grp.items.map(function(it){
        var nombre = it.name;
        var l = window.LESION_STORE[nombre];
        var colorGrado = l.grado === 3 ? '#ff4444' : l.grado === 2 ? '#ff8c00' : '#ffd700';
        var ico = l.gradoEmoji || (l.grado===3?'🚑':l.grado===2?'💉':'🩹');
        var rem = parseInt(l.partidos || 0, 10) || 0;
        var posShort = window._injPosShort[grp.code] || '';
        var pillDisabled = _piAvail <= 0;
        var pill = '<button type="button" class="sancion-card-pi"'
          + (pillDisabled
              ? ' disabled title="Sin PI disponibles"'
              : ' title="Gastar 💊 PI para recuperar al jugador"'
            )
          + ' onclick="event.stopPropagation();if(window.athOpenMedicalMenu)window.athOpenMedicalMenu();"'
          + '>💊 ' + _piAvail + '</button>';
        return '<div class="sancion-card">'
          + '<div class="sancion-card-icon">' + ico + '</div>'
          + '<div class="sancion-card-info">'
          + '<div class="sancion-card-name">' + nombre + '</div>'
          + '<div class="sancion-card-team">' + (l.equipo || '') + '</div>'
          + '<div class="sancion-card-reason" style="color:' + colorGrado + '">' + ico + ' ' + l.gradoNombre + ' — ' + l.descripcion + '</div>'
          + (posShort ? '<div class="sancion-card-pos">' + posShort + '</div>' : '')
          + '</div>'
          + '<div class="sancion-card-partidos-wrap">'
          +   '<div class="sancion-card-partidos"><span class="sancion-card-pnum" style="color:' + colorGrado + '">' + rem + '</span><span class="sancion-card-plbl">PARTIDO' + (rem===1?'':'S') + '</span></div>'
          +   pill
          + '</div>'
          + '</div>';
      }).join('');
      return hdr + cards;
    }).join('');
    var warnEl = document.getElementById('sancion-ov-warn');
    if (warnEl) warnEl.style.display = 'block';
  };

  // ── Generar lesión para partidos HvH / IA vs H ──────────────────
  // Se llama al terminar el partido, genera 0 o 1 lesión por equipo
  // y las guarda en LESIONES_PARTIDO_ACTUAL para mostrar en el overlay
  var _EQUIPOS_HUMANOS = (function(){ try { var r=localStorage.getItem('ligaExt_liga-ea-sports'); if(r){var d=JSON.parse(r); if(d&&d.teams){var h=d.teams.filter(function(t){return t.isHuman}).map(function(t){return t.name}); if(h.length) return h;}} } catch(_){} return ['Real Madrid','FC Barcelona','Bayern Munich','Arsenal','Atlético Madrid','PSG']; })();

  window._generarLesionHumano = function(teamA, teamB) {
    window.LESIONES_PARTIDO_ACTUAL = [];
    [teamA, teamB].forEach(function(teamName, idx) {
      var probBase = tieneEuropa(teamName) ? PROB_LESION_EURO : PROB_LESION_BASE;
      if (Math.random() > probBase) return;
      // Buscar jugadores del equipo en la plantilla DOM
      var reg = window.SQUAD_REGISTRY && window.SQUAD_REGISTRY[teamName];
      if (!reg) return;
      var disponibles = reg.filter(function(p) {
        return !p.h && !window.BAJA_STORE[p[1]];
      });
      if (!disponibles.length) return;
      var lesionado = disponibles[Math.floor(Math.random() * disponibles.length)];
      var tipo = sortearGrado();
      var partidos = sortearPartidos(tipo);
      // Registrar siempre (actualiza estado del equipo IA también)
      registrarLesion(lesionado[1], teamName, partidos, tipo);
      // Solo mostrar overlay para equipos humanos
      if (_EQUIPOS_HUMANOS.indexOf(teamName) !== -1) {
        window.LESIONES_PARTIDO_ACTUAL.push({
          jugador: [lesionado[0], lesionado[1]],
          teamName: teamName,
          tipo: tipo,
          grado: tipo.grado,
          gradoNombre: tipo.nombre,
          gradoEmoji: tipo.emoji,
          descripcion: sortearEjemplo(tipo),
          partidos: partidos
        });
      }
    });
  };

  /* Decrementa la baja de TODOS los lesionados pertenecientes al
     equipo `teamName` (normalización case-insensitive) en 1 partido
     y elimina del store los que lleguen a 0. Se llama desde:
       · simularJornadaIA — tras cada partido IA-vs-IA.
       · mlEndMatchGen    — cuando termina un partido con humano.
       · copa-engine      — tras cada partido de Copa.
     De este modo la cuenta de partidos pendientes refleja la realidad:
     si Pablo Barrios tenía 9 partidos en J1, en J2 tendrá 8, etc.,
     y cuando llegue a 0 el jugador vuelve a aparecer en sqFromRegistry
     (que ya auto-excluye lesionados con partidos > 0).

     También sincroniza BAJA_STORE[name].liga / copa / europa si existe,
     descontando la competición que se indique en `compKey` (default
     'liga'). Si no hay BAJA_STORE (versión antigua) no rompe nada. */
  function decrementarPorPartido(teamName, compKey) {
    compKey = compKey || 'liga';
    var store = window.LESION_STORE || {};
    var target = String(teamName || '').trim().toLowerCase();
    if (!target) return;
    Object.keys(store).forEach(function(name){
      var rec = store[name];
      if (!rec) return;
      var eq = String(rec.equipo || '').trim().toLowerCase();
      if (eq !== target) return;
      var n = Number(rec.partidos) || 0;
      if (n <= 0) { return; }
      if (rec._skipFirstDecrement) {
        /* El partido en que se REGISTRÓ la lesión no descuenta: el
           jugador ya estaba fuera de ESE partido. La baja de N
           partidos se cumple con los N partidos SIGUIENTES. */
        rec._skipFirstDecrement = false;
        return;
      }
      rec.partidos = n - 1;
      if (rec.partidos <= 0) {
        delete store[name];
      }
    });
    /* Sincroniza BAJA_STORE con LESION_STORE. La baja es una CUENTA
       ÚNICA global (2026-05-22): los 3 contadores liga/copa/europa
       reflejan los MISMOS partidos restantes (los de LESION_STORE) —
       un partido jugado en cualquier competición consume 1. Si el
       jugador ya cumplió la baja (partidos 0 → fuera de LESION_STORE)
       se elimina también de BAJA_STORE. */
    try {
      var bs = window.BAJA_STORE || {};
      Object.keys(bs).forEach(function(nm){
        var b = bs[nm];
        if (!b || b.tipo !== 'lesion') return;
        var rec = store[nm];
        var rem = rec ? (Number(rec.partidos) || 0) : 0;
        if (rem <= 0) { delete bs[nm]; return; }
        b.liga = rem; b.copa = rem; b.europa = rem;
      });
    } catch(_){}
    _persistInjuries();
    try { if (window.athRefreshInjuryHud) window.athRefreshInjuryHud(); } catch(_){}
  }

  /* ── Persistencia de lesiones en localStorage (2026-05-22) ─────────
     BAJA_STORE / LESION_STORE viven en memoria; sin esto una lesión se
     pierde al recargar. Serializamos en `ftbol_lesiones_v1` — payload
     diminuto (<1 KB), muy por debajo del cap de 2 MB por carpeta. */
  var _LESION_LS_KEY = 'ftbol_lesiones_v1';
  var _lesionLastSer = '';
  function _persistInjuries() {
    try {
      var payload = JSON.stringify({
        baja:   window.BAJA_STORE   || {},
        lesion: window.LESION_STORE || {}
      });
      if (payload === _lesionLastSer) return;
      _lesionLastSer = payload;
      localStorage.setItem(_LESION_LS_KEY, payload);
    } catch (_) {}
  }
  function _loadInjuries() {
    try {
      var raw = localStorage.getItem(_LESION_LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d) return;
      window.BAJA_STORE   = window.BAJA_STORE   || {};
      window.LESION_STORE = window.LESION_STORE || {};
      if (d.baja)   Object.keys(d.baja).forEach(function(k){   if (!window.BAJA_STORE[k])   window.BAJA_STORE[k]   = d.baja[k]; });
      if (d.lesion) Object.keys(d.lesion).forEach(function(k){ if (!window.LESION_STORE[k]) window.LESION_STORE[k] = d.lesion[k]; });
      _lesionLastSer = raw;
    } catch (_) {}
  }
  window._persistInjuries = _persistInjuries;
  _loadInjuries();
  try {
    setInterval(_persistInjuries, 5000);
    window.addEventListener('beforeunload', _persistInjuries);
  } catch (_) {}

  window.LESION_STORE_UTILS = {
    registrar: registrarLesion,
    sortearGrado: sortearGrado,
    sortearPartidos: sortearPartidos,
    sortearEjemplo: sortearEjemplo,
    tiposLesion: LESION_TIPOS,
    decrementarPorPartido: decrementarPorPartido
  };

  /* Helper global para persistir lesiones que vengan en la lista de
     eventos de un partido (evento tipo 'lesion' con lesPartidos,
     lesDesc, lesGrado, lesIco o con propiedades tipo/grado/nombre).
     Se llama desde simularJornadaIA, genMatchEventsEnhanced live y
     _mlFinishMatchGen — antes las lesiones IA-vs-IA solo se pintaban
     en el acta y se metían en BAJA_STORE, pero NUNCA aterrizaban en
     LESION_STORE, así que la pantalla "BAJAS PARA EL PARTIDO"
     mostraba "Sin lesionados" aunque Pablo Barrios acabara de
     romperse el metatarsiano. */
  window._registrarLesionesDesdeEventos = function(events, homeName, awayName){
    if (!Array.isArray(events)) return;
    if (!window.LESION_STORE) window.LESION_STORE = {};
    if (!window.BAJA_STORE)   window.BAJA_STORE   = {};
    events.forEach(function(ev){
      if (!ev || ev.type !== 'lesion') return;
      /* Nombre: puede venir como string (ev.player = 'Pablo Barrios')
         o como array (ev.player = [num, name, ...]) o en ev.name. */
      var playerName = '';
      if (Array.isArray(ev.player)) playerName = ev.player[1] || ev.player[0] || '';
      else if (typeof ev.player === 'string') playerName = ev.player;
      else playerName = ev.name || '';
      playerName = String(playerName || '').replace(/^\s*\d+\s*[\.\-]?\s*/, '').trim();
      if (!playerName || playerName === '?') return;
      var teamName = (ev.realTeam) ? String(ev.realTeam)
                   : (ev.team === 'a') ? String(homeName || '')
                   : String(awayName || '');
      var partidos = Number(ev.lesPartidos || ev.partidos) || 1;
      var grado   = Number(ev.lesGrado   || ev.grado)   || 1;
      var desc    = String(ev.lesDesc    || ev.descripcion || '');
      var gNombre = ev.gradoNombre || (grado === 3 ? 'Grave' : grado === 2 ? 'Moderada' : 'Leve');
      var gEmoji  = ev.lesIco || ev.gradoEmoji || (grado === 3 ? '🚑' : grado === 2 ? '💉' : '🩹');
      /* Si ya hay una lesión pendiente para este jugador, SOLO
         actualizamos si la nueva es MÁS grave o MÁS larga (evita que
         un roce leve pise una fractura grave que aún está sanando). */
      var prev = window.LESION_STORE[playerName];
      if (prev && Number(prev.partidos) > 0) {
        var prevPart  = Number(prev.partidos) || 0;
        var prevGrado = Number(prev.grado) || 0;
        if (grado < prevGrado || (grado === prevGrado && partidos < prevPart)) {
          return;  /* la lesión previa es peor, no la sobrescribimos */
        }
      }
      window.LESION_STORE[playerName] = {
        equipo:      teamName,
        grado:       grado,
        gradoNombre: gNombre,
        gradoEmoji:  gEmoji,
        descripcion: desc,
        partidos:    partidos,
        timestamp:   Date.now(),
        /* El partido en que se registra la lesión NO descuenta baja. */
        _skipFirstDecrement: true
      };
      window.BAJA_STORE[playerName] = {
        tipo:   'lesion',
        liga:   partidos,
        copa:   partidos,
        europa: partidos
      };
    });
    /* Refresca al instante todas las superficies que muestran
       lesionados: HUD 💊, plantilla del Liverpool, overlay de sanciones,
       y persiste a localStorage. Sin esto, una lesión registrada en
       gm-modal o ml-card no aparecía en la plantilla del Liverpool
       hasta recargar la web (foto 2026-05-27 A. Robertson). */
    try { if (typeof window._notifyInjuryAdded === 'function') window._notifyInjuryAdded(); } catch(_){}
  };

  /* HELPER CANÓNICO de refresh tras añadir/quitar una lesión
     (2026-05-27). Centralizamos aquí la cadena de repintados para que
     cualquier ruta que escriba a `LESION_STORE` (entrenamiento,
     evento de partido IA-vs-IA, evento del acta humana, scripts de
     sanciones, …) pueda llamarlo sin duplicar lógica. Es
     idempotente y silencioso — si una de las superficies no está
     en pantalla, su refresher hace early-return. */
  window._notifyInjuryAdded = function _notifyInjuryAdded() {
    /* (1) Persistencia inmediata a localStorage (sobrevive recarga). */
    try { if (typeof window._persistInjuries === 'function') window._persistInjuries(); } catch(_){}
    /* (2) HUD 💊 del Liverpool — el contador `#ath-med-injury` se
       repinta con el máximo de partidos pendientes. */
    try { if (typeof window.athRefreshInjuryHud === 'function') window.athRefreshInjuryHud(); } catch(_){}
    /* (3) Plantilla del editor de Liga EA Sports (overlay lext-ov-squad)
       si está abierta — añade el badge 🩹 NP al jugador lesionado.
       Mismo guard que usa `ligaExtReiniciar`: sólo repinta si el
       overlay está visible. */
    try {
      var ovSquad = document.getElementById('lext-ov-squad');
      if (ovSquad && ovSquad.classList && ovSquad.classList.contains('show')
          && typeof window.renderSquadList === 'function') {
        window.renderSquadList();
      }
    } catch(_){}
    /* (4) Overlay "BAJAS PARA EL PARTIDO" / sanciones, si está abierto. */
    try { if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList(); } catch(_){}
    /* (5) Evento DOM público — terceros (futuros mods, paneles de
       debug) pueden escuchar `ftbol:injury-added` sin acoplarse a
       este helper. */
    try {
      document.dispatchEvent(new CustomEvent('ftbol:injury-added'));
    } catch(_){}
  };

  console.log('[eFootball] Sistema de Lesiones activado ✓');
})();



/* ══ FIX SCROLL — Restaurar posición tras añadir evento ══════════════
   Cuando se confirma un jugador en el picker overlay, el DOM cambia
   y el navegador pierde la posición de scroll. Este bloque guarda la
   posición antes de abrir el overlay y la restaura al cerrarlo.
   ══════════════════════════════════════════════════════════════════ */
(function(){
  var _savedScrollY = 0;

  // Guardar scroll al abrir cualquier overlay de selección de jugador
  var _origShowPl = {};
  ['j1m1','j1m2','j1m3'].forEach(function(mid) {
    var showFnName = 'mlShowPl_' + mid;
    var hideFnName = 'mlHidePl_' + mid;
    var confirmFnName = 'mlPlConfirm_' + mid;

    // Parchear mlShowPl para guardar scroll
    (function(fn) {
      window[showFnName] = function() {
        _savedScrollY = window.scrollY || window.pageYOffset || 0;
        if (fn) fn.apply(this, arguments);
      };
    })(window[showFnName]);

    // Parchear mlHidePl para restaurar scroll
    (function(fn) {
      window[hideFnName] = function() {
        if (fn) fn.apply(this, arguments);
        setTimeout(function() {
          window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
        }, 0);
      };
    })(window[hideFnName]);

    // Parchear mlPlConfirm para restaurar scroll tras confirmar
    (function(fn) {
      window[confirmFnName] = function(num, name) {
        if (fn) fn.apply(this, arguments);
        setTimeout(function() {
          window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
        }, 30);
      };
    })(window[confirmFnName]);
  });

  // También aplicar a los overlays de selección de equipo (mlTPOverlay)
  var _origTPSelect = {};
  ['j1m1','j1m2','j1m3'].forEach(function(mid) {
    var showTPName = 'mlShowTP_' + mid;
    var hideTPName = 'mlHideTP_' + mid;

    (function(fn) {
      window[showTPName] = function() {
        _savedScrollY = window.scrollY || window.pageYOffset || 0;
        if (fn) fn.apply(this, arguments);
      };
    })(window[showTPName]);

    (function(fn) {
      window[hideTPName] = function() {
        if (fn) fn.apply(this, arguments);
        setTimeout(function() {
          window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
        }, 0);
      };
    })(window[hideTPName]);
  });

  // También guardar scroll al abrir el overlay de eventos (mlShowEvOv)
  ['j1m1','j1m2','j1m3'].forEach(function(mid) {
    var showEvName = 'mlShowEvOv_' + mid;
    var hideEvName = 'mlHideEvOv_' + mid;

    (function(fn) {
      window[showEvName] = function() {
        _savedScrollY = window.scrollY || window.pageYOffset || 0;
        if (fn) fn.apply(this, arguments);
      };
    })(window[showEvName]);

    (function(fn) {
      window[hideEvName] = function() {
        if (fn) fn.apply(this, arguments);
        setTimeout(function() {
          window.scrollTo({ top: _savedScrollY, behavior: 'instant' });
        }, 0);
      };
    })(window[hideEvName]);
  });

  console.log('[eFootball] Fix scroll overlay activado ✓');
})();


/* ══ PODER DE EQUIPO — Valor visible junto al escudo ════════════════
   Muestra el poder/valor del equipo (sobre 100) discretamente
   junto al nombre del equipo en marcadores, previas y calendario,
   sin contaminar textContent (usa data-attributes + ::after).
   ══════════════════════════════════════════════════════════════════ */
(function(){

  function getPoderEquipo(teamName) {
    var aliases = window.TEAM_ALIASES || {};
    var clean = (teamName || '').replace(/\s+\d+\s*\/\s*100$/,'').trim();
    var resolved = aliases[clean.toLowerCase()] || clean;
    var r = window.TEAM_RATINGS && (window.TEAM_RATINGS[resolved] || window.TEAM_RATINGS[clean]);
    if (!r) return null;
    return Math.max(1, Math.min(100, Math.round(r)));
  }

  function poderTone(val) {
    if (val >= 84) return 'elite';
    if (val >= 79) return 'alto';
    if (val >= 74) return 'medio';
    return 'base';
  }

  var _style = document.createElement('style');
  _style.textContent = [
    '[data-team-power]{position:relative;}',
    '[data-team-power]::after{',
    '  content:attr(data-team-power);',
    '  display:inline-flex;',
    '  align-items:center;',
    '  justify-content:center;',
    '  min-width:22px;',
    '  margin-left:6px;',
    '  padding:1px 6px;',
    '  border-radius:999px;',
    '  font-family:Oswald,sans-serif;',
    '  font-size:10px;',
    '  font-weight:700;',
    '  letter-spacing:.35px;',
    '  line-height:1.35;',
    '  vertical-align:middle;',
    '  background:rgba(255,255,255,.07);',
    '  border:1px solid rgba(255,255,255,.12);',
    '  color:rgba(255,255,255,.82);',
    '  box-sizing:border-box;',
    '}',
    '[data-team-power-tone="elite"]::after{color:rgba(255,215,130,.92);}',
    '[data-team-power-tone="alto"]::after{color:rgba(193,229,255,.88);}',
    '[data-team-power-tone="medio"]::after{color:rgba(222,222,222,.82);}',
    '[data-team-power-tone="base"]::after{color:rgba(255,182,151,.78);}',
    '.ml-team-name[data-team-power]::after{font-size:9px;padding:1px 5px;margin-left:5px;}',
    '.mn[data-team-power]::after{font-size:9px;padding:1px 5px;margin-left:4px;opacity:.78;}',
    '@media (max-width:768px){',
    '  [data-team-power]::after{font-size:9px;padding:1px 5px;min-width:20px;margin-left:4px;}',
    '}'
  ].join('');
  document.head.appendChild(_style);

  function cleanVisibleTeamName(el) {
    if (!el) return '';
    var txt = (el.getAttribute('data-team-name') || el.textContent || '').trim();
    txt = txt.replace(/\s+\d+\s*\/\s*100$/,'').trim();
    return txt;
  }

  function decorateTeamEl(el, explicitName) {
    if (!el) return;
    var teamName = (explicitName || cleanVisibleTeamName(el) || '').trim();
    if (!teamName || teamName === 'Por definir') return;
    var poder = getPoderEquipo(teamName);
    if (!poder) return;
    el.setAttribute('data-team-name', teamName);
    el.setAttribute('data-team-power', String(poder));
    el.setAttribute('data-team-power-tone', poderTone(poder));
    el.title = teamName + ' · Poder ' + poder + '/100';
  }

  function injectCalendarPower() {
    document.querySelectorAll('.mrow .mn').forEach(function(el) {
      decorateTeamEl(el);
      var oldBadge = el.querySelector('.team-poder-badge');
      if (oldBadge) oldBadge.remove();
    });
  }

  function injectLiveHeaderPower() {
    document.querySelectorAll('.ml-header').forEach(function(header) {
      var names = header.querySelectorAll('.ml-team-name');
      if (names[0]) decorateTeamEl(names[0]);
      if (names[1]) decorateTeamEl(names[1]);
    });
  }

  function injectGenericPower() {
    document.querySelectorAll('[data-team-a],[data-team-b]').forEach(function(box) {
      var aName = box.getAttribute('data-team-a');
      var bName = box.getAttribute('data-team-b');
      var names = box.querySelectorAll('.ml-team-name,.mn,.team-name');
      if (names[0] && aName) decorateTeamEl(names[0], aName);
      if (names[1] && bName) decorateTeamEl(names[1], bName);
    });
  }

  function injectAllTeamPower() {
    injectCalendarPower();
    injectLiveHeaderPower();
    injectGenericPower();
  }

  window.getPoderEquipoVisible = getPoderEquipo;
  window.injectAllTeamPower = injectAllTeamPower;

  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(injectAllTeamPower, 180);
  });

  var _origGoPoder = window.go;
  window.go = function(id) {
    if (_origGoPoder) _origGoPoder.apply(this, arguments);
    setTimeout(injectAllTeamPower, 180);
  };

  if (typeof MutationObserver !== 'undefined') {
    /* Debounce 400ms — antes este observer schedulaba un setTimeout
       NUEVO en CADA mutación del body (childList:true, subtree:true).
       Cada iaSimLive goal o classList toggle dejaba un setTimeout
       pendiente → injectAllTeamPower (que querySelectorAll todo el
       DOM con 3 funciones) corría decenas de veces por segundo,
       saturando el thread JS y parando los cronómetros. Fix
       2026-05-11. */
    var _injPow = null;
    var _obs = new MutationObserver(function() {
      if (_injPow) return;
      _injPow = setTimeout(function(){ _injPow = null; try { injectAllTeamPower(); } catch(_){} }, 400);
    });
    document.addEventListener('DOMContentLoaded', function() {
      _obs.observe(document.body, { childList:true, subtree:true });
    });
  }

  console.log('[eFootball] Poder de equipos activado ✓');
})();


/* ══════════════════════════════════════════════════════════════════════
   CAMPO DE CHAPAS — Visualización táctica en tiempo real
   Aparece en partidos IA vs IA cuando ambos equipos tienen rating ≥ 79
   ══════════════════════════════════════════════════════════════════════ */
(function(){

  // ── Colores de equipos ────────────────────────────────────────────
  var CAMPO_TEAM_COLORS = {
    'Real Madrid':      { bg:'#ffffff', fg:'#003087', border:'#d4af37' },
    'FC Barcelona':     { bg:'#a50044', fg:'#edbb00', border:'#003da5' },
    'Atlético Madrid':  { bg:'#c50f1f', fg:'#ffffff', border:'#ffffff' },
    'Athletic Club':    { bg:'#cc1010', fg:'#ffffff', border:'#000000' },
    'Real Betis':       { bg:'#00a650', fg:'#ffffff', border:'#ffd700' },
    'Real Sociedad':    { bg:'#003f8a', fg:'#d0dcf4', border:'#d0dcf4' },
    'Sevilla FC':       { bg:'#ffffff', fg:'#c60b1e', border:'#c60b1e' },
    'Villarreal CF':    { bg:'#ffd700', fg:'#1a1a1a', border:'#1a1a1a' },
    'Celta de Vigo':    { bg:'#6fc6e2', fg:'#003da5', border:'#003da5' },
    'Girona FC':        { bg:'#c8102e', fg:'#ffffff', border:'#ffffff' },
    'Osasuna':          { bg:'#c8102e', fg:'#ffffff', border:'#000000' },
    'Deportivo Alavés': { bg:'#003da5', fg:'#ffffff', border:'#ffffff' },
    'Mallorca':         { bg:'#c8102e', fg:'#ffcc00', border:'#000000' },
    'Rayo Vallecano':   { bg:'#ffffff', fg:'#e8000d', border:'#e8000d' },
    'Valencia CF':      { bg:'#ffffff', fg:'#ef7d00', border:'#000000' },
    'Espanyol':         { bg:'#003da5', fg:'#ffffff', border:'#ffffff' },
    'Getafe CF':        { bg:'#003da5', fg:'#ffffff', border:'#a0a0a0' },
    'Elche CF':         { bg:'#006633', fg:'#ffffff', border:'#ffffff' },
    'Córdoba CF':       { bg:'#2a7e43', fg:'#ffffff', border:'#ffffff' },
    'Albacete BP':      { bg:'#8b0000', fg:'#fff200', border:'#fff200' },
    'Levante UD':       { bg:'#c8102e', fg:'#0057a8', border:'#0057a8' },
    'Real Oviedo':      { bg:'#003da5', fg:'#ffffff', border:'#ffffff' },
    'Sevilla':          { bg:'#ffffff', fg:'#c60b1e', border:'#c60b1e' },
    'Villarreal':       { bg:'#ffd700', fg:'#1a1a1a', border:'#1a1a1a' },
  };

  function getTeamColors(name) {
    var aliases = window.TEAM_ALIASES || {};
    var resolved = aliases[(name||'').trim().toLowerCase()] || name;
    return CAMPO_TEAM_COLORS[resolved] || CAMPO_TEAM_COLORS[name] || { bg:'#888', fg:'#fff', border:'#fff' };
  }
  window.getTeamColors = getTeamColors;

  // ── Formaciones 4-3-3 ────────────────────────────────────────────
  // Posiciones normalizadas [x%, y%] — campo horizontal, equipo A ataca →
  var FORMATION_A = [
    // Portero
    [8, 50],
    // Defensas (4)
    [22, 20], [22, 40], [22, 60], [22, 80],
    // Medios (3)
    [42, 25], [42, 50], [42, 75],
    // Delanteros (3)
    [65, 20], [65, 50], [65, 80]
  ];
  var FORMATION_B = [
    // Portero
    [92, 50],
    // Defensas (4)
    [78, 20], [78, 40], [78, 60], [78, 80],
    // Medios (3)
    [58, 25], [58, 50], [58, 75],
    // Delanteros (3)
    [35, 20], [35, 50], [35, 80]
  ];

  // ── Crear canvas del campo ────────────────────────────────────────
  function createCampoElement(matchKey, teamA, teamB) {
    var wrap = document.createElement('div');
    wrap.id = 'campo-wrap-' + matchKey;
    wrap.className = 'campo-wrap';
    wrap.innerHTML =
      '<div class="campo-header">'
      + '<span class="campo-lbl">⚽ CAMPO EN VIVO</span>'
      + '</div>'
      + '<div class="campo-field" id="campo-field-' + matchKey + '">'
      + '<canvas id="campo-canvas-' + matchKey + '" class="campo-canvas"></canvas>'
      + '</div>';
    return wrap;
  }

  // ── Dibujar campo ────────────────────────────────────────────────
  function drawField(ctx, W, H) {
    // Fondo verde
    ctx.fillStyle = '#2d7a2d';
    ctx.fillRect(0, 0, W, H);

    // Líneas del campo
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;

    // Borde
    ctx.strokeRect(8, 8, W-16, H-16);

    // Línea central
    ctx.beginPath();
    ctx.moveTo(W/2, 8);
    ctx.lineTo(W/2, H-8);
    ctx.stroke();

    // Círculo central
    ctx.beginPath();
    ctx.arc(W/2, H/2, H*0.12, 0, Math.PI*2);
    ctx.stroke();

    // Punto central
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(W/2, H/2, 3, 0, Math.PI*2);
    ctx.fill();

    // Área grande izquierda
    var aW = W*0.12, aH = H*0.44;
    ctx.strokeRect(8, H/2 - aH/2, aW, aH);

    // Área pequeña izquierda
    var saW = W*0.05, saH = H*0.22;
    ctx.strokeRect(8, H/2 - saH/2, saW, saH);

    // Área grande derecha
    ctx.strokeRect(W-8-aW, H/2 - aH/2, aW, aH);

    // Área pequeña derecha
    ctx.strokeRect(W-8-saW, H/2 - saH/2, saW, saH);

    // Punto de penalti izquierdo
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(W*0.13, H/2, 2.5, 0, Math.PI*2);
    ctx.fill();

    // Punto de penalti derecho
    ctx.beginPath();
    ctx.arc(W*0.87, H/2, 2.5, 0, Math.PI*2);
    ctx.fill();

    // Franjas de césped (decorativas)
    for (var s = 0; s < 8; s++) {
      if (s % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(8 + s * (W-16)/8, 8, (W-16)/8, H-16);
      }
    }
  }

  // ── Estado de las chapas ─────────────────────────────────────────
  var _campoStates = {};

  function initCampoState(matchKey, teamA, teamB) {
    var colA = getTeamColors(teamA);
    var colB = getTeamColors(teamB);

    var players = [];
    // Equipo A (11 jugadores)
    for (var i = 0; i < 11; i++) {
      players.push({
        team: 'a', idx: i,
        x: FORMATION_A[i][0], y: FORMATION_A[i][1],
        tx: FORMATION_A[i][0], ty: FORMATION_A[i][1], // target
        bg: colA.bg, fg: colA.fg, border: colA.border,
        num: i + 1, highlighted: false, expelled: false
      });
    }
    // Equipo B (11 jugadores)
    for (var j = 0; j < 11; j++) {
      players.push({
        team: 'b', idx: j,
        x: FORMATION_B[j][0], y: FORMATION_B[j][1],
        tx: FORMATION_B[j][0], ty: FORMATION_B[j][1],
        bg: colB.bg, fg: colB.fg, border: colB.border,
        num: j + 1, highlighted: false, expelled: false
      });
    }

    // Balón
    var ball = { x: 50, y: 50, tx: 50, ty: 50, visible: true };

    _campoStates[matchKey] = {
      players: players,
      ball: ball,
      teamA: teamA,
      teamB: teamB,
      animFrame: null,
      lastEvent: null,
      phase: 'idle' // idle | attack-a | attack-b | goal-a | goal-b
    };
    return _campoStates[matchKey];
  }

  // ── Animación suave de chapas ────────────────────────────────────
  function animateCampo(matchKey) {
    var state = _campoStates[matchKey];
    if (!state) return;
    var canvas = document.getElementById('campo-canvas-' + matchKey);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;

    // Mover chapas hacia target (lerp)
    state.players.forEach(function(p) {
      if (p.expelled) return;
      p.x += (p.tx - p.x) * 0.08;
      p.y += (p.ty - p.y) * 0.08;
    });
    // Mover balón
    state.ball.x += (state.ball.tx - state.ball.x) * 0.10;
    state.ball.y += (state.ball.ty - state.ball.y) * 0.10;

    // Movimiento aleatorio sutil (breathing)
    if (Math.random() < 0.02) {
      randomMicroMove(state);
    }

    drawField(ctx, W, H);
    drawPlayers(ctx, W, H, state);
    drawBall(ctx, W, H, state.ball);

    state.animFrame = requestAnimationFrame(function() { animateCampo(matchKey); });
  }

  function randomMicroMove(state) {
    state.players.forEach(function(p) {
      if (p.expelled) return;
      var base = p.team === 'a' ? FORMATION_A[p.idx] : FORMATION_B[p.idx];
      p.tx = base[0] + (Math.random() - 0.5) * 6;
      p.ty = base[1] + (Math.random() - 0.5) * 6;
      // Mantener en campo
      p.tx = Math.max(5, Math.min(95, p.tx));
      p.ty = Math.max(5, Math.min(95, p.ty));
    });
  }

  function drawPlayers(ctx, W, H, state) {
    state.players.forEach(function(p) {
      if (p.expelled) return;
      var px = p.x / 100 * W;
      var py = p.y / 100 * H;
      var r = Math.min(W, H) * 0.038;

      // Sombra
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;

      // Círculo principal
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI*2);
      ctx.fillStyle = p.bg;
      ctx.fill();

      // Borde
      ctx.strokeStyle = p.highlighted ? '#ffff00' : p.border;
      ctx.lineWidth = p.highlighted ? 3 : 1.5;
      ctx.stroke();
      ctx.restore();

      // Número
      ctx.font = 'bold ' + Math.round(r * 0.85) + 'px Oswald,sans-serif';
      ctx.fillStyle = p.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.num, px, py + 0.5);
    });
  }

  function drawBall(ctx, W, H, ball) {
    if (!ball.visible) return;
    var bx = ball.x / 100 * W;
    var by = ball.y / 100 * H;
    var br = Math.min(W, H) * 0.022;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI*2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Manchas del balón
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(bx - br*0.25, by - br*0.25, br*0.28, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // ── Reaccionar a eventos del acta ────────────────────────────────
  function procesarEventoCampo(matchKey, evType, evTeam, evMin) {
    var state = _campoStates[matchKey];
    if (!state) return;

    if (evType === 'gol' || evType === 'pen-gol' || evType === 'falta-gol') {
      reactionGol(state, evTeam);
    } else if (evType === 'pen-parado') {
      reactionPenParado(state, evTeam);
    } else if (evType === 'card' || evType === 'roja' || evType === 'd-amarilla') {
      reactionTarjeta(state, evTeam, evType);
    } else if (evType === 'pen-prov') {
      reactionPenalti(state, evTeam);
    } else {
      // Movimiento genérico de ataque
      reactionAtaque(state, evTeam);
    }
  }

  function reactionGol(state, team) {
    // Atacantes del equipo que marca se juntan en el centro
    var isA = team === 'a';
    state.players.forEach(function(p) {
      if (p.expelled) return;
      if (p.team === team && p.idx >= 8) { // delanteros
        p.tx = isA ? 50 + Math.random()*10 : 50 - Math.random()*10;
        p.ty = 45 + Math.random()*10;
        p.highlighted = true;
        setTimeout(function() { p.highlighted = false; }, 3000);
      }
    });
    // Balón va a la portería
    state.ball.tx = isA ? 95 : 5;
    state.ball.ty = 50;
    setTimeout(function() {
      // Vuelta al centro
      state.ball.tx = 50; state.ball.ty = 50;
      resetFormations(state);
    }, 4000);
  }

  function reactionPenParado(state, gkTeam) {
    // GK se desplaza al poste
    var gk = state.players.find(function(p) { return p.team === gkTeam && p.idx === 0; });
    if (gk) {
      gk.tx = gkTeam === 'a' ? 5 : 95;
      gk.ty = 35 + Math.random() * 30;
      gk.highlighted = true;
      setTimeout(function() { gk.highlighted = false; resetFormations(state); }, 3500);
    }
    // Balón rebota
    state.ball.tx = gkTeam === 'a' ? 15 : 85;
    state.ball.ty = 50;
  }

  function reactionTarjeta(state, team, type) {
    if (type === 'roja' || type === 'd-amarilla') {
      // Buscar un jugador del equipo para expulsar (no el portero)
      var candidates = state.players.filter(function(p) {
        return p.team === team && p.idx > 0 && !p.expelled;
      });
      if (candidates.length) {
        var expelled = candidates[Math.floor(Math.random() * candidates.length)];
        expelled.expelled = true;
        expelled.tx = expelled.team === 'a' ? -5 : 105;
      }
    } else {
      // Amarilla: jugador se detiene
      reactionAtaque(state, team === 'a' ? 'b' : 'a');
    }
  }

  function reactionPenalti(state, foulTeam) {
    // Rival va al punto de penalti
    var shootTeam = foulTeam === 'a' ? 'b' : 'a';
    var striker = state.players.find(function(p) { return p.team === shootTeam && p.idx >= 8; });
    if (striker) {
      striker.tx = foulTeam === 'a' ? 13 : 87;
      striker.ty = 50;
    }
    state.ball.tx = foulTeam === 'a' ? 13 : 87;
    state.ball.ty = 50;
  }

  function reactionAtaque(state, team) {
    var isA = team === 'a';
    // Medios y delanteros avanzan
    state.players.forEach(function(p) {
      if (p.expelled) return;
      if (p.team === team && p.idx >= 4) {
        var base = isA ? FORMATION_A[p.idx] : FORMATION_B[p.idx];
        var advance = isA ? 8 : -8;
        p.tx = Math.max(5, Math.min(95, base[0] + advance));
        p.ty = base[1] + (Math.random()-0.5)*8;
      }
    });
    // Balón avanza
    state.ball.tx = isA ? state.ball.x + 15 : state.ball.x - 15;
    state.ball.tx = Math.max(5, Math.min(95, state.ball.tx));
    setTimeout(resetFormations.bind(null, state), 3000);
  }

  function resetFormations(state) {
    state.players.forEach(function(p) {
      if (p.expelled) return;
      var base = p.team === 'a' ? FORMATION_A[p.idx] : FORMATION_B[p.idx];
      p.tx = base[0]; p.ty = base[1];
    });
  }

  // ── CSS ──────────────────────────────────────────────────────────
  var _campoStyle = document.createElement('style');
  _campoStyle.textContent = [
    '.campo-wrap{',
    '  margin-top:12px;',
    '  background:rgba(0,0,0,0.25);',
    '  border:1px solid rgba(255,255,255,0.08);',
    '  border-radius:10px;',
    '  overflow:hidden;',
    '}',
    '.campo-header{',
    '  padding:6px 12px;',
    '  background:rgba(255,255,255,0.04);',
    '  border-bottom:1px solid rgba(255,255,255,0.07);',
    '  display:flex;align-items:center;gap:6px;',
    '}',
    '.campo-lbl{',
    '  font-family:Oswald,sans-serif;',
    '  font-size:10px;letter-spacing:2px;',
    '  color:rgba(255,255,255,0.5);',
    '  text-transform:uppercase;',
    '}',
    '.campo-field{',
    '  padding:8px;',
    '  display:flex;justify-content:center;',
    '}',
    '.campo-canvas{',
    '  width:100%;',
    '  max-width:440px;',
    '  height:auto;',
    '  border-radius:6px;',
    '  display:block;',
    '}'
  ].join('');
  document.head.appendChild(_campoStyle);

  // ── Hook en mlSimEngine ──────────────────────────────────────────
  // Detectar partidos ≥79 e inyectar el campo
  var _origSimEngine = window.mlSimEngine;
  window.mlSimEngine = function(cfg) {
    var TEAM_A = (cfg.teamA || '').trim();
    var TEAM_B = (cfg.teamB || '').trim();

    // Resolver aliases
    var aliases = window.TEAM_ALIASES || {};
    var resolvedA = aliases[TEAM_A.toLowerCase()] || TEAM_A;
    var resolvedB = aliases[TEAM_B.toLowerCase()] || TEAM_B;

    var rA = window.TEAM_RATINGS && (window.TEAM_RATINGS[resolvedA] || window.TEAM_RATINGS[TEAM_A]) || 0;
    var rB = window.TEAM_RATINGS && (window.TEAM_RATINGS[resolvedB] || window.TEAM_RATINGS[TEAM_B]) || 0;

    var usarCampo = false; // Fase 3: campo 3D desactivado para IA vs IA (el usuario quiere 30s/parte fijos)

    if (usarCampo) {
      // Cambiar velocidad: 45s por parte (total ~90s)
      var cfgMod = {};
      Object.keys(cfg).forEach(function(k){ cfgMod[k] = cfg[k]; });
      cfgMod._usarCampo = true;
      cfgMod._teamAResolved = resolvedA;
      cfgMod._teamBResolved = resolvedB;

      // Inyectar canvas ANTES de simular
      setTimeout(function() {
        var listEl = document.getElementById(cfg.listId);
        if (!listEl) return;
        var matchWrap = listEl.closest('.match-live-wrap') || listEl.parentElement;
        if (!matchWrap) return;

        // Buscar o crear contenedor del campo
        var existing = document.getElementById('campo-wrap-' + cfg.matchKey);
        if (existing) existing.remove();

        var campoEl = createCampoElement(cfg.matchKey, resolvedA, resolvedB);

        // Insertar ENTRE el marcador y el acta
        // El acta tiene id="acta-body-MATCHKEY" o está justo antes de ml-acta-list
        var actaBody = matchWrap.querySelector('[id^="acta-body-"]') ||
                       matchWrap.querySelector('[id^="acta-toggle-"]') ||
                       document.getElementById(cfg.listId);
        if (actaBody) {
          // Insertar antes del bloque del acta
          var actaParent = actaBody.parentElement || matchWrap;
          actaParent.insertBefore(campoEl, actaBody);
        } else {
          matchWrap.appendChild(campoEl);
        }

        // Inicializar canvas con tamaño correcto
        var canvas = document.getElementById('campo-canvas-' + cfg.matchKey);
        if (canvas) {
          canvas.width = 440;
          canvas.height = 280;
          var state = initCampoState(cfg.matchKey, resolvedA, resolvedB);
          animateCampo(cfg.matchKey);
        }

        // Observar el acta para reaccionar a eventos
        var actaList = document.getElementById(cfg.listId);
        if (actaList) {
          var _obs = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
              m.addedNodes.forEach(function(node) {
                if (!node.classList || !node.classList.contains('ml-evt-item')) return;
                var type = node.getAttribute('data-type') || '';
                var team = node.getAttribute('data-team') || 'a';
                procesarEventoCampo(cfg.matchKey, type, team, 0);
              });
            });
          });
          _obs.observe(actaList, { childList: true });
        }
      }, 200);
    }

    // Llamar al engine original (con velocidad aumentada si procede)
    if (usarCampo) {
      // Guardar velocidades originales y aumentar a 45s por parte
      var origNS = window._CAMPO_NORMAL_SPEED_ORIG || 944;
      var origES = window._CAMPO_ET_SPEED_ORIG || 833;
      // 45s por parte = cada minuto dura 45000/45 = 1000ms → ya es 1000
      // Para 45s queremos que 45 mins pasen en 45s: speed=1000 está bien
      // Pero necesitamos que el ticker de 30 ticks (cada 1s) dure 90s
      // El ticker actual usa 1000ms/tick, 30 ticks = 30s total
      // Para 90s necesitamos 3000ms/tick → multiplicamos ×3
      window._CAMPO_ACTIVE = true;
      window._CAMPO_MATCH_KEY = cfg.matchKey;
    }

    return _origSimEngine ? _origSimEngine.apply(this, arguments) : undefined;
  };

  // ── Parchar el ticker de animación del simulador para 45s por parte ──
  // El ticker original usa setInterval de 1000ms con 30 ticks = 30s
  // Para 45s por parte queremos 45000ms / 15 ticks = 3000ms/tick
  var _origSetInterval = window.setInterval;
  // Parcheamos dentro de mlSimEngine extendiendo el cfg
  // La forma más limpia: extender el onEnd para limpiar el campo
  var _origGoCampo = window.go;
  window.go = function(id) {
    if (_origGoCampo) _origGoCampo.apply(this, arguments);
    // Limpiar animaciones de campos al cambiar de pantalla
    Object.keys(_campoStates).forEach(function(key) {
      var s = _campoStates[key];
      if (s && s.animFrame) {
        cancelAnimationFrame(s.animFrame);
        s.animFrame = null;
      }
    });
    // Re-arrancar si volvemos a la misma pantalla
    setTimeout(function() {
      Object.keys(_campoStates).forEach(function(key) {
        var canvas = document.getElementById('campo-canvas-' + key);
        if (canvas && canvas.closest('.screen.active')) {
          animateCampo(key);
        }
      });
    }, 100);
  };

  console.log('[eFootball] Campo de chapas activado ✓');
})();

/* ============================================================
   AUTO-EVAL OBJECTIVES ENGINE
   ============================================================ */
(function(){

  // Generic team objective counter (mirrors athObjCount logic)
  function teamObjCount(cfg) {
    var container = document.getElementById(cfg.containerId);
    if (!container) return;
    var items = container.querySelectorAll('.obj-item');
    var total = items.length;
    var done = 0;
    items.forEach(function(lbl) {
      var cb = lbl.querySelector('input[type=checkbox]');
      if (cb && cb.checked) { done++; lbl.classList.add('done'); }
      else { lbl.classList.remove('done'); }
    });
    var countEl = document.getElementById(cfg.countId);
    if (countEl) countEl.textContent = done + ' / ' + total;
    var PTS_POR_OBJ = 0.40, MONEY_POR_OBJ = 40, MAX_PTS = 7.00, MAX_MONEY = 750;
    var pts = parseFloat((done * PTS_POR_OBJ).toFixed(2));
    var money = done * MONEY_POR_OBJ;
    var pctPts = Math.min(100, (pts / MAX_PTS) * 100);
    var pctMoney = Math.min(100, (money / MAX_MONEY) * 100);
    var superadoPts = pts >= MAX_PTS, superadoMoney = money >= MAX_MONEY;
    var ptsEl = document.getElementById(cfg.ptsValId);
    var moneyEl = document.getElementById(cfg.moneyValId);
    if (ptsEl) { ptsEl.textContent = pts.toFixed(2); ptsEl.classList.remove('pulse'); void ptsEl.offsetWidth; ptsEl.classList.add('pulse'); ptsEl.classList.toggle('superado', superadoPts); }
    if (moneyEl) { moneyEl.textContent = money; moneyEl.classList.remove('pulse'); void moneyEl.offsetWidth; moneyEl.classList.add('pulse'); moneyEl.classList.toggle('superado', superadoMoney); }
    var tPts = document.getElementById(cfg.ptsTgtId), tMoney = document.getElementById(cfg.moneyTgtId);
    if (tPts) tPts.classList.toggle('superado', superadoPts);
    if (tMoney) tMoney.classList.toggle('superado', superadoMoney);
    var barPts = document.getElementById(cfg.barPtsId), barMoney = document.getElementById(cfg.barMoneyId);
    if (barPts) { barPts.style.width = pctPts + '%'; barPts.classList.toggle('superado', superadoPts); }
    if (barMoney) { barMoney.style.width = pctMoney + '%'; barMoney.classList.toggle('superado', superadoMoney); }
    if (superadoPts && superadoMoney) {
      setTimeout(function() { if (typeof lanzarFuegos === 'function') lanzarFuegos(3000); }, 300);
    }
  }

  window.betObjCount = function() {
    teamObjCount({ containerId:'bet-obj', countId:'bet-obj-prog', ptsValId:'bet-pts-val', moneyValId:'bet-money-val', ptsTgtId:'bet-pts-target', moneyTgtId:'bet-money-target', barPtsId:'bet-bar-pts', barMoneyId:'bet-bar-money' });
  };
  window.socObjCount = function() {
    teamObjCount({ containerId:'soc-obj', countId:'soc-obj-prog', ptsValId:'soc-pts-val', moneyValId:'soc-money-val', ptsTgtId:'soc-pts-target', moneyTgtId:'soc-money-target', barPtsId:'soc-bar-pts', barMoneyId:'soc-bar-money' });
  };
  window.madObjCount = function() {
    teamObjCount({ containerId:'mad-obj', countId:'mad-obj-prog', ptsValId:'mad-pts-val', moneyValId:'mad-money-val', ptsTgtId:'mad-pts-target', moneyTgtId:'mad-money-target', barPtsId:'mad-bar-pts', barMoneyId:'mad-bar-money' });
  };
  window.barObjCount = function() {
    teamObjCount({ containerId:'bar-obj', countId:'bar-obj-prog', ptsValId:'bar-pts-val', moneyValId:'bar-money-val', ptsTgtId:'bar-pts-target', moneyTgtId:'bar-money-target', barPtsId:'bar-bar-pts', barMoneyId:'bar-bar-money' });
  };

  // Auto-evaluate objectives with data-auto attribute
  function autoEvalObjetivos(teamName, containerId, countFn) {
    var standings = window.collectStandings ? window.collectStandings() : [];
    var teamRow = null, teamPos = null;
    standings.forEach(function(row, i) {
      if (row.name === teamName) { teamRow = row; teamPos = i + 1; }
    });

    var container = document.getElementById(containerId);
    if (!container) return;

    var autoCbs = container.querySelectorAll('input[data-auto]');
    autoCbs.forEach(function(cb) {
      var key = cb.getAttribute('data-auto');
      var shouldCheck = false;

      if (key.startsWith('liga-pos-')) {
        var N = parseInt(key.split('-')[2]);
        shouldCheck = teamPos !== null && teamPos <= N;

      } else if (key.startsWith('liga-imbatido-')) {
        var N = parseInt(key.split('-')[2]);
        var form = teamRow ? (teamRow.form || []) : [];
        var consecutive = 0;
        for (var i = form.length - 1; i >= 0; i--) {
          if (form[i] === 'V' || form[i] === 'E') consecutive++;
          else break;
        }
        // Update counter display
        var lbl0 = cb.closest('.obj-item');
        if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = consecutive + mxH; } } }
        shouldCheck = teamRow !== null && consecutive >= N;

      } else if (key.startsWith('liga-pct-')) {
        var N = parseInt(key.split('-')[2]);
        var pct = teamRow && teamRow.pj > 0 ? Math.round((teamRow.v / teamRow.pj) * 100) : 0;
        var lbl0 = cb.closest('.obj-item');
        if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = pct + '%' + mxH; } } }
        shouldCheck = teamRow !== null && pct >= N;

      } else if (key.startsWith('liga-delante-')) {
        var rivalName = key.replace('liga-delante-', '');
        var rivalPos = null;
        standings.forEach(function(row, i) { if (row.name === rivalName) rivalPos = i + 1; });
        shouldCheck = teamPos !== null && rivalPos !== null && teamPos < rivalPos;

      } else if (key.startsWith('liga-gf-')) {
        var N = parseInt(key.split('-')[2]);
        var gf = teamRow ? (teamRow.gf || 0) : 0;
        var lbl0 = cb.closest('.obj-item');
        if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = gf + mxH; } } }
        shouldCheck = teamRow !== null && gf >= N;

      } else if (key.startsWith('liga-dg-')) {
        var N = parseInt(key.split('-')[2]);
        var dg = teamRow ? (teamRow.dg || 0) : 0;
        var lbl0 = cb.closest('.obj-item');
        if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = (dg >= 0 ? '+' : '') + dg + mxH; } } }
        shouldCheck = teamRow !== null && dg >= N;

      } else if (key.startsWith('liga-max-goles-')) {
        var N = parseInt(key.split('-').pop());
        var maxG = 0;
        (window.LIGA_J1_RESULTS || []).forEach(function(r) {
          if (r.home === teamName) maxG = Math.max(maxG, parseInt(r.gh) || 0);
          if (r.away === teamName) maxG = Math.max(maxG, parseInt(r['ga_']) || 0);
        });
        var lbl0 = cb.closest('.obj-item');
        if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = maxG + mxH; } } }
        shouldCheck = maxG >= N;

      } else if (key.startsWith('liga-wins-casa-')) {
        var N = parseInt(key.split('-').pop());
        var homeWins = 0;
        (window.LIGA_J1_RESULTS || []).forEach(function(r) {
          if (r.home === teamName && (parseInt(r.gh) || 0) > (parseInt(r['ga_']) || 0)) homeWins++;
        });
        var lbl0 = cb.closest('.obj-item');
        if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = homeWins + mxH; } } }
        shouldCheck = homeWins >= N;

      } else if (key === 'global-penalti-falta') {
        var screen = container.closest('.screen');
        if (screen) {
          var total = 0;
          screen.querySelectorAll('.ps-pen-gol, .ps-falta-gol').forEach(function(el) {
            ['liga','copa','europa','uecl','global'].forEach(function(comp) {
              total += parseInt(el.getAttribute('data-' + comp) || '0');
            });
          });
          var lbl0 = cb.closest('.obj-item');
          if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = total + mxH; } } }
          shouldCheck = total > 0;
        } else { return; }

      } else if (key.startsWith('derby-wins-')) {
        var N = parseInt(key.split('-').pop());
        var screen = container.closest('.screen');
        if (screen) {
          var wins = screen.querySelectorAll('.derby-match-row.derby-v').length;
          var lbl0 = cb.closest('.obj-item');
          if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = wins + mxH; } } }
          shouldCheck = wins >= N;
        } else { return; }

      } else if (key.startsWith('derby-imbatido-')) {
        var N = parseInt(key.split('-').pop());
        var screen = container.closest('.screen');
        if (screen) {
          var rows = Array.from(screen.querySelectorAll('.derby-match-row')).reverse();
          var consecutive = 0;
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].classList.contains('derby-p')) break;
            consecutive++;
          }
          var lbl0 = cb.closest('.obj-item');
          if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = consecutive + mxH; } } }
          shouldCheck = consecutive >= N;
        } else { return; }

      } else if (key.startsWith('derby-goles-')) {
        var N = parseInt(key.split('-').pop());
        var screen = container.closest('.screen');
        if (screen) {
          var maxDG = 0;
          screen.querySelectorAll('.derby-match-row .derby-score').forEach(function(s) {
            var parts = s.textContent.trim().split('-');
            maxDG = Math.max(maxDG, parseInt(parts[0]) || 0);
          });
          var lbl0 = cb.closest('.obj-item');
          if (lbl0) { var ctr = lbl0.querySelector('.obj-counter'); if (ctr) { var mx = ctr.querySelector('.obj-counter-max'); if (mx) { var mxH = mx.outerHTML; ctr.innerHTML = maxDG + mxH; } } }
          shouldCheck = maxDG >= N;
        } else { return; }

      } else if (key === 'derby-mas-goleador' || key === 'derby-menos-goleado') {
        return; // requires cross-team comparison, leave manual
      }

      cb.checked = shouldCheck;
      var lbl = cb.closest('.obj-item');
      if (lbl) lbl.classList.toggle('done', shouldCheck);
    });

    if (typeof countFn === 'function') countFn();
  }

  // Auto-eval all 5 human teams
  window.autoEvalAllTeams = function() {
    autoEvalObjetivos('Athletic Club', 'ath-obj-club', function(){ if(typeof athObjCount==='function') athObjCount(); });
    autoEvalObjetivos('Real Betis', 'bet-obj', window.betObjCount);
    autoEvalObjetivos('Real Sociedad', 'soc-obj', window.socObjCount);
    autoEvalObjetivos('Real Madrid', 'mad-obj', window.madObjCount);
    autoEvalObjetivos('FC Barcelona', 'bar-obj', window.barObjCount);
  };

  // Hook into buildLigaClas
  if (window.buildLigaClas) {
    var _orig = window.buildLigaClas;
    window.buildLigaClas = function() {
      _orig.apply(this, arguments);
      setTimeout(window.autoEvalAllTeams, 50);
    };
  }

  // Run on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(window.autoEvalAllTeams, 500);
  });

  console.log('[eFootball] Auto-eval objetivos activado ✓');
})();



/* script block ea sports persistence fix */
(function(){
  var LS_KEY = 'ef_liga38_v4';
  var TEAM_ORDER = [
    'Arsenal','Athletic Club','Atlético Madrid','Celta de Vigo','Deportivo Alavés','Elche CF','Espanyol','FC Barcelona','Getafe CF','Girona FC','Liverpool','Mallorca','Osasuna','Rayo Vallecano','Real Betis','Real Madrid','Real Sociedad','Sevilla','Valencia CF','Villarreal'
  ];
  var SHORT_NAMES = {
    'Bayern Munich':'Bayern',
    'Atlético Madrid':'Atl Madrid',
    'Celta de Vigo':'Celta',
    'Deportivo Alavés':'Alavés',
    'Elche CF':'Elche',
    'Rayo Vallecano':'Rayo',
    'Valencia CF':'Valencia'
  };
  // HUMAN_TEAMS dinámico desde ligaExt (misma lógica que script block 12)
  var HUMAN_TEAMS = (function(){
    var ht = {};
    try {
      var raw = localStorage.getItem('ligaExt_liga-ea-sports');
      if(raw){
        var d = JSON.parse(raw);
        if(d && Array.isArray(d.teams)){
          d.teams.forEach(function(t){ if(t.isHuman && t.humanEmoji) ht[t.name] = t.humanEmoji; });
        }
      }
    } catch(_){}
    if(!Object.keys(ht).length) ht = {'Bayern Munich':'💡','Arsenal':'🐭','Atlético Madrid':'✏️','Real Madrid':'🔨','FC Barcelona':'👿'};
    return ht;
  })();
  var TEAM_ALIAS = {
    'sevilla fc':'Sevilla','sevilla':'Sevilla',
    'villarreal cf':'Villarreal','villarreal':'Villarreal',
    'rc celta':'Celta de Vigo','celta':'Celta de Vigo','celta de vigo':'Celta de Vigo',
    'ca osasuna':'Osasuna','osasuna':'Osasuna',
    'mallorca':'Mallorca','rcd mallorca':'Mallorca',
    'getafe':'Getafe CF','getafe cf':'Getafe CF',
    'girona':'Girona FC','girona fc':'Girona FC',
    'elche':'Elche CF','elche cf':'Elche CF',
    'deportivo alaves':'Deportivo Alavés','deportivo alavés':'Deportivo Alavés',
    'alaves':'Deportivo Alavés','alavés':'Deportivo Alavés',
    'valencia':'Valencia CF','valencia cf':'Valencia CF',
    'rayo':'Rayo Vallecano','rayo vallecano':'Rayo Vallecano',
    'betis':'Real Betis','real betis':'Real Betis',
    'real madrid':'Real Madrid','fc barcelona':'FC Barcelona','barcelona':'FC Barcelona',
    'athletic club':'Athletic Club',
    'atletico madrid':'Atlético Madrid','atlético madrid':'Atlético Madrid',
    'arsenal':'Arsenal','arsenal fc':'Arsenal',
    'bayern munich':'Bayern Munich','fc bayern munich':'Bayern Munich','fc bayern':'Bayern Munich','bayern':'Bayern Munich',
    'sporting cp':'Sporting CP','sporting de portugal':'Sporting CP','sporting':'Sporting CP'
  };

  function normalizeText(str){
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function canonicalTeamName(name){
    var clean = String(name || '').trim();
    var key = normalizeText(clean);
    return TEAM_ALIAS[key] || clean;
  }
  function parseSavedResults(){
    /* Preferir la cache en memoria (sharedLigaResultsCache vía
       window.loadResults) antes que localStorage. Cuando
       simularTodasJornadasIA persiste muchos MB de eventos, el
       setItem puede fallar en silencio por cuota — la cache en
       memoria sí tiene las 38 jornadas, así que la clasificación
       cuenta correctamente sin esperar a una recarga. Después de
       recarga (cache vacía), caemos al localStorage como antes. */
    try {
      if (typeof window.loadResults === 'function') {
        var inMem = window.loadResults();
        if (inMem && typeof inMem === 'object' && Object.keys(inMem).length) {
          return inMem;
        }
      }
    } catch(_){}
    try {
      var data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch(e){
      return {};
    }
  }
  function ensureTeam(store, name){
    name = canonicalTeamName(name);
    if(!name || name === 'Por definir') return null;
    if(!store[name]){
      store[name] = {name:name, pts:0, pj:0, v:0, e:0, p:0, gf:0, gc:0, dg:0, ta:0, tr:0, mvp:0, formLog:[]};
    }
    return store[name];
  }
  function addForm(team, jornada, result){
    team.formLog.push({j:jornada, r:result});
  }
  function applyMatch(teams, jornada, homeName, awayName, gh, ga, penWinner, extra){
    var home = ensureTeam(teams, homeName), away = ensureTeam(teams, awayName);
    if(!home || !away) return;
    gh = Number(gh || 0); ga = Number(ga || 0);
    home.pj++; away.pj++;
    home.gf += gh; home.gc += ga;
    away.gf += ga; away.gc += gh;
    if(extra){
      home.ta += Number(extra.homeTA || 0);
      home.tr += Number(extra.homeTR || 0);
      away.ta += Number(extra.awayTA || 0);
      away.tr += Number(extra.awayTR || 0);
      home.mvp += Number(extra.homeMVP || 0);
      away.mvp += Number(extra.awayMVP || 0);
    }
    if(penWinner){
      if(penWinner === 'a'){
        home.v++; home.pts += 3; away.p++;
        addForm(home, jornada, 'W'); addForm(away, jornada, 'L');
      } else {
        away.v++; away.pts += 3; home.p++;
        addForm(home, jornada, 'L'); addForm(away, jornada, 'W');
      }
    } else if(gh > ga){
      home.v++; home.pts += 3; away.p++;
      addForm(home, jornada, 'W'); addForm(away, jornada, 'L');
    } else if(gh < ga){
      away.v++; away.pts += 3; home.p++;
      addForm(home, jornada, 'L'); addForm(away, jornada, 'W');
    } else {
      home.e++; away.e++; home.pts++; away.pts++;
      addForm(home, jornada, 'D'); addForm(away, jornada, 'D');
    }
  }
  function parseResultKey(key){
    var m = String(key || '').match(/^(\d+)\|([^|]+)\|(.+)$/);
    if(!m) return null;
    return {jornada: parseInt(m[1],10), home: canonicalTeamName(m[2]), away: canonicalTeamName(m[3])};
  }
  function countEventExtras(home, away, data){
    var out = {homeTA:0,homeTR:0,awayTA:0,awayTR:0,homeMVP:0,awayMVP:0};
    var evts = (data && data.events) || [];
    evts.forEach(function(ev){
      var side = ev && ev.team;
      if(side !== 'a' && side !== 'b'){
        var t = canonicalTeamName((ev && (ev.realTeam || ev.teamName || ev.team_label || ev.team)) || '');
        if(t === home) side = 'a';
        else if(t === away) side = 'b';
      }
      if(side !== 'a' && side !== 'b') return;
      var type = String((ev && ev.type) || '').trim().toLowerCase();
      var target = side === 'a' ? 'home' : 'away';
      if(type === 'amarilla') out[target+'TA'] += 1;
      else if(type === 'roja') out[target+'TR'] += 1;
      else if(type === 'd-amarilla'){ out[target+'TA'] += 1; out[target+'TR'] += 1; }
    });
    var mvpTeam = canonicalTeamName(data && data.mvpTeam || '');
    if(mvpTeam === home) out.homeMVP += 1;
    else if(mvpTeam === away) out.awayMVP += 1;
    return out;
  }
  /* ¿La key (j|home|away) corresponde a un match del SCHEDULE
     ACTUAL? Si el usuario ha reordenado el calendario en algún
     momento, el cache acumula keys de schedules antiguos que ya
     no son válidos — y eso inflaba PJ por encima del máximo
     posible (51 en lugar de 38). Filtramos aquí para contar
     solo los matches que pertenecen al calendario activo.
     Si SCHEDULE no está disponible (caso edge en arranques),
     aceptamos todo (comportamiento legacy). */
  function _resultKeyMatchesSchedule(key){
    var sch = window.LIGA_SCHEDULE;
    if(!sch || !Array.isArray(sch) || !sch.length) return true;
    var meta = parseResultKey(key);
    if(!meta) return false;
    if(meta.jornada < 1 || meta.jornada > sch.length) return false;
    var jArr = sch[meta.jornada - 1];
    if(!Array.isArray(jArr)) return false;
    var ch = canonicalTeamName(meta.home);
    var ca = canonicalTeamName(meta.away);
    for(var i = 0; i < jArr.length; i++){
      var pair = jArr[i];
      if(!pair) continue;
      if(canonicalTeamName(pair[0]) === ch && canonicalTeamName(pair[1]) === ca) return true;
    }
    return false;
  }
  function getSavedLigaTable(){
    var teams = {};
    TEAM_ORDER.forEach(function(name){ ensureTeam(teams, name); });
    var results = parseSavedResults();
    Object.keys(results).forEach(function(key){
      /* Saltar keys que no pertenecen al SCHEDULE actual (sims
         antiguos de schedules reshuffled). Sin esto, los equipos
         podían acumular 50+ PJ en una liga de 38 jornadas. */
      if(!_resultKeyMatchesSchedule(key)) return;
      var meta = parseResultKey(key);
      var data = results[key] || {};
      if(!meta || typeof data !== 'object') return;
      if(data.gh == null || data.ga == null) return;
      /* Solo contamos partidos de equipos que siguen en la liga. Un
         resultado guardado de un equipo retirado (p.ej. el Bayern,
         que ya no juega la Liga EA Sports) no debe re-crear su fila
         en la clasificación. */
      if(!teams[meta.home] || !teams[meta.away]) return;
      var extra = countEventExtras(meta.home, meta.away, data);
      applyMatch(teams, meta.jornada, meta.home, meta.away, data.gh, data.ga, data.penWinner || null, extra);
    });
    return Object.keys(teams).map(function(name){
      var team = teams[name];
      team.dg = team.gf - team.gc;
      team.formLog.sort(function(a,b){ return a.j - b.j; });
      team.form = team.formLog.slice(-5).map(function(x){ return x.r; });
      delete team.formLog;
      return team;
    }).sort(function(a,b){
      if(b.pts !== a.pts) return b.pts - a.pts;
      if(b.dg !== a.dg) return b.dg - a.dg;
      if(b.gf !== a.gf) return b.gf - a.gf;
      return a.name.localeCompare(b.name,'es');
    });
  }
  function formHtml(form){
    var last = (form || []).slice(-5);
    if(!last.length) return '<span class="clas-dot pending" title="Sin resultados"></span>';
    return last.map(function(r){
      if(r === 'W') return '<span class="clas-dot win" title="Victoria"></span>';
      if(r === 'D') return '<span class="clas-dot draw" title="Empate"></span>';
      return '<span class="clas-dot loss" title="Derrota"></span>';
    }).join('');
  }
  function rowZoneClass(pos, total){
    // Idéntico al del script-block 12: delega en window._ligaEaZoneClass
    // (definido en misc_body_1.html) que lee las Reglas guardadas y aplica
    // el reparto configurable. Fallback a los puestos clásicos si no hay
    // helper disponible.
    if(typeof window._ligaEaZoneClass === 'function'){
      return window._ligaEaZoneClass(pos, total || 20);
    }
    if(pos >= 1 && pos <= 4) return 'zone-ucl';
    if(pos === 5) return 'zone-ucl-prev';
    if(pos === 6 || pos === 7) return 'zone-uel';
    if(pos === 8) return 'zone-conf';
    if(pos >= 17) return 'zone-desc';
    return '';
  }
  function renderSavedLigaClas(){
    var list = getSavedLigaTable();
    var el = document.getElementById('clas-liga-content');
    if(!el) return;
    // Leyenda dinámica: solo muestra los items de las zonas que el admin
    // ha configurado con > 0 plazas en el modal Reglas de la competición.
    var legendHtml = (typeof window._ligaEaLegendHtml === 'function') ? window._ligaEaLegendHtml() :
        '<div class="clas-legend">'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#3160ff"></span>🔵 Champions</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#a855f7"></span>🟣 Previa Ch.</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#ff8214"></span>🟠 E.League</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#3cc878"></span>🟢 Conference</span>'
      +   '<span class="clas-legend-item"><span class="clas-legend-dot" style="background:#e03c3c"></span>🔴 Descenso</span>'
      + '</div>';
    var html = ''
      + legendHtml
      + '<div class="clas-scroll-outer">'
      +   '<div class="clas-hdr-scroll" id="clas-hdr-scroll">'
      +     '<div class="clas-table">'
      +       '<div class="clas-hdr">'
      +         '<span class="clas-hdr-team">Equipo</span><span>PTS</span><span>PJ</span><span>V</span><span>E</span><span>P</span><span>GF</span><span>GC</span><span>DG</span><span>TA</span><span>TR</span><span>MVP</span><span>%</span>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="clas-scroll" id="clas-body-scroll">'
      +     '<div class="clas-table">';
    var _total2 = list.length;
    list.forEach(function(team, idx){
      var pos = idx + 1;
      var zone = rowZoneClass(pos, _total2);
      var dgClass = 'clas-val dg ' + (team.dg > 0 ? 'pos' : team.dg < 0 ? 'neg' : 'zer');
      // Escudo antes del nombre + emoji humano después del nombre.
      // El escudo lo resuelve getTeamBadgeHtml (ya devuelve <img class="clas-team-logo"> con onerror a fallback).
      var badgeHtml = (typeof window.getTeamBadgeHtml === 'function') ? window.getTeamBadgeHtml(team.name) : '';
      var displayName = SHORT_NAMES[team.name] || team.name;
      var humanEmoji = HUMAN_TEAMS[team.name] || '';
      var suffixHtml = humanEmoji ? '<span class="clas-team-human-suffix">'+humanEmoji+'</span>' : '';
      html += ''
        + '<div class="clas-row ' + zone + '">'
        +   '<div class="clas-team-cell">'
        +     '<span class="clas-pos-n">' + pos + '</span>'
        +     badgeHtml
        +     '<span class="clas-team-name"><span class="clas-team-name-text">' + displayName + '</span>' + suffixHtml + '</span>'
        +   '</div>'
        +   '<div class="clas-pts">' + team.pts + '</div>'
        +   '<div class="clas-pj">' + team.pj + '</div>'
        +   '<div class="clas-val">' + team.v + '</div>'
        +   '<div class="clas-val">' + team.e + '</div>'
        +   '<div class="clas-val">' + team.p + '</div>'
        +   '<div class="clas-val gf">' + team.gf + '</div>'
        +   '<div class="clas-val gc">' + team.gc + '</div>'
        +   '<div class="' + dgClass + '">' + (team.dg > 0 ? '+' : '') + team.dg + '</div>'
        +   '<div class="clas-val ta">' + team.ta + '</div>'
        +   '<div class="clas-val tr">' + team.tr + '</div>'
        +   '<div class="clas-mvp">' + team.mvp + '</div>'
        +   '<div class="clas-pct">' + (team.pj > 0 ? Math.round((team.v / team.pj) * 100) : 0) + '%</div>'
        + '</div>';
    });
    html += '    </div></div></div>';
    el.innerHTML = html;
    var hdrScroll = document.getElementById('clas-hdr-scroll');
    var bodyScroll = document.getElementById('clas-body-scroll');
    if(hdrScroll && bodyScroll){
      bodyScroll.addEventListener('scroll', function(){ hdrScroll.scrollLeft = bodyScroll.scrollLeft; });
    }
    if(typeof window.autoEvalAllTeams === 'function') setTimeout(window.autoEvalAllTeams, 50);
  }

  window.buildLigaClas = renderSavedLigaClas;
  window.collectStandings = getSavedLigaTable;

  /* Migración de eventos "Jugador A"/"Jugador B" guardados por
     simulaciones antiguas cuando SQUAD_REGISTRY estaba vacío. Si al
     rehidratar detectamos un evento con nombre placeholder tiramos
     un jugador real aleatorio de la plantilla actual del equipo y
     reescribimos el evento (también persistimos en localStorage
     vía saveResults) para que la migración sea definitiva. */
  function _migratePlaceholderName(team, playerRaw){
    var raw = String(playerRaw || '').trim();
    var isPlaceholder = (raw === 'Jugador A' || raw === 'Jugador B'
      || /^\d+\.\s*Jugador [AB]$/.test(raw));
    if (!isPlaceholder) return null;
    if (!team || typeof window.sqFromRegistry !== 'function') return null;
    try {
      var sq = window.sqFromRegistry(team) || [];
      var out = sq.filter(function(p){ return p && p[2] && p[2] !== 'P'; });
      if (!out.length) out = sq;
      if (!out.length) return null;
      var p = out[Math.floor(Math.random() * out.length)];
      if (!p) return null;
      return (p[0] ? (p[0] + '. ') : '') + String(p[1] || '');
    } catch(_){ return null; }
  }

  /* Migración 2026-05-26: eventos "Jugador A"/"Jugador B" en cfgs de
     torneos (Mundial-48, Selecciones spv-/sfn-, Verano sct/pss/jg/asia)
     al arrancar. Cuando una simulación de torneo se ejecutó SIN
     plantilla de un equipo (squad no sembrado o equipo añadido después),
     `genMatchEventsEnhanced` cae a [['','Jugador A','F',76]] y los
     eventos quedan persistidos con `player:'Jugador A'`. Reportado:
     Irán, India, Polonia en la pantalla "Goleadores" del Mundial 2032.

     Esta migración:
       (1) Escanea cada `tour_<id>_v1` en localStorage, reescribe
           `cfg.results[mk].events[].player` (y MVP, y legs[]) con un
           jugador aleatorio (hash determinista) de la plantilla ACTUAL
           del equipo, vía sqFromRegistry (que cubre ligaExt_ +
           selecciones_squad_v1).
       (2) Reescribe los stores derivados `ef_player_stats_torneos_v1`
           / `ef_player_stats_mundial_v1` / `ef_player_stats_sel_v1`:
           reemplaza la clave `<team>::jugador a` por
           `<team>::<jugadorReal>` fusionando contadores.
     Idempotente: sin placeholders no toca nada. */
  function _migrateTourPlaceholderNames(){
    if (typeof window.sqFromRegistry !== 'function') return;

    function _isPlaceholderName(raw){
      if (raw == null) return false;
      var s = String(raw).trim();
      return /^(?:\d+\.\s*)?Jugador\s+[A-K]$/i.test(s);
    }
    function _isPlaceholderNorm(playerNorm){
      return /^(?:\d+\s+)?jugador\s+[a-k]$/i.test(playerNorm);
    }
    function _normPS(s){
      return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
        .replace(/[^A-Za-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
    }
    /* Hash determinista: el mismo (team + seed) siempre devuelve el
       mismo índice → migración estable + idempotente. */
    function _hash(s){
      var h = 0, str = String(s || '');
      for (var i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h);
    }

    /* Cache por equipo: lista de jugadores OUTFIELD (no porteros). */
    var _sqCache = {};
    function _getOutfieldSq(team){
      if (!team) return null;
      var key = String(team);
      if (_sqCache[key] !== undefined) return _sqCache[key];
      var sq = [];
      try { sq = window.sqFromRegistry(team) || []; } catch(_){ sq = []; }
      var out = sq.filter(function(p){
        return Array.isArray(p) && p.length >= 2 && p[1] && p[2] !== 'P';
      });
      if (!out.length) {
        out = sq.filter(function(p){ return Array.isArray(p) && p.length >= 2 && p[1]; });
      }
      _sqCache[key] = out.length ? out : null;
      return _sqCache[key];
    }
    function _pick(team, seed){
      var out = _getOutfieldSq(team);
      if (!out) return null;
      var idx = _hash(String(team) + '|' + String(seed)) % out.length;
      return out[idx];
    }

    /* ── (1) Migrar eventos en cfgs de torneo ───────────────────── */
    var tourKeys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^tour_.+_v1$/.test(k)) tourKeys.push(k);
      }
    } catch(_){}
    tourKeys.forEach(function(storeKey){
      var cfg = null;
      try {
        var raw = localStorage.getItem(storeKey);
        if (!raw) return;
        cfg = JSON.parse(raw);
      } catch(_){ return; }
      if (!cfg || !cfg.results) return;
      var dirty = false;
      function _fixEvent(ev, idx, teamA, teamB, prefix){
        if (!ev) return;
        var ph = _isPlaceholderName(ev.player) || _isPlaceholderName(ev.name);
        if (!ph) return;
        var team = ev.realTeam
          || (ev.team === 'a' ? teamA : ev.team === 'b' ? teamB : '');
        if (!team) return;
        var seed = (prefix||'') + '|' + (ev.type||'') + '|' + (ev.min||idx)
                 + '|' + (ev.num||'') + '|' + idx;
        var p = _pick(team, seed);
        if (!p) return;
        ev.player = p[1];
        if (ev.name) ev.name = p[1];
        if (p[0]) ev.num = String(p[0]);
        dirty = true;
      }
      Object.keys(cfg.results).forEach(function(mk){
        var res = cfg.results[mk]; if (!res) return;
        var teamA = res.home || '';
        var teamB = res.away || '';
        if (Array.isArray(res.events)) {
          res.events.forEach(function(ev, idx){
            _fixEvent(ev, idx, teamA, teamB, mk);
          });
        }
        /* MVP del partido — puede caer al placeholder si el sorteo
           MVP elige al "Jugador A" sintético. */
        if (_isPlaceholderName(res.mvp)) {
          var mvpT = res.mvpTeam || '';
          if (mvpT) {
            var pmvp = _pick(mvpT, 'mvp|' + mk);
            if (pmvp) { res.mvp = pmvp[1]; dirty = true; }
          }
        }
        /* Eliminatorias a IDA+VUELTA: el global agrega `legs[]` con
           sus propios eventos. */
        if (Array.isArray(res.legs)) {
          res.legs.forEach(function(leg, li){
            if (!leg || !Array.isArray(leg.events)) return;
            var lA = leg.home || teamA;
            var lB = leg.away || teamB;
            leg.events.forEach(function(ev, idx){
              _fixEvent(ev, idx, lA, lB, mk + '|L' + li);
            });
          });
        }
      });
      if (dirty) {
        try { localStorage.setItem(storeKey, JSON.stringify(cfg)); } catch(_){}
        try {
          window._TOUR_CACHE = window._TOUR_CACHE || {};
          if (cfg.id) window._TOUR_CACHE[cfg.id] = cfg;
        } catch(_){}
      }
    });

    /* ── (2) Migrar stores ef_player_stats_*_v1 derivados ───────── */
    function _findOriginalTeamName(teamNorm){
      if (!teamNorm) return null;
      try {
        var selRaw = localStorage.getItem('selecciones_squad_v1');
        if (selRaw) {
          var sel = JSON.parse(selRaw);
          var arr = (sel && Array.isArray(sel.teams)) ? sel.teams : [];
          for (var i = 0; i < arr.length; i++) {
            var t = arr[i];
            if (t && t.name && _normPS(t.name) === teamNorm) return t.name;
          }
        }
      } catch(_){}
      try {
        for (var li = 0; li < localStorage.length; li++) {
          var lk = localStorage.key(li);
          if (!lk || lk.indexOf('ligaExt_') !== 0) continue;
          if (lk.indexOf('_backup') !== -1 || lk.indexOf('_protected') !== -1
              || lk.indexOf('_snap_') !== -1) continue;
          var rawL = localStorage.getItem(lk);
          if (!rawL) continue;
          var dL; try { dL = JSON.parse(rawL); } catch(_){ continue; }
          var ts = (dL && Array.isArray(dL.teams)) ? dL.teams : [];
          for (var ti = 0; ti < ts.length; ti++) {
            var tt = ts[ti];
            if (tt && tt.name && _normPS(tt.name) === teamNorm) return tt.name;
          }
        }
      } catch(_){}
      return null;
    }

    var STATS_KEYS = [
      'ef_player_stats_torneos_v1',
      'ef_player_stats_mundial_v1',
      'ef_player_stats_sel_v1'
    ];
    STATS_KEYS.forEach(function(statsKey){
      var raw = null;
      try { raw = localStorage.getItem(statsKey); } catch(_){}
      if (!raw) return;
      var store = null;
      try { store = JSON.parse(raw); } catch(_){}
      if (!store || typeof store !== 'object') return;
      var dirty = false;
      Object.keys(store).forEach(function(k){
        var sep = k.indexOf('::');
        if (sep < 0) return;
        var teamN = k.slice(0, sep);
        var playerN = k.slice(sep + 2);
        if (!_isPlaceholderNorm(playerN)) return;
        var origTeam = _findOriginalTeamName(teamN);
        if (!origTeam) return;
        var out = _getOutfieldSq(origTeam);
        if (!out) return;
        /* Picker estable: seed = (team + playerN) → mismo "jugador a"
           siempre va al mismo jugador real dentro del equipo. */
        var idx = _hash(origTeam + '|' + playerN) % out.length;
        var p = out[idx];
        if (!p || !p[1]) return;
        var newName = p[1];
        var newPlayerNorm = _normPS(newName);
        if (!newPlayerNorm) return;
        var newKey = teamN + '::' + newPlayerNorm;
        var src = store[k];
        var dst = store[newKey] || { gol:0, pen:0, fk:0, mvp:0, ta:0, tr:0, pj:0, penSaved:0, imbat:0 };
        dst.gol      = (dst.gol     ||0) + (src.gol     ||0);
        dst.pen      = (dst.pen     ||0) + (src.pen     ||0);
        dst.fk       = (dst.fk      ||0) + (src.fk      ||0);
        dst.mvp      = (dst.mvp     ||0) + (src.mvp     ||0);
        dst.ta       = (dst.ta      ||0) + (src.ta      ||0);
        dst.tr       = (dst.tr      ||0) + (src.tr      ||0);
        dst.imbat    = (dst.imbat   ||0) + (src.imbat   ||0);
        dst.penSaved = (dst.penSaved||0) + (src.penSaved||0);
        dst.pj       = Math.max(dst.pj||0, src.pj||0);
        store[newKey] = dst;
        delete store[k];
        dirty = true;
      });
      if (dirty) {
        try { localStorage.setItem(statsKey, JSON.stringify(store)); } catch(_){}
      }
    });
  }
  try { window._migrateTourPlaceholderNames = _migrateTourPlaceholderNames; } catch(_){}

  function hydrateStoreFromSavedResults(){
    var results = parseSavedResults();
    /* Reset PARCIAL del store: borramos solo las entradas de LIGA
       (que se reconstruyen desde ef_liga38_v4) y PRESERVAMOS las
       entradas de Copa/Recopa/SC/Champions/UEL/UECL/Superliga —
       esas no vienen de ef_liga38_v4 y se perderían si hiciéramos
       un reset total.

       Formato real de las claves (las crea registrarLigaPlayerStats):
         · Liga EA Sports → "home|away"            → 1 pipe EXACTO.
         · Comp-tagueadas → "home|away|<comp>|<mk>" → 3 pipes
           (copa, sc, ucl, uel, uecl, recopa, superliga, …).
         · Legacy / fallback por matchKey crudo     → 0 pipes.
       Una entrada de Liga es por tanto la que tiene EXACTAMENTE 1
       pipe; cualquier otra es NO-Liga y hay que conservarla.

       Bug previo (la causa de que Copa y Supercopa no se sumaran en
       "España · Estadísticas combinadas"): el filtro era
       `pk.indexOf('|') === -1`, que solo conservaba las claves de 0
       pipes. Las claves comp-tagueadas de Copa/SC tienen 3 pipes, así
       que se borraban en cada rehidratación (buildIAresults,
       simularTodasJornadasIA, rebuildLigaPlayerStatsFixed…) y el
       dashboard acababa mostrando solo Liga. Reportado 2026-05-07
       (copa_*) y 2026-05-22 (Copa + Supercopa). */
    var prevStore = window.LIGA_PLAYER_MATCH_STORE || {};
    var store = (window.LIGA_PLAYER_MATCH_STORE = {});
    Object.keys(prevStore).forEach(function(pk){
      if (!pk) return;
      var _pipes = (pk.match(/\|/g) || []).length;
      if (_pipes !== 1) store[pk] = prevStore[pk];
    });
    var _dirtyMigration = false;
    Object.keys(results).forEach(function(key){
      var meta = parseResultKey(key);
      var data = results[key] || {};
      if(!meta || !data || !Array.isArray(data.events)) return;
      var canonA = meta.home, canonB = meta.away;
      var storeKey = (canonA && canonB) ? (canonA + '|' + canonB) : key;
      /* Repair pass: sustituimos placeholders por nombres reales. */
      data.events.forEach(function(ev){
        if (!ev) return;
        var team = ev.team === 'a' ? canonA : ev.team === 'b' ? canonB : null;
        var fixed = _migratePlaceholderName(team, ev.player);
        if (fixed) { ev.player = fixed; _dirtyMigration = true; }
      });
      store[storeKey] = {
        teamA: canonA,
        teamB: canonB,
        evts: data.events.map(function(ev){
          var copy = {};
          Object.keys(ev || {}).forEach(function(k){ copy[k] = ev[k]; });
          if(!copy.realTeam){
            if(copy.team === 'a') copy.realTeam = canonA;
            else if(copy.team === 'b') copy.realTeam = canonB;
          }
          return copy;
        }),
        mvpName: data.mvp || '',
        mvpTeam: canonicalTeamName(data.mvpTeam || '')
      };
    });
    /* Persistir la migración para que no haya que rehacerla cada carga. */
    if (_dirtyMigration) {
      try { localStorage.setItem('ef_liga38_v4', JSON.stringify(results)); } catch(_){}
    }
  }
  var _origRebuildFixed = window.rebuildLigaPlayerStatsFixed;
  if(typeof _origRebuildFixed === 'function'){
    window.rebuildLigaPlayerStatsFixed = function(){
      hydrateStoreFromSavedResults();
      return _origRebuildFixed.apply(this, arguments);
    };
  }
  var _origBuildIAresults = window.buildIAresults;
  if(typeof _origBuildIAresults === 'function'){
    window.buildIAresults = function(){
      var out = _origBuildIAresults.apply(this, arguments);
      if(typeof window.buildLigaClas === 'function') window.buildLigaClas();
      if(typeof window.rebuildLigaPlayerStatsFixed === 'function') setTimeout(window.rebuildLigaPlayerStatsFixed, 0);
      return out;
    };
  }
  var _origSimAll = window.simularTodasJornadasIA;
  if(typeof _origSimAll === 'function'){
    window.simularTodasJornadasIA = function(){
      var out = _origSimAll.apply(this, arguments);
      if(typeof window.buildLigaClas === 'function') window.buildLigaClas();
      if(typeof window.rebuildLigaPlayerStatsFixed === 'function') setTimeout(window.rebuildLigaPlayerStatsFixed, 0);
      if(typeof window.buildLigaStatsDashboard === 'function') setTimeout(window.buildLigaStatsDashboard, 0);
      return out;
    };
  }
  // window.reiniciarLigaEA lo define misc_body_2.html con la versión
  // completa (pausa el poll, POST /api/state/reset-liga con reintentos,
  // verifica el server). El override antiguo de aquí se eliminó porque
  // no tocaba el server y el siguiente tick del poll repoblaba los datos.

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(function(){
      if(typeof window.buildLigaClas === 'function') window.buildLigaClas();
      if(typeof window.rebuildLigaPlayerStatsFixed === 'function') window.rebuildLigaPlayerStatsFixed();
    }, 100);
    /* Migración 2026-05-26: placeholders "Jugador A/B" en cfgs de
       torneos + stores derivados. Delay 600ms para que
       `selecciones_squad_v1._boot` + `applyEngineOverrides` hayan
       corrido (ambos en DOMContentLoaded, pero en otros IIFEs sin
       garantía de orden). Sin esto, sqFromRegistry caería de nuevo
       a placeholder y la migración no haría nada. */
    setTimeout(function(){
      try { _migrateTourPlaceholderNames(); } catch(_){}
    }, 600);
  });
})();


/* script block router */
(function(){
  var ROUTE_EXPLICIT = {
    's-home': '/',
    's-calendario': '/calendario',
    's-espana': '/espana',
    's-liga': '/espana/liga-ea-sports',
    's-liga-cal': '/espana/liga-ea-sports/calendario',
    's-liga-clas': '/espana/liga-ea-sports/clasificacion',
    's-liga-stats': '/espana/liga-ea-sports/estadisticas',
    's-segunda': '/espana/liga-hypermotion',
    's-segunda-clas': '/espana/liga-hypermotion/clasificacion',
    's-segunda-stats': '/espana/liga-hypermotion/estadisticas',
    's-primf': '/espana/primera-federacion',
    's-primf-clas': '/espana/primera-federacion/clasificacion',
    's-primf-stats': '/espana/primera-federacion/estadisticas',
    's-primf-mov': '/espana/primera-federacion/ascensos-y-descensos',
    's-copa': '/espana/copa-del-rey',
    's-copa-cuadro': '/espana/copa-del-rey/cuadro',
    's-supercopa': '/espana/supercopa',
    's-competiciones': '/competiciones',
    's-champions': '/competiciones/champions',
    's-ucl-previa': '/competiciones/champions/previa',
    's-ucl-grupos': '/competiciones/champions/grupos',
    's-ucl-playoffs': '/competiciones/champions/playoffs',
    's-uel': '/competiciones/europa-league',
    's-uel-previa': '/competiciones/europa-league/previa',
    's-uel-grupos': '/competiciones/europa-league/grupos',
    's-uel-playoffs': '/competiciones/europa-league/playoffs',
    's-uecl': '/competiciones/conference-league',
    's-uecl-previa': '/competiciones/conference-league/previa',
    's-uecl-grupos': '/competiciones/conference-league/grupos',
    's-uecl-playoffs': '/competiciones/conference-league/playoffs',
    's-usc': '/competiciones/supercopa-europa',
    's-intercontinental': '/competiciones/intercontinental',
    's-superliga': '/competiciones/superliga',
    's-superliga-cal': '/competiciones/superliga/calendario',
    's-superliga-clas': '/competiciones/superliga/clasificacion',
    's-superliga-stats': '/competiciones/superliga/estadisticas',
    's-selecciones': '/selecciones',
    's-sel-cal': '/selecciones/calendario',
    's-sel-clas': '/selecciones/clasificacion',
    's-sel-stats': '/selecciones/estadisticas',
    's-ligas': '/ligas'
  };
  var routerState = { initialized: false, screenToPath: {}, pathToScreen: {}, backTarget: {}, activeScreenId: null };
  var originalGo = typeof window.go === 'function' ? window.go : function(id){
    var prev = document.querySelector('.screen.active');
    var same = prev && prev.id === id;
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    var el = document.getElementById(id);
    if(el){ el.classList.add('active'); if(!same && !window._iaRefreshInPlace) window.scrollTo(0,0); }
  };

  function normalizePath(path){
    var clean = String(path || '/').split('?')[0].split('#')[0];
    if(!clean) clean = '/';
    clean = clean.replace(/\/+/g, '/');
    if(clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
    return clean || '/';
  }

  function slugify(value){
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' y ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'seccion';
  }

  function getScreens(){
    return Array.prototype.slice.call(document.querySelectorAll('.screen[id]'));
  }

  function detectBackTarget(screenEl){
    var btn = screenEl ? screenEl.querySelector('.back-btn[onclick*="go("]') : null;
    if(!btn) return 's-home';
    var raw = btn.getAttribute('onclick') || '';
    var match = raw.match(/go\('([^']+)'\)/);
    return match ? match[1] : 's-home';
  }

  function detectLabel(screenEl, screenId){
    if(!screenEl) return screenId.replace(/^s-/, '');
    var titleEl = screenEl.querySelector('.sec-hdr h2, .sec-hdr .sc-label, h1, h2, .ml-team-name');
    if(titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
    return screenId.replace(/^s-/, '').replace(/-/g, ' ');
  }

  function rebuildRoutes(){
    var usedPaths = {};
    routerState.screenToPath = {};
    routerState.pathToScreen = {};
    routerState.backTarget = routerState.backTarget || {};

    getScreens().forEach(function(screenEl){
      var id = screenEl.id;
      routerState.backTarget[id] = detectBackTarget(screenEl);
    });

    function uniquePath(screenId, candidate){
      var path = normalizePath(candidate);
      if(!usedPaths[path] || usedPaths[path] === screenId) return path;
      var suffix = slugify(screenId.replace(/^s-/, ''));
      var next = path === '/' ? '/' + suffix : path + '-' + suffix;
      var i = 2;
      while(usedPaths[next] && usedPaths[next] !== screenId){
        next = (path === '/' ? '/' + suffix : path + '-' + suffix) + '-' + i;
        i += 1;
      }
      return next;
    }

    function computePath(screenId, trail){
      if(routerState.screenToPath[screenId]) return routerState.screenToPath[screenId];
      if(ROUTE_EXPLICIT[screenId]){
        var explicitPath = uniquePath(screenId, ROUTE_EXPLICIT[screenId]);
        usedPaths[explicitPath] = screenId;
        routerState.screenToPath[screenId] = explicitPath;
        routerState.pathToScreen[explicitPath] = screenId;
        return explicitPath;
      }
      trail = trail || {};
      if(trail[screenId]) return '/';
      trail[screenId] = true;
      var screenEl = document.getElementById(screenId);
      var parentId = routerState.backTarget[screenId] || 's-home';
      if(parentId === screenId) parentId = 's-home';
      var base = parentId ? computePath(parentId, trail) : '/';
      var label = detectLabel(screenEl, screenId);
      var slug = slugify(label);
      var candidate = (base === '/' ? '' : base) + '/' + slug;
      var path = uniquePath(screenId, candidate);
      usedPaths[path] = screenId;
      routerState.screenToPath[screenId] = path;
      routerState.pathToScreen[path] = screenId;
      return path;
    }

    Object.keys(ROUTE_EXPLICIT).forEach(function(screenId){ computePath(screenId, {}); });
    getScreens().forEach(function(screenEl){ computePath(screenEl.id, {}); });
    routerState.initialized = true;
  }

  function resolveScreenId(path){
    rebuildRoutes();
    var normalized = normalizePath(path);
    return routerState.pathToScreen[normalized] || 's-home';
  }

  function syncHistory(screenId, replace){
    rebuildRoutes();
    var targetPath = routerState.screenToPath[screenId] || '/';
    var currentPath = normalizePath(window.location.pathname);
    var state = { screenId: screenId };
    if(replace || currentPath === targetPath){
      window.history.replaceState(state, '', targetPath);
      return;
    }
    window.history.pushState(state, '', targetPath);
  }

  function renderScreen(screenId, opts){
    opts = opts || {};
    rebuildRoutes();
    routerState.activeScreenId = screenId;
    originalGo(screenId);
    if(opts.updateHistory !== false){
      syncHistory(screenId, !!opts.replaceHistory);
    }
  }

  function navigateWithRetry(screenId, opts, retriesLeft){
    retriesLeft = typeof retriesLeft === 'number' ? retriesLeft : 8;
    if(document.getElementById(screenId)){
      renderScreen(screenId, opts);
      return;
    }
    if(retriesLeft <= 0){
      renderScreen('s-home', opts);
      return;
    }
    window.setTimeout(function(){ navigateWithRetry(screenId, opts, retriesLeft - 1); }, 80);
  }

  window.go = function(screenId, opts){
    navigateWithRetry(screenId, opts || {}, 8);
  };

  document.addEventListener('click', function(ev){
    var backBtn = ev.target.closest('.back-btn');
    if(!backBtn) return;
    var screenEl = backBtn.closest('.screen[id]');
    if(!screenEl) return;
    ev.preventDefault();
    ev.stopPropagation();
    if(typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    rebuildRoutes();
    var parentId = routerState.backTarget[screenEl.id] || 's-home';
    window.go(parentId);
  }, true);

  window.addEventListener('popstate', function(ev){
    var screenId = (ev.state && ev.state.screenId) || resolveScreenId(window.location.pathname);
    navigateWithRetry(screenId, { updateHistory: false }, 8);
  });

  function bootRouter(){
    var pathname = normalizePath(window.location.pathname);
    // Explicitly handle root path to ensure s-home is shown
    var initialScreenId = pathname === '/' ? 's-home' : resolveScreenId(pathname);
    navigateWithRetry(initialScreenId, { updateHistory: true, replaceHistory: true }, 8);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bootRouter, { once: true });
  } else {
    bootRouter();
  }
})();

/* main menu calendar ownership filter (5 equipos principales) */
(function(){
  var MAIN_CAL_TEAMS = {
    'Real Madrid': true,
    'FC Barcelona': true,
    'Bayern Munich': true,
    'Arsenal': true,
    'Atlético Madrid': true
  };

  var MAIN_CAL_ALIAS = {
    'real madrid': 'Real Madrid',
    'fc barcelona': 'FC Barcelona',
    'barcelona': 'FC Barcelona',
    'barca': 'FC Barcelona',
    'bayern munich': 'Bayern Munich',
    'fc bayern munich': 'Bayern Munich',
    'bayern': 'Bayern Munich',
    'arsenal': 'Arsenal',
    'arsenal fc': 'Arsenal',
    'atletico madrid': 'Atlético Madrid',
    'atletico': 'Atlético Madrid',
    'at. madrid': 'Atlético Madrid'
  };

  function _normTeamName(name){
    var raw = String(name || '').trim();
    var key = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return MAIN_CAL_ALIAS[key] || raw;
  }

  function _isMainCalTeam(name){
    return !!MAIN_CAL_TEAMS[_normTeamName(name)];
  }

  function _paintRow(row, isMainVsMain){
    row.style.background = isMainVsMain
      ? 'linear-gradient(90deg, rgba(84,32,120,.36), rgba(126,59,168,.36))'
      : 'linear-gradient(90deg, rgba(20,120,66,.30), rgba(41,162,93,.30))';
    row.style.borderLeft = isMainVsMain
      ? '3px solid rgba(186,113,255,.85)'
      : '3px solid rgba(106,224,141,.85)';
  }

  function applyMainMenuCalendarLogic(){
    var screen = document.getElementById('s-calendario');
    if(!screen) return;

    var blocks = screen.querySelectorAll('.jmatches');
    blocks.forEach(function(block){
      var seen = {};
      var rows = block.querySelectorAll('.mrow');

      rows.forEach(function(row){
        var homeEl = row.querySelector('.mn:not(.r)');
        var awayEl = row.querySelector('.mn.r');
        if(!homeEl || !awayEl) return;

        var home = _normTeamName(homeEl.textContent);
        var away = _normTeamName(awayEl.textContent);
        var include = _isMainCalTeam(home) || _isMainCalTeam(away);

        if(!include){
          row.style.display = 'none';
          return;
        }

        var key = [home, away].sort().join('::');
        if(seen[key]){
          row.style.display = 'none';
          return;
        }
        seen[key] = true;

        row.style.display = '';
        _paintRow(row, _isMainCalTeam(home) && _isMainCalTeam(away));
      });

      var visibleRows = Array.from(block.querySelectorAll('.mrow')).filter(function(r){
        return r.style.display !== 'none';
      });
      var oldEmpty = block.querySelector('.main-cal-empty');
      if(!visibleRows.length){
        if(!oldEmpty){
          var empty = document.createElement('div');
          empty.className = 'empty-ph main-cal-empty';
          empty.textContent = 'SIN PARTIDOS DE NUESTROS EQUIPOS';
          block.appendChild(empty);
        }
      } else if(oldEmpty){
        oldEmpty.remove();
      }
    });
  }

  window.applyMainMenuCalendarLogic = applyMainMenuCalendarLogic;

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(applyMainMenuCalendarLogic, 0);
    setTimeout(applyMainMenuCalendarLogic, 400);
  });

  var _calendarObserverTimer = null;
  function _queueMainMenuCalendarLogic(){
    if(_calendarObserverTimer) return;
    _calendarObserverTimer = window.setTimeout(function(){
      _calendarObserverTimer = null;
      applyMainMenuCalendarLogic();
    }, 120);
  }

  var _obs = new MutationObserver(function(){
    _queueMainMenuCalendarLogic();
  });

  function _attachCalendarObserver(){
    var screen = document.getElementById('s-calendario');
    if(!screen) return;
    _obs.observe(screen, {childList:true, subtree:true});
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _attachCalendarObserver, { once:true });
  } else {
    _attachCalendarObserver();
  }
})();


/* ══════════════════════════════════════════════════════════════════════
   MANUAL MAESTRO v2.0 — Sistema de Partidos eFootball
   Fases 0-4: Sincronización, Previa, Partido, Final, Post-partido
   ══════════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  /* ── 0. EXPORT esHumano GLOBAL (fallback si no está en window) ────── */
  if (typeof window.esHumano !== 'function') {
    var _mmHUMANOS = (function(){ try { var r=localStorage.getItem('ligaExt_liga-ea-sports'); if(r){var d=JSON.parse(r); if(d&&d.teams){var h=d.teams.filter(function(t){return t.isHuman}).map(function(t){return t.name}); if(h.length) return h;}} } catch(_){} return ['Real Madrid','FC Barcelona','Bayern Munich','Arsenal','Atlético Madrid']; })();
    window.esHumano = function(t) {
      var s = String(t || '').trim();
      return _mmHUMANOS.some(function(h) {
        return h.toLowerCase() === s.toLowerCase();
      });
    };
  }

  /* ── 1. TWITCH SELECTOR ─────────────────────────────────────────────
     Dropdown custom (no <select> nativo) para evitar el lag del picker
     móvil y los "clics perdidos". El <select> oculto se mantiene como
     espejo para cualquier código que consulte su .value. */
  window._ppSelectedTwitch = window._ppSelectedTwitch || '';
  var _PP_TWITCH_CHANNELS = [
    { value: '',               label: '— Selecciona canal —'        },
    { value: 'kaotiko8219',    label: '🟣 kaotiko8219 (Tu Canal)'  },
    { value: 'vk54in2',        label: '🟣 vk54in2'                 },
    { value: 'Serraxxxx',      label: '🟣 Serraxxxx'               },
    { value: 'toni_ayuso',     label: '🟣 toni_ayuso'              },
    { value: 'buddygamer1981', label: '🟣 buddygamer1981'          }
  ];

  function _ppTwitchLabelFor(val) {
    for (var i = 0; i < _PP_TWITCH_CHANNELS.length; i++) {
      if (_PP_TWITCH_CHANNELS[i].value === val) return _PP_TWITCH_CHANNELS[i].label;
    }
    return '— Selecciona canal —';
  }

  window._ppTwitchChange = function(val) {
    /* Antes esta función llamaba a `_ppRefreshUnlock()` en el mismo tick
       del evento `change`, lo que disparaba un re-render completo de la
       previa (_renderList + _updateBtn) y bloqueaba la respuesta del
       <select>. Resultado: había que hacer varios clics para que el
       navegador aceptara la selección. Ahora el valor se guarda al
       instante y el refresco se difiere al siguiente frame. */
    window._ppSelectedTwitch = val;
    var sel = document.getElementById('pp-twitch-select');
    if (sel && sel.value !== val) sel.value = val;
    var btn = document.getElementById('pp-twitch-btn');
    if (btn) {
      btn.setAttribute('data-value', val || '');
      var lbl = btn.querySelector('.pp-twitch-btn-label');
      if (lbl) lbl.textContent = _ppTwitchLabelFor(val);
    }
    var _doRefresh = function(){
      if (typeof window._ppRefreshUnlock === 'function') window._ppRefreshUnlock();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_doRefresh);
    else setTimeout(_doRefresh, 0);
  };

  window._ppOpenTwitchDropdown = function() {
    var existing = document.getElementById('pp-twitch-dropdown');
    if (existing) { existing.remove(); return; }
    var btn = document.getElementById('pp-twitch-btn');
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var currentVal = btn.getAttribute('data-value') || '';
    var dd = document.createElement('div');
    dd.id = 'pp-twitch-dropdown';
    /* Calcular espacio disponible debajo y encima del botón. El bug
       que reportó el usuario era que el dropdown se extendía por debajo
       del viewport (móvil) y, como <body> no hace scroll con la previa
       abierta, los canales finales (buddygamer1981) quedaban fuera de
       la pantalla. max-height: 60vh no ayuda porque la lista es más
       corta que 60vh y no activa el overflow interno — aun así el
       dropdown sobresalía por el fondo.

       Solución: elegir entre "desplegar debajo" o "desplegar encima"
       según dónde haya más espacio, y fijar max-height al espacio real
       disponible en esa dirección. Así el dropdown SIEMPRE cabe en
       pantalla y, si la lista no cupiera, se hace scroll interno. */
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var spaceBelow = Math.max(0, vh - rect.bottom - 12);
    var spaceAbove = Math.max(0, rect.top - 12);
    var placeAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
    var maxH = Math.max(160, placeAbove ? spaceAbove : spaceBelow);
    dd.style.cssText = 'position:fixed;z-index:2147483646;background:#10101e;'
      + 'border:1px solid rgba(191,148,255,.45);border-radius:10px;padding:6px;'
      + 'box-shadow:0 10px 32px rgba(0,0,0,.75);min-width:' + Math.round(rect.width) + 'px;'
      + 'max-width:92vw;max-height:' + maxH + 'px;overflow-y:auto;'
      + '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;';
    dd.style.left = Math.max(8, rect.left) + 'px';
    if (placeAbove) {
      dd.style.bottom = (vh - rect.top + 4) + 'px';
    } else {
      dd.style.top = (rect.bottom + 4) + 'px';
    }
    dd.innerHTML = _PP_TWITCH_CHANNELS.map(function(ch){
      var isSel = ch.value === currentVal;
      return '<button type="button" class="pp-twitch-opt" data-val="' + ch.value + '" '
        + 'style="display:block;width:100%;text-align:left;padding:10px 12px;'
        + 'background:' + (isSel ? 'rgba(191,148,255,.18)' : 'transparent') + ';'
        + 'border:none;border-radius:6px;color:#e8d8ff;font-family:Oswald,sans-serif;'
        + 'font-size:13px;letter-spacing:.5px;cursor:pointer;">' + ch.label + '</button>';
    }).join('');
    document.body.appendChild(dd);
    /* Pointer events: captura instantánea (touchstart + click) para que el
       móvil no añada los ~300 ms de tap-delay. */
    dd.querySelectorAll('.pp-twitch-opt').forEach(function(opt){
      var pick = function(e){
        e.preventDefault(); e.stopPropagation();
        var v = opt.getAttribute('data-val') || '';
        window._ppTwitchChange(v);
        dd.remove();
        document.removeEventListener('click', outsideClose, true);
      };
      opt.addEventListener('touchstart', pick, { passive: false });
      opt.addEventListener('click', pick);
      opt.addEventListener('mouseenter', function(){
        if (opt.style.background.indexOf('148') === -1) opt.style.background = 'rgba(255,255,255,.05)';
      });
      opt.addEventListener('mouseleave', function(){
        var v = opt.getAttribute('data-val') || '';
        opt.style.background = (v === currentVal) ? 'rgba(191,148,255,.18)' : 'transparent';
      });
    });
    function outsideClose(e){
      if (!dd.contains(e.target) && e.target !== btn) {
        dd.remove();
        document.removeEventListener('click', outsideClose, true);
      }
    }
    setTimeout(function(){ document.addEventListener('click', outsideClose, true); }, 50);
  };

  /* ── 2. SOUND ENGINE (Web Audio API) ─────────────────────────────── */
  var _mmAudioCtx = null;
  function _mmCtx() {
    if (!_mmAudioCtx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) { try { _mmAudioCtx = new C(); } catch(e) {} }
    }
    return _mmAudioCtx;
  }

  function _mmWhistle(long, delay) {
    setTimeout(function() {
      try {
        var ctx = _mmCtx(); if (!ctx) return;
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        var t = ctx.currentTime;
        var dur = long ? 0.85 : 0.22;
        o.type = 'square';
        o.frequency.setValueAtTime(2800, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.012);
        g.gain.setValueAtTime(0.15, t + dur - 0.04);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.start(t); o.stop(t + dur);
      } catch(e) {}
    }, delay || 0);
  }

  function _mmWhistleStart()  { _mmWhistle(true, 80); }
  function _mmWhistleFinal()  { _mmWhistle(false, 0); _mmWhistle(false, 450); _mmWhistle(true, 900); }

  function _mmNoise(dur, freq, vol, delay) {
    setTimeout(function() {
      try {
        var ctx = _mmCtx(); if (!ctx) return;
        var sr = ctx.sampleRate;
        var buf = ctx.createBuffer(1, sr * dur, sr);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) {
          var env = i < sr * 0.08 ? i / (sr * 0.08) :
                    i > sr * (dur - 0.3) ? Math.max(0, 1 - (i - sr * (dur - 0.3)) / (sr * 0.3)) : 1;
          d[i] = (Math.random() * 2 - 1) * env * vol;
        }
        var src = ctx.createBufferSource();
        src.buffer = buf;
        var flt = ctx.createBiquadFilter();
        flt.type = 'bandpass';
        flt.frequency.value = freq;
        flt.Q.value = 0.6;
        src.connect(flt); flt.connect(ctx.destination);
        src.start();
      } catch(e) {}
    }, delay || 0);
  }

  function _mmSoundGoal()   { _mmNoise(2.8, 900,  0.28, 0);   }
  function _mmSoundRoja()   { _mmNoise(2.0, 350,  0.22, 0);   }
  function _mmSoundLesion() { _mmNoise(3.5, 320,  0.10, 0);   }

  /* ── 3. EVENT FLASH OVERLAY ──────────────────────────────────────── */
  function _mmEnsureFlash() {
    if (document.getElementById('mm-event-flash')) return;
    var el = document.createElement('div');
    el.id = 'mm-event-flash';
    el.innerHTML = '<div id="mm-flash-inner"><div id="mm-flash-title"></div><div id="mm-flash-sub"></div><div id="mm-flash-team"></div></div>';
    document.body.appendChild(el);
  }

  function _mmFlash(type, teamName, playerName) {
    // Goals are handled exclusively by goal-notification-improved.js
    // The overlay is never shown for goals – only red cards use it.
    if (type === 'gol') {
      if (typeof window.goalNotificationImproved !== 'undefined') {
        // If the improved system is loaded, let it handle sound too.
        // (Sound is already triggered by the caller via window.mmShowFlash path)
      } else {
        _mmSoundGoal();
      }
      return;
    }

    _mmEnsureFlash();
    var el = document.getElementById('mm-event-flash');
    var title = document.getElementById('mm-flash-title');
    var sub   = document.getElementById('mm-flash-sub');
    var team  = document.getElementById('mm-flash-team');
    if (!el) return;

    el.className = 'mm-event-flash mm-flash-' + type + ' show';
    title.textContent = '🟥 ¡¡¡ EXPULSIÓN !!!';
    _mmSoundRoja();
    sub.textContent  = playerName || '';
    team.textContent = teamName   || '';

    clearTimeout(el._mmTimer);
    el._mmTimer = setTimeout(function() { el.classList.remove('show'); }, 5000);
  }

  window.mmShowFlash = _mmFlash;

  /* ── 4. LESIÓN EN VIVO (solo partidos humanos) ───────────────────── */
  function _mmEnsureLesionLive() {
    if (document.getElementById('mm-lesion-live')) return;
    var el = document.createElement('div');
    el.id = 'mm-lesion-live';
    el.innerHTML =
      '<div id="mm-les-shield-wrap"><div id="mm-les-shield">🛡️</div></div>'
      + '<div id="mm-les-title">¡¡¡ JUGADOR LESIONADO !!!</div>'
      + '<div id="mm-les-info"></div>'
      + '<button id="mm-les-btn" onclick="window.mmLesionConfirm()">🔄 JUGADOR SUSTITUIDO</button>';
    document.body.appendChild(el);
  }

  window.mmShowLesionLive = function(playerName, teamName, gradoNombre, gradoEmoji, partidos, logoUrl) {
    _mmEnsureLesionLive();
    _mmSoundLesion();

    var shield = document.getElementById('mm-les-shield');
    if (shield) {
      shield.innerHTML = logoUrl
        ? '<img src="' + logoUrl + '" alt="' + (teamName || '') + '" style="width:90px;height:90px;object-fit:contain;">'
        : '🛡️';
    }

    var gradoColor = gradoNombre === 'Grave' ? '#ff4444' : gradoNombre === 'Moderada' ? '#ff8c00' : '#ffd700';
    var info = document.getElementById('mm-les-info');
    if (info) {
      info.innerHTML =
        '<div class="mm-les-player">' + (playerName || '') + '</div>'
        + '<div class="mm-les-team">' + (teamName || '') + '</div>'
        + '<div class="mm-les-grado" style="color:' + gradoColor + '">' + (gradoEmoji || '🩹') + ' Lesión ' + (gradoNombre || 'Leve') + '</div>'
        + '<div class="mm-les-partidos"><span style="font-family:\'Bebas Neue\',sans-serif;font-size:42px;color:' + gradoColor + '">' + (partidos || 1) + '</span>'
        + '<span style="font-size:13px;color:rgba(255,255,255,.6);margin-left:6px">PARTIDO' + ((partidos || 1) > 1 ? 'S' : '') + ' DE BAJA</span></div>';
    }

    var el = document.getElementById('mm-lesion-live');
    if (el) el.classList.add('show');
    window.scrollTo(0, 0);
  };

  window.mmLesionConfirm = function() {
    var el = document.getElementById('mm-lesion-live');
    if (el) el.classList.remove('show');
    if (window._mmLesionCallback) { window._mmLesionCallback(); window._mmLesionCallback = null; }
  };

  /* ── 4-bis. EXPULSIÓN EN VIVO (solo equipos humanos) ──────────────
     Se dispara tras el flash "EXPULSIÓN" de _mmFlash. Sortea los
     partidos sancionados (roja directa: 2-8 pesados, doble amarilla:
     1-2 al 50%) y muestra una alerta tipo PARTE DISCIPLINARIO.
     El número se cachea en _LIVE_SANCION_DRAW para que
     calcularSancionesPartido() reuse el mismo valor al cerrar el
     partido (números consistentes entre live y post-partido). */
  function _mmEnsureSancionLive() {
    if (document.getElementById('mm-sancion-live')) return;
    var el = document.createElement('div');
    el.id = 'mm-sancion-live';
    el.innerHTML =
        '<div id="mm-sanc-card-wrap"><div id="mm-sanc-card">🟥</div></div>'
      + '<div id="mm-sanc-title">¡¡¡ JUGADOR EXPULSADO !!!</div>'
      + '<div id="mm-sanc-reason"></div>'
      + '<div id="mm-sanc-info"></div>'
      + '<div id="mm-sanc-partidos-row"><div id="mm-sanc-pn"></div><div id="mm-sanc-pl"></div></div>'
      + '<button id="mm-sanc-btn" onclick="window.mmSancionConfirm()">✓ ENTENDIDO</button>';
    document.body.appendChild(el);
  }

  window._mmTriggerSancionLive = function(type, teamName, playerName) {
    /* Sorteo replicado aquí porque sorteoRojaDirecta /
       sorteoDobleAmarilla viven en otra IIFE. Mismas distribuciones
       (2026-05-23): doble amarilla SIEMPRE 2 partidos; roja directa
       2-15 con histograma 60%·2-3 / 25%·4-6 / 10%·7-10 / 5%·11-15. */
    var partidos;
    if (type === 'd-amarilla') {
      partidos = 2;
    } else {
      var r = Math.random();
      if      (r < 0.60) partidos = 2 + Math.floor(Math.random() * 2); // 2-3
      else if (r < 0.85) partidos = 4 + Math.floor(Math.random() * 3); // 4-6
      else if (r < 0.95) partidos = 7 + Math.floor(Math.random() * 4); // 7-10
      else               partidos = 11 + Math.floor(Math.random() * 5); // 11-15
    }
    window._LIVE_SANCION_DRAW = window._LIVE_SANCION_DRAW || {};
    window._LIVE_SANCION_DRAW[playerName + '::' + teamName] = { type: type, partidos: partidos };
    if (typeof window.mmShowSancionLive === 'function') {
      window.mmShowSancionLive(playerName, teamName, type, partidos);
    }
  };

  window.mmShowSancionLive = function(playerName, teamName, type, partidos) {
    _mmEnsureSancionLive();
    var reasonEl = document.getElementById('mm-sanc-reason');
    var infoEl   = document.getElementById('mm-sanc-info');
    var pnEl     = document.getElementById('mm-sanc-pn');
    var plEl     = document.getElementById('mm-sanc-pl');
    if (reasonEl) reasonEl.textContent = (type === 'd-amarilla') ? '🟨🟨  DOBLE AMARILLA' : '🟥  ROJA DIRECTA';
    if (infoEl)   infoEl.innerHTML = '<b>' + (playerName || '') + '</b><br>' + (teamName || '');
    if (pnEl)     pnEl.textContent  = partidos;
    if (plEl)     plEl.textContent  = (partidos === 1 ? 'PARTIDO' : 'PARTIDOS') + ' DE SANCIÓN';
    var el = document.getElementById('mm-sancion-live');
    if (el) el.classList.add('show');
    window.scrollTo(0, 0);
  };

  window.mmSancionConfirm = function() {
    var el = document.getElementById('mm-sancion-live');
    if (el) el.classList.remove('show');
  };

  (function _injectSancionLiveCSS(){
    if (document.getElementById('mm-sancion-live-style')) return;
    var s = document.createElement('style');
    s.id = 'mm-sancion-live-style';
    s.textContent = [
      '#mm-sancion-live{display:none;position:fixed;inset:0;z-index:99998;background:rgba(50,0,0,0.95);align-items:center;justify-content:center;flex-direction:column;padding:24px 16px;text-align:center;}',
      '#mm-sancion-live.show{display:flex;}',
      '#mm-sanc-card-wrap{margin-bottom:14px;}',
      '#mm-sanc-card{font-size:80px;line-height:1;display:inline-block;animation:mmSancShake 0.45s ease-in-out infinite;}',
      '@keyframes mmSancShake{0%,100%{transform:rotate(-6deg) scale(1.05)}50%{transform:rotate(6deg) scale(1.10)}}',
      "#mm-sanc-title{font-family:'Bebas Neue',Oswald,sans-serif;font-size:30px;letter-spacing:3px;color:#ff4d4d;margin-bottom:14px;text-shadow:0 0 14px rgba(255,77,77,0.55);}",
      '#mm-sanc-reason{font-family:Oswald,sans-serif;font-size:15px;letter-spacing:2.5px;color:#ffd1d1;margin-bottom:14px;}',
      '#mm-sanc-info{font-family:Rajdhani,sans-serif;font-size:18px;color:#fff;line-height:1.4;margin-bottom:18px;}',
      '#mm-sanc-info b{font-family:Oswald,sans-serif;font-size:22px;font-weight:700;letter-spacing:1px;}',
      '#mm-sanc-partidos-row{margin-bottom:24px;display:flex;flex-direction:column;align-items:center;gap:2px;}',
      "#mm-sanc-pn{font-family:'Bebas Neue',sans-serif;font-size:64px;line-height:1;color:#ff4d4d;text-shadow:0 0 16px rgba(255,77,77,0.55);}",
      '#mm-sanc-pl{font-family:Oswald,sans-serif;font-size:13px;letter-spacing:3px;color:rgba(255,255,255,0.55);}',
      '#mm-sanc-btn{background:linear-gradient(90deg,#5a1a1a,#a23030,#5a1a1a);border:1px solid rgba(255,80,80,0.55);color:#fff;font-family:Oswald,sans-serif;font-size:15px;letter-spacing:2px;padding:14px 26px;border-radius:8px;cursor:pointer;transition:filter .15s;}',
      '#mm-sanc-btn:hover{filter:brightness(1.2);}'
    ].join('');
    document.head.appendChild(s);
  })();

  /* ── 5. OBSERVADOR DE ACTAS — detecta eventos en partidos humanos ── */
  var HM_KEYS = ['j1m1', 'j1m2', 'j1m3'];
  var _mmObserved = {};

  function _mmTeamName(matchKey, team) {
    var wrap = document.getElementById('mlw-' + matchKey);
    if (!wrap) return '';
    var els = wrap.querySelectorAll('.ml-team-name');
    var idx = team === 'a' ? 0 : 1;
    return els[idx] ? (els[idx].textContent || '').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim() : '';
  }

  function _mmObserveActa(mk) {
    if (_mmObserved[mk]) return;
    var listEl = document.getElementById('ml-acta-list-' + mk);
    if (!listEl) return;
    _mmObserved[mk] = true;

    var lastCount = 0;
    var obs = new MutationObserver(function() {
      var items = listEl.querySelectorAll('.ml-evt-item');
      if (items.length <= lastCount) { lastCount = items.length; return; }
      var newItems = Array.prototype.slice.call(items, lastCount);
      lastCount = items.length;

      newItems.forEach(function(item) {
        var type    = item.getAttribute('data-type') || '';
        var teamAtr = item.getAttribute('data-team') || 'a';
        var teamName = _mmTeamName(mk, teamAtr);
        var playerEl = item.querySelector('.ml-evt-name');
        var playerName = playerEl ? (playerEl.textContent || '').replace(/^\d+\.\s*/, '').trim() : '';

        var goalTypes = ['gol', 'propia', 'pen-gol', 'falta-gol'];
        var redTypes  = ['roja', 'd-amarilla'];

        if (goalTypes.indexOf(type) !== -1) {
          window.mmShowFlash('gol', teamName, playerName);
        } else if (redTypes.indexOf(type) !== -1) {
          /* 2026-05-09 — el overlay central antiguo `mm-event-flash`
             (5 s + animación CSS) NO debe dispararse: el flash visual
             ya lo gestiona `_mlShowEventFlash('EXPULSIÓN','red')` con
             su duración nueva de 2 s desde el flujo principal. Antes
             llamábamos `_mmFlash('roja', …)` directamente aquí, lo
             cual saltaba el patch de `window.mmShowFlash` y, aunque
             el CSS lo oculta, el elemento se creaba y a veces se veía
             un destello del overlay viejo "antes" del nuevo. Solo
             mantenemos la cadena de sanción al humano (independiente
             del flash). */
          if (typeof window.esHumano === 'function'
              && window.esHumano(teamName)
              && typeof window._mmTriggerSancionLive === 'function') {
            setTimeout(function(){
              window._mmTriggerSancionLive(type, teamName, playerName);
            }, 2200);
          }
        } else if (type === 'lesion') {
          var les = window.LESION_STORE && window.LESION_STORE[playerName];
          var grado  = les ? les.gradoNombre : 'Leve';
          var emoji  = les ? les.gradoEmoji  : '🩹';
          var parts  = les ? les.partidos    : 1;
          var logo   = (typeof window.getLogoEquipo === 'function') ? window.getLogoEquipo(teamName) : '';
          window.mmShowLesionLive(playerName, teamName, grado, emoji, parts, logo || '');
        }
      });
    });
    obs.observe(listEl, { childList: true, subtree: true });
  }

  /* ── 6. SILBATOS — inicio y final ────────────────────────────────── */
  function _mmPatchTimerStart(mk) {
    var fn = 'mlTimerClick_' + mk;
    var orig = window[fn];
    if (!orig || orig._mmWhistlePatched) return;
    window[fn] = function() {
      var btn = document.getElementById('ml-timer-' + mk);
      // Play start whistle only on first press (when button shows ▶ and 0')
      if (btn && !btn.getAttribute('data-mm-ever-started')) {
        var txt = btn.textContent || '';
        var isStart = txt.indexOf('▶') !== -1 && (txt.indexOf("0'") !== -1 || txt.indexOf('0 ') !== -1 || txt === '▶ 0\'');
        if (isStart) {
          btn.setAttribute('data-mm-ever-started', '1');
          _mmWhistleStart();
        }
      }
      return orig.apply(this, arguments);
    };
    window[fn]._mmWhistlePatched = true;
  }

  function _mmPatchEndMatch(mk) {
    var fn = 'mlEndMatch_' + mk;
    var orig = window[fn];
    if (!orig || orig._mmWhistlePatched) return;
    window[fn] = function() {
      _mmWhistleFinal();
      return orig.apply(this, arguments);
    };
    window[fn]._mmWhistlePatched = true;
  }

  /* ── 7. CLIMA DINÁMICO SEGÚN CALENDARIO ─────────────────────────────
     Estaciones: Verano 🌝 / Invierno 🌚 (2 únicas).
     Climas:     ☀️ Soleado / 🌧️ Lluvia / ❄️ Nieve (3 únicos).
     NO existen "Nublado", "Parcialmente nublado" ni "Calor extremo".
     El clima concreto se lee de la fila del calendario (.ag-wx) vía
     _mmGetWeatherFromCal; esta tabla solo se usa como fallback cuando
     no hay dato en calendario. */
  function _mmGetClimate(month) {
    if (month >= 5 && month <= 9) return { season: '🌝 Verano', weathers: ['☀️ Soleado'] };
    return { season: '🌚 Invierno', weathers: ['☀️ Soleado', '🌧️ Lluvia', '❄️ Nieve'] };
  }
  /* Mapea el emoji almacenado en calendario.json (.ag-wx) al label completo. */
  var _MM_WEATHER_FROM_EMOJI = {
    '☀️': '☀️ Soleado', '☀': '☀️ Soleado',
    '🌧️': '🌧️ Lluvia', '🌧': '🌧️ Lluvia',
    '❄️': '❄️ Nieve',   '❄': '❄️ Nieve'
  };
  function _mmLookupWeatherLabel(emoji) {
    var e = String(emoji || '').trim();
    return _MM_WEATHER_FROM_EMOJI[e] || null;
  }

  var MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var COMP_LABELS_MM = {
    'liga':'Liga EA Sports','copa':'Copa del Rey','copa-fin':'Copa del Rey · Final',
    'sc':'Semis Supercopa España','sc-final':'Final Supercopa España',
    'usc':'UEFA Super Cup','usc-fin':'UEFA Super Cup · Final',
    'ucl':'Champions League','ucl-fin':'Champions League · Final',
    'uel':'Europa League','uel-fin':'Europa League · Final',
    'uecl':'Conference League','uecl-fin':'Conference League · Final',
    'superliga':'Superliga','inter':'Copa Intercontinental','inter-fin':'Intercontinental · Final'
  };


  /* ── Calendar date helpers ───────────────────────────────────────── */
  var _MONTH_ABBR_ES = {Ene:1,Feb:2,Mar:3,Abr:4,May:5,Jun:6,Jul:7,Ago:8,Sep:9,Oct:10,Nov:11,Dic:12};
  /* Devuelve {date, wx} indexado por la etiqueta del evento del calendario
     (ej. "Liga — J1"). `wx` es el emoji del clima leído de `.ag-wx` (☀️/🌧/❄️)
     o null si no se encuentra. */
  function _mmAgDateMap() {
    var map = {};
    document.querySelectorAll('.ag-r').forEach(function(row) {
      var d = row.querySelector('.ag-date');
      var l = row.querySelector('.ag-lbl');
      var w = row.querySelector('.ag-wx');
      if (d && l) {
        var key = l.textContent.trim().split(' · ')[0].trim();
        map[key] = {
          date: d.textContent.trim(),
          wx:   w ? w.textContent.trim() : null
        };
      }
    });
    return map;
  }
  function _mmCalLabel(matchKey, compKey) {
    var m = String(matchKey || '').match(/^lj(\d+)m/);
    var j = m ? parseInt(m[1]) : (String(matchKey || '').match(/^j1m/) ? 1 : 0);
    if (j > 0 && (!compKey || compKey === 'liga')) return 'Liga — J' + j;
    /* Copa del Rey: el matchKey es `copa_<ronda>_<idx>_<i|v>`, así que
       resolvemos la fila EXACTA de la agenda por ronda. Antes compKey
       'copa' caía siempre a "1/128" → la fecha y el clima de la 1ª
       Ronda se mostraban en TODAS las rondas de Copa. */
    var cm = String(matchKey || '').match(/^copa_([a-z0-9]+)_\d+_([iv])$/i);
    if (cm) {
      var cr = cm[1].toLowerCase();
      var legTxt = (cm[2].toLowerCase() === 'v') ? 'Vuelta' : 'Ida';
      var COPA_RD = {
        r1:  'Copa del Rey — 1/128',
        r2:  'Copa del Rey — 1/64',
        r16: 'Copa del Rey — 1/32',
        oct: 'Copa del Rey — Octavos ' + legTxt,
        cua: 'Copa del Rey — Cuartos ' + legTxt,
        sf:  'Copa del Rey — Semis ' + legTxt,
        fin: 'FINAL COPA DEL REY'
      };
      if (COPA_RD[cr]) return COPA_RD[cr];
    }
    /* Mundial · 48 selecciones (compKey 'torneo' + cfg.format ===
       'mundial-48'): el matchKey aquí es la prePartidoKey
       `tour_<tourId>_<tourMatchKey>`, así que leemos `_ppPreviaTeams`
       (lo fija `_tourOpenHumanMatch`) para obtener la config y deducir
       la ronda. Sin esto la previa caía a hoy + "torneo" — bug
       2026-05-25 reportado por usuario con foto Marruecos vs Francia
       de la GRAN FINAL: la card del hub mostraba "31 May" pero la
       previa "25 de Mayo". */
    if (compKey === 'torneo') {
      try {
        var _ptCal = window._ppPreviaTeams || {};
        var _tcfgCal = null;
        if (_ptCal.tourId && typeof window._tourLoadCachedSync === 'function') {
          _tcfgCal = window._tourLoadCachedSync(_ptCal.tourId);
        }
        if (!_tcfgCal && _ptCal.tourId && window._TOUR_CACHE) {
          _tcfgCal = window._TOUR_CACHE[_ptCal.tourId];
        }
        if (_tcfgCal && _tcfgCal.format === 'mundial-48') {
          var _tk = String(_ptCal.tourKey || '').replace(/\|L[12]$/, '');
          var _mGrp = _tk.match(/^g\d+_(\d+)_/);
          if (_mGrp) {
            return 'Mundial Grupo — J' + (parseInt(_mGrp[1], 10) + 1);
          }
          var _mKo = _tk.match(/^ko_(\d+)_/);
          if (_mKo) {
            var _rIdx = parseInt(_mKo[1], 10);
            var _koR = (_tcfgCal.formatConfig && _tcfgCal.formatConfig.koRounds) || [];
            var _rName = _koR[_rIdx];
            /* Etiquetas exactas tal y como aparecen en `.ag-lbl` del
               calendario (calendario.json → SSR). Si añades un evento
               nuevo, debe coincidir literalmente con `event.name`. */
            var MUNDIAL_KO_LABELS = {
              'Dieciseisavos': 'Mundial - Dieciseisavos',
              'Octavos':       'Mundial Octavos',
              'Cuartos':       'Mundial Cuartos',
              'Semis':         'Mundial Semis',
              'Tercer Puesto': 'Mundial Tercer Puesto',
              'Final':         'MUNDIAL GRAN FINAL 🏆'
            };
            if (_rName && MUNDIAL_KO_LABELS[_rName]) return MUNDIAL_KO_LABELS[_rName];
          }
        }
        /* Mundialito de Clubes (tourId='mundial', icono 🌐 ag-inter):
           el calendario usa filas "Mundialito Clubes - J1/J2/J3" (fase
           de grupos) y "Mundialito Clubes - Octavos/Cuartos/Semis/FINAL"
           (KO). Por canónico CLAUDE.md el slot built-in 'mundial' es
           formato 'groups-ko' con perGroup=4 y koRounds=['Octavos',
           'Cuartos','Semis','Final']. */
        if (_ptCal.tourId === 'mundial' && _tcfgCal && _tcfgCal.format !== 'mundial-48') {
          var _fcMC = _tcfgCal.formatConfig || {};
          var _mkMC = String(_ptCal.tourKey || '').replace(/\|L[12]$/, '');
          var _mGrMC = _mkMC.match(/^g\d+_(\d+)_/);
          if (_mGrMC) {
            return 'Mundialito Clubes - J' + (parseInt(_mGrMC[1], 10) + 1);
          }
          var _mKrMC = _mkMC.match(/^ko_(\d+)_/);
          if (_mKrMC) {
            var _rIMC = parseInt(_mKrMC[1], 10);
            var _koRMC = (_fcMC.koRounds || ['Octavos','Cuartos','Semis','Final']);
            var _rNameMC = _koRMC[_rIMC] || '';
            var MUNDIALITO_KO_LABELS = {
              'Dieciseisavos': 'Mundialito Clubes - Dieciseisavos',
              'Octavos':       'Mundialito Clubes - Octavos',
              'Cuartos':       'Mundialito Clubes - Cuartos',
              'Semis':         'Mundialito Clubes - Semis',
              'Tercer Puesto': 'Mundialito Clubes - Tercer Puesto',
              'Final':         'Mundialito Clubes - FINAL'
            };
            if (MUNDIALITO_KO_LABELS[_rNameMC]) return MUNDIALITO_KO_LABELS[_rNameMC];
          }
        }
        /* Torneos de Verano (SCT/PSS/JG/Asia + slots tx1..tx8): el
           calendario usa filas "Torneo Verano - Partido N" (N=1..7)
           con icono 🌞 (clase ag-torneo). Mapeamos el matchKey del
           torneo al partido N usando el formato del cfg. Sin esta
           rama la previa caía a hoy + "torneo" — bug 2026-05-27
           reportado por usuario con foto Joan Gamper J1 mostrando
           "25 de Mayo" en vez de "04 Jun". */
        if (_ptCal.tourId !== 'mundial' && _tcfgCal && _tcfgCal.format !== 'mundial-48') {
          var _fc = _tcfgCal.formatConfig || {};
          var _mk = String(_ptCal.tourKey || '');
          var _legM = _mk.match(/\|L([12])$/);
          if (_legM) _mk = _mk.replace(/\|L[12]$/, '');
          var _pn = 0;
          var _mGr = _mk.match(/^g\d+_(\d+)_/);
          if (_mGr) {
            _pn = parseInt(_mGr[1], 10) + 1;
          } else {
            var _mKr = _mk.match(/^ko_(\d+)_/);
            if (_mKr) {
              var _rI = parseInt(_mKr[1], 10);
              if (_tcfgCal.format === 'groups-ko') {
                var _pg = _fc.perGroup || 4;
                var _grpJ = Math.max(1, _pg - 1);
                _pn = _grpJ + _rI + 1;
              } else if (_tcfgCal.format === 'ko-2leg') {
                var _rounds = _fc.rounds || [];
                var _lastIdx = _rounds.length - 1;
                var _singleLast = !!_fc.singleLegLastRound;
                var _consumed = 0;
                for (var _rr = 0; _rr < _rI; _rr++) {
                  _consumed += (_rr === _lastIdx && _singleLast) ? 1 : 2;
                }
                if (!(_rI === _lastIdx && _singleLast)) {
                  _pn = _consumed + (_legM && _legM[1] === '2' ? 2 : 1);
                } else {
                  _pn = _consumed + 1;
                }
              } else {
                _pn = _rI + 1;
              }
            } else {
              var _mLg = _mk.match(/^(\d+)_/);
              if (_mLg) _pn = parseInt(_mLg[1], 10) + 1;
            }
          }
          if (_pn > 0) return 'Torneo Verano - Partido ' + _pn;
        }
      } catch(_){}
    }
    var MAP = {
      'copa':'Copa del Rey — 1/128','copa-fin':'FINAL COPA DEL REY',
      'inter':'Intercontinental — Cuartos','inter-fin':'Intercontinental — FINAL 🏆',
      'ucl-fin':'Final Europa 🏆','uel-fin':'Final Europa 🏆',
      'usc':'Supercopa de Europa','usc-fin':'Supercopa de Europa'
    };
    return MAP[compKey] || null;
  }
  function _mmParseCalDate(s) {
    var p = String(s || '').trim().split(' ');
    return { day: parseInt(p[0]) || 0, month: _MONTH_ABBR_ES[p[1]] || 0 };
  }

  /* Fallback robusto 2026-05-27: si el label-based lookup falla para
     compKey='torneo' (cfg no cargado, perGroup distinto al esperado,
     calendario con etiquetas legacy/custom, etc.), localizamos la fila
     del calendario CONTANDO posiciones por icono. El N-ésimo 🌞
     (ag-torneo) = N-ésimo Torneo de Verano; el N-ésimo 🌐 (ag-inter)
     = N-ésimo Mundialito de Clubes. Funciona aunque las etiquetas no
     coincidan letra-a-letra con lo que devuelve `_mmCalLabel`. */
  function _mmTourFallbackEntry() {
    try {
      var _pt = window._ppPreviaTeams || {};
      if (!_pt.tourId) return null;
      var _tcfg = null;
      try {
        if (typeof window._tourLoadCachedSync === 'function') {
          _tcfg = window._tourLoadCachedSync(_pt.tourId);
        }
        if (!_tcfg && window._TOUR_CACHE) _tcfg = window._TOUR_CACHE[_pt.tourId];
      } catch(_){}
      var _mk = String(_pt.tourKey || '').replace(/\|L[12]$/, '');
      var _pn = 0;
      var _mGr = _mk.match(/^g\d+_(\d+)_/);
      if (_mGr) {
        _pn = parseInt(_mGr[1], 10) + 1;
      } else {
        var _mKr = _mk.match(/^ko_(\d+)_/);
        if (_mKr) {
          var _rI = parseInt(_mKr[1], 10);
          var _fc = (_tcfg && _tcfg.formatConfig) || {};
          if (_tcfg && _tcfg.format === 'groups-ko') {
            var _pg = _fc.perGroup || 4;
            _pn = Math.max(1, _pg - 1) + _rI + 1;
          } else if (_tcfg && _tcfg.format === 'ko') {
            _pn = _rI + 1;
          } else {
            /* Cfg ausente: asumimos groups-ko con 3 jornadas de grupo
               (perGroup=4) que es el default más común (Mundialito). */
            _pn = 3 + _rI + 1;
          }
        } else {
          var _mLg = _mk.match(/^(\d+)_/);
          if (_mLg) _pn = parseInt(_mLg[1], 10) + 1;
        }
      }
      if (_pn <= 0) return null;
      var iconForTour = (_pt.tourId === 'mundial') ? '🌐' : '🌞';
      /* Escaneamos primero #ag-content-bayern (modo Bayern/Liverpool)
         si está visible; si no, el SSR global #ag-content. Si ambos
         tienen filas, contamos solo en el activo para no duplicar. */
      var host = document.getElementById('ag-content-bayern');
      if (!host || !host.querySelector('.ag-r') || host.offsetParent === null) {
        host = document.getElementById('ag-content');
      }
      if (!host) return null;
      var rows = host.querySelectorAll('.ag-r');
      var hits = 0;
      for (var i = 0; i < rows.length; i++) {
        var icoEl = rows[i].querySelector('.ag-ico');
        if (!icoEl) continue;
        var ico = icoEl.textContent.trim();
        if (ico === iconForTour) {
          hits++;
          if (hits === _pn) {
            var dEl = rows[i].querySelector('.ag-date');
            var wEl = rows[i].querySelector('.ag-wx');
            return {
              date: dEl ? dEl.textContent.trim() : '',
              wx:   wEl ? wEl.textContent.trim() : ''
            };
          }
        }
      }
    } catch(_){}
    return null;
  }

  /* Nombre visual del torneo de verano (TOUR_NAMES de misc_body_1.html).
     No exponemos `TOUR_NAMES` en window, así que duplicamos un mapa local
     mínimo para el compLabel de la previa. */
  var _TOUR_NAMES_MM = {
    sct:   'Soccer Champions Tour',
    pss:   'Premier Summer Series',
    jg:    'Trofeo Joan Gamper',
    asia:  'Asian Tournament',
    mundial: 'Mundialito de Clubes'
  };

  /* ── Clima del calendario → venue-bar de la card del partido ──────
     _mmInjectEnv resuelve el clima del calendario global (.ag-wx) al
     abrir la previa de CUALQUIER competición. Antes la venue-bar de la
     card (`.ml-venue-weather`) hardcodeaba "☀️ Soleado" e ignoraba el
     calendario. Guardamos el clima resuelto por matchKey y lo
     aplicamos a la card; el patcher __ML_INLINE_PATCHES lo re-aplica
     tras un re-render de la card. */
  window._mmCardWeather = window._mmCardWeather || {};
  window._mmApplyCardWeather = function(matchKey, weatherLabel) {
    if (!matchKey) return;
    var w = weatherLabel || window._mmCardWeather[matchKey];
    if (!w) return;
    var vb = document.getElementById('venue-bar-' + matchKey);
    if (!vb) return;
    var el = vb.querySelector('.ml-venue-weather');
    if (!el) return;
    var parts = String(w).trim().split(' ');
    var emoji = parts[0] || '☀️';
    var name  = parts.slice(1).join(' ') || 'Soleado';
    /* La animación sunPulse (rotación) solo pega con el sol; lluvia y
       nieve usan un icono estático (clase ml-wx-ico sin animación). */
    var cls = (emoji.indexOf('☀') !== -1) ? 'ml-sun' : 'ml-wx-ico';
    var html = '<span class="' + cls + '">' + emoji + '</span> ' + name;
    if (el.innerHTML !== html) el.innerHTML = html;
  };

  function _mmInjectEnv(compKey, matchKey) {
    var envEl = document.getElementById('pp-env');
    if (!envEl) return;

    var month, dayNum, calWxEmoji = null;
    var dateMap = _mmAgDateMap();
    var label = _mmCalLabel(matchKey || '', compKey || '');
    var calEntry = label ? (dateMap[label] || null) : null;
    /* Fallback torneo 2026-05-27: cuando el lookup por label falla
       (cfg no cargado, perGroup distinto al esperado, labels custom
       del admin…) localizamos la fila del calendario por POSICIÓN
       contando iconos 🌞 (verano) / 🌐 (Mundialito). Garantía: la
       previa SIEMPRE mostrará la fecha real del calendario, no la
       fecha de hoy. */
    if (!calEntry && compKey === 'torneo') {
      calEntry = _mmTourFallbackEntry();
    }
    if (calEntry) {
      var parsed = _mmParseCalDate(calEntry.date);
      month = parsed.month || (new Date().getMonth() + 1);
      dayNum = parsed.day || new Date().getDate();
      calWxEmoji = calEntry.wx;
    } else {
      month  = new Date().getMonth() + 1;
      dayNum = new Date().getDate();
    }

    var sc = _mmGetClimate(month);
    /* Clima: fuente única = calendario (.ag-wx). Si no hay dato, cae al
       fallback por estación. NUNCA se inventa un clima aleatorio fuera de
       los 3 válidos (☀️/🌧️/❄️). */
    var weather = _mmLookupWeatherLabel(calWxEmoji);
    if (!weather) {
      weather = sc.weathers[0];  // fallback determinista: primer valor
    }
    /* Sincronizar el clima resuelto con la venue-bar de la card del
       partido humano (Liga, amistosos…) y dejarlo accesible para el
       gm-modal (Copa, Supercopa…), que abre justo después de la previa. */
    if (matchKey) {
      window._mmCardWeather[matchKey] = weather;
      window._mmApplyCardWeather(matchKey, weather);
    }
    window._mmLastWeather = weather;
    var compLabel = COMP_LABELS_MM[compKey] || compKey || 'Liga';
    /* Mundial · 48 selecciones (compKey 'torneo' + cfg.format ===
       'mundial-48'): reemplazamos el `compLabel` por la etiqueta
       descriptiva de la ronda, igual que la pantalla BAJAS (overlay
       de sanciones). Sin esto la previa mostraba "🏆 torneo" en vez
       de "🏆 Mundial 2032 · GRAN FINAL" (bug 2026-05-25). */
    if (compKey === 'torneo') {
      try {
        var _ptL = window._ppPreviaTeams || {};
        var _tcfgL = null;
        if (_ptL.tourId && typeof window._tourLoadCachedSync === 'function') {
          _tcfgL = window._tourLoadCachedSync(_ptL.tourId);
        }
        if (!_tcfgL && _ptL.tourId && window._TOUR_CACHE) {
          _tcfgL = window._TOUR_CACHE[_ptL.tourId];
        }
        if (_tcfgL && _tcfgL.format === 'mundial-48') {
          var _tkL = String(_ptL.tourKey || '').replace(/\|L[12]$/, '');
          var _mGL = _tkL.match(/^g\d+_(\d+)_/);
          var _mKL = _tkL.match(/^ko_(\d+)_/);
          if (_mGL) {
            compLabel = 'Mundial 2032 · Grupo J' + (parseInt(_mGL[1], 10) + 1);
          } else if (_mKL) {
            var _rIdxL = parseInt(_mKL[1], 10);
            var _koRL = (_tcfgL.formatConfig && _tcfgL.formatConfig.koRounds) || [];
            var _rNameL = _koRL[_rIdxL] || '';
            var _isLastL = _rNameL === 'Final';
            compLabel = _isLastL
              ? 'Mundial 2032 · GRAN FINAL 🏆'
              : ('Mundial 2032 · ' + (_rNameL || 'KO'));
          }
        } else if (_ptL.tourId) {
          /* Torneos de verano (jg/sct/pss/asia/tx*) + Mundialito Clubes
             (mundial): muestra "Trofeo Joan Gamper · Cuartos" en vez del
             literal "torneo". El nombre lo lee del cfg o del mapa
             _TOUR_NAMES_MM como fallback. 2026-05-27.

             2026-05-27 (fix bug previa Joan Gamper): antes el branch
             requería `_tcfgL` no-null para entrar. Si la cfg no estaba
             cacheada todavía (race con la hidratación), caía al label
             crudo "🏆 torneo" — foto usuario Liverpool vs Miami BP del
             Joan Gamper J5. Ahora basta con `_ptL.tourId` y usamos
             `_TOUR_NAMES_MM` como fallback síncrono. */
          var _tName = (_tcfgL && _tcfgL.name) || _TOUR_NAMES_MM[_ptL.tourId] || 'Torneo';
          var _tkV = String(_ptL.tourKey || '').replace(/\|L[12]$/, '');
          var _mGV = _tkV.match(/^g\d+_(\d+)_/);
          var _mKV = _tkV.match(/^ko_(\d+)_/);
          var _mLV = _tkV.match(/^(\d+)_(\d+)$/);  /* league format */
          if (_mGV) {
            compLabel = _tName + ' · Jornada ' + (parseInt(_mGV[1], 10) + 1);
          } else if (_mKV) {
            var _rIdxV = parseInt(_mKV[1], 10);
            var _koRV = (_tcfgL && _tcfgL.formatConfig && _tcfgL.formatConfig.koRounds) || [];
            var _rNameV = _koRV[_rIdxV] || ('KO ' + (_rIdxV + 1));
            compLabel = _tName + ' · ' + _rNameV;
          } else if (_mLV) {
            compLabel = _tName + ' · Jornada ' + (parseInt(_mLV[1], 10) + 1);
          } else {
            compLabel = _tName;
          }
        }
      } catch(_){}
    }
    /* Añadir jornada/ronda usando el mismo ROUND_MAP que la pantalla
       BAJAS. Ejemplo: "Liga EA Sports · J3" o "Copa del Rey · Octavos".
       Resuelve el blockId por `matchKey` (cal-l3 → "J3", etc.) o por
       `window._ppBlockId` como fallback. */
    var _PREVIA_ROUND_MAP = {
      'cal-l1':'J1','cal-l2':'J2','cal-l3':'J3','cal-l4':'J4',
      'cal-l5':'J5','cal-l6':'J6','cal-l7':'J7','cal-l8':'J8',
      'cal-l9':'J9','cal-l10':'J10','cal-l11':'J11','cal-l12':'J12',
      'cal-l13':'J13','cal-l14':'J14','cal-l15':'J15','cal-l16':'J16',
      'cal-l17':'J17','cal-l18':'J18','cal-l19':'J19','cal-l20':'J20',
      'cal-l21':'J21','cal-l22':'J22','cal-l23':'J23','cal-l24':'J24',
      'cal-l25':'J25','cal-l26':'J26','cal-l27':'J27','cal-l28':'J28',
      'cal-l29':'J29','cal-l30':'J30','cal-l31':'J31','cal-l32':'J32',
      'cal-l33':'J33','cal-l34':'J34','cal-l35':'J35','cal-l36':'J36',
      'cal-l37':'J37','cal-l38':'J38',
      'cal-eu1':'Grupo J1','cal-eu2':'Grupo J2','cal-eu3':'Grupo J3',
      'cal-eu4':'Grupo J4','cal-eu5':'Grupo J5','cal-eu6':'Grupo J6',
      'cal-copa-1r':'1ª Ronda','cal-copa-2r':'2ª Ronda',
      'cal-copa-16':'Dieciseisavos','cal-copa-8':'Octavos',
      'cal-copa-4':'Cuartos','cal-copa-sf':'Semis','cal-copa-fin':'Final',
      'cal-sc-s':'Semis','sc-semis':'Semis','sc-final':'Final',
      'cal-usc-s':'Semis','cal-usc-f':'Final',
      'cal-rm1':'J1','cal-rm2':'J2','cal-rm3':'J3',
      'cal-sl1':'J1','cal-sl2':'J2','cal-sl3':'J3',
      'ucl-fin':'Final','uel-fin':'Final','uecl-fin':'Final','cal-inter-f':'Final'
    };
    var _previaRound = null;
    if (matchKey && _PREVIA_ROUND_MAP[matchKey]) _previaRound = _PREVIA_ROUND_MAP[matchKey];
    else if (window._ppBlockId && _PREVIA_ROUND_MAP[window._ppBlockId]) _previaRound = _PREVIA_ROUND_MAP[window._ppBlockId];
    if (_previaRound) compLabel += ' · ' + _previaRound;
    var sParts = sc.season.split(' ');
    var sEmoji = sParts[0];
    var sName  = sParts.slice(1).join(' ');

    /* Estadio del equipo LOCAL — prioridad a _ppPreviaTeams si existe */
    var homeTeamForStadium = '';
    if (window._ppPreviaTeams && window._ppPreviaTeams.home) {
      homeTeamForStadium = window._ppPreviaTeams.home;
    } else if (matchKey) {
      var wrapEnv = document.getElementById('mlw-' + matchKey);
      if (wrapEnv) {
        var nm = wrapEnv.querySelector('.ml-team-name');
        if (nm) homeTeamForStadium = (nm.textContent || '').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
      }
    }
    var stadiumName = 'eFootball Stadium';
    /* Supercopa España (compKey 'sc'/'sc-final'): el partido es en
       campo NEUTRAL elegido por el admin en sc_state_v1.stadium —
       NO usar el local. _ppPreviaTeams.stadium lo trae rellenado.
       Sin esta rama _mmInjectEnv pisaba 60 ms después con
       getTeamStadium(local) → mostraba Camp Nou / Signal Iduna en
       vez de Maracanã (reportado por usuario 2026-05-05). */
    if ((compKey === 'sc' || compKey === 'sc-final') && window._ppPreviaTeams && window._ppPreviaTeams.stadium) {
      stadiumName = window._ppPreviaTeams.stadium;
    } else if (typeof window._selFinStadiumFor === 'function' && (function(){
      /* Mundial · 48 selecciones: 2 caminos — cal-mf-* (compKey
         'sel-fin') o partido de torneo cuyo cfg.format === 'mundial-48'.
         Petición usuario 2026-05-24. */
      if (compKey === 'sel-fin') return true;
      try {
        var pt = window._ppPreviaTeams;
        if (pt && pt.tourId && typeof window._tourLoadCachedSync === 'function') {
          var cfgM = window._tourLoadCachedSync(pt.tourId);
          if (cfgM && cfgM.format === 'mundial-48') return true;
        }
      } catch(_){}
      return false;
    })()) {
      /* Campo NEUTRAL de las 4 sedes elegidas (sel_fin_stadiums_v1).
         Rotación determinista por hash. */
      var _sfHash = (window._ppPreviaTeams && window._ppPreviaTeams.tourKey)
                    || matchKey
                    || ((window._ppPreviaTeams && window._ppPreviaTeams.home) || '') + '|' + ((window._ppPreviaTeams && window._ppPreviaTeams.away) || '');
      var _sfSt2 = window._selFinStadiumFor(_sfHash);
      if (_sfSt2) stadiumName = _sfSt2;
      else if (typeof window.getTeamStadium === 'function') {
        var s0 = window.getTeamStadium(homeTeamForStadium);
        if (s0) stadiumName = s0;
      }
    } else if (typeof window.getTeamStadium === 'function') {
      var s = window.getTeamStadium(homeTeamForStadium);
      if (s) stadiumName = s;
    }

    /* Layout en 3 líneas independientes para que estación+clima NUNCA se
       pierdan por overflow ni por wrap. Antes iban en la misma línea que
       el estadio con margin-left y ocasionalmente no aparecían. */
    envEl.innerHTML =
        '<div class="pp-env-line"><span>🏟️</span><b>' + stadiumName + '</b></div>'
      + '<div class="pp-env-line" id="pp-env-meteo">'
      +   '<span>' + sEmoji + '</span><b>' + sName + '</b>'
      +   '<span style="margin:0 6px;opacity:.4">·</span>'
      +   '<b>' + weather + '</b>'
      + '</div>'
      + '<div class="pp-env-line"><span>🗓️</span><b>' + dayNum + ' de ' + MONTHS_ES[month - 1] + '</b>'
      +   '<span style="margin:0 6px;opacity:.4">|</span><span>🏆</span><b>' + compLabel + '</b></div>';
  }

  /* Reset del canal Twitch al abrir una NUEVA previa. Se hace síncrono
     (no esperar a _mmInjectEnv) para evitar que el valor del partido
     anterior se quede "anclado" durante los ~60 ms iniciales. */
  function _mmResetTwitchSelection() {
    window._ppSelectedTwitch = '';
    var sel = document.getElementById('pp-twitch-select');
    if (sel) sel.value = '';
    var btn = document.getElementById('pp-twitch-btn');
    if (btn) {
      var lbl = btn.querySelector('.pp-twitch-btn-label');
      if (lbl) lbl.textContent = '— Selecciona canal —';
      btn.setAttribute('data-value', '');
    }
  }

  // Wrap showPrePartidoOverlay to inject climate + calendar date
  var _mmPrevShowPre = window.showPrePartidoOverlay;
  if (typeof _mmPrevShowPre === 'function') {
    window.showPrePartidoOverlay = function(matchKey, compKey, prorroga, duracion, isHvH) {
      _mmResetTwitchSelection();
      _mmPrevShowPre.apply(this, arguments);
      /* Inyectamos el env inmediatamente y además re-inyectamos al next
         frame y a 60 ms por si la fila del calendario aún no existe en
         el DOM. Cualquiera de las pasadas que encuentre datos fija el
         resultado definitivo. */
      _mmInjectEnv(compKey, matchKey);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function(){ _mmInjectEnv(compKey, matchKey); });
      }
      setTimeout(function() { _mmInjectEnv(compKey, matchKey); }, 60);
    };
  } else {
    // Retry until available
    var _mmClimateCheck = setInterval(function() {
      if (typeof window.showPrePartidoOverlay !== 'function') return;
      clearInterval(_mmClimateCheck);
      var _prev = window.showPrePartidoOverlay;
      window.showPrePartidoOverlay = function(matchKey, compKey, prorroga, duracion, isHvH) {
        _mmResetTwitchSelection();
        _prev.apply(this, arguments);
        _mmInjectEnv(compKey, matchKey);
        setTimeout(function() { _mmInjectEnv(compKey, matchKey); }, 60);
      };
    }, 200);
  }

  /* ── 8. FUEGOS ARTIFICIALES CON COLORES DEL EQUIPO GANADOR ────────── */
  var TEAM_COLORS_MM = {
    'Real Madrid':     ['#ffffff', '#c8a415', '#004d98', '#f0c040'],
    'FC Barcelona':    ['#a50044', '#004d98', '#edbb00', '#ffffff'],
    'Athletic Club':   ['#cc0000', '#ffffff', '#cc0000', '#f5f5f5'],
    'Atlético Madrid': ['#c60b1e', '#0033a0', '#c60b1e', '#ffffff'],
    'Real Betis':      ['#00954c', '#ffffff', '#f1c400', '#00954c'],
    'Real Sociedad':   ['#0067b1', '#ffffff', '#0067b1', '#e8e8e8'],
    'Sevilla FC':      ['#d71920', '#ffffff', '#d71920', '#f5f5f5'],
    'Villarreal CF':   ['#ffdd00', '#005da1', '#ffdd00', '#ffffff'],
    'Bayern Munich':   ['#dc052d', '#ffffff', '#f0c040', '#dc052d'],
    'Arsenal':         ['#db0007', '#ffffff', '#9c824a', '#db0007'],
    'Deportivo Alavés':['#1a6fa3', '#ffffff', '#1a6fa3', '#f0c040'],
    'Rayo Vallecano':  ['#ff0000', '#ffffff', '#ff0000', '#ffff00'],
  };

  var _mmMvpWinnerTeam = '';

  var _mmOrigConfirmMvp = window.confirmMvpForce;
  window.confirmMvpForce = function(btn) {
    var team = btn.getAttribute('data-team');
    var mid  = btn.getAttribute('data-mid');
    if (mid) {
      var wrap = document.getElementById('mlw-' + mid);
      if (wrap) {
        var idx = team === 'a' ? 0 : 1;
        var nameEls = wrap.querySelectorAll('.ml-team-name');
        _mmMvpWinnerTeam = nameEls[idx]
          ? (nameEls[idx].textContent || '').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim()
          : '';
      }
    }
    if (_mmOrigConfirmMvp) _mmOrigConfirmMvp.apply(this, arguments);
  };

  // Wrap lanzarFuegos to use team colors when MVP is confirmed
  var _mmOrigLanzarFuegos = (typeof lanzarFuegos === 'function') ? lanzarFuegos : null;
  if (_mmOrigLanzarFuegos) {
    // We cannot reassign a non-window function by name, but we can use window trick
    window._mmLanzarFuegosEquipo = function(duracion, teamNameOverride) {
      var teamName = teamNameOverride || _mmMvpWinnerTeam || '';
      var colors = TEAM_COLORS_MM[teamName] || ['#f0c040','#4fc86a','#ff6060','#60b0ff','#ff80ff','#ffffff','#ffaa20'];
      var _origBurst = window.fwCreateBurst || fwCreateBurst;
      // Temporarily override fwCreateBurst (it's a global function)
      var _savedBurst = fwCreateBurst;
      // Since we can't reassign `fwCreateBurst` directly (it's a named function declaration),
      // we'll add a wrapper via a flag on fwParticles array
      window._mmTeamColors = colors;
      window._mmUseTeamColors = true;
      _mmOrigLanzarFuegos(duracion || 4000);
      setTimeout(function() { window._mmUseTeamColors = false; window._mmTeamColors = null; _mmMvpWinnerTeam = ''; }, (duracion || 4000) + 500);
    };
  }

  /* Override fwCreateBurst to support team colors when _mmUseTeamColors is true */
  /* We do this by wrapping lanzarFuegos at a higher level using the celebracion-overlay */
  /* For MVP fireworks, hook into the overlay display */
  var _mmPostMvpHooked = false;
  function _mmHookMvpFireworks() {
    if (_mmPostMvpHooked) return;
    var celebEl = document.getElementById('celebracion-overlay');
    if (!celebEl) return;
    _mmPostMvpHooked = true;

    var obs = new MutationObserver(function() {
      if (celebEl.style.display === 'flex') {
        // fireworks started — restart with team colors
        var teamName = _mmMvpWinnerTeam;
        var colors = TEAM_COLORS_MM[teamName];
        if (!colors) return; // use default colors
        // Re-inject colored particles by adding bursts
        var canvas = document.getElementById('fireworks-canvas');
        if (!canvas) return;
        var ctx2 = canvas.getContext('2d');
        if (!ctx2) return;
        // Add extra burst with team colors every 250ms for 3s
        var burstCount = 0;
        var burstTimer = setInterval(function() {
          if (burstCount++ > 16 || celebEl.style.display !== 'flex') { clearInterval(burstTimer); return; }
          var w = canvas.width || window.innerWidth;
          var h = canvas.height || window.innerHeight;
          var x = 0.15 * w + Math.random() * 0.7 * w;
          var y = 0.1  * h + Math.random() * 0.5 * h;
          for (var i = 0; i < 45; i++) {
            var angle = (Math.PI * 2 / 45) * i + Math.random() * 0.3;
            var speed = 2 + Math.random() * 4;
            fwParticles.push({ x:x, y:y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, alpha:1, size:2.5+Math.random()*3, color:colors[Math.floor(Math.random()*colors.length)], decay:0.01+Math.random()*0.012 });
          }
        }, 250);
      }
    });
    obs.observe(celebEl, { attributes: true, attributeFilter: ['style'] });
  }

  /* ── 9. WHATSAPP CON CANAL TWITCH ────────────────────────────────── */
  function _mmTwitchSuffix() {
    var t = window._ppSelectedTwitch;
    return t ? ' — Visto en el Twitch de ' + t : '';
  }

  // Override gmShareWhatsApp
  var _mmOrigGmShare = window.gmShareWhatsApp;
  window.gmShareWhatsApp = function() {
    var _gm = window._gm;
    if (!_gm) { if (_mmOrigGmShare) _mmOrigGmShare.apply(this, arguments); return; }
    var mvpEvt = (_gm.events || []).find(function(e) { return e.type === 'mvp'; });
    var _mvpTeamWA = mvpEvt ? ((mvpEvt.team === 'a') ? (_gm.home || '') : (_gm.away || '')) : '';
    var mvpLabel = mvpEvt ? ' ⭐ MVP: ' + mvpEvt.name + (_mvpTeamWA ? ' (' + _mvpTeamWA + ')' : '') : '';
    var suffix = _mmTwitchSuffix();
    var msg = '¡Mira el resultado de mi partido: '
      + (_gm.home || '') + ' ' + (_gm.sc ? _gm.sc.a : 0) + ' - ' + (_gm.sc ? _gm.sc.b : 0) + ' ' + (_gm.away || '') + '!'
      + mvpLabel + suffix;
    /* Compartir SIEMPRE al grupo del juego (regla usuario 2026-05-09). */
    if (typeof window._waShareToGroup === 'function') window._waShareToGroup(msg);
    else { try { window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank'); } catch(e) {} }
  };

  // [Twitch suffix interceptor — DEPRECATED 2026-05-09]
  // Antes interceptaba el click en los botones WA y añadía el sufijo
  // "— Visto en el Twitch de X" a la URL `wa.me/?text=...`. Ahora
  // todos los share van al grupo via _waShareToGroup (definido en
  // misc_body_2.html), que copia al portapapeles. El sufijo Twitch
  // se aplica DENTRO de _waShareToGroup leyendo window._ppSelectedTwitch
  // — ya no hace falta interceptar window.open aquí.

  /* ── INIT ─────────────────────────────────────────────────────────── */
  function _mmInit() {
    _mmEnsureFlash();
    _mmEnsureLesionLive();

    HM_KEYS.forEach(function(mk) {
      _mmObserveActa(mk);
      _mmPatchTimerStart(mk);
      _mmPatchEndMatch(mk);
    });

    _mmHookMvpFireworks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _mmInit);
  } else {
    _mmInit();
  }

  // Retry patch if functions not yet defined
  setTimeout(function() {
    HM_KEYS.forEach(function(mk) {
      _mmObserveActa(mk);
      _mmPatchTimerStart(mk);
      _mmPatchEndMatch(mk);
    });
    _mmHookMvpFireworks();
  }, 800);

  console.log('[ManualMaestro v2.0] Sistema completo activado ✓');

})();

/* Fallback de 11 jugadores (A-K) con formación 4-3-3 para equipos IA
   sin plantilla creada en `ligaExt_*` / SQUAD_REGISTRY / selecciones.
   Lo usa el picker de eventos del gm-modal (_gmGetSquad) y el wizard
   del penalti (_getSquads) — antes mostraban 3 placeholders o lista
   vacía respectivamente y no se podía añadir un evento. 2026-05-24. */
window._fallbackSq11 = function(){
  return [
    {h:'🧤 PORTEROS'},
    ['1','Jugador A','P'],
    {h:'🛡 DEFENSAS'},
    ['2','Jugador B','D'],
    ['3','Jugador C','D'],
    ['4','Jugador D','D'],
    ['5','Jugador E','D'],
    {h:'⚙️ MEDIOS'},
    ['6','Jugador F','M'],
    ['7','Jugador G','M'],
    ['8','Jugador H','M'],
    {h:'⚡ DELANTEROS'},
    ['9','Jugador I','F'],
    ['10','Jugador J','F'],
    ['11','Jugador K','F']
  ];
};

/* ══ PENALTY WIZARD — flujo guiado paso a paso ══════════════════════════ */
(function(){
  var _wiz={matchId:null,attackTeam:null,defendTeam:null,provocador:null,sancion:null,infractor:null,tirador:null,resultado:null,falladoTipo:null,portero:null,stepHistory:[],minute:0};

  function _plHtml(sq,cbName){return sq.map(function(p){if(p.h)return '<div class="ml-pl-ov-sec">'+p.h+'</div>';return '<button class="ml-pl-ov-btn" onclick="'+cbName+'(\''+p[0]+'\',\''+p[1].replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\')">'+'<span class="ml-pl-ov-num">'+p[0]+'</span><span class="ml-pl-ov-name">'+p[1]+'</span></button>';}).join('');}

  /* Get squads for both teams — works with hardcoded AND dynamic match keys */
  function _getSquads(matchId) {
    var sqA = window['_sqA_'+matchId] || [];
    var sqB = window['_sqB_'+matchId] || [];
    /* Fallback: read from match state + SQUAD_REGISTRY for dynamic matches */
    if ((!sqA.length || !sqB.length) && typeof window._calMlSt === 'function') {
      var st = window._calMlSt(matchId);
      if (st && st.home && st.away && window.SQUAD_REGISTRY) {
        if (!sqA.length) sqA = window.SQUAD_REGISTRY[st.home] || [];
        if (!sqB.length) sqB = window.SQUAD_REGISTRY[st.away] || [];
      }
    }
    if (!sqA.length && typeof window._fallbackSq11 === 'function') sqA = window._fallbackSq11();
    if (!sqB.length && typeof window._fallbackSq11 === 'function') sqB = window._fallbackSq11();
    return { sqA: sqA, sqB: sqB };
  }

  /* Get team names for the wizard header */
  function _getTeams(matchId) {
    var home = '', away = '';
    if (typeof window._calMlSt === 'function') {
      var st = window._calMlSt(matchId);
      if (st) { home = st.home; away = st.away; }
    }
    if (!home || !away) {
      var wrap = document.getElementById('mlw-' + matchId);
      if (wrap) {
        var names = wrap.querySelectorAll('.ml-team-name');
        if (names[0]) home = (names[0].textContent || '').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
        if (names[1]) away = (names[1].textContent || '').replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+\s*/, '').trim();
      }
    }
    return { home: home || 'LOCAL', away: away || 'VISITANTE' };
  }

  /* Cadena robusta para resolver el escudo de un equipo (igual que _gmLogoUrl):
     1) Buscar una <img class="ml-team-svg" alt="..."> ya cargada en el DOM
        (las tarjetas del calendario usan logos base64).
     2) window.getTeamLogoUrl
     3) getLogoEquipo */
  function _wizLogoUrl(name) {
    if (!name) return '';
    try {
      var byAlt = document.querySelector('.ml-team-svg[alt="' + String(name).replace(/"/g,'&quot;') + '"]');
      if (byAlt && byAlt.src && byAlt.src.indexOf('estepona') === -1 && byAlt.src.length > 10) return byAlt.src;
    } catch(_){}
    if (typeof window.getTeamLogoUrl === 'function') {
      var u = window.getTeamLogoUrl(name);
      if (u) return u;
    }
    if (typeof getLogoEquipo === 'function') {
      var g = getLogoEquipo(name);
      if (g) return g;
    }
    return '';
  }

  function _teamCardHtml(matchId,team){
    var teams = _getTeams(matchId);
    var lA = _wizLogoUrl(teams.home);
    var lB = _wizLogoUrl(teams.away);
    var cardStyle = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:2px solid rgba(255,255,255,.15);border-radius:14px;padding:24px 12px 20px;cursor:pointer;-webkit-tap-highlight-color:transparent;font-family:Oswald,sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;color:#fff;text-align:center;';
    var _hiTcA = (typeof window.humanIcon === 'function') ? (window.humanIcon(teams.home)||'') : '';
    var _hiTcB = (typeof window.humanIcon === 'function') ? (window.humanIcon(teams.away)||'') : '';
    /* Mismo fallback que la previa: iaShieldSVG (insignia con
       iniciales) en lugar del 🛡️ emoji silver de Samsung. Tanto si lA
       sale vacío como si el <img> falla (404 / red), cae a la insignia.
       Reusamos window._ppShieldFallbackSwap (definido en la previa) para
       no embeber comillas raras en el atributo onerror. */
    function _wizShieldFb(nm){
      if (typeof window.iaShieldSVG === 'function') {
        return '<span style="display:inline-block;width:72px;height:72px;">' + window.iaShieldSVG(nm) + '</span>';
      }
      return '<span style="font-size:54px;line-height:1;">🛡️</span>';
    }
    window._ppShieldFallbackSwap = window._ppShieldFallbackSwap || function(imgEl, nm, size){
      try {
        if (typeof window.iaShieldSVG === 'function') {
          imgEl.outerHTML = '<span style="display:inline-block;width:'+size+'px;height:'+size+'px;">' + window.iaShieldSVG(nm) + '</span>';
        } else {
          imgEl.outerHTML = '<span style="font-size:54px;line-height:1;">🛡️</span>';
        }
      } catch(_){ try { imgEl.style.display = 'none'; } catch(__){} }
    };
    function _wizImg(url, nm){
      var safeNm = String(nm||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var safeJs = String(nm||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return '<img src="'+url+'" alt="'+safeNm+'" onerror="window._ppShieldFallbackSwap(this,\''+safeJs+'\',72)" style="width:72px;height:72px;object-fit:contain;"/>';
    }
    var teamCardA = '<div class="ml-tp-ov-card" onclick="window.mlPenWizTeam(\'a\')" style="'+cardStyle+'">'
      + (lA ? _wizImg(lA, teams.home) : _wizShieldFb(teams.home))
      + '<div>' + _hiTcA + teams.home.toUpperCase() + '</div></div>';
    var teamCardB = '<div class="ml-tp-ov-card" onclick="window.mlPenWizTeam(\'b\')" style="'+cardStyle+'">'
      + (lB ? _wizImg(lB, teams.away) : _wizShieldFb(teams.away))
      + '<div>' + _hiTcB + teams.away.toUpperCase() + '</div></div>';
    return teamCardA + teamCardB;
  }

  function _showStep(step){document.querySelectorAll('.ml-pwiz-step').forEach(function(el){el.classList.remove('active');});var el=document.getElementById('ml-pwiz-'+step);if(el)el.classList.add('active');var backBtn=document.getElementById('ml-pwiz-back');if(backBtn)backBtn.style.visibility=_wiz.stepHistory.length>0?'visible':'hidden';}

  function _goStep(step){var active=document.querySelector('.ml-pwiz-step.active');if(active)_wiz.stepHistory.push(active.id.replace('ml-pwiz-',''));_showStep(step);}

  function _renderAndShow(step){
    var matchId=_wiz.matchId;
    var squads = _getSquads(matchId);
    var sqA = squads.sqA;
    var sqB = squads.sqB;
    /* SEMÁNTICA NUEVA:
       _wiz.attackTeam = equipo que COMETIÓ el penalti (provocador)
       _wiz.defendTeam = equipo CONTRARIO = el que LANZA el penalti
       (Conservamos los nombres de variable por compatibilidad con commits viejos.) */
    var commitSq = _wiz.attackTeam==='a'?sqA:sqB;  /* equipo que cometió */
    var shootSq  = _wiz.attackTeam==='a'?sqB:sqA;  /* equipo contrario que lanza */
    if(step==='s2a'){
      var teamsEl=document.getElementById('ml-pwiz-teams-2a');
      if(teamsEl)teamsEl.innerHTML=_teamCardHtml(matchId);
    }else if(step==='s2b'){
      var tEl=document.getElementById('ml-pwiz-title-2b');
      if(tEl)tEl.textContent='¿Quién provocó el penalti?';
      var lEl=document.getElementById('ml-pwiz-pl-2b');
      if(lEl)lEl.innerHTML=_plHtml(commitSq,'window.mlPenWizProvocador');
    }else if(step==='s3b'){
      /* Ya no se usa: el infractor es siempre el mismo provocador. */
      var tEl3=document.getElementById('ml-pwiz-title-3b');
      var cardIcoLbl=_wiz.sancion==='amarilla'?'🟨 ':'🟥 ';
      if(tEl3)tEl3.textContent=cardIcoLbl+'¿Quién recibió la tarjeta?';
      var lEl3=document.getElementById('ml-pwiz-pl-3b');
      if(lEl3)lEl3.innerHTML=_plHtml(commitSq,'window.mlPenWizInfractor');
    }else if(step==='s4'){
      var tEl4=document.getElementById('ml-pwiz-title-4');
      if(tEl4)tEl4.textContent='¿Quién tira el penalti?';
      var lEl4=document.getElementById('ml-pwiz-pl-4');
      if(lEl4)lEl4.innerHTML=_plHtml(shootSq,'window.mlPenWizTirador');
    }else if(step==='s6b'){
      var tEl6=document.getElementById('ml-pwiz-title-6b');
      if(tEl6)tEl6.textContent='🖐 ¿Quién paró el penalti?';
      var lEl6=document.getElementById('ml-pwiz-pl-6b');
      if(lEl6)lEl6.innerHTML=_plHtml(commitSq,'window.mlPenWizPortero');
    }
    _showStep(step);
  }

  /* ── AUTO-PICK de jugador para equipos IA con alias eFootball ──
     Si el equipo de un paso del asistente (provocador / tirador /
     portero) es IA y tiene alias de eFootball, la web elige sola al
     jugador idóneo y se salta el selector manual. Las DECISIONES del
     penalti (equipo infractor, amonestación, resultado, tipo de
     fallo) las sigue tomando el humano: no son un jugador del acta.
     `teamSide` es 'a'/'b'; `evtType` lo entiende `_genAutoPickPlayer`. */
  function _wizAutoPlayer(teamSide, evtType){
    try {
      var teams = _getTeams(_wiz.matchId);
      var teamName = teamSide==='a'?teams.home:teams.away;
      if(!teamName) return null;
      var alias = (typeof window.getTeamEfootballAlias==='function')
        ? window.getTeamEfootballAlias(teamName) : '';
      if(!alias) return null;
      var comp='';
      if(typeof window._calMlSt==='function'){ var st=window._calMlSt(_wiz.matchId); if(st) comp=st.comp; }
      var isHuman = (typeof window.isHumanInComp==='function')
        ? window.isHumanInComp(teamName, comp) : false;
      if(isHuman) return null;
      var sq=(typeof window.sqFromRegistryFull==='function'&&window.sqFromRegistryFull(teamName))||[];
      if(!sq.length) sq=(typeof window.sqFromRegistry==='function'&&window.sqFromRegistry(teamName))||[];
      if(!sq.length) return null;
      var pick = (typeof window._genAutoPickPlayer==='function')
        ? window._genAutoPickPlayer(sq, evtType) : null;
      if(!pick) return null;
      return { num:String(pick[0]||''), name:String(pick[1]||'') };
    } catch(_){ return null; }
  }

  window.mlPenWizStart=function(matchId, minute){
    _wiz.matchId=matchId;_wiz.attackTeam=null;_wiz.defendTeam=null;_wiz.provocador=null;_wiz.sancion=null;_wiz.infractor=null;_wiz.tirador=null;_wiz.resultado=null;_wiz.falladoTipo=null;_wiz.portero=null;_wiz.stepHistory=[];_wiz.minute=minute||0;
    var ov=document.getElementById('ml-pen-wiz');if(ov)ov.classList.add('show');
    _renderAndShow('s2a');
  };

  window.mlPenWizBack=function(){
    if(_wiz.stepHistory.length===0)return;
    var prev=_wiz.stepHistory.pop();
    _showStep(prev);
  };

  window.mlPenWizTeam=function(team){
    _wiz.attackTeam=team;_wiz.defendTeam=team==='a'?'b':'a';
    var auto=_wizAutoPlayer(_wiz.attackTeam,'foul');
    if(auto){ window.mlPenWizProvocador(auto.num,auto.name); return; }
    _goStep('s2b');_renderAndShow('s2b');
  };

  window.mlPenWizProvocador=function(num,name){
    _wiz.provocador={num:num,name:name};
    _goStep('s3a');_renderAndShow('s3a');
  };

  window.mlPenWizSancion=function(tipo){
    _wiz.sancion=tipo;
    /* La tarjeta la recibe el MISMO jugador que cometió el penalti.
       Saltamos s3b directamente al s4 (¿quién tira?). */
    if(tipo){
      _wiz.infractor = _wiz.provocador;
    } else {
      _wiz.infractor = null;
    }
    var auto=_wizAutoPlayer(_wiz.defendTeam,'pen-gol');
    if(auto){ window.mlPenWizTirador(auto.num,auto.name); return; }
    _goStep('s4');_renderAndShow('s4');
  };

  window.mlPenWizInfractor=function(num,name){
    _wiz.infractor={num:num,name:name};
    _goStep('s4');_renderAndShow('s4');
  };

  window.mlPenWizTirador=function(num,name){
    _wiz.tirador={num:num,name:name};
    _goStep('s5');_renderAndShow('s5');
  };

  window.mlPenWizResult=function(tipo){
    _wiz.resultado=tipo;
    if(tipo==='gol'){_commit();}
    else{_goStep('s6');_renderAndShow('s6');}
  };

  window.mlPenWizFallo=function(tipo){
    _wiz.falladoTipo=tipo;
    if(tipo==='parado'){
      var auto=_wizAutoPlayer(_wiz.attackTeam,'porteria');
      if(auto){ window.mlPenWizPortero(auto.num,auto.name); return; }
      _goStep('s6b');_renderAndShow('s6b');
    }
    else{_wiz.portero=null;_commit();}
  };

  window.mlPenWizPortero=function(num,name){
    _wiz.portero={num:num,name:name};
    _commit();
  };

  window.mlPenWizCancel=function(){
    var ov=document.getElementById('ml-pen-wiz');if(ov)ov.classList.remove('show');
    _wiz.matchId=null;
  };

  function _commit(){
    var ov=document.getElementById('ml-pen-wiz');if(ov)ov.classList.remove('show');
    var fn=window['mlPenWizardCommit_'+_wiz.matchId];
    if(typeof fn==='function') {
      fn(_wiz);
    } else if (typeof window.mlPenWizardCommitGen === 'function') {
      window.mlPenWizardCommitGen(_wiz);
    }
    _wiz.matchId=null;
  }
})();
/* ════════════════════════════════════════════════════════════════════════ */

/* ── Persistencia de partido en LIVE: renombrar botón Volver ──
   En cualquier pantalla que contenga un partido activo (HvH o IA-vs-Humano)
   con el cronómetro corriendo o ya iniciado (data-prepartido-ready="1"),
   renombramos el botón ".back-btn" para indicar que el partido sigue en
   directo al volver al menú. Solo se acaba pulsando FINALIZAR o APLAZAR. */
(function(){
  function _hasActiveMatch(scope){
    if (!scope) return false;
    /* Cualquier match-live-wrap con prepartido-ready o timer running */
    var any = scope.querySelectorAll('.match-live-wrap[data-prepartido-ready="1"], .match-live-wrap .ml-timer.running');
    return any && any.length > 0;
  }
  function _refreshBackBtns(){
    var screens = document.querySelectorAll('.screen');
    screens.forEach(function(scr){
      var live = _hasActiveMatch(scr);
      var bb = scr.querySelector('.back-btn');
      if (!bb) return;
      if (live) {
        if (!bb.hasAttribute('data-orig-text')) {
          bb.setAttribute('data-orig-text', bb.textContent.trim());
        }
        bb.setAttribute('data-match-live', '1');
        bb.textContent = '☰ Menú';
        bb.title = 'El partido sigue en directo. Solo finaliza con FINALIZAR o APLAZAR.';
      } else if (bb.hasAttribute('data-orig-text')) {
        bb.removeAttribute('data-match-live');
        bb.textContent = bb.getAttribute('data-orig-text');
        bb.removeAttribute('data-orig-text');
      }
    });
  }
  /* Refrescar periódicamente y al cargar */
  window._refreshLiveBackBtns = _refreshBackBtns;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_refreshBackBtns, 600); });
  } else {
    setTimeout(_refreshBackBtns, 600);
  }
  setInterval(_refreshBackBtns, 1500);
})();
/* ════════════════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════════════
   SANCIONES + LESIONES — SELECCIONES NACIONALES (2026-05-24)

   Sistema PARALELO al de clubes. NO se cruzan: un jugador sancionado en
   su selección puede jugar con su club, y viceversa. Cada selección tiene
   su propio contador y su propia cola de sanciones, anidados por torneo
   (clasificación J1-J10 vs Mundial fase final) para que las amarillas
   de un torneo no salten al siguiente.

   Selecciones humanas (6): Francia💡, Brasil🐭, Inglaterra🔨, Noruega✏️,
   Argentina😈, España🦆.

   Reglas (distintas a clubes):
   1. Lesión "natural" del motor → 1 partido (el siguiente).
   2. ⬇️ marcado en previa → 2 partidos (este + siguiente).
   3. Doble amarilla (expulsión) → 1 partido siguiente (NO 2 como clubes).
   4. Roja directa → 2 partidos siguientes (NO 2-15 como clubes).
   5. Acumulación de amarillas → cada 2 = 1 partido (ciclo 2, NO 3).
   6. Sanciones simultáneas → solo se aplica la MAYOR (no se suman).
   7. Reset entre torneos automático (clasif vs Mundial = stores distintos).
   8. No hay amistosos de selección — no se contemplan.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){

  // ── Lista canónica de selecciones humanas ────────────────────────
  var SEL_HUMANAS = ['Francia','Brasil','Inglaterra','Noruega','Argentina','España'];

  function _normSel(s){
    return String(s||'').trim().toLowerCase()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');
  }

  function esSelHumana(name){
    if (!name) return false;
    var nn = _normSel(name);
    if (!nn) return false;
    for (var i = 0; i < SEL_HUMANAS.length; i++) {
      if (_normSel(SEL_HUMANAS[i]) === nn) return true;
    }
    /* Fallback: cualquier selección marcada como humana en el editor
       (vía `selecciones_squad_v1.teams[].icon`) cuenta también. */
    try {
      var m = window._SEL_HUMAN_ICONS || {};
      if (m[nn]) return true;
    } catch(_){}
    return false;
  }
  window._esSelHumana = esSelHumana;

  function canonSelHumana(name){
    var nn = _normSel(name);
    for (var i = 0; i < SEL_HUMANAS.length; i++) {
      if (_normSel(SEL_HUMANAS[i]) === nn) return SEL_HUMANAS[i];
    }
    return name;
  }

  /* compKey de partido de selección. Cubre J1-J10 ('sel'), Mundial fase
     final ('sel-fin') y partidos del Mundial 2032 lanzados desde el hub
     ('torneo' + format 'mundial-48'). */
  function esCompSel(compKey){
    if (compKey === 'sel' || compKey === 'sel-fin') return true;
    if (compKey === 'torneo') {
      try {
        var pt = window._ppPreviaTeams;
        var tcfg = (pt && pt.tourId && window._TOUR_CACHE)
          ? window._TOUR_CACHE[pt.tourId] : null;
        if (tcfg && tcfg.format === 'mundial-48') return true;
      } catch(_){}
    }
    return false;
  }
  window._esCompSel = esCompSel;

  /* Torneo key para anidar stores. Clasificación (J1-J10) y Mundial fase
     final son torneos distintos → los ciclos de amarillas NO se cruzan. */
  function torneoKeyFor(compKey){
    if (compKey === 'sel') return 'sel-clasif';
    if (compKey === 'sel-fin') return 'sel-mundial';
    if (compKey === 'torneo' && esCompSel(compKey)) return 'sel-mundial';
    return null;
  }
  window._selTorneoKey = torneoKeyFor;

  // ── Stores paralelos ─────────────────────────────────────────────
  /* YELLOW_STORE_SEL[torneoKey][selName][playerName] = { count: N }
     SANCION_STORE_SEL[torneoKey][selName] = [ { name, remaining, reason, tipo } ]
     LESION_STORE_SEL[selName][playerName] = { remaining, reason, timestamp }
     Lesiones NO se anidan por torneo (sobreviven entre clasif y Mundial). */
  window.YELLOW_STORE_SEL  = window.YELLOW_STORE_SEL  || {};
  window.SANCION_STORE_SEL = window.SANCION_STORE_SEL || {};
  window.LESION_STORE_SEL  = window.LESION_STORE_SEL  || {};
  window._FORMA_MATCH_STATES_SEL = window._FORMA_MATCH_STATES_SEL || {};

  // ── Persistencia en localStorage (separada de clubes) ────────────
  var LS_KEY = 'ftbol_sel_sanciones_v1';
  var _lastSer = '';
  function _persist(){
    try {
      var payload = JSON.stringify({
        yellow:  window.YELLOW_STORE_SEL,
        sancion: window.SANCION_STORE_SEL,
        lesion:  window.LESION_STORE_SEL
      });
      if (payload === _lastSer) return;
      _lastSer = payload;
      localStorage.setItem(LS_KEY, payload);
    } catch(_){}
  }
  function _load(){
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw) || {};
      window.YELLOW_STORE_SEL  = d.yellow  || {};
      window.SANCION_STORE_SEL = d.sancion || {};
      window.LESION_STORE_SEL  = d.lesion  || {};
      _lastSer = raw;
    } catch(_){}
  }
  _load();
  try {
    setInterval(_persist, 5000);
    window.addEventListener('beforeunload', _persist);
  } catch(_){}
  window._selPersistSanciones = _persist;

  // ── Helpers de stores ────────────────────────────────────────────
  function _yelGet(torneoKey, selName, playerName){
    var bucket = window.YELLOW_STORE_SEL[torneoKey] = window.YELLOW_STORE_SEL[torneoKey] || {};
    var sel = bucket[selName] = bucket[selName] || {};
    var ent = sel[playerName] = sel[playerName] || { count: 0 };
    return ent;
  }
  function _sanGetQueue(torneoKey, selName){
    var bucket = window.SANCION_STORE_SEL[torneoKey] = window.SANCION_STORE_SEL[torneoKey] || {};
    var q = bucket[selName] = bucket[selName] || [];
    return q;
  }
  function _sanFindFor(torneoKey, selName, playerName){
    var q = _sanGetQueue(torneoKey, selName);
    for (var i = 0; i < q.length; i++) {
      if (q[i].name === playerName) return q[i];
    }
    return null;
  }

  /* Solo se aplica la MAYOR si hay otra pendiente. */
  function addSancionSel(torneoKey, selName, playerName, reason, partidos, tipo){
    var n = Math.max(1, parseInt(partidos, 10) || 1);
    var q = _sanGetQueue(torneoKey, selName);
    var ex = _sanFindFor(torneoKey, selName, playerName);
    if (ex) {
      var prev = parseInt(ex.remaining, 10) || 0;
      if (n > prev) { ex.remaining = n; ex.reason = reason; ex.tipo = tipo; }
    } else {
      q.push({ name: playerName, team: selName, reason: reason, remaining: n, tipo: tipo });
    }
    _persist();
  }
  window._selAddSancion = addSancionSel;

  /* Descontar 1 partido al jugador en su selección. */
  function cumplirSancionSel(torneoKey, selName, playerName){
    var bucket = window.SANCION_STORE_SEL[torneoKey];
    if (!bucket) return false;
    var q = bucket[selName];
    if (!q || !q.length) return false;
    for (var i = q.length - 1; i >= 0; i--) {
      if (q[i].name === playerName) {
        q[i].remaining = (q[i].remaining || 1) - 1;
        if (q[i].remaining <= 0) q.splice(i, 1);
        _persist();
        return true;
      }
    }
    return false;
  }
  window._selCumplirSancion = cumplirSancionSel;

  /* Reset al finalizar torneo (manual o tras último partido). */
  window._selResetTorneo = function(torneoKey){
    if (!torneoKey) return;
    if (window.YELLOW_STORE_SEL[torneoKey])  delete window.YELLOW_STORE_SEL[torneoKey];
    if (window.SANCION_STORE_SEL[torneoKey]) delete window.SANCION_STORE_SEL[torneoKey];
    _persist();
  };

  // ── Lesiones de selección ────────────────────────────────────────
  function addLesionSel(selName, playerName, partidos, reason){
    var n = Math.max(1, parseInt(partidos, 10) || 1);
    var bucket = window.LESION_STORE_SEL[selName] = window.LESION_STORE_SEL[selName] || {};
    var prev = bucket[playerName];
    if (prev && (parseInt(prev.remaining,10) || 0) >= n) return;
    bucket[playerName] = { remaining: n, reason: reason || 'Lesión', timestamp: Date.now() };
    _persist();
  }
  window._selAddLesion = addLesionSel;

  function cumplirLesionSel(selName, playerName){
    var bucket = window.LESION_STORE_SEL[selName];
    if (!bucket || !bucket[playerName]) return false;
    bucket[playerName].remaining = (bucket[playerName].remaining || 1) - 1;
    if (bucket[playerName].remaining <= 0) delete bucket[playerName];
    _persist();
    return true;
  }
  window._selCumplirLesion = cumplirLesionSel;

  // ── Cálculo de sanciones del partido (selecciones) ───────────────
  function calcularSelMatch(events, humanTeam, teamName, compKey){
    var result = [];
    if (!events || !events.length) return result;
    var torneoKey = torneoKeyFor(compKey);
    if (!torneoKey) return result;
    var selName = canonSelHumana(teamName);
    var processed = {};

    events.forEach(function(ev){
      if (ev.team !== humanTeam) return;
      var key = ev.num + '::' + ev.name;

      if (ev.type === 'amarilla') {
        var ent = _yelGet(torneoKey, selName, ev.name);
        ent.count++;
        if (ent.count >= 2) {
          ent.count = 0;
          if (!processed[key]) {
            processed[key] = true;
            result.push({
              name: ev.name, team: selName, tipo: 'acumulacion',
              reason: '2 🟨 acumuladas (ciclo)', partidos: 1
            });
            addSancionSel(torneoKey, selName, ev.name, 'Ciclo amarillas — 1 partido', 1, 'acumulacion');
          }
        }
      } else if (ev.type === 'd-amarilla') {
        if (!processed[key]) {
          processed[key] = true;
          result.push({
            name: ev.name, team: selName, tipo: 'd-amarilla',
            reason: 'Doble amarilla — 1 partido', partidos: 1
          });
          addSancionSel(torneoKey, selName, ev.name, 'Doble amarilla — 1 partido', 1, 'd-amarilla');
        }
      } else if (ev.type === 'roja') {
        if (!processed[key]) {
          processed[key] = true;
          result.push({
            name: ev.name, team: selName, tipo: 'roja',
            reason: 'Roja directa — 2 partidos', partidos: 2
          });
          addSancionSel(torneoKey, selName, ev.name, 'Roja directa — 2 partidos', 2, 'roja');
        }
      }
    });

    _persist();
    return result;
  }
  window._selCalcularSancionesPartido = calcularSelMatch;

  // ── Hook calcularSancionesPartido: derivar a motor selección ─────
  var _origCalc = window.calcularSancionesPartido;
  window.calcularSancionesPartido = function(events, humanTeam, teamName, compKey){
    if (esCompSel(compKey) && esSelHumana(teamName)) {
      return calcularSelMatch(events, humanTeam, teamName, compKey);
    }
    return _origCalc ? _origCalc(events, humanTeam, teamName, compKey) : [];
  };

  // ── Pendientes para el overlay PRE-PARTIDO ───────────────────────
  function pendientesPara(homeTeam, awayTeam, compKey){
    var out = { sanciones: [], lesiones: [] };
    if (!esCompSel(compKey)) return out;
    var torneoKey = torneoKeyFor(compKey);
    [homeTeam, awayTeam].forEach(function(tm){
      if (!esSelHumana(tm)) return;
      var sel = canonSelHumana(tm);
      var q = torneoKey ? (window.SANCION_STORE_SEL[torneoKey] || {})[sel] : null;
      if (q && q.length) {
        q.forEach(function(s){
          out.sanciones.push({
            name: s.name, team: sel, reason: s.reason,
            partidos: s.remaining, tipo: s.tipo
          });
        });
      }
      var lb = window.LESION_STORE_SEL[sel] || {};
      Object.keys(lb).forEach(function(pn){
        var l = lb[pn];
        if (!l || (parseInt(l.remaining,10) || 0) <= 0) return;
        out.lesiones.push({
          name: pn, team: sel, reason: l.reason || 'Lesión',
          partidos: l.remaining
        });
      });
    });
    return out;
  }
  window._selPendientesPara = pendientesPara;

  // ── Consumo al confirmar overlay PRE-PARTIDO ─────────────────────
  function consumirParaPartido(homeTeam, awayTeam, compKey){
    if (!esCompSel(compKey)) return;
    var torneoKey = torneoKeyFor(compKey);
    [homeTeam, awayTeam].forEach(function(tm){
      if (!esSelHumana(tm)) return;
      var sel = canonSelHumana(tm);
      if (torneoKey) {
        var bucket = window.SANCION_STORE_SEL[torneoKey];
        var q = bucket && bucket[sel];
        if (q && q.length) {
          for (var i = q.length - 1; i >= 0; i--) {
            q[i].remaining = (q[i].remaining || 1) - 1;
            if (q[i].remaining <= 0) q.splice(i, 1);
          }
        }
      }
      var lb = window.LESION_STORE_SEL[sel];
      if (lb) {
        Object.keys(lb).forEach(function(pn){
          lb[pn].remaining = (lb[pn].remaining || 1) - 1;
          if (lb[pn].remaining <= 0) delete lb[pn];
        });
      }
    });
    _persist();
  }
  window._selConsumirParaPartido = consumirParaPartido;

  /* Hook a _sancionConfirm: decrementar también las de selección,
     idempotente por matchKey (clave 'SEL_<mk>' para no chocar con el
     flag interno de clubes). */
  var _origConfirm = window._sancionConfirm;
  window._sancionConfirm = function(){
    try {
      var mk = window._ppMatchKey || null;
      var comp = window._ppCompKey || null;
      if (mk && esCompSel(comp)) {
        window._sancionConsumedFor = window._sancionConsumedFor || {};
        if (!window._sancionConsumedFor['SEL_' + mk]) {
          window._sancionConsumedFor['SEL_' + mk] = true;
          var teams = (typeof window._ppGetCurrentMatchTeams === 'function')
            ? window._ppGetCurrentMatchTeams() : null;
          if (teams && teams.home && teams.away) {
            consumirParaPartido(teams.home, teams.away, comp);
          }
        }
      }
    } catch(_){}
    if (_origConfirm) return _origConfirm.apply(this, arguments);
  };

  // ── Hook _formaToggle: ⬇️ en selección = 2 partidos (no lesión random) ─
  var _origForma = window._formaToggle;
  window._formaToggle = function(teamName, playerName){
    var comp = window._ppCompKey || null;
    if (esCompSel(comp) && esSelHumana(teamName)) {
      var sel = canonSelHumana(teamName);
      var key = sel + '::' + playerName;
      var existing = window._FORMA_MATCH_STATES_SEL[key];
      if (existing === '⬇️') {
        delete window._FORMA_MATCH_STATES_SEL[key];
        var lb = window.LESION_STORE_SEL[sel];
        if (lb && lb[playerName]) delete lb[playerName];
        _persist();
        if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
        return;
      }
      window._FORMA_MATCH_STATES_SEL[key] = '⬇️';
      addLesionSel(sel, playerName, 2, '⬇️ Estado de forma');
      try {
        alert('🏥 ⬇️ ESTADO DE FORMA — ' + sel.toUpperCase() + '\n'
          + playerName + '\n'
          + 'Se pierde este partido y el siguiente de su selección');
      } catch(_){}
      if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
      return;
    }
    if (_origForma) return _origForma.apply(this, arguments);
  };

  // ── Render del checklist ⬇️ para selecciones humanas ─────────────
  function _selRosterFor(selName){
    var roster = [];
    try {
      if (window._selSquadHydrate) window._selSquadHydrate();
    } catch(_){}
    try {
      if (typeof window.sqFromRegistryFull === 'function') {
        roster = window.sqFromRegistryFull(selName) || [];
      }
    } catch(_){}
    if (!roster.length) {
      var sq = (window.SQUAD_REGISTRY && window.SQUAD_REGISTRY[selName]) || [];
      roster = sq.filter(function(p){ return p && !p.h && Array.isArray(p); });
    }
    /* Fallback final: leer directamente selecciones_squad_v1. */
    if (!roster.length) {
      try {
        var raw = localStorage.getItem('selecciones_squad_v1');
        if (raw) {
          var d = JSON.parse(raw) || {};
          var teams = d.teams || [];
          for (var i = 0; i < teams.length; i++) {
            if (_normSel(teams[i].name) === _normSel(selName)) {
              var pls = teams[i].players || [];
              roster = pls.map(function(p, idx){ return [p.num || (idx+1), p.nombre || p.name || '?']; });
              break;
            }
          }
        }
      } catch(_){}
    }
    return roster.filter(function(p){ return p && Array.isArray(p) && p[1]; });
  }

  var _origRenderForma = window._renderFormaChecklist;
  window._renderFormaChecklist = function(){
    var comp = window._ppCompKey || null;
    if (!esCompSel(comp)) {
      return _origRenderForma ? _origRenderForma() : '';
    }
    var teams = (typeof window._ppGetCurrentMatchTeams === 'function')
      ? window._ppGetCurrentMatchTeams() : null;
    if (!teams) return '';
    var sels = [];
    [teams.home, teams.away].forEach(function(tn){
      if (esSelHumana(tn)) sels.push(canonSelHumana(tn));
    });
    if (!sels.length) {
      return '<div style="margin-top:14px;padding:10px 12px;border:1px solid rgba(255,80,80,.25);border-radius:10px;background:rgba(255,80,80,.04);font-family:Oswald,sans-serif;font-size:11px;color:rgba(255,80,80,.85);text-align:center;letter-spacing:.5px;">🩹 Sin selecciones humanas en este partido</div>';
    }
    var html = '<div style="margin-top:16px;padding:12px;border:1px solid rgba(255,80,80,.45);border-radius:10px;background:rgba(255,80,80,.08);">'
      + '<div style="font-family:Oswald,sans-serif;font-size:13px;letter-spacing:2px;color:#ff5050;margin-bottom:8px;font-weight:700;">🩹 BAJAS POR FORMA — SELECCIÓN</div>'
      + '<div style="font-family:Oswald,sans-serif;font-size:10px;color:rgba(255,255,255,.6);margin-bottom:10px;letter-spacing:.5px;line-height:1.4;">Pulsa ⬇️ para marcar al jugador como baja por estado de forma. Se pierde ESTE partido + el SIGUIENTE de su selección.</div>';
    sels.forEach(function(sel){
      var roster = _selRosterFor(sel);
      if (!roster.length) {
        html += '<div style="font-family:Rajdhani,sans-serif;font-size:12px;color:rgba(255,255,255,.55);margin:8px 0;padding:8px;background:rgba(255,255,255,.03);border-radius:6px;">⚔️ ' + sel + ' — plantilla no cargada. Recarga la página y vuelve a abrir la previa.</div>';
        return;
      }
      html += '<div style="font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;color:#fff;margin:10px 0 6px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">⚔️ ' + sel + ' <span style="font-size:10px;color:rgba(255,255,255,.45);font-weight:400;margin-left:6px;">' + roster.length + ' jugadores</span></div>';
      html += '<div style="display:flex;flex-direction:column;gap:4px;">';
      roster.forEach(function(p){
        var name = p[1] || '?';
        var num  = p[0] || '';
        var key  = sel + '::' + name;
        var cur  = window._FORMA_MATCH_STATES_SEL[key] || '';
        var safeSel  = sel.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        var safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        html += '<label style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 8px;background:rgba(255,255,255,.04);border-radius:6px;">'
          + '<span style="font-family:Oswald,sans-serif;font-size:12px;color:#fff;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
          +   (num ? '<span style="color:rgba(255,255,255,.4);margin-right:6px;">' + num + '</span>' : '')
          +   name
          + '</span>'
          + '<span style="display:flex;gap:4px;flex-shrink:0;">'
          +   '<button type="button" onclick="window._formaToggle(\'' + safeSel + '\',\'' + safeName + '\')" '
          +     'style="background:' + (cur === '⬇️' ? 'rgba(255,80,80,.35)' : 'rgba(255,255,255,.06)') + ';border:1px solid ' + (cur === '⬇️' ? '#ff5050' : 'rgba(255,255,255,.15)') + ';color:#fff;border-radius:6px;padding:4px 10px;font-size:14px;cursor:pointer;">⬇️</button>'
          + '</span>'
          + '</label>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  };

  // ── Hook _refreshSancionInjList: en sel re-renderiza con stores SEL ─
  /* La función original reconstruye la lista de lesionados desde
     LESION_STORE (clubes) — en contexto selección eso pisa nuestra
     lista con "Sin lesionados". Si estamos en partido de selección,
     re-renderizamos con LESION_STORE_SEL + checklist ⬇️. */
  var _origRefresh = window._refreshSancionInjList;
  window._refreshSancionInjList = function(){
    var comp = window._ppCompKey || null;
    if (!esCompSel(comp)) {
      return _origRefresh ? _origRefresh.apply(this, arguments) : null;
    }
    var listInj = document.getElementById('sancion-ov-list-inj');
    if (!listInj) return;
    var teams = (typeof window._ppGetCurrentMatchTeams === 'function')
      ? window._ppGetCurrentMatchTeams() : null;
    var pend = teams ? pendientesPara(teams.home, teams.away, comp) : { sanciones: [], lesiones: [] };
    function renderCard(s, ico){
      return '<div class="sancion-card">'
        + '<div class="sancion-card-icon">' + ico + '</div>'
        + '<div class="sancion-card-info">'
        + '<div class="sancion-card-name">' + s.name + '</div>'
        + '<div class="sancion-card-team">' + s.team + '</div>'
        + '<div class="sancion-card-reason">' + s.reason + '</div>'
        + '</div>'
        + (s.partidos ? '<div class="sancion-card-partidos"><span class="sancion-card-pnum">' + s.partidos + '</span><span class="sancion-card-plbl">PARTIDO' + (s.partidos > 1 ? 'S' : '') + '</span></div>' : '')
        + '</div>';
    }
    var cardsInj = pend.lesiones.length
      ? pend.lesiones.map(function(l){ return renderCard(l, '🩹'); }).join('')
      : '<div class="sancion-empty">🚑 Sin lesionados</div>';
    listInj.innerHTML = cardsInj + (typeof window._renderFormaChecklist === 'function' ? window._renderFormaChecklist() : '');
    var warnEl = document.getElementById('sancion-ov-warn');
    if (warnEl) warnEl.style.display = 'block';
  };

  // ── Hook showSancionOverlay: render con stores de selección ──────
  /* No delegamos al original cuando es selección: el original hace
     early-return si SANCION_STORE/LESION_STORE globales están vacíos
     (siempre para selecciones), saltando el overlay y llamando a
     onConfirm() antes de que podamos renderizar las listas SEL.
     Aquí replicamos la estructura: pintar etiqueta de comp, callback,
     listas + checklist ⬇️, lógica force-share y early-return. */
  var _origShowOv = window.showSancionOverlay;
  window.showSancionOverlay = function(compKey, blockId, onConfirm){
    if (!esCompSel(compKey)) {
      return _origShowOv ? _origShowOv.apply(this, arguments) : null;
    }

    var teams = (typeof window._ppGetCurrentMatchTeams === 'function')
      ? window._ppGetCurrentMatchTeams() : null;
    var pend = teams ? pendientesPara(teams.home, teams.away, compKey) : { sanciones: [], lesiones: [] };
    var hayBajas = (pend.sanciones && pend.sanciones.length) || (pend.lesiones && pend.lesiones.length);
    var forceShow = !!window._ppForceSancionShareMode;

    var listYel = document.getElementById('sancion-ov-list-yel');
    var listRed = document.getElementById('sancion-ov-list-red');
    var listInj = document.getElementById('sancion-ov-list-inj');
    if (!listYel) {
      if (onConfirm) onConfirm();
      return;
    }

    // Etiqueta de competición + jornada
    var COMP_LBL_SEL = {
      'sel': 'Selecciones',
      'sel-fin': 'Selecciones · Mundial',
      'torneo': 'Mundial 2032'
    };
    var compLbl = document.getElementById('sancion-ov-comp-lbl');
    if (compLbl) {
      var lbl = COMP_LBL_SEL[compKey] || compKey;
      var bid = blockId || window._ppBlockId || '';
      var mJor = /cal-sel(\d+)/.exec(bid || '');
      if (mJor) lbl = 'Selecciones · J' + mJor[1];
      else if (bid === 'cal-mf-fin') lbl = 'Mundial · GRAN FINAL';
      else if (bid && bid.indexOf('cal-mf-') === 0) {
        var sub = bid.replace('cal-mf-','');
        lbl = 'Mundial · ' + sub.toUpperCase();
      }
      compLbl.textContent = lbl;
    }
    window._sancionCallback = onConfirm || null;

    function renderCard(s, ico){
      return '<div class="sancion-card">'
        + '<div class="sancion-card-icon">' + ico + '</div>'
        + '<div class="sancion-card-info">'
        + '<div class="sancion-card-name">' + s.name + '</div>'
        + '<div class="sancion-card-team">' + s.team + '</div>'
        + '<div class="sancion-card-reason">' + s.reason + '</div>'
        + '</div>'
        + (s.partidos ? '<div class="sancion-card-partidos"><span class="sancion-card-pnum">' + s.partidos + '</span><span class="sancion-card-plbl">PARTIDO' + (s.partidos > 1 ? 'S' : '') + '</span></div>' : '')
        + '</div>';
    }
    function renderEmpty(txt){ return '<div class="sancion-empty">' + txt + '</div>'; }

    var yel = pend.sanciones.filter(function(s){ return s.tipo === 'acumulacion'; });
    var red = pend.sanciones.filter(function(s){ return s.tipo === 'roja' || s.tipo === 'd-amarilla'; });

    /* Foto 4 (2026-05-27): si SANCIONADOS / EXPULSADOS están vacíos,
       ocultamos toda la sección. LESIONADOS siempre visible. */
    var secYel = listYel && listYel.parentNode;
    var secRed = listRed && listRed.parentNode;
    if (yel.length) {
      listYel.innerHTML = yel.map(function(s){ return renderCard(s,'🟨'); }).join('');
      if (secYel) secYel.style.display = '';
    } else if (secYel) {
      secYel.style.display = 'none';
    }
    if (red.length) {
      listRed.innerHTML = red.map(function(s){ return renderCard(s,'🟥'); }).join('');
      if (secRed) secRed.style.display = '';
    } else if (secRed) {
      secRed.style.display = 'none';
    }
    var cardsInj = pend.lesiones.length ? pend.lesiones.map(function(l){ return renderCard(l, '🩹'); }).join('') : renderEmpty('🚑 Sin lesionados');
    listInj.innerHTML = cardsInj + (typeof window._renderFormaChecklist === 'function' ? window._renderFormaChecklist() : '');

    if (!hayBajas && !forceShow) {
      if (onConfirm) onConfirm();
      return;
    }
    var warnEl = document.getElementById('sancion-ov-warn');
    if (warnEl) warnEl.style.display = hayBajas ? 'block' : 'none';

    // Botón share/entendido (mismo behavior que original)
    var okBtn = document.getElementById('sancion-ov-ok');
    if (okBtn) {
      if (forceShow) {
        okBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" style="vertical-align:middle;margin-right:8px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.554 4.122 1.528 5.855L0 24l6.336-1.508A11.948 11.948 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.014-1.374l-.36-.214-3.727.977.995-3.634-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>Compartir Partido en WhatsApp';
        okBtn.setAttribute('data-share-mode','1');
      } else {
        okBtn.textContent = '✓ ENTENDIDO';
        okBtn.removeAttribute('data-share-mode');
      }
    }

    var ov = document.getElementById('sancion-overlay');
    if (ov) ov.classList.add('show');
    window.scrollTo(0, 0);
  };

  // ── Lesiones del acta: redirigir a LESION_STORE_SEL si es selección ─
  var _origReg = window._registrarLesionesDesdeEventos;
  window._registrarLesionesDesdeEventos = function(events, homeName, awayName){
    if (!Array.isArray(events)) {
      return _origReg ? _origReg.apply(this, arguments) : null;
    }
    var homeIsSel = esSelHumana(homeName);
    var awayIsSel = esSelHumana(awayName);
    if (!homeIsSel && !awayIsSel) {
      return _origReg ? _origReg.apply(this, arguments) : null;
    }
    /* Particionamos: eventos de lesión de selección humana → store SEL
       (1 partido). El resto → motor original. */
    var rest = [];
    events.forEach(function(ev){
      if (!ev || ev.type !== 'lesion') { rest.push(ev); return; }
      var isHome = ev.team === 'a';
      var isAway = ev.team === 'b';
      var tmName = isHome ? homeName : (isAway ? awayName : '');
      var isSel = (isHome && homeIsSel) || (isAway && awayIsSel);
      if (!isSel) { rest.push(ev); return; }
      var playerName = '';
      if (Array.isArray(ev.player)) playerName = ev.player[1] || ev.player[0] || '';
      else if (typeof ev.player === 'string') playerName = ev.player;
      else playerName = ev.name || '';
      playerName = String(playerName || '').replace(/^\s*\d+\s*[\.\-]?\s*/, '').trim();
      if (!playerName || playerName === '?') return;
      var sel = canonSelHumana(tmName);
      addLesionSel(sel, playerName, 1, 'Lesión en partido');
    });
    if (rest.length && _origReg) _origReg(rest, homeName, awayName);
  };

})();
/* ════════════════════════════════════════════════════════════════════════ */
