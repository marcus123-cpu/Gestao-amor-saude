"""A regra de primeira consulta x sessao na psiquiatria."""
import app


def agenda(**extra):
    base = {"id": "amei:2026-11-04:678:51344", "data": "2026-11-04",
            "especialidade": "Psiquiatria", "id_profissional": "51344",
            "id_especialidade": "678"}
    base.update(extra)
    return base


def test_reconhece_agenda_de_psiquiatria():
    assert app.eh_psiquiatria(agenda()) is True
    assert app.eh_psiquiatria(agenda(especialidade="Psiquiatria - Amei")) is True
    assert app.eh_psiquiatria(agenda(especialidade="PSIQUIATRIA INFANTIL")) is True


def test_outras_especialidades_ficam_de_fora():
    for nome in ("Psicologia", "Dermatologia", "Ortopedia e traumatologia", "", None):
        assert app.eh_psiquiatria(agenda(especialidade=nome)) is False


def test_nao_confere_fora_da_psiquiatria():
    r = app.start_psychiatry(agenda(especialidade="Psicologia"))
    assert r["running"] is False
    assert "psiquiatria" in r["error"]
    assert r["data"] is None


def test_agenda_sem_ids_nao_e_conferida():
    r = app.start_psychiatry(agenda(id_profissional="", id_especialidade=""))
    assert r["running"] is False
    assert "IDs" in r["error"]


def test_chave_separa_dia_profissional_e_especialidade():
    a = app.psi_key(agenda())
    b = app.psi_key(agenda(data="2026-11-05"))
    c = app.psi_key(agenda(id_profissional="99999"))
    assert a != b and a != c
    assert a == "2026-11-04:678:51344"
