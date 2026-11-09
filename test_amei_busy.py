"""A fila do Amei: leitura de tela avisa quando uma varredura de fundo esta no meio."""
import threading
import time

import amei_connection as amei


def test_leitura_de_tela_avisa_quando_ocupado():
    liberar = threading.Event()

    def varredura():
        with amei.busy():
            liberar.wait(5)

    t = threading.Thread(target=varredura, daemon=True)
    t.start()
    while not amei.LOCK.locked():
        time.sleep(0.01)
    try:
        inicio = time.monotonic()
        try:
            with amei.busy(0.2):
                raise AssertionError("nao deveria entrar enquanto a varredura roda")
        except amei.ConnectionError as e:
            assert "ocupado" in str(e)
        assert time.monotonic() - inicio < 2
    finally:
        liberar.set()
        t.join(5)


def test_varredura_de_fundo_espera_a_vez():
    with amei.busy():
        pass
    assert not amei.LOCK.locked()


def test_lock_e_liberado_quando_da_erro():
    try:
        with amei.busy(1):
            raise RuntimeError("falha")
    except RuntimeError:
        pass
    assert not amei.LOCK.locked()


def test_tela_passa_na_frente_de_varredura_na_fila():
    """Com uma varredura rodando e outras na fila, a tela e atendida primeiro."""
    soltar_primeira = threading.Event()
    ordem = []
    ordem_lock = threading.Lock()

    def fundo(nome):
        with amei.busy():
            with ordem_lock:
                ordem.append(nome)
            if nome == "fundo-1":
                soltar_primeira.wait(5)
            else:
                time.sleep(0.05)

    primeira = threading.Thread(target=fundo, args=("fundo-1",), daemon=True)
    primeira.start()
    while not amei.LOCK.locked():
        time.sleep(0.01)

    enfileiradas = [threading.Thread(target=fundo, args=(f"fundo-{i}",), daemon=True) for i in range(2, 6)]
    for t in enfileiradas:
        t.start()
    time.sleep(0.2)

    def tela():
        with amei.busy(10):
            with ordem_lock:
                ordem.append("tela")

    t_tela = threading.Thread(target=tela, daemon=True)
    t_tela.start()
    time.sleep(0.2)
    soltar_primeira.set()
    t_tela.join(10)
    for t in enfileiradas:
        t.join(10)
    primeira.join(5)

    assert ordem[0] == "fundo-1"
    assert "tela" in ordem, ordem
    assert ordem.index("tela") == 1, f"a tela deveria vir logo apos a varredura em andamento: {ordem}"
    assert not amei.LOCK.locked()
    assert amei.PENDING == 0
