"""O pulso que mantem a aba do Amei acordada."""
import amei_connection as amei


def setup_function():
    amei._QUEDA_DESDE = None
    amei.PULSO.update(estado=None, ultimo_ok=None, ultima_falha=None, recargas=0,
                      recuperacoes=0, maior_queda_s=0, queda_atual_s=0, sondagens=0, seguidas=0)


def test_mede_quanto_tempo_o_amei_ficou_sem_responder(monkeypatch):
    relogio = [1000.0]
    monkeypatch.setattr(amei.time, "monotonic", lambda: relogio[0])
    amei._marcar("ativo")
    relogio[0] += 30
    amei._marcar("travado")
    relogio[0] += 90
    amei._marcar("travado")
    relogio[0] += 30
    amei._marcar("ativo")
    assert amei.PULSO["maior_queda_s"] == 120
    assert amei.PULSO["queda_atual_s"] == 0


def test_queda_em_andamento_aparece_mesmo_sem_nova_sondagem(monkeypatch):
    relogio = [500.0]
    monkeypatch.setattr(amei.time, "monotonic", lambda: relogio[0])
    amei._marcar("travado")
    relogio[0] += 45
    assert amei.pulso()["queda_atual_s"] == 45


def test_sondagem_nao_roda_quando_a_tela_esta_esperando(monkeypatch):
    chamou = []
    monkeypatch.setattr(amei, "run_code", lambda *a, **k: chamou.append(a) or {"estado": "ativo"})
    with amei.GATE:
        amei.PENDING += 1
    try:
        assert amei.heartbeat() == {"estado": "ocupado"}
        assert chamou == []
    finally:
        with amei.GATE:
            amei.PENDING -= 1
            amei.GATE.notify_all()


APP = "https://amei.amorsaude.com.br/schedule/schedule-appointment"
LOGIN = "https://amei.amorsaude.com.br/login"


def test_pagina_travada_leva_f5_e_nova_sondagem(monkeypatch):
    respostas = [{"estado": "travado", "url": APP}, {"estado": "recarregado"}, {"estado": "ativo", "url": APP}]
    monkeypatch.setattr(amei, "run_code", lambda *a, **k: respostas.pop(0))
    assert amei.heartbeat() == {"estado": "ativo"}
    assert amei.PULSO["recargas"] == 1
    assert respostas == []
    assert not amei.LOCK.locked()


def test_sessao_expirada_volta_sozinha_com_f5(monkeypatch):
    """Conferido ao vivo no Amei: 401 antes do F5, 200 depois."""
    respostas = [{"estado": "login", "url": APP}, {"estado": "recarregado"}, {"estado": "ativo", "url": APP}]
    monkeypatch.setattr(amei, "run_code", lambda *a, **k: respostas.pop(0))
    assert amei.heartbeat() == {"estado": "ativo"}
    assert amei.PULSO["recuperacoes"] == 1
    assert amei.PULSO["seguidas"] == 0


def test_nao_recarrega_por_cima_de_um_login_humano(monkeypatch):
    respostas = [{"estado": "login", "url": LOGIN}]
    monkeypatch.setattr(amei, "run_code", lambda *a, **k: respostas.pop(0))
    assert amei.heartbeat() == {"estado": "login"}
    assert amei.PULSO["recargas"] == 0
    assert respostas == []


def test_para_de_insistir_quando_o_f5_nao_resolve(monkeypatch):
    def sempre(*a, **k):
        return {"estado": "login", "url": APP} if "reload" not in str(a) else {"estado": "recarregado"}
    monkeypatch.setattr(amei, "run_code", lambda code, **k: {"estado": "recarregado"} if "reload" in code else {"estado": "login", "url": APP})
    for _ in range(amei.MAX_RECARGAS_SEGUIDAS):
        assert amei.heartbeat() == {"estado": "login"}
    assert amei.PULSO["recargas"] == amei.MAX_RECARGAS_SEGUIDAS
    # Daqui em diante para de dar F5: so a pessoa resolve.
    assert amei.heartbeat() == {"estado": "login"}
    assert amei.PULSO["recargas"] == amei.MAX_RECARGAS_SEGUIDAS


def test_lock_e_liberado_quando_a_sondagem_falha(monkeypatch):
    def explode(*a, **k):
        raise amei.ConnectionError("sem resposta")
    monkeypatch.setattr(amei, "run_code", explode)
    assert amei.heartbeat() == {"estado": "sem_resposta"}
    assert not amei.LOCK.locked()
    assert amei.PULSO["ultima_falha"]
