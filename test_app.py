import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import app
import workflow


class AgendaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_db = app.DB
        app.DB = Path(self.temp.name) / "data.sqlite3"

    def tearDown(self):
        app.close_connection()
        app.DB = self.original_db
        self.temp.cleanup()

    def sample(self, days=2, status="aberta", occupied=3):
        return app.validate({"data": (date.today() + timedelta(days=days)).isoformat(),
            "profissional": "Dra. Ana", "especialidade": "Cardiologia", "situacao": status,
            "periodos": [{"inicio": "08:00", "fim": "12:00", "intervalo": 20}],
            "total_manual": 12, "ocupados_manual": occupied, "confirmados_manual": 1})

    def test_storage_dashboard_and_alert(self):
        values = self.sample()
        values["atualizado_em"] = "2026-10-30T10:00:00-03:00"
        with app.closing(app.db()) as con, con:
            con.execute("INSERT INTO agendas (data,profissional,especialidade,situacao,periodos,total_manual,ocupados_manual,confirmados_manual,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)",
                (values["data"], values["profissional"], values["especialidade"], values["situacao"], values["periodos"], 12, 3, 1, values["atualizado_em"]))
        rows = app.list_agendas()
        self.assertEqual(rows[0]["ocupacao"], 25)
        self.assertEqual(rows[0]["capacidade_prevista"], 12)
        self.assertEqual(app.dashboard(rows)["alertas"][0]["nivel"], "critico")

    def test_unknown_is_not_zero_and_invalid_counts_rejected(self):
        values = self.sample()
        values["ocupados_manual"] = None
        values["confirmados_manual"] = None
        row = {"id": 1, **values, "leitura_amei": None, "sincronizado_em": None}
        self.assertIsNone(app.enrich(row)["ocupacao"])
        with self.assertRaises(ValueError):
            app.validate({"data": values["data"], "profissional": "A", "especialidade": "B", "situacao": "aberta", "periodos": [{"inicio": "08:00", "fim": "12:00", "intervalo": 20}], "total_manual": 2, "ocupados_manual": 3})

    def test_amei_import_appears_and_merges_with_manual_record(self):
        day = (date.today() + timedelta(days=1)).isoformat()
        month = day[:7]
        imported = {"data": day, "profissional": "Dra. Ana", "especialidade": "Cardiologia",
                    "id_profissional": "42", "id_especialidade": "7", "total": 10, "ocupados": 4,
                    "vagas": 6, "pendentes": 2, "periodos_amei": []}
        with patch.object(app.amei_connection, "scan_month", return_value={"agendas": [imported], "avisos": 0, "status": "SUCCESS"}):
            app.import_worker(month)
        rows = app.list_agendas()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fonte_ocupacao"], "Amei")
        self.assertEqual(rows[0]["ocupacao"], 40)
        self.assertEqual(rows[0]["vagas"], 6)
        values = self.sample(days=1, status="prevista")
        with app.closing(app.db()) as con, con:
            con.execute("INSERT INTO agendas (data,profissional,especialidade,situacao,periodos,atualizado_em) VALUES (?,?,?,?,?,?)",
                        (day, values["profissional"], values["especialidade"], values["situacao"], values["periodos"], "2026-10-30T10:00:00-03:00"))
        rows = app.list_agendas()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["situacao"], "aberta")
        self.assertEqual(rows[0]["origem"], "Amei + cadastro")
        self.assertEqual(rows[0]["ocupacao"], 40)
        self.assertEqual(rows[0]["id_profissional"], "42")

    def test_amei_opening_matches_prediction_by_ids_even_if_name_differs(self):
        day = (date.today() + timedelta(days=5)).isoformat()
        month = day[:7]
        values = self.sample(days=5, status="prevista")
        with app.closing(app.db()) as con, con:
            con.execute("INSERT INTO agendas (data,profissional,especialidade,situacao,periodos,id_profissional,id_especialidade,atualizado_em) VALUES (?,?,?,?,?,?,?,?)",
                        (day, "Dra. Ana", "Cardiologia", "prevista", values["periodos"], "42", "7", "2026-11-01T10:00:00-03:00"))
        imported = {"data": day, "profissional": "Dra. Ana Maria Silva", "especialidade": "Cardiologia - Amei",
                    "id_profissional": "42", "id_especialidade": "7", "total": 10, "ocupados": 4,
                    "vagas": 6, "pendentes": 2, "periodos_amei": []}
        with patch.object(app.amei_connection, "scan_month", return_value={"agendas": [imported], "avisos": 0, "status": "SUCCESS"}):
            app.import_worker(month)
        rows = app.list_agendas()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["situacao"], "aberta")
        self.assertEqual(rows[0]["origem"], "Amei + cadastro")

    def test_incomplete_import_preserves_last_complete_agendas(self):
        day = (date.today() + timedelta(days=1)).isoformat()
        month = day[:7]
        agenda = {"data": day, "profissional": "Dra. Ana", "especialidade": "Endocrinologia",
                  "id_profissional": "42", "id_especialidade": "7", "total": 15,
                  "ocupados": 6, "vagas": 9, "pendentes": 0, "periodos_amei": []}
        with patch.object(app.amei_connection, "scan_month", return_value={"agendas": [agenda], "avisos": 0, "status": "SUCCESS"}):
            app.import_worker(month)
        with patch.object(app.amei_connection, "scan_month", return_value={"agendas": [], "avisos": 1, "status": "PARTIAL"}):
            app.import_worker(month)
        self.assertEqual(len(app.list_agendas()), 1)
        self.assertIn("preservada", app.import_status()["error"])

    def test_priority_examples(self):
        day = (date.today() + timedelta(days=1)).isoformat()
        base = {"data": day, "situacao": "aberta", "ocupados": None}
        self.assertEqual(app.agenda_priority({**base, "total": 20, "vagas": 10}), "alta")
        self.assertEqual(app.agenda_priority({**base, "total": 50, "vagas": 25}), "alta")
        self.assertEqual(app.agenda_priority({**base, "total": 15, "vagas": 5}), "atencao")
        self.assertEqual(app.agenda_priority({**base, "total": 20, "vagas": 2}), "normal")

    def test_room_limit_is_per_period_and_counts_imported_agendas(self):
        day = (date.today() + timedelta(days=3)).isoformat()
        def row(number, periods, status="aberta", amei=None):
            return {"id": number, "data": day, "profissional": f"Dr. Médico {number}",
                    "situacao": status, "periodos": periods, "turnos_amei": amei or []}
        morning = [{"inicio": "08:00", "fim": "12:00", "intervalo": 20}]
        afternoon = [{"inicio": "13:00", "fim": "18:00", "intervalo": 20}]
        existing = [row(1, morning), row(2, morning), row(3, morning),
                    row(4, [], amei=[{"period": "Manhã", "total": 10}]),
                    row(99, morning, status="cancelada")]
        values = self.sample(days=3, status="prevista")
        values["data"] = day
        values["profissional"] = "Dra. Quinta"
        with patch.object(app, "list_agendas", return_value=existing):
            with self.assertRaisesRegex(ValueError, "4 médicos para 4 salas"):
                app.check_room_capacity(values)
            values["periodos"] = app.json.dumps(afternoon)
            self.assertEqual(app.check_room_capacity(values)["depois"]["tarde"], 1)
            values["periodos"] = app.json.dumps(morning)
            values["profissional"] = "Dr. Médico 1"
            self.assertEqual(app.check_room_capacity(values)["depois"]["manha"], 4)
            values["profissional"] = "Dr. Médico 4"
            self.assertEqual(app.check_room_capacity(values, agenda_id=4)["depois"]["manha"], 4)

    def test_cross_noon_uses_both_room_periods(self):
        row = {"data": "2026-11-05", "profissional": "Dra. Ana", "situacao": "prevista",
               "periodos": [{"inicio": "11:00", "fim": "14:00", "intervalo": 15}]}
        self.assertEqual(workflow.room_periods(row), {"manha", "tarde"})

    def test_larissa_uses_dedicated_room(self):
        day = "2026-11-03"
        morning = [{"inicio": "08:00", "fim": "12:00", "intervalo": 15}]
        rows = [{"data": day, "profissional": "Sra. Larissa Brandão Romanholi",
                 "id_profissional": "25123", "situacao": "aberta", "periodos": morning},
                {"data": day, "profissional": "Dra. Outra", "id_profissional": "12",
                 "situacao": "aberta", "periodos": morning}]
        rooms = app.room_usage(rows, day)
        self.assertEqual(rooms["medicos"], 1)
        self.assertEqual(rooms["manha"], 1)
        self.assertEqual(rooms["disponiveis_manha"], 3)

    def test_performance_summary_combines_clinic_team_and_schedule(self):
        month = "2026-06"
        schedules = [{"data": "2026-06-03", "id_profissional": "1", "total": 20},
                     {"data": "2026-06-03", "id_profissional": "2", "total": 15}]
        people = {"listed": 3, "checked": 2, "unverified": 1, "stale": 0,
                  "clinic": {"total": 2, "attended": 1, "absent": 1, "cancelled": 0,
                             "daily": {"2026-06-03": {"attended": 1, "absent": 1, "cancelled": 0}},
                             "byProfessional": {}},
                  "rows": {"gabriela": [{"date": "2026-06-03", "statusId": 5}],
                           "marcos": [], "thais": [{"date": "2026-06-03", "statusId": 17}]}}
        with app.closing(app.db()) as con, con:
            con.execute("INSERT INTO amei_imports(month,payload,atualizado_em,avisos,status) VALUES(?,?,?,?,?)",
                        (month, app.json.dumps(schedules), "2026-11-01T10:00:00-03:00", 0, "SUCCESS"))
            con.execute("INSERT INTO collaborators(month,payload,atualizado_em) VALUES(?,?,?)",
                        (month, app.json.dumps(people), "2026-11-01T10:00:00-03:00"))
        data = app.performance_data(month)
        self.assertEqual(data["schedules"]["slots"], 35)
        self.assertEqual(data["schedules"]["daily"]["2026-06-03"]["agendas"], 2)
        self.assertEqual(data["team"]["gabriela"]["attended"], 1)
        self.assertEqual(data["team"]["thais"]["absent"], 1)
        self.assertEqual(data["coverage"]["unverified"], 1)

    def test_performance_snapshot_without_cached_month(self):
        month = app.today_local().strftime("%Y-%m")
        self.assertIsNone(app.performance_snapshot(month)["data"])

    def test_ophthalmology_card_check_is_fresh_on_every_open(self):
        row = {"data": "2026-11-11", "id_especialidade": "661", "id_profissional": "5563",
               "especialidade": "Oftalmologia"}
        key = app.card_key(row)
        now = app.datetime.now(app.ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
        old = app.CARD_JOBS.copy()
        try:
            app.CARD_JOBS.clear()
            app.CARD_JOBS[key] = {"running": False, "error": None, "data": {"rows": []}, "updatedAt": now}
            with patch.object(app.threading, "Thread") as thread:
                job = app.start_card(row)
                self.assertTrue(job["running"])
                thread.assert_called_once()
            app.CARD_JOBS[key] = {"running": False, "error": None, "data": {"rows": []}, "updatedAt": now}
            with patch.object(app.threading, "Thread") as thread:
                job = app.start_card({**row, "especialidade": "Cardiologia"})
                self.assertFalse(job["running"])
                thread.assert_not_called()
        finally:
            app.CARD_JOBS.clear()
            app.CARD_JOBS.update(old)

    def test_import_payload_cache_follows_new_import(self):
        """O cache de payload nao pode servir leitura velha depois de uma importacao."""
        linha = {"data": "2026-11-20", "profissional": "Dra. Nova", "especialidade": "Clínica médica",
                 "id_profissional": "99", "id_especialidade": "77", "total": 10, "ocupados": 2, "vagas": 8}
        def gravar(agendas, carimbo):
            with app.closing(app.db()) as con, con:
                con.execute("""INSERT INTO amei_imports(month,payload,atualizado_em,avisos,status)
                               VALUES(?,?,?,0,'ok') ON CONFLICT(month) DO UPDATE SET
                               payload=excluded.payload, atualizado_em=excluded.atualizado_em""",
                            ("2026-11", json.dumps(agendas), carimbo))
        gravar([linha], "2026-11-03T10:00:00-03:00")
        primeiro = app.list_agendas()
        self.assertEqual([r["profissional"] for r in primeiro], ["Dra. Nova"])

        # Mesmo carimbo: pode reusar o que ja foi decodificado.
        gravar([linha, {**linha, "profissional": "Dr. Ignorado"}], "2026-11-03T10:00:00-03:00")
        self.assertEqual([r["profissional"] for r in app.list_agendas()], ["Dra. Nova"])

        # Carimbo novo: a leitura nova tem de aparecer.
        gravar([linha, {**linha, "profissional": "Dr. Recente"}], "2026-11-03T11:00:00-03:00")
        self.assertEqual(sorted(r["profissional"] for r in app.list_agendas()),
                         ["Dr. Recente", "Dra. Nova"])


    def test_find_agenda_returns_row_or_none(self):
        """Busca por id: a linha certa, e None quando o id nao existe."""
        with app.closing(app.db()) as con, con:
            con.execute("""INSERT INTO amei_imports(month,payload,atualizado_em,avisos,status)
                           VALUES(?,?,?,0,'ok')""",
                        ("2026-11", json.dumps([{"data": "2026-11-03", "profissional": "Dr. Teste",
                          "especialidade": "Angiologia", "id_profissional": "52465",
                          "id_especialidade": "614", "total": 28, "ocupados": 28, "vagas": 0}]),
                         "2026-11-03T09:00:00-03:00"))
        achada = app.find_agenda("amei:2026-11-03:614:52465")
        self.assertIsNotNone(achada)
        self.assertEqual(achada["profissional"], "Dr. Teste")
        self.assertIsNone(app.find_agenda("amei:2026-11-03:999:999"))


if __name__ == "__main__":
    unittest.main()
