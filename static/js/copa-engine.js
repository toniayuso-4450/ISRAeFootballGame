/* ================================================================
   COPA DEL REY ENGINE v2.0
   - Secciones desplegables en Copa y Calendario
   - Simulación IA coherente con Liga + prórroga/penaltis
   - Registro cruzado de stats/bajas en fichas de jugador
   ================================================================ */
(function () {
  /* 5 equipos humanos (los 5 del usuario, todos en Liga EA Sports).
     Real Madrid 🔨 / FC Barcelona 👿 / Atlético Madrid ✏️ / Arsenal 🐭
     / Liverpool 💡. Estos 5 SIEMPRE juegan la 1ª Ronda de Copa.
     El Liverpool sustituyó al Bayern como 5º humano de la Liga EA.
     Es un VALOR POR DEFECTO: `_refreshHumanTeams()` lo sincroniza con
     la lista real de Liga EA Sports antes de cada sorteo/render. */
  var HUMAN_TEAMS = ['Real Madrid', 'FC Barcelona', 'Atlético Madrid', 'Arsenal', 'Liverpool'];

  /* Sincroniza HUMAN_TEAMS con los equipos `isHuman` reales del editor
     de Liga EA Sports (`ligaExt_liga-ea-sports`). Imprescindible: si el
     admin renombró un humano (p.ej. Bayern Munich → Liverpool), la
     fuente de verdad es el flag `isHuman` del storage — igual que
     `esHumano()`. Sin esto la Copa seguía usando el nombre viejo
     hardcodeado, marcaba al equipo renombrado como IA y metía un
     equipo FANTASMA con el nombre antiguo. Solo refresca si encuentra
     humanos; si el storage está vacío conserva los canónicos. */
  function _refreshHumanTeams() {
    try {
      var d = (typeof window.loadData === 'function')
        ? window.loadData('liga-ea-sports') : null;
      if (!d || !Array.isArray(d.teams)) return;
      var humans = [];
      d.teams.forEach(function (t) {
        if (t && t.isHuman && t.name) humans.push(String(t.name).trim());
      });
      if (humans.length) {
        HUMAN_TEAMS.length = 0;
        humans.forEach(function (n) { HUMAN_TEAMS.push(n); });
      }
    } catch (_) {}
  }
  var ROUND_LABEL = {
    r1: '1ª Ronda',
    r2: '2ª Ronda',
    r16: 'Dieciseisavos',
    oct: 'Octavos',
    cua: 'Cuartos',
    sf:  'Semis',
    fin: 'Final'
  };
  /* Single-leg: 1ª Ronda, 2ª Ronda, Dieciseisavos y Final. Ida+vuelta:
     Octavos, Cuartos, Semis. Petición usuario 2026-05-05: r16 baja a
     single-leg para acortar la fase preliminar — los humanos siguen
     viajando como visitantes contra rivales de Primera Federación
     (o Hypermotion en su defecto). La final es a partido único en
     estadio neutro. Humanos vs humanos solo desde Cuartos. */
  var TWO_LEG = { oct: true, cua: true, sf: true };
  var ROUNDS = ['r1', 'r2', 'r16', 'oct', 'cua', 'sf', 'fin'];
  var NEXT_ROUND = { r1: 'r2', r2: 'r16', r16: 'oct', oct: 'cua', cua: 'sf', sf: 'fin' };
  var CAL_IDS = {
    r1: 'cal-copa-1r',
    r2: 'cal-copa-2r',
    r16: 'cal-copa-16',
    oct_ida: 'cal-copa-8i',
    oct_vta: 'cal-copa-8v',
    cua_ida: 'cal-copa-4i',
    cua_vta: 'cal-copa-4v',
    sf_ida:  'cal-copa-2i',
    sf_vta:  'cal-copa-2v',
    fin: 'cal-copa-fin'
  };
  /* Slugs de las 3 ligas españolas que componen la Copa del Rey. El total
     son 82 equipos (20 + 22 + 40). De ellos, 36 juegan 1ª Ronda
     (5 humanos + 31 al azar de Primera Federación) y los otros 46 entran
     directos a 2ª Ronda. */
  var COPA_LEAGUE_SLUGS = ['liga-ea-sports', 'liga-hypermotion', 'liga-primera-federacion'];
  var PLAYER_STORE_KEY = 'copa';
  var _copa = {};
  var _simTimers = {};
  var _appliedMeta = {};

  function canonicalTeam(name) {
    if (typeof window.TEAM_ALIASES !== 'undefined') {
      var key = String(name || '').trim().toLowerCase();
      return window.TEAM_ALIASES[key] || String(name || '').trim();
    }
    return String(name || '').trim();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isHuman(a, b) {
    return HUMAN_TEAMS.indexOf(canonicalTeam(a)) !== -1 || HUMAN_TEAMS.indexOf(canonicalTeam(b)) !== -1;
  }

  /* ════════════════════════════════════════════════════════════════
     RECOLECCIÓN DE LOS 82 EQUIPOS DE LA COPA DEL REY
     Lee los 3 storages (`ligaExt_liga-ea-sports`, `…hypermotion`,
     `…primera-federacion`) y devuelve [{name, league, power, isHuman}].
     Si una liga no tiene equipos creados todavía, usa fallback estático
     (TEAM_RATINGS / LIGA_EA_TEAMS_DEFAULT) para no dejar huecos.
     ════════════════════════════════════════════════════════════════ */
  function _readLigaTeams(slug) {
    if (typeof window.loadData === 'function') {
      var d = window.loadData(slug);
      if (d && Array.isArray(d.teams) && d.teams.length) {
        return d.teams.map(function (t) {
          return {
            name: String(t && t.name || '').trim(),
            league: slug,
            power: Math.max(1, Math.min(99, Number(t && t.power) || 75)),
            isHuman: HUMAN_TEAMS.indexOf(String(t && t.name || '').trim()) !== -1
          };
        }).filter(function (t) { return t.name; });
      }
    }
    return [];
  }

  /* Fallback: si el storage de una liga está vacío, usamos los nombres
     hardcoded del bundle (DEFAULT_SEGUNDA_TEAMS, DEFAULT_PRIMERA_G1/G2)
     y para Liga EA Sports tiramos de TEAM_RATINGS. Power por defecto:
     entry.media (Hyp/PF) o el rating numérico (Liga EA). */
  function _ligaEaFallback() {
    var ratings = window.TEAM_RATINGS || {};
    var humanos = HUMAN_TEAMS.slice();
    /* Lista canónica de los 20 Liga EA. Usamos los nombres tal cual
       aparecen en LIGA_EA_TEAMS_DEFAULT (app.py). */
    var EA20 = [
      'Real Madrid','Athletic Club','Real Sociedad','Sevilla','Villarreal',
      'Mallorca','Valencia CF','Espanyol','Liverpool','Celta de Vigo',
      'Deportivo Alavés','Osasuna','Getafe CF','Arsenal','Girona FC',
      'Elche CF','Atlético Madrid','Rayo Vallecano','Real Betis','FC Barcelona'
    ];
    return EA20.map(function (name) {
      var entry = ratings[name];
      var pw = (typeof entry === 'number') ? entry
             : (entry && typeof entry.media === 'number') ? entry.media : 75;
      return {
        name: name, league: 'liga-ea-sports', power: pw,
        isHuman: humanos.indexOf(name) !== -1
      };
    });
  }
  function _hypermotionFallback() {
    var arr = window.DEFAULT_SEGUNDA_TEAMS || [];
    return arr.map(function (t) {
      return {
        name: String(t && t.name || '').trim(),
        league: 'liga-hypermotion',
        power: Math.max(1, Math.min(99, Number(t && t.media) || 70)),
        isHuman: HUMAN_TEAMS.indexOf(String(t && t.name || '').trim()) !== -1
      };
    });
  }
  function _primeraFedFallback() {
    var g1 = window.DEFAULT_PRIMERA_G1 || [];
    var g2 = window.DEFAULT_PRIMERA_G2 || [];
    return g1.concat(g2).map(function (t) {
      return {
        name: String(t && t.name || '').trim(),
        league: 'liga-primera-federacion',
        power: Math.max(1, Math.min(99, Number(t && t.media) || 60)),
        isHuman: HUMAN_TEAMS.indexOf(String(t && t.name || '').trim()) !== -1
      };
    });
  }

  function _collectCopaTeams() {
    /* 2026-05-24: gate `_ligaExtSimInProgress` durante TODA la
       recolección. Sin él, la primera vez que el usuario abre Copa
       del Rey en un dispositivo sin cache local de Liga Hypermotion
       o Primera Federación, cada `loadData(slug)` dispara hasta 3
       XHR SÍNCRONAS al backend (`/api/liga-ext/<slug>` + 2
       `/api/liga-ext-protected/<slug>`). En móvil con red lenta
       (Railway cold start) cada XHR puede colgarse 30+ segundos →
       el botón "🎯 Iniciar Copa — Sortear 1ª Ronda" se queda sin
       respuesta varios minutos (bug reportado 2026-05-24 — usuario
       "le pulso y no hace absolutamente nada pese a esperar varios
       minutos"). Con el gate, loadData() salta los XHR sync y
       devuelve {teams:[], results:[]} al instante; caemos a los
       fallbacks estáticos (_ligaEaFallback / _hypermotionFallback /
       _primeraFedFallback) que ya contienen los 20 + 22 + 40
       equipos con nombre y power suficientes para el sorteo. La
       hidratación real sigue ocurriendo en segundo plano vía las
       fetch ASYNC del bundle (refreshLigaEaShields, etc.) sin
       bloquear el thread JS. */
    var _prevGate = window._ligaExtSimInProgress;
    window._ligaExtSimInProgress = true;
    var all = [];
    var seen = {};
    try {
      _refreshHumanTeams();
      _copaShieldCache = null;
      var FALLBACK = {
        'liga-ea-sports':          _ligaEaFallback,
        'liga-hypermotion':        _hypermotionFallback,
        'liga-primera-federacion': _primeraFedFallback
      };
      COPA_LEAGUE_SLUGS.forEach(function (slug) {
        var teams = _readLigaTeams(slug);
        if (!teams.length && typeof FALLBACK[slug] === 'function') {
          teams = FALLBACK[slug]();
        }
        teams.forEach(function (t) {
          if (!t.name || seen[t.name]) return;
          seen[t.name] = true;
          all.push(t);
        });
      });
    } finally {
      window._ligaExtSimInProgress = _prevGate;
    }
    /* Garantizar que los 5 humanos estén presentes aunque ninguno de
       los storages los traiga (caso raro: el editor de Liga EA quedó
       sin guardar). Sin esto, el filtro `humanos = all.filter(isHuman)`
       devolvería 0 y la 1ª Ronda se quedaría sin los humanos. */
    HUMAN_TEAMS.forEach(function (name) {
      if (seen[name]) return;
      var ratings = window.TEAM_RATINGS || {};
      var entry = ratings[name];
      var pw = (typeof entry === 'number') ? entry
             : (entry && typeof entry.media === 'number') ? entry.media : 80;
      all.push({ name: name, league: 'liga-ea-sports', power: pw, isHuman: true });
      seen[name] = true;
    });
    return all;
  }

  /* Reparte 36 equipos para 1ª Ronda: 5 humanos + 31 al azar de Primera
     Federación (excluyendo a los humanos para no contarlos dos veces).
     Devuelve {participants:[name…], levels:{name:power}} o null si no
     hay equipos suficientes. */
  function _buildR1Participants() {
    var all = _collectCopaTeams();
    if (!all.length) return null;
    var humanos = all.filter(function (t) { return t.isHuman; });
    var primeraFedNoHum = all.filter(function (t) {
      return t.league === 'liga-primera-federacion' && !t.isHuman;
    });
    /* Mezclar y coger los primeros 31. Si no hay 31 disponibles,
       cogemos los que haya (la 1ª Ronda quedará con menos partidos). */
    var pool = primeraFedNoHum.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    var random31 = pool.slice(0, 31);
    var participants = humanos.concat(random31);
    var levels = {};
    all.forEach(function (t) { levels[t.name] = t.power; });
    return {
      participants: participants.map(function (t) { return t.name; }),
      levels: levels,
      humanos: humanos.map(function (t) { return t.name; }),
      preClasificados: all
        .filter(function (t) {
          return participants.indexOf(t) === -1; /* los 46 restantes */
        })
        .map(function (t) { return t.name; })
    };
  }

  /* Empareja una lista de N equipos (par) en N/2 emparejamientos al azar.
     `hostIsLower=true` (1ª/2ª Ronda y Final) → m.l = equipo de MENOR
     nivel, juega en su campo a partido único.
     `hostIsLower=false` (16avos/Octavos/Cuartos/Semis) → m.l = equipo
     de MAYOR nivel: la IDA se juega en su campo, y el swap automático
     del engine (`esVuelta ? m.v : m.l`) lleva la VUELTA al campo del de
     MENOR nivel — exactamente lo que pide el usuario.
     Empate de nivel → desempate alfabético para que el local sea
     determinista (no se invierte entre recargas). */
  function _pairTeams(names, levels, hostIsLower) {
    var arr = (names || []).slice();
    if (arr.length % 2 !== 0) arr.pop(); /* impar: descarta el último */
    /* Shuffle */
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    var matches = [];
    for (var k = 0; k < arr.length; k += 2) {
      var a = arr[k], b = arr[k + 1];
      var pa = (levels && typeof levels[a] === 'number') ? levels[a] : 75;
      var pb = (levels && typeof levels[b] === 'number') ? levels[b] : 75;
      var aIsHost;
      if (hostIsLower) {
        aIsHost = pa < pb || (pa === pb && a < b);
      } else {
        aIsHost = pa > pb || (pa === pb && a < b);
      }
      matches.push(aIsHost ? { l: a, v: b } : { l: b, v: a });
    }
    return matches;
  }

  /* ── TBD (To Be Determined) — cuando una ronda se confirma con
     clasificación parcial, los partidos pendientes dejan un
     placeholder `@<ronda>#<idx>` en `clasificados[ronda]`. Estos
     placeholders propagan a `sorteo` de rondas posteriores como
     `m.l` o `m.v` y aquí los detectamos para renderizar "Esperando
     Rival" y aplicar constraints especiales (TBD que viene de
     un partido con humano se trata como "potencialmente humano"). */
  function _tbdParse(name) {
    var m = /^@([a-z0-9]+)#(\d+)$/.exec(String(name || ''));
    if (!m) return null;
    return { ronda: m[1], idx: parseInt(m[2], 10), key: name };
  }
  function _tbdMayBeHuman(tbd) {
    if (!tbd) return false;
    var sorteoR = ((_copa && _copa.sorteo) || {})[tbd.ronda] || [];
    var match = sorteoR[tbd.idx];
    if (!match) return true; /* sin info → conservador */
    var hHum = HUMAN_TEAMS.indexOf(canonicalTeam(match.l)) !== -1;
    var vHum = HUMAN_TEAMS.indexOf(canonicalTeam(match.v)) !== -1;
    return hHum || vHum;
  }
  /* Igual que _tbdMayBeHuman, pero conservador para "puede acabar siendo
     un equipo de Liga EA Sports" — incluye humanos (que también son EA)
     y EA-IA. Se usa en _pairTeamsConstrained para mantener la regla
     "EA no se enfrentan entre sí hasta Octavos" cuando un TBD pendiente
     de resolver podría convertirse en un EA. */
  function _tbdMayBeEa(tbd) {
    if (!tbd) return false;
    var sorteoR = ((_copa && _copa.sorteo) || {})[tbd.ronda] || [];
    var match = sorteoR[tbd.idx];
    if (!match) return true; /* sin info → conservador */
    function _isEaName(nm) {
      var canon = canonicalTeam(nm);
      if (HUMAN_TEAMS.indexOf(canon) !== -1) return true;
      var teams = (typeof _collectCopaTeams === 'function') ? _collectCopaTeams() : [];
      for (var i = 0; i < teams.length; i++) {
        if (teams[i].name === canon && teams[i].league === 'liga-ea-sports') return true;
      }
      return false;
    }
    return _isEaName(match.l) || _isEaName(match.v);
  }
  /* Devuelve el nombre del equipo IA "ya clasificado" si la pareja
     R1 era HUMANO vs IA: el IA gana si pierde el humano (lo cual no
     suele pasar) — pero aún si no podemos saberlo, mostramos el
     escudo del equipo IA como referencia. Si la pareja era IA vs IA
     no hay un IA "definitivo". */
  function _tbdHintInfo(tbd) {
    if (!tbd) return { hint: 'Esperando Rival', shieldTeam: '' };
    var sorteoR = ((_copa && _copa.sorteo) || {})[tbd.ronda] || [];
    var match = sorteoR[tbd.idx];
    if (!match) return { hint: 'Esperando Rival', shieldTeam: '' };
    var hHum = HUMAN_TEAMS.indexOf(canonicalTeam(match.l)) !== -1;
    var vHum = HUMAN_TEAMS.indexOf(canonicalTeam(match.v)) !== -1;
    /* Si SOLO un lado es humano, el otro lado IA está "esperando" al
       resultado. Mostramos su escudo como referencia. */
    if (hHum && !vHum) return { hint: 'Esperando Rival', shieldTeam: match.v, opponents: [match.l, match.v] };
    if (vHum && !hHum) return { hint: 'Esperando Rival', shieldTeam: match.l, opponents: [match.l, match.v] };
    /* IA vs IA → el ganador es uno de los 2; no podemos previsualizar. */
    return { hint: 'Esperando Rival', shieldTeam: '', opponents: [match.l, match.v] };
  }

  /* Empareja con CONSTRAINTS por ronda (regla del usuario 2026-05-09):
     · TODOS los equipos de Liga EA Sports (humanos y no-humanos) cuando
       entran en la Copa SOLO pueden enfrentarse a equipos de Primera
       Federación o Hypermotion hasta Dieciseisavos incluido.
     · r1: equipos EA (los 5 humanos) SOLO vs Primera Federación.
     · r2: equipos EA (5 humanos + 15 no-humanos que entran ahora) vs
           PF o Hypermotion. Nunca EA vs EA.
     · r16: equipos EA vs PF o Hypermotion. Nunca EA vs EA.
     · oct (Octavos): EA vs EA permitido — pero si quedan rivales no-EA
           en el bombo, se priorizan para retrasar EA-vs-EA al máximo.
     · cua/sf/fin: libre. En Cuartos se sigue prefiriendo no-humano
           para que el primer humano-vs-humano caiga en Semis.

     Reglas de local/visitante (idénticas a antes, OK con la petición):
     · single-leg (r1/r2/r16/fin): host = MENOR nivel → mayor nivel
       juega de visitante.
     · two-leg (oct/cua/sf): IDA en campo del MAYOR nivel; el swap del
       engine (`esVuelta ? m.v : m.l`) lleva la VUELTA al campo del de
       MENOR nivel.

     Estrategia: separa equipos EA (humanos + EA-IA) del resto, empareja
     cada EA con un oponente válido siguiendo la prioridad de la ronda,
     y luego empareja el resto al azar. */
  function _pairTeamsConstrained(teamObjs, hostIsLower, ronda) {
    var available = (teamObjs || []).slice();
    if (available.length % 2 !== 0) available.pop();
    var pairs = [];
    var assigned = {};

    function _orderPair(a, b) {
      var pa = a.power, pb = b.power;
      var aIsHost;
      if (hostIsLower) aIsHost = pa < pb || (pa === pb && a.name < b.name);
      else             aIsHost = pa > pb || (pa === pb && a.name < b.name);
      return aIsHost ? { l: a.name, v: b.name } : { l: b.name, v: a.name };
    }
    function _shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
    /* "Equipo de Liga EA Sports" para la regla del usuario: humanos
       + EA-IA + TBDs cuyos posibles ganadores incluyan a un EA. */
    function _isEa(t) {
      if (!t) return false;
      if (t.isHuman) return true;
      if (t.league === 'liga-ea-sports') return true;
      if (t.isTbd && t.tbdMayBeEa) return true;
      return false;
    }
    function _canPair(eaT, oppT) {
      var oppIsEa = _isEa(oppT);
      if (oppIsEa) {
        /* EA vs EA solo desde Octavos. En Cuartos+ totalmente libre.
           En Octavos lo permite _canPair pero _preferenceFor prioriza
           no-EA cuando aún haya disponibles. */
        return ronda === 'oct' || ronda === 'cua' || ronda === 'sf' || ronda === 'fin';
      }
      /* Oponente NO-EA. */
      if (ronda === 'r1') {
        /* R1 son solo humanos + PF — Hyp no entra todavía. */
        if (oppT.isTbd && !oppT.tbdMayBeEa) return true;
        return oppT.league === 'liga-primera-federacion';
      }
      if (ronda === 'r2' || ronda === 'r16') {
        /* EA vs PF o Hypermotion. */
        if (oppT.isTbd && !oppT.tbdMayBeEa) return true;
        return oppT.league === 'liga-primera-federacion'
            || oppT.league === 'liga-hypermotion';
      }
      /* oct/cua/sf/fin: cualquiera. */
      return true;
    }
    function _preferenceFor(eaT, candidates) {
      /* r2 / r16: prioridad PF > Hyp (Liga EA queda fuera por _canPair). */
      if (ronda === 'r2' || ronda === 'r16') {
        var pf = candidates.filter(function (c) { return c.league === 'liga-primera-federacion'; });
        if (pf.length) return pf;
        var hy = candidates.filter(function (c) { return c.league === 'liga-hypermotion'; });
        if (hy.length) return hy;
      }
      /* Octavos: si aún hay rivales NO-EA disponibles, priorizar — el
         usuario quiere que EA-vs-EA se demore al máximo. Si en oct
         no quedan no-EA, _canPair ya permite EA-vs-EA. */
      if (ronda === 'oct') {
        var nonEa = candidates.filter(function (c) { return !_isEa(c); });
        if (nonEa.length) return nonEa;
      }
      /* Cuartos: priorizar no-humano para que humano-vs-humano caiga
         primero en Semifinales. */
      if (ronda === 'cua') {
        var noHum = candidates.filter(function (c) { return !c.isHuman && !(c.isTbd && c.tbdMayBeHuman); });
        if (noHum.length) return noHum;
      }
      return candidates;
    }

    /* Procesa primero TODOS los equipos EA (humanos + EA-IA + TBDs
       potencialmente EA). De esta manera cada EA se asegura un rival
       válido (PF/Hyp) en r1/r2/r16. */
    var eaTeams = _shuffle(available.filter(_isEa).slice());
    eaTeams.forEach(function (h) {
      if (assigned[h.name]) return;
      var pool = available.filter(function (t) {
        return !assigned[t.name] && t.name !== h.name && _canPair(h, t);
      });
      pool = _preferenceFor(h, pool);
      if (!pool.length) {
        /* Fallback: cualquier no-EA disponible. */
        pool = available.filter(function (t) {
          return !assigned[t.name] && t.name !== h.name && !_isEa(t);
        });
      }
      if (!pool.length) {
        /* Último recurso: cualquiera disponible (incluso EA — solo
           ocurre si el bombo no tiene ya rivales no-EA suficientes). */
        pool = available.filter(function (t) {
          return !assigned[t.name] && t.name !== h.name;
        });
      }
      if (!pool.length) return;
      var opp = pool[Math.floor(Math.random() * pool.length)];
      pairs.push(_orderPair(h, opp));
      assigned[h.name] = true;
      assigned[opp.name] = true;
    });

    /* Empareja al resto (PF, Hyp, TBDs no-EA) al azar entre sí. */
    var resto = _shuffle(available.filter(function (t) { return !assigned[t.name]; }));
    for (var k = 0; k < resto.length - 1; k += 2) {
      pairs.push(_orderPair(resto[k], resto[k + 1]));
    }
    return pairs;
  }
  /* Exponer para tests/debug. */
  window._copaCollectTeams = _collectCopaTeams;
  window._copaBuildR1 = _buildR1Participants;
  window._copaPairTeams = _pairTeams;

  /* ════════════════════════════════════════════════════════════════
     PRE-POBLACIÓN DE PLANTILLAS PARA FILIALES Y EQUIPOS SIN ROSTER
     Sin esto, sqFromRegistry busca en localStorage y, si no encuentra
     match exacto, hace una segunda pasada por SUBSTRING que equipara
     "Real Madrid Castilla" con "Real Madrid" → genMatchEvents acaba
     usando Mbappé/Vinicius para Castilla. Igual con Betis Deportivo,
     Celta Fortuna, Bilbao Ath., Sevilla At., Atlético Madrileño,
     Villarreal B, etc. (todos los filiales de Primera Federación).

     Solución: para CADA equipo de Hypermotion + Primera Federación
     (los que viven en DEFAULT_SEGUNDA_TEAMS / G1 / G2), generamos una
     plantilla sintética (1 portero + 4 def + 4 med + 3 del = 12
     titulares · semilla determinista por nombre de equipo) y la
     registramos en SQUAD_REGISTRY tras `applyEngineOverrides`. Así el
     primer pass de sqFromRegistry encuentra match exacto y nunca cae
     al substring. ════════════════════════════════════════════════ */
  var _COPA_FIRST_NAMES = [
    'Carlos','Daniel','Sergio','Pablo','David','Adrián','Iván','Marco','Hugo','Joel',
    'Aitor','Mario','Álvaro','Lucas','Diego','Jaime','Marcos','Andrés','Roberto','Manuel',
    'Antonio','José','Javier','Luis','Miguel','Raúl','Rubén','Pedro','Borja','Iker',
    'Asier','Mikel','Jon','Aimar','Beñat','Unai','Gorka','Xabi','Markel','Imanol',
    'Bruno','Adriá','Ferran','Pol','Aleix','Albert','Marc','Roger','Sergi','Joan',
    'Nico','Pau','Cristian','Saúl','Juanjo','Tomás','Lautaro','Cristóbal'
  ];
  var _COPA_LAST_NAMES = [
    'García','Martínez','López','Sánchez','Pérez','González','Rodríguez','Fernández',
    'Ramos','Ruiz','Torres','Vázquez','Castro','Ortega','Romero','Navarro','Suárez',
    'Iglesias','Domínguez','Vidal','Méndez','Crespo','Calvo','Gallardo','Cabrera',
    'Reyes','Aguilar','Soler','Carrasco','Padilla','Barragán','Beltrán','Ibáñez',
    'Esteban','Mora','Gil','Cortés','Pardo','Ferrer','Colomer','Boix','Sabater',
    'Cuevas','Heras','Rincón','Vila','Galán','Santos','Linares','Pascual','Ríos',
    'Mendoza','Salas','Vega','Rivas','Quintana','Aznar','Cordero','Bravo','Hernández'
  ];
  function _copaSeedHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }
  function _copaSyntheticName(team, idx) {
    var seed = _copaSeedHash(team + '|' + idx);
    var f = _COPA_FIRST_NAMES[seed % _COPA_FIRST_NAMES.length];
    var l = _COPA_LAST_NAMES[(seed >>> 8) % _COPA_LAST_NAMES.length];
    return f + ' ' + l;
  }
  function _copaSyntheticSquad(teamName, basePower) {
    var pw = Math.max(40, Math.min(85, Number(basePower) || 65));
    /* 11 titulares (1P + 4D + 3M + 3F = 4-3-3, formación estándar de
       fútbol) + 7 suplentes en banco. Marcados con p[4]='titular' /
       'suplente' para que iaSimLive use el pool correcto y el motor
       de sustituciones automáticas pueda sacar suplentes desde el
       min 46. */
    var sq = [
      { h: '🧤 PORTEROS' },
      [String(1), _copaSyntheticName(teamName, 0), 'P', pw, 'titular']
    ];
    sq.push({ h: '🛡 DEFENSAS' });
    var dNums = [2, 3, 4, 5];
    for (var d = 0; d < 4; d++) sq.push([String(dNums[d]), _copaSyntheticName(teamName, 1 + d), 'D', pw - 2, 'titular']);
    sq.push({ h: '⚙️ MEDIOS' });
    var mNums = [6, 8, 10];
    for (var m = 0; m < 3; m++) sq.push([String(mNums[m]), _copaSyntheticName(teamName, 5 + m), 'M', pw, 'titular']);
    sq.push({ h: '⚡ DELANTEROS' });
    var fNums = [7, 9, 11];
    for (var f = 0; f < 3; f++) sq.push([String(fNums[f]), _copaSyntheticName(teamName, 8 + f), 'F', pw + 2, 'titular']);
    /* Banco: 1 portero suplente + 2 defensas + 2 medios + 2 delanteros = 7. */
    var benchSpec = [
      { num:13, pos:'P' },
      { num:14, pos:'D' },
      { num:15, pos:'D' },
      { num:16, pos:'M' },
      { num:17, pos:'M' },
      { num:18, pos:'F' },
      { num:19, pos:'F' }
    ];
    benchSpec.forEach(function (b, i) {
      sq.push([String(b.num), _copaSyntheticName(teamName, 11 + i), b.pos, pw - 5, 'suplente']);
    });
    return sq;
  }
  function _copaEnsureSquads() {
    if (!window.SQUAD_REGISTRY) window.SQUAD_REGISTRY = {};
    var pools = [
      window.DEFAULT_SEGUNDA_TEAMS || [],
      window.DEFAULT_PRIMERA_G1   || [],
      window.DEFAULT_PRIMERA_G2   || []
    ];
    pools.forEach(function (pool) {
      pool.forEach(function (t) {
        if (!t || !t.name) return;
        var nm = String(t.name).trim();
        if (window.SQUAD_REGISTRY[nm] && Array.isArray(window.SQUAD_REGISTRY[nm]) && window.SQUAD_REGISTRY[nm].length) return;
        window.SQUAD_REGISTRY[nm] = _copaSyntheticSquad(nm, t.media || 65);
      });
    });
  }
  /* Ejecutar al cargar y tras un setTimeout breve por si SQUAD_REGISTRY
     se inicializa en applyEngineOverrides después que nosotros. */
  try { _copaEnsureSquads(); } catch(_){}
  setTimeout(function () { try { _copaEnsureSquads(); } catch(_){} }, 300);
  setTimeout(function () { try { _copaEnsureSquads(); } catch(_){} }, 1500);

  /* Wrap `getTeamEfootballAlias` para que ALSO consulte el MAP
     hardcoded de `primera-rfef-data.js` (window.getPrimeraRFEFAlias)
     como fallback. Antes solo leía localStorage `ligaExt_*`, así que
     si el usuario no había abierto el editor de Primera Federación
     (caso típico cuando el sorteo de Copa usa los DEFAULT_PRIMERA_*
     sintéticos), el alias eFootball NUNCA aparecía bajo el nombre
     de los equipos sin licencia (Hércules, Mirandés, Cultural, etc.).

     Pirámide de resolución del alias:
       1. Editor user-facing (ligaExt_*.efootballAlias) — máxima
          prioridad: si el admin lo definió a mano, gana.
       2. MAP hardcoded de primera-rfef-data.js — fallback automático
          para equipos de Primera Fed sin alias custom.
     El wrap es idempotente; si el wrapping ya ocurrió no se repite. */
  /* `getTeamEfootballAlias` ya respeta SIEMPRE lo que el admin tipea
     en el editor (ligaExt_*). El MAP hardcoded de primera-rfef-data.js
     QUEDA DESACTIVADO: la regla del usuario (2026-05-07) es que un
     equipo SIN alias en el editor es un equipo que YA existe en
     eFootball, así que no debe mostrarse alias automático. Mantenemos
     la función vacía por compatibilidad con código que la llama. */
  function _copaWrapTeamAlias() { /* no-op: editor es la única fuente */ }
  try { _copaWrapTeamAlias(); } catch(_){}

  function allPlayed(resList, n) {
    if (!resList || resList.length < n) return false;
    for (var i = 0; i < n; i++) {
      if (!resList[i] || !resList[i].jugado) return false;
    }
    return true;
  }

  function isRoundComplete(ronda, matches, resultados) {
    if (!matches || !matches.length) return false;
    if (TWO_LEG[ronda]) {
      var vta = resultados[ronda + '_vta'] || [];
      return allPlayed(vta, matches.length) && vta.slice(0, matches.length).every(function (r) {
        return r && r.winner;
      });
    }
    return allPlayed(resultados[ronda], matches.length);
  }

  function getResultKey(ronda, esVuelta) {
    return TWO_LEG[ronda] ? ronda + (esVuelta ? '_vta' : '_ida') : ronda;
  }

  function getCalendarKey(ronda, esVuelta) {
    if (!TWO_LEG[ronda]) return ronda;
    return ronda + '_' + (esVuelta ? 'vta' : 'ida');
  }

  function getResultList(ronda, esVuelta) {
    return ((_copa.resultados || {})[getResultKey(ronda, esVuelta)] || []);
  }

  function getRowStatValue(row, key, attr) {
    var clsMap = {
      gol: 'ps-gol',
      yel: 'ps-yel',
      red: 'ps-red',
      mvp: 'ps-mvp',
      'pen-prov': 'ps-pen-prov',
      'pen-parado': 'ps-pen-parado',
      'pen-gol': 'ps-pen-gol',
      'falta-gol': 'ps-falta-gol',
      propia: 'ps-propia',
      'pen-fallado': 'ps-pen-fallado'
    };
    var cls = clsMap[key];
    var el = cls ? row.querySelector('.' + cls) : null;
    return el ? Number(el.getAttribute(attr) || 0) : 0;
  }

  function ensureStatSpan(row, key) {
    var clsMap = {
      gol: 'ps-gol',
      yel: 'ps-yel',
      red: 'ps-red',
      mvp: 'ps-mvp',
      'pen-prov': 'ps-pen-prov',
      'pen-parado': 'ps-pen-parado',
      'pen-gol': 'ps-pen-gol',
      'falta-gol': 'ps-falta-gol',
      propia: 'ps-propia',
      'pen-fallado': 'ps-pen-fallado'
    };
    var cls = clsMap[key];
    if (!cls) return null;
    var span = row.querySelector('.' + cls);
    if (!span) {
      span = document.createElement('span');
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
    }
    return span;
  }

  function updateVisibleStatCell(span) {
    if (!span || !span.parentElement) return;
    var parent = span.parentElement;
    var liga = Number(span.getAttribute('data-liga') || 0);
    var copa = Number(span.getAttribute('data-copa') || 0);
    var superV = Number(span.getAttribute('data-super') || 0);
    var ucl = Number(span.getAttribute('data-ucl') || 0);
    var uecl = Number(span.getAttribute('data-uecl') || 0);
    var europa = Number(span.getAttribute('data-europa') || 0);
    var total = liga + copa + superV + ucl + uecl + europa;
    if (span.classList.contains('ps-pen-parado')) {
      var tirados = Number(span.getAttribute('data-tirado') || 0);
      parent.lastChild && (parent.lastChild.textContent = total + '/' + tirados);
    } else if (span.classList.contains('ps-pen-gol')) {
      var tiradosGol = Number(span.getAttribute('data-tirado') || 0);
      if (parent.classList.contains('frac')) parent.lastChild && (parent.lastChild.textContent = total + '/' + tiradosGol);
      else parent.lastChild && (parent.lastChild.textContent = total);
    } else {
      parent.lastChild && (parent.lastChild.textContent = total);
    }
    parent.classList.toggle('zero', total === 0);
  }

  function setPlayerStat(row, key, amount, storeKey) {
    amount = Number(amount || 0);
    if (!amount) return;
    var span = ensureStatSpan(row, key);
    if (!span) return;
    var compAttr = 'data-' + storeKey;
    var global = Number(span.getAttribute('data-global') || 0) + amount;
    var comp = Number(span.getAttribute(compAttr) || 0) + amount;
    span.setAttribute('data-global', String(Math.max(0, global)));
    span.setAttribute(compAttr, String(Math.max(0, comp)));
    if ((key === 'pen-gol' || key === 'pen-parado') && amount > 0) {
      var tirados = Number(span.getAttribute('data-tirado') || 0);
      span.setAttribute('data-tirado', String(tirados + amount));
    }
    updateVisibleStatCell(span);
  }

  function getRosterIndex() {
    var idx = {};
    document.querySelectorAll('.screen[id]').forEach(function (screen) {
      var rows = screen.querySelectorAll('.plant-row');
      if (!rows.length) return;
      var h2 = screen.querySelector('.sec-hdr h2');
      var team = canonicalTeam(h2 ? h2.textContent.trim() : '');
      if (!team && window.SCREEN_TEAM_FALLBACK) team = window.SCREEN_TEAM_FALLBACK[screen.id] || '';
      rows.forEach(function (row) {
        var nameEl = row.querySelector('.plant-name');
        if (!nameEl || !team) return;
        idx[team + '::' + nameEl.textContent.trim().toLowerCase()] = row;
      });
    });
    return idx;
  }

  function applyPlayerEvents(teamA, teamB, evts, matchKey, mvpName, mvpTeam) {
    var roster = getRosterIndex();
    (evts || []).forEach(function (ev) {
      var type = ev && ev.type;
      if (!type || type === 'lesion') return;
      var player = Array.isArray(ev.player) ? ev.player[1] : (ev.name || '');
      if (!player) return;
      var teamName = ev.realTeam || (ev.team === 'a' ? teamA : teamB);
      var row = roster[canonicalTeam(teamName) + '::' + String(player).trim().toLowerCase()];
      if (!row) return;
      if (type === 'gol') setPlayerStat(row, 'gol', 1, PLAYER_STORE_KEY);
      else if (type === 'falta-gol') setPlayerStat(row, 'falta-gol', 1, PLAYER_STORE_KEY);
      else if (type === 'pen-gol') setPlayerStat(row, 'pen-gol', 1, PLAYER_STORE_KEY);
      else if (type === 'pen-fallo' || type === 'pen-fallado') setPlayerStat(row, 'pen-fallado', 1, PLAYER_STORE_KEY);
      else if (type === 'pen-parado') setPlayerStat(row, 'pen-parado', 1, PLAYER_STORE_KEY);
      else if (type === 'pen-prov') setPlayerStat(row, 'pen-prov', 1, PLAYER_STORE_KEY);
      else if (type === 'propia') setPlayerStat(row, 'propia', 1, PLAYER_STORE_KEY);
      else if (type === 'mvp') setPlayerStat(row, 'mvp', 1, PLAYER_STORE_KEY);
      else if (type === 'amarilla') setPlayerStat(row, 'yel', 1, PLAYER_STORE_KEY);
      else if (type === 'roja') setPlayerStat(row, 'red', 1, PLAYER_STORE_KEY);
      else if (type === 'd-amarilla') {
        setPlayerStat(row, 'yel', -1, PLAYER_STORE_KEY);
        setPlayerStat(row, 'red', 1, PLAYER_STORE_KEY);
      }
    });
    /* Publicar al store de Liga EA Sports (2026-05-04). Petición usuario:
       las stats de Copa del Rey se SUMAN a las de Liga EA Sports en la
       caja de estadísticas y en cada plantilla. Aquí emitimos los mismos
       eventos a LIGA_PLAYER_MATCH_STORE con `competition='copa'` para
       que `rebuildPlayerStatsStore` los agregue al cache
       `ef_player_stats_v1` (Liga + Copa unidas). El matchKey debe ser
       único por partido de Copa para que no se acumulen en re-renders
       (el store mismo dedupea por key). */
    if (matchKey && typeof window.registrarLigaPlayerStats === 'function') {
      var copaKey = String(matchKey).indexOf('copa-') === 0 ? matchKey : ('copa-' + matchKey);
      try {
        window.registrarLigaPlayerStats(copaKey, teamA || '', teamB || '', evts || [], mvpName || '', mvpTeam || '', 'copa');
      } catch(_){}
    }
  }

  function ensureStoreCounters(name, teamName, partidos) {
    if (!window.BAJA_STORE) window.BAJA_STORE = {};
    var prev = window.BAJA_STORE[name];
    var obj = (prev && typeof prev === 'object') ? prev : { tipo: 'lesion', liga: 0, copa: 0, europa: 0 };
    obj.tipo = 'lesion';
    obj.copa = Math.max(Number(obj.copa || 0), Number(partidos || 0));
    window.BAJA_STORE[name] = obj;
    if (window.LESION_STORE && window.LESION_STORE[name] && teamName) window.LESION_STORE[name].equipo = teamName;
  }

  function registerCopaInjuries(lesiones) {
    (lesiones || []).forEach(function (l) {
      var name = (l.jugador && l.jugador[1]) || l.nombre || '';
      var teamName = l.teamName || l.equipo || '';
      if (name) ensureStoreCounters(name, teamName, l.partidos || 1);
    });
    if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
  }

  function decrementCompetitionBajas(compKey, teamA, teamB) {
    if (!window.BAJA_STORE) return;
    var teams = [canonicalTeam(teamA), canonicalTeam(teamB)];
    Object.keys(window.BAJA_STORE).forEach(function (name) {
      var baja = window.BAJA_STORE[name];
      if (!baja || typeof baja !== 'object') return;
      var lesion = window.LESION_STORE && window.LESION_STORE[name];
      var team = canonicalTeam(lesion && lesion.equipo || '');
      if (team && teams.indexOf(team) === -1) return;
      if (typeof baja[compKey] === 'number' && baja[compKey] > 0) baja[compKey]--;
    });
    if (typeof window._refreshSancionInjList === 'function') window._refreshSancionInjList();
  }

  function saveResult(payload) {
    return fetch('/api/copa/guardar_resultado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function getTeamRating(teamName) {
    /* CLAUDE.md: el valor del equipo es la SUMA del poder de los
       titulares de la plantilla REAL. Preferimos _sumTitularsPower
       (expuesto desde misc_body_2.html) para que la plantilla editada
       por el admin determine el resultado de la Copa del Rey igual
       que en Liga EA Sports. Antes Copa caía a TEAM_RATINGS
       hardcodeado → plantillas modificadas no influían en el torneo. */
    if (typeof window._sumTitularsPower === 'function') {
      try {
        var fromSquad = window._sumTitularsPower(teamName);
        if (fromSquad >= 0) return fromSquad;
      } catch(_){}
    }
    if (!window.TEAM_RATINGS) return 75;
    var entry = window.TEAM_RATINGS[teamName];
    if (typeof entry === 'number') return entry;
    if (entry && typeof entry.media === 'number') return entry.media;
    return 75;
  }

  function getFullSquad(teamName) {
    if (typeof window.sqFromRegistryFull === 'function') return window.sqFromRegistryFull(teamName) || [];
    return [];
  }

  function splitSquad(teamName) {
    var full = getFullSquad(teamName).filter(function (p) { return p && !p.h; });
    if (!full.length) return { active: [], bench: [] };
    var gks = full.filter(function (p) { return p[2] === 'P' || p[2] === '🧤'; });
    var out = full.filter(function (p) { return p[2] !== 'P' && p[2] !== '🧤'; })
      .sort(function (a, b) { return (b[3] || 70) - (a[3] || 70); });
    var active = [];
    if (gks[0]) active.push(gks[0]);
    for (var i = 0; i < out.length && active.length < 11; i++) active.push(out[i]);
    var used = active.map(function (p) { return p[1]; });
    var bench = [];
    gks.slice(1).forEach(function (p) { if (used.indexOf(p[1]) === -1) bench.push(p); });
    full.forEach(function (p) {
      if (used.indexOf(p[1]) === -1 && bench.map(function (x) { return x[1]; }).indexOf(p[1]) === -1) bench.push(p);
    });
    return { active: active.slice(), bench: bench.slice() };
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickWeightedPlayer(list, opts) {
    var pool = (list || []).filter(function (p) {
      if (!p || p[2] === 'P') return false;
      if (opts && opts.exclude && opts.exclude.indexOf(p[1]) !== -1) return false;
      return true;
    });
    if (!pool.length) pool = (list || []).filter(Boolean);
    if (!pool.length) return null;
    var total = 0;
    var weighted = pool.map(function (p) {
      var pos = p[2];
      var base = pos === 'F' ? 12 : pos === 'M' ? 8 : pos === 'D' ? 4 : 2;
      var weight = base + ((p[3] || 70) / 12);
      total += weight;
      return { player: p, upto: total };
    });
    var roll = Math.random() * total;
    for (var i = 0; i < weighted.length; i++) {
      if (roll <= weighted[i].upto) return weighted[i].player;
    }
    return weighted[weighted.length - 1].player;
  }

  function maybeCardEvents(activeA, activeB, ft90, teamNameA, teamNameB) {
    var events = [];
    /* Probabilidades base (antes fijas) escaladas por agresividad del
       equipo: amarilla 42% × (aggr/50)², roja 6% × (aggr/50)². Un
       Getafe aggr=90 tiene ~136% amarilla (clampada a 95%) y ~19% roja.
       Alineado con el sistema de Liga EA Sports y el resto de ligas. */
    function _aggr(name){
      return (typeof window._aggressivenessFactor === 'function')
        ? window._aggressivenessFactor(name) : 1;
    }
    var aggrA = _aggr(teamNameA);
    var aggrB = _aggr(teamNameB);
    ['a', 'b'].forEach(function (team) {
      var active = team === 'a' ? activeA : activeB;
      var f = team === 'a' ? aggrA : aggrB;
      var yellowPlayer = null;
      var yellowProb = Math.min(0.95, 0.42 * f);
      if (Math.random() < yellowProb) {
        yellowPlayer = pickWeightedPlayer(active);
        if (yellowPlayer) {
          events.push({ min: 8 + Math.floor(Math.random() * Math.max(10, ft90 - 12)), ico: '🟨', team: team, player: yellowPlayer, type: 'amarilla' });
          if (Math.random() < Math.min(0.30, 0.08 * f)) {
            events.push({ min: Math.min(ft90, 15 + Math.floor(Math.random() * Math.max(12, ft90 - 15))), ico: '🟨🟥', team: team, player: yellowPlayer, type: 'd-amarilla' });
          }
        }
      }
      // Only generate a direct red for a player who has not already received any card,
      // since an expelled player cannot receive further cards (real football rules).
      var redProb = Math.min(0.35, 0.06 * f);
      if (Math.random() < redProb) {
        var excludeFromRed = yellowPlayer ? [yellowPlayer[1]] : [];
        var redPlayer = pickWeightedPlayer(active, { exclude: excludeFromRed });
        if (redPlayer) {
          events.push({ min: 18 + Math.floor(Math.random() * Math.max(12, ft90 - 20)), ico: '🟥', team: team, player: redPlayer, type: 'roja' });
        }
      }
    });
    return events;
  }

  function simulatePenaltyShootout(local, visitante) {
    var rounds = [];
    var scoreA = 0;
    var scoreB = 0;
    for (var i = 0; i < 5; i++) {
      var aGoal = Math.random() < 0.77;
      var bGoal = Math.random() < 0.77;
      scoreA += aGoal ? 1 : 0;
      scoreB += bGoal ? 1 : 0;
      rounds.push({ a: aGoal, b: bGoal, scoreA: scoreA, scoreB: scoreB });
    }
    while (scoreA === scoreB) {
      var sa = Math.random() < 0.74;
      var sb = Math.random() < 0.74;
      scoreA += sa ? 1 : 0;
      scoreB += sb ? 1 : 0;
      rounds.push({ a: sa, b: sb, scoreA: scoreA, scoreB: scoreB });
    }
    return {
      winner: scoreA > scoreB ? local : visitante,
      scoreA: scoreA,
      scoreB: scoreB,
      rounds: rounds
    };
  }

  function pickMvp(events, scoreA, scoreB, teamA, teamB, sqA, sqB, expelledA, expelledB) {
    var expA = expelledA || {};
    var expB = expelledB || {};
    var expelled = {};
    Object.keys(expA).forEach(function (n) { expelled[n] = true; });
    Object.keys(expB).forEach(function (n) { expelled[n] = true; });
    var scores = {};
    var teams = {};
    (events || []).forEach(function (e) {
      if (!e.player) return;
      var n = e.player[1];
      if (!n) return;
      // An expelled player cannot be MVP
      if (expelled[n]) return;
      var w = 0;
      if (e.type === 'gol') w = 3;
      else if (e.type === 'falta-gol') w = 4;
      else if (e.type === 'pen-gol') w = 2;
      else if (e.type === 'pen-parado') w = 3;
      else if (e.type === 'propia') w = -1;
      else if (e.type === 'mvp') w = 1;
      if (!w) return;
      scores[n] = (scores[n] || 0) + w;
      teams[n] = e.team === 'a' ? teamA : teamB;
    });
    var best = '';
    Object.keys(scores).forEach(function (k) {
      if (!best || scores[k] > scores[best]) best = k;
    });
    if (!best) {
      var winner = scoreA > scoreB ? 'a' : (scoreB > scoreA ? 'b' : (Math.random() < 0.5 ? 'a' : 'b'));
      var sq = winner === 'a' ? sqA : sqB;
      var pool = sq.filter(function (p) { return p[2] !== 'P' && !expelled[p[1]]; });
      if (!pool.length) pool = sq.filter(function (p) { return !expelled[p[1]]; });
      if (!pool.length) pool = sq;
      best = pickRandom(pool)[1];
      teams[best] = winner === 'a' ? teamA : teamB;
    }
    return { name: best, team: teams[best] || teamA };
  }

  function renderPenaltySummary(shootout) {
    if (!shootout || !shootout.rounds) return '';
    return shootout.rounds.map(function (r, i) {
      return 'P' + (i + 1) + ' ' + (r.a ? '✓' : '✗') + '/' + (r.b ? '✓' : '✗');
    }).join(' · ');
  }

  function buildSummary(result, local, visitante) {
    var totalL = Number(result.gl || 0) + Number(result.et_gl || 0);
    var totalV = Number(result.gv || 0) + Number(result.et_gv || 0);
    var pieces = ['90\' ' + local + ' ' + result.gl + '–' + result.gv + ' ' + visitante];
    if ((result.et_gl || 0) || (result.et_gv || 0)) pieces.push('ET ' + totalL + '–' + totalV);
    if (result.pen_winner) {
      var pen = result.pen_score ? ' (' + result.pen_score + ')' : '';
      pieces.push('Penaltis: ' + result.pen_winner + pen);
    }
    if (result.mvp) pieces.push('MVP: ' + result.mvp);
    return pieces.join(' · ');
  }

  function simulateCupMatch(local, visitante, opts) {
    opts = opts || {};
    var twoLeg = !!opts.twoLeg;
    var squadA = splitSquad(local);
    var squadB = splitSquad(visitante);
    var activeA = squadA.active.slice();
    var activeB = squadB.active.slice();
    var benchA = squadA.bench.slice();
    var benchB = squadB.bench.slice();
    /* Ratings asimétricos ATK-vs-DEF: ofensivo del local decide cuánto
       marca contra la defensa del visitante, y viceversa. Caída a
       power global (getTeamRating) si los helpers aún no cargan. */
    var offLocal, defLocal, offVisit, defVisit;
    if (typeof window._teamOffense === 'function' && typeof window._teamDefense === 'function') {
      offLocal = window._teamOffense(local);    defLocal = window._teamDefense(local);
      offVisit = window._teamOffense(visitante); defVisit = window._teamDefense(visitante);
    } else {
      offLocal = defLocal = getTeamRating(local);
      offVisit = defVisit = getTeamRating(visitante);
    }
    /* Las dos variables legacy ratingA/ratingB se mantienen como
       "nivel medio" del equipo para los cálculos de baseTotal, cap de
       goles, etc. — igual que antes. */
    var ratingA = (offLocal + defLocal) / 2;
    var ratingB = (offVisit + defVisit) / 2;
    var ft90 = 90;
    var evts = [];

    function poisson(lambda) {
      lambda = Math.max(0.05, lambda || 0.05);
      var L = Math.exp(-lambda), k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L && k < 12);
      return k - 1;
    }

    // Generate card events FIRST so expelled players affect score calculation
    var cardEvts = maybeCardEvents(activeA, activeB, ft90, local, visitante);
    cardEvts.forEach(function (ev) {
      ev.realTeam = ev.team === 'a' ? local : visitante;
      evts.push(ev);
    });

    // Build expelled player maps: { playerName -> expulsionMinute }
    var expelledA = {};
    var expelledB = {};
    cardEvts.forEach(function (ev) {
      if (ev.type === 'roja' || ev.type === 'd-amarilla') {
        var expMap = ev.team === 'a' ? expelledA : expelledB;
        if (expMap[ev.player[1]] === undefined) {
          expMap[ev.player[1]] = ev.min;
        }
      }
    });

    /* ── EXPULSIÓN: penalizar 15 PUNTOS planos por cada roja ──
       Harmonizado con el resto de ligas (Liga EA Sports, Hypermotion,
       Primera Federación, y las 51 ligas que comparten simSimple): el
       expulsado quita 15 puntos al poder efectivo del equipo. */
    var RED_FLAT_PENALTY = 15;
    var adjRatingA = Math.max(30, ratingA - (Object.keys(expelledA).length * RED_FLAT_PENALTY));
    var adjRatingB = Math.max(30, ratingB - (Object.keys(expelledB).length * RED_FLAT_PENALTY));

    /* Bonus de Capitán: +5% al ofensivo del equipo con C titular. */
    var _capBonus = (typeof window._captainBonus === 'function') ? window._captainBonus : function(){ return 1.0; };
    /* Ofensivos finales con todos los modificadores aplicados
       (localía ×1.10 al local, capitán ×1.05, −15 por expulsión). */
    var offLocalAdj = Math.max(30, offLocal * 1.10 * _capBonus(teamA) - RED_FLAT_PENALTY * Object.keys(expelledA).length);
    var offVisitAdj = Math.max(30, offVisit        * _capBonus(teamB) - RED_FLAT_PENALTY * Object.keys(expelledB).length);
    /* xG asimétrico: local marca ~f(offLocal / defVisit). */
    var strengthA = offLocalAdj * (75 / Math.max(30, defVisit));
    var strengthB = offVisitAdj * (75 / Math.max(30, defLocal));
    var shareA = Math.max(0.22, Math.min(0.78, strengthA / Math.max(1, strengthA + strengthB)));
    var baseTotal = 1.75 + (((adjRatingA + adjRatingB) / 2) - 74) * 0.05;
    var expectedA = Math.max(0.15, Math.min(3.8, baseTotal * shareA + Math.max(0, offLocalAdj - offVisitAdj) * 0.018 + 0.10));
    var expectedB = Math.max(0.10, Math.min(3.3, baseTotal * (1 - shareA) + Math.max(0, offVisitAdj - offLocalAdj) * 0.018));
    var maxGoals = (adjRatingA >= 88 || adjRatingB >= 88) ? 7 : (adjRatingA >= 84 || adjRatingB >= 84) ? 6 : 5;
    var gl = Math.min(maxGoals, poisson(expectedA));
    var gv = Math.min(maxGoals, poisson(expectedB));

    var goalsOrder = [];
    for (var ga = 0; ga < gl; ga++) goalsOrder.push('a');
    for (var gb = 0; gb < gv; gb++) goalsOrder.push('b');
    goalsOrder.sort(function () { return Math.random() - 0.5; });

    goalsOrder.forEach(function (team) {
      var min = 4 + Math.floor(Math.random() * 84);
      var active = team === 'a' ? activeA : activeB;
      var expelledMap = team === 'a' ? expelledA : expelledB;
      // Exclude players who were expelled before or at this minute
      var excludeExpelled = Object.keys(expelledMap).filter(function (name) {
        return expelledMap[name] <= min;
      });
      var scorer = pickWeightedPlayer(active, { exclude: excludeExpelled });
      if (!scorer) return;
      var typeRoll = Math.random();
      var type = typeRoll < 0.08 ? 'falta-gol' : (typeRoll < 0.17 ? 'pen-gol' : 'gol');
      var ico = type === 'falta-gol' ? '⚽🎯' : type === 'pen-gol' ? '⚽🥅' : '⚽';
      evts.push({ min: min, ico: ico, team: team, player: scorer, type: type, realTeam: team === 'a' ? local : visitante });
      if (type === 'pen-gol' && Math.random() < 0.72) {
        var prov = pickWeightedPlayer(active, { exclude: excludeExpelled.concat([scorer[1]]) }) || scorer;
        evts.push({ min: min, ico: '🤦🥅', team: team, player: prov, type: 'pen-prov', realTeam: team === 'a' ? local : visitante });
      }
    });

    var lesiones = [];
    if (typeof window.generarLesionesPartido === 'function') {
      lesiones = window.generarLesionesPartido(local, visitante, activeA, activeB, benchA, benchB, ft90) || [];
      lesiones.forEach(function (les) {
        if (typeof window.aplicarLesionEnSimulacion === 'function') {
          window.aplicarLesionEnSimulacion(les, activeA, activeB);
        }
      });
      registerCopaInjuries(lesiones);
    }

    var et_gl = 0;
    var et_gv = 0;
    var penWinner = null;
    var shootout = null;
    if (!twoLeg && gl === gv) {
      var etA = Math.random() < 0.30 ? 1 : (Math.random() < 0.06 ? 2 : 0);
      var etB = Math.random() < 0.28 ? 1 : (Math.random() < 0.05 ? 2 : 0);
      et_gl = etA;
      et_gv = etB;
      for (var ea = 0; ea < etA; ea++) {
        var etMinA = 92 + Math.floor(Math.random() * 14);
        var excludeEtA = Object.keys(expelledA).filter(function (name) { return expelledA[name] <= etMinA; });
        var pA = pickWeightedPlayer(activeA, { exclude: excludeEtA });
        if (pA) evts.push({ min: etMinA, ico: '⚽', team: 'a', player: pA, type: 'gol', realTeam: local });
      }
      for (var eb = 0; eb < etB; eb++) {
        var etMinB = 92 + Math.floor(Math.random() * 14);
        var excludeEtB = Object.keys(expelledB).filter(function (name) { return expelledB[name] <= etMinB; });
        var pB = pickWeightedPlayer(activeB, { exclude: excludeEtB });
        if (pB) evts.push({ min: etMinB, ico: '⚽', team: 'b', player: pB, type: 'gol', realTeam: visitante });
      }
      if (gl + et_gl === gv + et_gv) {
        shootout = simulatePenaltyShootout(local, visitante);
        penWinner = shootout.winner;
      }
    }

    evts.sort(function (a, b) { return a.min - b.min; });
    var mvp = pickMvp(evts, gl + et_gl, gv + et_gv, local, visitante, activeA, activeB, expelledA, expelledB);
    evts.push({ min: 120, ico: '⭐', team: mvp.team === local ? 'a' : 'b', player: ['', mvp.name], type: 'mvp', realTeam: mvp.team });

    /* Al terminar el partido de Copa, decrementar lesiones de ambos
       equipos (1 partido menos de baja pendiente). sqFromRegistry ya
       auto-excluye a los que siguen con partidos > 0. */
    try {
      if (window.LESION_STORE_UTILS && typeof window.LESION_STORE_UTILS.decrementarPorPartido === 'function') {
        window.LESION_STORE_UTILS.decrementarPorPartido(local, 'copa');
        window.LESION_STORE_UTILS.decrementarPorPartido(visitante, 'copa');
      }
    } catch (_) {}

    return {
      gl: gl,
      gv: gv,
      et_gl: et_gl,
      et_gv: et_gv,
      pen_winner: penWinner,
      pen_score: shootout ? (shootout.scoreA + '-' + shootout.scoreB) : '',
      shootout: shootout,
      winner: !twoLeg ? ((gl + et_gl > gv + et_gv) ? local : (gl + et_gl < gv + et_gv ? visitante : penWinner)) : null,
      mvp: mvp.name,
      mvp_team: mvp.team,
      events: evts,
      injuries: lesiones.map(function (les) {
        return {
          jugador: les.jugador,
          nombre: les.jugador && les.jugador[1],
          teamName: les.teamName,
          equipo: les.teamName,
          tipo: les.tipo,
          grado: les.tipo && les.tipo.grado,
          gradoNombre: les.tipo && les.tipo.nombre,
          gradoEmoji: les.tipo && les.tipo.emoji,
          descripcion: (window.LESION_STORE && window.LESION_STORE[les.jugador[1]] && window.LESION_STORE[les.jugador[1]].descripcion) || '',
          partidos: les.partidos
        };
      }),
      summary: '',
      jugado: true
    };
  }

  function syncRoundToCalendar(key, matches, results, esVuelta) {
    var calId = CAL_IDS[key];
    var root = calId && document.getElementById(calId);
    if (!root) return;
    if (!matches || !matches.length) {
      root.innerHTML = '<div class="mrow"><div class="mn">Por definir</div><div class="ms p">vs</div><div class="mn r">Por definir</div></div>';
      return;
    }
    root.innerHTML = matches.map(function (m, idx) {
      var local = esVuelta ? m.v : m.l;
      var visit = esVuelta ? m.l : m.v;
      var res = results && results[idx];
      var score = 'vs';
      var klass = 'ms p';
      if (res && res.jugado) {
        score = res.gl + ' – ' + res.gv;
        if ((res.et_gl || 0) || (res.et_gv || 0)) score += ' ET';
        if (res.pen_winner) score += ' PEN';
        klass = 'ms';
      }
      return '<div class="mrow"><div class="mn">' + escapeHtml(local) + '</div><div class="' + klass + '">' + score + '</div><div class="mn r">' + escapeHtml(visit) + '</div></div>';
    }).join('');
  }

  function syncCalendar(copa) {
    var sorteo = (copa && copa.sorteo) || {};
    var resultados = (copa && copa.resultados) || {};
    syncRoundToCalendar('r1',  sorteo.r1  || [], resultados.r1       || [], false);
    syncRoundToCalendar('r2',  sorteo.r2  || [], resultados.r2       || [], false);
    /* Dieciseisavos: ahora ida+vuelta. El calendario solo tiene un id
       (`cal-copa-16`) para 1/16, así que mostramos ahí la IDA y dejamos
       la VUELTA viva en s-copa-cuadro (que es el cuadro real). */
    syncRoundToCalendar('r16', sorteo.r16 || [], resultados.r16_ida  || [], false);
    syncRoundToCalendar('oct_ida', sorteo.oct || [], resultados.oct_ida || [], false);
    syncRoundToCalendar('oct_vta', sorteo.oct || [], resultados.oct_vta || [], true);
    syncRoundToCalendar('cua_ida', sorteo.cua || [], resultados.cua_ida || [], false);
    syncRoundToCalendar('cua_vta', sorteo.cua || [], resultados.cua_vta || [], true);
    syncRoundToCalendar('sf_ida',  sorteo.sf  || [], resultados.sf_ida  || [], false);
    syncRoundToCalendar('sf_vta',  sorteo.sf  || [], resultados.sf_vta  || [], true);
    syncRoundToCalendar('fin', sorteo.fin || [], resultados.fin || [], false);
    /* Trigger universal jornada completion check */
    if (typeof window._updateAllJornadaStatus === 'function') setTimeout(window._updateAllJornadaStatus, 100);
  }

  function applyStoredResultMeta(copa) {
    var resultados = (copa && copa.resultados) || {};
    Object.keys(resultados).forEach(function (key) {
      (resultados[key] || []).forEach(function (res, idx) {
        if (!res || !res.jugado || !res.events) return;
        var sig = key + '::' + idx + '::' + (res.summary || '') + '::' + (res.pen_score || '');
        if (_appliedMeta[sig]) return;
        /* Pasamos el sig como matchKey: es estable por partido y
           sobrevive recargas, así LIGA_PLAYER_MATCH_STORE no acumula
           el mismo partido dos veces. mvp viene del payload si existe. */
        applyPlayerEvents(res.team_a || '', res.team_b || '', res.events, sig, res.mvp || '', res.mvpTeam || '');
        registerCopaInjuries(res.injuries || []);
        _appliedMeta[sig] = true;
      });
    });
  }

  function renderResultExtra(res) {
    if (!res) return '';
    var meta = [];
    if (res.summary) meta.push('<div class="copa-row-note">' + escapeHtml(res.summary) + '</div>');
    if (res.injuries && res.injuries.length) {
      meta.push('<div class="copa-row-note copa-row-inj">🩹 ' + res.injuries.map(function (l) {
        return escapeHtml(l.nombre || (l.jugador && l.jugador[1]) || '');
      }).join(', ') + '</div>');
    }
    return meta.join('');
  }

  function getAggregateWinner(match, ida, vuelta) {
    if (!match || !ida || !vuelta || !ida.jugado || !vuelta.jugado) return '';
    if (vuelta.winner) return vuelta.winner;
    var totalL = Number(ida.gl || 0) + Number(vuelta.gv || 0);
    var totalV = Number(ida.gv || 0) + Number(vuelta.gl || 0);
    if (totalL > totalV) return match.l;
    if (totalV > totalL) return match.v;
    return vuelta.pen_winner || '';
  }

  function getBracketRoundData(copa, ronda) {
    var sorteo = (copa && copa.sorteo) || {};
    var resultados = (copa && copa.resultados) || {};
    var matches = sorteo[ronda] || [];
    return matches.map(function (match, idx) {
      if (TWO_LEG[ronda]) {
        var ida = (resultados[ronda + '_ida'] || [])[idx] || null;
        var vuelta = (resultados[ronda + '_vta'] || [])[idx] || null;
        var winner = getAggregateWinner(match, ida, vuelta);
        var status = !ida || !ida.jugado ? 'Ida pendiente' : (!vuelta || !vuelta.jugado ? 'Vuelta pendiente' : 'Eliminatoria cerrada');
        var detail = 'Global pendiente';
        if (ida && ida.jugado) detail = 'Ida: ' + match.l + ' ' + ida.gl + '–' + ida.gv + ' ' + match.v;
        if (ida && ida.jugado && vuelta && vuelta.jugado) {
          var aggL = Number(ida.gl || 0) + Number(vuelta.gv || 0);
          var aggV = Number(ida.gv || 0) + Number(vuelta.gl || 0);
          detail = 'Global: ' + match.l + ' ' + aggL + '–' + aggV + ' ' + match.v;
          if (vuelta.pen_winner) detail += ' · PEN ' + vuelta.pen_winner;
        }
        return {
          home: match.l,
          away: match.v,
          winner: winner,
          played: !!(ida && ida.jugado && vuelta && vuelta.jugado),
          status: status,
          detail: detail,
          mvp: (vuelta && vuelta.mvp) || (ida && ida.mvp) || '',
          neutral: false
        };
      }
      var res = (resultados[ronda] || [])[idx] || null;
      var totalL = res ? Number(res.gl || 0) + Number(res.et_gl || 0) : 0;
      var totalV = res ? Number(res.gv || 0) + Number(res.et_gv || 0) : 0;
      var detailSingle = 'Partido pendiente';
      if (res && res.jugado) {
        detailSingle = match.l + ' ' + res.gl + '–' + res.gv + ' ' + match.v;
        if ((res.et_gl || 0) || (res.et_gv || 0)) detailSingle += ' · ET ' + totalL + '–' + totalV;
        if (res.pen_winner) detailSingle += ' · PEN ' + res.pen_winner;
      }
      return {
        home: match.l,
        away: match.v,
        winner: res && res.winner || '',
        played: !!(res && res.jugado),
        status: res && res.jugado ? 'Partido jugado' : 'Pendiente',
        detail: detailSingle,
        mvp: res && res.mvp || '',
        neutral: ronda === 'fin'
      };
    });
  }

  function makePlaceholderList(label, total) {
    var out = [];
    for (var i = 0; i < total; i++) out.push(label + ' ' + (i + 1));
    return out;
  }

  function getRoundAdvancers(copa, ronda, expected) {
    var ties = getBracketRoundData(copa, ronda);
    var out = [];
    ties.forEach(function (tie, idx) {
      out.push(tie.winner || ('Ganador ' + ROUND_LABEL[ronda] + ' ' + (idx + 1)));
    });
    while (out.length < expected) out.push('Ganador ' + ROUND_LABEL[ronda] + ' ' + (out.length + 1));
    return out.slice(0, expected);
  }

  function buildPlaceholderParticipants(copa, ronda, slots) {
    if (ronda === 'r1') return makePlaceholderList('Plaza Copa', slots * 2);
    if (ronda === 'r2') return getRoundAdvancers(copa, 'r1', 18).concat(makePlaceholderList('Cabeza de serie R2', (slots * 2) - 18));
    if (ronda === 'r16') return getRoundAdvancers(copa, 'r2', slots * 2);
    if (ronda === 'oct') return getRoundAdvancers(copa, 'r16', slots * 2);
    if (ronda === 'cua') return getRoundAdvancers(copa, 'oct', slots * 2);
    if (ronda === 'sf')  return getRoundAdvancers(copa, 'cua', slots * 2);
    if (ronda === 'fin') return getRoundAdvancers(copa, 'sf', slots * 2);
    return makePlaceholderList('Por definir', slots * 2);
  }

  function getNextRoundSlotLabel(ronda, idx) {
    var next = NEXT_ROUND[ronda];
    if (!next) return 'Campeón';
    return ROUND_LABEL[next] + ' · cruce ' + (Math.floor(idx / 2) + 1);
  }

  function getBracketStageData(copa, meta) {
    var ties = getBracketRoundData(copa, meta.key);
    if (ties.length) return ties.slice(0, meta.slots);
    var participants = buildPlaceholderParticipants(copa, meta.key, meta.slots);
    var out = [];
    for (var i = 0; i < meta.slots; i++) {
      out.push({
        home: participants[i * 2] || 'Por definir',
        away: participants[(i * 2) + 1] || 'Por definir',
        winner: '',
        played: false,
        status: meta.key === 'r1' ? 'Cuadro inicial' : 'Pendiente de sorteo',
        detail: meta.key === 'fin'
          ? 'La final se completará cuando se definan los dos finalistas.'
          : 'El ganador avanzará a ' + getNextRoundSlotLabel(meta.key, i) + '.',
        mvp: '',
        neutral: meta.key === 'fin',
        placeholder: true
      });
    }
    return out;
  }

  function renderBracket(copa) {
    _refreshHumanTeams();
    var root = document.getElementById('copa-bracket-root');
    var summary = document.getElementById('copa-bracket-summary');
    if (!root) return;
    var roundMeta = [
      { key: 'r1',  label: '1ª Ronda',     subtitle: '36 equipos · partido único · campo del menor', slots: 18, rowSpan: 1 },
      { key: 'r2',  label: '2ª Ronda',     subtitle: '64 equipos · partido único · campo del menor', slots: 32, rowSpan: 1 },
      { key: 'r16', label: 'Dieciseisavos',subtitle: 'Ida y vuelta · vuelta en campo del menor',     slots: 16, rowSpan: 1 },
      { key: 'oct', label: 'Octavos',      subtitle: 'Ida y vuelta · vuelta en campo del menor',     slots: 8,  rowSpan: 2 },
      { key: 'cua', label: 'Cuartos',      subtitle: 'Ida y vuelta · vuelta en campo del menor',     slots: 4,  rowSpan: 4 },
      { key: 'sf',  label: 'Semis',        subtitle: 'Ida y vuelta · vuelta en campo del menor',     slots: 2,  rowSpan: 8 },
      { key: 'fin', label: 'Final',        subtitle: 'Partido único · sede neutral',                 slots: 1,  rowSpan: 16 }
    ];
    var clasificados = (copa && copa.clasificados) || {};
    if (summary) {
      var champion = clasificados.campeon;
      var completed = roundMeta.filter(function (meta) {
        return isRoundComplete(meta.key, ((copa && copa.sorteo) || {})[meta.key] || [], (copa && copa.resultados) || {});
      }).length;
      summary.innerHTML = champion
        ? '<div class="copa-bracket-banner done">🏆 Campeón actual: <b>' + escapeHtml(champion) + '</b><span> · Cuadro completado</span></div>'
        : '<div class="copa-bracket-banner">🗂️ El cuadro ya queda visible desde el inicio y se rellena automáticamente con clasificados, cruces y resultados conforme avanza la Copa.<span> · Rondas cerradas: ' + completed + '/' + roundMeta.length + '</span></div>';
    }
    root.innerHTML = '<div class="copa-bracket-board">' + roundMeta.map(function (meta, stageIdx) {
      var ties = getBracketStageData(copa, meta);
      var clasif = clasificados[meta.key] || [];
      var stageClass = 'copa-bracket-stage';
      if (stageIdx === 0) stageClass += ' first';
      if (stageIdx === roundMeta.length - 1) stageClass += ' last';
      var inner = ties.length ? ties.map(function (tie, tieIdx) {
        var homeWin = tie.winner && canonicalTeam(tie.winner) === canonicalTeam(tie.home);
        var awayWin = tie.winner && canonicalTeam(tie.winner) === canonicalTeam(tie.away);
        var stageNote = tie.played
          ? (tie.winner ? 'Clasifica: ' + tie.winner : 'Partido cerrado')
          : (tie.placeholder ? getNextRoundSlotLabel(meta.key, tieIdx) : 'Pendiente');
        var rowStart = (tieIdx * meta.rowSpan) + 1;
        return '<div class="copa-bracket-slot" style="grid-row:' + rowStart + ' / span ' + meta.rowSpan + ';">'
          + '<div class="copa-bracket-card' + (tie.played ? ' played' : '') + (tie.placeholder ? ' placeholder' : '') + '">'
          + '<div class="copa-bracket-teams">'
          + '<div class="copa-bracket-team' + (homeWin ? ' winner' : '') + (isHuman(tie.home, '') ? ' human' : '') + '"><span class="seed">●</span><span>' + escapeHtml(tie.home) + '</span></div>'
          + '<div class="copa-bracket-team' + (awayWin ? ' winner' : '') + (isHuman(tie.away, '') ? ' human' : '') + '"><span class="seed">●</span><span>' + escapeHtml(tie.away) + '</span></div>'
          + '</div>'
          + '<div class="copa-bracket-status">' + escapeHtml(tie.status + (tie.neutral ? ' · Neutral' : '')) + '</div>'
          + '<div class="copa-bracket-detail">' + escapeHtml(tie.detail) + '</div>'
          + '<div class="copa-bracket-route">' + escapeHtml(stageNote) + '</div>'
          + (tie.mvp ? '<div class="copa-bracket-mvp">⭐ MVP: ' + escapeHtml(tie.mvp) + '</div>' : '')
          + '</div>'
          + '</div>';
      }).join('') : '<div class="copa-bracket-empty">Pendiente de sorteo</div>';
      if (clasif.length) {
        inner += '<div class="copa-bracket-qualified"><b>Clasificados:</b> ' + clasif.map(function (team) {
          return '<span class="copa-bracket-pill' + (isHuman(team, '') ? ' human' : '') + '">' + escapeHtml(team) + '</span>';
        }).join('') + '</div>';
      }
      return '<div class="' + stageClass + '">'
        + '<div class="copa-bracket-round-head"><div class="copa-bracket-round-title">' + escapeHtml(meta.label) + '</div>'
        + '<div class="copa-bracket-round-sub">' + escapeHtml(meta.subtitle) + '</div></div>'
        + '<div class="copa-bracket-round-body"><div class="copa-bracket-lane">' + inner + '</div></div>'
        + '</div>';
    }).join('') + '</div>';
  }

  function renderBlock(blockId, label, matches, results, ronda, esVuelta) {
    var inner = '';
    var hasResults = results && results.some(function (r) { return r && r.jugado; });
    /* Para la VUELTA leemos también la IDA para mostrar el global X-Y
       en cada fila (petición usuario: "en las idas y vueltas salen
       ambos resultados y el global"). */
    var idaResults = (esVuelta && TWO_LEG[ronda])
      ? ((_copa.resultados || {})[ronda + '_ida'] || [])
      : null;
    if (!matches || !matches.length) {
      inner = '<div class="mrow"><div class="mn" style="color:rgba(255,255,255,.28);font-style:italic">Pendiente de sorteo</div></div>';
    } else {
      matches.forEach(function (m, idx) {
        var local = esVuelta ? m.v : m.l;
        var visit = esVuelta ? m.l : m.v;
        var res = results && results[idx];
        var human = isHuman(m.l, m.v);
        if (res && res.jugado) {
          var totalL = Number(res.gl || 0) + Number(res.et_gl || 0);
          var totalV = Number(res.gv || 0) + Number(res.et_gv || 0);
          var etTxt = ((res.et_gl || 0) || (res.et_gv || 0)) ? ' <span class="copa-et">(' + totalL + '-' + totalV + ' ET)</span>' : '';
          var penTxt = res.pen_winner ? ' <span class="copa-pen">PEN</span>' : '';
          /* Línea de global IDA + VUELTA. m.l es siempre el equipo
             original "primary" del par (el que jugó como local en IDA).
             En la VUELTA se invierte el campo, así que para sumar los
             goles "que cada equipo marcó en total":
               m.l_total = ida.gl + vuelta.gv
               m.v_total = ida.gv + vuelta.gl
             Si pen_winner está, se anota junto al global. */
          var aggLine = '';
          if (esVuelta && idaResults && idaResults[idx] && idaResults[idx].jugado) {
            var ida = idaResults[idx];
            var sumOrig_l = Number(ida.gl || 0) + Number(res.gv || 0);
            var sumOrig_v = Number(ida.gv || 0) + Number(res.gl || 0);
            var penGlob = res.pen_winner ? ' · pen ' + escapeHtml(res.pen_winner) : '';
            aggLine = '<div class="copa-row-note copa-row-agg">'
              + 'Ida: <b>' + ida.gl + '-' + ida.gv + '</b> · '
              + 'Vuelta: <b>' + res.gl + '-' + res.gv + '</b> · '
              + 'Global: <b>' + escapeHtml(m.l) + ' ' + sumOrig_l + '-' + sumOrig_v + ' ' + escapeHtml(m.v) + '</b>'
              + penGlob
              + '</div>';
          }
          inner += '<div class="mrow copa-mrow copa-mrow-done" data-done="1">'
            + '<div class="mn">' + escapeHtml(local) + '</div>'
            + '<div class="ms copa-sc">' + res.gl + ' – ' + res.gv + etTxt + penTxt + '</div>'
            + '<div class="mn r">' + escapeHtml(visit) + '</div>'
            + '</div>'
            + aggLine
            + renderResultExtra(res);
        } else {
          var btn = human
            ? '<button class="copa-btn-play" onclick="window.copaJugar(\'' + ronda + '\',' + idx + ',' + (esVuelta ? 1 : 0) + ')">▶ Jugar</button>'
            : '<button class="copa-btn-sim" onclick="window.copaSimIA(\'' + ronda + '\',' + idx + ',' + (esVuelta ? 1 : 0) + ')">⚡ Sim 30s</button>';
          inner += '<div class="mrow copa-mrow">'
            + '<div class="mn">' + escapeHtml(local) + '</div>'
            + '<div class="ms p copa-sc-pen" id="csc-' + blockId + '-' + idx + '">vs</div>'
            + '<div class="mn r">' + escapeHtml(visit) + '</div>'
            + '<div class="copa-act">' + btn + '</div>'
            + '</div>';
        }
      });
    }
    var openClass = !hasResults ? ' open' : '';
    return '<div class="jblock copa-jblock">'
      + '<button class="jbtn c-copa copa-gold-btn" onclick="tog(\'' + blockId + '\')">'
      + '<div class="pdot">▶</div>🏆 <b>Copa del Rey</b> — ' + label
      + '</button>'
      + '<div class="jmatches' + openClass + '" id="' + blockId + '">' + inner + '</div>'
      + '</div>';
  }

  function ensureHumanPanelEnhancements() {
    var box = document.querySelector('#copa-human-panel .copa-panel-box');
    if (!box || document.getElementById('chp-extra-tools')) return;
    var wrap = document.createElement('div');
    wrap.id = 'chp-extra-tools';
    wrap.innerHTML = ''
      + '<div class="chp-section-label">📋 Eventos para fichas del jugador</div>'
      + '<div class="chp-event-row">'
      + '  <select id="chp-evt-type" class="chp-mini-select">'
      + '    <option value="gol">⚽ Gol</option>'
      + '    <option value="falta-gol">⚽🎯 Gol de falta</option>'
      + '    <option value="pen-gol">⚽🥅 Penalti gol</option>'
      + '    <option value="pen-fallo">❌🥅 Penalti fallado</option>'
      + '    <option value="pen-prov">🤦🥅 Penalti provocado</option>'
      + '    <option value="pen-parado">🖐🥅 Penalti parado</option>'
      + '    <option value="propia">⚽🚫 Autogol</option>'
      + '    <option value="amarilla">🟨 Amarilla</option>'
      + '    <option value="d-amarilla">🟨🟥 Doble amarilla</option>'
      + '    <option value="roja">🟥 Roja</option>'
      + '  </select>'
      + '  <select id="chp-evt-team" class="chp-mini-select"><option value="a">Local</option><option value="b">Visitante</option></select>'
      + '  <select id="chp-evt-player" class="chp-mini-select"></select>'
      + '  <button class="copa-btn-sim" type="button" onclick="window.chpAddEvent()">+ Evento</button>'
      + '</div>'
      + '<div class="chp-event-row">'
      + '  <button class="copa-btn-play" type="button" onclick="window.chpAddRandomInjury()">🩹 Lesión partido</button>'
      + '  <span class="chp-helper">Si el lesionado pertenece a un equipo humano, se guarda en la baja de Copa.</span>'
      + '</div>'
      + '<div class="chp-acta" id="chp-event-list"><div class="chp-event-empty">Sin eventos añadidos</div></div>';
    var saveBtn = box.querySelector('.chp-btn-guardar');
    box.insertBefore(wrap, saveBtn);
  }

  function refreshHumanPlayerSelect() {
    var panel = document.getElementById('copa-human-panel');
    if (!panel || !panel.classList.contains('show')) return;
    var teamSide = document.getElementById('chp-evt-team').value;
    var local = document.getElementById('chp-local').textContent.trim();
    var visitante = document.getElementById('chp-visit').textContent.trim();
    var teamName = teamSide === 'a' ? local : visitante;
    var select = document.getElementById('chp-evt-player');
    if (!select) return;
    var squad = getFullSquad(teamName).filter(function (p) { return p && !p.h; });
    select.innerHTML = squad.map(function (p) {
      var disabled = p[5] ? ' disabled' : '';
      return '<option value="' + escapeHtml(p[0]) + '|' + escapeHtml(p[1]) + '"' + disabled + '>' + escapeHtml(p[0] + '. ' + p[1]) + (p[5] ? ' 🚫' : '') + '</option>';
    }).join('');
  }

  function renderHumanEventList() {
    var list = document.getElementById('chp-event-list');
    var panel = document.getElementById('copa-human-panel');
    if (!list || !panel) return;
    var evts = panel._manualEvents || [];
    if (!evts.length) {
      list.innerHTML = '<div class="chp-event-empty">Sin eventos añadidos</div>';
      return;
    }
    list.innerHTML = evts.map(function (ev, idx) {
      var name = Array.isArray(ev.player) ? ev.player[1] : (ev.nombre || '');
      var team = ev.realTeam || (ev.team === 'a' ? document.getElementById('chp-local').textContent.trim() : document.getElementById('chp-visit').textContent.trim());
      var txt = (ev.ico || '•') + ' ' + escapeHtml(name) + ' · ' + escapeHtml(team);
      if (ev.type === 'lesion') txt += ' · ' + escapeHtml((ev.gradoEmoji || '🩹') + ' ' + (ev.gradoNombre || 'Lesión') + ' · ' + (ev.partidos || 1) + 'P');
      return '<div class="chp-event-item">' + txt + '<button type="button" class="chp-del" onclick="window.chpRemoveEvent(' + idx + ')">✕</button></div>';
    }).join('');
  }

  function buildPenaltyTeamOptions(local, visitante) {
    var select = document.getElementById('chp-pen-winner');
    if (!select) return;
    select.innerHTML = '<option value="">Selecciona ganador</option>'
      + '<option value="' + escapeHtml(local) + '">' + escapeHtml(local) + '</option>'
      + '<option value="' + escapeHtml(visitante) + '">' + escapeHtml(visitante) + '</option>';
  }

  function applyHumanResultMeta(payload, local, visitante) {
    /* matchKey estable: ronda + tie_id (o local-visitante como fallback)
       + leg para ida/vuelta. Sin esto no se distinguen ida y vuelta
       de la misma eliminatoria en LIGA_PLAYER_MATCH_STORE. */
    var ronda = payload && (payload.ronda || payload.round) || '';
    var leg   = payload && (payload.leg   || payload.partido_idx) || '';
    var tieId = payload && (payload.tie_id || payload.match_id) || (local + '|' + visitante);
    var mk = 'copa-' + ronda + '|' + tieId + (leg ? '|' + leg : '');
    applyPlayerEvents(local, visitante, payload.events || [], mk,
                      payload && (payload.mvp || payload.mvpName) || '',
                      payload && (payload.mvpTeam || ''));
    registerCopaInjuries(payload.injuries || []);
    decrementCompetitionBajas('copa', local, visitante);
  }

  function stopSimTimer(key) {
    var state = _simTimers[key];
    if (!state) return;
    clearInterval(state.interval);
    delete _simTimers[key];
  }

  function runSimCountdown(domId, totalSeconds, onEnd) {
    stopSimTimer(domId);
    var el = document.getElementById(domId);
    var remaining = totalSeconds;
    if (el) el.textContent = '⏱ ' + remaining + 's';
    _simTimers[domId] = {
      interval: setInterval(function () {
        remaining--;
        if (el) {
          if (remaining > 10) el.textContent = '⏱ ' + remaining + 's';
          else if (remaining > 0) el.textContent = '🔥 ' + remaining + 's';
        }
        if (remaining <= 0) {
          stopSimTimer(domId);
          onEnd();
        }
      }, 1000)
    };
  }

  function saveSimulatedMatch(ronda, idx, esVuelta, match, result) {
    var payload = {
      ronda: ronda,
      idx: idx,
      es_vuelta: !!esVuelta,
      gl: result.gl,
      gv: result.gv,
      et_gl: result.et_gl || 0,
      et_gv: result.et_gv || 0,
      pen_winner: result.pen_winner || null,
      mvp: result.mvp || '',
      events: result.events || [],
      injuries: result.injuries || [],
      summary: buildSummary(result, match.local, match.visitante),
      pen_score: result.pen_score || '',
      team_a: match.local,
      team_b: match.visitante,
      jugado: true
    };
    return saveResult(payload).then(function (d) {
      if (d.ok) {
        applyHumanResultMeta(payload, match.local, match.visitante);
        copaRender(d.copa);
      }
      return d;
    });
  }

  function init() {
    injectStyles();
    ensureHumanPanelEnhancements();
    fetch('/api/copa/state')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _copa = d.copa || {};
        applyStoredResultMeta(_copa);
        copaRender(_copa);
      })
      .catch(function (e) { console.error('[Copa] state error', e); });
  }

  function injectStyles() {
    if (document.getElementById('copa-engine-styles')) return;
    var style = document.createElement('style');
    style.id = 'copa-engine-styles';
    style.textContent = ''
      + '.copa-gold-btn{background:linear-gradient(135deg,#7b5a00,#c89b2c,#f8e3a0,#c89b2c,#7b5a00)!important;color:#fff!important;border:1px solid rgba(255,215,120,.35)!important;box-shadow:0 8px 18px rgba(0,0,0,.2)}'
      + '.copa-jblock .jmatches{border-color:rgba(240,192,64,.18)}'
      + '.copa-row-note{font-size:11px;color:rgba(255,255,255,.64);padding:2px 10px 8px 10px;line-height:1.4}'
      + '.copa-row-inj{color:#f4c970}'
      + '.copa-row-agg{color:#ffd54a;font-size:11.5px;font-weight:600;letter-spacing:.2px;background:linear-gradient(90deg,rgba(255,213,74,.07),rgba(255,213,74,.02));border-left:2px solid rgba(255,213,74,.45);padding:4px 10px 4px 10px;margin:2px 8px 6px 8px;border-radius:6px}'
      /* ── Rich cards (estilo Liga EA Sports). 2026-05-04. ── */
      + '.copa-card-rich{display:block;background:linear-gradient(180deg,rgba(80,30,10,.45),rgba(15,8,4,.85));border:1px solid rgba(200,150,60,.32);border-radius:10px;margin:6px 8px;padding:10px 8px;box-shadow:0 1px 0 rgba(0,0,0,.4) inset}'
      + '.copa-card-rich.copa-card-leg{margin:6px 0;padding:6px 8px;background:linear-gradient(180deg,rgba(60,40,20,.32),rgba(15,8,4,.78));border-color:rgba(200,150,60,.22)}'
      + '.copa-card-leghdr{font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#f0c45c;text-align:center;margin:0 0 4px;opacity:.85}'
      + '.copa-card-row{display:flex;align-items:center;justify-content:space-between;gap:6px}'
      + '.copa-card-team{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}'
      + '.copa-card-shield{width:48px;height:48px;display:flex;align-items:center;justify-content:center}'
      + '.copa-card-rich.copa-card-leg .copa-card-shield{width:34px;height:34px}'
      + '.copa-card-name{font-family:Rajdhani,sans-serif;font-size:12.5px;font-weight:700;color:#fff;text-align:center;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}'
      + '.copa-card-rich.copa-card-leg .copa-card-name{font-size:11.5px}'
      /* Clasificación visual: ganador (clasifica a siguiente ronda) en
         VERDE con destellos pulsantes; perdedor (eliminado) en ROJO
         atenuado. Solo aplica en single-leg y en sub-card "Global". */
      + '.copa-card-winner-name{color:#5fe08a !important;text-shadow:0 0 8px rgba(95,224,138,.7),0 0 16px rgba(95,224,138,.45);animation:copaWinPulse 1.6s ease-in-out infinite;}'
      + '.copa-card-loser-name{color:#ff5c70 !important;opacity:.78;text-decoration:line-through;text-decoration-color:rgba(255,92,112,.45);}'
      + '@keyframes copaWinPulse{0%,100%{text-shadow:0 0 6px rgba(95,224,138,.45),0 0 12px rgba(95,224,138,.25);}50%{text-shadow:0 0 14px rgba(95,224,138,.95),0 0 24px rgba(95,224,138,.55),0 0 36px rgba(95,224,138,.25);}}'
      /* TBD ("Esperando Rival") en cards con clasif parcial. */
      + '.copa-card-tbd{color:rgba(255,213,74,.85)!important;font-style:italic;letter-spacing:.6px;}'
      /* ❓ animado bajo el escudo cuando el equipo IA tiene alias
         eFootball (equipo SIMIL para juegos sin licencia). Click →
         overlay con alias completo. */
      + '.copa-alias-help{filter:drop-shadow(0 0 4px rgba(255,213,74,.6));}'
      + '@keyframes copaAliasPulse{0%,100%{transform:scale(1);opacity:.85;text-shadow:0 0 4px rgba(255,213,74,.4);}50%{transform:scale(1.22);opacity:1;text-shadow:0 0 10px rgba(255,213,74,.95),0 0 18px rgba(255,213,74,.55);}}'
      + '.copa-card-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:90px}'
      + '.copa-card-score{display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:4px 12px;min-width:80px;text-align:center}'
      + '.copa-card-rich.copa-card-leg .copa-card-score{padding:2px 10px;min-width:70px}'
      + '.copa-card-btn{margin-top:2px}'
      + '.copa-card-meta{font-size:10.5px;color:rgba(255,200,120,.85);font-family:Rajdhani,sans-serif;letter-spacing:.4px}'
      + '.copa-tie-wrap{background:linear-gradient(180deg,rgba(40,20,5,.55),rgba(20,10,3,.85));border:1px solid rgba(220,170,80,.45);border-radius:12px;margin:8px 6px;padding:10px}'
      /* Botones rich (Liga EA-style) */
      + '.copa-card-rich{position:relative;overflow:hidden}'
      + '.copa-card-bgshield{position:absolute;top:50%;transform:translateY(-50%);width:80px;height:80px;object-fit:contain;opacity:.11;pointer-events:none;z-index:0}'
      + '.copa-card-bgshield-l{left:-4px}'
      + '.copa-card-bgshield-r{right:-4px}'
      + '.copa-card-rich > .copa-card-leghdr,.copa-card-rich > .copa-card-row{position:relative;z-index:1}'
      + '.copa-btn-previa-rich{display:inline-block;font-family:Rajdhani,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.2px;color:#ff7a8a;background:rgba(255,40,80,.06);border:1px solid rgba(255,80,120,.55);border-radius:6px;padding:5px 14px;cursor:pointer;text-transform:uppercase}'
      + '.copa-btn-previa-rich:active{background:rgba(255,40,80,.15)}'
      + '.copa-btn-sim-rich{display:inline-block;font-family:Rajdhani,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.5px;color:#5fe08a;background:rgba(60,210,120,.06);border:1px solid rgba(95,224,138,.55);border-radius:6px;padding:5px 14px;cursor:pointer;text-transform:uppercase}'
      + '.copa-btn-sim-rich:active{background:rgba(60,210,120,.18)}'
      + '.copa-card-fin{display:inline-block;font-family:\'Bebas Neue\',sans-serif;font-size:13px;letter-spacing:1.5px;color:#ffd54a;border:1px solid rgba(255,213,74,.45);border-radius:6px;padding:4px 12px;background:rgba(255,213,74,.04)}'
      + '.copa-card-score-num{color:#5fe08a;font-family:\'Bebas Neue\',sans-serif;font-size:30px;letter-spacing:2px;line-height:1}'
      + '.copa-card-score-pending{color:rgba(255,255,255,.5);font-family:\'Bebas Neue\',sans-serif;font-size:24px;letter-spacing:3px;line-height:1}'
      /* Card de ronda en s-copa cuando está completada y los
         clasificados están confirmados — atenuada como las jornadas
         terminadas de Liga EA. */
      + '.copa-rd-done .jbtn.c-copa{filter:grayscale(.55) brightness(.55);opacity:.78}'
      + '.copa-rd-done .copa-rd-cnt{opacity:.85}'
      + '.copa-mrow-done{margin-bottom:0}'
      + '.copa-sim-all{margin-left:8px}'
      + '.chp-event-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}'
      + '.chp-mini-select{flex:1;min-width:120px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:10px}'
      + '.chp-helper{font-size:11px;color:rgba(255,255,255,.55)}'
      + '.chp-acta{max-height:180px;overflow:auto;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;margin-bottom:12px}'
      + '.chp-event-item{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:#fff}'
      + '.chp-event-item:last-child{border-bottom:none}'
      + '.chp-event-empty{font-size:12px;color:rgba(255,255,255,.45)}'
      + '.chp-del{background:transparent;border:none;color:#ff8d8d;cursor:pointer;font-size:12px}'
      + '.copa-live-mini{font-size:12px;color:#f0c040;margin-top:4px}'
      + '.copa-btn-row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}'
      + '.copa-summary-banner{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:rgba(240,192,64,.08);border:1px solid rgba(240,192,64,.18);font-size:12px;color:#f6e0a0}'
      + '.copa-clasificados{margin:6px 0 12px;padding:8px 12px;border-radius:10px;background:rgba(255,215,120,.06);border:1px solid rgba(255,215,120,.12)}'
      + '.copa-bracket-wrap{padding:6px 18px 36px}'
      + '.copa-bracket-banner{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:12px;background:rgba(255,215,120,.08);border:1px solid rgba(255,215,120,.18);color:#f6e0a0;font-size:12px;line-height:1.5;margin-bottom:14px}'
      + '.copa-bracket-banner span{color:rgba(255,255,255,.62)}'
      + '.copa-bracket-banner.done{background:rgba(255,215,120,.14);box-shadow:0 10px 24px rgba(0,0,0,.18)}'
      + '.copa-bracket-grid{overflow-x:auto;padding-bottom:10px}'
      + '.copa-bracket-board{display:flex;gap:18px;align-items:stretch;min-width:max-content;padding-right:8px}'
      + '.copa-bracket-stage{width:248px;flex:0 0 248px;background:linear-gradient(180deg,rgba(24,15,2,.98),rgba(11,11,14,.96));border:1px solid rgba(255,215,120,.14);border-radius:16px;overflow:hidden;box-shadow:0 10px 24px rgba(0,0,0,.22)}'
      + '.copa-bracket-round-head{padding:12px 14px;border-bottom:1px solid rgba(255,215,120,.1);background:linear-gradient(135deg,rgba(123,90,0,.55),rgba(15,15,18,.25))}'
      + '.copa-bracket-round-title{font-family:Oswald,sans-serif;font-size:15px;letter-spacing:1.6px;color:#f6d16f;text-transform:uppercase}'
      + '.copa-bracket-round-sub{font-size:11px;color:rgba(255,255,255,.52);margin-top:2px}'
      + '.copa-bracket-round-body{padding:12px}'
      + '.copa-bracket-lane{display:grid;grid-template-rows:repeat(8,minmax(74px,1fr));gap:10px;min-height:684px;position:relative}'
      + '.copa-bracket-slot{display:flex;align-items:center;position:relative}'
      + '.copa-bracket-stage:not(.first) .copa-bracket-slot::before{content:"";position:absolute;left:-19px;top:0;bottom:0;border-left:2px solid rgba(255,215,120,.14)}'
      + '.copa-bracket-stage:not(.first) .copa-bracket-slot::after{content:"";position:absolute;left:-19px;top:50%;width:19px;border-top:2px solid rgba(255,215,120,.14)}'
      + '.copa-bracket-stage:not(.last) .copa-bracket-card::after{content:"";position:absolute;right:-19px;top:50%;width:19px;border-top:2px solid rgba(255,215,120,.14)}'
      + '.copa-bracket-card{position:relative;width:100%;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);border-radius:12px;padding:10px 10px 9px}'
      + '.copa-bracket-card.played{border-color:rgba(255,215,120,.22);background:rgba(255,215,120,.05)}'
      + '.copa-bracket-card.placeholder{border-style:dashed;background:rgba(255,255,255,.02)}'
      + '.copa-bracket-teams{display:grid;gap:6px}'
      + '.copa-bracket-team{display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,.78);font-weight:700}'
      + '.copa-bracket-team .seed{font-size:9px;color:rgba(255,255,255,.24)}'
      + '.copa-bracket-team.winner{color:#ffd76a}'
      + '.copa-bracket-team.human{color:#91d0ff}'
      + '.copa-bracket-team.winner .seed{color:#ffd76a}'
      + '.copa-bracket-status{font-family:Oswald,sans-serif;font-size:10px;letter-spacing:1.8px;text-transform:uppercase;color:rgba(255,255,255,.44);margin-top:10px}'
      + '.copa-bracket-detail{font-size:12px;color:rgba(255,255,255,.86);margin-top:4px;line-height:1.45}'
      + '.copa-bracket-route{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,215,120,.82);line-height:1.35}'
      + '.copa-bracket-mvp{font-size:11px;color:#f2cd66;margin-top:6px}'
      + '.copa-bracket-empty{border:1px dashed rgba(255,255,255,.12);border-radius:12px;padding:16px 12px;font-size:12px;text-align:center;color:rgba(255,255,255,.38);align-self:start}'
      + '.copa-bracket-qualified{grid-column:1/-1;align-self:end;margin-top:2px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(255,255,255,.74);line-height:1.7}'
      + '.copa-bracket-pill{display:inline-flex;align-items:center;padding:2px 8px;margin:4px 6px 0 0;border-radius:999px;background:rgba(255,215,120,.12);border:1px solid rgba(255,215,120,.18);color:#f6d16f}'
      + '.copa-bracket-pill.human{background:rgba(90,180,255,.12);border-color:rgba(90,180,255,.18);color:#9ad6ff}'
      + '@media (max-width:760px){.copa-bracket-wrap{padding-left:10px;padding-right:10px}.copa-bracket-stage{width:220px;flex-basis:220px}.copa-bracket-board{gap:14px}.copa-bracket-lane{min-height:620px;grid-template-rows:repeat(8,minmax(66px,1fr))}}';
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════════
     Render rich-card estilo Liga EA Sports (escudos grandes + nombre
     completo + score central). El usuario quiere que las cards de Copa
     se vean igual que las de Liga EA, no como filas compactas con
     abreviaturas + números de power.
     ════════════════════════════════════════════════════════════════ */
  /* Mapa nombre→escudo de las 3 ligas de Copa (EA / Hyp / PF) leído
     vía `loadData` — la MISMA fuente que `_collectCopaTeams`.
     Necesario porque `getTeamLogoUrl` resuelve escudos desde
     `window._ligaEaShields`, que se construye con `localStorage.getItem`
     directo del main key. Si la plantilla de una liga vive en
     `LIGA_CACHE` / `_protected` / servidor (p.ej. Primera Federación,
     demasiado grande para el cap de 2 MB del main key), su escudo NO
     llega a `_ligaEaShields` y los equipos IA de esa liga salían con el
     círculo de iniciales aunque el admin tuviera el escudo bien puesto. */
  var _copaShieldCache = null;
  function _copaShieldMap() {
    if (_copaShieldCache) return _copaShieldCache;
    var map = {};
    if (typeof window.loadData === 'function') {
      COPA_LEAGUE_SLUGS.forEach(function (slug) {
        try {
          var d = window.loadData(slug);
          if (!d || !Array.isArray(d.teams)) return;
          d.teams.forEach(function (t) {
            if (!t || !t.name || !t.shield) return;
            var nm = String(t.name).trim();
            if (nm && !map[nm]) map[nm] = String(t.shield);
          });
        } catch (_) {}
      });
    }
    _copaShieldCache = map;
    return map;
  }
  window._copaInvalidateShieldCache = function () { _copaShieldCache = null; };

  /* Un resultado estepona-fallback se trata como "no encontrado" para
     que la cadena de resolución llegue hasta `_copaShieldMap`, que es
     la única fuente que conoce los escudos de PF / Hypermotion (sus
     plantillas viven fuera del main key — ver `_copaShieldMap`). */
  function _isFallbackShieldUrl(u) {
    return !!u && /escudos-fallback\/estepona/.test(String(u));
  }

  /* Resolución URL-only del escudo de un equipo de Copa. Misma cadena
     de fallbacks que `_shieldImg` pero devuelve sólo la URL. */
  function _shieldUrl(name) {
    if (!name) return '';
    var url = '';
    if (typeof window.getTeamLogoUrl === 'function') {
      try { url = window.getTeamLogoUrl(name) || ''; } catch(_){}
    }
    if (_isFallbackShieldUrl(url)) url = '';
    if (!url && typeof window.getLogoEquipo === 'function') {
      try {
        var g = window.getLogoEquipo(name) || '';
        if (!_isFallbackShieldUrl(g)) url = g;
      } catch(_){}
    }
    if (!url) {
      var ratings = window.TEAM_RATINGS || {};
      var entry = ratings[name];
      if (entry && typeof entry === 'object' && entry.shield) url = entry.shield;
    }
    if (!url) {
      var _csm = _copaShieldMap();
      url = _csm[name] || _csm[canonicalTeam(name)] || '';
    }
    return url;
  }
  window._copaResolveShield = _shieldUrl;

  function _shieldImg(name) {
    var url = _shieldUrl(name);
    if (url) {
      return '<img alt="" src="' + escapeHtml(url) + '" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;display:block">';
    }
    /* Fallback: círculo con iniciales. */
    var initials = String(name || '?').replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ]/g,'').substring(0,2).toUpperCase();
    return '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#222;color:#ffd54a;border-radius:50%;font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1px;">' + escapeHtml(initials) + '</div>';
  }

  function _humanIco(name) {
    if (typeof window.humanIcon === 'function') {
      try { return window.humanIcon(name) || ''; } catch(_){}
    }
    return '';
  }

  function _teamColorBg(name) {
    var tc = (window.getTeamColors && window.getTeamColors(name)) || { bg: '#1a2a4a' };
    return tc.bg || '#1a2a4a';
  }

  /* mk-key estable que iaSimLive usa para encontrar los nodos DOM y
     que el persistor de Copa parsea para saber dónde guardar. Formato:
       copa_<ronda>_<idx>_<leg>   (leg = 'i' ida, 'v' vuelta)
     Si en el futuro se añaden caracteres no-alfanuméricos al ronda,
     hay que actualizar el regex en _copaSimLivePersist. */
  function _copaSimMk(ronda, idx, esVuelta) {
    return 'copa_' + ronda + '_' + idx + '_' + (esVuelta ? 'v' : 'i');
  }

  /* Botón estilo Liga EA Sports:
       - Human vs IA / Human vs Human → 📋 PREVIA (rojo, abre pantalla
         de previa con showPrePartidoOverlay).
       - IA vs IA → ▶ SIMULAR (verde): re-usa el motor iaSimLive de
         Liga EA Sports (cronómetro real + acta en vivo). El hook
         _copaSimLivePersist redirige el guardado al backend de Copa.
     Cuando el partido ya está jugado, no devuelve botón (se muestra el
     marcador y el "🏁 FIN"). */
  function _matchActionButton(ronda, idx, esVuelta, m) {
    /* Si cualquiera de los 2 lados es TBD, no se puede simular ni
       jugar — el partido pendiente que aporta el rival debe
       resolverse antes. Mostramos un badge informativo. */
    if (_tbdParse(m.l) || _tbdParse(m.v)) {
      return '<span style="font-size:11px;color:rgba(255,213,74,.7);font-family:Rajdhani,sans-serif;font-style:italic;letter-spacing:.4px;">⏳ Esperando Rival</span>';
    }
    var human = isHuman(m.l, m.v);
    var leg = esVuelta ? 1 : 0;
    if (human) {
      return '<button class="ml-previa-btn copa-btn-previa-rich" '
        + 'onclick="window.copaAbrirPrevia(\'' + ronda + '\',' + idx + ',' + leg + ')">'
        + '📋 PREVIA</button>';
    }
    var mk = _copaSimMk(ronda, idx, !!esVuelta);
    var local = esVuelta ? m.v : m.l;
    var visit = esVuelta ? m.l : m.v;
    var hEsc = local.replace(/'/g, "\\'");
    var aEsc = visit.replace(/'/g, "\\'");
    return '<button id="ia-sim-btn-' + mk + '" class="copa-btn-sim-rich" '
      + 'onclick="window.copaSimLive(\'' + ronda + '\',' + idx + ',' + leg + ')">'
      + '▶ SIMULAR</button>';
  }

  /* Render de un partido SINGLE-LEG (1ª, 2ª, FINAL) o de un sub-row
     (Ida/Vuelta/Global) DENTRO de una tie.
     `score`: { gl, gv, et_gl, et_gv, pen_winner, jugado } o null.
     `actionBtn`: html del botón (o '' para sub-rows leg).
     `simMk`: si está presente, expone IDs `ia-sc-<mk>-a/b` y
       `ia-acta-<mk>` para que window.iaSimLive (Liga EA) pueda animar
       el partido en vivo desde la card de Copa. */
  function _renderMatchCard(opts) {
    var local = opts.local, visit = opts.visit;
    var score = opts.score;
    var actionBtn = opts.actionBtn || '';
    var legLabel = opts.legLabel || '';
    var subtle = !!opts.subtle;
    /* Detección de TBD: si local/visit es un placeholder
       `@<ronda>#<idx>`, lo renderizamos como "Esperando Rival" sin
       escudo (o con el escudo del IA-clasificado si pudiéramos
       inferirlo). El cuadro queda visible pero sin acción hasta que
       el partido pendiente termine. */
    var tbdL = _tbdParse(local);
    var tbdV = _tbdParse(visit);
    var localDisplay = local;
    var visitDisplay = visit;
    if (tbdL) localDisplay = '⏳ Esperando Rival';
    if (tbdV) visitDisplay = '⏳ Esperando Rival';
    var simMk = opts.simMk || '';
    /* Escudos: si es TBD intentamos pintar el escudo del IA-rival
       conocido como referencia (cuando sabemos cuál de los 2 lados
       será el ganador-IA, ej: HvIA). Si no, escudo "?". */
    var hShieldName = local, vShieldName = visit;
    if (tbdL) {
      var hintL = _tbdHintInfo(tbdL);
      hShieldName = hintL.shieldTeam || '';
    }
    if (tbdV) {
      var hintV = _tbdHintInfo(tbdV);
      vShieldName = hintV.shieldTeam || '';
    }
    var hLog = hShieldName ? _shieldImg(hShieldName) : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,213,74,.65);font-size:24px;">⏳</div>';
    var vLog = vShieldName ? _shieldImg(vShieldName) : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,213,74,.65);font-size:24px;">⏳</div>';
    var hIco = _humanIco(local), vIco = _humanIco(visit);
    var hHum = HUMAN_TEAMS.indexOf(canonicalTeam(local)) !== -1;
    var vHum = HUMAN_TEAMS.indexOf(canonicalTeam(visit)) !== -1;
    var anyHum = hHum || vHum;
    var bgL = _teamColorBg(local);
    var bgV = _teamColorBg(visit);
    /* Fondos:
       - IA vs IA → gradient suave con los colores de ambos equipos.
       - Humano vs IA → gradient mucho más llamativo (alpha del color
         del humano subido, sombra exterior intensa, borde de 2 px
         dorado-pulse para que destaque entre los IA-vs-IA).
       - Humano vs Humano (cuartos+) → mismo estilo doble-glow con
         ambos colores y borde dorado-rosa. */
    /* BORDES DE LAS CARDS (regla del usuario, foto 2026-05-04):
         - Humano vs Humano  → BORDE ROSA   (#ff5fb0)
         - Humano vs IA      → BORDE BLANCO (#ffffff)
         - IA vs IA          → BORDE GRIS   (rgba(255,255,255,.22))
       El gradient interior sigue usando los colores de los dos
       equipos para no perder identidad visual. */
    var wrapStyle;
    if (hHum && vHum) {
      /* Humano vs Humano: gradient saturado dual + borde ROSA. */
      wrapStyle = 'background:linear-gradient(120deg,'+bgL+'80 0%,'+bgL+'40 40%,'+bgV+'40 60%,'+bgV+'80 100%);'
        + 'border:2px solid #ff5fb0;'
        + 'box-shadow:0 0 18px rgba(255,95,176,.55),0 0 36px rgba(255,213,74,.22),inset 0 0 0 1px rgba(255,95,176,.55);';
    } else if (anyHum) {
      /* Humano vs IA: gradient lateral fuerte hacia el humano + borde
         BLANCO. Sombra blanca suave para que destaque entre los IA. */
      var humSide = hHum ? bgL : bgV;
      wrapStyle = (hHum
        ? 'background:linear-gradient(to right,'+humSide+'88 0%,'+humSide+'30 40%,transparent 60%,'+bgV+'25 100%);'
        : 'background:linear-gradient(to right,'+bgL+'25 0%,transparent 40%,'+humSide+'30 60%,'+humSide+'88 100%);')
        + 'border:2px solid #ffffff;'
        + 'box-shadow:0 0 14px rgba(255,255,255,.45),0 0 28px ' + humSide + '55,inset 0 0 0 1px rgba(255,255,255,.6);';
    } else {
      /* IA vs IA: gradient suave + borde GRIS sutil. */
      wrapStyle = 'background:linear-gradient(to right,'+bgL+'2e 0%,transparent 44%,transparent 56%,'+bgV+'2e 100%);'
        + 'border:1px solid rgba(255,255,255,.22);'
        + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);';
    }
    /* Escudo del humano como fondo difuso (igual que Liga EA). */
    var bgShieldL = hHum ? '<img src="" data-team="'+escapeHtml(local)+'" alt="" class="copa-card-bgshield copa-card-bgshield-l">' : '';
    var bgShieldV = vHum ? '<img src="" data-team="'+escapeHtml(visit)+'" alt="" class="copa-card-bgshield copa-card-bgshield-r">' : '';
    var scoreTxt;
    var extras = '';
    if (score && score.jugado) {
      scoreTxt = '<span class="copa-card-score-num">' + (score.gl||0) + ' – ' + (score.gv||0) + '</span>';
      if ((score.et_gl||0) || (score.et_gv||0)) extras += '<div class="copa-card-meta">pr ' + (Number(score.gl||0)+Number(score.et_gl||0)) + '-' + (Number(score.gv||0)+Number(score.et_gv||0)) + '</div>';
      if (score.pen_winner) extras += '<div class="copa-card-meta" style="color:#4fd87a">PEN · ' + escapeHtml(score.pen_winner) + '</div>';
    } else if (simMk) {
      /* Pendiente IA-vs-IA: usamos los IDs que window.iaSimLive necesita
         para tickear el marcador en vivo (`ia-sc-<mk>-a/b`). */
      scoreTxt = '<span id="ia-sc-' + simMk + '-a" class="copa-card-score-pending">–</span>'
        + '<span class="copa-card-score-pending" style="margin:0 4px">–</span>'
        + '<span id="ia-sc-' + simMk + '-b" class="copa-card-score-pending">–</span>';
    } else {
      scoreTxt = '<span class="copa-card-score-pending">– – –</span>';
    }
    /* Si el partido ya está jugado, sustituimos el botón por el chip
       "🏁 FIN" (igual que Liga EA Sports). */
    var bottomBtn;
    if (score && score.jugado) {
      bottomBtn = '<div class="copa-card-fin">🏁 FIN</div>';
      /* PARCHE EMPATE-SIN-GANADOR (2026-05-08): si el partido es
         single-leg (legLabel === '') y acabó empatado SIN pen_winner,
         es un caso de bug histórico — la prórroga + penaltis no se
         disparó (p.ej. r16 con _isCopaSL roto antes del fix de hoy).
         Mostramos un botón admin "🖍 WINNER" para que el
         admin desbloquee la eliminatoria sin tener que volver a jugar
         el partido. PIN-gated. */
      var _isTied = false;
      try {
        var _totL = Number(score.gl||0) + Number(score.et_gl||0);
        var _totV = Number(score.gv||0) + Number(score.et_gv||0);
        _isTied = (_totL === _totV);
      } catch(_){}
      if (legLabel === '' && _isTied && !score.pen_winner && opts.forceWinnerCtx) {
        var _fwc = opts.forceWinnerCtx;
        var _hEsc = String(local).replace(/'/g,"\\'");
        var _vEsc = String(visit).replace(/'/g,"\\'");
        bottomBtn += '<div style="margin-top:5px;">'
          + '<button onclick="window._copaForceWinner(\''+_fwc.ronda+'\','+_fwc.idx+',\''+_hEsc+'\',\''+_vEsc+'\')" '
          + 'style="font-family:Oswald,sans-serif;font-size:9px;letter-spacing:1.1px;'
          + 'padding:3px 8px;border-radius:4px;cursor:pointer;'
          + 'background:linear-gradient(135deg,rgba(255,176,32,.18),rgba(255,80,80,.16));'
          + 'color:#ffd0a0;border:1px solid rgba(255,176,32,.45);">'
          + '🖍 WINNER</button>'
          + '</div>';
      }
    } else {
      bottomBtn = actionBtn ? '<div class="copa-card-btn">' + actionBtn + '</div>' : '';
    }
    var legHdr = '';
    if (legLabel) {
      legHdr = '<div class="copa-card-leghdr">' + escapeHtml(legLabel) + '</div>';
    }
    /* Acta vacía pero con el id que iaSimLive busca para inyectar
       eventos durante la simulación en vivo. La hacemos visible solo
       cuando hay eventos. */
    var actaEl = simMk
      ? '<div id="ia-acta-' + simMk + '" class="copa-card-acta" style="display:none"></div>'
      : '';
    /* CLASIFICACIÓN visual: ganador en VERDE con destellos + perdedor
       en ROJO atenuado. Solo se aplica en cards donde el GANADOR ya
       define la clasificación a la siguiente ronda:
         - Single-leg jugado (legLabel === '' → r1, r2, fin).
         - Sub-card "Global" de las eliminatorias two-leg (16avos+).
       En las sub-cards "Ida" / "Vuelta" NO aplicamos color, porque
       ganar la ida no clasifica todavía — depende del aggregate.
       En empate (sin pen_winner) tampoco aplicamos color (caso teórico
       de aggregate empatado en two-leg sin tanda). */
    var winName = '';
    if (score && score.jugado && (legLabel === '' || legLabel === 'Global')) {
      if (score.pen_winner) {
        winName = score.pen_winner;
      } else {
        var totL = Number(score.gl||0) + Number(score.et_gl||0);
        var totV = Number(score.gv||0) + Number(score.et_gv||0);
        if (totL > totV) winName = local;
        else if (totV > totL) winName = visit;
      }
    }
    var hNameClass = '';
    var vNameClass = '';
    if (winName === local) { hNameClass = ' copa-card-winner-name'; vNameClass = ' copa-card-loser-name'; }
    else if (winName === visit) { vNameClass = ' copa-card-winner-name'; hNameClass = ' copa-card-loser-name'; }
    var wrapClass = 'copa-card-rich' + (subtle ? ' copa-card-leg' : '');
    /* Añadimos `ml-score` a la clase del score wrapper para que el
       `closest(".ml-score")` de iaSimLive lo encuentre y aplique las
       clases state-playing/state-finished. */
    return ''
      + '<div class="' + wrapClass + '" style="' + wrapStyle + '">'
      + bgShieldL + bgShieldV
      + legHdr
      + '<div class="copa-card-row">'
      + '<div class="copa-card-team">'
      +   '<div class="copa-card-shield">' + hLog + '</div>'
      +   '<div class="copa-card-name' + hNameClass + (tbdL ? ' copa-card-tbd' : '') + '">' + hIco + escapeHtml(localDisplay) + '</div>'
      + '</div>'
      + '<div class="copa-card-center">'
      +   '<div class="copa-card-score ml-score">' + scoreTxt + '</div>'
      +   bottomBtn
      +   extras
      + '</div>'
      + '<div class="copa-card-team">'
      +   '<div class="copa-card-shield">' + vLog + '</div>'
      +   '<div class="copa-card-name' + vNameClass + (tbdV ? ' copa-card-tbd' : '') + '">' + vIco + escapeHtml(visitDisplay) + '</div>'
      + '</div>'
      + '</div>'
      + actaEl
      /* Panel ACTA DEL PARTIDO (colapsable). Solo se pinta si el match
         está jugado y trae events. Ahora la acta SIEMPRE es accesible
         tras pulsar "🏁 FIN", igual que en Liga EA Sports. */
      + (score && score.jugado && opts.events && opts.events.length
          ? _renderActaPanel(opts.events, local, visit, opts.actaUniqueId || (Math.random().toString(36).slice(2,8)))
          : '')
      + '</div>';
  }

  /* Acta del partido (panel colapsable bajo la card una vez el match
     está jugado). Replica el estilo de Liga EA Sports
     (`_iaCompletedCard` + `_iaEventsHtml` en misc_body_2.html) — el
     usuario quiere poder pulsar el toggle y ver minuto+icono+jugador
     de cada evento. Eventos vienen de `_copa.resultados[ronda…][idx]
     .events` (persistidos por _copaSimLivePersist o el backend). */
  var _COPA_EV_ICOS = {
    'gol':'⚽','pen-gol':'⚽🥅','pen-prov':'🤦','pen-parado':'🖐','pen-fallo':'❌',
    'falta-gol':'⚽🎯','propia':'⚽🚫','roja':'🟥','amarilla':'🟨',
    'd-amarilla':'🟨🟥','sust':'🔄','imbat':'🧤','lesion':'🩹','mvp':'⭐',
    'pen-result':'🥅'
  };
  function _renderEventsList(events, home, away) {
    if (!events || !events.length) {
      return '<div style="padding:12px;text-align:center;color:rgba(255,255,255,.4);font-style:italic;font-family:Oswald,sans-serif;letter-spacing:1px;">SIN EVENTOS REGISTRADOS</div>';
    }
    var sorted = events.slice().sort(function (a, b) {
      return (Number(a.min) || 0) - (Number(b.min) || 0);
    });
    var rows = '';
    sorted.forEach(function (ev) {
      if (!ev) return;
      if (ev.type === 'mvp')    return;  /* MVP a parte abajo */
      if (ev.type === 'played') return;  /* contador interno PJ */
      if (ev.type === 'sust')   return;  /* sustituciones ocultas */
      var ico = _COPA_EV_ICOS[ev.type] || '•';
      if (ev.dbl) ico = '🟨🟥';
      var pname = ev.player || ev.name || '';
      /* Desnuda dorsal viejo "22. Lookman" si vino del IA-batch del
         backend; el flag `num` ya viaja aparte. */
      pname = String(pname).replace(/^\s*\d+\s*[.\-]?\s*/, '').trim();
      var team = ev.team === 'a' ? home : (ev.team === 'b' ? away : '');
      var minLabel = ev.min === 121 ? 'PEN' : (ev.min + '\'');
      var extra = '';
      if (ev._varAnulado) {
        extra = ' <span style="font-size:10px;color:#ff5555;font-weight:700;letter-spacing:.4px">⛔ ANULADA POR 📺 VAR</span>';
      } else if (ev._varConfirmed) {
        extra = ' <span style="font-size:10px;color:#4fd87a;font-weight:700">✓ Confirmado por 📺 VAR</span>';
      }
      rows += '<div style="display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid rgba(255,255,255,.05);">'
        + '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:13px;color:#6ab0d8;min-width:32px;">' + escapeHtml(minLabel) + '</span>'
        + '<span style="font-size:14px;">' + ico + '</span>'
        + '<span style="font-family:Rajdhani,sans-serif;font-size:13px;color:#fff;flex:1;">' + escapeHtml(pname) + extra + '</span>'
        + '<span style="font-family:Rajdhani,sans-serif;font-size:11px;color:rgba(255,255,255,.4);">' + escapeHtml(team) + '</span>'
        + '</div>';
    });
    /* MVP siempre al final si existe */
    var mvpEv = events.find(function (e) { return e && e.type === 'mvp'; });
    if (mvpEv) {
      var mvpName = String(mvpEv.player || mvpEv.name || '').replace(/^\s*\d+\s*[.\-]?\s*/, '').trim();
      var mvpTeam = mvpEv.team === 'a' ? home : (mvpEv.team === 'b' ? away : '');
      rows += '<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid rgba(240,192,64,.25);background:rgba(240,192,64,.03);">'
        + '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:13px;color:#f0c040;min-width:32px;">FIN</span>'
        + '<span style="font-size:14px;">⭐</span>'
        + '<span style="font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;color:#f0c040;flex:1;">' + escapeHtml(mvpName) + '</span>'
        + '<span style="font-family:Rajdhani,sans-serif;font-size:11px;color:rgba(255,255,255,.4);">' + escapeHtml(mvpTeam) + '</span>'
        + '</div>';
    }
    return rows;
  }

  /* PARCHE EMPATE-SIN-GANADOR (2026-05-08): permite al admin marcar
     retroactivamente quién pasa de ronda en una eliminatoria
     single-leg que quedó empatada por un bug del flujo (p.ej. el
     bug de r16 que se arregló hoy: `_isCopaSL` no incluía 'r16' →
     la prórroga + penaltis no se disparaba al pulsar FINALIZAR).
     Sin esto el admin tiene que reiniciar la copa entera o tocar
     la base de datos a mano.
     Flujo:
       1. PIN-gate (admin 747) vía window.pG.
       2. Modal con dos botones (local / visitante).
       3. Click → re-POST a /api/copa/guardar_resultado con los
          mismos scores + `pen_winner` = ganador elegido. El backend
          actualiza la fila y el copaRender refresca el bracket.
       4. Si la ronda es single-leg, dispara _copaResolveTbd para
          que el ganador rellene el TBD de la siguiente ronda.
     NO toca el resto del estado: events, mvp, etc se preservan. */
  window._copaForceWinner = function (ronda, idx, home, away) {
    var doIt = function () {
      var resultados = (_copa && _copa.resultados) || {};
      var resList = resultados[ronda] || [];
      var res = resList[idx];
      if (!res || !res.jugado) {
        alert('No se encontró el resultado guardado del partido.');
        return;
      }
      /* Construye overlay nuevo en cada apertura. */
      var existing = document.getElementById('_copaForceWinnerOv');
      if (existing) existing.remove();
      var ov = document.createElement('div');
      ov.id = '_copaForceWinnerOv';
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:18px;';
      var btnStyle = 'width:100%;padding:14px;border-radius:10px;border:1px solid rgba(255,213,74,.6);background:linear-gradient(135deg,rgba(255,176,32,.20),rgba(255,80,80,.18));color:#ffd0a0;font-family:Oswald,sans-serif;font-size:14px;letter-spacing:1.5px;cursor:pointer;margin-top:10px;text-align:center;';
      var totL = Number(res.gl||0) + Number(res.et_gl||0);
      var totV = Number(res.gv||0) + Number(res.et_gv||0);
      ov.innerHTML = ''
        + '<div style="background:linear-gradient(180deg,#1a0d04,#0a0502);border:2px solid #ffd54a;border-radius:14px;padding:20px 18px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 36px rgba(255,213,74,.45);">'
        +   '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;color:#ffd54a;margin-bottom:6px;">⚠ ARREGLAR EMPATE</div>'
        +   '<div style="font-family:Rajdhani,sans-serif;font-size:13px;color:rgba(255,255,255,.65);line-height:1.45;margin-bottom:6px;">El partido <b>' + escapeHtml(home) + ' ' + totL + '–' + totV + ' ' + escapeHtml(away) + '</b> quedó empatado sin ganador.</div>'
        +   '<div style="font-family:Rajdhani,sans-serif;font-size:12px;color:rgba(255,255,255,.50);margin-bottom:12px;">Indica quién pasa a la siguiente ronda (se registra como ganador de penaltis).</div>'
        +   '<button data-side="a" style="' + btnStyle + '">' + escapeHtml(home) + ' pasa</button>'
        +   '<button data-side="b" style="' + btnStyle + '">' + escapeHtml(away) + ' pasa</button>'
        +   '<button data-side="x" style="margin-top:14px;background:none;border:none;color:rgba(255,255,255,.45);font-family:Oswald,sans-serif;font-size:11px;letter-spacing:2px;cursor:pointer;padding:6px;">CANCELAR</button>'
        + '</div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('button');
        if (!btn) return;
        var side = btn.getAttribute('data-side');
        if (!side || side === 'x') { ov.remove(); return; }
        var winner = side === 'a' ? home : away;
        var payload = {
          ronda: ronda,
          idx: idx,
          es_vuelta: false,
          gl: Number(res.gl) || 0,
          gv: Number(res.gv) || 0,
          et_gl: Number(res.et_gl) || 0,
          et_gv: Number(res.et_gv) || 0,
          pen_winner: winner,
          mvp: res.mvp || '',
          events: res.events || [],
          summary: res.summary || '',
          team_a: home || '',
          team_b: away || ''
        };
        ov.remove();
        saveResult(payload).then(function (d) {
          try {
            if (d && d.copa) copaRender(d.copa);
          } catch (_) {}
          try {
            if (typeof _copaResolveTbd === 'function') {
              _copaResolveTbd(ronda, idx, winner);
            }
          } catch (_) {}
          try { if (typeof init === 'function') init(); } catch (_) {}
        }).catch(function () {
          alert('Error al guardar — comprueba conexión y reintenta.');
        });
      });
    };
    if (typeof window.pG === 'function') window.pG(doIt);
    else doIt();
  };

  /* Toggle expuesto en window para los onclick="..." de la cabecera. */
  window.copaToggleActa = function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var arr = document.getElementById(id + '-arr');
    var isOpen = el.style.display !== 'none' && el.style.display !== '';
    el.style.display = isOpen ? 'none' : 'block';
    if (arr) arr.textContent = isOpen ? '▼' : '▲';
  };

  function _renderActaPanel(events, home, away, uniqueId) {
    if (!events || !events.length) return '';
    var actaId = 'copa-acta-' + uniqueId;
    return ''
      + '<div class="copa-acta-wrap" style="margin-top:6px;border-top:1px solid rgba(220,170,80,.18);">'
      +   '<button onclick="window.copaToggleActa(\'' + actaId + '\')" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:transparent;border:none;color:rgba(255,213,74,.85);font-family:Oswald,sans-serif;font-size:11.5px;letter-spacing:1.6px;text-transform:uppercase;cursor:pointer;">'
      +     '<span>📋 Acta del Partido</span>'
      +     '<span id="' + actaId + '-arr" style="font-size:10px;">▼</span>'
      +   '</button>'
      +   '<div id="' + actaId + '" style="display:none;background:rgba(0,0,0,.18);">'
      +     _renderEventsList(events, home, away)
      +   '</div>'
      + '</div>';
  }

  /* Construye el HTML de partidos de UNA ronda concreta para inyectarlo
     dentro del <div id="copa-rd-XX-body"> de la pantalla dedicada.
     Single-leg (r1/r2/fin): un card por match.
     Two-leg (r16/oct/cua/sf): un wrapper por tie con 3 sub-cards
     (Ida + Vuelta + Global), apilados verticalmente. */
  function _innerHtmlForRound(matches, ronda) {
    if (!matches || !matches.length) {
      return '<div style="padding:24px 14px;text-align:center;color:rgba(255,255,255,.45);font-style:italic;font-family:Rajdhani,sans-serif;font-size:14px;">Pendiente de sorteo</div>';
    }
    var resultados = (_copa && _copa.resultados) || {};
    var twoLeg = !!TWO_LEG[ronda];
    var out = '';
    if (!twoLeg) {
      var resList = resultados[ronda] || [];
      /* Orden de las cards: primero los partidos con humano (para que
         el usuario los encuentre rápido), luego el resto. Mantenemos
         el `idx` original para que las llamadas a copaSimIA / Jugar /
         persistencia sigan apuntando al match correcto. */
      var ordered = matches.map(function (m, idx) { return { m: m, idx: idx }; });
      ordered.sort(function (a, b) {
        var ah = isHuman(a.m.l, a.m.v) ? 0 : 1;
        var bh = isHuman(b.m.l, b.m.v) ? 0 : 1;
        if (ah !== bh) return ah - bh;
        return a.idx - b.idx;
      });
      ordered.forEach(function (item) {
        var m = item.m, idx = item.idx;
        var res = resList[idx];
        var actionBtn = (res && res.jugado) ? '' : _matchActionButton(ronda, idx, false, m);
        var simMk = (!isHuman(m.l, m.v) && !(res && res.jugado)) ? _copaSimMk(ronda, idx, false) : '';
        out += _renderMatchCard({
          local: m.l, visit: m.v, score: res || null, actionBtn: actionBtn, simMk: simMk,
          /* Eventos del acta para toggle "📋 ACTA DEL PARTIDO" en
             cards FIN. */
          events: (res && res.events) || [],
          actaUniqueId: ronda + '-' + idx,
          /* Contexto para el botón admin "🖍 WINNER" si la
             eliminatoria quedó empatada sin pen_winner (bug histórico
             de r16 sin force-ET). */
          forceWinnerCtx: { ronda: ronda, idx: idx }
        });
      });
      return out;
    }
    /* Two-leg: por cada tie generamos 3 sub-rows. m.l = MAYOR nivel
       (juega ida en su campo); m.v = MENOR nivel (juega vuelta en su
       campo, ventaja del modesto). */
    var idaList = resultados[ronda + '_ida'] || [];
    var vtaList = resultados[ronda + '_vta'] || [];
    /* Two-leg: tie con humano implicado va arriba. */
    var orderedTies = matches.map(function (m, idx) { return { m: m, idx: idx }; });
    orderedTies.sort(function (a, b) {
      var ah = isHuman(a.m.l, a.m.v) ? 0 : 1;
      var bh = isHuman(b.m.l, b.m.v) ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return a.idx - b.idx;
    });
    orderedTies.forEach(function (item) {
      var m = item.m, idx = item.idx;
      var ida = idaList[idx];
      var vta = vtaList[idx];
      var btnIda = (ida && ida.jugado) ? '' : _matchActionButton(ronda, idx, false, m);
      var btnVta;
      if (ida && ida.jugado && !(vta && vta.jugado)) {
        btnVta = _matchActionButton(ronda, idx, true, m);
      } else if (!(ida && ida.jugado) && !(vta && vta.jugado)) {
        btnVta = '<span style="font-size:11px;color:rgba(255,255,255,.4);font-family:Rajdhani,sans-serif;">Tras la ida</span>';
      } else {
        btnVta = '';
      }

      var simMkIda = (!isHuman(m.l, m.v) && !(ida && ida.jugado)) ? _copaSimMk(ronda, idx, false) : '';
      var simMkVta = (!isHuman(m.l, m.v) && (ida && ida.jugado) && !(vta && vta.jugado)) ? _copaSimMk(ronda, idx, true) : '';
      out += '<div class="copa-tie-wrap">';
      out += _renderMatchCard({
        local: m.l, visit: m.v, score: ida || null, actionBtn: btnIda,
        legLabel: 'Ida', subtle: true, simMk: simMkIda,
        events: (ida && ida.events) || [],
        actaUniqueId: ronda + '-' + idx + '-ida'
      });
      out += _renderMatchCard({
        local: m.v, visit: m.l, score: vta || null, actionBtn: btnVta,
        legLabel: 'Vuelta', subtle: true, simMk: simMkVta,
        events: (vta && vta.events) || [],
        actaUniqueId: ronda + '-' + idx + '-vta'
      });
      if (ida && ida.jugado && vta && vta.jugado) {
        var sumL = Number(ida.gl||0) + Number(vta.gv||0);
        var sumV = Number(ida.gv||0) + Number(vta.gl||0);
        var winner;
        if (sumL > sumV)      winner = m.l;
        else if (sumV > sumL) winner = m.v;
        else                  winner = vta.pen_winner || m.l;
        var loser = winner === m.l ? m.v : m.l;
        var winSum = winner === m.l ? sumL : sumV;
        var losSum = winner === m.l ? sumV : sumL;
        var globalScore = {
          jugado: true, gl: winSum, gv: losSum,
          et_gl: 0, et_gv: 0,
          pen_winner: (sumL === sumV) ? (vta.pen_winner || winner) : null
        };
        out += _renderMatchCard({
          local: winner, visit: loser, score: globalScore, actionBtn: '',
          legLabel: 'Global', subtle: true
        });
      } else {
        out += _renderMatchCard({
          local: m.l, visit: m.v, score: null, actionBtn: '',
          legLabel: 'Global', subtle: true
        });
      }
      out += '</div>';
    });
    return out;
  }

  /* Mapeo ronda → id de pantalla dedicada (s-copa-rd-XX) y su body. */
  var _S_COPA_ID = {
    r1:  'copa-rd-r1-body',
    r2:  'copa-rd-r2-body',
    r16: 'copa-rd-r16-body',
    oct: 'copa-rd-oct-body',
    cua: 'copa-rd-cua-body',
    sf:  'copa-rd-sf-body',
    fin: 'copa-rd-fin-body'
  };

  function copaRender(copa) {
    /* Rellena el banner #copa-banner con el botón "Iniciar Copa" o
       "Reiniciar Copa", y vuelca los matches en cada <div jmatches>
       estático. NO sustituye toda la pantalla — así se mantiene el
       formato desplegable que el usuario quiere (igual a la liga EA). */
    var banner = document.getElementById('copa-banner');
    if (!banner) return;
    _copa = copa || {};
    applyStoredResultMeta(_copa);
    var sorteo = _copa.sorteo || {};
    var resultados = _copa.resultados || {};
    var clasificados = _copa.clasificados || {};

    /* Banner: Sortear 1ª Ronda · Sortear siguiente ronda (si hace
       falta) · Reiniciar (siempre disponible). */
    var bannerHtml = '';
    if (!sorteo.r1 || !sorteo.r1.length) {
      bannerHtml += '<button class="copa-btn-sortear" onclick="window.copaSortear(\'r1\')">🎯 Iniciar Copa — Sortear 1ª Ronda</button>';
    } else {
      /* helper local: ¿hay AL MENOS UN partido jugado en esta ronda?
         (ida o vuelta para 2-leg, único para single-leg) */
      function _anyPlayedIn(rd){
        var ms = sorteo[rd] || [];
        var twoLeg = !!TWO_LEG[rd];
        var idaR = resultados[twoLeg ? rd + '_ida' : rd] || [];
        var vtaR = resultados[rd + '_vta'] || [];
        for (var k = 0; k < ms.length; k++) {
          if (idaR[k] && idaR[k].jugado) return true;
          if (twoLeg && vtaR[k] && vtaR[k].jugado) return true;
        }
        return false;
      }
      /* Botón "Sortear siguiente":
           - Si la ronda actual YA está confirmada (`clasif.length > 0`)
             y la siguiente no se ha sorteado → botón normal.
           - Si la ronda NO está confirmada PERO tiene al menos 1 partido
             jugado → botón especial (parcial · TBD pendientes) que
             primero confirma parcialmente la ronda actual (creando
             TBDs `@<rd>#N` para los matches no jugados) y luego sortea
             la siguiente. Petición usuario 2026-05-06: las eliminatorias
             siempre se pueden sortear aunque haya humanos pendientes
             — el rival "está esperándole" como TBD en la siguiente
             ronda. */
      for (var i = 0; i < ROUNDS.length - 1; i++) {
        var rd = ROUNDS[i];
        var nx = NEXT_ROUND[rd];
        if (!nx) break;
        var clasif = clasificados[rd] || [];
        var nextHasMatches = sorteo[nx] && sorteo[nx].length;
        if (nextHasMatches) continue;
        if (clasif.length) {
          bannerHtml += '<button class="copa-btn-sortear" onclick="window.copaSortear(\'' + nx + '\')">🎯 Sortear ' + escapeHtml(ROUND_LABEL[nx] || nx) + '</button>';
        } else if (_anyPlayedIn(rd)) {
          /* Auto-clasificar parcial + sortear */
          bannerHtml += '<button class="copa-btn-sortear" onclick="window.copaSortearConParcial(\'' + rd + '\',\'' + nx + '\')" style="background:rgba(255,213,74,.15);border-color:rgba(255,213,74,.7);color:#ffd54a;">🎯 Sortear ' + escapeHtml(ROUND_LABEL[nx] || nx) + ' (TBD pendientes)</button>';
        }
      }
      bannerHtml += '<button class="copa-btn-reset" onclick="window.copaReiniciar()" style="opacity:.6">🔄 Reiniciar Copa</button>';
    }
    if (clasificados.campeon) {
      bannerHtml += '<div class="copa-champion" style="margin-top:8px"><div class="copa-champion-trophy">🏆</div><div class="copa-champion-name">'
        + escapeHtml(clasificados.campeon) + '</div><div class="copa-champion-label">CAMPEÓN DE LA COPA DEL REY</div></div>';
    }
    banner.innerHTML = bannerHtml;

    /* Actualizar el contador X/Y de cada ronda en s-copa + estado de
       "completada" (oscurece la card). El contador cuenta partidos
       jugados / total. Para two-leg, total = matches.length * 2 (ida +
       vuelta) y jugados se acumula entre ambas. */
    /* Helper: pinta el contador y el estado "done" de una card de
       ronda. Se invoca tanto para single-leg (`copa-rd-r1-blk`) como
       para los splits ida/vuelta de las rondas a doble partido
       (`copa-rd-oct-ida-blk`, `copa-rd-oct-vta-blk`, etc., 2026-05-10
       — el usuario quería ver fechas separadas por leg). */
    function _paintRdCard(blkId, cntId, played, total, isFullyDone){
      var blk = document.getElementById(blkId);
      var cntEl = document.getElementById(cntId);
      if (!blk || !cntEl) return;
      var ico, txtCol;
      if (total === 0) { ico = '○'; txtCol = 'rgba(255,255,255,.5)'; }
      else if (played === 0) { ico = '○'; txtCol = 'rgba(255,255,255,.55)'; }
      else if (played < total || !isFullyDone) { ico = '⏳'; txtCol = '#ffd54a'; }
      else { ico = '✅'; txtCol = '#5fe08a'; }
      cntEl.textContent = ico + ' ' + played + '/' + total;
      cntEl.style.color = txtCol;
      if (total > 0 && played >= total && isFullyDone) blk.classList.add('copa-rd-done');
      else blk.classList.remove('copa-rd-done');
    }

    ROUNDS.forEach(function (ronda) {
      var matches = sorteo[ronda] || [];
      var twoLegRd = !!TWO_LEG[ronda];
      var clasifR = (clasificados[ronda] || []).length;
      if (twoLegRd) {
        /* Two-leg → dos cards (ida + vuelta), cada una con su contador. */
        var idaR = resultados[ronda + '_ida'] || [];
        var vtaR = resultados[ronda + '_vta'] || [];
        var totalLeg = matches.length;
        var playedIda = 0, playedVta = 0;
        for (var i = 0; i < matches.length; i++) {
          if (idaR[i] && idaR[i].jugado) playedIda++;
          if (vtaR[i] && vtaR[i].jugado) playedVta++;
        }
        var idaDone = totalLeg > 0 && playedIda >= totalLeg;
        var vtaDone = totalLeg > 0 && playedVta >= totalLeg && !!clasifR;
        _paintRdCard('copa-rd-' + ronda + '-ida-blk',
                     'copa-rd-' + ronda + '-ida-cnt',
                     playedIda, totalLeg, idaDone);
        _paintRdCard('copa-rd-' + ronda + '-vta-blk',
                     'copa-rd-' + ronda + '-vta-cnt',
                     playedVta, totalLeg, vtaDone);
        /* Compat: si alguna instalación legacy aún tiene la card
           combinada `copa-rd-oct-blk`, la actualizamos como antes. */
        _paintRdCard('copa-rd-' + ronda + '-blk',
                     'copa-rd-' + ronda + '-cnt',
                     playedIda + playedVta, totalLeg * 2,
                     (playedIda + playedVta) >= totalLeg * 2 && !!clasifR);
      } else {
        var total = matches.length;
        var played = 0;
        var rL = resultados[ronda] || [];
        for (var i2 = 0; i2 < matches.length; i2++) {
          if (rL[i2] && rL[i2].jugado) played++;
        }
        _paintRdCard('copa-rd-' + ronda + '-blk',
                     'copa-rd-' + ronda + '-cnt',
                     played, total, !!clasifR);
      }
    });

    /* Pintar cada pantalla dedicada con sus partidos. */
    ROUNDS.forEach(function (ronda) {
      var domId = _S_COPA_ID[ronda];
      var body = document.getElementById(domId);
      if (!body) return;
      var matches = sorteo[ronda] || [];
      var actionsHtml = '';
      if (matches.length) {
        var twoLeg = !!TWO_LEG[ronda];
        var idaList = resultados[twoLeg ? ronda + '_ida' : ronda] || [];
        var vtaList = resultados[ronda + '_vta'] || [];
        var pendingIA_ida = false, pendingIA_vta = false;
        for (var m = 0; m < matches.length; m++) {
          var match = matches[m];
          if (isHuman(match.l, match.v)) continue;
          if (!(idaList[m] && idaList[m].jugado)) pendingIA_ida = true;
          if (twoLeg && idaList[m] && idaList[m].jugado && !(vtaList[m] && vtaList[m].jugado)) pendingIA_vta = true;
        }
        var btnsHtml = '';
        if (pendingIA_ida) {
          var lbl = twoLeg ? 'Ida' : (ROUND_LABEL[ronda] || ronda);
          btnsHtml += '<button class="copa-btn-sim copa-sim-all" onclick="window.copaSimTodosIA(\'' + ronda + '\',0)">⚡ Simular IA ' + escapeHtml(lbl) + '</button>';
        }
        if (pendingIA_vta) {
          btnsHtml += '<button class="copa-btn-sim copa-sim-all" onclick="window.copaSimTodosIA(\'' + ronda + '\',1)">⚡ Simular IA Vuelta</button>';
        }
        /* Botón Confirmar clasificados:
             - Si la ronda está COMPLETA (todos jugados) y aún no hay
               clasif → "✅ Confirmar clasificados".
             - Si la ronda NO está completa pero ya hay AL MENOS un
               partido jugado, ofrecemos "✅ Confirmar parcial ·
               clasificar lo jugado y dejar TBD" para que el usuario
               pueda sortear la siguiente ronda con los pendientes
               como "Esperando Rival". */
        var done = isRoundComplete(ronda, matches, resultados);
        var clas = clasificados[ronda] || [];
        var idaArr = resultados[twoLeg ? ronda + '_ida' : ronda] || [];
        var vtaArr = resultados[ronda + '_vta'] || [];
        var anyPlayed = false;
        for (var k = 0; k < matches.length; k++) {
          if (idaArr[k] && idaArr[k].jugado) { anyPlayed = true; break; }
          if (twoLeg && vtaArr[k] && vtaArr[k].jugado) { anyPlayed = true; break; }
        }
        if (done && !clas.length) {
          btnsHtml += '<button class="copa-btn-avanzar" onclick="window.copaClasificar(\'' + ronda + '\')">✅ Confirmar clasificados</button>';
        } else if (!done && anyPlayed && !clas.length) {
          btnsHtml += '<button class="copa-btn-avanzar" onclick="window.copaClasificar(\'' + ronda + '\')" style="background:rgba(255,213,74,.12);border-color:rgba(255,213,74,.7);color:#ffd54a;">✅ Confirmar parcial (TBD pendientes)</button>';
        }
        if (btnsHtml) {
          actionsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:10px 8px 6px;">' + btnsHtml + '</div>';
        }
      }
      body.innerHTML = actionsHtml + _innerHtmlForRound(matches, ronda);
      /* Hidratar las imágenes de fondo (escudos de humanos): el HTML
         las inserta con src vacío + data-team para evitar parsear el
         alias dos veces; aquí ponemos el src real. */
      try {
        body.querySelectorAll('img.copa-card-bgshield').forEach(function (img) {
          var team = img.getAttribute('data-team') || '';
          var url = '';
          if (typeof window.getTeamLogoUrl === 'function') {
            try { url = window.getTeamLogoUrl(team) || ''; } catch(_){}
          }
          if (!url && typeof window.getLogoEquipo === 'function') {
            try { url = window.getLogoEquipo(team) || ''; } catch(_){}
          }
          if (url) img.src = url;
          else img.style.display = 'none';
        });
      } catch(_){}
    });

    syncCalendar(_copa);
    renderBracket(_copa);
  }

  /* Construye el payload de emparejamientos para una ronda dada. El
     cliente conoce a los 82 equipos (ligaExt_*) y sus niveles, así que
     decide aquí mismo: (1) qué equipos juegan, (2) cómo se emparejan
     y (3) quién es local (siempre el de menor power). El backend
     simplemente persiste lo que el cliente le pasa.

     ronda='r1' → 36 equipos (5 humanos + 31 random Primera Fed) → 18 ties
     ronda='r2' → 64 equipos (18 ganadores r1 + 46 pre-clasificados) → 32 ties
     ronda='r16'+ → ties = ganadores de la ronda previa, ya pares. */
  function _computeSorteoPayload(ronda) {
    var clasificados = (_copa && _copa.clasificados) || {};
    var resultados = (_copa && _copa.resultados) || {};
    /* Construimos la lista como ARRAY DE OBJETOS {name,league,power,
       isHuman} para que `_pairTeamsConstrained` pueda aplicar las
       reglas (humano vs PF en r1/r2, no human-vs-human hasta cuartos,
       etc.). El nivel y los nombres se siguen pasando al backend
       igual que antes. */
    var allMap = {};
    _collectCopaTeams().forEach(function (t) { allMap[t.name] = t; });
    /* Resuelve un nombre TBD `@<ronda>#<idx>` al ganador real si la
       ronda anterior ya tiene resultado para ese match.
       Bug 2026-05-06: el cliente confiaba en `clasificados[prev]` que
       podía estar stale (state_set fall-back silencioso o no llegaba
       a sincronizar). Ej: usuario juega r2 con Atlético Madrid
       (humano) y gana. resultados.r2[idx].winner='Atlético Madrid'.
       Pero clasificados.r2[idx] sigue como '@r2#idx'. Al sortear r16,
       Atlético Madrid no aparecía → desaparecía del cuadro.
       Fix: resolver TBDs leyendo directamente de `resultados`, que
       es la fuente autoritativa del backend. */
    function _resolveTbdToWinner(name) {
      var tbd = _tbdParse(name);
      if (!tbd) return name;
      var twoLeg = !!TWO_LEG[tbd.ronda];
      var resList = resultados[twoLeg ? tbd.ronda + '_vta' : tbd.ronda] || [];
      var r = resList[tbd.idx];
      if (r && r.winner) return r.winner;
      /* Two-leg sin vta cerrada → mirar ida (no debería decidir aún,
         pero conservador). */
      if (twoLeg) {
        var idaList = resultados[tbd.ronda + '_ida'] || [];
        var ri = idaList[tbd.idx];
        if (ri && ri.winner) return ri.winner;
      }
      return name; /* sigue TBD */
    }
    function _resolve(name) {
      /* Primero intentamos resolver TBD → ganador real. Si todavía
         es TBD, devolvemos el objeto virtual. */
      var resolved = _resolveTbdToWinner(name);
      var tbd = _tbdParse(resolved);
      if (tbd) {
        return {
          name: resolved,
          league: 'tbd',
          power: 60,
          isHuman: false,
          isTbd: true,
          tbdMayBeHuman: _tbdMayBeHuman(tbd),
          tbdMayBeEa: _tbdMayBeEa(tbd)
        };
      }
      return allMap[resolved] || { name: resolved, league: '', power: 75, isHuman: HUMAN_TEAMS.indexOf(canonicalTeam(resolved)) !== -1 };
    }
    var teams = [];
    if (ronda === 'r1') {
      var built = _buildR1Participants();
      if (!built) return null;
      teams = built.participants.map(_resolve);
    } else if (ronda === 'r2') {
      /* 18 ganadores + 46 pre-clasificados (todo el resto que NO jugó r1) */
      var all = _collectCopaTeams();
      var r1Sorteo = ((_copa.sorteo || {}).r1 || []);
      var r1Res = ((_copa.resultados || {}).r1 || []);
      var jugaronR1 = {};
      r1Sorteo.forEach(function (m) { jugaronR1[m.l] = true; jugaronR1[m.v] = true; });
      var preClasif = all.filter(function (t) { return !jugaronR1[t.name]; });
      /* Ganadores de r1: la fuente AUTORITATIVA es `resultados.r1`
         (mismo criterio que `_resolveTbdToWinner`). Derivar de ahí —
         en vez de depender solo de `clasificados.r1` — hace que el
         sorteo de 2ª Ronda funcione aunque la 1ª no se haya
         "Confirmado" o `clasificados.r1` quedara stale tras una
         escritura batched/asíncrona. Los partidos sin jugar entran
         como TBD `@r1#idx` (rival "Esperando Rival"). */
      var winnersR1;
      if (r1Sorteo.length) {
        winnersR1 = r1Sorteo.map(function (m, idx) {
          var r = r1Res[idx];
          return _resolve((r && r.winner) ? r.winner : ('@r1#' + idx));
        });
      } else {
        winnersR1 = (clasificados.r1 || []).map(_resolve);
      }
      teams = winnersR1.concat(preClasif);
    } else {
      var prev = { r16: 'r2', oct: 'r16', cua: 'oct', sf: 'cua', fin: 'sf' }[ronda];
      teams = (clasificados[prev] || []).map(_resolve);
      if (ronda === 'fin' && teams.length < 2) return null;
    }
    /* Dedup defensivo por nombre: si `sorteo.r1` estuviera stale o
       `clasificados` doblara una entrada, un mismo equipo podría
       colarse 2 veces y descuadrar el bombo (nº impar, equipo en 2
       cruces). Conservamos la primera aparición de cada nombre. */
    var _seenTeam = {};
    teams = teams.filter(function (t) {
      if (!t || !t.name || _seenTeam[t.name]) return false;
      _seenTeam[t.name] = true;
      return true;
    });
    if (!teams.length) return null;
    /* 2026-05-09 robustez paridad respetando reglas EA-vs-no-EA:
       el chequeo previo `teams.length % 2 !== 0 → return null` abortaba
       el sorteo si el nº de equipos resultaba impar. Ahora descartamos
       1 IA no-humano para hacer la cuenta par y proceder.

       Orden de descarte por ronda (preserva la pool de rivales válidos
       para los EA según la regla "EA solo contra PF/Hyp hasta r16"):

         r1/r2/r16 → EA (humanos + EA-IA) solo contra PF o Hyp.
                  Drop: EA-IA → Hyp → PF (último).
                  · Quitar un EA-IA reduce equipos que NECESITAN no-EA.
                  · Quitar un PF / Hyp reduce el pool disponible — peor.
         oct+   → cualquiera (EA-vs-EA permitido).
                  Drop: PF → Hyp → EA (descarta los más débiles primero).

       NUNCA descartamos humanos ni TBDs (ganadores pendientes) si hay
       cualquier IA disponible. Si solo quedan humanos+TBDs (caso edge
       absurdo), pop el último — pero esto es prácticamente imposible. */
    if (teams.length % 2 !== 0) {
      var dropOrder;
      if (ronda === 'r1' || ronda === 'r2' || ronda === 'r16') {
        dropOrder = ['liga-ea-sports', 'liga-hypermotion', 'liga-primera-federacion'];
      } else {
        dropOrder = ['liga-primera-federacion', 'liga-hypermotion', 'liga-ea-sports'];
      }
      try { console.warn('[copa] sortear ' + ronda + ' con ' + teams.length + ' equipos (impar) — descartando 1 IA según prioridad ' + dropOrder.join(' → ')); } catch(_){}
      var dropIdx = -1;
      for (var d = 0; d < dropOrder.length && dropIdx < 0; d++) {
        var prefLeague = dropOrder[d];
        for (var pi = teams.length - 1; pi >= 0; pi--) {
          var t = teams[pi];
          if (t && !t.isHuman && !t.isTbd && t.league === prefLeague) { dropIdx = pi; break; }
        }
      }
      if (dropIdx < 0) {
        /* Sin liga conocida → cualquier IA non-TBD non-humano. */
        for (var qi = teams.length - 1; qi >= 0; qi--) {
          var qt = teams[qi];
          if (qt && !qt.isHuman && !qt.isTbd) { dropIdx = qi; break; }
        }
      }
      if (dropIdx < 0) {
        /* Solo TBDs disponibles (caso raro): descartamos un TBD que NO
           pueda ser humano para preservar la posibilidad humana. */
        for (var ri2 = teams.length - 1; ri2 >= 0; ri2--) {
          var rt = teams[ri2];
          if (rt && !rt.isHuman && rt.isTbd && !rt.tbdMayBeHuman) { dropIdx = ri2; break; }
        }
      }
      if (dropIdx < 0) {
        /* Último recurso: cualquier no-humano (incluido TBD-puede-humano). */
        for (var si = teams.length - 1; si >= 0; si--) {
          var st = teams[si];
          if (st && !st.isHuman) { dropIdx = si; break; }
        }
      }
      if (dropIdx >= 0) teams.splice(dropIdx, 1);
      else teams.pop();
    }
    if (!teams.length) return null;
    /* Single-leg (r1/r2/fin) → host = menor nivel. Two-leg → host (ida) =
       mayor nivel para que la vuelta caiga en el menor nivel. */
    var hostIsLower = !TWO_LEG[ronda];
    var pairs = _pairTeamsConstrained(teams, hostIsLower, ronda);
    var levels = {};
    teams.forEach(function (t) { levels[t.name] = t.power; });
    return {
      ronda: ronda,
      participants: teams.map(function (t) { return t.name; }),
      pairs: pairs,
      levels: levels
    };
  }

  window.copaSortear = function (ronda) {
    /* Petición usuario 2026-05-05: el sorteo es admin-only. PIN 747.
       Aplica a TODAS las rondas (r1 → fin), no solo a "Iniciar Copa".
       Si la sesión ya está desbloqueada (window._adm === true) saltamos
       el prompt — coherente con _ppAdminGate. */
    function _runSorteo(){
      /* `_computeSorteoPayload` puede tirar (datos corruptos, liga sin
         storage, etc.). Sin este try/catch la excepción se tragaba en
         silencio dentro del setTimeout del PIN → el usuario "metía el
         PIN y no pasaba nada". Ahora cualquier fallo se ve. */
      var payload;
      try {
        payload = _computeSorteoPayload(ronda);
      } catch (e) {
        try { console.error('[copa] fallo al preparar el sorteo de ' + ronda, e); } catch (_) {}
        alert('❌ No se pudo preparar el sorteo de ' + (ROUND_LABEL[ronda] || ronda) + ':\n' + ((e && e.message) || e));
        return;
      }
      if (!payload) {
        alert('❌ No hay equipos suficientes en las 3 ligas para sortear ' + (ROUND_LABEL[ronda] || ronda) + '.');
        return;
      }
      function _doFetch(){
        return fetch('/api/copa/sorteo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (r) {
          /* Leer como texto y parsear a mano: si el backend devuelve un
             500 (página HTML de error) `r.json()` rechaza y el fallo
             desaparecía sin avisar. Así detectamos el error real. */
          return r.text().then(function (txt) {
            var d;
            try { d = JSON.parse(txt); }
            catch (_) {
              throw new Error('El servidor respondió con un error (HTTP ' + r.status + ').');
            }
            return d;
          });
        }).then(function (d) {
          if (d && d.ok) copaRender(d.copa);
          else throw new Error((d && d.error) || 'respuesta inválida del servidor');
        }).catch(function (err) {
          try { console.error('[copa] fallo al sortear ' + ronda, err); } catch (_) {}
          alert('❌ No se pudo sortear ' + (ROUND_LABEL[ronda] || ronda) + ':\n' + ((err && err.message) || err));
        });
      }
      /* Overlay del balón con tema Copa del Rey (naranja-marrón). El
         usuario reportó (2026-05-10) que el sorteo tardaba "más de 3
         minutos" — bottleneck era esperar a que las 3 fases de la
         animación terminen ANTES de lanzar el fetch al backend. Ahora
         lanzamos el fetch EN PARALELO con la animación: las fases
         decoran el wait mientras el backend procesa. Si el fetch
         termina antes que la animación, completamos al instante. */
      if (typeof window.ftbolLoaderRun === 'function') {
        var lbl = ROUND_LABEL[ronda] || ronda;
        window.ftbolLoaderRun(
          {
            title: 'COPA DEL REY · SORTEO ' + String(lbl).toUpperCase(),
            sub: 'Preparando bombos…', theme: 'copa', minMs: 300,
            phases: [
              { pct: 30, sub: 'Sembrando equipos por nivel…',         ms: 40 },
              { pct: 60, sub: 'Aplicando restricciones humano vs IA…', ms: 40 },
              { pct: 88, sub: 'Cuadrando cruces…',                    ms: 40 }
            ]
          },
          function(ctx){
            return new Promise(function(resolve){
              /* Lanzar el fetch DESDE EL INICIO (paralelo con phases). */
              var fetchPromise = _doFetch();
              var i = 0;
              var phases = [
                { pct: 30 }, { pct: 60 }, { pct: 88 }
              ];
              function next(){
                if (i >= phases.length){
                  ctx.progress(95, 'Lanzando sorteo…');
                  fetchPromise.then(function(){
                    ctx.progress(100, 'Hecho');
                    resolve();
                  }).catch(function(){
                    ctx.progress(100, 'Error');
                    resolve();
                  });
                  return;
                }
                ctx.progress(phases[i++].pct);
                setTimeout(next, 30);  /* era 80 ms */
              }
              next();
            });
          }
        );
      } else {
        _doFetch();
      }
    }
    /* PIN admin vía el teclado digital in-app (window.pG) en vez de
       window.prompt: el prompt nativo está capado en muchos webviews
       móviles (el sorteo "no hacía nada") y además no desbloqueaba la
       sesión, así que re-pedía el PIN en cada ronda/click — el bucle
       que reportó el usuario. pG abre el numpad, marca window._adm y
       ejecuta _runSorteo; si ya está admin, lo ejecuta directo. */
    if (typeof window.pG === 'function') window.pG(_runSorteo);
    else _runSorteo();
  };

  window.copaSimIA = function (ronda, idx, esVuelta) {
    var matches = (_copa.sorteo || {})[ronda] || [];
    if (idx >= matches.length) return;
    var m = matches[idx];
    var local = esVuelta ? m.v : m.l;
    var visitante = esVuelta ? m.l : m.v;
    var domId = 'csc-' + getResultKey(ronda, !!esVuelta) + '-' + idx;
    var result = simulateCupMatch(local, visitante, { twoLeg: !!TWO_LEG[ronda] });
    var totalSeconds = 30 + (((result.et_gl || 0) || (result.et_gv || 0)) ? 10 : 0) + (result.pen_winner ? 4 : 0);
    runSimCountdown(domId, totalSeconds, function () {
      saveSimulatedMatch(ronda, idx, !!esVuelta, { local: local, visitante: visitante }, result)
        .then(function (d) {
          if (!d.ok) alert('❌ ' + (d.error || 'Error guardando simulación')); 
        });
    });
  };

  window.copaSimTodosIA = function (ronda, esVuelta) {
    /* Para evitar simulaciones en masa accidentales, el botón
       "⚡ Simular IA" pide el PIN admin 747. Se usa el teclado digital
       in-app (window.pG) en vez de window.prompt — mismo motivo que en
       copaSortear: el prompt nativo falla en móvil y re-pedía el PIN
       en cada click. */
    if (typeof window.pG === 'function') { window.pG(function(){ _runSimTodos(ronda, esVuelta); }); }
    else { _runSimTodos(ronda, esVuelta); }
  };

  function _runSimTodos(ronda, esVuelta) {
    var matches = (_copa.sorteo || {})[ronda] || [];
    var resList = getResultList(ronda, !!esVuelta);
    var pending = [];
    matches.forEach(function (m, idx) {
      if (isHuman(m.l, m.v)) return;
      if (resList[idx] && resList[idx].jugado) return;
      pending.push(idx);
    });
    if (!pending.length) {
      alert('No hay partidos IA pendientes en esta fase.');
      return;
    }
    /* Lanzamos TODOS en paralelo (petición usuario 2026-05-05).
       Stagger micro de 10 ms entre arranques solo para que cada
       iaSimLive tenga su frame de pintura antes del siguiente —
       sin esto los timers internos del motor de eventos se podían
       solapar y romper la contención. iaSimLive tickea 1 game-min
       = 1 sec real → todos terminan en ~90 s total (paralelos),
       no en 18 × 90 s = 27 minutos. */
    var i = 0;
    function next() {
      if (i >= pending.length) return;
      var idx = pending[i++];
      try {
        if (typeof window.copaSimLive === 'function') {
          window.copaSimLive(ronda, idx, !!esVuelta);
        } else {
          window.copaSimIA(ronda, idx, !!esVuelta);
        }
      } catch(_){}
      setTimeout(next, 10);
    }
    next();
  };

  window.copaClasificar = function (ronda) {
    fetch('/api/copa/clasificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ronda: ronda })
    }).then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) copaRender(d.copa); });
  };

  /* Combo "Confirmar parcial + Sortear siguiente" (2026-05-06).
     Tras la regla del usuario "siempre se puede sortear ronda
     siguiente aunque haya humanos pendientes", el banner de la
     pantalla principal de Copa expone un botón "🎯 Sortear <next>
     (TBD pendientes)" cuando la ronda actual tiene al menos un
     partido jugado pero no se ha confirmado clasificados. Este
     handler:
       1. POST /api/copa/clasificar (ronda actual) → backend escribe
          clasificados[rd] con TBDs `@<rd>#N` para matches no jugados.
       2. Recibido d.copa, actualizamos _copa síncrono.
       3. Llamamos copaSortear(nextRonda), que ya respeta TBDs vía
          `_resolve` y `tbdMayBeHuman`.
     Sin esto, el usuario tenía que ir manualmente a la pantalla
     de la ronda y pulsar "✅ Confirmar parcial" — un paso extra
     confuso que el usuario no sabía que existía. */
  window.copaSortearConParcial = function (rondaActual, rondaSiguiente) {
    fetch('/api/copa/clasificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ronda: rondaActual })
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) {
          alert('❌ No se pudo confirmar parcial de ' + (ROUND_LABEL[rondaActual] || rondaActual) + ': ' + (d.error || ''));
          return;
        }
        _copa = d.copa || _copa;
        copaRender(_copa);
        /* Pequeño delay para que el usuario vea la ronda confirmada
           antes de lanzar el overlay del sorteo siguiente. */
        setTimeout(function(){ window.copaSortear(rondaSiguiente); }, 200);
      })
      .catch(function(){
        alert('❌ Error de red al confirmar parcial. Vuelve a intentarlo.');
      });
  };

  /* Reiniciar Copa requiere PIN admin 747 (petición usuario
     2026-05-05). Se reusa window.pG (mismo gate que el resto de
     acciones admin: Sim/Res en Resto de Ligas, Sortear, etc.). Si
     la sesión admin ya está unlocked, pG ejecuta la callback al
     instante. Fallback al confirm directo si pG no estuviera
     disponible por timing raro al boot. */
  window.copaReiniciar = function () {
    function _doReset(){
      if (!confirm('¿Reiniciar Copa del Rey? Se perderán todos los resultados y bajas de Copa seguirán en ficha hasta agotarse.')) return;
      fetch('/api/copa/reiniciar', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) copaRender({}); });
    }
    if (typeof window.pG === 'function') {
      window.pG(_doReset);
    } else {
      _doReset();
    }
  };

  window.copaJugar = function (ronda, idx, esVuelta) {
    ensureHumanPanelEnhancements();
    var matches = (_copa.sorteo || {})[ronda] || [];
    if (idx >= matches.length) return;
    var m = matches[idx];
    var local = esVuelta ? m.v : m.l;
    var visitante = esVuelta ? m.l : m.v;
    var twoLeg = !!TWO_LEG[ronda];
    var panel = document.getElementById('copa-human-panel');
    if (!panel) return;
    panel.dataset.ronda = ronda;
    panel.dataset.idx = idx;
    panel.dataset.vuelta = esVuelta ? '1' : '0';
    panel.dataset.twoleg = twoLeg ? '1' : '0';
    panel._manualEvents = [];
    panel._manualInjuries = [];

    document.getElementById('chp-local').textContent = local;
    document.getElementById('chp-visit').textContent = visitante;
    document.getElementById('chp-gl').value = '0';
    document.getElementById('chp-gv').value = '0';
    document.getElementById('chp-et-gl').value = '0';
    document.getElementById('chp-et-gv').value = '0';
    document.getElementById('chp-mvp').value = '';
    document.getElementById('chp-et-section').style.display = 'none';
    document.getElementById('chp-pen-section').style.display = 'none';
    buildPenaltyTeamOptions(local, visitante);
    renderHumanEventList();
    refreshHumanPlayerSelect();

    var aggEl = document.getElementById('chp-agg-info');
    if (esVuelta && aggEl) {
      var ida = (((_copa.resultados || {})[ronda + '_ida'] || [])[idx]) || null;
      if (ida) {
        aggEl.textContent = 'Ida: ' + m.l + ' ' + ida.gl + ' – ' + ida.gv + ' ' + m.v;
        aggEl.style.display = 'block';
      } else {
        aggEl.textContent = 'Ida pendiente: primero debes cerrar la ida.';
        aggEl.style.display = 'block';
      }
    } else if (aggEl) {
      aggEl.style.display = 'none';
    }

    panel.classList.add('show');
  };

  window.chpCheckEmpate = function () {
    var gl = parseInt(document.getElementById('chp-gl').value, 10) || 0;
    var gv = parseInt(document.getElementById('chp-gv').value, 10) || 0;
    var panel = document.getElementById('copa-human-panel');
    var twoLeg = panel && panel.dataset.twoleg === '1';
    var esVuelta = panel && panel.dataset.vuelta === '1';
    if (!twoLeg && gl === gv) document.getElementById('chp-et-section').style.display = 'block';
    else if (!twoLeg) document.getElementById('chp-et-section').style.display = 'none';
    if (twoLeg && esVuelta) _chpCheckAggregate();
  };

  function _chpCheckAggregate() {
    var panel = document.getElementById('copa-human-panel');
    var ronda = panel.dataset.ronda;
    var idx = parseInt(panel.dataset.idx, 10);
    var ida = (((_copa.resultados || {})[ronda + '_ida'] || [])[idx]) || {};
    var glVta = parseInt(document.getElementById('chp-gl').value, 10) || 0;
    var gvVta = parseInt(document.getElementById('chp-gv').value, 10) || 0;
    var totalL = Number(ida.gl || 0) + gvVta;
    var totalV = Number(ida.gv || 0) + glVta;
    document.getElementById('chp-pen-section').style.display = totalL === totalV ? 'block' : 'none';
  }

  window.chpCheckET = function () {
    var gl = parseInt(document.getElementById('chp-gl').value, 10) || 0;
    var gv = parseInt(document.getElementById('chp-gv').value, 10) || 0;
    var etGl = parseInt(document.getElementById('chp-et-gl').value, 10) || 0;
    var etGv = parseInt(document.getElementById('chp-et-gv').value, 10) || 0;
    document.getElementById('chp-pen-section').style.display = (gl + etGl === gv + etGv) ? 'block' : 'none';
  };

  window.chpAddEvent = function () {
    var panel = document.getElementById('copa-human-panel');
    var evType = document.getElementById('chp-evt-type').value;
    var side = document.getElementById('chp-evt-team').value;
    var playerVal = document.getElementById('chp-evt-player').value;
    if (!playerVal) return;
    var parts = playerVal.split('|');
    var local = document.getElementById('chp-local').textContent.trim();
    var visitante = document.getElementById('chp-visit').textContent.trim();
    var teamName = side === 'a' ? local : visitante;
    var icoMap = {
      gol: '⚽', 'falta-gol': '⚽🎯', 'pen-gol': '⚽🥅', 'pen-fallo': '❌🥅', 'pen-prov': '🤦🥅', 'pen-parado': '🖐🥅', propia: '⚽🚫', amarilla: '🟨', 'd-amarilla': '🟨🟥', roja: '🟥'
    };
    panel._manualEvents.push({
      min: 90,
      team: side,
      realTeam: teamName,
      player: [parts[0], parts[1]],
      ico: icoMap[evType] || '•',
      type: evType
    });
    renderHumanEventList();
  };

  window.chpRemoveEvent = function (idx) {
    var panel = document.getElementById('copa-human-panel');
    if (!panel || !panel._manualEvents) return;
    panel._manualEvents.splice(idx, 1);
    renderHumanEventList();
  };

  window.chpAddRandomInjury = function () {
    var panel = document.getElementById('copa-human-panel');
    if (!panel) return;
    var local = document.getElementById('chp-local').textContent.trim();
    var visitante = document.getElementById('chp-visit').textContent.trim();
    var pickTeam = Math.random() < 0.5 ? local : visitante;
    var split = splitSquad(pickTeam);
    var active = split.active;
    var bench = split.bench;
    if (!active.length) return;
    var lesiones = typeof window.generarLesionesPartido === 'function'
      ? window.generarLesionesPartido(pickTeam, pickTeam, active, [], bench, [], 90)
      : [];
    var raw = lesiones && lesiones[0];
    if (!raw) {
      var p = pickWeightedPlayer(active);
      if (!p) return;
      var tipo = window.LESION_STORE_UTILS && window.LESION_STORE_UTILS.sortearGrado ? window.LESION_STORE_UTILS.sortearGrado() : { grado: 1, nombre: 'Leve', emoji: '🟡' };
      var partidos = window.LESION_STORE_UTILS && window.LESION_STORE_UTILS.sortearPartidos ? window.LESION_STORE_UTILS.sortearPartidos(tipo) : 1;
      if (window.LESION_STORE_UTILS && window.LESION_STORE_UTILS.registrar) window.LESION_STORE_UTILS.registrar(p[1], pickTeam, partidos, tipo);
      var injury = { jugador: p, nombre: p[1], teamName: pickTeam, equipo: pickTeam, tipo: tipo, grado: tipo.grado, gradoNombre: tipo.nombre, gradoEmoji: tipo.emoji, descripcion: '', partidos: partidos };
      panel._manualInjuries.push(injury);
      ensureStoreCounters(p[1], pickTeam, partidos);
      renderHumanEventList();
      alert('🩹 ' + p[1] + ' (' + pickTeam + ') queda lesionado. La baja de Copa ya se ha registrado.');
      return;
    }
    if (typeof window.aplicarLesionEnSimulacion === 'function') window.aplicarLesionEnSimulacion(raw, active, []);
    var injuryData = {
      jugador: raw.jugador,
      nombre: raw.jugador && raw.jugador[1],
      teamName: raw.teamName,
      equipo: raw.teamName,
      tipo: raw.tipo,
      grado: raw.tipo && raw.tipo.grado,
      gradoNombre: raw.tipo && raw.tipo.nombre,
      gradoEmoji: raw.tipo && raw.tipo.emoji,
      descripcion: (window.LESION_STORE && raw.jugador && window.LESION_STORE[raw.jugador[1]] && window.LESION_STORE[raw.jugador[1]].descripcion) || '',
      partidos: raw.partidos
    };
    panel._manualInjuries.push(injuryData);
    ensureStoreCounters(injuryData.nombre, injuryData.teamName, injuryData.partidos);
    renderHumanEventList();
    alert('🩹 ' + injuryData.nombre + ' (' + injuryData.teamName + ') queda lesionado. La baja de Copa ya se ha registrado.');
  };

  window.chpGuardar = function () {
    var panel = document.getElementById('copa-human-panel');
    var ronda = panel.dataset.ronda;
    var idx = parseInt(panel.dataset.idx, 10);
    var esVuelta = panel.dataset.vuelta === '1';
    var twoLeg = panel.dataset.twoleg === '1';
    var local = document.getElementById('chp-local').textContent.trim();
    var visitante = document.getElementById('chp-visit').textContent.trim();
    var gl = parseInt(document.getElementById('chp-gl').value, 10) || 0;
    var gv = parseInt(document.getElementById('chp-gv').value, 10) || 0;
    var etGl = document.getElementById('chp-et-section').style.display !== 'none' ? (parseInt(document.getElementById('chp-et-gl').value, 10) || 0) : 0;
    var etGv = document.getElementById('chp-et-section').style.display !== 'none' ? (parseInt(document.getElementById('chp-et-gv').value, 10) || 0) : 0;
    var penWinner = document.getElementById('chp-pen-section').style.display !== 'none' ? document.getElementById('chp-pen-winner').value : '';
    if (!twoLeg) {
      if (gl + etGl === gv + etGv && !penWinner) {
        alert('⚠️ Empate — indica el ganador en penaltis.');
        return;
      }
    } else if (esVuelta) {
      var ida = (((_copa.resultados || {})[ronda + '_ida'] || [])[idx]) || {};
      var aggL = Number(ida.gl || 0) + gv;
      var aggV = Number(ida.gv || 0) + gl;
      if (aggL === aggV && !penWinner) {
        alert('⚠️ Empate global — indica el ganador en penaltis.');
        return;
      }
    }
    var mvp = document.getElementById('chp-mvp').value.trim();
    var events = (panel._manualEvents || []).slice();
    if (mvp) {
      events.push({ min: 120, ico: '⭐', team: local === (mvp && local) ? 'a' : 'a', player: ['', mvp], type: 'mvp', realTeam: local });
    }
    var injuries = (panel._manualInjuries || []).slice();
    var payload = {
      ronda: ronda,
      idx: idx,
      es_vuelta: esVuelta,
      gl: gl,
      gv: gv,
      et_gl: etGl,
      et_gv: etGv,
      pen_winner: penWinner || null,
      mvp: mvp,
      events: events,
      injuries: injuries,
      summary: buildSummary({ gl: gl, gv: gv, et_gl: etGl, et_gv: etGv, pen_winner: penWinner, pen_score: '', mvp: mvp }, local, visitante),
      pen_score: '',
      team_a: local,
      team_b: visitante,
      jugado: true
    };
    saveResult(payload).then(function (d) {
      if (!d.ok) {
        alert('❌ ' + (d.error || 'No se pudo guardar el partido'));
        return;
      }
      applyHumanResultMeta(payload, local, visitante);
      panel.classList.remove('show');
      copaRender(d.copa);
      if (injuries.length && typeof window.showLesionPostOverlay === 'function') window.showLesionPostOverlay(injuries, null);
    });
  };

  window.chpCerrar = function () {
    var panel = document.getElementById('copa-human-panel');
    if (panel) panel.classList.remove('show');
  };

  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'chp-evt-team') refreshHumanPlayerSelect();
  });

  /* PREVIA de Copa: dispara la pantalla de pre-partido (igual que en
     Liga EA) con compKey='copa' para que use la pelota Tsubasa J Pro
     y prórroga + penaltis automáticos (showPrePartidoOverlay del
     index.bundle.js ya lo cablea). */
  window.copaAbrirPrevia = function (ronda, idx, esVuelta) {
    var sorteo = (_copa && _copa.sorteo) || {};
    var matches = sorteo[ronda] || [];
    var m = matches[idx];
    if (!m) return;
    var local = esVuelta ? m.v : m.l;
    var visit = esVuelta ? m.l : m.v;
    var isHvH = (typeof esHumano === 'function')
      ? (esHumano(local) && esHumano(visit))
      : (HUMAN_TEAMS.indexOf(canonicalTeam(local)) !== -1 && HUMAN_TEAMS.indexOf(canonicalTeam(visit)) !== -1);
    var compKey = (ronda === 'fin') ? 'copa-fin' : 'copa';
    var matchKey = 'copa_' + ronda + '_' + idx + (esVuelta ? '_v' : '_i');
    var duracion = (typeof window._mlRealDurationLabel === 'function')
      ? window._mlRealDurationLabel({ isHvH: isHvH, humanInvolved: !isHvH })
      : (isHvH ? '16.5 min' : '13.5 min');
    /* Memo para que showPrePartidoOverlay rellene el meta con los
       equipos correctos (igual que Liga EA hace con _ppPreviaTeams). */
    /* Resolvemos los escudos AQUÍ (vía la cadena de Copa, que sí
       conoce PF / Hypermotion) y los pasamos como override. Sin esto
       `_renderPreviaMeta` cae a `getTeamLogoUrl`/`getLogoEquipo`, que
       no ven las plantillas fuera del main key, y los equipos de PF
       (p.ej. Teruel) salían con el escudo genérico 🛡️ apagado. */
    window._ppPreviaTeams = { home: local, away: visit, j: 0, comp: compKey, ronda: ronda, idx: idx, esVuelta: !!esVuelta, homeLogo: _shieldUrl(local), awayLogo: _shieldUrl(visit) };
    window._ppCustomCallback = function () {
      window._ppPreviaTeams = null;
      /* Tras "▶ COMENZAR PARTIDO" en la previa, abrimos el gm-modal de
         Copa del Rey (igual flujo que Liga EA via abrirResultadoLiga).
         abrirCopa cablea el flag _isCopa para que gmEndMatch persista
         el resultado vía /api/copa/guardar_resultado y refresque la
         pantalla de la ronda al terminar. */
      if (typeof window.abrirCopa === 'function') {
        try { window.abrirCopa(ronda, idx, !!esVuelta, local, visit); }
        catch(e) { try { console.error('[copa] abrirCopa', e); } catch(_){} }
      }
      try { copaInit(); } catch(_){}
    };
    if (typeof window.showPrePartidoOverlay === 'function') {
      /* Instalar observer ANTES del render del bundle para cazar la
         primera mutación de pp-vs (alias → ❓ inmediato). 2026-05-08. */
      try { _copaInstallVsObserver(); } catch(_){}
      window.showPrePartidoOverlay(matchKey, compKey, 'Sí', duracion, isHvH);
      try { _copaInjectExtraConfirms(ronda); } catch(_){}
      /* La fecha del partido tiene que coincidir con la del calendario
         (s-calendario.html). El bundle pone "hoy" porque _mmCalLabel
         solo cubre 'copa' = 1/128. Sobrescribimos a mano leyendo el
         dateMap del calendario (.ag-r). El delay 80ms da tiempo a que
         `_mmInjectEnv` haya rellenado el #pp-env primero. */
      /* La fecha se aplica con TRES retries (80/240/600 ms) y un
         MutationObserver que vigila #pp-env: si el bundle re-pinta
         el envelope (p.ej. al togglear un item), volvemos a poner
         la fecha del calendario. Se desconecta cuando la previa se
         cierra. */
      /* Cobertura ampliada (0..2.4 s) para que la fecha aparezca en
         ≤ 50 ms tras el primer pintado del bundle. 2026-05-08. */
      setTimeout(function () { try { _copaOverridePrevDate(ronda, !!esVuelta); } catch(_){} }, 0);
      setTimeout(function () { try { _copaOverridePrevDate(ronda, !!esVuelta); } catch(_){} }, 50);
      setTimeout(function () { try { _copaOverridePrevDate(ronda, !!esVuelta); } catch(_){} }, 200);
      setTimeout(function () { try { _copaOverridePrevDate(ronda, !!esVuelta); } catch(_){} }, 600);
      setTimeout(function () { try { _copaOverridePrevDate(ronda, !!esVuelta); } catch(_){} }, 1500);
      _copaInstallEnvObserver(ronda, !!esVuelta);
      /* Reemplazar el texto del alias eFootball ("🎮 Nassaji Mazan…")
         por un botón ❓ animado bajo el nombre del equipo. Al pulsarlo
         emerge un overlay con el alias completo en grande. Esto resuelve
         el problema de truncamiento cuando el alias es largo (foto del
         usuario 2026-05-04). El observer del overlay reaplica esto en
         cada repaint de `#pp-vs`. */
      /* Cobertura ampliada (0..3 s) para que el reemplazo del alias
         sea inmediato aunque el bundle renderice pp-vs en varias
         fases. 2026-05-08. */
      setTimeout(function () { try { _copaReplaceAliasText(); } catch(_){} }, 0);
      setTimeout(function () { try { _copaReplaceAliasText(); } catch(_){} }, 80);
      setTimeout(function () { try { _copaReplaceAliasText(); } catch(_){} }, 240);
      setTimeout(function () { try { _copaReplaceAliasText(); } catch(_){} }, 600);
      setTimeout(function () { try { _copaReplaceAliasText(); } catch(_){} }, 1200);
      setTimeout(function () { try { _copaReplaceAliasText(); } catch(_){} }, 2400);
      _copaInstallVsObserver();
    } else {
      alert('No se pudo abrir la previa: showPrePartidoOverlay no disponible.');
    }
  };

  /* Estado local de los 2 toggles de Copa (Prórroga / Penaltis). Vacío
     significa "no marcado". El bundle usa `_ppChecked[id]` para
     Balón; nosotros usamos esto en paralelo para los 2 ids extra,
     porque `_ppItems` y `_ppChecked` son privados del IIFE. */
  var _copaConfirmState = { prorroga: false, penaltis: false };

  /* Flag que indica si la PREVIA actualmente abierta es de Copa.
     Usábamos un marcador DOM `[data-copa-rules]` en `#pp-alerts`,
     pero el bundle hace `alerts.innerHTML = ...` cada vez que toggle-
     amos un item (línea 5373 del index.bundle.js, parte de
     `_renderPreviaMeta`), así que el marcador se BORRA al primer
     click en Balón → mis Prórroga/Penaltis no se re-inyectaban. Una
     variable de módulo es robusta a esos re-renders. */
  var _copaPreviaActive = false;

  /* Wrapper sobre `_ppRefreshUnlock` que también requiere los 2
     toggles de Copa antes de habilitar el botón CONFIRMAR. */
  function _copaWrapPpRefreshUnlock() {
    if (typeof window._ppRefreshUnlock !== 'function') return;
    if (window._ppRefreshUnlock.__copaWrapped) return;
    var orig = window._ppRefreshUnlock;
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      try {
        var btn = document.getElementById('pp-confirm-btn');
        if (!btn) return ret;
        /* Solo aplicamos la regla si la previa actual es de Copa. */
        if (!_copaPreviaActive) return ret;
        if (!_copaConfirmState.prorroga || !_copaConfirmState.penaltis) {
          btn.disabled = true;
          if (btn.getAttribute('data-pp-stage') !== '2') {
            btn.textContent = '🔒 CONFIRMA PRÓRROGA Y PENALTIS';
          }
        }
      } catch(_){}
      return ret;
    };
    wrapped.__copaWrapped = true;
    window._ppRefreshUnlock = wrapped;
  }

  /* Wrap `_ppToggle` para que cuando el id sea 'prorroga' o 'penaltis'
     (nuestros 2 items extra) actualice nuestro estado local en lugar
     de tocar `_ppChecked` del bundle (que no los conoce). Para los
     ids estándar (Balón) delega al original.

     Además, después de que el bundle re-renderice `_renderList`
     (cualquier toggle redibuja toda la lista del bundle, perdiendo
     nuestros items), reinyectamos Prórroga + Penaltis. */
  function _copaWrapPpToggle() {
    if (typeof window._ppToggle !== 'function') return;
    if (window._ppToggle.__copaWrapped) return;
    var orig = window._ppToggle;
    var wrapped = function (id) {
      var copaIds = { prorroga: 1, penaltis: 1 };
      if (copaIds[id]) {
        /* Toggle local — NO llamamos al bundle. */
        _copaConfirmState[id] = !_copaConfirmState[id];
        _copaRenderExtraConfirms();
        if (typeof window._ppRefreshUnlock === 'function') window._ppRefreshUnlock();
        return;
      }
      var ret = orig.apply(this, arguments);
      try {
        /* Tras el toggle de Balón el bundle re-renderiza pp-list (que
           borra mis 2 items) y pp-alerts (sub _renderPreviaMeta). Aquí
           re-inyecto si la previa activa es de Copa. */
        if (_copaPreviaActive) {
          _copaRenderExtraConfirms();
          if (typeof window._ppRefreshUnlock === 'function') window._ppRefreshUnlock();
        }
      } catch(_){}
      return ret;
    };
    wrapped.__copaWrapped = true;
    window._ppToggle = wrapped;
  }

  function _copaRenderExtraConfirms() {
    var list = document.getElementById('pp-list');
    if (!list) return;
    /* Quitamos versiones previas */
    list.querySelectorAll('[data-copa-confirm]').forEach(function (n) { n.remove(); });
    var rows = [
      { key: 'prorroga', ico: '⏱', lbl: 'Prórroga',  val: 'SÍ' },
      { key: 'penaltis', ico: '🥅', lbl: 'Penaltis',  val: 'SÍ' }
    ];
    rows.forEach(function (it) {
      var checked = !!_copaConfirmState[it.key];
      var div = document.createElement('div');
      div.className = 'pp-item' + (checked ? ' checked' : '');
      div.setAttribute('data-copa-confirm', it.key);
      /* `data-ppid` para que la binding nativa del bundle también
         enrute el click a `window._ppToggle(id)` (que ya sabemos
         redirigir a nuestro toggle local). Así, aunque la binding
         del bundle reemplace nuestra propia binding tras un re-render,
         el flujo sigue siendo correcto. */
      div.setAttribute('data-ppid', it.key);
      div.style.cursor = 'pointer';
      div.innerHTML = ''
        + '<span class="pp-item-lbl"><span class="pp-ico">' + it.ico + '</span>' + escapeHtml(it.lbl) + '</span>'
        + '<span class="pp-item-val">' + escapeHtml(it.val) + '</span>'
        + '<span class="pp-check">' + (checked ? '✅' : '\u{1F533}') + '</span>';
      div.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (typeof window._ppToggle === 'function') window._ppToggle(it.key);
      });
      list.appendChild(div);
    });
  }

  function _copaInjectExtraConfirms(ronda) {
    /* Reset del estado al abrir cada previa nueva. */
    _copaConfirmState = { prorroga: false, penaltis: false };
    /* Activamos el flag — los wrappers de `_ppToggle` y
       `_ppRefreshUnlock` lo consultan en cada tick. Robusto al
       re-render que el bundle hace de `#pp-alerts` (que antes
       borraba el marcador DOM). */
    _copaPreviaActive = true;
    _copaRenderExtraConfirms();
    _copaWrapPpRefreshUnlock();
    _copaWrapPpToggle();
    /* Reset del flag cuando el usuario cierra la previa o navega
       fuera. Hookeamos el botón VOLVER + el confirm definitivo. */
    _copaInstallPreviaCloseHooks();
    /* Tras meter los items, re-evaluamos el botón. */
    if (typeof window._ppRefreshUnlock === 'function') window._ppRefreshUnlock();
  }
  /* Exponemos para que otros módulos (Supercopa España, etc.) puedan
     reusar la misma máquina de "Prórroga + Penaltis obligatorios"
     en cualquier previa de eliminatoria a partido único. La función
     es agnóstica de Copa — solo necesita que showPrePartidoOverlay
     esté abierta. 2026-05-05. */
  window._injectProrrogaPenaltisConfirms = function () {
    try { _copaInjectExtraConfirms('sf'); } catch(_){}
  };

  /* Resetea `_copaPreviaActive` cuando la previa se cierra. */
  function _copaInstallPreviaCloseHooks() {
    var ov = document.getElementById('prepartido-overlay');
    if (!ov || ov.__copaCloseHooked) return;
    ov.__copaCloseHooked = true;
    var back = ov.querySelector('.pp-back-btn');
    if (back) {
      back.addEventListener('click', function () { _copaPreviaActive = false; });
    }
    /* También reseteamos cuando el usuario pulsa COMENZAR PARTIDO
       (etapa 2 del confirm) — el wrapper de `_ppCustomCallback` ya
       gestiona la transición a abrirCopa. */
    var conf = ov.querySelector('#pp-confirm-btn');
    if (conf) {
      conf.addEventListener('click', function () {
        if (conf.getAttribute('data-pp-stage') === '2') _copaPreviaActive = false;
      });
    }
  }

  /* Sincroniza la fecha del partido en `#pp-env` con la fecha que viene
     del calendario (s-calendario.html, .ag-r rows). El usuario quiere
     que la previa muestre la fecha del calendario, NO la fecha del
     día actual. Estrategia robusta:
       - Match por SUBSTRING / KEYWORDS contra .ag-lbl (no comparación
         exacta), porque el calendario puede usar varios formatos
         ("Copa del Rey - 1/128", "Copa del Rey - 1ª Ronda 1/128",
          etc.).
       - Cada ronda tiene un set de keywords, todos deben coincidir
         (o al menos uno crítico).
       - Para ida/vuelta de two-leg, el keyword adicional "(Ida)" /
         "(Vuelta)" desambigua.
     Si NO encuentra fecha en el calendario, no hace nada (el bundle
     dejará la fecha por defecto). */
  var _COPA_RONDA_KEYWORDS = {
    r1:      [['1/128', '1ª Ronda', 'Primera Ronda']],   /* primera ronda */
    r2:      [['1/64', '2ª Ronda', 'Segunda Ronda']],
    r16:     [['Dieciseisavos', '1/16', '16avos']],
    oct_ida: [['Octavos'], ['Ida']],
    oct_vta: [['Octavos'], ['Vuelta']],
    cua_ida: [['Cuartos'], ['Ida']],
    cua_vta: [['Cuartos'], ['Vuelta']],
    sf_ida:  [['Semis', 'Semifinales'], ['Ida']],
    sf_vta:  [['Semis', 'Semifinales'], ['Vuelta']],
    fin:     [['Final', 'FINAL']]
  };
  function _copaLabelMatchesRound(label, ronda, esVuelta) {
    if (!label) return false;
    /* Debe contener "Copa" para evitar falsos positivos con Liga
       (que también puede tener una jornada con "1/128" en alguna
       extensión hipotética). */
    if (label.indexOf('Copa') === -1 && label.indexOf('COPA') === -1) return false;
    var key = ronda;
    if (TWO_LEG[ronda] && (ronda === 'oct' || ronda === 'cua' || ronda === 'sf')) {
      key = ronda + (esVuelta ? '_vta' : '_ida');
    }
    var groups = _COPA_RONDA_KEYWORDS[key];
    if (!groups) return false;
    /* Cada grupo es un OR, todos los grupos juntos AND. */
    for (var g = 0; g < groups.length; g++) {
      var any = false;
      for (var k = 0; k < groups[g].length; k++) {
        if (label.indexOf(groups[g][k]) !== -1) { any = true; break; }
      }
      if (!any) return false;
    }
    return true;
  }
  function _copaCalDateForRound(ronda, esVuelta) {
    var rows = document.querySelectorAll('.ag-r');
    for (var i = 0; i < rows.length; i++) {
      var l = rows[i].querySelector('.ag-lbl');
      var d = rows[i].querySelector('.ag-date');
      if (!l || !d) continue;
      var lblTxt = l.textContent.trim().split(' · ')[0].trim();
      if (_copaLabelMatchesRound(lblTxt, ronda, esVuelta)) {
        return d.textContent.trim();
      }
    }
    return '';
  }

  var _MONTH_FULL_ES = {
    'Ene':'Enero','Feb':'Febrero','Mar':'Marzo','Abr':'Abril',
    'May':'Mayo','Jun':'Junio','Jul':'Julio','Ago':'Agosto',
    'Sep':'Septiembre','Oct':'Octubre','Nov':'Noviembre','Dic':'Diciembre'
  };

  /* MutationObserver sobre #pp-env: cada vez que el bundle re-pinta
     el envelope (p.ej. al togglear un item desde _mmInjectEnv), volvemos
     a aplicar la fecha del calendario. Se instala una vez por previa.
     Se desconecta cuando se cierra el overlay (display:none) o cuando
     navega fuera. */
  var _copaEnvObserver = null;
  /* Wrapper GLOBAL sobre `showPrePartidoOverlay`: aplica el reemplazo
     del alias (🎮 texto largo → ❓ animado + overlay) y la
     sincronización de fecha del calendario para CUALQUIER previa que
     no sea Liga (Copa, Champions, Europa, Supercopa, Intercontinental,
     etc.). Antes solo se aplicaba dentro de `copaAbrirPrevia` así
     que el bug del alias truncado en Champions seguía. */
  function _copaWrapShowPrePartidoOverlay() {
    if (typeof window.showPrePartidoOverlay !== 'function') return;
    if (window.showPrePartidoOverlay.__copaPostHooked) return;
    var orig = window.showPrePartidoOverlay;
    var wrapped = function (matchKey, compKey, prorroga, duracion, isHvH) {
      var isLiga = !compKey || compKey === 'liga' || compKey === 'liga-2';
      /* Instalar el observer ANTES de que el bundle renderice pp-vs
         (2026-05-08): así la primera mutación dispara el reemplazo en
         el siguiente frame (~16 ms), sin esperar a los retries fijos
         posteriores. El observer es idempotente — `_copaInstallVsObserver`
         se reaplica abajo por si el bundle re-renderiza varias veces. */
      if (!isLiga) {
        try { _copaInstallVsObserver(); } catch(_){}
      }
      var ret = orig.apply(this, arguments);
      if (isLiga) return ret;
      /* Alias → ❓ + overlay (idempotente; observer ya se reaplica).
         Retries con cobertura amplia (0..3 s) para casos en que el
         bundle re-renderice en fases o el observer no caza la primera
         mutación por alguna razón. */
      try {
        setTimeout(function () { _copaReplaceAliasText(); }, 0);
        setTimeout(function () { _copaReplaceAliasText(); }, 80);
        setTimeout(function () { _copaReplaceAliasText(); }, 240);
        setTimeout(function () { _copaReplaceAliasText(); }, 600);
        setTimeout(function () { _copaReplaceAliasText(); }, 1200);
        setTimeout(function () { _copaReplaceAliasText(); }, 2400);
        _copaInstallVsObserver();
      } catch(_){}
      /* Fecha: parsear matchKey/compKey para encontrar la fila del
         calendario correcta. Cobertura ampliada (0..2.4 s) +
         observer instalado lo antes posible. 2026-05-08. */
      try {
        setTimeout(function () { _copaOverrideAnyPrevDate(matchKey, compKey); }, 0);
        setTimeout(function () { _copaOverrideAnyPrevDate(matchKey, compKey); }, 50);
        setTimeout(function () { _copaOverrideAnyPrevDate(matchKey, compKey); }, 200);
        setTimeout(function () { _copaOverrideAnyPrevDate(matchKey, compKey); }, 600);
        setTimeout(function () { _copaOverrideAnyPrevDate(matchKey, compKey); }, 1500);
        _copaInstallAnyEnvObserver(matchKey, compKey);
      } catch(_){}
      return ret;
    };
    wrapped.__copaPostHooked = true;
    window.showPrePartidoOverlay = wrapped;
  }
  /* Aplica al cargar y un par de retries (el bundle inicializa
     `window.showPrePartidoOverlay` en script block 28 que puede
     correr después que copa-engine.js). */
  try { _copaWrapShowPrePartidoOverlay(); } catch(_){}
  setTimeout(function () { try { _copaWrapShowPrePartidoOverlay(); } catch(_){} }, 200);
  setTimeout(function () { try { _copaWrapShowPrePartidoOverlay(); } catch(_){} }, 1500);

  /* Detecta el label del calendario para cualquier previa, basándose
     en compKey + matchKey. Devuelve la fecha cruda del calendario
     ("28 Sep") o '' si no se encuentra. */
  function _copaCalDateGeneric(matchKey, compKey) {
    var rows = document.querySelectorAll('.ag-r');
    if (!rows.length) return '';
    /* Champions previa fase: `wprev-G<gi>-J<j>` → Jornada (j+1) de
       fase de liga / previa. */
    var wprev = /^wprev-G(\d+)-J(\d+)$/.exec(String(matchKey || ''));
    var jNum = null, kindHints = null;
    if (wprev) {
      jNum = parseInt(wprev[2], 10) + 1; /* state es 0-indexed */
      kindHints = ['Champions', 'UCL', 'Europa']; /* el bundle tipea
        `ucl` para tanto Champions como Europa Previa según contexto */
    } else if (compKey === 'copa' || compKey === 'copa-fin') {
      /* Copa ya está cubierto por `_copaCalDateForRound` desde
         copaAbrirPrevia — no hace falta repetir. */
      return '';
    } else if (compKey === 'ucl-fin' || compKey === 'uel-fin' || compKey === 'uecl-fin') {
      kindHints = ['Final', 'UCL', 'UEL', 'UECL', 'Europa'];
    } else if (compKey === 'sc' || compKey === 'sc-final') {
      kindHints = compKey === 'sc-final' ? ['Supercopa', 'España', 'FINAL'] : ['Supercopa', 'España'];
    } else if (compKey === 'usc' || compKey === 'usc-fin') {
      kindHints = ['Supercopa', 'Europa'];
    } else if (compKey === 'inter' || compKey === 'inter-fin') {
      kindHints = compKey === 'inter-fin' ? ['Intercontinental', 'FINAL'] : ['Intercontinental'];
    }
    if (!kindHints) return '';
    function lblMatches(label) {
      if (!label) return false;
      var hits = 0;
      for (var i = 0; i < kindHints.length; i++) {
        if (label.indexOf(kindHints[i]) !== -1) { hits++; }
      }
      if (hits === 0) return false;
      if (jNum != null) {
        var j = label.match(/J\s*(\d+)/);
        if (!j || parseInt(j[1], 10) !== jNum) return false;
      }
      return true;
    }
    for (var i = 0; i < rows.length; i++) {
      var l = rows[i].querySelector('.ag-lbl');
      var d = rows[i].querySelector('.ag-date');
      if (!l || !d) continue;
      var lblTxt = l.textContent.trim().split(' · ')[0].trim();
      if (lblMatches(lblTxt)) return d.textContent.trim();
    }
    return '';
  }

  function _copaOverrideAnyPrevDate(matchKey, compKey) {
    var rawDate = _copaCalDateGeneric(matchKey, compKey);
    if (!rawDate) return;
    var parts = rawDate.split(' ');
    if (parts.length < 2) return;
    var day = parseInt(parts[0], 10) || 0;
    var monthName = (_MONTH_FULL_ES && _MONTH_FULL_ES[parts[1]]) || parts[1];
    var envEl = document.getElementById('pp-env');
    if (!envEl) return;
    var lines = envEl.querySelectorAll('.pp-env-line');
    for (var i = 0; i < lines.length; i++) {
      var txt = lines[i].textContent || '';
      if (txt.indexOf('📅') !== -1 || /\d+\s+de\s+/.test(txt)) {
        lines[i].innerHTML = lines[i].innerHTML.replace(/<b>\d+\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+<\/b>/, '<b>' + day + ' de ' + monthName + '</b>');
        return;
      }
    }
  }

  /* Observer que reaplica fecha + alias para cualquier previa. */
  var _copaAnyEnvObserver = null;
  function _copaInstallAnyEnvObserver(matchKey, compKey) {
    var envEl = document.getElementById('pp-env');
    if (!envEl || typeof MutationObserver !== 'function') return;
    if (_copaAnyEnvObserver) {
      try { _copaAnyEnvObserver.disconnect(); } catch(_){}
      _copaAnyEnvObserver = null;
    }
    /* Debounce con requestAnimationFrame (~16 ms a 60 Hz) en lugar de
       setTimeout(30) — petición usuario 2026-05-08 "todo merge en
       ≤50 ms". El flag `data-copa-date-applied` evita bucles. */
    var ticking = false;
    var _raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(fn){ return setTimeout(fn, 16); };
    _copaAnyEnvObserver = new MutationObserver(function () {
      if (ticking) return;
      ticking = true;
      _raf(function () {
        try { _copaOverrideAnyPrevDate(matchKey, compKey); } catch(_){}
        ticking = false;
        var ov = document.getElementById('prepartido-overlay');
        if (!ov || !ov.classList.contains('show')) {
          if (_copaAnyEnvObserver) {
            try { _copaAnyEnvObserver.disconnect(); } catch(_){}
            _copaAnyEnvObserver = null;
          }
        }
      });
    });
    _copaAnyEnvObserver.observe(envEl, { childList: true, subtree: true, characterData: true });
  }

  /* Reemplaza los divs del alias eFootball "🎮 <texto>" en `#pp-vs`
     por un botón ❓ animado. El alias completo se guarda en
     `data-copa-alias-full` para mostrarlo al pulsar. Es idempotente:
     si el div ya tiene `data-copa-alias-replaced`, lo deja como está. */
  function _copaReplaceAliasText() {
    var vs = document.getElementById('pp-vs');
    if (!vs) return;
    var divs = vs.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var d = divs[i];
      if (d.getAttribute('data-copa-alias-replaced') === '1') continue;
      var text = (d.textContent || '').trim();
      /* El bundle pone "🎮 ..." con un emoji + espacio. Detección
         tolerante por presencia del emoji al principio. */
      if (text.length >= 3 && text.indexOf('🎮') === 0) {
        var aliasFull = text.replace(/^🎮\s*/, '').trim();
        if (!aliasFull) continue;
        d.setAttribute('data-copa-alias-replaced', '1');
        d.setAttribute('data-copa-alias-full', aliasFull);
        d.innerHTML = '<button type="button" class="copa-alias-help" '
          + 'onclick="window._copaShowAlias(this)" '
          + 'data-copa-alias-full="' + escapeHtml(aliasFull) + '" '
          + 'aria-label="Ver alias eFootball completo" '
          + 'style="background:none;border:none;color:#ffd54a;font-size:20px;cursor:pointer;padding:2px 8px;line-height:1;animation:copaAliasPulse 1.4s ease-in-out infinite;">❓</button>';
      }
    }
  }

  /* Overlay full-screen con el alias completo cuando el usuario pulsa
     el ❓. Texto grande, con color llamativo dorado, fondo oscuro
     semitransparente. Click fuera o en la X cierra. */
  window._copaShowAlias = function (btn) {
    if (!btn) return;
    var alias = btn.getAttribute('data-copa-alias-full') || '';
    if (!alias) return;
    var ov = document.getElementById('_copaAliasOv');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = '_copaAliasOv';
      ov.style.cssText = 'display:flex;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.94);align-items:center;justify-content:center;padding:24px;cursor:pointer;';
      ov.innerHTML = ''
        + '<div style="background:linear-gradient(180deg,#1a0d04,#0a0502);border:2px solid #ffd54a;border-radius:14px;padding:24px 20px;max-width:520px;width:100%;text-align:center;box-shadow:0 0 50px rgba(255,213,74,.55),0 0 80px rgba(255,213,74,.25);position:relative;cursor:default;" onclick="event.stopPropagation();">'
        +   '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;letter-spacing:3px;color:#ffd54a;margin-bottom:14px;opacity:.85;">🎮 EQUIPO eFOOTBALL</div>'
        +   '<div id="_copaAliasText" style="font-family:Rajdhani,sans-serif;font-size:22px;font-weight:800;letter-spacing:.6px;color:#ffec99;line-height:1.35;text-shadow:0 0 12px rgba(255,213,74,.5);margin-bottom:18px;word-break:break-word;"></div>'
        +   '<button type="button" onclick="document.getElementById(\'_copaAliasOv\').style.display=\'none\';" style="padding:10px 22px;border-radius:8px;border:1px solid rgba(255,213,74,.5);background:rgba(255,213,74,.08);color:#ffd54a;font-family:\'Bebas Neue\',sans-serif;font-size:14px;letter-spacing:2px;cursor:pointer;">CERRAR</button>'
        + '</div>';
      ov.addEventListener('click', function (e) {
        if (e.target === ov) ov.style.display = 'none';
      });
      document.body.appendChild(ov);
    }
    document.getElementById('_copaAliasText').textContent = alias;
    ov.style.display = 'flex';
  };

  /* Observer sobre `#pp-vs`: cada vez que el bundle re-renderiza el
     bloque (al togglear un item del previa), reaplicamos el reemplazo
     ❓. Coalescencia con flag para evitar bucles. */
  var _copaVsObserver = null;
  function _copaInstallVsObserver() {
    var vsEl = document.getElementById('pp-vs');
    if (!vsEl || typeof MutationObserver !== 'function') return;
    if (_copaVsObserver) {
      try { _copaVsObserver.disconnect(); } catch(_){}
      _copaVsObserver = null;
    }
    /* Aceleración (2026-05-08): el usuario reportó hasta 5 s entre
       que aparece el texto "🎮 Asia - …" y se reemplaza por la ❓.
       Causa: el bundle re-renderizaba pp-vs en varias fases y el
       debounce de setTimeout(30) introducía un retraso visible cada
       vez. Lo cambiamos a requestAnimationFrame() para reemplazar
       en el siguiente frame (~16 ms) tras CADA mutación, sin
       bucles infinitos — `data-copa-alias-replaced` marca los divs
       ya procesados. */
    var ticking = false;
    var _raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(fn){ return setTimeout(fn, 16); };
    _copaVsObserver = new MutationObserver(function () {
      if (ticking) return;
      ticking = true;
      _raf(function () {
        try { _copaReplaceAliasText(); } catch(_){}
        ticking = false;
        var ov = document.getElementById('prepartido-overlay');
        if (!ov || !ov.classList.contains('show')) {
          if (_copaVsObserver) {
            try { _copaVsObserver.disconnect(); } catch(_){}
            _copaVsObserver = null;
          }
        }
      });
    });
    _copaVsObserver.observe(vsEl, { childList: true, subtree: true, characterData: true });
  }

  function _copaInstallEnvObserver(ronda, esVuelta) {
    var envEl = document.getElementById('pp-env');
    if (!envEl || typeof MutationObserver !== 'function') return;
    if (_copaEnvObserver) {
      try { _copaEnvObserver.disconnect(); } catch(_){}
      _copaEnvObserver = null;
    }
    var ticking = false;
    var _raf2 = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(fn){ return setTimeout(fn, 16); };
    _copaEnvObserver = new MutationObserver(function () {
      if (ticking) return;
      ticking = true;
      _raf2(function () {
        try { _copaOverridePrevDate(ronda, esVuelta); } catch(_){}
        ticking = false;
        /* Si el overlay ya no está visible, autodesconecta. */
        var ov = document.getElementById('prepartido-overlay');
        if (!ov || !ov.classList.contains('show')) {
          if (_copaEnvObserver) {
            try { _copaEnvObserver.disconnect(); } catch(_){}
            _copaEnvObserver = null;
          }
        }
      });
    });
    _copaEnvObserver.observe(envEl, { childList: true, subtree: true, characterData: true });
  }

  function _copaOverridePrevDate(ronda, esVuelta) {
    var rawDate = _copaCalDateForRound(ronda, esVuelta);
    if (!rawDate) return;
    var parts = rawDate.split(' ');
    if (parts.length < 2) return;
    var day = parseInt(parts[0], 10) || 0;
    var monthName = _MONTH_FULL_ES[parts[1]] || parts[1];
    var envEl = document.getElementById('pp-env');
    if (!envEl) return;
    /* Buscamos la línea con 📅 o `de ` + mes y la sustituimos. */
    var lines = envEl.querySelectorAll('.pp-env-line');
    for (var i = 0; i < lines.length; i++) {
      var txt = lines[i].textContent || '';
      if (txt.indexOf('📅') !== -1 || /\d+\s+de\s+/.test(txt)) {
        /* Sustituimos solo el bloque "<num> de <Mes>" preservando el
           resto (separador "|" + label de la competición que añade
           _mmInjectEnv). */
        var html = lines[i].innerHTML;
        html = html.replace(/<b>\d+\s+de\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+<\/b>/, '<b>' + day + ' de ' + monthName + '</b>');
        lines[i].innerHTML = html;
        return;
      }
    }
  }

  /* Reemplaza un TBD `@<ronda>#<idx>` por el nombre del ganador real
     en `_copa.clasificados[ronda]` y en cualquier `_copa.sorteo[X]`
     posterior. Tras la mutación local, postea el state al backend
     para mantener sincronía y refresca la UI de Copa.

     Uso: tras `_copaSimLivePersist` o `_copaSaveHumanResult` cuando
     conocemos el ganador del partido `(ronda, idx)` que estaba
     pendiente. Si no había TBD para esa ronda+idx, no hace nada. */
  function _copaResolveTbd(ronda, idx, winnerName) {
    if (!winnerName) return;
    var tbdKey = '@' + ronda + '#' + idx;
    var changed = false;
    if (!_copa) _copa = {};
    if (!_copa.clasificados) _copa.clasificados = {};
    if (!_copa.sorteo) _copa.sorteo = {};
    /* Reemplazar en clasificados[ronda] */
    var clasif = _copa.clasificados[ronda] || [];
    for (var i = 0; i < clasif.length; i++) {
      if (clasif[i] === tbdKey) { clasif[i] = winnerName; changed = true; }
    }
    /* Reemplazar en sorteo de TODAS las rondas (defensivo). */
    Object.keys(_copa.sorteo).forEach(function (rk) {
      var arr = _copa.sorteo[rk] || [];
      for (var j = 0; j < arr.length; j++) {
        var m = arr[j];
        if (!m) continue;
        if (m.l === tbdKey) { m.l = winnerName; changed = true; }
        if (m.v === tbdKey) { m.v = winnerName; changed = true; }
      }
    });
    if (!changed) return;
    /* Push al backend para sincronizar otros dispositivos. */
    try {
      fetch('/api/copa/state_set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copa: _copa })
      }).catch(function(){});
    } catch(_){}
    /* Refrescar UI: las cards posteriores que tenían placeholder
       ahora muestran el nombre real. */
    setTimeout(function () { try { copaInit(); } catch(_){} }, 200);
  }
  /* Expuesto para que misc_body_2.html (gm-modal humano) pueda
     llamarlo tras `_copaSaveHumanResult`. */
  window._copaResolveTbdExternal = _copaResolveTbd;

  /* IA-vs-IA → live tick + acta usando el mismo motor de Liga EA
     (iaSimLive). El hook `window._copaSimLivePersist` (registrado más
     abajo) se dispara dentro de iaSimLive cuando el mk empieza por
     `copa_` y redirige el guardado al backend de Copa. */
  window.copaSimLive = function (ronda, idx, esVuelta) {
    var sorteo = (_copa && _copa.sorteo) || {};
    var matches = sorteo[ronda] || [];
    var m = matches[idx];
    if (!m) return;
    var local = esVuelta ? m.v : m.l;
    var visit = esVuelta ? m.l : m.v;
    var mk = _copaSimMk(ronda, idx, !!esVuelta);
    if (typeof window.iaSimLive === 'function') {
      window.iaSimLive(mk, local, visit, 0);
    } else {
      /* Sin motor live disponible: caemos al backend instantáneo. */
      window.copaSimIA(ronda, idx, esVuelta ? 1 : 0);
    }
  };

  /* Persistor de iaSimLive cuando el mk pertenece a Copa. Postea al
     endpoint /api/copa/guardar_resultado y refresca la pantalla.
     Llamado desde misc_body_2.html en la rama __isCopaSim. Detecta
     prórroga (eventos `gol` con min > 90 marcados con `_et=true`) y
     penaltis (evento `pen-result`) en el array de events. */
  window._copaSimLivePersist = function (mk, home, away, scA, scB, events, mvp, mvpTeam) {
    /* mk format: copa_<ronda>_<idx>_<i|v> */
    var match = /^copa_([^_]+)_([0-9]+)_([iv])$/.exec(String(mk));
    if (!match) return;
    var ronda = match[1];
    var idx = parseInt(match[2], 10);
    var esVuelta = match[3] === 'v';
    /* ET goals: cuentan los goals con flag _et=true (los que iaSimLive
       generó al pasar a prórroga). Si no hay flag pero algún gol es
       min > 90 + < 121, lo contamos también — fallback robusto. */
    var et_gh = 0, et_gv = 0;
    (events || []).forEach(function (e) {
      if (!e || e.type !== 'gol') return;
      var isET = e._et === true || (e.min > 90 && e.min < 121);
      if (!isET) return;
      if (e.team === 'a') et_gh++;
      else if (e.team === 'b') et_gv++;
    });
    /* scA / scB ya incluyen ET goals porque iaSimLive los suma al
       gol. Para enviar al backend, restamos para obtener gh/gv del
       tiempo regular. */
    var gh = Math.max(0, scA - et_gh);
    var gv = Math.max(0, scB - et_gv);
    /* Pen winner: evento pen-result añadido por iaSimLive a 121'. */
    var penEv = (events || []).find(function (e) {
      return e && (e.type === 'pen-result' || e.type === 'pen-winner');
    });
    var penWin = penEv ? (penEv.team === 'a' ? home : away) : null;
    var payload = {
      ronda: ronda, idx: idx, es_vuelta: esVuelta,
      gl: gh, gv: gv,
      et_gl: et_gh, et_gv: et_gv,
      pen_winner: penWin,
      mvp: mvp || '',
      events: events || [],
      summary: '',
      team_a: home || '', team_b: away || ''
    };
    /* Computar el GANADOR localmente para poder resolver TBDs sin
       esperar a que el backend responda. Si pen_winner está, ese gana;
       si no, el de más goles (regular + ET). En two-leg legs (Ida/
       Vuelta), no resolvemos TBD aquí — la resolución se hace al
       confirmar la ronda completa con copaClasificar. */
    var winnerName = null;
    if (penWin) winnerName = penWin;
    else if (scA > scB) winnerName = home;
    else if (scB > scA) winnerName = away;
    try {
      fetch('/api/copa/guardar_resultado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); })
        .then(function (d) {
          try {
            if (d && d.copa) _copa = d.copa;
            /* Tras guardar, si esta ronda es single-leg y conocemos el
               ganador, intentamos resolver TBDs de rondas posteriores. */
            if (winnerName) _copaResolveTbd(ronda, idx, winnerName);
          } catch(_){}
        }).catch(function () {});
    } catch(_){}
    try {
      if (typeof window.registrarLigaPlayerStats === 'function') {
        var statsEvents = (events || []).filter(function (e) {
          return e && e.type !== 'pen-result' && !e._varAnulado;
        });
        window.registrarLigaPlayerStats(mk, home, away, statsEvents, mvp || '', mvpTeam || '', 'copa');
      }
    } catch(_){}
  };

  /* Devuelve la lista de IDs de pantalla de ronda. Si el script `go()`
     navega a una de ellas, repintamos el body de esa ronda. */
  function _isRoundScreen(id) {
    return /^s-copa-rd-(r1|r2|r16|oct|cua|sf|fin)$/.test(String(id || ''));
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureHumanPanelEnhancements();
    var origGo = window.go;
    window.go = function (screenId) {
      if (typeof origGo === 'function') origGo.apply(this, arguments);
      if (screenId === 's-copa' || screenId === 's-calendario' || screenId === 's-copa-cuadro' || _isRoundScreen(screenId)) init();
    };
    init();
  });

  window.copaInit = init;
  window.copaRender = copaRender;
})();
