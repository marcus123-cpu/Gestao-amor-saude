"""Painel local de controle de agendas. Apenas dados operacionais, sem pacientes."""
from __future__ import annotations

import gzip
import json
import os
import re
import sqlite3
import sys
import threading
import traceback
import unicodedata
from contextlib import closing
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo

import amei_connection
import workflow
# Regra das salas mora no workflow: Visão geral, previsões e avisos usam a mesma conta.
from workflow import ROOM_LIMIT, room_usage

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
_DEFAULT_DATA = Path(os.environ.get("LOCALAPPDATA", str(ROOT))) / "AgendaClara" / "data" if getattr(sys, "frozen", False) else ROOT / "data"
DATA_ROOT = Path(os.environ.get("AGENDA_CLARA_DATA_DIR", str(_DEFAULT_DATA)))
DB = DATA_ROOT / "agendas.sqlite3"
AMEI_ROOT = Path(os.environ.get("AMEI_BOT_DIR", str(ROOT / "bot" if (ROOT / "bot").is_dir() else Path.home() / "Documents" / "bot amei" / "Bot-amei-")))
STATUSES = {"prevista", "aberta", "adiada", "cancelada", "realizada"}
ROOM_SAVE_LOCK = threading.Lock()
IMPORT_LOCK = threading.Lock()
IMPORT_JOB = {"running": False, "month": None, "error": None, "result": None}
METRICS_LOCK = threading.Lock()
METRICS_JOB = {"running": False, "month": None, "phase": None, "error": None}
DIAG_LOCK = threading.Lock()
DIAG_JOBS = {}
PSI_LOCK = threading.Lock()
PSI_JOBS = {}
CARD_LOCK = threading.Lock()
CARD_JOBS = {}
# Especialidades em que a cobranca muda entre primeira consulta e sessao.
PSI_PADRAO = re.compile(r"psiquiatr", re.I)
COLLAB_LOCK = threading.Lock()
COLLAB_JOBS = {}
PERFORMANCE_LOCK = threading.Lock()
PERFORMANCE_JOBS = {}


def today_local():
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date()


def alert_is_active(day, today, hour):
    """Avisos de hoje vencem às 18h; os de datas anteriores já venceram."""
    return bool(day) and (day > today.isoformat() or day == today.isoformat() and hour < 18)


def br_date(iso):
    """Data no formato que a clínica lê: dia/mes/ano."""
    try:
        return date.fromisoformat(iso).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return str(iso)


def build_schema(con):
    """Cria e migra as tabelas. Roda uma vez no boot, nao a cada requisicao."""
    con.execute("""CREATE TABLE IF NOT EXISTS agendas (
        id INTEGER PRIMARY KEY, data TEXT NOT NULL, profissional TEXT NOT NULL,
        especialidade TEXT NOT NULL, situacao TEXT NOT NULL DEFAULT 'prevista',
        periodos TEXT NOT NULL, id_profissional TEXT, id_especialidade TEXT,
        total_manual INTEGER, ocupados_manual INTEGER, confirmados_manual INTEGER,
        observacoes TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL,
        leitura_amei TEXT, sincronizado_em TEXT
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS amei_imports (
        month TEXT PRIMARY KEY, payload TEXT NOT NULL, atualizado_em TEXT NOT NULL,
        avisos INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS monthly_metrics (
        month TEXT PRIMARY KEY, payload TEXT NOT NULL, atualizado_em TEXT NOT NULL
    )""")
    # Colaboradores tambem em disco: uma varredura leva minutos e nao pode
    # morrer junto com o processo.
    con.execute("""CREATE TABLE IF NOT EXISTS collaborators (
        month TEXT PRIMARY KEY, payload TEXT NOT NULL, atualizado_em TEXT NOT NULL
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS workflow_status (
        task_key TEXT PRIMARY KEY, status TEXT NOT NULL, owner TEXT NOT NULL,
        updated_at TEXT NOT NULL, title TEXT, detail TEXT, task_date TEXT
    )""")
    existing_workflow_columns = {r[1] for r in con.execute("PRAGMA table_info(workflow_status)")}
    for column in ("title", "detail", "task_date"):
        if column not in existing_workflow_columns:
            con.execute(f"ALTER TABLE workflow_status ADD COLUMN {column} TEXT")
    con.execute("""CREATE TABLE IF NOT EXISTS fixed_rules (
        professional_id TEXT PRIMARY KEY, name TEXT NOT NULL, specialty TEXT NOT NULL,
        weekdays TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    )""")
    for professional_id, name, specialty, weekdays in workflow.FIXED_DEFAULTS:
        con.execute("""INSERT OR IGNORE INTO fixed_rules
                       (professional_id,name,specialty,weekdays,enabled) VALUES(?,?,?,?,1)""",
                    (professional_id, name, specialty, json.dumps(weekdays)))
    con.commit()


_THREAD = threading.local()


class _SharedConnection:
    """Entrega a conexao da thread e ignora o close() dos chamadores.

    Antes cada requisicao abria uma conexao nova e repetia PRAGMA journal_mode=WAL
    mais o CREATE TABLE de tudo: 2,7 ms de preparo para uma consulta de 0,01 ms, e
    picos de mais de um segundo quando varias chegavam juntas. O schema agora e
    criado no boot e a conexao fica viva com a thread.
    """

    def __init__(self, con):
        self._con = con

    def __getattr__(self, name):
        return getattr(self._con, name)

    def __enter__(self):
        return self._con.__enter__()

    def __exit__(self, *info):
        return self._con.__exit__(*info)

    def close(self):
        pass


_SCHEMA_LOCK = threading.Lock()
_SCHEMA_READY = set()


def db():
    """Conexao da thread para o banco atual; o schema e preparado uma vez por arquivo."""
    path = str(DB)
    con = getattr(_THREAD, "con", None)
    if con is not None and getattr(_THREAD, "path", None) != path:
        con.close()
        con = None
    if con is None:
        DB.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(path, check_same_thread=False)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=5000")
        with _SCHEMA_LOCK:
            if path not in _SCHEMA_READY:
                con.execute("PRAGMA journal_mode=WAL")
                build_schema(con)
                _SCHEMA_READY.add(path)
        _THREAD.con, _THREAD.path = con, path
    return _SharedConnection(con)


def close_connection():
    """Solta a conexao desta thread; usado por testes que apagam o banco temporario."""
    con = getattr(_THREAD, "con", None)
    if con is not None:
        con.close()
        _THREAD.con = _THREAD.path = None


def validate(payload):
    try:
        d = date.fromisoformat(str(payload["data"]))
        professional = str(payload["profissional"]).strip()
        specialty = str(payload["especialidade"]).strip()
        status = str(payload.get("situacao", "prevista"))
        periods = payload.get("periodos", [])
        if not professional or not specialty or status not in STATUSES or not isinstance(periods, list) or not periods:
            raise ValueError()
        clean_periods = []
        for p in periods:
            start = datetime.strptime(p["inicio"], "%H:%M")
            end = datetime.strptime(p["fim"], "%H:%M")
            interval = int(p["intervalo"])
            if end <= start or not 5 <= interval <= 180:
                raise ValueError()
            clean_periods.append({"inicio": start.strftime("%H:%M"), "fim": end.strftime("%H:%M"), "intervalo": interval})
        values = {}
        for key in ("total_manual", "ocupados_manual", "confirmados_manual"):
            raw = payload.get(key)
            values[key] = None if raw in (None, "") else int(raw)
            if values[key] is not None and values[key] < 0:
                raise ValueError()
        total, occupied, confirmed = (values[k] for k in ("total_manual", "ocupados_manual", "confirmados_manual"))
        if total is not None and occupied is not None and occupied > total:
            raise ValueError()
        if confirmed is not None and occupied is not None and confirmed > occupied:
            raise ValueError()
        return {"data": d.isoformat(), "profissional": professional[:120], "especialidade": specialty[:120],
                "situacao": status, "periodos": json.dumps(clean_periods, ensure_ascii=False),
                "id_profissional": str(payload.get("id_profissional") or "").strip()[:40],
                "id_especialidade": str(payload.get("id_especialidade") or "").strip()[:40],
                "observacoes": str(payload.get("observacoes") or "").strip()[:1000], **values}
    except (KeyError, TypeError, ValueError, OverflowError):
        raise ValueError("Confira data, profissional, especialidade, turnos e quantidades.") from None


def enrich(row):
    item = dict(row)
    item["periodos"] = json.loads(item["periodos"])
    item["leitura_amei"] = json.loads(item["leitura_amei"]) if item["leitura_amei"] else None
    estimated = sum(max(0, (datetime.strptime(p["fim"], "%H:%M") - datetime.strptime(p["inicio"], "%H:%M")).seconds // 60 // p["intervalo"]) for p in item["periodos"])
    item["capacidade_prevista"] = estimated
    reading = item["leitura_amei"] if item["situacao"] == "aberta" else None
    item["total"] = reading["total"] if reading else item["total_manual"]
    item["ocupados"] = reading["ocupados"] if reading else item["ocupados_manual"]
    item["vagas"] = reading.get("vagas") if reading else None
    item["encaixes"] = reading.get("encaixes") if reading else None
    item["confirmados"] = item["confirmados_manual"]
    item["fonte_ocupacao"] = "Amei" if reading else ("Manual" if item["ocupados"] is not None else None)
    item["ocupacao"] = round(item["ocupados"] / item["total"] * 100) if item["total"] and item["ocupados"] is not None else None
    return item


def list_agendas():
    with closing(db()) as con:
        local = [enrich(r) for r in con.execute("SELECT * FROM agendas ORDER BY data, profissional, id")]
        imports = [dict(r) for r in con.execute("SELECT month,atualizado_em FROM amei_imports")]
    # Os payloads do Amei sao dezenas de KB de JSON e mudam so quando ha importacao.
    # Guardamos o resultado ja decodificado, com o proprio atualizado_em como senha.
    for entry in imports:
        entry["agendas"] = import_payload(entry["month"], entry["atualizado_em"])
    def norm(s):
        s = unicodedata.normalize("NFD", str(s).casefold())
        return " ".join("".join(c for c in s if not unicodedata.combining(c)).replace("dra.", "").replace("dr.", "").split())
    by_name = {(r["data"], norm(r["profissional"]), norm(r["especialidade"])): r
               for r in local if r["situacao"] in ("prevista", "aberta")}
    by_ids = {(r["data"], str(r["id_profissional"]), str(r["id_especialidade"])): r
              for r in local if r["situacao"] in ("prevista", "aberta")
              and r.get("id_profissional") and r.get("id_especialidade")}
    for entry in imports:
        for a in entry["agendas"]:
            key = (a["data"], norm(a["profissional"]), norm(a["especialidade"]))
            ids = (a["data"], str(a["id_profissional"]), str(a["id_especialidade"]))
            manual = by_ids.get(ids) or by_name.get(key)
            reading = {k: a.get(k) for k in ("total", "ocupados", "vagas", "pendentes", "encaixes")}
            if manual:
                manual.update(situacao="aberta", leitura_amei=reading, sincronizado_em=entry["atualizado_em"],
                              id_profissional=a["id_profissional"], id_especialidade=a["id_especialidade"],
                              total=a["total"], ocupados=a["ocupados"], vagas=a["vagas"],
                              encaixes=a.get("encaixes"), fonte_ocupacao="Amei",
                              ocupacao=round(a["ocupados"] / a["total"] * 100) if a["total"] else None,
                              origem="Amei + cadastro", turnos_amei=a.get("periodos_amei", []))
                continue
            row = {"id": "amei:" + a["data"] + ":" + a["id_especialidade"] + ":" + a["id_profissional"],
                   "data": a["data"], "profissional": a["profissional"], "especialidade": a["especialidade"],
                   "situacao": "aberta", "periodos": [], "id_profissional": a["id_profissional"],
                   "id_especialidade": a["id_especialidade"], "total_manual": None, "ocupados_manual": None,
                   "confirmados_manual": None, "confirmados": None, "observacoes": "", "atualizado_em": entry["atualizado_em"],
                   "leitura_amei": reading, "sincronizado_em": entry["atualizado_em"],
                   "capacidade_prevista": a["total"], "total": a["total"], "ocupados": a["ocupados"],
                   "ocupacao": round(a["ocupados"] / a["total"] * 100) if a["total"] else None,
                   "vagas": a["vagas"], "encaixes": a.get("encaixes"),
                   "fonte_ocupacao": "Amei", "origem": "Amei", "turnos_amei": a.get("periodos_amei", [])}
            local.append(row)
    # Um unico "hoje" para todas as linhas: com uma leitura por linha, uma requisicao
    # que atravessasse a meia-noite classificaria linhas contra dias diferentes.
    today = today_local()
    for row in local:
        row["prioridade"] = agenda_priority(row, today)
    return sorted(local, key=lambda r: (r["data"], r["profissional"], str(r["id"])))


_PAYLOAD_CACHE = {}
_PAYLOAD_LOCK = threading.Lock()


def import_payload(month, updated_at):
    """Agendas importadas do Amei, decodificadas uma vez por importacao."""
    with _PAYLOAD_LOCK:
        cached = _PAYLOAD_CACHE.get(month)
        if cached and cached[0] == updated_at:
            return cached[1]
    with closing(db()) as con:
        row = con.execute("SELECT payload FROM amei_imports WHERE month=?", (month,)).fetchone()
    agendas = json.loads(row["payload"]) if row else []
    with _PAYLOAD_LOCK:
        _PAYLOAD_CACHE[month] = (updated_at, agendas)
    return agendas


def find_agenda(row_id):
    """Uma agenda pelo id, num ponto so em vez de repetir a busca em cada handler."""
    row_id = str(row_id)
    return next((r for r in list_agendas() if str(r["id"]) == row_id), None)


def check_room_capacity(values, agenda_id=None):
    if values["situacao"] not in ("aberta", "prevista"):
        return None
    rows = list_agendas()
    day = values["data"]
    before = room_usage(rows, day)
    candidate = {**values, "id": agenda_id or "nova", "periodos": json.loads(values["periodos"])}
    after = room_usage([r for r in rows if r["id"] != agenda_id] + [candidate], day)
    for period, label in (("manha", "manhã"), ("tarde", "tarde")):
        if after[period] > ROOM_LIMIT and after[period] > before[period]:
            raise ValueError(f"Não dá para salvar: {label} de {br_date(day)} já tem {before[period]} médicos para {ROOM_LIMIT} salas. Escolha outro período ou dia.")
    return {"antes": before, "depois": after}


def agenda_priority(row, today=None):
    today = today or today_local()
    if row["situacao"] != "aberta" or row["data"] < today.isoformat():
        return None
    total = row.get("total")
    free = row.get("vagas")
    if free is None and total is not None and row.get("ocupados") is not None:
        free = max(0, total - row["ocupados"])
    if not total or free is None:
        return None
    ratio = free / total
    if (free >= 10 and ratio >= .45) or (free >= 8 and ratio >= .65):
        return "alta"
    if free >= 2 and ratio >= .25:
        return "atencao"
    return "normal"


CONFERENCIAS = 3


def conferir_leituras(leituras):
    """Compara leituras repetidas do mês.

    Só marca 'conferido' quando todas as leituras devolvem exatamente os mesmos totais.
    Se algum número mudou no meio, diz qual mudou em vez de escolher um e apresentá-lo
    como certo: entre uma leitura e outra um paciente pode ter sido atendido de verdade.
    """
    chaves = ("attended", "expected", "confirmed")
    valores = [{k: int(l["appointments"][k]) for k in chaves} for l in leituras]
    pessoas = [{k: int(l["patients"][k]) for k in chaves} for l in leituras]
    mudou = sorted({k for k in chaves
                    if len({v[k] for v in valores}) > 1 or len({p[k] for p in pessoas}) > 1})
    return {"leituras": len(leituras), "conferido": not mudou, "mudou": mudou,
            "valores": valores, "pessoas": pessoas}


def metrics_worker(month):
    try:
        with METRICS_LOCK:
            METRICS_JOB["phase"] = "agendas"
        scan = amei_connection.scan_month(month)
        if scan["avisos"]:
            raise RuntimeError("A leitura de agendas teve avisos. Os dados anteriores foram preservados para evitar uma lista parcial.")
        timestamp = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="microseconds")
        with closing(db()) as con, con:
            con.execute("""INSERT INTO amei_imports(month,payload,atualizado_em,avisos,status)
                           VALUES(?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET
                           payload=excluded.payload,atualizado_em=excluded.atualizado_em,
                           avisos=excluded.avisos,status=excluded.status""",
                        (month, json.dumps(scan["agendas"], ensure_ascii=False), timestamp,
                         scan["avisos"], scan["status"]))
        # Três leituras independentes: o número do mês só é dado como fechado se as três baterem.
        leituras = []
        for tentativa in range(1, CONFERENCIAS + 1):
            with METRICS_LOCK:
                METRICS_JOB["phase"] = f"atendimentos (conferência {tentativa} de {CONFERENCIAS})"
            leituras.append(amei_connection.scan_metrics(month, scan["agendas"], today_local()))
        metrics = leituras[-1]
        metrics["conferencia"] = conferir_leituras(leituras)
        with closing(db()) as con, con:
            con.execute("""INSERT INTO monthly_metrics(month,payload,atualizado_em) VALUES(?,?,?)
                           ON CONFLICT(month) DO UPDATE SET payload=excluded.payload,atualizado_em=excluded.atualizado_em""",
                        (month, json.dumps(metrics, ensure_ascii=False), timestamp))
        with METRICS_LOCK:
            METRICS_JOB.update(running=False, phase=None, error=None)
    except Exception as exc:
        with METRICS_LOCK:
            METRICS_JOB.update(running=False, phase=None, error=str(exc))


def metrics_snapshot(month):
    with closing(db()) as con:
        row = con.execute("SELECT payload,atualizado_em FROM monthly_metrics WHERE month=?", (month,)).fetchone()
    with METRICS_LOCK:
        job = dict(METRICS_JOB) if METRICS_JOB["month"] == month else {"running": False, "month": month, "phase": None, "error": None}
    return {"month": month, "data": json.loads(row["payload"]) if row else None,
            "updatedAt": row["atualizado_em"] if row else None, "job": job}


def diagnosis_key(row):
    return f"{today_local():%Y-%m}:{row['id_especialidade']}:{row['id_profissional']}"


def diagnosis_worker(key, row):
    try:
        data = amei_connection.scan_diagnosis(today_local().strftime("%Y-%m"), today_local(),
                                              row["id_profissional"], row["id_especialidade"])
        with DIAG_LOCK:
            DIAG_JOBS[key].update(running=False, data=data, error=None,
                                  updatedAt=datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds"))
    except Exception as exc:
        with DIAG_LOCK:
            DIAG_JOBS[key].update(running=False, error=str(exc))


def start_diagnosis(row):
    if not row.get("id_profissional") or not row.get("id_especialidade"):
        return {"running": False, "error": "Esta agenda não tem IDs para o diagnóstico.", "data": None}
    key = diagnosis_key(row)
    with DIAG_LOCK:
        job = DIAG_JOBS.get(key)
        if job and (job["running"] or (job.get("updatedAt") and
                    (datetime.now(ZoneInfo("America/Sao_Paulo")) - datetime.fromisoformat(job["updatedAt"])).total_seconds() < 1800)):
            return dict(job)
        DIAG_JOBS[key] = {"running": True, "error": None, "data": job.get("data") if job else None,
                          "updatedAt": job.get("updatedAt") if job else None}
    threading.Thread(target=diagnosis_worker, args=(key, row), daemon=True).start()
    return dict(DIAG_JOBS[key])


def eh_psiquiatria(row):
    """A regra de primeira consulta x sessao vale para a psiquiatria."""
    return bool(PSI_PADRAO.search(str(row.get("especialidade") or "")))


def psi_key(row):
    return f"{row['data']}:{row['id_especialidade']}:{row['id_profissional']}"


def psi_worker(key, row):
    try:
        data = amei_connection.scan_psychiatry(row["data"], row["id_profissional"], row["id_especialidade"])
        with PSI_LOCK:
            PSI_JOBS[key].update(running=False, data=data, error=None,
                                 updatedAt=datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds"))
    except Exception as exc:
        with PSI_LOCK:
            PSI_JOBS[key].update(running=False, error=str(exc))


def start_psychiatry(row):
    if not eh_psiquiatria(row):
        return {"running": False, "error": "Esta conferência vale para agendas de psiquiatria.", "data": None}
    if not row.get("id_profissional") or not row.get("id_especialidade"):
        return {"running": False, "error": "Esta agenda não tem IDs para a conferência.", "data": None}
    key = psi_key(row)
    with PSI_LOCK:
        job = PSI_JOBS.get(key)
        if job and (job["running"] or (job.get("updatedAt") and
                    (datetime.now(ZoneInfo("America/Sao_Paulo")) - datetime.fromisoformat(job["updatedAt"])).total_seconds() < 900)):
            return dict(job)
        PSI_JOBS[key] = {"running": True, "error": None, "data": job.get("data") if job else None,
                         "updatedAt": job.get("updatedAt") if job else None}
    threading.Thread(target=psi_worker, args=(key, row), daemon=True).start()
    return dict(PSI_JOBS[key])


def card_key(row):
    return f"{row['data']}:{row['id_especialidade']}:{row['id_profissional']}"


def card_worker(key, row):
    try:
        data = amei_connection.scan_card(row["data"], row["id_profissional"], row["id_especialidade"])
        with CARD_LOCK:
            CARD_JOBS[key].update(running=False, data=data, error=None,
                                  updatedAt=datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds"))
    except Exception as exc:
        with CARD_LOCK:
            CARD_JOBS[key].update(running=False, error=str(exc))


def start_card(row):
    """Vale para qualquer especialidade: todo paciente tem (ou nao) Cartao de Todos."""
    if not row.get("id_profissional") or not row.get("id_especialidade"):
        return {"running": False, "error": "Esta agenda não tem IDs para a conferência.", "data": None}
    key = card_key(row)
    oftalmo = "oftalm" in str(row.get("especialidade") or "").casefold()
    with CARD_LOCK:
        job = CARD_JOBS.get(key)
        if job and (job["running"] or (not oftalmo and job.get("updatedAt") and
                    (datetime.now(ZoneInfo("America/Sao_Paulo")) - datetime.fromisoformat(job["updatedAt"])).total_seconds() < 900)):
            return dict(job)
        CARD_JOBS[key] = {"running": True, "error": None, "data": job.get("data") if job else None,
                          "updatedAt": job.get("updatedAt") if job else None}
    threading.Thread(target=card_worker, args=(key, row), daemon=True).start()
    return dict(CARD_JOBS[key])


def collaborator_worker(month):
    try:
        data = amei_connection.scan_collaborators(month)
        timestamp = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
        with closing(db()) as con, con:
            con.execute("""INSERT INTO collaborators(month,payload,atualizado_em) VALUES(?,?,?)
                           ON CONFLICT(month) DO UPDATE SET payload=excluded.payload,
                           atualizado_em=excluded.atualizado_em""",
                        (month, json.dumps(data, ensure_ascii=False), timestamp))
        with COLLAB_LOCK:
            COLLAB_JOBS[month].update(running=False, data=data, error=None, updatedAt=timestamp)
    except Exception as exc:
        with COLLAB_LOCK:
            COLLAB_JOBS[month].update(running=False, error=str(exc))


def collaborator_stored(month):
    """Ultima varredura guardada em disco, para o painel nao comecar vazio."""
    with closing(db()) as con:
        row = con.execute("SELECT payload,atualizado_em FROM collaborators WHERE month=?", (month,)).fetchone()
    if not row:
        return None
    try:
        return {"running": False, "data": json.loads(row["payload"]), "error": None,
                "updatedAt": row["atualizado_em"]}
    except json.JSONDecodeError:
        return None


def collaborator_snapshot(month, start=False):
    with COLLAB_LOCK:
        if month not in COLLAB_JOBS:
            guardado = collaborator_stored(month)
            if guardado:
                COLLAB_JOBS[month] = guardado
        job = COLLAB_JOBS.get(month)
        stale = not job or not job.get("updatedAt") or (datetime.now(ZoneInfo("America/Sao_Paulo")) -
                datetime.fromisoformat(job["updatedAt"])).total_seconds() > 1800
        if start and stale and not (job and job["running"]):
            COLLAB_JOBS[month] = {"running": True, "data": job.get("data") if job else None,
                                  "error": None, "updatedAt": job.get("updatedAt") if job else None}
            threading.Thread(target=collaborator_worker, args=(month,), daemon=True).start()
        return dict(COLLAB_JOBS.get(month) or {"running": False, "data": None, "error": None, "updatedAt": None})


def performance_data(month):
    """Resumo sem dados pessoais, a partir das leituras do Amei guardadas no disco."""
    with closing(db()) as con:
        imported = con.execute("SELECT payload,atualizado_em,avisos FROM amei_imports WHERE month=?", (month,)).fetchone()
        people = con.execute("SELECT payload,atualizado_em FROM collaborators WHERE month=?", (month,)).fetchone()
    if not imported or not people:
        return None
    collab = json.loads(people["payload"])
    clinic = collab.get("clinic")
    if not clinic:
        return None
    schedules = json.loads(imported["payload"])
    team = {}
    for key, label in (("gabriela", "David"), ("marcos", "Marcos Paulo"), ("thais", "Thaís Machado")):
        rows = collab.get("rows", {}).get(key, [])
        statuses = [int(r.get("statusId") or 0) for r in rows]
        daily = {}
        for r in rows:
            bucket = daily.setdefault(r["date"], {"marked": 0, "attended": 0, "absent": 0, "cancelled": 0})
            bucket["marked"] += 1
            status = int(r.get("statusId") or 0)
            if status in (5, 60): bucket["attended"] += 1
            elif status in (17, 83): bucket["absent"] += 1
            elif status in (3, 8, 9): bucket["cancelled"] += 1
        team[key] = {"name": label, "marked": len(rows),
                     "attended": sum(s in (5, 60) for s in statuses),
                     "absent": sum(s in (17, 83) for s in statuses),
                     "cancelled": sum(s in (3, 8, 9) for s in statuses), "daily": daily}
    schedule_daily = {}
    for r in schedules:
        bucket = schedule_daily.setdefault(r["data"], {"agendas": 0, "slots": 0, "professionals": []})
        bucket["agendas"] += 1
        bucket["slots"] += int(r.get("total") or 0)
        professional = str(r.get("id_profissional") or r.get("profissional") or "")
        if professional not in bucket["professionals"]:
            bucket["professionals"].append(professional)
    return {"month": month, "clinic": clinic, "team": team,
            "schedules": {"agendas": len(schedules), "slots": sum(int(r.get("total") or 0) for r in schedules),
                          "days": len({r["data"] for r in schedules}),
                          "professionals": len({str(r.get("id_profissional")) for r in schedules}),
                          "warnings": imported["avisos"], "daily": schedule_daily},
            "coverage": {"listed": collab["listed"], "checked": collab["checked"],
                         "unverified": collab["unverified"], "stale": collab["stale"]},
            "updatedAt": min(imported["atualizado_em"], people["atualizado_em"])}


def performance_worker(month):
    try:
        current = month == today_local().strftime("%Y-%m")
        cutoff = datetime.now(ZoneInfo("America/Sao_Paulo")) - timedelta(minutes=30)
        with closing(db()) as con:
            imp = con.execute("SELECT atualizado_em FROM amei_imports WHERE month=?", (month,)).fetchone()
            people = con.execute("SELECT payload,atualizado_em FROM collaborators WHERE month=?", (month,)).fetchone()
        if not imp or (current and datetime.fromisoformat(imp["atualizado_em"]) < cutoff):
            with PERFORMANCE_LOCK:
                PERFORMANCE_JOBS[month]["phase"] = "Lendo agendas e horários do Amei"
            scan = amei_connection.scan_month(month)
            stamp = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
            with closing(db()) as con, con:
                con.execute("""INSERT INTO amei_imports(month,payload,atualizado_em,avisos,status)
                               VALUES(?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET
                               payload=excluded.payload,atualizado_em=excluded.atualizado_em,
                               avisos=excluded.avisos,status=excluded.status""",
                            (month, json.dumps(scan["agendas"], ensure_ascii=False), stamp,
                             scan["avisos"], scan["status"]))
        needs_people = not people or "clinic" not in json.loads(people["payload"])
        if current and people and datetime.fromisoformat(people["atualizado_em"]) < cutoff:
            needs_people = True
        if needs_people:
            with PERFORMANCE_LOCK:
                PERFORMANCE_JOBS[month]["phase"] = "Conferindo consultas, faltas e autoria"
            collab = amei_connection.scan_collaborators(month)
            stamp = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
            with closing(db()) as con, con:
                con.execute("""INSERT INTO collaborators(month,payload,atualizado_em) VALUES(?,?,?)
                               ON CONFLICT(month) DO UPDATE SET payload=excluded.payload,
                               atualizado_em=excluded.atualizado_em""",
                            (month, json.dumps(collab, ensure_ascii=False), stamp))
            with COLLAB_LOCK:
                COLLAB_JOBS[month] = {"running": False, "data": collab, "error": None, "updatedAt": stamp}
        data = performance_data(month)
        if data is None:
            raise ValueError("A comparação não recebeu todos os dados do Amei.")
        with PERFORMANCE_LOCK:
            PERFORMANCE_JOBS[month].update(running=False, phase=None, error=None, data=data)
    except Exception as exc:
        with PERFORMANCE_LOCK:
            PERFORMANCE_JOBS[month].update(running=False, phase=None, error=str(exc))


def performance_snapshot(month, start=False):
    stored = performance_data(month)
    with PERFORMANCE_LOCK:
        job = PERFORMANCE_JOBS.get(month)
        current = month == today_local().strftime("%Y-%m")
        stale = current and (not stored or (datetime.now(ZoneInfo("America/Sao_Paulo")) -
                             datetime.fromisoformat(stored["updatedAt"])).total_seconds() > 1800)
        if start and not (job and job["running"]) and (not stored or stale):
            PERFORMANCE_JOBS[month] = {"running": True, "phase": "Preparando leitura", "error": None,
                                       "data": stored}
            threading.Thread(target=performance_worker, args=(month,), daemon=True).start()
            job = PERFORMANCE_JOBS[month]
        return dict(job or {"running": False, "phase": None, "error": None, "data": stored})


def import_worker(month):
    try:
        data = amei_connection.scan_month(month)
        if data["avisos"]:
            raise RuntimeError(f"A leitura de {month} teve {data['avisos']} consultas incompletas. A última leitura completa foi preservada.")
        timestamp = datetime.now().astimezone().isoformat(timespec="microseconds")
        with closing(db()) as con, con:
            con.execute("""INSERT INTO amei_imports(month,payload,atualizado_em,avisos,status)
                           VALUES(?,?,?,?,?) ON CONFLICT(month) DO UPDATE SET
                           payload=excluded.payload,atualizado_em=excluded.atualizado_em,
                           avisos=excluded.avisos,status=excluded.status""",
                        (month, json.dumps(data["agendas"], ensure_ascii=False), timestamp,
                         data["avisos"], data["status"]))
        with IMPORT_LOCK:
            IMPORT_JOB.update(running=False, error=None, result={"count": len(data["agendas"]),
                              "warnings": data["avisos"], "updatedAt": timestamp})
    except Exception as e:
        with IMPORT_LOCK:
            IMPORT_JOB.update(running=False, error=str(e), result=None)


def import_status():
    with IMPORT_LOCK:
        job = dict(IMPORT_JOB)
    with closing(db()) as con:
        job["months"] = [dict(r) for r in con.execute("SELECT month,atualizado_em,avisos,status FROM amei_imports ORDER BY month DESC")]
    return job


def dashboard(rows):
    today = today_local()
    hour = datetime.now(ZoneInfo("America/Sao_Paulo")).hour
    active = [r for r in rows if r["situacao"] == "aberta"]
    today_rows = [r for r in active if r["data"] == today.isoformat()]
    tomorrow = (today + timedelta(days=1)).isoformat()
    tomorrow_rows = [r for r in active if r["data"] == tomorrow]
    alerts = []

    def alerta(row, nivel, tipo, acao, texto, **extra):
        """Cada alerta viaja em campos separados para a tela poder ser lida de relance."""
        item = {"id": row["id"], "nivel": nivel, "tipo": tipo, "acao": acao, "texto": texto,
                "profissional": row["profissional"], "especialidade": row["especialidade"],
                "data": row["data"], "dias": (date.fromisoformat(row["data"]) - today).days}
        item.update(extra)
        alerts.append(item)

    for r in active:
        days = (date.fromisoformat(r["data"]) - today).days
        if 0 <= days <= 14 and alert_is_active(r["data"], today, hour):
            if days > 7 and r.get("prioridade") != "alta":
                continue
            if r.get("prioridade") in ("alta", "atencao"):
                free = r.get("vagas")
                if free is None:
                    free = max(0, (r["total"] or 0) - (r["ocupados"] or 0))
                alerta(r, "critico" if r["prioridade"] == "alta" else "atencao", "vagas",
                       "Avisar o call center",
                       f"{r['profissional']} em {br_date(r['data'])}: {free} horários livres de {r['total']}. Avise o call center e acompanhe o preenchimento.",
                       livres=free, total=r["total"])
            elif r["ocupacao"] is None:
                if r.get("vagas") is None and r.get("total") is None:
                    alerta(r, "info", "sem_leitura", "Ler no Amei",
                           f"Confira a agenda de {r['profissional']} em {br_date(r['data'])}: ainda não há leitura.")
    for r in rows:
        days = (date.fromisoformat(r["data"]) - today).days
        if (r["situacao"] == "prevista" and 0 <= days <= workflow.PREVISION_LEAD_DAYS
                and alert_is_active(r["data"], today, hour)):
            alerta(r, "atencao", "prevista", "Abrir no Amei",
                   f"A agenda prevista de {r['profissional']} em {br_date(r['data'])} ainda não abriu. Confira e abra no Amei.")
    # Mais grave primeiro e, dentro do mesmo nivel, o que acontece antes.
    alerts.sort(key=lambda x: ({"critico": 0, "atencao": 1, "info": 2}[x["nivel"]], x["data"]))
    def total(items, key):
        return sum(r[key] or 0 for r in items if r[key] is not None)
    return {"hoje": today.isoformat(), "salas_hoje": room_usage(rows, today.isoformat()),
            "agendas_hoje": today_rows, "agendas_amanha": tomorrow_rows,
            "agendas_7_dias": len([r for r in active if 0 <= (date.fromisoformat(r["data"]) - today).days <= 7]),
            "confirmados_hoje": total(today_rows, "confirmados"),
            "confirmados_amanha": total(tomorrow_rows, "confirmados"),
            "ocupados_amanha": total(tomorrow_rows, "ocupados"),
            "faltam_confirmar_amanha": sum(max(0, r["ocupados"] - r["confirmados"]) for r in tomorrow_rows if r["ocupados"] is not None and r["confirmados"] is not None),
            "sem_confirmacao_hoje": len([r for r in today_rows if r["confirmados"] is None]),
            "sem_confirmacao_amanha": len([r for r in tomorrow_rows if r["confirmados"] is None]),
            "previstas": len([r for r in rows if r["situacao"] == "prevista" and r["data"] >= today.isoformat()]),
            "alertas": alerts}


def fixed_rules():
    with closing(db()) as con:
        rows = con.execute("SELECT * FROM fixed_rules ORDER BY name").fetchall()
    return [{"id": r["professional_id"], "name": r["name"], "specialty": r["specialty"],
             "weekdays": json.loads(r["weekdays"]), "enabled": bool(r["enabled"])} for r in rows]


def workflow_snapshot():
    today = today_local()
    hour = datetime.now(ZoneInfo("America/Sao_Paulo")).hour
    rows = list_agendas()
    # Um unico mes de metrica interessa (o de amanha) e as regras sao as mesmas nas
    # duas pontas desta funcao: tudo sai de uma leitura so.
    tomorrow_month = (today + timedelta(days=1)).strftime("%Y-%m")
    with closing(db()) as con:
        imports = {r["month"]: datetime.fromisoformat(r["atualizado_em"])
                   for r in con.execute("SELECT month,atualizado_em FROM amei_imports")}
        metrics = {r["month"]: json.loads(r["payload"])
                   for r in con.execute("SELECT month,payload FROM monthly_metrics WHERE month=?",
                                        (tomorrow_month,))}
        states = {r["task_key"]: dict(r)
                  for r in con.execute("SELECT * FROM workflow_status")}
        rules = [{"id": r["professional_id"], "name": r["name"], "specialty": r["specialty"],
                  "weekdays": json.loads(r["weekdays"]), "enabled": bool(r["enabled"])}
                 for r in con.execute("SELECT * FROM fixed_rules ORDER BY name")]
    tasks = [task for task in workflow.build_tasks(rows, today, imports, metrics, rules)
             if alert_is_active(task["date"], today, hour)]
    for task in tasks:
        saved = states.get(task["key"])
        task["owner"] = saved["owner"] if saved else "Jéssica"
        task["status"] = saved["status"] if saved else "pendente"
        task["followup"] = False
        if saved and task["recheck"] and saved["status"] != "pendente" and saved["updated_at"][:10] < today.isoformat():
            task["status"] = "pendente"
            task["followup"] = True
    current_keys = {t["key"] for t in tasks}
    history = [{"key": s["task_key"], "title": s["title"], "detail": s["detail"],
                "date": s["task_date"], "owner": s["owner"], "status": s["status"],
                "updatedAt": s["updated_at"]}
               for s in states.values() if s["task_key"] not in current_keys and s.get("title") and
               alert_is_active(s.get("task_date"), today, hour)]
    tomorrow = (today + timedelta(days=1)).isoformat()
    tomorrow_rows = [r for r in rows if r["data"] == tomorrow and r["situacao"] in ("aberta", "prevista")]
    daily = (metrics.get(tomorrow[:7]) or {}).get("daily") or []
    measured = next((d for d in daily if d.get("date") == tomorrow), None)
    prep = {"date": tomorrow, "rooms": room_usage(rows, tomorrow),
            "agendas": [{"id": r["id"], "professional": r["profissional"],
                         "specialty": r["especialidade"], "status": r["situacao"],
                         "free": r.get("vagas"), "total": r.get("total")}
                        for r in tomorrow_rows],
            "expected": measured.get("expected") if measured else None,
            "confirmed": measured.get("confirmed") if measured else None}
    return {"today": today.isoformat(), "tasks": tasks, "history": history,
            "pending": sum(t["status"] == "pendente" for t in tasks),
            "urgent": sum(t["status"] == "pendente" and t["date"] <= (today + timedelta(days=7)).isoformat() for t in tasks),
            "tomorrow": prep, "rules": rules}


def sync_amei(row):
    if row["situacao"] != "aberta" or not row["id_profissional"] or not row["id_especialidade"]:
        raise ValueError("Marque a agenda como aberta e informe os IDs do profissional e da especialidade no Amei.")
    return amei_connection.read_day(row["data"], row["id_profissional"], row["id_especialidade"])


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # PyInstaller --windowed deixa sys.stderr ausente. O logger padrão do
        # BaseHTTPRequestHandler tenta escrever nele antes de enviar cada resposta.
        if sys.stderr is not None:
            super().log_message(format, *args)

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        # O estado completo passa de 150 KB de JSON; comprimido vai a uma fracao disso.
        # So comprime o que compensa, e so quando o navegador avisa que aceita.
        encoding = None
        if len(data) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            data = gzip.compress(data, 5)
            encoding = "gzip"
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 100_000:
            raise ValueError("Dados enviados excedem o limite.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            rows = list_agendas()
            return self.send_json(200, {"agendas": rows, "dashboard": dashboard(rows)})
        if path == "/api/workflow":
            return self.send_json(200, workflow_snapshot())
        if path == "/api/salas":
            day = parse_qs(urlparse(self.path).query).get("date", [today_local().isoformat()])[0]
            try:
                date.fromisoformat(day)
                return self.send_json(200, room_usage(list_agendas(), day))
            except ValueError:
                return self.send_json(400, {"error": "Data inválida."})
        if path == "/api/amei/status":
            return self.send_json(200, amei_connection.status())
        if path == "/api/amei/pulso":
            return self.send_json(200, amei_connection.pulso())
        if path == "/api/amei/dia":
            params = parse_qs(urlparse(self.path).query)
            day = params.get("date", [today_local().isoformat()])[0]
            # "confirmados" = status 16 (Marcado - confirmado); sem filtro, o dia inteiro.
            statuses = [16] if params.get("tipo", [""])[0] == "confirmados" else []
            try:
                return self.send_json(200, amei_connection.scan_day_patients(day, statuses))
            except (ValueError, amei_connection.ConnectionError) as e:
                return self.send_json(400, {"error": str(e)})
        if path == "/api/amei/import/status":
            return self.send_json(200, import_status())
        if path == "/api/amei/metrics":
            month = parse_qs(urlparse(self.path).query).get("month", [today_local().strftime("%Y-%m")])[0]
            try:
                date.fromisoformat(month + "-01")
                return self.send_json(200, metrics_snapshot(month))
            except ValueError:
                return self.send_json(400, {"error": "Mês inválido."})
        if path == "/api/amei/agenda":
            params = parse_qs(urlparse(self.path).query)
            try:
                day = params["date"][0]
                professional_id = params["professionalId"][0]
                specialty_id = params["specialtyId"][0]
                return self.send_json(200, amei_connection.read_agenda_detail(day, professional_id, specialty_id))
            except (KeyError, ValueError, amei_connection.ConnectionError) as e:
                return self.send_json(400, {"error": str(e)})
        if path == "/api/diagnosis":
            row_id = parse_qs(urlparse(self.path).query).get("id", [""])[0]
            row = find_agenda(row_id)
            if not row:
                return self.send_json(404, {"error": "Agenda não encontrada."})
            with DIAG_LOCK:
                return self.send_json(200, dict(DIAG_JOBS.get(diagnosis_key(row)) or
                                                {"running": False, "data": None, "error": None, "updatedAt": None}))
        if path == "/api/cartao":
            row_id = parse_qs(urlparse(self.path).query).get("id", [""])[0]
            row = find_agenda(row_id)
            if not row:
                return self.send_json(404, {"error": "Agenda não encontrada."})
            with CARD_LOCK:
                return self.send_json(200, dict(CARD_JOBS.get(card_key(row)) or
                                                {"running": False, "data": None, "error": None, "updatedAt": None}))
        if path == "/api/psiquiatria":
            row_id = parse_qs(urlparse(self.path).query).get("id", [""])[0]
            row = find_agenda(row_id)
            if not row:
                return self.send_json(404, {"error": "Agenda não encontrada."})
            with PSI_LOCK:
                return self.send_json(200, dict(PSI_JOBS.get(psi_key(row)) or
                                                {"running": False, "data": None, "error": None, "updatedAt": None}))
        if path == "/api/collaborators":
            month = parse_qs(urlparse(self.path).query).get("month", [today_local().strftime("%Y-%m")])[0]
            try:
                parsed = date.fromisoformat(month + "-01")
                if parsed.strftime("%Y-%m") != month:
                    raise ValueError()
                return self.send_json(200, collaborator_snapshot(month))
            except ValueError:
                return self.send_json(400, {"error": "Mês inválido."})
        if path == "/api/desempenho":
            month = parse_qs(urlparse(self.path).query).get("month", [today_local().strftime("%Y-%m")])[0]
            try:
                parsed = date.fromisoformat(month + "-01")
                if parsed.strftime("%Y-%m") != month:
                    raise ValueError()
                return self.send_json(200, performance_snapshot(month))
            except ValueError:
                return self.send_json(400, {"error": "Mês inválido."})
        if path.startswith("/assets/"):
            # Logotipos e imagens da marca; caminho preso dentro de assets/.
            file = (ROOT / "assets" / path[len("/assets/"):]).resolve()
            types = {".svg": "image/svg+xml", ".png": "image/png", ".css": "text/css; charset=utf-8",
                     ".woff2": "font/woff2"}
            if not file.is_file() or ROOT / "assets" not in file.parents or file.suffix not in types:
                return self.send_json(404, {"error": "Não encontrado."})
            content = file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", types[file.suffix])
            self.send_header("Cache-Control", "max-age=86400" if file.suffix == ".woff2" else "no-cache")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            return self.wfile.write(content)
        if path in ("/", "/index.html", "/style.css", "/connection.css", "/dark.css", "/reference.css", "/operations.css", "/workflow.css", "/app.js", "/connection.js", "/enhancements.js", "/dashboard.js", "/operations.js", "/calendar.js", "/rooms.js", "/performance.js", "/workflow.js"):
            file = ROOT / ("index.html" if path == "/" else path.lstrip("/"))
            content = file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}[file.suffix] + "; charset=utf-8")
            # Sem cache: o painel e editado com o navegador aberto, e a tela precisa
            # mostrar a versao do disco sem depender de recarga forcada.
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            return self.wfile.write(content)
        self.send_json(404, {"error": "Não encontrado."})

    def do_POST(self):
        try:
            path = urlparse(self.path).path
            if path == "/api/amei/open":
                return self.send_json(200, amei_connection.open_browser())
            if path == "/api/diagnosis/prefetch":
                rows = list_agendas()
                ids = set(str(x) for x in self.body().get("ids", []))
                # Poucas por vez: cada diagnóstico ocupa a única janela do Amei, e um clique da tela tem prioridade.
                eligible = [r for r in rows if str(r["id"]) in ids and r["prioridade"] == "alta"][:4]
                for row in eligible:
                    start_diagnosis(row)
                return self.send_json(202, {"started": len(eligible)})
            if path == "/api/diagnosis":
                row_id = str(self.body().get("id", ""))
                row = find_agenda(row_id)
                if not row:
                    return self.send_json(404, {"error": "Agenda não encontrada."})
                return self.send_json(202, start_diagnosis(row))
            if path == "/api/cartao":
                row_id = str(self.body().get("id", ""))
                row = find_agenda(row_id)
                if not row:
                    return self.send_json(404, {"error": "Agenda não encontrada."})
                return self.send_json(202, start_card(row))
            if path == "/api/psiquiatria":
                row_id = str(self.body().get("id", ""))
                row = find_agenda(row_id)
                if not row:
                    return self.send_json(404, {"error": "Agenda não encontrada."})
                return self.send_json(202, start_psychiatry(row))
            if path == "/api/collaborators":
                month = str(self.body().get("month", ""))
                try:
                    parsed = date.fromisoformat(month + "-01")
                    if parsed.strftime("%Y-%m") != month:
                        raise ValueError()
                except ValueError:
                    raise ValueError("Mês inválido.") from None
                return self.send_json(202, collaborator_snapshot(month, start=True))
            if path == "/api/desempenho":
                month = str(self.body().get("month", ""))
                try:
                    parsed = date.fromisoformat(month + "-01")
                    if parsed.strftime("%Y-%m") != month:
                        raise ValueError()
                except ValueError:
                    raise ValueError("Informe o mês no formato AAAA-MM.") from None
                return self.send_json(202, performance_snapshot(month, start=True))
            if path == "/api/amei/import":
                month = str(self.body().get("month", ""))
                try:
                    parsed = date.fromisoformat(month + "-01")
                    if parsed.strftime("%Y-%m") != month:
                        raise ValueError()
                except ValueError:
                    raise ValueError("Informe o mês no formato AAAA-MM.") from None
                with IMPORT_LOCK:
                    if IMPORT_JOB["running"] or METRICS_JOB["running"]:
                        return self.send_json(409, {"error": "Uma consulta do Amei já está em andamento."})
                    IMPORT_JOB.update(running=True, month=month, error=None, result=None)
                threading.Thread(target=import_worker, args=(month,), daemon=True).start()
                return self.send_json(202, {"started": True, "month": month})
            if path == "/api/amei/metrics":
                month = str(self.body().get("month", ""))
                try:
                    parsed = date.fromisoformat(month + "-01")
                    if parsed.strftime("%Y-%m") != month:
                        raise ValueError()
                except ValueError:
                    raise ValueError("Informe o mês no formato AAAA-MM.") from None
                with METRICS_LOCK, IMPORT_LOCK:
                    if METRICS_JOB["running"] or IMPORT_JOB["running"]:
                        return self.send_json(409, {"error": "Uma leitura do Amei já está em andamento."})
                    METRICS_JOB.update(running=True, month=month, phase="agendas", error=None)
                threading.Thread(target=metrics_worker, args=(month,), daemon=True).start()
                return self.send_json(202, {"started": True, "month": month})
            if path == "/api/fixed-rules":
                payload = self.body()
                professional_id = str(payload.get("id") or "").strip()
                weekdays = payload.get("weekdays")
                if not professional_id or not isinstance(weekdays, list) or not weekdays or any(type(x) is not int or x not in range(7) for x in weekdays):
                    raise ValueError("Escolha um profissional e ao menos um dia da semana.")
                source = next((r for r in list_agendas() if str(r.get("id_profissional")) == professional_id), None)
                if not source:
                    raise ValueError("Profissional não encontrado nas agendas do Amei.")
                with closing(db()) as con, con:
                    con.execute("""INSERT INTO fixed_rules(professional_id,name,specialty,weekdays,enabled)
                                   VALUES(?,?,?,?,1) ON CONFLICT(professional_id) DO UPDATE SET
                                   weekdays=excluded.weekdays,enabled=1""",
                                (professional_id, source["profissional"], source["especialidade"], json.dumps(sorted(set(weekdays)))))
                return self.send_json(201, {"ok": True})
            if path == "/api/agendas":
                values = validate(self.body())
                values["atualizado_em"] = datetime.now().astimezone().isoformat(timespec="seconds")
                with ROOM_SAVE_LOCK:
                    check_room_capacity(values)
                    with closing(db()) as con, con:
                        columns = ",".join(values)
                        cur = con.execute(f"INSERT INTO agendas ({columns}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))
                        agenda_id = cur.lastrowid
                return self.send_json(201, {"id": agenda_id})
            if path == "/api/salas/verificar":
                payload = self.body()
                values = validate(payload)
                agenda_id = payload.get("id")
                if agenda_id is not None:
                    agenda_id = int(agenda_id)
                return self.send_json(200, {"salas": check_room_capacity(values, agenda_id)})
            if path.startswith("/api/agendas/") and path.endswith("/sync"):
                agenda_id = int(path.split("/")[3])
                with closing(db()) as con, con:
                    row = con.execute("SELECT * FROM agendas WHERE id=?", (agenda_id,)).fetchone()
                    if not row:
                        return self.send_json(404, {"error": "Agenda não encontrada."})
                    reading = sync_amei(dict(row))
                    con.execute("UPDATE agendas SET leitura_amei=?, sincronizado_em=? WHERE id=?",
                                (json.dumps(reading), datetime.now().astimezone().isoformat(timespec="seconds"), agenda_id))
                return self.send_json(200, {"leitura": reading})
            self.send_json(404, {"error": "Não encontrado."})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self.send_json(400, {"error": str(e)})
        except Exception as e:
            # A tela mostra um aviso curto; o terminal guarda o motivo real, senao
            # uma falha dessas vira adivinhacao.
            traceback.print_exc()
            self.send_json(503, {"error": f"Sincronização indisponível: {e}" if self.path.endswith("/sync") else "Erro interno ao salvar."})

    def do_PUT(self):
        try:
            path = urlparse(self.path).path
            if path.startswith("/api/workflow/"):
                key = unquote(path[len("/api/workflow/"):])
                payload = self.body()
                status = str(payload.get("status") or "")
                owner = str(payload.get("owner") or "Jéssica").strip()[:80]
                if status not in ("pendente", "em_andamento", "concluido") or not owner:
                    raise ValueError("Informe uma situação e um responsável válidos.")
                task = next((t for t in workflow_snapshot()["tasks"] if t["key"] == key), None)
                if not task:
                    return self.send_json(404, {"error": "Aviso não encontrado."})
                stamp = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
                with closing(db()) as con, con:
                    con.execute("""INSERT INTO workflow_status(task_key,status,owner,updated_at,title,detail,task_date)
                                   VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_key) DO UPDATE SET
                                   status=excluded.status,owner=excluded.owner,updated_at=excluded.updated_at,
                                   title=excluded.title,detail=excluded.detail,task_date=excluded.task_date""",
                                (key, status, owner, stamp, task["title"], task["detail"], task["date"]))
                return self.send_json(200, {"ok": True})
            if path.startswith("/api/fixed-rules/"):
                professional_id = unquote(path[len("/api/fixed-rules/"):])
                payload = self.body()
                weekdays = payload.get("weekdays")
                enabled = payload.get("enabled")
                if not isinstance(weekdays, list) or any(type(x) is not int or x not in range(7) for x in weekdays) or type(enabled) is not bool or (enabled and not weekdays):
                    raise ValueError("Confira os dias da rotina fixa.")
                with closing(db()) as con, con:
                    cur = con.execute("UPDATE fixed_rules SET weekdays=?,enabled=? WHERE professional_id=?",
                                      (json.dumps(sorted(set(weekdays))), int(enabled), professional_id))
                return self.send_json(200 if cur.rowcount else 404, {"ok": bool(cur.rowcount)})
            agenda_id = int(path.split("/")[3])
            values = validate(self.body())
            values["atualizado_em"] = datetime.now().astimezone().isoformat(timespec="seconds")
            with ROOM_SAVE_LOCK:
                with closing(db()) as con, con:
                    old = con.execute("SELECT * FROM agendas WHERE id=?", (agenda_id,)).fetchone()
                    if not old:
                        return self.send_json(404, {"error": "Agenda não encontrada."})
                    check_room_capacity(values, agenda_id)
                    if (old["data"], old["id_profissional"], old["id_especialidade"]) != (values["data"], values["id_profissional"], values["id_especialidade"]) or values["situacao"] != "aberta":
                        values["leitura_amei"] = None
                        values["sincronizado_em"] = None
                    con.execute("UPDATE agendas SET " + ",".join(f"{k}=?" for k in values) + " WHERE id=?", (*values.values(), agenda_id))
            self.send_json(200, {"id": agenda_id})
        except (ValueError, KeyError, TypeError, IndexError, json.JSONDecodeError) as e:
            self.send_json(400, {"error": str(e)})

    def do_DELETE(self):
        try:
            agenda_id = int(urlparse(self.path).path.split("/")[3])
            with closing(db()) as con, con:
                cur = con.execute("DELETE FROM agendas WHERE id=?", (agenda_id,))
            self.send_json(200 if cur.rowcount else 404, {"ok": bool(cur.rowcount)})
        except (ValueError, IndexError):
            self.send_json(400, {"error": "ID inválido."})


if __name__ == "__main__":
    db().close()  # prepara o schema uma vez, antes de atender qualquer requisicao
    port = int(os.environ.get("PORT", "8777"))
    # Mantem a aba do Amei acordada enquanto o painel roda.
    pulso_s = max(10, int(os.environ.get("AMEI_PULSO_S", "30")))
    threading.Thread(target=amei_connection.manter_acordado, args=(pulso_s,), daemon=True).start()
    print(f"Painel da Jéssica: http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
