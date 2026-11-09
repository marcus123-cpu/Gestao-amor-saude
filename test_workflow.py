from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import app
import workflow


import contextlib


@contextlib.contextmanager
def closing_db():
    """Solta a conexao da thread no fim, senao o Windows nao apaga o banco temporario."""
    try:
        yield
    finally:
        app.close_connection()


def agenda(day, professional="Dra. Mayara", professional_id="17784", status="aberta", **extra):
    return {"id": f"{professional_id}:{day}", "data": day, "profissional": professional,
            "id_profissional": professional_id, "especialidade": "Clínica médica",
            "situacao": status, "periodos": [], "turnos_amei": [], "prioridade": None,
            "total": 20, "ocupados": 20, "vagas": 0, **extra}


def test_fixed_weekday_missing_and_month_reading_gate():
    today = date(2026, 11, 4)  # quarta-feira
    rule = {"id": "17784", "name": "Dra. Mayara", "weekdays": [2], "enabled": True}
    imports = {"2026-11": datetime.now(timezone.utc)}
    tasks = workflow.build_tasks([agenda("2026-11-04")], today, imports, {}, [rule])
    assert any(t["key"] == "fixo:17784:2026-11-11" for t in tasks)
    assert not any(t["key"] == "fixo:17784:2026-11-04" for t in tasks)
    opened = workflow.build_tasks([agenda("2026-11-04"), agenda("2026-11-11")], today, imports, {}, [rule])
    assert not any(t["key"] == "fixo:17784:2026-11-11" for t in opened)
    unknown = workflow.build_tasks([agenda("2026-11-04")], today, {}, {}, [rule])
    assert any(t["kind"] == "leitura" for t in unknown)
    assert not any(t["kind"] == "fixo" for t in unknown)


def test_twenty_day_return_suggestion_stops_when_new_date_exists():
    today = date(2026, 11, 1)
    old = [agenda("2026-09-25", "Sra. Taiza", "42"),
           agenda("2026-10-09", "Sra. Taiza", "42")]
    tasks = workflow.build_tasks(old, today, {}, {}, [])
    reminder = next(t for t in tasks if t["kind"] == "retorno")
    assert "23 dias" in reminder["detail"]
    future = workflow.build_tasks(old + [agenda("2026-11-10", "Sra. Taiza", "42")], today, {}, {}, [])
    assert not any(t["kind"] == "retorno" for t in future)


def test_tomorrow_confirmation_gap_and_vacancies():
    today = date(2026, 11, 1)
    row = agenda("2026-11-02", professional="Dr. Outro", professional_id="7")
    row.update(prioridade="alta", vagas=10, ocupados=10)
    metrics = {"2026-11": {"daily": [{"date": "2026-11-02", "expected": 12, "confirmed": 4}]}}
    tasks = workflow.build_tasks([row], today, {}, metrics, [])
    assert any(t["kind"] == "vagas" and "10 horário" in t["detail"] for t in tasks)
    assert any(t["kind"] == "confirmacao" and "8 de 12" in t["detail"] for t in tasks)


def test_unresolved_action_returns_next_day():
    today = date(2026, 11, 4)
    row = agenda("2026-11-05", professional="Dr. Outro", professional_id="7")
    row.update(prioridade="alta", vagas=10, ocupados=10)
    with TemporaryDirectory() as tmp, closing_db(), patch.object(app, "DB", Path(tmp)/"agendas.sqlite3"), \
         patch.object(app, "today_local", return_value=today), patch.object(app, "list_agendas", return_value=[row]):
        key = f"vagas:{row['id']}"
        with app.closing(app.db()) as con, con:
            con.execute("INSERT INTO workflow_status(task_key,status,owner,updated_at) VALUES(?,?,?,?)",
                        (key, "em_andamento", "Call center", "2026-11-03T14:00:00-03:00"))
        task = next(t for t in app.workflow_snapshot()["tasks"] if t["key"] == key)
        assert task["status"] == "pendente"
        assert task["followup"] is True
        assert task["owner"] == "Call center"


def sala(day, nome, pid, inicio="08:00", fim="12:00", status="aberta"):
    return {"id": f"{pid}:{day}:{inicio}", "data": day, "profissional": nome,
            "id_profissional": pid, "especialidade": "Clínica médica", "situacao": status,
            "periodos": [{"inicio": inicio, "fim": fim, "intervalo": 15}],
            "turnos_amei": [], "prioridade": None, "total": 20, "ocupados": 20, "vagas": 0}


def test_quem_tem_sala_propria_nao_ocupa_as_quatro():
    """A Larissa tem sala propria: cinco nomes, mas so quatro disputam as salas."""
    dia = "2026-11-04"
    agendas = [sala(dia, f"Dra. Médica {i}", str(100 + i)) for i in range(4)]
    agendas.append(sala(dia, "Sra. Larissa Brandão Romanholi", "25123"))
    uso = workflow.room_usage(agendas, dia)
    assert uso["manha"] == 4
    assert uso["disponiveis_manha"] == 0
    assert uso["medicos"] == 4


def test_sala_propria_reconhecida_pelo_nome_mesmo_sem_id():
    dia = "2026-11-04"
    uso = workflow.room_usage([sala(dia, "Sra. Larissa Brandao Romanholi", "")], dia)
    assert uso["manha"] == 0


def test_manha_cheia_nao_ocupa_a_tarde():
    dia = "2026-11-04"
    manha = [sala(dia, f"Dra. Médica {i}", str(200 + i), "08:00", "12:00") for i in range(4)]
    uso = workflow.room_usage(manha, dia)
    assert uso["disponiveis_manha"] == 0
    assert uso["disponiveis_tarde"] == workflow.ROOM_LIMIT


def test_aviso_de_sala_so_aparece_quando_passa_do_limite():
    dia = "2026-11-04"
    hoje = date(2026, 11, 4)
    quatro = [sala(dia, f"Dra. Médica {i}", str(300 + i)) for i in range(4)]
    assert not any(t["kind"] == "salas" for t in workflow.build_tasks(quatro, hoje, {}, {}, []))
    cinco = quatro + [sala(dia, "Dra. Quinta", "399")]
    avisos = [t for t in workflow.build_tasks(cinco, hoje, {}, {}, []) if t["kind"] == "salas"]
    assert len(avisos) == 1
    assert "5 profissionais para 4 salas" in avisos[0]["detail"]
    # A Larissa entrando nao pode gerar aviso: ela nao usa sala comum.
    comLarissa = quatro + [sala(dia, "Sra. Larissa Brandão Romanholi", "25123")]
    assert not any(t["kind"] == "salas" for t in workflow.build_tasks(comLarissa, hoje, {}, {}, []))


def test_app_e_workflow_contam_salas_do_mesmo_jeito():
    """Regra unica: a Visao geral e os avisos nao podem divergir."""
    dia = "2026-11-04"
    agendas = [sala(dia, f"Dra. Médica {i}", str(400 + i)) for i in range(3)]
    agendas.append(sala(dia, "Sra. Larissa Brandão Romanholi", "25123"))
    assert app.room_usage(agendas, dia) == workflow.room_usage(agendas, dia)


def test_prevision_reminder_starts_five_days_before():
    """O lembrete comeca cinco dias antes e some quando a agenda abre."""
    today = date(2026, 11, 3)

    def prevista(offset):
        day = (today + timedelta(days=offset)).isoformat()
        return agenda(day, "Dra. Mayara", "17784", status="prevista")

    keys = {t["key"] for t in workflow.build_tasks([prevista(5), prevista(6)], today, {}, {}, [])
            if t["kind"] == "previsao"}
    assert f"previsao:17784:{(today + timedelta(days=5)).isoformat()}" in keys
    assert f"previsao:17784:{(today + timedelta(days=6)).isoformat()}" not in keys

    # Ja aberta no Amei: nao e mais previsao, entao nao cobra abertura.
    aberta = agenda((today + timedelta(days=5)).isoformat(), "Dra. Mayara", "17784")
    assert not any(t["kind"] == "previsao" for t in workflow.build_tasks([aberta], today, {}, {}, []))


def test_dashboard_prevision_alert_uses_same_five_day_window():
    today = date(2026, 11, 25)
    five = agenda("2026-11-30", status="prevista")
    six = agenda("2026-12-01", status="prevista")
    with patch.object(app, "today_local", return_value=today):
        alerts = app.dashboard([five, six])["alertas"]
    assert len(alerts) == 1
    assert alerts[0]["data"] == "2026-11-30"
    assert alerts[0]["acao"] == "Abrir no Amei"


def test_today_alert_expires_at_six_and_old_history_stays_hidden():
    today = date(2026, 11, 9)
    assert app.alert_is_active("2026-11-09", today, 17)
    assert not app.alert_is_active("2026-11-09", today, 18)
    assert not app.alert_is_active("2026-11-08", today, 9)
    assert app.alert_is_active("2026-11-10", today, 18)

    class Evening(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 9, 18, 0, tzinfo=tz)

    old = agenda("2026-11-09", professional_id="1", status="prevista")
    future = agenda("2026-11-10", professional_id="2", status="prevista")
    with TemporaryDirectory() as tmp, closing_db(), patch.object(app, "DB", Path(tmp)/"agendas.sqlite3"), \
         patch.object(app, "datetime", Evening), patch.object(app, "list_agendas", return_value=[old, future]):
        assert [alert["data"] for alert in app.dashboard([old, future])["alertas"]] == ["2026-11-10"]
        with app.closing(app.db()) as con, con:
            con.execute("INSERT INTO workflow_status(task_key,status,owner,updated_at,title,detail,task_date) VALUES(?,?,?,?,?,?,?)",
                        ("antigo", "concluido", "Jéssica", "2026-11-09T10:00:00-03:00", "Aviso antigo", "", "2026-11-09"))
        snapshot = app.workflow_snapshot()
        assert all(task["date"] > "2026-11-09" for task in snapshot["tasks"])
        assert not snapshot["history"]
        assert snapshot["pending"] == sum(task["status"] == "pendente" for task in snapshot["tasks"])
