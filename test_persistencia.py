"""A varredura de colaboradores precisa sobreviver a um reinicio do painel."""
import json
import app
from contextlib import closing


def test_varredura_guardada_volta_depois_do_reinicio(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DB", tmp_path / "teste.sqlite3", raising=False)
    dados = {"month": "2026-10", "listed": 1969, "checked": 1969, "unverified": 0,
             "rows": {"gabriela": [], "marcos": [], "thais": []}}
    with closing(app.db()) as con, con:
        con.execute("INSERT INTO collaborators(month,payload,atualizado_em) VALUES(?,?,?)",
                    ("2026-10", json.dumps(dados), "2026-10-30T21:55:00-03:00"))
    app.COLLAB_JOBS.clear()  # simula o processo tendo acabado de subir
    snap = app.collaborator_snapshot("2026-10")
    assert snap["data"]["checked"] == 1969
    assert snap["updatedAt"] == "2026-10-30T21:55:00-03:00"
    assert snap["running"] is False


def test_payload_corrompido_nao_derruba_o_painel(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DB", tmp_path / "teste2.sqlite3", raising=False)
    with closing(app.db()) as con, con:
        con.execute("INSERT INTO collaborators(month,payload,atualizado_em) VALUES(?,?,?)",
                    ("2026-09", "{nao e json", "2026-09-30T10:00:00-03:00"))
    app.COLLAB_JOBS.clear()
    snap = app.collaborator_snapshot("2026-09")
    assert snap["data"] is None
    assert snap["running"] is False


def test_mes_sem_varredura_volta_vazio(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DB", tmp_path / "teste3.sqlite3", raising=False)
    app.COLLAB_JOBS.clear()
    snap = app.collaborator_snapshot("2026-08")
    assert snap["data"] is None
