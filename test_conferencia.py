"""A conferencia em tres leituras do mes."""
import app


def leitura(attended, expected, confirmed, pessoas=None):
    p = pessoas or (attended, expected, confirmed)
    return {"appointments": {"attended": attended, "expected": expected, "confirmed": confirmed},
            "patients": {"attended": p[0], "expected": p[1], "confirmed": p[2]}}


def test_tres_leituras_iguais_fecham_o_numero():
    r = app.conferir_leituras([leitura(1030, 106, 106)] * 3)
    assert r["conferido"] is True
    assert r["leituras"] == 3
    assert r["mudou"] == []


def test_numero_que_mudou_no_meio_nao_e_dado_como_certo():
    r = app.conferir_leituras([leitura(1030, 106, 106), leitura(1031, 105, 106), leitura(1031, 105, 106)])
    assert r["conferido"] is False
    assert r["mudou"] == ["attended", "expected"]


def test_mudanca_so_em_pessoas_tambem_derruba_a_conferencia():
    r = app.conferir_leituras([leitura(1030, 106, 106, pessoas=(775, 105, 105)),
                               leitura(1030, 106, 106, pessoas=(776, 105, 105)),
                               leitura(1030, 106, 106, pessoas=(776, 105, 105))])
    assert r["conferido"] is False
    assert r["mudou"] == ["attended"]


def test_guarda_todas_as_leituras_para_auditoria():
    r = app.conferir_leituras([leitura(1, 2, 3), leitura(4, 5, 6), leitura(7, 8, 9)])
    assert [v["attended"] for v in r["valores"]] == [1, 4, 7]
    assert len(r["pessoas"]) == 3


def test_sao_tres_conferencias():
    assert app.CONFERENCIAS == 3
