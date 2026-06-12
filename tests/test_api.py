"""Integration tests for Flask API endpoints and the simular_y_guardar event engine."""
import random
import json
import pytest

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app as app_module


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path):
    """Provide a Flask test client with an isolated in-memory SQLite DB."""
    app_module.app.config["TESTING"] = True
    app_module.app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app_module.app.config["WTF_CSRF_ENABLED"] = False

    with app_module.app.app_context():
        app_module.db.create_all()
        app_module.get_or_create_global_state()
        # El motor SQLAlchemy se vincula a la URI del fichero al
        # importar la app, así que el `:memory:` de arriba no surte
        # efecto: los tests COMPARTEN la fila live_state. Para que los
        # tests del merge backend partan de un estado limpio, reseteamos
        # explícitamente la fila a su valor por defecto al inicio de
        # cada test (no toca otras tablas/filas para no afectar al
        # resto de la suite ni a la BD de desarrollo).
        live_row = app_module.GlobalState.query.filter_by(
            clave=app_module.LIVE_STATE_KEY
        ).first()
        if live_row is not None:
            live_row.valor_json = json.dumps(app_module.DEFAULT_LIVE_STATE)
            live_row.updated_at = app_module.utc_now_iso()
            app_module.db.session.commit()
        # Mismo razonamiento para `global_state`: un test que escriba
        # {copa_state: {resultados: "foo"}} dejaba el string ahí para
        # el siguiente test, que esperaba lista y fallaba. Reseteamos
        # a DEFAULT_GLOBAL_STATE para garantizar aislamiento.
        gs_row = app_module.GlobalState.query.filter_by(
            clave=app_module.GLOBAL_STATE_KEY
        ).first()
        if gs_row is not None:
            gs_row.valor_json = json.dumps(app_module.DEFAULT_GLOBAL_STATE)
            gs_row.updated_at = app_module.utc_now_iso()
            app_module.db.session.commit()
        # El calendario también vive en GlobalState (clave
        # `calendario_global_v1`) para sobrevivir reinicios en Railway,
        # así que aplica el mismo aislamiento entre tests: borramos la
        # fila para que cada test re-siembre desde `calendario.json`.
        cal_row = app_module.GlobalState.query.filter_by(
            clave=app_module.CALENDARIO_GLOBAL_KEY
        ).first()
        if cal_row is not None:
            app_module.db.session.delete(cal_row)
            app_module.db.session.commit()

    with app_module.app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _json(response):
    return json.loads(response.data)


# ---------------------------------------------------------------------------
# Basic page routes
# ---------------------------------------------------------------------------

class TestPageRoutes:

    def test_root_returns_200(self, client):
        rv = client.get("/")
        assert rv.status_code == 200

    def test_spa_fallback_returns_200(self, client):
        rv = client.get("/some/deep/path")
        assert rv.status_code == 200

    def test_api_path_not_found_via_spa_fallback(self, client):
        rv = client.get("/api/nonexistent")
        assert rv.status_code == 404

    def test_estadisticas_returns_200(self, client):
        rv = client.get("/estadisticas")
        assert rv.status_code == 200

    def test_estadisticas_shows_all_sections(self, client):
        rv = client.get("/estadisticas")
        html = rv.data.decode("utf-8")
        assert "Goleadores" in html
        assert "Amarillas" in html
        assert "Rojas" in html
        assert "Penaltis marcados" in html
        assert "Penaltis fallados" in html
        assert "Goles de falta" in html
        assert "Autogoles" in html

    def test_estadisticas_empty_shows_no_data(self, client):
        """When DB is empty, each section shows the no-data fallback."""
        # Clear any data added by other tests
        with app_module.app.app_context():
            app_module.Evento.query.delete()
            app_module.Partido.query.delete()
            app_module.db.session.commit()
        rv = client.get("/estadisticas")
        html = rv.data.decode("utf-8")
        assert "No hay datos todavía" in html


# ---------------------------------------------------------------------------
# /api/state  (GET / POST)
# ---------------------------------------------------------------------------

class TestApiState:

    def test_get_state_returns_ok(self, client):
        rv = client.get("/api/state")
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True
        assert "state" in data

    def test_get_state_contains_default_keys(self, client):
        rv = client.get("/api/state")
        state = _json(rv)["state"]
        assert "liga_results" in state
        assert "segunda_state" in state

    def test_post_state_saves_and_returns_ok(self, client):
        payload = {"state": {"liga_results": {"jornada": 1}}}
        rv = client.post(
            "/api/state",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True

    def test_post_invalid_state_returns_400(self, client):
        payload = {"state": "not_a_dict"}
        rv = client.post(
            "/api/state",
            data=json.dumps(payload),
            content_type="application/json",
        )
        assert rv.status_code == 400

    def test_post_state_persists_value(self, client):
        payload = {"state": {"liga_results": {"test_key": "hello"}}}
        client.post(
            "/api/state",
            data=json.dumps(payload),
            content_type="application/json",
        )
        rv = client.get("/api/state")
        state = _json(rv)["state"]
        assert state["liga_results"].get("test_key") == "hello"

    def test_partial_post_does_not_wipe_other_keys(self, client):
        """Un POST parcial (ej. solo `liga_schedule`) NO debe borrar
        las claves que ya había en la fila (ej. `liga_results`)."""
        # 1. Primer POST: escribimos liga_results con datos reales.
        client.post(
            "/api/state",
            data=json.dumps({"state": {"liga_results": {"1|A|B": {"gh": 2, "ga": 1}}}}),
            content_type="application/json",
        )
        rv = client.get("/api/state")
        assert _json(rv)["state"]["liga_results"].get("1|A|B") == {"gh": 2, "ga": 1}

        # 2. Segundo POST: solo liga_schedule. Antes del fix este POST
        #    pisaba liga_results con el valor DEFAULT ({}).
        client.post(
            "/api/state",
            data=json.dumps({"state": {"liga_schedule": [["X", "Y"], ["Z", "W"]]}}),
            content_type="application/json",
        )
        rv = client.get("/api/state")
        state = _json(rv)["state"]
        # liga_schedule aplicado
        assert state.get("liga_schedule") == [["X", "Y"], ["Z", "W"]]
        # liga_results PRESERVADO (antes se perdía)
        assert state["liga_results"].get("1|A|B") == {"gh": 2, "ga": 1}

    def test_partial_post_does_not_wipe_same_root_key(self, client):
        """POST de `{liga_results: {new_key: X}}` debe HACER MERGE
        con las entradas previas de liga_results, no reemplazarlas.

        Nota: `merge_dict` hace merge recursivo cuando ambos valores
        son dicts, así que este test verifica ese comportamiento."""
        client.post(
            "/api/state",
            data=json.dumps({"state": {"liga_results": {"1|A|B": {"gh": 1, "ga": 0}}}}),
            content_type="application/json",
        )
        client.post(
            "/api/state",
            data=json.dumps({"state": {"liga_results": {"1|C|D": {"gh": 3, "ga": 2}}}}),
            content_type="application/json",
        )
        rv = client.get("/api/state")
        liga_results = _json(rv)["state"]["liga_results"]
        # Ambas entradas presentes tras los dos POSTs
        assert liga_results.get("1|A|B") == {"gh": 1, "ga": 0}
        assert liga_results.get("1|C|D") == {"gh": 3, "ga": 2}

    def test_get_state_returns_updated_at(self, client):
        rv = client.get("/api/state")
        data = _json(rv)
        assert "updated_at" in data
        assert isinstance(data["updated_at"], str)

    def test_get_state_with_since_returns_304_when_unchanged(self, client):
        # Write something so we have a non-default updated_at.
        client.post(
            "/api/state",
            data=json.dumps({"state": {"liga_results": {"x": 1}}}),
            content_type="application/json",
        )
        rv = client.get("/api/state")
        current_ts = _json(rv)["updated_at"]
        rv2 = client.get("/api/state", query_string={"since": current_ts})
        assert rv2.status_code == 304

    def test_get_state_with_stale_since_returns_data(self, client):
        rv = client.get("/api/state", query_string={"since": "1999-01-01T00:00:00+00:00"})
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True
        assert "state" in data


# ---------------------------------------------------------------------------
# /reiniciar
# ---------------------------------------------------------------------------

class TestReiniciar:

    def test_reiniciar_redirects(self, client):
        rv = client.get("/reiniciar")
        assert rv.status_code in (301, 302)

    def test_reiniciar_clears_partidos(self, client):
        with app_module.app.app_context():
            p = app_module.Partido(
                jornada=1, local="A", visitante="B",
                goles_local=1, goles_visitante=0, mvp="X"
            )
            app_module.db.session.add(p)
            app_module.db.session.commit()

        client.get("/reiniciar")

        with app_module.app.app_context():
            assert app_module.Partido.query.count() == 0


# ---------------------------------------------------------------------------
# Copa API
# ---------------------------------------------------------------------------

class TestCopaAPI:

    def test_copa_get_state_returns_ok(self, client):
        rv = client.get("/api/copa/state")
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True

    def test_copa_sorteo_r1_returns_matches(self, client):
        rv = client.post(
            "/api/copa/sorteo",
            data=json.dumps({"ronda": "r1"}),
            content_type="application/json",
        )
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True
        assert "matches" in data
        assert len(data["matches"]) == 2  # 4 teams → 2 matches

    def test_copa_sorteo_invalid_ronda_returns_400(self, client):
        rv = client.post(
            "/api/copa/sorteo",
            data=json.dumps({"ronda": "inexistente"}),
            content_type="application/json",
        )
        assert rv.status_code == 400

    def test_copa_simular_ia_r1_match(self, client):
        # First set up the draw
        client.post(
            "/api/copa/sorteo",
            data=json.dumps({"ronda": "r1"}),
            content_type="application/json",
        )
        rv = client.post(
            "/api/copa/simular_ia",
            data=json.dumps({"ronda": "r1", "idx": 0, "es_vuelta": False}),
            content_type="application/json",
        )
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True

    def test_copa_reiniciar_resets_state(self, client):
        # Perform a draw first
        client.post(
            "/api/copa/sorteo",
            data=json.dumps({"ronda": "r1"}),
            content_type="application/json",
        )
        # Then reset
        rv = client.post("/api/copa/reiniciar")
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True

        # State should be clean
        rv2 = client.get("/api/copa/state")
        copa = _json(rv2)["copa"]
        assert copa.get("sorteo", {}) == {}


# ---------------------------------------------------------------------------
# Reset forzado de Liga EA Sports  (/api/state/reset-liga)
# ---------------------------------------------------------------------------

class TestResetLiga:

    def test_reset_liga_vacia_resultados_aunque_merge_parcial_no_lo_haga(self, client):
        """Regresión: el POST parcial a /api/state con {liga_results:{}}
        no vacía liga_results porque merge_dict preserva sub-claves.
        El endpoint /api/state/reset-liga debe SÍ vaciarlo siempre,
        usando replace=True en el servidor."""
        # 1) Simular que hay resultados acumulados de una temporada.
        client.post("/api/state", json={
            "liga_results": {
                "1|Real Madrid|FC Barcelona": {"gl": 2, "gv": 1},
                "1|Athletic Club|Alavés": {"gl": 0, "gv": 0},
            }
        })
        # 2) Confirmar que efectivamente se guardaron.
        state = _json(client.get("/api/state"))["state"]
        assert "1|Real Madrid|FC Barcelona" in (state.get("liga_results") or {})

        # 3) El patch parcial con {} NO los limpia (este es el bug
        # que motiva el endpoint nuevo).
        client.post("/api/state", json={"liga_results": {}})
        state_after_patch = _json(client.get("/api/state"))["state"]
        assert "1|Real Madrid|FC Barcelona" in (state_after_patch.get("liga_results") or {}), \
            "merge_dict con incoming vacío NO debería limpiar — comportamiento esperado que motiva /api/state/reset-liga"

        # 4) El endpoint de reset sí los limpia.
        rv = client.post("/api/state/reset-liga")
        assert rv.status_code == 200
        assert _json(rv)["ok"] is True
        state_after_reset = _json(client.get("/api/state"))["state"]
        assert (state_after_reset.get("liga_results") or {}) == {}

    def test_reset_liga_acepta_nuevo_schedule_atomico(self, client):
        """El endpoint puede recibir un schedule nuevo en el body para
        aplicarlo a la vez que vacía los resultados (evita una ronda
        extra de POST desde el cliente tras reiniciar)."""
        # Schedule mínimamente válido: 38 jornadas con listas no vacías.
        fake_schedule = [[["Equipo A", "Equipo B"]] for _ in range(38)]
        rv = client.post("/api/state/reset-liga",
                         json={"liga_schedule": fake_schedule})
        assert rv.status_code == 200
        state = _json(client.get("/api/state"))["state"]
        assert (state.get("liga_results") or {}) == {}
        # El schedule debe haberse aplicado.
        assert state.get("liga_schedule") == fake_schedule

    def test_reset_liga_no_toca_copa_ni_otros_estados(self, client):
        """El reset de liga NO debe borrar copa_state, segunda_state,
        etc. (sólo liga_results / liga_schedule)."""
        # copa_state con formato válido (fase + sorteo como dict) para
        # no contaminar el estado compartido con el resto de tests que
        # asumen que `resultados` es dict-de-listas.
        client.post("/api/state", json={
            "liga_results": {"k": {"gl": 1, "gv": 0}},
            "copa_state": {"fase": "oct", "sorteo": {"oct": [["A", "B"]]}},
        })
        client.post("/api/state/reset-liga")
        state = _json(client.get("/api/state"))["state"]
        assert (state.get("liga_results") or {}) == {}
        # copa_state intacto
        copa = state.get("copa_state") or {}
        assert copa.get("fase") == "oct"
        assert copa.get("sorteo") == {"oct": [["A", "B"]]}


# ---------------------------------------------------------------------------
# simular_y_guardar — event generation
# ---------------------------------------------------------------------------

class TestSimularYGuardar:
    """
    Statistical tests to verify that the "dormant events" (penalties, free-kick
    goals, own goals) are actually generated across many simulated matches.
    """

    def _run_simulations(self, n=300):
        """Run n simulations and collect all generated event types."""
        local = "Real Madrid"
        visitante = "FC Barcelona"
        event_types = []

        with app_module.app.app_context():
            app_module.db.create_all()
        random.seed(12345)
        with app_module.app.app_context():
            for i in range(n):
                # Use unique match identifiers to bypass the deduplication guard
                fake_local = f"{local}_{i}"
                fake_visit = f"{visitante}_{i}"

                gl = app_module.simular_goles(local, True, oponente=visitante)
                gv = app_module.simular_goles(visitante, False, oponente=local)

                conteo_l, conteo_v = {}, {}
                eventos = []

                for _ in range(gl):
                    g = app_module.elegir_goleador(local, True, conteo_l)
                    conteo_l[g] = conteo_l.get(g, 0) + 1
                    eventos.append(("gol", local, g))

                for _ in range(gv):
                    g = app_module.elegir_goleador(visitante, False, conteo_v)
                    conteo_v[g] = conteo_v.get(g, 0) + 1
                    eventos.append(("gol", visitante, g))

                # Penalty (8%)
                if random.random() < 0.08:
                    pen_eq = random.choice([local, visitante])
                    pen_jug = app_module._elegir_jugador_campo(pen_eq)
                    tipo_pen = "pen-gol" if random.random() < 0.75 else "pen-fallo"
                    eventos.append((tipo_pen, pen_eq, pen_jug))

                # Free-kick goal (5%)
                if random.random() < 0.05:
                    fk_eq = random.choice([local, visitante])
                    fk_jug = app_module._elegir_jugador_campo(fk_eq)
                    eventos.append(("falta-gol", fk_eq, fk_jug))

                # Own goal (1%)
                if random.random() < 0.01:
                    og_eq = random.choice([local, visitante])
                    og_jug = app_module._elegir_jugador_campo(og_eq)
                    eventos.append(("propia", og_eq, og_jug))

                # Yellow cards
                num_amarillas = random.choices([2, 3, 4], weights=[40, 40, 20])[0]
                for _ in range(num_amarillas):
                    am_eq = random.choice([local, visitante])
                    am_jug = app_module._elegir_jugador_campo(am_eq)
                    eventos.append(("amarilla", am_eq, am_jug))

                event_types.extend(t for t, _, _ in eventos)

        return event_types

    def test_penalty_events_appear(self):
        types = self._run_simulations(300)
        penalty_types = [t for t in types if t.startswith("pen-")]
        assert len(penalty_types) > 0, "Penalty events never fired in 300 matches"

    def test_free_kick_goal_events_appear(self):
        types = self._run_simulations(300)
        fk_goals = [t for t in types if t == "falta-gol"]
        assert len(fk_goals) > 0, "Free-kick goal events never fired in 300 matches"

    def test_own_goal_events_appear(self):
        types = self._run_simulations(600)
        own_goals = [t for t in types if t == "propia"]
        assert len(own_goals) > 0, "Own-goal events never fired in 600 matches"

    def test_yellow_cards_appear_every_match(self):
        types = self._run_simulations(50)
        yellow_cards = [t for t in types if t == "amarilla"]
        # At minimum 2 yellow cards per match × 50 matches = 100
        assert len(yellow_cards) >= 100

    def test_goal_events_appear(self):
        types = self._run_simulations(100)
        goals = [t for t in types if t == "gol"]
        assert len(goals) > 0

    def test_goalkeeper_almost_never_scores(self):
        """Verify that across many simulations GKs score far less than forwards."""
        from jugadores_data import jugadores_por_equipo
        gk_names = {
            j["nombre"]
            for j in jugadores_por_equipo["Real Madrid"]
            if j["posicion"] == "portero"
        } | {
            j["nombre"]
            for j in jugadores_por_equipo["FC Barcelona"]
            if j["posicion"] == "portero"
        }

        random.seed(42)
        gk_goals = 0
        total_goals = 0

        with app_module.app.app_context():
            for _ in range(500):
                for equipo, local_flag, oponente in [
                    ("Real Madrid", True, "FC Barcelona"),
                    ("FC Barcelona", False, "Real Madrid"),
                ]:
                    gl = app_module.simular_goles(equipo, local_flag, oponente=oponente)
                    conteo = {}
                    for _ in range(gl):
                        scorer = app_module.elegir_goleador(equipo, local_flag, conteo)
                        conteo[scorer] = conteo.get(scorer, 0) + 1
                        total_goals += 1
                        if scorer in gk_names:
                            gk_goals += 1

        gk_rate = gk_goals / max(1, total_goals)
        assert gk_rate < 0.02, (
            f"Goalkeepers scored {gk_goals}/{total_goals} goals ({gk_rate:.2%}); "
            "expected < 2%"
        )


# ---------------------------------------------------------------------------
# DB-backed simular_y_guardar via app context
# ---------------------------------------------------------------------------

class TestSimularYGuardarDB:

    def test_match_saved_to_db(self, client):
        with app_module.app.app_context():
            random.seed(1)
            app_module.simular_y_guardar(1, "Real Madrid", "FC Barcelona")
            count = app_module.Partido.query.count()
        assert count == 1

    def test_duplicate_match_not_saved(self, client):
        with app_module.app.app_context():
            app_module.simular_y_guardar(1, "Real Madrid", "FC Barcelona")
            app_module.simular_y_guardar(1, "Real Madrid", "FC Barcelona")
            count = app_module.Partido.query.count()
        assert count == 1

    def test_events_saved_for_match(self, client):
        with app_module.app.app_context():
            random.seed(2)
            app_module.simular_y_guardar(1, "Real Madrid", "FC Barcelona")
            eventos = app_module.Evento.query.all()
        # At minimum yellow cards (2+) are always generated
        assert len(eventos) >= 2

    def test_match_has_mvp(self, client):
        with app_module.app.app_context():
            random.seed(3)
            app_module.simular_y_guardar(1, "Real Madrid", "FC Barcelona")
            partido = app_module.Partido.query.first()
        assert partido.mvp is not None
        assert isinstance(partido.mvp, str)
        assert len(partido.mvp) > 0

    def test_goles_non_negative(self, client):
        with app_module.app.app_context():
            random.seed(4)
            app_module.simular_y_guardar(1, "Real Madrid", "FC Barcelona")
            partido = app_module.Partido.query.first()
        assert partido.goles_local >= 0
        assert partido.goles_visitante >= 0


# ---------------------------------------------------------------------------
# LIVE STATE shared API  (/api/live/state)
# ---------------------------------------------------------------------------

class TestLiveStateAPI:

    def test_get_returns_shape(self, client):
        rv = client.get("/api/live/state")
        assert rv.status_code == 200
        data = _json(rv)
        assert "state" in data
        assert "updated_at" in data
        assert isinstance(data["state"], dict)

    def test_post_saves_and_get_returns_it(self, client):
        payload = {
            "state": {
                "ml": {
                    "ams-1": {
                        "home": "Arsenal",
                        "away": "Bayern Munich",
                        "sc": {"a": 1, "b": 0},
                        "kickoffDone": True,
                        "finished": False,
                        "timerSec": 420,
                        "isHvH": True,
                        "isFriendly": True,
                    }
                },
                "gmLive": None,
                "gmBg": {},
            }
        }
        rv = client.post("/api/live/state", json=payload)
        assert rv.status_code == 200
        saved = _json(rv)
        assert saved["state"]["ml"]["ams-1"]["home"] == "Arsenal"
        assert saved["state"]["ml"]["ams-1"]["sc"]["a"] == 1
        first_updated_at = saved["updated_at"]

        rv2 = client.get("/api/live/state")
        assert rv2.status_code == 200
        fetched = _json(rv2)
        assert fetched["state"]["ml"]["ams-1"]["home"] == "Arsenal"
        assert fetched["updated_at"] == first_updated_at

    def test_get_with_since_returns_304_when_unchanged(self, client):
        # First write something so we have a non-default updated_at.
        client.post("/api/live/state", json={"state": {"ml": {"ams-1": {"home": "A", "away": "B"}}}})
        rv = client.get("/api/live/state")
        current_ts = _json(rv)["updated_at"]

        rv2 = client.get("/api/live/state", query_string={"since": current_ts})
        assert rv2.status_code == 304

    def test_post_accepts_plain_body_too(self, client):
        # The endpoint should accept both {state: {...}} and a bare dict.
        rv = client.post("/api/live/state", json={"ml": {"x": {"home": "H", "away": "A"}}})
        assert rv.status_code == 200
        fetched = _json(client.get("/api/live/state"))
        assert "x" in fetched["state"]["ml"]

    def test_post_overwrites_previous_state(self, client):
        client.post("/api/live/state", json={"state": {"ml": {"m1": {"home": "A", "away": "B"}}}})
        client.post("/api/live/state", json={"state": {"ml": {"m2": {"home": "C", "away": "D"}}}})
        fetched = _json(client.get("/api/live/state"))
        # Last-write-wins a nivel de qué partidos existen: m1 desaparece
        # porque el segundo POST no lo incluye en su snapshot.
        assert "m1" not in fetched["state"]["ml"]
        assert "m2" in fetched["state"]["ml"]

    # ── COEDICIÓN HUMANO vs HUMANO ──────────────────────────────────
    # Los siguientes tests verifican que dos dispositivos pueden añadir
    # eventos al MISMO partido sin que un POST le pise los eventos al
    # otro (escenario: dos humanos jugando un partido HvH live, cada uno
    # marcando goles/tarjetas desde su propio móvil).

    def test_events_are_unioned_by_id_across_posts(self, client):
        """Dos clientes añaden eventos distintos al mismo partido. Tras
        el segundo POST, el servidor debe contener AMBOS eventos."""
        match = {"home": "Real Madrid", "away": "Barcelona", "kickoffDone": True}
        # Cliente A postea con el evento E_A
        ev_a = {"id": "evt-a-001", "type": "gol", "team": "a", "min": 23,
                "player": "Jugador A", "num": "9"}
        client.post("/api/live/state", json={"state": {
            "ml": {"hvh-1": dict(match, events=[ev_a])}
        }})
        # Cliente B postea con el evento E_B (no conoce E_A todavía)
        ev_b = {"id": "evt-b-002", "type": "gol", "team": "b", "min": 31,
                "player": "Jugador B", "num": "10"}
        client.post("/api/live/state", json={"state": {
            "ml": {"hvh-1": dict(match, events=[ev_b])}
        }})
        fetched = _json(client.get("/api/live/state"))
        merged = fetched["state"]["ml"]["hvh-1"]["events"]
        ids = sorted(e["id"] for e in merged)
        assert ids == ["evt-a-001", "evt-b-002"]
        # Y el marcador se recalcula a partir de los eventos: 1-1
        assert fetched["state"]["ml"]["hvh-1"]["sc"] == {"a": 1, "b": 1}

    def test_event_with_same_id_does_not_duplicate(self, client):
        """Un cliente reposteando su snapshot con el mismo id no debe
        crear duplicados (debounce + flush periódico repostea seguido)."""
        ev = {"id": "evt-x", "type": "gol", "team": "a", "min": 10}
        match = {"home": "A", "away": "B", "kickoffDone": True, "events": [ev]}
        for _ in range(3):
            client.post("/api/live/state", json={"state": {"ml": {"m": match}}})
        fetched = _json(client.get("/api/live/state"))
        assert len(fetched["state"]["ml"]["m"]["events"]) == 1

    def test_event_update_with_same_id_overwrites(self, client):
        """Editar un evento existente (mismo id, distinto contenido)
        debe reemplazarlo en su sitio, no añadir uno nuevo."""
        ev_v1 = {"id": "evt-1", "type": "amarilla", "team": "a", "min": 12,
                 "player": "Pepe"}
        client.post("/api/live/state", json={"state": {
            "ml": {"m": {"home": "A", "away": "B", "kickoffDone": True,
                          "events": [ev_v1]}}
        }})
        ev_v2 = dict(ev_v1, type="d-amarilla", min=45)
        client.post("/api/live/state", json={"state": {
            "ml": {"m": {"home": "A", "away": "B", "kickoffDone": True,
                          "events": [ev_v2]}}
        }})
        fetched = _json(client.get("/api/live/state"))
        evs = fetched["state"]["ml"]["m"]["events"]
        assert len(evs) == 1
        assert evs[0]["type"] == "d-amarilla"
        assert evs[0]["min"] == 45

    def test_legacy_events_without_id_dedup_by_content(self, client):
        """Eventos sin id (clientes legacy) se deduplican por contenido
        para que reposteos seguidos no creen duplicados."""
        ev = {"type": "gol", "team": "a", "min": 7, "player": "X", "num": "11"}
        match = {"home": "A", "away": "B", "kickoffDone": True, "events": [ev]}
        client.post("/api/live/state", json={"state": {"ml": {"m": match}}})
        client.post("/api/live/state", json={"state": {"ml": {"m": match}}})
        fetched = _json(client.get("/api/live/state"))
        assert len(fetched["state"]["ml"]["m"]["events"]) == 1

    def test_timer_takes_max_across_posts(self, client):
        """El cronómetro es monotónico: gana el valor más alto entre
        dos snapshots concurrentes (no LWW que podría retroceder)."""
        client.post("/api/live/state", json={"state": {
            "ml": {"m": {"home": "A", "away": "B", "kickoffDone": True,
                          "events": [], "timerSec": 600}}
        }})
        # Snapshot "atrasado" llega después; no debe pisar el timer.
        client.post("/api/live/state", json={"state": {
            "ml": {"m": {"home": "A", "away": "B", "kickoffDone": True,
                          "events": [], "timerSec": 540}}
        }})
        fetched = _json(client.get("/api/live/state"))
        assert fetched["state"]["ml"]["m"]["timerSec"] == 600

    def test_monotonic_flags_latch_true(self, client):
        """Las banderas como `finished`, `htDone`, `etDone` son
        monotónicas: una vez en True, ningún snapshot posterior con
        False puede revertirlas."""
        client.post("/api/live/state", json={"state": {
            "ml": {"m": {"home": "A", "away": "B", "kickoffDone": True,
                          "htDone": True, "events": []}}
        }})
        client.post("/api/live/state", json={"state": {
            "ml": {"m": {"home": "A", "away": "B", "kickoffDone": True,
                          "htDone": False, "events": []}}
        }})
        fetched = _json(client.get("/api/live/state"))
        assert fetched["state"]["ml"]["m"]["htDone"] is True

    def test_score_recomputed_from_merged_events(self, client):
        """El marcador se recalcula a partir de los eventos fusionados,
        ignorando goles anulados por VAR."""
        match = {"home": "A", "away": "B", "kickoffDone": True}
        client.post("/api/live/state", json={"state": {
            "ml": {"m": dict(match, events=[
                {"id": "g1", "type": "gol", "team": "a", "min": 10},
                {"id": "g2", "type": "gol", "team": "a", "min": 20},
            ], varAnuladoIds=["g2"])}
        }})
        client.post("/api/live/state", json={"state": {
            "ml": {"m": dict(match, events=[
                {"id": "g3", "type": "propia", "team": "a", "min": 30},
            ])}
        }})
        fetched = _json(client.get("/api/live/state"))
        m = fetched["state"]["ml"]["m"]
        assert sorted(e["id"] for e in m["events"]) == ["g1", "g2", "g3"]
        # g1 cuenta para A. g2 anulado por VAR. g3 propia → cuenta para B.
        assert m["sc"] == {"a": 1, "b": 1}

    def test_var_anulado_ids_are_unioned(self, client):
        """varAnuladoIds y redCards también se fusionan (set semantics)
        para que dos dispositivos puedan anular distintos goles."""
        match = {"home": "A", "away": "B", "kickoffDone": True, "events": [
            {"id": "g1", "type": "gol", "team": "a", "min": 10},
            {"id": "g2", "type": "gol", "team": "b", "min": 20},
        ]}
        client.post("/api/live/state", json={"state": {
            "ml": {"m": dict(match, varAnuladoIds=["g1"])}
        }})
        client.post("/api/live/state", json={"state": {
            "ml": {"m": dict(match, varAnuladoIds=["g2"])}
        }})
        fetched = _json(client.get("/api/live/state"))
        anulados = fetched["state"]["ml"]["m"]["varAnuladoIds"]
        assert sorted(anulados) == ["g1", "g2"]
        # Ambos goles anulados → 0-0
        assert fetched["state"]["ml"]["m"]["sc"] == {"a": 0, "b": 0}

    def test_gm_live_merges_events_when_same_match(self, client):
        """gmLive (modal de partido genérico) también une eventos cuando
        el partido es el mismo (mismo j/home/away)."""
        gm_a = {"j": 1, "home": "RM", "away": "FCB", "kickoffDone": True,
                "events": [{"id": "e1", "type": "gol", "team": "a", "min": 5}]}
        client.post("/api/live/state", json={"state": {"gmLive": gm_a}})
        gm_b = dict(gm_a, events=[
            {"id": "e2", "type": "gol", "team": "b", "min": 8}
        ])
        client.post("/api/live/state", json={"state": {"gmLive": gm_b}})
        fetched = _json(client.get("/api/live/state"))
        ids = sorted(e["id"] for e in fetched["state"]["gmLive"]["events"])
        assert ids == ["e1", "e2"]

    def test_gm_live_replaces_when_different_match(self, client):
        """Si el `gmLive` cambia a OTRO partido (otro j/home/away), se
        reemplaza por completo (no se mezclan eventos de partidos
        distintos)."""
        gm_a = {"j": 1, "home": "RM", "away": "FCB", "kickoffDone": True,
                "events": [{"id": "e1", "type": "gol", "team": "a", "min": 5}]}
        client.post("/api/live/state", json={"state": {"gmLive": gm_a}})
        gm_b = {"j": 2, "home": "Atletico", "away": "Sevilla", "kickoffDone": True,
                "events": [{"id": "z9", "type": "gol", "team": "a", "min": 10}]}
        client.post("/api/live/state", json={"state": {"gmLive": gm_b}})
        fetched = _json(client.get("/api/live/state"))
        gl = fetched["state"]["gmLive"]
        assert gl["home"] == "Atletico"
        assert [e["id"] for e in gl["events"]] == ["z9"]


# ---------------------------------------------------------------------------
# Admin session (PIN 747) + CRUD del calendario editable
# ---------------------------------------------------------------------------

class TestAdminSession:

    def test_status_anonymous_is_false(self, client):
        rv = client.get("/api/admin/status")
        assert rv.status_code == 200
        assert _json(rv)["admin"] is False

    def test_login_wrong_pin_returns_401(self, client):
        rv = client.post("/api/admin/login", json={"pin": "000"})
        assert rv.status_code == 401
        assert _json(rv)["ok"] is False

    def test_login_right_pin_sets_session(self, client):
        rv = client.post("/api/admin/login", json={"pin": "747"})
        assert rv.status_code == 200
        assert _json(rv) == {"ok": True, "admin": True}
        # La sesión persiste entre peticiones del mismo test_client
        rv2 = client.get("/api/admin/status")
        assert _json(rv2)["admin"] is True

    def test_logout_clears_admin(self, client):
        client.post("/api/admin/login", json={"pin": "747"})
        rv = client.post("/api/admin/logout")
        assert _json(rv) == {"ok": True, "admin": False}
        rv2 = client.get("/api/admin/status")
        assert _json(rv2)["admin"] is False


class TestCalendario:

    def _login(self, client):
        client.post("/api/admin/login", json={"pin": "747"})

    def test_get_calendario_shape(self, client):
        rv = client.get("/api/calendario")
        assert rv.status_code == 200
        data = _json(rv)
        assert data["ok"] is True
        cal = data["calendario"]
        assert isinstance(cal.get("sections"), list)
        # El seed tiene 4 secciones y cubre la temporada día a día
        # (partidos + Descanso tras cada partido + Entrenamiento el
        # resto), así que el total es > 300. Sólo validamos orden de
        # magnitud para que pequeños ajustes del seed no rompan el test.
        assert len(cal["sections"]) == 4
        total = sum(len(s["events"]) for s in cal["sections"])
        assert total > 300

    def test_add_edit_delete_require_admin(self, client):
        """Sin login, los 3 POST de mutación devuelven 403."""
        for path, body in [
            ("/api/calendario/add", {"section_id": "verano-p1", "date": "X", "icon": "🤝", "name": "X", "weather": "☀️"}),
            ("/api/calendario/edit", {"event_id": "ev-001", "date": "X", "icon": "🤝", "name": "X", "weather": "☀️"}),
            ("/api/calendario/delete", {"event_id": "ev-001"}),
        ]:
            rv = client.post(path, json=body)
            assert rv.status_code == 403, f"{path} debería requerir admin"

    def test_add_event_generates_id_and_persists(self, client, tmp_path, monkeypatch):
        """El add genera un id `ev-NNN` único y guarda el evento en
        la sección indicada."""
        # Redirige el archivo a un tmp para no manchar el del repo.
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        rv = client.post("/api/calendario/add", json={
            "section_id": "verano-p1",
            "date": "16 Jul",
            "icon": "🤝",
            "name": "Amistoso EXTRA",
            "weather": "☀️",
        })
        assert rv.status_code == 200
        j = _json(rv)
        assert j["ok"] is True
        assert j["event"]["id"].startswith("ev-")
        assert j["event"]["name"] == "Amistoso EXTRA"
        # El nuevo id no debe colisionar con uno existente.
        cal = _json(client.get("/api/calendario"))["calendario"]
        all_ids = [e["id"] for s in cal["sections"] for e in s["events"]]
        assert len(all_ids) == len(set(all_ids))
        # Y el evento se encuentra en verano-p1.
        verano_events = next(s["events"] for s in cal["sections"] if s["id"] == "verano-p1")
        assert any(e["name"] == "Amistoso EXTRA" for e in verano_events)

    def test_add_rejects_missing_fields(self, client, tmp_path, monkeypatch):
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        # Falta `name`
        rv = client.post("/api/calendario/add", json={
            "section_id": "verano-p1", "date": "X", "icon": "🤝", "weather": "☀️"
        })
        assert rv.status_code == 400
        assert _json(rv)["error"] == "falta nombre"

    def test_add_rejects_unknown_section(self, client, tmp_path, monkeypatch):
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        rv = client.post("/api/calendario/add", json={
            "section_id": "no-existe", "date": "X", "icon": "🤝",
            "name": "Y", "weather": "☀️"
        })
        assert rv.status_code == 404

    def test_edit_updates_fields_in_place(self, client, tmp_path, monkeypatch):
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        rv = client.post("/api/calendario/edit", json={
            "event_id": "ev-001",
            "date": "16 Jul",
            "icon": "🤝",
            "name": "Amistoso editado",
            "weather": "🌧",
        })
        assert rv.status_code == 200
        j = _json(rv)
        assert j["event"]["name"] == "Amistoso editado"
        assert j["event"]["weather"] == "🌧"
        assert j["event"]["id"] == "ev-001"  # id conservado

    def test_edit_rejects_unknown_event(self, client, tmp_path, monkeypatch):
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        rv = client.post("/api/calendario/edit", json={
            "event_id": "ev-zzz",
            "date": "X", "icon": "🤝", "name": "X", "weather": "☀️"
        })
        assert rv.status_code == 404

    def test_delete_removes_event(self, client, tmp_path, monkeypatch):
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        rv = client.post("/api/calendario/delete", json={"event_id": "ev-005"})
        assert rv.status_code == 200
        assert _json(rv)["ok"] is True
        # Ya no debe aparecer en el GET.
        cal = _json(client.get("/api/calendario"))["calendario"]
        all_ids = [e["id"] for s in cal["sections"] for e in s["events"]]
        assert "ev-005" not in all_ids

    def test_delete_rejects_unknown_event(self, client, tmp_path, monkeypatch):
        fake = tmp_path / "calendario.json"
        fake.write_text(open(app_module.CALENDARIO_PATH).read(), encoding="utf-8")
        monkeypatch.setattr(app_module, "CALENDARIO_PATH", str(fake))
        self._login(client)
        rv = client.post("/api/calendario/delete", json={"event_id": "ev-zzz"})
        assert rv.status_code == 404
