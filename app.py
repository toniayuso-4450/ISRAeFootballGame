from flask import Flask, render_template, redirect, url_for, request, jsonify, abort, session, make_response
from flask_sqlalchemy import SQLAlchemy
import random
import os
import json
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from functools import wraps

from jugadores_data import jugadores_por_equipo
from logica_liga import calcular_tabla, obtener_resultados_ia

app = Flask(__name__)

basedir = os.path.abspath(os.path.dirname(__file__))


def _resolve_data_dir():
    """Devuelve el directorio donde guardamos SQLite + ficheros editables.

    Orden de preferencia:
      1. `LIGA_DATA_DIR` env var → cualquier ruta personalizada.
      2. `RAILWAY_VOLUME_MOUNT_PATH` env var → si el usuario montó un
         Volume en Railway (cualquier ruta), Railway pone esta variable.
      3. `/data` si existe y es escribible (convención Railway/Render).
      4. `instance/` (fallback local + Render con volumen ya mapeado).

    Las primeras 3 opciones permiten que Railway sin Postgres tenga
    persistencia: el usuario monta un Volume (e.g. en /data) y los
    `liga_ext_*` + el calendario sobreviven a deploys/restarts en el
    SQLite del volumen. Sin nada de esto, en Railway el SQLite es
    efímero y los cambios del admin se pierden — el bug histórico que
    el usuario reportaba con la AGENDA y con el editor de plantillas
    de Resto de Ligas (2026-05-02). """
    candidates = []
    env_dir = os.environ.get("LIGA_DATA_DIR", "").strip()
    if env_dir:
        candidates.append(env_dir)
    rwy_vol = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
    if rwy_vol:
        candidates.append(rwy_vol)
    candidates.append("/data")
    for cand in candidates:
        try:
            os.makedirs(cand, exist_ok=True)
            # Probar escritura — algunas plataformas montan /data como
            # read-only por defecto si el usuario no creó el Volume.
            probe = os.path.join(cand, ".liga_write_probe")
            with open(probe, "w") as f:
                f.write("ok")
            os.remove(probe)
            return cand
        except OSError:
            continue
    fallback = os.path.join(basedir, "instance")
    os.makedirs(fallback, exist_ok=True)
    return fallback


instance_dir = _resolve_data_dir()

# Selección de backend de base de datos:
#
# 1. Si la plataforma inyecta `DATABASE_URL` (Railway con plugin Postgres,
#    Heroku, Fly, etc.) → usarla. Así los datos persisten entre reinicios
#    del contenedor, que es el caso real en Railway donde el disco es
#    efímero por defecto y los SQLite se borran en cada deploy.
# 2. Si no, SQLite en `<instance_dir>/liga.db`. `_resolve_data_dir`
#    intenta montar primero un volumen persistente (Railway Volume,
#    /data, etc.) y solo cae a `instance/` si no hay nada disponible.
#    En desarrollo local y en Render esto es transparente.
#
# Normalización de prefijo: Railway/Heroku envían `postgres://` pero
# SQLAlchemy >= 1.4 requiere `postgresql://`. Sustituimos solo el prefijo.
_db_url = os.environ.get("DATABASE_URL", "").strip()
if _db_url.startswith("postgres://"):
    _db_url = "postgresql://" + _db_url[len("postgres://"):]
if not _db_url:
    _db_url = "sqlite:///" + os.path.join(instance_dir, "liga.db")

# Log diagnóstico al arranque: imprime el backend de almacenamiento
# detectado para que el deployer pueda confirmar en los logs si los
# datos del admin (calendario, plantillas Resto de Ligas, etc.) van a
# sobrevivir a un deploy/restart. Si dice "EPHEMERAL", los cambios
# del admin se perderán en el próximo deploy y hay que mover SQLite a
# un volumen persistente o configurar DATABASE_URL.
def _persistence_diagnostic():
    if _db_url.startswith("postgresql://") or _db_url.startswith("postgres://"):
        return "PERSISTENT (Postgres via DATABASE_URL)"
    if instance_dir.startswith("/data") or os.environ.get("LIGA_DATA_DIR") \
            or os.environ.get("RAILWAY_VOLUME_MOUNT_PATH"):
        return f"PERSISTENT (SQLite at {instance_dir}/liga.db — volumen montado)"
    if os.path.exists(os.path.join(basedir, ".render-volume-marker")):
        return f"PERSISTENT (SQLite at {instance_dir}/liga.db — Render volume)"
    return f"EPHEMERAL (SQLite at {instance_dir}/liga.db — los cambios se PERDERÁN en el próximo deploy/restart). Configura DATABASE_URL (Postgres) o monta un volumen y exporta LIGA_DATA_DIR/RAILWAY_VOLUME_MOUNT_PATH."

try:
    print(f"[ftbol] Persistencia: {_persistence_diagnostic()}", flush=True)
except Exception:
    pass

app.config["SQLALCHEMY_DATABASE_URI"] = _db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# `secret_key` es obligatoria para que Flask pueda firmar las cookies
# de sesión (y por tanto para que la sesión admin sobreviva entre
# peticiones). Se puede sobreescribir con la env var `SECRET_KEY` en
# producción para que distintos deploys compartan sesiones si hace
# falta (normalmente no hace falta — cada deploy sale con una
# secret_key nueva generada en tiempo de import).
app.secret_key = os.environ.get("SECRET_KEY") or uuid.uuid4().hex
# Postgres en Railway cierra conexiones ociosas al cabo de unos minutos.
# `pool_pre_ping` evita errores "server closed the connection unexpectedly"
# haciendo un ping barato antes de cada consulta; `pool_recycle` recicla
# conexiones cada 5 min para mantenerlas frescas. No afecta a SQLite.
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_recycle": 300,
}

db = SQLAlchemy(app)

# --- CONFIG ---
equipos_humanos = ["Real Madrid", "FC Barcelona", "Bayern Munich", "Arsenal", "Sporting CP"]

equipos_primera = list(jugadores_por_equipo.keys())
equipos = list(jugadores_por_equipo.keys())

# --- MODELOS ---
class Partido(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    jornada = db.Column(db.Integer)
    local = db.Column(db.String(100))
    visitante = db.Column(db.String(100))
    goles_local = db.Column(db.Integer)
    goles_visitante = db.Column(db.Integer)
    mvp = db.Column(db.String(100))
    porteria_imbatida = db.Column(db.String(100), nullable=True)

class Evento(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    partido_id = db.Column(db.Integer)
    tipo = db.Column(db.String(50))
    equipo = db.Column(db.String(100))
    jugador = db.Column(db.String(100))
    minuto = db.Column(db.Integer, nullable=True)

class GlobalState(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    clave = db.Column(db.String(100), unique=True, nullable=False)
    valor_json = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.String(50), nullable=True)

# --- PROBABILIDADES ---
BASE = {
    "portero": 0.001,
    "defensa": 7.5,
    "medio": 17.5,
    "delantero": 70
}

MULTIGOL = [1, 0.37, 0.22, 0.12, 0.06]

# Penalti: pesos de la fórmula probabilística (Módulo 2)
PENALTY_BASE_WEIGHT = 0.85        # peso del atributo lanzador vs portero
PENALTY_RANDOM_FACTOR = 0.15      # factor de azar máximo
PENALTY_SAVE_PROBABILITY = 0.60   # prob. de parada efectiva cuando falla el penalti
PENALTY_FOUL_CARD_PROBABILITY = 0.30  # prob. de tarjeta al defensor que provoca el penalti
BONUS_LOCAL = 1.10

TEAM_ALIASES = {
    "sevilla fc": "Sevilla",
    "villarreal cf": "Villarreal",
    "valencia cf": "Valencia",
    "getafe cf": "Getafe",
    "elche cf": "Elche",
    "córdoba cf": "Córdoba",
    "levante ud": "Levante",
    "villarreal": "Villarreal",
    "sevilla": "Sevilla",
    "valencia": "Valencia",
    "getafe": "Getafe",
    "elche": "Elche",
    "córdoba": "Córdoba",
    "levante": "Levante",
}

ALIASES_ESCUDOS_RAW = {
    "FC Barcelona": "Barcelona",
    "Barça": "Barcelona",
    "Bayern Munich": "Bayern de Múnich",
    "Atletico de Madrid": "Atlético de Madrid",
    "Sporting CP": "Sporting de Portugal",
    "Como 1907": "Como",
    "Como Calcio": "Como",
}

ESCUDOS = {
    "Real Madrid": "/static/img/escudos-1/spain_real-madrid.football-logos.cc.svg",
    "Barcelona": "/static/img/escudos-1/spain_barcelona.football-logos.cc.svg",
    "Arsenal": "/static/img/escudos-1/england_arsenal.football-logos.cc.svg",
    "Bayern de Múnich": "/static/img/escudos-1/germany_bayern-munchen.football-logos.cc.svg",
    "Villarreal": "/static/img/escudos-1/spain_villarreal.football-logos.cc.svg",
    "Elche": "/static/img/escudos-1/spain_elche.football-logos.cc.svg",
    "Sporting de Portugal": "/static/img/escudos-1/portugal_sporting-cp.football-logos.cc.svg",
    "Atlético de Madrid": "/static/img/escudos-1/spain_atletico-madrid.football-logos.cc.svg",
    "Como": "https://commons.wikimedia.org/wiki/Special:FilePath/Como_1907.svg",
}

ESCUDO_DEFAULT = "/static/img/escudos-fallback/estepona.svg"


def normalize_team_key(nombre):
    clean = str(nombre or "").strip().lower()
    normalized = unicodedata.normalize("NFD", clean)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


ALIASES_ESCUDOS = {
    normalize_team_key(alias): canonical
    for alias, canonical in ALIASES_ESCUDOS_RAW.items()
}


def obtener_escudo(nombre):
    clean = str(nombre or "").strip()
    if not clean:
        return ESCUDO_DEFAULT
    canonical = ALIASES_ESCUDOS.get(normalize_team_key(clean), clean)
    return ESCUDOS.get(canonical, ESCUDO_DEFAULT)


def build_escudos_resueltos():
    teams = set(jugadores_por_equipo.keys()) | set(equipos_humanos) | set(ESCUDOS.keys())
    return {team: obtener_escudo(team) for team in sorted(teams)}

# --- ESTADO GLOBAL COMPARTIDO ---
GLOBAL_STATE_KEY = "global_state"

DEFAULT_GLOBAL_STATE = {
    "liga_results": {},
    "segunda_state": {"table": [], "players": []},
    "segunda_teams": [],
    "primera_state": {
        "g1": {"table": [], "players": []},
        "g2": {"table": [], "players": []}
    },
    "primera_teams": {
        "g1": [],
        "g2": []
    },
    "transition_preview": None,
    "segunda_simple_state": {},
    # competition_state: espejo en servidor de las claves de localStorage
    # que el navegador puede perder (modo incógnito, cache clear, cuota
    # excedida, otro dispositivo). El cliente sincroniza:
    #   - wprev_state_v1            (Previa Champions)
    #   - wc_state_v1               (Wild Card)
    #   - oq_simulation_v1          (Open Qualifier)
    #   - wc_to_open_qualifier_v1   (18 ganadores WC → OQ)
    #   - oq_to_previa_v1           (35 → Previa)
    #   - wprev_to_fase_grupos_v1   (11 → UCL)
    #   - wprev_to_europa_v1        (22 → UEL)
    #   - wprev_r1_to_conference_v1 (30 → UECL)
    #   - oq_to_conference_v1       (legacy fallback)
    #   - wc_to_conference_v1       (legacy fallback)
    #   - bayern_calendar_comps_v1, bayern_calendar_title_v1, bayern_cal_v2
    #                               (preferencias y eventos del calendario humano)
    #   - sc_state_v1, usc_state_v1, recopa_state_v1
    #                               (Supercopas / Recopa)
    #   - mundial_state_v1, mundialito_state_v1
    #   - seleccion_state_v1, selecciones_state_v1
    #   - ucl_ko_state_v1, uel_ko_state_v1, uecl_ko_state_v1
    #   - superliga_state_v1, superliga_teams_v1, superliga_calendar_v1,
    #     superliga_results_v1
    #   - partidos_aplazados        (array de aplazamientos)
    #   - wc_champ_v1, wc_champion_v1
    # Cada valor es el JSON crudo (string) tal como vive en localStorage.
    # La lista canónica vive en `SYNC_KEYS` de
    # `templates/partials/part2/misc_body_2.html` — añadir nuevas
    # competiciones allí.
    "competition_state": {}
}

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()

def merge_dict(base, incoming):
    if not isinstance(base, dict):
        return incoming
    if not isinstance(incoming, dict):
        return base

    result = dict(base)
    for k, v in incoming.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = merge_dict(result[k], v)
        else:
            result[k] = v
    return result

def get_or_create_global_state():
    row = GlobalState.query.filter_by(clave=GLOBAL_STATE_KEY).first()
    if not row:
        row = GlobalState(
            clave=GLOBAL_STATE_KEY,
            valor_json=json.dumps(DEFAULT_GLOBAL_STATE, ensure_ascii=False),
            updated_at=utc_now_iso()
        )
        db.session.add(row)
        db.session.commit()
    return row

def load_global_state():
    row = get_or_create_global_state()
    try:
        data = json.loads(row.valor_json or "{}")
    except Exception:
        data = {}

    if not isinstance(data, dict):
        data = {}

    return merge_dict(DEFAULT_GLOBAL_STATE, data)

def save_global_state(new_state, replace=False):
    """Guarda una actualización del estado global.

    Dos modos:

    * `replace=False` (por defecto) — actualización **PARCIAL**: la
      fila existente se preserva y solo se sobreescriben las claves
      presentes en `new_state`. Así un POST con `{liga_results: X}`
      no borra `liga_schedule`, `copa_state`, etc. Es el comportamiento
      que espera `/api/state` cuando el frontend manda un patch.

    * `replace=True` — **REEMPLAZO TOTAL**: la fila se reconstruye
      desde `DEFAULT_GLOBAL_STATE + new_state`. Útil para rutas de
      reseteo (p.ej. `copa_reiniciar`) que necesitan limpiar claves
      que hayan quedado pobladas.

    Antes del fix, la única modalidad era `replace=True` y cualquier
    POST parcial desde el frontend perdía claves fuera de DEFAULT
    (y también claves que estaban en DEFAULT con valor vacío eran
    "reset" aunque el cliente no lo pidiera). Eso rompía la
    sincronización multi-dispositivo de Liga: un POST de
    `{liga_schedule: Y}` en un navegador pisaba `liga_results` del
    otro navegador, y al siguiente poll todos veían `0/10`.
    """
    row = get_or_create_global_state()
    incoming = new_state if isinstance(new_state, dict) else {}
    if replace:
        merged = merge_dict(DEFAULT_GLOBAL_STATE, incoming)
    else:
        try:
            existing = json.loads(row.valor_json or "{}")
        except Exception:
            existing = {}
        if not isinstance(existing, dict):
            existing = {}
        # Asegurar que la base tiene todas las claves DEFAULT (para
        # filas antiguas incompletas), pero sin pisar valores reales
        # del row.
        base = merge_dict(DEFAULT_GLOBAL_STATE, existing)
        merged = merge_dict(base, incoming)
    row.valor_json = json.dumps(merged, ensure_ascii=False)
    row.updated_at = utc_now_iso()
    db.session.commit()
    return merged

# ── LIVE STATE COMPARTIDO ────────────────────────────────────────
# Estado de los partidos HvH/HvIA en curso, serializado por el
# frontend (window._liveStore) y compartido entre TODOS los navegadores
# que abran la app. Cada dispositivo hace POST /api/live/state cuando
# ocurre un cambio relevante (kickoff, gol, tarjeta, fin) y hace GET
# periódicamente para recibir los cambios de los otros dispositivos.
#
# Almacenamos una única fila en GlobalState con clave
# `live_state_shared_v1`. El valor es un blob JSON opaco desde el punto
# de vista del backend: no lo interpreta, solo lo persiste y devuelve
# tal cual, con un updated_at UTC que sirve de ETag básico.
LIVE_STATE_KEY = "live_state_shared_v1"
DEFAULT_LIVE_STATE = {"ml": {}, "gmLive": None, "gmBg": {}}

def _get_or_create_live_state_row():
    row = GlobalState.query.filter_by(clave=LIVE_STATE_KEY).first()
    if not row:
        row = GlobalState(
            clave=LIVE_STATE_KEY,
            valor_json=json.dumps(DEFAULT_LIVE_STATE, ensure_ascii=False),
            updated_at=utc_now_iso(),
        )
        db.session.add(row)
        db.session.commit()
    return row

def load_live_state():
    row = _get_or_create_live_state_row()
    try:
        data = json.loads(row.valor_json or "{}")
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {
        "state": data,
        "updated_at": row.updated_at or utc_now_iso(),
    }

_GOAL_TYPES_DIRECT = {"gol", "falta-gol", "pen-gol"}
_GOAL_TYPES_OWN = {"propia"}

def _legacy_evt_key(e):
    """Dedupe key para eventos antiguos sin id (clientes que aún no
    asignaban id). Identifica un evento por su contenido visible."""
    return (
        e.get("type"),
        e.get("min"),
        e.get("team"),
        e.get("num"),
        e.get("player") or e.get("name"),
    )

def _merge_events(existing_events, incoming_events):
    """Union de eventos por `id`. Conserva el orden cronológico:
    primero los existentes, luego los nuevos del incoming.

    Si un id aparece en ambos lados, el del incoming pisa al existente
    (permite editar etiqueta/jugador sin duplicar).

    Eventos sin id (legacy) se deduplican por contenido para que un
    cliente legacy reposteando su snapshot no genere duplicados."""
    existing = existing_events if isinstance(existing_events, list) else []
    incoming = incoming_events if isinstance(incoming_events, list) else []
    merged = []
    pos_by_id = {}
    legacy_seen = set()
    for src in (existing, incoming):
        for e in src:
            if not isinstance(e, dict):
                continue
            eid = e.get("id")
            if eid is not None and eid != "":
                if eid in pos_by_id:
                    merged[pos_by_id[eid]] = e
                else:
                    pos_by_id[eid] = len(merged)
                    merged.append(e)
            else:
                key = _legacy_evt_key(e)
                if key in legacy_seen:
                    continue
                legacy_seen.add(key)
                merged.append(e)
    return merged

def _merge_id_list(existing_list, incoming_list):
    """Union de un array tipo `varAnuladoIds` o ids de tarjetas rojas
    (set semantics, conserva orden de aparición)."""
    out = []
    seen = set()
    for src in (existing_list or [], incoming_list or []):
        if not isinstance(src, list):
            continue
        for v in src:
            try:
                key = json.dumps(v, sort_keys=True, ensure_ascii=False)
            except Exception:
                key = str(v)
            if key in seen:
                continue
            seen.add(key)
            out.append(v)
    return out

def _score_from_events(events, var_anulado_ids):
    """Recalcula el marcador a partir de los eventos, ignorando los
    goles anulados por VAR. Devuelve (a, b) o None si `events` no
    es una lista."""
    if not isinstance(events, list):
        return None
    cancelled = set()
    if isinstance(var_anulado_ids, list):
        for v in var_anulado_ids:
            cancelled.add(v)
    a, b = 0, 0
    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get("id") in cancelled:
            continue
        t = e.get("type")
        team = e.get("team")
        if t in _GOAL_TYPES_DIRECT:
            if team == "a":
                a += 1
            elif team == "b":
                b += 1
        elif t in _GOAL_TYPES_OWN:
            if team == "a":
                b += 1
            elif team == "b":
                a += 1
    return (a, b)

_MONOTONIC_FLAGS = (
    "kickoffDone", "htDone", "stDone", "etDone", "et1Done",
    "finished", "aiEventsGenerated", "injuryScheduled", "injuryInjected",
)

def _merge_match(existing, incoming):
    """Merge per-partido: union de eventos por id, max de timerSec,
    OR de banderas monotónicas, recálculo de marcador a partir de
    eventos. Para el resto de campos, gana el incoming.

    Esto permite que dos humanos editen el mismo partido en paralelo
    sin que un POST le pise al otro los goles/tarjetas que añadió."""
    if not isinstance(existing, dict):
        return incoming if isinstance(incoming, dict) else {}
    if not isinstance(incoming, dict):
        return existing
    out = dict(existing)
    out.update(incoming)
    if "events" in existing or "events" in incoming:
        out["events"] = _merge_events(existing.get("events"), incoming.get("events"))
    out["varAnuladoIds"] = _merge_id_list(
        existing.get("varAnuladoIds"), incoming.get("varAnuladoIds")
    )
    out["redCards"] = _merge_id_list(
        existing.get("redCards"), incoming.get("redCards")
    )
    e_t = existing.get("timerSec")
    i_t = incoming.get("timerSec")
    if isinstance(e_t, (int, float)) and isinstance(i_t, (int, float)):
        out["timerSec"] = max(e_t, i_t)
    for flag in _MONOTONIC_FLAGS:
        if existing.get(flag) or incoming.get(flag):
            out[flag] = True
    sc = _score_from_events(out.get("events"), out.get("varAnuladoIds"))
    if sc is not None:
        out["sc"] = {"a": sc[0], "b": sc[1]}
    return out

def _merge_match_dict(existing_map, incoming_map):
    """Para `ml` y `gmBg`: para cada clave que esté en incoming, hacer
    `_merge_match` con la versión existente. Las claves que NO estén
    en incoming se eliminan (mantiene la semántica "el cliente que
    postea su snapshot completo es la fuente de verdad" para la
    EXISTENCIA del partido). Las claves que estén en ambos lados se
    fusionan a nivel de eventos."""
    if not isinstance(incoming_map, dict):
        return {}
    if not isinstance(existing_map, dict):
        existing_map = {}
    out = {}
    for k, inc in incoming_map.items():
        if k in existing_map:
            out[k] = _merge_match(existing_map[k], inc)
        else:
            out[k] = inc
    return out

def _merge_live_state(existing, incoming):
    """Merge de alto nivel del estado live compartido. Mantiene la
    semántica LWW para qué partidos existen, pero hace UNION de
    eventos cuando un partido aparece en ambos lados — así dos
    humanos pueden añadir eventos al mismo partido en paralelo sin
    que se pisen."""
    if not isinstance(existing, dict):
        existing = {}
    if not isinstance(incoming, dict):
        return existing
    out = dict(existing)
    out.update(incoming)
    if "ml" in incoming:
        out["ml"] = _merge_match_dict(existing.get("ml"), incoming.get("ml"))
    if "gmBg" in incoming:
        out["gmBg"] = _merge_match_dict(existing.get("gmBg"), incoming.get("gmBg"))
    if "gmLive" in incoming:
        inc_gl = incoming.get("gmLive")
        ex_gl = existing.get("gmLive")
        if inc_gl is None:
            out["gmLive"] = None
        elif isinstance(ex_gl, dict) and isinstance(inc_gl, dict) \
                and ex_gl.get("home") == inc_gl.get("home") \
                and ex_gl.get("away") == inc_gl.get("away") \
                and ex_gl.get("j") == inc_gl.get("j"):
            out["gmLive"] = _merge_match(ex_gl, inc_gl)
        else:
            out["gmLive"] = inc_gl
    return out

def save_live_state(new_state):
    row = _get_or_create_live_state_row()
    incoming = new_state if isinstance(new_state, dict) else {}
    try:
        existing = json.loads(row.valor_json or "{}")
    except Exception:
        existing = {}
    if not isinstance(existing, dict):
        existing = {}
    payload = _merge_live_state(existing, incoming)
    row.valor_json = json.dumps(payload, ensure_ascii=False)
    row.updated_at = utc_now_iso()
    db.session.commit()
    return {
        "state": payload,
        "updated_at": row.updated_at,
    }

# --- FUNCIONES MOTOR ---
def calcular_prob(perfil, local=False, goles_previos=0, flags=None):
    # Porteros casi nunca marcan: peso fijo 0.001 ignorando su poder de portería
    if perfil["posicion"] == "portero":
        return 0.001

    base = BASE.get(perfil["posicion"], 10)
    prob = base + (perfil["poder"] / 100)

    if local:
        prob *= BONUS_LOCAL

    prob *= MULTIGOL[min(goles_previos, 4)]

    # Flags obligatorios (CLAUDE.md): se aplican en TODOS los partidos.
    # NO se acumulan ⚾ y 🏀: si hay 🏀, ⚾ se ignora (un jugador es
    # goleador estrella O nato a efectos del peso, no ambos).
    if flags:
        if flags.get("natGoalPro"):
            prob *= 3.0      # 🏀 goleador estrella — ~48% de los goles
        elif flags.get("natGoal"):
            prob *= 1.8      # ⚾ goleador nato — ~30% de los goles
        if flags.get("penalty"):
            prob += 0.40     # P — bonus fijo al peso de goleador
        if flags.get("freeKick"):
            prob += 0.30     # F — bonus fijo al peso de goleador
        # ⭐ elite y C capitán no afectan a esta función (MVP / equipo)
    return prob

def resolve_team_name(team_name):
    clean = (team_name or "").strip()
    return TEAM_ALIASES.get(clean.lower(), clean)

"""Flags obligatorios por equipo (CLAUDE.md): capitan (C), freeKick (F),
penalti (P), elite (⭐), natGoal (⚾), natGoalPro (🏀). Estructura
opcional que, cuando está presente, el motor de simulación aplica en
TODOS los partidos (Liga, Copa, Europa, amistosos). Vacío por defecto
— los admins las marcan desde el editor web y se sincronizan aquí
cuando aplique."""
TEAM_PLAYER_FLAGS = {}


def get_player_flags(team_name, player_name):
    team_flags = TEAM_PLAYER_FLAGS.get(resolve_team_name(team_name)) or \
                 TEAM_PLAYER_FLAGS.get(team_name) or {}
    return team_flags.get(player_name, {}) or {}


def team_has_captain(team_name):
    team_flags = TEAM_PLAYER_FLAGS.get(resolve_team_name(team_name)) or \
                 TEAM_PLAYER_FLAGS.get(team_name) or {}
    return any(f.get("captain") for f in team_flags.values() if isinstance(f, dict))


def get_team_power(team_name):
    resolved = resolve_team_name(team_name)
    squad = jugadores_por_equipo.get(resolved) or jugadores_por_equipo.get(team_name) or []
    if squad:
        powers = [int(j.get("poder", 70) or 70) for j in squad]
        avg = sum(powers) / max(1, len(powers))
        # Capitán (C): +5% obligatorio al valor del equipo (CLAUDE.md)
        if team_has_captain(resolved):
            avg *= 1.05
        return max(1, min(100, round(avg)))
    return 76

def elegir_goleador(equipo, local=False, conteo=None):
    if conteo is None:
        conteo = {}

    resolved = resolve_team_name(equipo)
    jugadores = jugadores_por_equipo[resolved]
    pesos = []

    for j in jugadores:
        goles_previos = conteo.get(j["nombre"], 0)
        flags = get_player_flags(resolved, j["nombre"])
        p = calcular_prob(j, local, goles_previos, flags=flags)
        pesos.append(max(p, 0.001))

    elegido = random.choices(jugadores, weights=pesos, k=1)[0]
    return elegido["nombre"]

def simular_goles(equipo, local=False, oponente=None):
    # Aplicar ventaja local directamente al poder del equipo (+10%)
    own_power = get_team_power(equipo) * (1.10 if local else 1.0)
    if oponente:
        opp_power = get_team_power(oponente)
    else:
        opp_candidates = [name for name in jugadores_por_equipo.keys() if name != resolve_team_name(equipo)]
        opp_power = sum(get_team_power(name) for name in opp_candidates[:6]) / max(1, min(len(opp_candidates), 6))
        if not opp_candidates:
            opp_power = 76
    base_prob = own_power / max(1, (own_power + opp_power))

    if base_prob < 0.42:
        pesos = [46, 33, 14, 5, 2, 0]
    elif base_prob < 0.50:
        pesos = [34, 33, 20, 9, 3, 1]
    elif base_prob < 0.58:
        pesos = [24, 32, 25, 13, 5, 1]
    else:
        pesos = [16, 27, 28, 19, 8, 2]

    return random.choices([0, 1, 2, 3, 4, 5], weights=pesos, k=1)[0]

def simular_marcador(local, visitante):
    # PowerLocal = MediaEquipo * 1.10 (ventaja de localía del 10%)
    r_local = get_team_power(local) * 1.10
    r_visit = get_team_power(visitante)
    base_local = r_local / max(1, (r_local + r_visit))
    prob_local = min(0.82, base_local)

    def sample(prob):
        if prob < 0.42:
            pesos = [46, 33, 14, 5, 2, 0]
        elif prob < 0.50:
            pesos = [34, 33, 20, 9, 3, 1]
        elif prob < 0.58:
            pesos = [24, 32, 25, 13, 5, 1]
        else:
            pesos = [16, 27, 28, 19, 8, 2]
        return random.choices([0, 1, 2, 3, 4, 5], weights=pesos, k=1)[0]

    return sample(prob_local), sample(1 - prob_local)

def elegir_mvp(local, visitante, gl, gv, conteo_local, conteo_visitante):
    candidatos = []

    for j, g in conteo_local.items():
        candidatos.append((j, g, local))
    for j, g in conteo_visitante.items():
        candidatos.append((j, g, visitante))

    if candidatos:
        candidatos.sort(key=lambda x: x[1], reverse=True)
        return candidatos[0][0]

    fallback_team = resolve_team_name(local)
    return random.choice(jugadores_por_equipo[fallback_team])["nombre"]

# --- CALENDARIO ---
def generar_calendario(lista):
    temp = lista[:]
    if len(temp) % 2 != 0:
        temp.append("DESCANSA")

    n = len(temp)
    jornadas = []

    for _ in range(n - 1):
        jornada = []
        for i in range(n // 2):
            l, v = temp[i], temp[n - 1 - i]
            if l != "DESCANSA" and v != "DESCANSA":
                jornada.append((l, v))
        jornadas.append(jornada)
        temp.insert(1, temp.pop())

    vuelta = [[(v, l) for l, v in j] for j in jornadas]
    return jornadas + vuelta

calendario = generar_calendario(equipos)

# --- COPA DEL REY ---
COPA_SEEDING = {
    "r1":  ["Albacete BP", "Levante UD", "Real Oviedo", "Deportivo Alavés"],
    "r2_direct":  ["Elche CF", "Córdoba CF", "Getafe CF", "Sevilla FC", "Mallorca", "Valencia CF"],
    "r16_direct": ["Celta de Vigo", "Espanyol", "Rayo Vallecano", "Osasuna", "Girona FC",
                   "Athletic Club", "Real Betis", "Real Sociedad", "Villarreal CF",
                   "Atlético Madrid", "Real Madrid", "FC Barcelona"]
}

def copa_sim_partido(local, visitante, two_leg=False):
    gl, gv = simular_marcador(local, visitante)
    conteo_l, conteo_v = {}, {}
    for _ in range(gl):
        g = elegir_goleador(local, True, conteo_l)
        conteo_l[g] = conteo_l.get(g, 0) + 1
    for _ in range(gv):
        g = elegir_goleador(visitante, False, conteo_v)
        conteo_v[g] = conteo_v.get(g, 0) + 1
    mvp = elegir_mvp(local, visitante, gl, gv, conteo_l, conteo_v)
    et_gl, et_gv, pen_winner, winner = 0, 0, None, None
    if not two_leg and gl == gv:
        et_gl = random.choices([0, 1, 2], weights=[55, 35, 10])[0]
        et_gv = random.choices([0, 1, 2], weights=[55, 35, 10])[0]
        total_l = gl + et_gl
        total_v = gv + et_gv
        if total_l > total_v:
            winner = local
        elif total_v > total_l:
            winner = visitante
        else:
            pen_winner = random.choice([local, visitante])
            winner = pen_winner
    elif not two_leg:
        winner = local if gl > gv else visitante
    return {"gl": gl, "gv": gv, "et_gl": et_gl, "et_gv": et_gv,
            "pen_winner": pen_winner, "winner": winner, "mvp": mvp, "jugado": True}

@app.route("/api/copa/state", methods=["GET"])
def copa_get_state():
    data = load_global_state()
    return jsonify({"ok": True, "copa": data.get("copa_state") or {}})


@app.route("/api/forma_counter", methods=["GET"])
def forma_counter_get():
    """Contador persistente de estados ↘️ por jugador. Al llegar a 3 se
    dispara LESIÓN LEVE automática y se resetea a 0 (lo hace el cliente,
    esto solo almacena el contador)."""
    data = load_global_state()
    return jsonify({"ok": True, "counters": data.get("forma_down_counter") or {}})


@app.route("/api/forma_counter", methods=["POST"])
def forma_counter_save():
    payload = request.get_json(silent=True) or {}
    counters = payload.get("counters")
    if not isinstance(counters, dict):
        return jsonify({"ok": False, "error": "counters debe ser objeto"}), 400
    cleaned = {}
    for name, value in counters.items():
        try:
            n = int(value)
        except (TypeError, ValueError):
            continue
        if n > 0:
            cleaned[str(name)] = n
    data = load_global_state()
    data["forma_down_counter"] = cleaned
    save_global_state(data)
    return jsonify({"ok": True, "counters": cleaned})

COPA_TWO_LEG = ("oct", "cua", "sf")  # ida+vuelta. r1/r2/r16/fin = single-leg.
COPA_NEXT_PHASE = {"r1": "r2", "r2": "r16", "r16": "oct",
                   "oct": "cua", "cua": "sf", "sf": "fin", "fin": "campeon"}


@app.route("/api/copa/sorteo", methods=["POST"])
def copa_sorteo():
    """Sortear una ronda de Copa del Rey.

    Spec usuario (2026-05-04):
      - 82 equipos = Liga EA (20) + Hypermotion (22) + Primera Fed (40)
      - r1 (1ª Ronda): 36 equipos = 5 humanos + 31 random Primera Fed
        → 18 ties single-leg, local = MENOR nivel, ET+pen si empate.
      - r2 (2ª Ronda): 64 equipos = 18 ganadores r1 + 46 pre-clasificados
        → 32 ties single-leg, mismo formato.
      - r16/oct/cua/sf: ida+vuelta, vuelta SIEMPRE en campo del menor.
      - fin: partido único en sede neutral.

    El cliente (copa-engine.js) conoce los 82 equipos y sus niveles, así
    que envía `pairs` ya emparejados con local=menor (o local=mayor en
    two-leg para que la vuelta caiga en el menor). El backend solo
    persiste lo recibido. Para retrocompatibilidad, si `pairs` no viene,
    cae al COPA_SEEDING viejo.
    """
    payload = request.get_json(silent=True) or {}
    ronda = payload.get("ronda")
    if ronda not in ("r1", "r2", "r16", "oct", "cua", "sf", "fin"):
        return jsonify({"ok": False, "error": "Ronda inválida"}), 400
    data = load_global_state()
    copa = data.get("copa_state") or {"fase": "r1", "sorteo": {}, "resultados": {}, "clasificados": {}}
    sorteo = copa.get("sorteo", {})
    clasificados = copa.get("clasificados", {})

    pairs_in = payload.get("pairs")
    if isinstance(pairs_in, list) and pairs_in:
        # Cliente envía emparejamientos ya resueltos (camino nuevo).
        matches = []
        for p in pairs_in:
            if not isinstance(p, dict): continue
            l = str(p.get("l", "")).strip()
            v = str(p.get("v", "")).strip()
            if l and v:
                matches.append({"l": l, "v": v})
        if not matches:
            return jsonify({"ok": False, "error": "pairs vacío o inválido"}), 400
    else:
        # Fallback legacy: usa COPA_SEEDING hardcoded (estructura antigua).
        if ronda == "r1":
            teams = COPA_SEEDING["r1"][:]
            random.shuffle(teams)
        elif ronda == "r2":
            teams = clasificados.get("r1", []) + COPA_SEEDING["r2_direct"][:]
            random.shuffle(teams)
        elif ronda == "r16":
            teams = clasificados.get("r2", []) + COPA_SEEDING["r16_direct"][:]
            random.shuffle(teams)
        elif ronda in ("oct", "cua", "sf"):
            prev = {"oct": "r16", "cua": "oct", "sf": "cua"}[ronda]
            teams = clasificados.get(prev, [])[:]
            random.shuffle(teams)
        elif ronda == "fin":
            teams = clasificados.get("sf", []) or clasificados.get("cua", [])
            if len(teams) < 2:
                return jsonify({"ok": False, "error": "No hay 2 finalistas"}), 400
        if len(teams) % 2 != 0:
            return jsonify({"ok": False, "error": f"Número impar de equipos ({len(teams)})"}), 400
        matches = [{"l": teams[i], "v": teams[i+1]} for i in range(0, len(teams), 2)]

    sorteo[ronda] = matches
    copa["sorteo"] = sorteo
    copa["fase"] = ronda
    data["copa_state"] = copa
    save_global_state(data)
    return jsonify({"ok": True, "matches": matches, "copa": copa})

@app.route("/api/copa/simular_ia", methods=["POST"])
def copa_simular_ia():
    payload = request.get_json(silent=True) or {}
    ronda = payload.get("ronda")
    idx = int(payload.get("idx", 0))
    es_vuelta = payload.get("es_vuelta", False)
    data = load_global_state()
    copa = data.get("copa_state") or {"sorteo": {}, "resultados": {}, "clasificados": {}}
    sorteo_ronda = copa.get("sorteo", {}).get(ronda, [])
    if idx >= len(sorteo_ronda):
        return jsonify({"ok": False, "error": "Partido no encontrado"}), 400
    match = sorteo_ronda[idx]
    local, visitante = match["l"], match["v"]
    resultados = copa.get("resultados", {})
    two_leg = ronda in COPA_TWO_LEG
    if two_leg:
        key_ida = ronda + "_ida"
        key_vta = ronda + "_vta"
        if not es_vuelta:
            res = copa_sim_partido(local, visitante, two_leg=True)
            if key_ida not in resultados:
                resultados[key_ida] = [None] * len(sorteo_ronda)
            resultados[key_ida][idx] = res
        else:
            res = copa_sim_partido(visitante, local, two_leg=True)
            if key_vta not in resultados:
                resultados[key_vta] = [None] * len(sorteo_ronda)
            resultados[key_vta][idx] = res
            ida = (resultados.get(key_ida) or [None]*len(sorteo_ronda))[idx] or {}
            total_l = ida.get("gl", 0) + res["gv"]
            total_v = ida.get("gv", 0) + res["gl"]
            if total_l > total_v:
                winner = local
            elif total_v > total_l:
                winner = visitante
            else:
                winner = random.choice([local, visitante])
                resultados[key_vta][idx]["pen_winner"] = winner
            resultados[key_vta][idx]["winner"] = winner
    else:
        res = copa_sim_partido(local, visitante, two_leg=False)
        if ronda not in resultados:
            resultados[ronda] = [None] * len(sorteo_ronda)
        resultados[ronda][idx] = res
    copa["resultados"] = resultados
    data["copa_state"] = copa
    save_global_state(data)
    return jsonify({"ok": True, "copa": copa})

@app.route("/api/copa/guardar_resultado", methods=["POST"])
def copa_guardar_resultado():
    payload = request.get_json(silent=True) or {}
    ronda = payload.get("ronda")
    idx = int(payload.get("idx", 0))
    es_vuelta = payload.get("es_vuelta", False)
    gl = int(payload.get("gl", 0))
    gv = int(payload.get("gv", 0))
    et_gl = int(payload.get("et_gl", 0))
    et_gv = int(payload.get("et_gv", 0))
    pen_winner = payload.get("pen_winner")
    pen_score = payload.get("pen_score", "")
    mvp = payload.get("mvp", "")
    events = payload.get("events") or []
    injuries = payload.get("injuries") or []
    summary = payload.get("summary", "")
    team_a = payload.get("team_a", "")
    team_b = payload.get("team_b", "")
    data = load_global_state()
    copa = data.get("copa_state") or {"sorteo": {}, "resultados": {}, "clasificados": {}}
    sorteo_ronda = copa.get("sorteo", {}).get(ronda, [])
    match = sorteo_ronda[idx] if idx < len(sorteo_ronda) else {}
    local_orig, visit_orig = match.get("l", ""), match.get("v", "")
    resultados = copa.get("resultados", {})
    two_leg = ronda in COPA_TWO_LEG
    res = {"gl": gl, "gv": gv, "et_gl": et_gl, "et_gv": et_gv,
           "pen_winner": pen_winner, "pen_score": pen_score, "mvp": mvp,
           "events": events, "injuries": injuries, "summary": summary,
           "team_a": team_a or local_orig, "team_b": team_b or visit_orig,
           "jugado": True}
    # Init defensivo: en two-leg IDA `winner` no se calcula porque
    # aún no hay global. Sin este None, el bloque `if winner:` de
    # más abajo lanzaba NameError → endpoint 500 → frontend no
    # recibía d.copa → la IDA aparecía como "no jugada" tras volver
    # al bracket. Reportado 2026-05-07 (Atlético 3-1 Las Palmas IDA
    # octavos).
    winner = None
    if two_leg:
        key = ronda + ("_vta" if es_vuelta else "_ida")
        if key not in resultados:
            resultados[key] = [None] * len(sorteo_ronda)
        resultados[key][idx] = res
        if es_vuelta:
            key_ida = ronda + "_ida"
            ida = (resultados.get(key_ida) or [None]*len(sorteo_ronda))[idx] or {}
            total_l = ida.get("gl", 0) + gv
            total_v = ida.get("gv", 0) + gl
            if total_l > total_v:
                winner = local_orig
            elif total_v > total_l:
                winner = visit_orig
            else:
                winner = pen_winner or local_orig
            resultados[key][idx]["winner"] = winner
    else:
        total_l = gl + et_gl
        total_v = gv + et_gv
        if total_l > total_v:
            winner = local_orig if not es_vuelta else visit_orig
        elif total_v > total_l:
            winner = visit_orig if not es_vuelta else local_orig
        else:
            winner = pen_winner or local_orig
        res["winner"] = winner
        if ronda not in resultados:
            resultados[ronda] = [None] * len(sorteo_ronda)
        resultados[ronda][idx] = res
    copa["resultados"] = resultados
    # Auto-resolución de TBDs (2026-05-06): si esta ronda tenía un
    # `@<ronda>#<idx>` referenciado en cualquier sorteo o clasificados
    # posterior, lo reemplazamos por el ganador real ahora. Sin esto
    # el cliente dependía de `_copaResolveTbdExternal` que hacía
    # state_set por separado — race conditions hacían que a veces el
    # TBD no se actualizara y los humanos "desaparecían" del bracket
    # de Dieciseisavos. Bug reportado: Atlético Madrid ganó r2 pero no
    # apareció en r16. El backend ahora garantiza la consistencia
    # transaccional (un solo save).
    if winner:
        tbd_key = "@" + ronda + "#" + str(idx)
        # 1) Reemplazar en clasificados de TODAS las rondas.
        for r_key, c_list in (copa.get("clasificados") or {}).items():
            if not isinstance(c_list, list): continue
            for ci, name in enumerate(c_list):
                if name == tbd_key:
                    c_list[ci] = winner
        # 2) Reemplazar en sorteo de TODAS las rondas.
        for r_key, m_list in (copa.get("sorteo") or {}).items():
            if not isinstance(m_list, list): continue
            for m in m_list:
                if not isinstance(m, dict): continue
                if m.get("l") == tbd_key: m["l"] = winner
                if m.get("v") == tbd_key: m["v"] = winner
        # 3) Si la final ha acabado, fijamos el campeón en el state.
        # Reportado 2026-05-07: tras ganar la final no se guardaba.
        if ronda == "fin":
            copa["campeon"] = winner
            loser = visit_orig if winner == local_orig else local_orig
            copa["subcampeon"] = loser
    data["copa_state"] = copa
    save_global_state(data)
    return jsonify({"ok": True, "copa": copa})

@app.route("/api/copa/clasificar", methods=["POST"])
def copa_clasificar():
    """Calcula los `clasificados` de la ronda. Permite clasificación
    PARCIAL: para los partidos que aún no se han jugado, añade un
    placeholder TBD `@<ronda>#<idx>` que luego se reemplazará por el
    ganador real cuando ese partido finalice (vía /api/copa/state_set
    desde el cliente). Esto deja al usuario sortear la siguiente
    ronda aunque queden humanos pendientes de jugar la actual."""
    payload = request.get_json(silent=True) or {}
    ronda = payload.get("ronda")
    data = load_global_state()
    copa = data.get("copa_state") or {"sorteo": {}, "resultados": {}, "clasificados": {}}
    sorteo_ronda = copa.get("sorteo", {}).get(ronda, [])
    resultados = copa.get("resultados", {})
    clasificados = copa.get("clasificados", {})
    two_leg = ronda in COPA_TWO_LEG
    if two_leg:
        res_list = resultados.get(ronda + "_vta", [])
    else:
        res_list = resultados.get(ronda, [])
    winners = []
    for idx, match in enumerate(sorteo_ronda):
        res = res_list[idx] if (res_list and idx < len(res_list)) else None
        if res and res.get("winner"):
            winners.append(res["winner"])
        else:
            winners.append("@" + ronda + "#" + str(idx))
    clasificados[ronda] = winners
    if ronda == "fin" and winners and not winners[0].startswith("@"):
        clasificados["campeon"] = winners[0]
    copa["clasificados"] = clasificados
    copa["fase"] = COPA_NEXT_PHASE.get(ronda, copa.get("fase", "r1"))
    data["copa_state"] = copa
    save_global_state(data)
    return jsonify({"ok": True, "clasificados": winners, "copa": copa})


@app.route("/api/copa/state_set", methods=["POST"])
def copa_state_set():
    """Acepta el `copa_state` completo y lo persiste tal cual. Usado por
    el cliente cuando, tras finalizar un partido pendiente, reemplaza
    los TBD `@<ronda>#<idx>` por el ganador real en `sorteo` y
    `clasificados` para que la UI siga sincronizada. La validación
    delegada al cliente — esto es solo storage."""
    payload = request.get_json(silent=True) or {}
    new_state = payload.get("copa")
    if not isinstance(new_state, dict):
        return jsonify({"ok": False, "error": "payload.copa requerido"}), 400
    data = load_global_state()
    data["copa_state"] = new_state
    save_global_state(data)
    return jsonify({"ok": True, "copa": new_state})


@app.route("/api/copa/reiniciar", methods=["POST"])
def copa_reiniciar():
    data = load_global_state()
    data["copa_state"] = {"fase": "r1", "sorteo": {}, "resultados": {}, "clasificados": {}}
    # replace=True para que el copa_state interno se borre por completo
    # (el merge por defecto es aditivo y no limpia claves anidadas).
    save_global_state(data, replace=True)
    return jsonify({"ok": True})

# Nombres de los 20 equipos de Liga EA Sports tal como los usa el
# cliente (misc_body_2.html). Se mantiene sincronizado a mano porque el
# Python de esta app tiene otros nombres (jugadores_data) que no valen
# para la Liga EA (p.ej. "Celta" vs "Celta de Vigo"). Si en el futuro
# se hace configurable desde el editor, sustitúyase por la lectura del
# estado; hoy basta con la constante.
# Debe coincidir EXACTAMENTE con la lista `TEAMS` del cliente
# (misc_body_2.html). Si el servidor genera un calendario con un equipo
# que el cliente no reconoce (p.ej. "Bayern Munich" cuando el cliente ya
# tiene "Liverpool"), `isValidLigaSchedule` lo rechaza y el calendario
# nuevo nunca se adopta — el bug del calendario que «no cambia».
LIGA_EA_TEAMS_DEFAULT = [
    "Real Madrid", "Athletic Club", "Real Sociedad", "Sevilla", "Villarreal",
    "Mallorca", "Valencia CF", "Espanyol", "Liverpool", "Celta de Vigo",
    "Deportivo Alavés", "Osasuna", "Getafe CF", "Arsenal", "Girona FC",
    "Elche CF", "Atlético Madrid", "Rayo Vallecano", "Real Betis", "FC Barcelona",
]


def _liga_extract_teams(schedule):
    """Extrae los nombres únicos de equipos de un schedule serializado."""
    if not isinstance(schedule, list):
        return []
    out = []
    seen = set()
    for jornada in schedule:
        if not isinstance(jornada, list):
            continue
        for match in jornada:
            if not isinstance(match, (list, tuple)) or len(match) < 2:
                continue
            for team in (match[0], match[1]):
                if isinstance(team, str) and team and team not in seen:
                    seen.add(team)
                    out.append(team)
    return out


def _liga_calendario_aleatorio(teams, distinto_a=None):
    """Genera un calendario de 38 jornadas con el orden de equipos
    aleatorizado. Si `distinto_a` se proporciona y el resultado coincide,
    vuelve a intentar; si tras 10 intentos sigue igual (probabilidad
    astronómicamente baja), rota el array no-trivialmente como garantía
    absoluta.
    """
    base = list(teams)
    for _ in range(10):
        random.shuffle(base)
        cal = generar_calendario(base)
        cal_lists = [[list(m) for m in jor] for jor in cal]
        if len(cal_lists) == 38 and cal_lists != distinto_a:
            return cal_lists
    # Fallback: rotar por un offset derivado del reloj — siempre
    # distinto entre dos llamadas consecutivas.
    ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000)
    offset = 1 + (ns % (len(base) - 1))
    rotated = base[offset:] + base[:offset]
    cal = generar_calendario(rotated)
    return [[list(m) for m in jor] for jor in cal]


@app.route("/api/state/reset-liga", methods=["POST"])
def api_state_reset_liga():
    """Reset FORZADO de Liga EA Sports (clasificación + resultados).

    Por qué existe este endpoint: el POST normal a `/api/state` con
    patch `{liga_results: {}}` NO vacía `liga_results` porque
    `merge_dict` recursa y, al iterar un dict incoming vacío, no
    sobreescribe las claves anidadas del base. Eso provoca que al
    pulsar "Res" desde el móvil los resultados "reaparezcan" en el
    siguiente poll (el servidor devuelve el estado anterior).

    Este endpoint usa `replace=True` sobre una copia del estado con
    `liga_results` forzado a `{}`, así el servidor se queda con la
    versión vacía y la propaga a todos los dispositivos.

    Acepta opcionalmente un `liga_schedule` nuevo en el body para
    aplicar un calendario recién generado en el cliente en la misma
    operación atómica.

    GARANTÍA DE NUEVO CALENDARIO (server-side): si el body no trae un
    `liga_schedule` válido, o si el que trae es IDÉNTICO al actual
    (caso de clientes con JS cacheado o RNG con poca entropía en
    WebViews móviles), el servidor genera él mismo un calendario
    aleatorio distinto del actual. Así el usuario SIEMPRE ve un
    calendario nuevo tras pulsar Res, sin depender de la calidad
    del RNG del navegador."""
    body = request.get_json(silent=True) or {}
    data = load_global_state()
    data["liga_results"] = {}

    current_schedule = data.get("liga_schedule")
    client_schedule = body.get("liga_schedule")

    # Si el cliente manda un calendario válido (38 jornadas no vacías)
    # y DISTINTO del actual, lo aceptamos tal cual: así el dispositivo
    # que ha hecho el sorteo y el resto de dispositivos ven exactamente
    # el mismo cuadro, sin parpadeo. El recelo histórico al calendario
    # del cliente era por el JS cacheado que reenviaba SIEMPRE el mismo;
    # el chequeo «distinto del actual» ya cubre ese caso — si llega
    # idéntico, lo genera el servidor con su propia entropía.
    #
    # Si no llega calendario válido (o es idéntico al actual), lo genera
    # el servidor: barajamos los equipos con random.shuffle — entropía
    # del sistema, fresca en cada request.
    if (
        isinstance(client_schedule, list)
        and len(client_schedule) == 38
        and all(isinstance(j, list) and j for j in client_schedule)
        and client_schedule != current_schedule
    ):
        new_schedule = client_schedule
    else:
        teams = (
            _liga_extract_teams(current_schedule)
            or _liga_extract_teams(client_schedule)
            or list(LIGA_EA_TEAMS_DEFAULT)
        )
        if len(teams) != 20:
            teams = list(LIGA_EA_TEAMS_DEFAULT)
        new_schedule = _liga_calendario_aleatorio(teams, distinto_a=current_schedule)

    data["liga_schedule"] = new_schedule
    save_global_state(data, replace=True)
    row = get_or_create_global_state()
    resp = jsonify({
        "ok": True,
        "state": {
            "liga_results": data["liga_results"],
            "liga_schedule": data.get("liga_schedule"),
        },
        "updated_at": row.updated_at or "",
    })
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

# --- SIMULACIÓN ---
def _elegir_jugador_campo(equipo, es_local=False):
    """Elige un jugador de campo aleatorio (no portero) ponderado por poder."""
    resolved = resolve_team_name(equipo)
    jugadores = jugadores_por_equipo.get(resolved, [])
    campo = [j for j in jugadores if j.get("posicion") != "portero"]
    if not campo:
        campo = jugadores
    if not campo:
        return "Jugador"
    pesos = [max(1, int(j.get("poder", 70) or 70)) for j in campo]
    return random.choices(campo, weights=pesos, k=1)[0]["nombre"]



# --- MÓDULO DE DISCIPLINA: Modificador de probabilidad tras tarjeta roja ---

# Impacto según el minuto de la expulsión (Módulo 4)
def _modificador_expulsion(minuto):
    """Devuelve el modificador de probabilidad de goles para el equipo con 10 jugadores.

    Basado en el Módulo 4 del documento de arquitectura (rangos semiabiertos [start, end)):
    [00, 30) Crítico:   reducción del 40% → multiplicador 0.60.
    [30, 70) Grave:     reducción del 30% → multiplicador 0.70.
    [70, 90] Defensivo: reducción del 20% → multiplicador 0.80.
    """
    if minuto < 30:
        return 0.60   # 40% de reducción
    elif minuto < 70:
        return 0.70   # 30% de reducción
    else:
        return 0.80   # 20% de reducción


def simular_y_guardar(jornada, local, visitante):
    """Motor de simulación IA vs IA (Módulo 6 del documento de arquitectura).

    Implementa:
    - Módulo 1: Gol estándar, falta, penalti, autogol → Score +1 con equipo correcto.
    - Módulo 2: Flujo de penalti: provocado → probabilidad lanzador vs portero → resultado.
    - Módulo 3: Filtro de expulsiones con bloqueo de ID del jugador (amarilla → doble → roja).
    - Módulo 4: Probabilidades dinámicas tras expulsión según minuto.
    - Módulo 5: Acta cronológica con minuto asignado a cada evento.
    """
    if Partido.query.filter_by(local=local, visitante=visitante).first():
        return

    # ---- Estado interno del partido ----
    # tarjetas: {jugador_nombre: count_amarillas}
    tarjetas = {}
    # expulsados: set de nombres bloqueados
    expulsados = set()
    # modificador de goles para el equipo con 10 hombres (1.0 = sin penalización)
    mod_local = 1.0
    mod_visit = 1.0

    # Acta cronológica: lista de (minuto, tipo, equipo, jugador)
    acta = []

    # ---- Minutos usados para garantizar unicidad cronológica ----
    minutos_usados = set()

    def _minuto_unico(min_base, rango=3):
        """Genera un minuto único dentro de [min_base, min_base+rango]."""
        for delta in range(rango + 1):
            m = min(90, min_base + delta)
            if m not in minutos_usados:
                minutos_usados.add(m)
                return m
        # fallback: registrar el minuto base aunque se repita
        minutos_usados.add(min_base)
        return min_base

    def _jugador_disponible(equipo, es_local=False):
        """Elige un jugador de campo que NO esté expulsado."""
        resolved = resolve_team_name(equipo)
        jugadores = jugadores_por_equipo.get(resolved, [])
        campo = [j for j in jugadores
                 if j.get("posicion") != "portero" and j["nombre"] not in expulsados]
        if not campo:
            campo = [j for j in jugadores if j["nombre"] not in expulsados]
        if not campo:
            # Todos expulsados (situación extrema): usa cualquiera
            campo = jugadores_por_equipo.get(resolved, [{"nombre": "Jugador", "poder": 70}])
        pesos = [max(1, int(j.get("poder", 70) or 70)) for j in campo]
        return random.choices(campo, weights=pesos, k=1)[0]["nombre"]

    def _check_status(jugador_nombre):
        """Devuelve False si el jugador está expulsado (Check_Status del Módulo 6)."""
        return jugador_nombre not in expulsados

    def _procesar_tarjeta(equipo, jugador, minuto, tipo_inicial="amarilla"):
        """Módulo 3: lógica de disciplina con bloqueo de ID tras expulsión."""
        nonlocal mod_local, mod_visit

        if not _check_status(jugador):
            return  # ID bloqueado: abortar

        if tipo_inicial == "roja":
            expulsados.add(jugador)
            acta.append((minuto, "roja", equipo, jugador))
        else:
            # Tarjeta amarilla
            tarjetas[jugador] = tarjetas.get(jugador, 0) + 1
            if tarjetas[jugador] >= 2:
                # Doble amarilla → expulsión
                acta.append((minuto, "doble-amarilla", equipo, jugador))
                expulsados.add(jugador)
            else:
                acta.append((minuto, "amarilla", equipo, jugador))
                return  # Solo amarilla, sin expulsión

        # El jugador queda expulsado: actualizar modificadores (Módulo 4)
        mod = _modificador_expulsion(minuto)
        if equipo == local:
            mod_local = min(mod_local, mod)
        else:
            mod_visit = min(mod_visit, mod)

    # ================================================================
    # Módulo 1+4: Simular goles con modificador dinámico
    # ================================================================
    gl_base = simular_goles(local, True, oponente=visitante)
    gv_base = simular_goles(visitante, False, oponente=local)

    # Los modificadores se aplican después de generar las rojas (lógica secuencial).
    # En la práctica la expulsión ocurre durante el partido, por lo que re-simulamos
    # sólo si hubo rojas en la fase de tarjetas, usando los modificadores resultantes.
    # Para preservar la lógica de flujo, primero registramos todos los eventos de
    # goles/penaltis/faltas con su minuto, y luego las tarjetas.

    # ---- Asignar minutos a goles ----
    # Distribuimos los goles del local a lo largo de 90 minutos
    minutos_goles_local = sorted(random.sample(range(1, 91), min(gl_base, 90)))
    minutos_goles_visit = sorted(random.sample(range(1, 91), min(gv_base, 90)))

    conteo_local = {}
    conteo_visitante = {}
    goles_acta_local = 0
    goles_acta_visit = 0

    for minuto in minutos_goles_local:
        g = elegir_goleador(local, True, conteo_local)
        conteo_local[g] = conteo_local.get(g, 0) + 1
        m = _minuto_unico(minuto)
        acta.append((m, "gol", local, g))
        goles_acta_local += 1

    for minuto in minutos_goles_visit:
        g = elegir_goleador(visitante, False, conteo_visitante)
        conteo_visitante[g] = conteo_visitante.get(g, 0) + 1
        m = _minuto_unico(minuto)
        acta.append((m, "gol", visitante, g))
        goles_acta_visit += 1

    # ================================================================
    # Módulo 2: Flujo de penalti (Activación → Resolución → Resultado)
    # ================================================================
    if random.random() < 0.08:
        pen_minuto = _minuto_unico(random.randint(10, 85))
        pen_equipo = random.choice([local, visitante])
        pen_es_local = (pen_equipo == local)
        foul_equipo = visitante if pen_es_local else local

        # Activación: pen-prov (el jugador atacante que provoca la pena máxima)
        pen_jugador = _jugador_disponible(pen_equipo, pen_es_local)
        if _check_status(pen_jugador):
            acta.append((pen_minuto, "pen-prov", pen_equipo, pen_jugador))

            # El defensor que comete la falta puede recibir tarjeta
            foul_jugador = _jugador_disponible(foul_equipo)
            if _check_status(foul_jugador):
                m_foul = _minuto_unico(pen_minuto)
                if random.random() < PENALTY_FOUL_CARD_PROBABILITY:
                    _procesar_tarjeta(foul_equipo, foul_jugador, m_foul)
                else:
                    acta.append((m_foul, "pen-prov", foul_equipo, foul_jugador))

            # Resolución: atributo del lanzador vs reflejos del portero + azar
            resolved_foul = resolve_team_name(foul_equipo)
            gks = [j for j in jugadores_por_equipo.get(resolved_foul, [])
                   if j.get("posicion") == "portero"]
            gk_poder = gks[0].get("poder", 80) if gks else 80
            pen_poder = next(
                (j.get("poder", 80) for j in jugadores_por_equipo.get(
                    resolve_team_name(pen_equipo), []) if j["nombre"] == pen_jugador),
                80
            )
            # Probabilidad de gol: lanzador vs portero, con factor azar (capped at 1.0)
            prob_gol_pen = min(1.0, (pen_poder / (pen_poder + gk_poder)) * PENALTY_BASE_WEIGHT + random.uniform(0, PENALTY_RANDOM_FACTOR))
            if prob_gol_pen > 0.50:
                # Penalti convertido → el portero no para (no se añade pen-parado)
                acta.append((_minuto_unico(pen_minuto), "pen-gol", pen_equipo, pen_jugador))
                if pen_equipo == local:
                    goles_acta_local += 1
                else:
                    goles_acta_visit += 1
            else:
                # Penalti fallado: parada efectiva o fuera
                if gks and random.random() < PENALTY_SAVE_PROBABILITY:
                    acta.append((_minuto_unico(pen_minuto), "pen-parado", foul_equipo, gks[0]["nombre"]))
                else:
                    acta.append((_minuto_unico(pen_minuto), "pen-fallo", pen_equipo, pen_jugador))

    # ================================================================
    # Gol de falta (5% por partido)
    # ================================================================
    if random.random() < 0.05:
        fk_minuto = _minuto_unico(random.randint(5, 88))
        fk_equipo = random.choice([local, visitante])
        fk_jugador = _jugador_disponible(fk_equipo, fk_equipo == local)
        if _check_status(fk_jugador):
            acta.append((fk_minuto, "falta-gol", fk_equipo, fk_jugador))
            if fk_equipo == local:
                goles_acta_local += 1
            else:
                goles_acta_visit += 1

    # ================================================================
    # Módulo 1: Autogol (1% por partido) → suma al equipo CONTRARIO
    # ================================================================
    if random.random() < 0.01:
        og_minuto = _minuto_unico(random.randint(5, 88))
        og_equipo = random.choice([local, visitante])
        og_jugador = _jugador_disponible(og_equipo, og_equipo == local)
        if _check_status(og_jugador):
            acta.append((og_minuto, "propia", og_equipo, og_jugador))
            # El autogol suma al equipo contrario
            if og_equipo == local:
                goles_acta_visit += 1
            else:
                goles_acta_local += 1

    # ================================================================
    # Módulo 3: Tarjetas (2-4 por partido) con lógica de doble amarilla
    # ================================================================
    num_amarillas = random.choices([2, 3, 4], weights=[40, 40, 20])[0]
    for _ in range(num_amarillas):
        am_minuto = _minuto_unico(random.randint(5, 89))
        am_equipo = random.choice([local, visitante])
        am_jugador = _jugador_disponible(am_equipo, am_equipo == local)
        if _check_status(am_jugador):
            _procesar_tarjeta(am_equipo, am_jugador, am_minuto)

    # Roja directa (3% por partido)
    if random.random() < 0.03:
        roja_minuto = _minuto_unico(random.randint(5, 89))
        roja_equipo = random.choice([local, visitante])
        roja_jugador = _jugador_disponible(roja_equipo, roja_equipo == local)
        if _check_status(roja_jugador):
            _procesar_tarjeta(roja_equipo, roja_jugador, roja_minuto, tipo_inicial="roja")

    # ================================================================
    # Módulo 4: Aplicar modificadores dinámicos si hubo expulsiones.
    # El modificador reduce la probabilidad de que el equipo mermado
    # mantenga todos sus goles. Cuando se descuenta un gol también se
    # elimina el último evento de gol del equipo del acta para mantener
    # consistencia entre el marcador y el registro de eventos.
    # ================================================================
    def _descontar_gol_acta(equipo):
        """Elimina el último evento de gol del equipo del acta y devuelve True si lo hizo."""
        for i in range(len(acta) - 1, -1, -1):
            if acta[i][1] == "gol" and acta[i][2] == equipo:
                acta.pop(i)
                return True
        return False

    if mod_local < 1.0 and goles_acta_local > 0:
        if random.random() > mod_local:
            if _descontar_gol_acta(local):
                goles_acta_local -= 1
    if mod_visit < 1.0 and goles_acta_visit > 0:
        if random.random() > mod_visit:
            if _descontar_gol_acta(visitante):
                goles_acta_visit -= 1

    # ================================================================
    # Módulo 5 + 6: Ordenar acta cronológicamente y calcular premios finales
    # ================================================================
    acta.sort(key=lambda x: x[0])

    # Post-proceso: garantizar consistencia cronológica de expulsiones.
    # Si un evento de expulsión tiene un minuto menor que un evento previo
    # del mismo jugador, eliminamos los eventos anteriores incoherentes.
    expulsion_minuto = {}  # jugador → minuto de expulsión
    for minuto, tipo, eq, jug in acta:
        if tipo in ("roja", "doble-amarilla"):
            expulsion_minuto[jug] = minuto

    acta_filtrada = []
    for minuto, tipo, eq, jug in acta:
        if jug in expulsion_minuto and minuto >= expulsion_minuto[jug] and tipo not in ("roja", "doble-amarilla"):
            continue   # evento en el minuto de expulsión o posterior: descartado
        acta_filtrada.append((minuto, tipo, eq, jug))
    acta = acta_filtrada

    # MVP: jugador con más goles; si empate, el primero de la lista
    mvp = elegir_mvp(local, visitante, goles_acta_local, goles_acta_visit,
                     conteo_local, conteo_visitante)

    # Portería imbatida: equipo cuyo portero no recibió goles
    porteria_imbatida = None
    if goles_acta_visit == 0:
        porteria_imbatida = local
    elif goles_acta_local == 0:
        porteria_imbatida = visitante

    # ================================================================
    # Persistencia en BD
    # ================================================================
    p = Partido(
        jornada=jornada,
        local=local,
        visitante=visitante,
        goles_local=goles_acta_local,
        goles_visitante=goles_acta_visit,
        mvp=mvp,
        porteria_imbatida=porteria_imbatida,
    )
    db.session.add(p)
    db.session.commit()

    for minuto, tipo, eq, jug in acta:
        db.session.add(Evento(
            partido_id=p.id,
            tipo=tipo,
            equipo=eq,
            jugador=jug,
            minuto=minuto,
        ))
    db.session.commit()


# --- API ESTADO COMPARTIDO ---
@app.route("/api/state", methods=["GET"])
def api_get_state():
    """Devuelve el estado compartido (Liga, Segunda, Primera, Copa, etc.).

    Soporta `?since=<iso>` para 304 Not Modified si el cliente ya tiene
    la versión más reciente, igual que /api/live/state. Esto permite
    al frontend hacer polling barato cada pocos segundos para que los
    resultados de Liga simulados en un dispositivo (ej. PC) se vean
    en otros (ej. móvil) sin tener que recargar la página."""
    row = get_or_create_global_state()
    data = load_global_state()
    since = request.args.get("since", "")
    if since and since == (row.updated_at or ""):
        return ("", 304)
    resp = jsonify({
        "ok": True,
        "state": data,
        "updated_at": row.updated_at or "",
    })
    # CRÍTICO: estado MUTABLE compartido — nunca debe cachearse en el
    # navegador ni en un proxy/CDN intermedio. Sin esto, tras pulsar
    # «Reiniciar Liga» la recarga volvía a recibir un /api/state
    # cacheado con el `liga_schedule` anterior y el usuario seguía
    # viendo los mismos enfrentamientos en cada jornada.
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route("/api/state", methods=["POST"])
def api_save_state():
    payload = request.get_json(silent=True) or {}
    incoming_state = payload.get("state", payload)

    if not isinstance(incoming_state, dict):
        return jsonify({"ok": False, "error": "Estado no válido"}), 400

    saved = save_global_state(incoming_state)
    row = get_or_create_global_state()
    return jsonify({
        "ok": True,
        "state": saved,
        "updated_at": row.updated_at or "",
    })


@app.context_processor
def inject_shield_data():
    return {
        "escudos_resueltos": build_escudos_resueltos(),
        "escudos_aliases": ALIASES_ESCUDOS_RAW,
        "escudo_default": ESCUDO_DEFAULT,
    }


# ══════════════════════════════════════════════════════════════════
# ADMIN SESSION (PIN 747)
# ══════════════════════════════════════════════════════════════════
# Antes la comprobación del PIN 747 era puramente cliente-side
# (`window._adm` en JS). Ahora la duplicamos en servidor vía
# `session['admin']` para poder proteger endpoints de escritura
# (editar/añadir/borrar eventos del calendario). El cliente sigue
# controlando qué UI se muestra; el servidor controla qué
# peticiones acepta.
ADMIN_PIN = "747"

def _is_admin():
    """Devuelve True si la sesión Flask actual tiene el flag admin."""
    return bool(session.get("admin"))

def admin_required(fn):
    """Decorador: responde 403 si la sesión no es admin.
    Se usa en POST/DELETE del calendario; los GET son públicos."""
    @wraps(fn)
    def _wrap(*args, **kwargs):
        if not _is_admin():
            return jsonify({"ok": False, "error": "admin requerido"}), 403
        return fn(*args, **kwargs)
    return _wrap

@app.context_processor
def inject_admin_flag():
    """Expone `is_admin` en todas las plantillas para que el ✏️ del
    calendario (y cualquier otro control admin) se pinte solo cuando
    haya sesión activa."""
    return {"is_admin": _is_admin()}

@app.route("/api/admin/status", methods=["GET"])
def api_admin_status():
    """El cliente puede preguntar si está logueado como admin sin
    revelar el PIN."""
    return jsonify({"admin": _is_admin()})

@app.route("/api/admin/login", methods=["POST"])
def api_admin_login():
    """Valida el PIN 747. Si coincide, setea `session['admin']=True`
    y la cookie de sesión Flask firmada protege todas las peticiones
    siguientes. No hay rate-limiting (uso personal entre amigos)."""
    body = request.get_json(silent=True) or {}
    pin = str(body.get("pin") or "").strip()
    if pin != ADMIN_PIN:
        return jsonify({"ok": False, "error": "pin incorrecto"}), 401
    session["admin"] = True
    return jsonify({"ok": True, "admin": True})

@app.route("/api/admin/logout", methods=["POST"])
def api_admin_logout():
    """Limpia el flag admin de la sesión. No destruye la sesión
    entera para no romper otras posibles claves."""
    session.pop("admin", None)
    return jsonify({"ok": True, "admin": False})


# ══════════════════════════════════════════════════════════════════
# CALENDARIO EDITABLE (calendario.json en raíz del proyecto)
# ══════════════════════════════════════════════════════════════════
# El admin puede añadir, editar y borrar eventos desde la pantalla
# AGENDA 32-33 vía fetch a /api/calendario/*. La fuente de verdad es
# `calendario.json` en la raíz del proyecto; los cambios lo
# sobreescriben atómicamente (write tmp + rename) para evitar estados
# corruptos si el contenedor muere a mitad de escritura.
CALENDARIO_PATH = os.path.join(basedir, "calendario.json")
CALENDARIO_DEFAULT = {"version": 1, "season": "32-33", "sections": []}
# Iconos válidos para eventos (debe coincidir con el <select> del UI
# de edición). No impedimos otros iconos pero sí vetamos strings
# absurdamente largas.
CALENDARIO_VALID_ICONS = {"⚽", "🏆", "🇪🇺", "🌍", "🤝", "🔵", "🟤", "🔴", "🟡", "🌐", "🌞", "🏃", "💤", "⚫️", "🏁"}
CALENDARIO_VALID_WEATHERS = {"☀️", "🌧", "❄️"}

# Abreviaturas de mes en español → índice 0..11 (Ene=0). Usado para
# ordenar eventos por fecha ("15 Jul", "03 Ago", …) dentro de una
# sección. El orden real es "relativo al primer evento" — ver
# `_sort_section_events` — para soportar secciones que cruzan años
# (Sep→Feb, Jun→Jul).
_SPANISH_MONTH_NUM = {
    "ene": 0, "feb": 1, "mar": 2, "abr": 3, "may": 4, "jun": 5,
    "jul": 6, "ago": 7, "sep": 8, "oct": 9, "nov": 10, "dic": 11,
}

def _parse_event_date(date_str):
    """'15 Jul' → (6, 15). Devuelve None si no parseable."""
    parts = str(date_str or "").strip().split()
    if len(parts) < 2:
        return None
    try:
        day = int(parts[0])
    except ValueError:
        return None
    key = parts[1].strip().lower().rstrip(".")[:3]
    m = _SPANISH_MONTH_NUM.get(key)
    if m is None:
        return None
    return (m, day)

def _sort_section_events(section):
    """Ordena in-place los eventos de una sección cronológicamente.
    El ancla es el mes del primer evento existente para que secciones
    como INVIERNO (Sep→Feb) o FASE FINAL (Jun→Jul) mantengan su tramo
    lógico de temporada sin que enero/julio salten al principio."""
    evs = section.get("events")
    if not isinstance(evs, list) or len(evs) < 2:
        return
    anchor = None
    for ev in evs:
        parsed = _parse_event_date(ev.get("date"))
        if parsed is not None:
            anchor = parsed[0]
            break
    if anchor is None:
        return
    def key(ev):
        parsed = _parse_event_date(ev.get("date"))
        if parsed is None:
            return (99, 99)
        m, d = parsed
        return ((m - anchor) % 12, d)
    evs.sort(key=key)

CALENDARIO_GLOBAL_KEY = "calendario_global_v1"


def _build_june_pretemp_section():
    """Bloque de PRETEMPORADA de JUNIO al inicio de la temporada.
    Mismo patrón EXACTO que la parte de Julio (3 entrenamientos, 1
    Torneo, 1 descanso, repetido), 01–30 Jun. Días 8 y 24 con lluvia,
    el resto soleado. Petición usuario 2026-05-19."""
    events = []
    for day in range(1, 31):
        date = "%02d Jun" % day
        # 01-03: 3 entrenamientos. Desde el día 4 el ciclo es de 4
        # días: Torneo (día%4==0) · Descanso (día%4==1) · Entreno ·
        # Entreno. Idéntico al bloque de Julio.
        if day <= 3:
            icon, name = "🏃", "Entrenamiento"
        elif day % 4 == 0:
            icon, name = "🌞", ("Torneo Verano - 1 Partido"
                                if day == 4 else
                                "Torneo Verano - Partido %d" % (day // 4))
        elif day % 4 == 1:
            icon, name = "💤", "Descanso"
        else:
            icon, name = "🏃", "Entrenamiento"
        weather = "🌧" if day in (8, 24) else "☀️"
        events.append({
            "id": "jun-%03d" % day,
            "date": date, "icon": icon, "name": name, "weather": weather,
        })
    return {
        "id": "verano-jun", "name": "VERANO · PARTE 1",
        "icon": "☀️", "variant": "verano", "events": events,
    }


def _ensure_june_pretemp(data):
    """Inserta (una sola vez, idempotente) el bloque de Junio al inicio
    del calendario. Si ya existe una sección con id 'verano-jun' no
    hace nada (respeta ediciones del admin sobre ese bloque)."""
    if not isinstance(data, dict):
        return data
    secs = data.get("sections")
    if not isinstance(secs, list):
        return data
    if any(isinstance(s, dict) and s.get("id") == "verano-jun" for s in secs):
        return data
    secs.insert(0, _build_june_pretemp_section())
    return data


# Mundialito de Clubes — 7 eventos (fechas corregidas por el usuario
# 2026-05-19): J1 04 Jul, J2 08, J3 12, Octavos 16, Cuartos 20,
# Semis 24, FINAL 28. icono 🌐. El editor no dejaba ponerlos → se
# inyectan en el calendario global (y de ahí a las cajas de equipo).
# Son SERVER-MANAGED (id 'mun-*'): se reescriben siempre a estos
# valores para poder corregir fechas en sucesivos despliegues.
_MUNDIALITO_EVENTS = [
    ("mun-001", "04 Jul", "Mundialito- J1"),
    ("mun-002", "08 Jul", "Mundialito- J2"),
    ("mun-003", "12 Jul", "Mundialito- J3"),
    ("mun-004", "16 Jul", "Mundialito- Octavos"),
    ("mun-005", "20 Jul", "Mundialito- Cuartos"),
    ("mun-006", "24 Jul", "Mundialito- Semis"),
    ("mun-007", "28 Jul", "Mundialito- FINAL"),
]


def _mun_sig(data):
    """Firma de los eventos Mundialito server-managed (id 'mun-*')
    presentes: lista ordenada de (id, date, name)."""
    out = []
    if isinstance(data, dict):
        for s in (data.get("sections") or []):
            if not isinstance(s, dict):
                continue
            for ev in (s.get("events") or []):
                if isinstance(ev, dict) and str(ev.get("id", "")).startswith("mun-"):
                    out.append((ev.get("id"), ev.get("date"), ev.get("name")))
    return sorted(out)


def _ensure_mundialito(data):
    """Reescribe (idempotente y autoritativo) los 7 eventos del
    Mundialito de Clubes con sus fechas correctas. Elimina cualquier
    evento server-managed previo (id 'mun-*') y reinserta el set
    canónico en la sección que contiene Julio."""
    if not isinstance(data, dict):
        return data
    secs = data.get("sections")
    if not isinstance(secs, list) or not secs:
        return data
    # 1. Purga los mun-* antiguos (corrige fechas mal puestas antes).
    for s in secs:
        if isinstance(s, dict) and isinstance(s.get("events"), list):
            s["events"] = [
                ev for ev in s["events"]
                if not (isinstance(ev, dict) and str(ev.get("id", "")).startswith("mun-"))
            ]
    # 2. Sección destino: la que tenga eventos de Julio (mes 6); si
    #    no, la primera con eventos; si no, la primera.
    target = None
    for s in secs:
        if not isinstance(s, dict):
            continue
        for ev in (s.get("events") or []):
            p = _parse_event_date((ev or {}).get("date"))
            if p is not None and p[0] == 6:  # Julio
                target = s
                break
        if target is not None:
            break
    if target is None:
        target = next((s for s in secs if isinstance(s, dict) and s.get("events")), None)
    if target is None:
        target = secs[0] if isinstance(secs[0], dict) else None
    if target is None:
        return data
    target.setdefault("events", [])
    for ev_id, date, name in _MUNDIALITO_EVENTS:
        target["events"].append({
            "id": ev_id, "date": date, "icon": "🌐",
            "name": name, "weather": "☀️",
        })
    _sort_section_events(target)
    return data


def _purge_pre_june(data):
    """La temporada arranca el 1 de Junio (regla del usuario, repetida
    en varias iteraciones). Elimina del calendario CUALQUIER evento
    cuya fecha parseable caiga antes de Junio (Ene–May). Idempotente."""
    if not isinstance(data, dict):
        return data
    secs = data.get("sections")
    if not isinstance(secs, list):
        return data
    for s in secs:
        if not isinstance(s, dict):
            continue
        evs = s.get("events")
        if not isinstance(evs, list):
            continue
        kept = []
        for ev in evs:
            if not isinstance(ev, dict):
                continue
            p = _parse_event_date(ev.get("date"))
            # Si no parsea, lo mantenemos (no podemos saber el mes).
            if p is None or p[0] >= 5:
                kept.append(ev)
        s["events"] = kept
    return data


# PRE-VERANO en MAYO (01–31). Mundial de Selecciones: 8 partidos
# (J1/J2/J3/Dieciseisavos/Octavos/Cuartos/Semis/Final) + 23 descansos.
# Petición usuario 2026-05-20. 2026-05-24: renombrado "Repesca J3"
# → "Dieciseisavos" (la ronda es Dieciseisavos = 1/32 = 32 selecciones
# según _mundialFormatConfig en misc_body_1.html).
_PREVERANO_MAY_MATCHES = [
    (3,  "Mundial Grupo — J1",          "☀️"),
    (7,  "Mundial Grupo — J2",          "🌧"),
    (11, "Mundial Grupo — J3",          "☀️"),
    (15, "Mundial Dieciseisavos",       "☀️"),
    (19, "Mundial Octavos",             "☀️"),
    (23, "Mundial Cuartos",             "☀️"),
    (27, "Mundial Semis",               "☀️"),
    (31, "MUNDIAL GRAN FINAL 🏆",        "☀️"),
]
def _build_preverano_may_events():
    matches = {d: (n, w) for d, n, w in _PREVERANO_MAY_MATCHES}
    out = []
    for day in range(1, 32):
        date = "%02d May" % day
        if day in matches:
            n, w = matches[day]
            out.append({"id": "pvm-%02d" % day, "date": date,
                        "icon": "🌍", "name": n, "weather": w})
        else:
            out.append({"id": "pvm-%02d" % day, "date": date,
                        "icon": "💤", "name": "Descanso", "weather": "☀️"})
    return out


def _ensure_preverano_may(data):
    """Garantiza la sección 'preverano' con los 31 días de Mayo
    (Mundial de Selecciones + descansos) colocada antes del bloque
    de Junio. Idempotente. Además depura eventos de Mayo (mes 4)
    en CUALQUIER otra sección para evitar duplicación."""
    if not isinstance(data, dict):
        return data
    secs = data.get("sections")
    if not isinstance(secs, list):
        return data
    # 1) Depura cualquier evento "* May" en secciones que NO sean preverano.
    for s in secs:
        if not isinstance(s, dict):
            continue
        if s.get("id") == "preverano":
            continue
        evs = s.get("events")
        if not isinstance(evs, list):
            continue
        kept = []
        for ev in evs:
            if not isinstance(ev, dict):
                continue
            p = _parse_event_date(ev.get("date"))
            if p is None or p[0] != 4:
                kept.append(ev)
        s["events"] = kept
    # 2) Localiza / crea la sección preverano.
    target = None; idx = -1
    for i, s in enumerate(secs):
        if isinstance(s, dict) and s.get("id") == "preverano":
            target = s; idx = i; break
    if target is None:
        target = {"id": "preverano",
                  "name": "PRE-VERANO",
                  "icon": "🌍", "variant": "preverano", "events": []}
        secs.insert(0, target); idx = 0
    canon = _build_preverano_may_events()
    cur = target.get("events") or []
    same = (len(cur) == len(canon) and all(
        isinstance(a, dict) and a.get("date") == b["date"]
        and a.get("name") == b["name"] and a.get("weather") == b["weather"]
        for a, b in zip(cur, canon)))
    if not same:
        target["events"] = canon
        target["name"] = "PRE-VERANO"
        target["icon"] = "🌍"
        target.setdefault("variant", "preverano")
    if idx != 0:
        secs.pop(idx)
        secs.insert(0, target)
    return data


# Fase Final SELECCIONES en MAYO (01–31). 9 partidos + 22 descansos
# (sin entrenamientos). Petición usuario 2026-05-20: como Mayo no se
# elimina del calendario, lo rellenamos con las fases finales de
# selecciones. Días de partido cada 2 (01,03,05,…,17 May).
_FASE_FINAL_MAY_MATCHES = [
    (1,  "Grupo — J1",                 "🌧"),
    (3,  "Grupo — J2",                 "☀️"),
    (5,  "Grupo — J3",                 "☀️"),
    (7,  "Grupo — J4",                 "☀️"),
    (9,  "Repesca",                    "🌧"),
    (11, "Octavos",                    "☀️"),
    (13, "Cuartos",                    "☀️"),
    (15, "Semifinal",                  "☀️"),
    (17, "GRAN FINAL SELECCIONES 🏆",   "☀️"),
]
def _build_fase_final_may_events():
    matches = {d: (n, w) for d, n, w in _FASE_FINAL_MAY_MATCHES}
    out = []
    for day in range(1, 32):
        date = "%02d May" % day
        if day in matches:
            n, w = matches[day]
            out.append({"id": "ffm-%02d" % day, "date": date,
                        "icon": "🌍", "name": n, "weather": w})
        else:
            out.append({"id": "ffm-%02d" % day, "date": date,
                        "icon": "💤", "name": "Descanso", "weather": "☀️"})
    return out


def _ensure_fase_final_may(data):
    """Garantiza que la sección 'fase-final-sel' contiene EXACTAMENTE
    los 31 eventos de Mayo (matches + descansos, sin entrenamientos)
    y la coloca antes del bloque de Junio para que renderice primero
    en el calendario. Idempotente."""
    if not isinstance(data, dict):
        return data
    secs = data.get("sections")
    if not isinstance(secs, list):
        return data
    target = None; idx = -1
    for i, s in enumerate(secs):
        if isinstance(s, dict) and s.get("id") == "fase-final-sel":
            target = s; idx = i; break
    if target is None:
        target = {"id": "fase-final-sel",
                  "name": "FASE FINAL SELECCIONES",
                  "icon": "🌍", "variant": "selecciones", "events": []}
        secs.insert(0, target); idx = 0
    # Garantiza el set canónico de Mayo (idempotente por firma).
    cur = target.get("events") or []
    canon = _build_fase_final_may_events()
    same = (len(cur) == len(canon) and all(
        isinstance(a, dict) and a.get("date") == b["date"]
        and a.get("name") == b["name"] for a, b in zip(cur, canon)))
    if not same:
        target["events"] = canon
        target["name"] = "FASE FINAL SELECCIONES"
        target["icon"] = "🌍"
        target.setdefault("variant", "selecciones")
    # Mueve la sección al inicio (antes de Junio) para orden cronológico.
    if idx != 0:
        secs.pop(idx)
        secs.insert(0, target)
    return data


def _calendario_normalize(data):
    """Asegura el esqueleto mínimo y los defaults de un dict de calendario.

    Las inyecciones `_ensure_*` (Junio, Preverano, Mundialito) crean
    secciones SEMILLA pero NO machacan ediciones del usuario: solo
    corren cuando `_normalized_v < version`. Una vez normalizado para
    la versión actual, las cargas siguientes pasan por aquí sin tocar
    las secciones — los renombrados, añadidos o borrados del editor
    persisten para siempre."""
    if not isinstance(data, dict):
        return json.loads(json.dumps(CALENDARIO_DEFAULT))
    data.setdefault("version", 1)
    data.setdefault("season", "32-33")
    if not isinstance(data.get("sections"), list):
        data["sections"] = []
    cur_ver = data.get("version") or 1
    norm_ver = data.get("_normalized_v") or 0
    if norm_ver < cur_ver:
        _ensure_june_pretemp(data)
        _ensure_preverano_may(data)
        _ensure_mundialito(data)
        data["_normalized_v"] = cur_ver
    return data


def _calendario_load_from_file():
    """Carga el calendario semilla del fichero git-baked (`calendario.json`).
    Esta es la fuente de verdad SOLO la primera vez (cuando GlobalState aún no
    tiene la clave). Después de cualquier edición el calendario se persiste en
    GlobalState y este fichero queda como semilla inmutable."""
    try:
        with open(CALENDARIO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return json.loads(json.dumps(CALENDARIO_DEFAULT))
    return _calendario_normalize(data)


def load_calendario():
    """Carga el calendario priorizando la BD (GlobalState) sobre el fichero.

    En Render el fichero está en un volumen persistente, en Railway no — el
    disco es efímero y `calendario.json` se reescribe a su versión git-baked
    en cada deploy. Para que los add/edit/delete del admin sobrevivan a un
    reinicio del contenedor en Railway (DATABASE_URL → Postgres), guardamos
    el calendario en `GlobalState` igual que `liga_ext_*` y la liga global.

    La primera vez que se llama y la fila de GlobalState aún no existe, se
    siembra desde `calendario.json` (la versión inicial empaquetada con el
    repo). A partir de ahí, todas las mutaciones van a la BD y el fichero
    queda como semilla — nunca se sobreescribe."""
    try:
        row = GlobalState.query.filter_by(clave=CALENDARIO_GLOBAL_KEY).first()
    except Exception:
        # Si la BD aún no está lista (boot temprano), caemos al fichero.
        return _calendario_load_from_file()
    if row and row.valor_json:
        try:
            data = json.loads(row.valor_json)
        except (TypeError, ValueError):
            data = None
        if isinstance(data, dict):
            # Migración por schema-version: si el fichero git-baked declara
            # una versión > que la persistida en BD, la BD está vieja y la
            # reemplazamos por la semilla. Permite restaurar eventos
            # borrados (Ene–May en v2) sin requerir reset manual.
            db_ver = data.get("version") or 0
            seed = _calendario_load_from_file()
            seed_ver = seed.get("version") or 0
            if seed_ver > db_ver:
                try:
                    _calendario_save_to_db(seed)
                except Exception:
                    pass
                return seed
            _secs0 = data.get("sections") or []
            had_june = any(
                isinstance(s, dict) and s.get("id") == "verano-jun"
                for s in _secs0
            )
            _mun_before = _mun_sig(data)
            _evs_before = sum(
                len((s.get("events") or [])) for s in _secs0 if isinstance(s, dict)
            )
            data = _calendario_normalize(data)
            _evs_after = sum(
                len((s.get("events") or []))
                for s in (data.get("sections") or []) if isinstance(s, dict)
            )
            if (not had_june
                    or _mun_before != _mun_sig(data)
                    or _evs_before != _evs_after):
                try:
                    _calendario_save_to_db(data)
                except Exception:
                    pass
            return data
    # No hay fila aún → sembramos desde el fichero y persistimos.
    seed = _calendario_load_from_file()
    try:
        _calendario_save_to_db(seed)
    except Exception:
        pass
    return seed


def _calendario_save_to_db(data):
    """Persiste el calendario en GlobalState. Usa el mismo patrón que
    `_liga_ext_save`: upsert por clave, commit transaccional.

    Marca `_normalized_v = version` en cada write para que las cargas
    posteriores NO re-inyecten secciones semilla por encima de las
    ediciones del usuario (renombres / borrados / añadidos persistentes)."""
    if isinstance(data, dict):
        ver = data.get("version") or 1
        if (data.get("_normalized_v") or 0) < ver:
            data["_normalized_v"] = ver
    payload = json.dumps(data or {}, ensure_ascii=False)
    now = utc_now_iso()
    row = GlobalState.query.filter_by(clave=CALENDARIO_GLOBAL_KEY).first()
    if row:
        row.valor_json = payload
        row.updated_at = now
    else:
        row = GlobalState(clave=CALENDARIO_GLOBAL_KEY, valor_json=payload, updated_at=now)
        db.session.add(row)
    db.session.commit()


def save_calendario(data):
    """Escribe el calendario en BD (fuente de verdad) y, en paralelo,
    intenta volcarlo al fichero local. La escritura al fichero es
    best-effort: en Railway el disco es efímero pero seguir escribiéndolo
    facilita el desarrollo local (volcado JSON legible) y no rompe Render
    (donde sí persiste). El error de fichero NUNCA hace fallar la
    operación — la BD es lo único obligatorio."""
    _calendario_save_to_db(data)
    try:
        payload = json.dumps(data, ensure_ascii=False, indent=2)
        tmp = CALENDARIO_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(payload)
            try:
                f.flush()
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(tmp, CALENDARIO_PATH)
    except OSError:
        pass

def _find_section(data, section_id):
    for s in data.get("sections") or []:
        if s.get("id") == section_id:
            return s
    return None

def _find_event(data, event_id):
    """Devuelve `(section, event, index)` o `(None, None, -1)`."""
    for s in data.get("sections") or []:
        evs = s.get("events") or []
        for i, ev in enumerate(evs):
            if ev.get("id") == event_id:
                return s, ev, i
    return None, None, -1

def _next_event_id(data):
    """Genera un id `ev-XXX` único incrementando el máximo existente."""
    max_n = 0
    for s in data.get("sections") or []:
        for ev in s.get("events") or []:
            eid = str(ev.get("id") or "")
            if eid.startswith("ev-"):
                try:
                    n = int(eid.split("-", 1)[1])
                    if n > max_n:
                        max_n = n
                except ValueError:
                    pass
    return "ev-" + str(max_n + 1).zfill(3)

def _normalize_event_fields(body):
    """Sanea y valida los campos del body de una petición add/edit.
    Devuelve `(fields_dict, error_msg)`."""
    date = str(body.get("date") or "").strip()
    name = str(body.get("name") or "").strip()
    icon = str(body.get("icon") or "").strip()
    weather = str(body.get("weather") or "").strip()
    if not date:
        return None, "falta fecha"
    if not name:
        return None, "falta nombre"
    if not icon:
        return None, "falta icono"
    if not weather:
        return None, "falta clima"
    # Cap de longitud anti-abuso.
    if len(date) > 20 or len(name) > 120 or len(icon) > 16 or len(weather) > 16:
        return None, "campos demasiado largos"
    return {"date": date, "name": name, "icon": icon, "weather": weather}, None

@app.route("/api/calendario", methods=["GET"])
def api_calendario_get():
    """Público: devuelve el calendario entero. El GET se usa tanto
    desde la UI pública como desde el modo edición admin para
    refrescar tras un cambio."""
    return jsonify({"ok": True, "calendario": load_calendario()})

@app.route("/api/calendario/add", methods=["POST"])
@admin_required
def api_calendario_add():
    """Añade un evento a una sección. Body:
    `{section_id, date, icon, name, weather}`. Devuelve el evento
    creado con el id asignado."""
    body = request.get_json(silent=True) or {}
    section_id = str(body.get("section_id") or "").strip()
    if not section_id:
        return jsonify({"ok": False, "error": "falta section_id"}), 400
    fields, err = _normalize_event_fields(body)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    data = load_calendario()
    sec = _find_section(data, section_id)
    if sec is None:
        return jsonify({"ok": False, "error": "sección no encontrada"}), 404
    new_evt = {"id": _next_event_id(data)}
    new_evt.update(fields)
    sec.setdefault("events", []).append(new_evt)
    _sort_section_events(sec)
    save_calendario(data)
    return jsonify({"ok": True, "event": new_evt, "section_id": section_id})

@app.route("/api/calendario/edit", methods=["POST"])
@admin_required
def api_calendario_edit():
    """Edita un evento existente in-place. Body:
    `{event_id, date, icon, name, weather}`."""
    body = request.get_json(silent=True) or {}
    event_id = str(body.get("event_id") or "").strip()
    if not event_id:
        return jsonify({"ok": False, "error": "falta event_id"}), 400
    fields, err = _normalize_event_fields(body)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    data = load_calendario()
    sec, ev, _idx = _find_event(data, event_id)
    if ev is None:
        return jsonify({"ok": False, "error": "evento no encontrado"}), 404
    ev.update(fields)
    _sort_section_events(sec)
    save_calendario(data)
    return jsonify({"ok": True, "event": ev, "section_id": sec.get("id")})

@app.route("/api/calendario/delete", methods=["POST"])
@admin_required
def api_calendario_delete():
    """Elimina un evento por id. Body: `{event_id}`.
    Se hace POST (no DELETE) por sencillez del cliente (fetch sin
    necesidad de métodos extra ni preflight CORS)."""
    body = request.get_json(silent=True) or {}
    event_id = str(body.get("event_id") or "").strip()
    if not event_id:
        return jsonify({"ok": False, "error": "falta event_id"}), 400
    data = load_calendario()
    sec, ev, idx = _find_event(data, event_id)
    if ev is None:
        return jsonify({"ok": False, "error": "evento no encontrado"}), 404
    sec["events"].pop(idx)
    save_calendario(data)
    return jsonify({"ok": True, "event_id": event_id, "section_id": sec.get("id")})


@app.context_processor
def inject_calendario():
    """Expone el calendario en las plantillas para el render SSR de
    la pantalla AGENDA 32-33 (mismo HTML que antes estaba hardcoded,
    ahora se genera con un loop Jinja a partir del JSON)."""
    return {
        "calendario_data": load_calendario(),
        "CALENDARIO_VALID_ICONS": sorted(CALENDARIO_VALID_ICONS),
        "CALENDARIO_VALID_WEATHERS": sorted(CALENDARIO_VALID_WEATHERS),
    }


# Mapas icon→clase y clima→clase usados en el render de la agenda y
# también desde el cliente para recomputar la fila tras un add/edit.
_AGENDA_ICON_CLASS_MAP = {
    "⚽": "ag-liga",
    "🏆": "ag-copa",
    "🇪🇺": "ag-eur",
    "🔵": "ag-eur",
    "🌍": "ag-sel",
    "🤝": "ag-amist",
    "🟤": "ag-recopa",
    "🔴": "ag-recopa",
    "🟡": "ag-inter",
    "🌐": "ag-inter",
    "🌞": "ag-torneo",
    "🏃": "ag-train",
    "💤": "ag-rest",
}
_AGENDA_WEATHER_CLASS_MAP = {
    "🌧": "ag-rain",
    "❄️": "ag-snow",
}

@app.template_filter("agenda_row_class")
def agenda_row_class(event):
    """Devuelve las clases CSS para un evento del calendario, p.ej.
    `ag-r ag-liga ag-rain`. Usado por Jinja al pintar cada fila y
    también por el filtro `tojson` en el bootstrap JS para que el
    cliente pueda reconstruir la misma clase al editar sin recargar."""
    if not isinstance(event, dict):
        return "ag-r"
    parts = ["ag-r"]
    icon = (event.get("icon") or "").strip()
    if icon in _AGENDA_ICON_CLASS_MAP:
        parts.append(_AGENDA_ICON_CLASS_MAP[icon])
    wx = (event.get("weather") or "").strip()
    if wx in _AGENDA_WEATHER_CLASS_MAP:
        parts.append(_AGENDA_WEATHER_CLASS_MAP[wx])
    return " ".join(parts)

# --- RUTAS ---
# ── LIVE STATE API (compartido entre dispositivos) ──────────────
@app.route("/api/live/state", methods=["GET"])
def api_live_state_get():
    """Devuelve el estado live compartido (parcial si el cliente manda
    `if_updated_after` y el servidor no tiene nada nuevo, devolvemos 304)."""
    data = load_live_state()
    since = request.args.get("since", "")
    if since and since == data["updated_at"]:
        # El cliente ya tiene la última versión, ahorramos ancho de banda.
        return ("", 304)
    return jsonify(data)

@app.route("/api/live/state", methods=["POST"])
def api_live_state_post():
    """Guarda el estado live compartido. Body JSON: {state: {...}}.
    Devuelve {state, updated_at}. No hay auth ni conflict detection:
    last-write-wins, suficiente para uso casual entre amigos."""
    body = request.get_json(silent=True) or {}
    incoming = body.get("state")
    if incoming is None:
        incoming = body  # aceptar también el body plano
    if not isinstance(incoming, dict):
        incoming = {}
    result = save_live_state(incoming)
    return jsonify(result)

# ── Ligas externas (Resto de Ligas — 51 países) ────────────────────
# Persistencia compartida entre dispositivos. Una fila de GlobalState
# por cada liga, con clave "liga_ext_<slug>". Cada liga guarda su
# propio {teams, results}.

import re as _re_liga_ext

def _liga_ext_slug(raw):
    s = unicodedata.normalize("NFD", str(raw or "")).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = _re_liga_ext.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "liga"

def _liga_ext_key(slug):
    return "liga_ext_" + _liga_ext_slug(slug)

def _liga_ext_load(slug):
    key = _liga_ext_key(slug)
    row = GlobalState.query.filter_by(clave=key).first()
    if not row:
        return {"teams": [], "results": []}
    try:
        data = json.loads(row.valor_json or "{}")
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("teams", [])
    data.setdefault("results", [])
    return data

def _lx_norm_name(raw):
    """Normaliza un nombre de equipo para key/deletedTeamNames: sin
    acentos, minúsculas, solo alfanumérico+espacio, espacios colapsados."""
    s = unicodedata.normalize("NFD", str(raw or "")).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = _re_liga_ext.sub(r"[^a-z0-9]+", " ", s).strip()
    s = _re_liga_ext.sub(r"\s+", " ", s)
    return s


def _lx_team_key(t):
    """Clave estable de un equipo: id si existe, si no nombre normalizado."""
    if not isinstance(t, dict):
        return None
    tid = t.get("id")
    if isinstance(tid, str) and tid.strip():
        return "id:" + tid.strip()
    nm = _lx_norm_name(t.get("name"))
    return ("nm:" + nm) if nm else None


def _lx_updated_at(t):
    """`updatedAt` del equipo (ms epoch) o None si no está sellado."""
    if not isinstance(t, dict):
        return None
    v = t.get("updatedAt")
    try:
        return int(v) if v is not None and str(v) != "" else None
    except Exception:
        return None


def _lx_merge_teams(old_data, new_data):
    """Fusión POR EQUIPO (regla del usuario 2026-05-18: "última edición
    de cada equipo gana, venga del dispositivo que venga").

    Modelo: la liga es UN documento con los N equipos juntos. Con
    "admin + ayudantes" en varios móviles/PC, un POST de documento
    entero pisaba lo que otro acababa de editar (el anti-wipe del
    dispositivo del admin re-subía su copia completa). Aquí, en el
    ÚNICO chokepoint por el que pasan todos los dispositivos (el save
    del servidor), fusionamos `teams[]` por equipo quedándonos con la
    versión de mayor `updatedAt`:
      · ambos con updatedAt  → gana el más reciente
      · solo el entrante     → gana el entrante (edición explícita en
                               cliente nuevo)
      · solo el almacenado   → gana el almacenado (un cliente viejo /
                               sin sellar NO debe pisar una edición
                               sellada de otro)
      · ninguno con updatedAt → gana el entrante (comportamiento
                               actual; no regresiona single-user)
    Los equipos que un dispositivo NO mandó se CONSERVAN (no encoge el
    documento). Las bajas se propagan vía `deletedTeamNames` (unión) y
    se eliminan del resultado para que la fusión no resucite equipos
    borrados. Solo afecta a `teams`/`deletedTeamNames`; el resto de
    claves (results, config…) se mantiene como en el entrante."""
    if not isinstance(new_data, dict):
        return new_data
    new_teams = new_data.get("teams")
    if not isinstance(new_teams, list):
        return new_data
    old_teams = old_data.get("teams") if isinstance(old_data, dict) else []
    if not isinstance(old_teams, list):
        old_teams = []

    merged = {}      # key -> team dict
    order = []        # keys en orden (entrantes primero, luego solo-viejos)

    def _consider(team, is_incoming):
        key = _lx_team_key(team)
        if not key:
            # Sin id ni nombre: lo dejamos pasar tal cual (no se puede
            # fusionar de forma fiable) usando una clave única.
            key = "anon:%d" % len(order)
        if key not in merged:
            merged[key] = team
            order.append(key)
            return
        cur = merged[key]
        cu = _lx_updated_at(cur)
        nu = _lx_updated_at(team)
        if cu is not None and nu is not None:
            if nu >= cu:
                merged[key] = team
        elif nu is not None and cu is None:
            merged[key] = team
        elif nu is None and cu is None:
            # Ninguno sellado: gana el entrante (comportamiento previo).
            if is_incoming:
                merged[key] = team
        # (cu set, nu None) → conservamos el almacenado/sellado.

    # Primero los viejos (base), luego los entrantes (pueden ganar).
    for t in old_teams:
        if isinstance(t, dict):
            _consider(t, False)
    for t in new_teams:
        if isinstance(t, dict):
            _consider(t, True)

    # Unión de deletedTeamNames y poda de equipos borrados.
    #
    # Regla "add trumps delete" (2026-05-20, petición usuario "fuerza
    # que un equipo creado se hidrate y se quede para siempre excepto
    # cuando lo elimine manualmente"): si un equipo aparece en el
    # `teams` ENTRANTE, ese add explícito gana sobre cualquier registro
    # de borrado previo. El cliente ya limpia `deletedTeamNames` al
    # guardar un equipo (lextSaveTeam → `data.deletedTeamNames =
    # ...filter(...)`), pero el servidor unía ambas listas y volvía a
    # podar el equipo, haciéndolo desaparecer en cada sync — bug visto
    # con Coventry City e Ipswich Town en la liga inglesa.
    incoming_names = set()
    if isinstance(new_teams, list):
        for t in new_teams:
            if isinstance(t, dict):
                nm = _lx_norm_name(t.get("name"))
                if nm:
                    incoming_names.add(nm)
    del_set = set()
    for src in (old_data if isinstance(old_data, dict) else {},
                new_data):
        dn = src.get("deletedTeamNames") if isinstance(src, dict) else None
        if isinstance(dn, list):
            for nm in dn:
                n = _lx_norm_name(nm)
                if n and n not in incoming_names:
                    del_set.add(n)

    out_teams = []
    for key in order:
        t = merged[key]
        if _lx_norm_name(t.get("name")) in del_set:
            continue
        out_teams.append(t)

    result = dict(new_data)
    result["teams"] = out_teams
    if del_set:
        result["deletedTeamNames"] = sorted(del_set)
    return result


def _liga_ext_save(slug, data):
    key = _liga_ext_key(slug)
    row = GlobalState.query.filter_by(clave=key).first()
    # Fusión por equipo contra lo ya almacenado para no perder las
    # ediciones de otros dispositivos (admin + ayudantes).
    try:
        old = _liga_ext_load(slug)
        data = _lx_merge_teams(old, data)
    except Exception:
        pass
    payload = json.dumps(data or {}, ensure_ascii=False)
    now = utc_now_iso()
    if row:
        row.valor_json = payload
        row.updated_at = now
    else:
        row = GlobalState(clave=key, valor_json=payload, updated_at=now)
        db.session.add(row)
    db.session.commit()
    # Propagar a la tabla en memoria que consume la simulación Python.
    try:
        _refresh_player_flags_from_liga_ext(data)
    except Exception:
        pass
    return row


def _refresh_player_flags_from_liga_ext(data):
    """Reconstruye TEAM_PLAYER_FLAGS leyendo team.players[].{captain,freeKick,
    penalty,elite,natGoal,natGoalPro} del blob de ligaExt recién guardado. Es
    la vía por la que las marcas asignadas en el editor se aplican para
    SIEMPRE al motor de simulación Python — sin esto los flags vivían solo en
    el JS y las simulaciones del servidor (calendario IA) los ignoraban."""
    if not isinstance(data, dict):
        return
    teams = data.get("teams") or []
    if not isinstance(teams, list):
        return
    for team in teams:
        if not isinstance(team, dict):
            continue
        team_name = team.get("name") or team.get("shortName") or ""
        if not team_name:
            continue
        players = team.get("players") or []
        if not isinstance(players, list):
            continue
        team_flags = {}
        for p in players:
            if not isinstance(p, dict):
                continue
            player_name = p.get("name") or p.get("nombre") or ""
            if not player_name:
                continue
            flags = {}
            for key, src in (
                ("captain",    "captain"),
                ("freeKick",   "freeKick"),
                ("penalty",    "penalty"),
                ("elite",      "elite"),
                ("natGoal",    "natGoal"),
                ("natGoalPro", "natGoalPro"),
            ):
                if bool(p.get(src)):
                    flags[key] = True
            if flags:
                team_flags[player_name] = flags
        if team_flags:
            TEAM_PLAYER_FLAGS[team_name] = team_flags
            resolved = resolve_team_name(team_name)
            if resolved and resolved != team_name:
                TEAM_PLAYER_FLAGS[resolved] = team_flags


def _load_player_flags_on_startup():
    """Carga TEAM_PLAYER_FLAGS desde GlobalState al arrancar el servidor.
    Lee todas las filas liga_ext_* y extrae los flags. Así los flags sobre-
    viven a reinicios del contenedor (Railway) sin que el cliente tenga que
    tocar nada."""
    try:
        rows = GlobalState.query.filter(GlobalState.clave.like("liga_ext_%")).all()
    except Exception:
        return
    for row in rows or []:
        try:
            data = json.loads(row.valor_json or "{}")
        except Exception:
            continue
        try:
            _refresh_player_flags_from_liga_ext(data)
        except Exception:
            continue


@app.route("/api/liga-ext", methods=["GET"])
def api_liga_ext_index():
    """Índice de TODAS las ligas externas guardadas en el servidor.
    Devuelve los slugs EXACTOS (tal cual están en GlobalState) + nombre
    y nº de equipos. Lo usa el editor de torneos para prefetchear las
    51 Resto de Ligas (+ EA/Hypermotion/1ªRFEF) sin tener que adivinar
    el slug desde la etiqueta en español. 2026-05-17."""
    out = []
    try:
        rows = GlobalState.query.filter(GlobalState.clave.like("liga_ext_%")).all()
    except Exception:
        rows = []
    for row in rows or []:
        clave = row.clave or ""
        if not clave.startswith("liga_ext_"):
            continue
        rest = clave[len("liga_ext_"):]
        # Excluir derivados (protected). Las claves canónicas son
        # exactamente `liga_ext_<slug>`.
        if not rest or rest.endswith("_protected"):
            continue
        try:
            data = json.loads(row.valor_json or "{}")
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        teams = data.get("teams")
        count = 0
        if isinstance(teams, list):
            count = sum(1 for t in teams if isinstance(t, dict) and t.get("name"))
        if count == 0:
            continue
        out.append({
            "slug": rest,
            "name": data.get("name") or rest,
            "count": count,
        })
    out.sort(key=lambda x: x["slug"])
    return jsonify({"ok": True, "leagues": out})


@app.route("/api/liga-ext/<slug>", methods=["GET"])
def api_liga_ext_get(slug):
    data = _liga_ext_load(slug)
    row = GlobalState.query.filter_by(clave=_liga_ext_key(slug)).first()
    updated_at = row.updated_at if row else ""
    since = request.args.get("since", "")
    if since and since == (updated_at or ""):
        return ("", 304)
    return jsonify({
        "ok": True,
        "slug": _liga_ext_slug(slug),
        "data": data,
        "updated_at": updated_at or "",
    })

@app.route("/api/liga-ext/<slug>", methods=["POST"])
def api_liga_ext_post(slug):
    payload = request.get_json(silent=True) or {}
    incoming = payload.get("data", payload)
    if not isinstance(incoming, dict):
        return jsonify({"ok": False, "error": "data inválida"}), 400
    incoming.setdefault("teams", [])
    incoming.setdefault("results", [])
    if not isinstance(incoming["teams"], list) or not isinstance(incoming["results"], list):
        return jsonify({"ok": False, "error": "teams/results deben ser listas"}), 400
    row = _liga_ext_save(slug, incoming)
    return jsonify({
        "ok": True,
        "slug": _liga_ext_slug(slug),
        "updated_at": row.updated_at or "",
    })

# ══════════════════════════════════════════════════════════════════
# PROTECTED snapshot (server-side, monotónico) — 2026-05-08
# ══════════════════════════════════════════════════════════════════
# Bug reportado: al actualizar plantillas de equipos humanos un día y
# recargar al siguiente, las ediciones se perdieron — el server tenía
# una versión pre-edit y la cache cliente coincidía con ella, así que
# el anti-wipe del cliente no detectó el wipe.
#
# Defensa de último recurso: además de `liga_ext_<slug>` (que el cliente
# puede sobrescribir libremente), guardamos `liga_ext_<slug>_protected`
# que SOLO acepta payloads cuyo total de `players` sea ≥ que el
# protected actual. Es decir, un POST con menos jugadores que la
# versión protegida se RECHAZA con 409, salvaguardando las ediciones
# del admin contra cualquier flujo que intente "limpiar" el server.
#
# Cliente:
#  - En cada saveData (con teams.length > 0), POSTea aquí (best-effort).
#  - En loadData / anti-wipe, si las fuentes locales fallan, hace GET
#    aquí como fallback final.

_PROTECTED_KEY_FMT = "liga_ext_{}_protected"


def _protected_key(slug):
    return _PROTECTED_KEY_FMT.format(_liga_ext_slug(slug))


def _count_players_payload(data):
    """Total de players[] sumado entre todos los teams[] del payload."""
    if not isinstance(data, dict):
        return 0
    teams = data.get("teams")
    if not isinstance(teams, list):
        return 0
    total = 0
    for t in teams:
        if not isinstance(t, dict):
            continue
        players = t.get("players")
        if isinstance(players, list):
            total += len(players)
    return total


@app.route("/api/liga-ext-protected/<slug>", methods=["GET"])
def api_liga_ext_protected_get(slug):
    key = _protected_key(slug)
    row = GlobalState.query.filter_by(clave=key).first()
    if not row or not row.valor_json:
        return jsonify({"ok": True, "slug": _liga_ext_slug(slug),
                        "data": None, "players": 0, "updated_at": ""})
    try:
        data = json.loads(row.valor_json)
    except Exception:
        data = None
    return jsonify({
        "ok": True,
        "slug": _liga_ext_slug(slug),
        "data": data,
        "players": _count_players_payload(data) if data else 0,
        "updated_at": row.updated_at or "",
    })


@app.route("/api/liga-ext-protected/<slug>", methods=["POST"])
def api_liga_ext_protected_post(slug):
    payload = request.get_json(silent=True) or {}
    incoming = payload.get("data", payload)
    force = bool(payload.get("force"))
    if not isinstance(incoming, dict):
        return jsonify({"ok": False, "error": "data inválida"}), 400
    teams = incoming.get("teams")
    if not isinstance(teams, list) or not teams:
        return jsonify({"ok": False, "error": "teams vacío — no se sobreescribe protected"}), 400
    new_pc = _count_players_payload(incoming)
    body = json.dumps(incoming, ensure_ascii=False)
    if len(body.encode("utf-8")) > 2 * 1024 * 1024:
        return jsonify({"ok": False, "error": "payload supera 2 MB"}), 413
    key = _protected_key(slug)
    row = GlobalState.query.filter_by(clave=key).first()
    if row and not force:
        try:
            cur = json.loads(row.valor_json or "{}")
            cur_pc = _count_players_payload(cur)
        except Exception:
            cur_pc = 0
        # Anti-wipe monotónico: rechazamos cualquier POST con MENOS
        # jugadores totales que el protected actual. El admin siempre
        # puede forzar con force=true (p.ej. para corregir un guardado
        # incorrecto que se quedó pegado en protected).
        if new_pc < cur_pc:
            return jsonify({
                "ok": False,
                "error": "payload con menos jugadores que protected — rechazado",
                "current_players": cur_pc,
                "new_players": new_pc,
            }), 409
    now = utc_now_iso()
    if row:
        row.valor_json = body
        row.updated_at = now
    else:
        row = GlobalState(clave=key, valor_json=body, updated_at=now)
        db.session.add(row)
    db.session.commit()
    return jsonify({
        "ok": True,
        "slug": _liga_ext_slug(slug),
        "players": new_pc,
        "updated_at": now,
    })


@app.route("/api/liga-ext-restore/<slug>", methods=["POST"])
def api_liga_ext_restore(slug):
    """Promociona el snapshot `_protected` al main `liga_ext_<slug>`.

    Reportado 2026-05-09 (corrupción cross-liga): tras un rescate
    cross-slug bugged, Hypermotion acumuló 61 equipos (de 22) y
    Primera Federación quedó con 1 (de 40). Para recuperar, este
    endpoint copia el `_protected` (que el cliente SOLO acepta
    POSTs con MÁS jugadores → preserva la versión "buena") al main
    sobreescribiendo la versión corrupta.

    Devuelve {restored, players_in_protected, current_main_players}.
    Si no hay protected → 404.
    """
    pkey = _protected_key(slug)
    prow = GlobalState.query.filter_by(clave=pkey).first()
    if not prow or not prow.valor_json:
        return jsonify({
            "ok": False,
            "error": "no hay snapshot protected para este slug",
            "slug": _liga_ext_slug(slug),
        }), 404
    try:
        pdata = json.loads(prow.valor_json)
    except Exception:
        return jsonify({"ok": False, "error": "protected corrupto"}), 500
    if not isinstance(pdata, dict) or not isinstance(pdata.get("teams"), list):
        return jsonify({"ok": False, "error": "protected sin teams"}), 500
    # Backup del main actual antes de sobreescribir (por si el admin
    # quiere undo manual).
    mkey = _liga_ext_key(slug)
    mrow = GlobalState.query.filter_by(clave=mkey).first()
    cur_pc = 0
    if mrow and mrow.valor_json:
        try:
            cur_pc = _count_players_payload(json.loads(mrow.valor_json))
        except Exception:
            cur_pc = 0
    new_pc = _count_players_payload(pdata)
    pdata.setdefault("results", [])
    _liga_ext_save(slug, pdata)
    return jsonify({
        "ok": True,
        "slug": _liga_ext_slug(slug),
        "restored": True,
        "players_in_protected": new_pc,
        "current_main_players": cur_pc,
        "teams_in_protected": len(pdata.get("teams", [])),
    })


# ══════════════════════════════════════════════════════════════════
# KV genérico (estado del cliente que debe sobrevivir al navegador)
# ══════════════════════════════════════════════════════════════════
# Reportado 2026-05-02 con foto: el usuario perdió tanto los iconos
# personalizados de Competiciones (`comp_icons_v1`) como las
# inyecciones manuales de Liga EA Sports → Europa
# (`manual_ea_<slug>_v1`). Ambos vivían SOLO en localStorage del
# navegador y se perdían si el browser limpiaba caché o si el usuario
# cambiaba de dispositivo. Con este endpoint sincronizamos esos
# blobs al servidor (GlobalState) — localStorage sigue siendo cache
# rápido de primera lectura, pero el server es la fuente de verdad
# que sobrevive entre sesiones.
#
# Whitelist (no permitimos escribir cualquier clave arbitraria):
#   - comp_icons_v1
#   - europe_committed_v1   (snapshot manual de pools europeos —
#                            usuario pulsa "📤 Enviar a Europa" cuando
#                            todas las 51 ligas están terminadas)
#   - manual_ea_<slug>_v1   con slug ∈ {ucl, uclPrev, uclQual,
#                                       wildcard, uel, uecl,
#                                       recopa, supercopa,
#                                       intercontinental, superliga,
#                                       verano}
#   - tour_<slug>_v1        config editable de cada torneo de verano
#                           con slug ∈ {sct, pss, jg, asia} —
#                           compartido entre dispositivos (2026-05-08)
#   - bayern_trofeos_v1     vitrina de trofeos del hub Bayern (la
#                           edición de cada título incluye un icono
#                           que el usuario sube y compromete persistir
#                           contra wipes de localStorage — 2026-05-08)
# Cualquier otra clave devuelve 400.
_KV_ALLOWED_EXACT = {
    "comp_icons_v1", "comp_cards_v1",
    "europe_committed_v1", "bayern_trofeos_v1",
    "ucl_phase_v1", "uel_phase_v1", "uecl_phase_v1",
    # Registro de torneos visibles (añadir/eliminar · 2026-05-16 #5).
    "tour_registry_v1",
    # Ball Storage: inventario de balones, balón-por-competición y
    # competiciones custom añadidas por el admin. localStorage es solo
    # cache rápida — el server es la fuente de verdad para que
    # sobrevivan a wipes de navegador / cambio de móvil (mismo patrón
    # que comp_icons_v1 / bayern_trofeos_v1). 2026-05-17.
    "ball_inventory_v1", "ball_by_comp_v1", "ball_comp_db_v1",
    # Editor del menú principal: cajas creadas/editadas/eliminadas
    # (overrides + added + removed). localStorage es solo cache; el
    # server es la fuente de verdad para que sobrevivan a wipes de
    # navegador / cambio de móvil (mismo patrón que comp_cards_v1).
    "menu_home_v1",
    # Plantilla de selecciones nacionales (nombre + escudo + 4 ejes).
    # Es el pool del que tiran los torneos de Selecciones. localStorage
    # es solo cache; el server es la fuente de verdad para que la
    # plantilla creada en PC aparezca en el móvil (2026-05-22).
    "selecciones_squad_v1",
    # 4 estadios sede del Mundial · 48 selecciones (fase final). El
    # admin los elige desde el editor del torneo Mundial · 48
    # selecciones; cada partido se juega en uno de los 4 (rotación por
    # hash). Sync server para que las sedes elegidas en PC aparezcan
    # en el móvil (2026-05-24).
    "sel_fin_stadiums_v1",
}
_KV_ALLOWED_REGEX = re.compile(
    r"^("
    r"manual_ea_(ucl|uclPrev|uclQual|wildcard|uel|uecl|recopa|supercopa|intercontinental|superliga|verano)"
    # tx1..tx8 = 8 huecos pre-cableados para torneos añadidos por el admin.
    # spv1..spv10 / sfn1..sfn10 = Rondas Previas / Finales de Selecciones
    # (mismo motor de torneos; sync server para que el Mundial creado en
    # PC aparezca en el móvil — 2026-05-22).
    r"|tour_(sct|pss|jg|asia|mundial|tx[1-8]|spv(10|[1-9])|sfn(10|[1-9]))"
    r")_v1$"
)
_KV_MAX_BYTES = 2 * 1024 * 1024  # 2 MB por clave (alineado con CLAUDE.md)


def _kv_is_allowed(key):
    if not key:
        return False
    if key in _KV_ALLOWED_EXACT:
        return True
    return bool(_KV_ALLOWED_REGEX.match(key))


@app.route("/api/kv/<key>", methods=["GET"])
def api_kv_get(key):
    if not _kv_is_allowed(key):
        return jsonify({"ok": False, "error": "key no permitida"}), 400
    row = GlobalState.query.filter_by(clave=key).first()
    if not row or not row.valor_json:
        return jsonify({"ok": True, "key": key, "value": None, "updated_at": ""})
    try:
        value = json.loads(row.valor_json)
    except Exception:
        value = None
    return jsonify({
        "ok": True,
        "key": key,
        "value": value,
        "updated_at": row.updated_at or "",
    })


@app.route("/api/kv/<key>", methods=["POST"])
def api_kv_set(key):
    if not _kv_is_allowed(key):
        return jsonify({"ok": False, "error": "key no permitida"}), 400
    body = request.get_json(silent=True) or {}
    if "value" not in body:
        return jsonify({"ok": False, "error": "falta `value`"}), 400
    value = body.get("value")
    try:
        payload = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "value no serializable"}), 400
    if len(payload.encode("utf-8")) > _KV_MAX_BYTES:
        return jsonify({"ok": False, "error": "payload supera 2 MB"}), 413
    now = utc_now_iso()
    row = GlobalState.query.filter_by(clave=key).first()
    if row:
        row.valor_json = payload
        row.updated_at = now
    else:
        row = GlobalState(clave=key, valor_json=payload, updated_at=now)
        db.session.add(row)
    db.session.commit()
    return jsonify({"ok": True, "key": key, "updated_at": now})

# ══════════════════════════════════════════════════════════════════
# JUGADORES HARDCODED — fuente de última recuperación
# ══════════════════════════════════════════════════════════════════
# El frontend usa esto cuando el editor (ligaExt_*) y el resto de
# fuentes están vacíos pero la simulación sí tiene jugadores. La
# data viene del Python (`jugadores_data.py` — generada de
# SQUAD_REGISTRY original del bundle), así que es EXACTAMENTE la
# plantilla por defecto del simulador. Convertimos formato
# Python (numero/nombre/posicion/poder) → editor
# (num/name/pos/power).
@app.route("/api/jugadores-hardcoded", methods=["GET"])
def api_jugadores_hardcoded():
    POS_MAP = {
        "portero": "POR",
        "defensa": "DEF",
        "medio": "MED",
        "delantero": "DEL",
    }
    out = {}
    for team_name, players in jugadores_por_equipo.items():
        out_players = []
        for p in (players or []):
            out_players.append({
                "num": p.get("numero", "") or "",
                "name": p.get("nombre", "") or "",
                "pos": POS_MAP.get(p.get("posicion", "medio"), "MED"),
                "power": int(p.get("poder", 70) or 70),
            })
        out[team_name] = out_players
    return jsonify({"ok": True, "teams": out})


# ══════════════════════════════════════════════════════════════════
# LIVE MATCH — Sistema de partidos en tiempo real compartidos
# ══════════════════════════════════════════════════════════════════
# Permite que el admin publique eventos de un partido live (goles,
# tarjetas, etc.) y que otros dispositivos los vean en tiempo real
# vía polling cada 2-3 segundos.
#
# Modelo: GlobalState con clave 'live_match_<id>' + JSON con:
#   { id, home, away, comp, events:[], score:{a,b}, status:'playing'|'finished', updatedAt }
#
# Endpoints:
#   POST /api/live-match/<match_id>   → crear/actualizar partido
#   GET  /api/live-match/<match_id>   → leer estado actual (poll)
#   GET  /api/live-match              → listar partidos activos
#   DELETE /api/live-match/<match_id> → cerrar/borrar partido
# ══════════════════════════════════════════════════════════════════

def _live_key(match_id):
    return "live_match_" + str(match_id or "default")

@app.route("/api/live-match", methods=["GET"])
def api_live_match_list():
    """Lista todos los partidos live activos."""
    rows = GlobalState.query.filter(GlobalState.clave.like("live_match_%")).all()
    matches = []
    for row in rows:
        try:
            data = json.loads(row.valor_json or "{}")
            if data.get("status") != "finished":
                matches.append(data)
        except Exception:
            pass
    return jsonify({"ok": True, "matches": matches})

@app.route("/api/live-match/<match_id>", methods=["GET"])
def api_live_match_get(match_id):
    """Lee el estado actual de un partido (para polling de espectadores)."""
    key = _live_key(match_id)
    row = GlobalState.query.filter_by(clave=key).first()
    if not row:
        return jsonify({"ok": False, "error": "Partido no encontrado"}), 404
    since = request.args.get("since", "")
    if since and since == (row.updated_at or ""):
        return ("", 304)
    try:
        data = json.loads(row.valor_json or "{}")
    except Exception:
        data = {}
    return jsonify({
        "ok": True,
        "match": data,
        "updated_at": row.updated_at or ""
    })

@app.route("/api/live-match/<match_id>", methods=["POST"])
def api_live_match_post(match_id):
    """Crear o actualizar un partido live (llamado por el admin)."""
    payload = request.get_json(silent=True) or {}
    key = _live_key(match_id)
    now = utc_now_iso()
    payload["updatedAt"] = now
    payload.setdefault("id", match_id)
    payload.setdefault("events", [])
    payload.setdefault("score", {"a": 0, "b": 0})
    payload.setdefault("status", "playing")
    json_str = json.dumps(payload, ensure_ascii=False)
    row = GlobalState.query.filter_by(clave=key).first()
    if row:
        row.valor_json = json_str
        row.updated_at = now
    else:
        row = GlobalState(clave=key, valor_json=json_str, updated_at=now)
        db.session.add(row)
    db.session.commit()
    return jsonify({"ok": True, "updated_at": now})

@app.route("/api/live-match/<match_id>", methods=["DELETE"])
def api_live_match_delete(match_id):
    """Cerrar/borrar un partido live."""
    key = _live_key(match_id)
    row = GlobalState.query.filter_by(clave=key).first()
    if row:
        db.session.delete(row)
        db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/debug", methods=["GET"])
def api_debug():
    """Endpoint de diagnóstico: revela qué backend de base de datos se
    está usando y cuántas filas hay en las tablas clave. Sirve para
    saber en 2 segundos si la app corre con SQLite efímera (Railway
    sin plugin Postgres → datos que se pierden en cada deploy) o con
    Postgres persistente (DATABASE_URL inyectada por el plugin).

    No expone credenciales: solo el backend (`sqlite`/`postgresql`) y,
    en el caso de Postgres, el host sin contraseña."""
    try:
        engine_url = str(db.engine.url)
    except Exception:
        engine_url = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    backend = "sqlite" if engine_url.startswith("sqlite") else (
        "postgresql" if engine_url.startswith("postgresql") else "unknown"
    )
    # Sanitizar la URL: ocultar contraseña si viene en la URI.
    sanitized = engine_url
    if "@" in sanitized and "://" in sanitized:
        try:
            scheme, rest = sanitized.split("://", 1)
            if "@" in rest:
                creds, host = rest.split("@", 1)
                user = creds.split(":", 1)[0]
                sanitized = scheme + "://" + user + ":***@" + host
        except Exception:
            pass
    persistence_note = (
        "PERSISTENTE ✅ — los datos sobreviven reinicios." if backend == "postgresql"
        else "EFÍMERA ⚠️ — en Railway la SQLite se borra en cada deploy. "
             "Añade el plugin Postgres para persistir datos."
    )
    # Contar filas para ver qué hay guardado.
    try:
        global_rows = GlobalState.query.count()
        liga_ext_rows = GlobalState.query.filter(
            GlobalState.clave.like("liga_ext_%")
        ).count()
        live_match_rows = GlobalState.query.filter(
            GlobalState.clave.like("live_match_%")
        ).count()
        partidos_rows = Partido.query.count()
        eventos_rows = Evento.query.count()
    except Exception as e:
        return jsonify({
            "ok": False,
            "backend": backend,
            "db_url_sanitized": sanitized,
            "error": str(e),
        }), 500
    # Listar las ligas externas que tienen datos (nombres + tamaño JSON).
    ligas_ext = []
    try:
        for row in GlobalState.query.filter(GlobalState.clave.like("liga_ext_%")).all():
            try:
                data = json.loads(row.valor_json or "{}")
                n_teams = len((data or {}).get("teams") or [])
            except Exception:
                n_teams = None
            ligas_ext.append({
                "clave": row.clave,
                "teams": n_teams,
                "updated_at": row.updated_at or "",
            })
    except Exception:
        pass
    return jsonify({
        "ok": True,
        "backend": backend,
        "db_url_sanitized": sanitized,
        "persistence": persistence_note,
        "counts": {
            "global_state_rows": global_rows,
            "liga_ext_rows": liga_ext_rows,
            "live_match_rows": live_match_rows,
            "partidos_rows": partidos_rows,
            "eventos_rows": eventos_rows,
        },
        "ligas_ext": ligas_ext,
        "database_url_env_set": bool(os.environ.get("DATABASE_URL")),
    })

@app.route("/")
def inicio():
    resp = make_response(render_template("index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route("/calendario")
def calendario_view():
    return redirect("/espana/liga-ea-sports/clasificacion", code=302)

@app.route("/clasificacion")
def clasificacion():
    resp = make_response(render_template("index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route("/estadisticas")
def estadisticas():
    from collections import Counter

    eventos = Evento.query.all()

    goles_counter = Counter()
    amarillas_counter = Counter()
    rojas_counter = Counter()
    penaltis_marcados_counter = Counter()
    penaltis_fallados_counter = Counter()
    faltas_gol_counter = Counter()
    autogoles_counter = Counter()

    for ev in eventos:
        tipo = ev.tipo or ""
        jug = ev.jugador or "Desconocido"
        if tipo == "gol":
            goles_counter[jug] += 1
        elif tipo == "pen-gol":
            goles_counter[jug] += 1
            penaltis_marcados_counter[jug] += 1
        elif tipo == "falta-gol":
            goles_counter[jug] += 1
            faltas_gol_counter[jug] += 1
        elif tipo == "propia":
            autogoles_counter[jug] += 1
        elif tipo == "amarilla":
            amarillas_counter[jug] += 1
        elif tipo in ("roja", "doble-amarilla"):
            rojas_counter[jug] += 1
        elif tipo == "pen-fallo":
            penaltis_fallados_counter[jug] += 1

    def top(counter):
        return sorted(counter.items(), key=lambda x: x[1], reverse=True)

    return render_template(
        "estadisticas.html",
        goles=top(goles_counter),
        amarillas=top(amarillas_counter),
        rojas=top(rojas_counter),
        penaltis_marcados=top(penaltis_marcados_counter),
        penaltis_fallados=top(penaltis_fallados_counter),
        faltas_gol=top(faltas_gol_counter),
        autogoles=top(autogoles_counter),
    )


@app.route("/reiniciar")
def reiniciar():
    Evento.query.delete()
    Partido.query.delete()
    save_global_state(DEFAULT_GLOBAL_STATE)
    db.session.commit()
    return redirect(url_for("clasificacion"))

@app.route("/<path:path>")
def spa_fallback(path):
    if path.startswith("api/"):
        abort(404)
    # CRÍTICO 2026-05-18: este catch-all sirve la SPA en CUALQUIER ruta
    # (p.ej. /ligas/inglaterra). Antes NO mandaba cabeceras no-cache,
    # así que el navegador/CDN servía un index.html CACHEADO con el JS
    # VIEJO — ninguno de los fixes (watchdog, tope round-robin, sello
    # _sanV…) llegaba al usuario y la sim seguía "rota" idéntica. El
    # index.html incrusta server-side misc_body_1/2, así que DEBE ir
    # siempre fresco.
    resp = make_response(render_template("index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

with app.app_context():
    db.create_all()
    get_or_create_global_state()
    # Cargar flags de jugadores (C/F/P/⭐/⚾) desde la BD a memoria para que
    # el motor de simulación Python los aplique desde el primer partido.
    try:
        _load_player_flags_on_startup()
    except Exception:
        pass

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
