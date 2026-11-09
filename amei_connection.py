"""Read-only Amei browser transport. Browser owns the session; Python never reads cookies."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import re
import threading
import time
import calendar
import contextlib
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlencode

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
_DEFAULT_DATA = Path(os.environ.get("LOCALAPPDATA", str(ROOT))) / "AgendaClara" / "data" if getattr(sys, "frozen", False) else ROOT / "data"
DATA_ROOT = Path(os.environ.get("AGENDA_CLARA_DATA_DIR", str(_DEFAULT_DATA)))
BOT_ROOT = Path(os.environ.get("AMEI_BOT_DIR", str(ROOT / "bot" if (ROOT / "bot").is_dir() else Path.home() / "Documents" / "bot amei" / "Bot-amei-")))
CLI = ROOT / "node_modules" / "@playwright" / "cli" / "playwright-cli.js"
PROFILE = DATA_ROOT / "amei-profile"
SESSION = "agenda-clara"
LOCK = threading.Lock()
GATE = threading.Condition()
PENDING = 0  # consultas pedidas na tela, esperando ou em andamento


@contextlib.contextmanager
def busy(wait=None):
    """Serializa o acesso ao navegador do Amei, dando preferência à tela.

    Uma consulta pedida pela tela (wait em segundos) passa na frente das varreduras
    de fundo ainda na fila, e desiste com um aviso se o navegador não liberar a tempo.
    Uma varredura de fundo (wait=None) espera a vez e cede enquanto houver pedido da tela.
    """
    global PENDING
    if wait is None:
        while True:
            with GATE:
                while PENDING:
                    GATE.wait()
            if not LOCK.acquire(timeout=0.5):
                continue
            with GATE:
                if not PENDING:
                    break
                # Um pedido da tela chegou enquanto esperávamos: devolve a vez e tenta de novo.
                LOCK.release()
                GATE.notify_all()
        try:
            yield
        finally:
            LOCK.release()
        return

    with GATE:
        PENDING += 1
    try:
        if not LOCK.acquire(timeout=wait):
            raise ConnectionError("O Amei está ocupado com uma leitura em andamento. Tente de novo em instantes.")
    finally:
        with GATE:
            PENDING -= 1
            GATE.notify_all()
    try:
        yield
    finally:
        LOCK.release()
        with GATE:
            GATE.notify_all()


class ConnectionError(RuntimeError):
    pass


def cli(*args, timeout=30):
    if not CLI.is_file():
        raise ConnectionError("Instale o componente do navegador com npm install nesta pasta.")
    PROFILE.parent.mkdir(exist_ok=True)
    config_args = []
    browser_exe = os.environ.get("AGENDA_CLARA_BROWSER_EXE")
    if browser_exe and args and args[0] == "open":
        config = DATA_ROOT / "playwright-config.json"
        config.write_text(json.dumps({"browser": {"browserName": "chromium",
                                             "launchOptions": {"executablePath": browser_exe}}}), encoding="utf-8")
        config_args = ["--config=" + str(config)]
    try:
        proc = subprocess.run([os.environ.get("AGENDA_CLARA_NODE") or shutil.which("node") or "node", str(CLI), "-s=" + SESSION, *config_args, *args],
                              cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=timeout,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise ConnectionError("O navegador demorou demais para responder.") from None
    if proc.returncode or "### Error" in proc.stdout:
        # Never expose stdout/stderr: these can contain SSO URLs and sensitive page data.
        raise ConnectionError("Não foi possível usar a janela do Amei. Abra a conexão novamente e confira o login.")
    return proc.stdout


def result(output):
    marker = "### Result\n"
    if marker not in output:
        raise ConnectionError("O navegador não retornou uma resposta verificável.")
    raw = output.split(marker, 1)[1].split("\n### ", 1)[0].strip()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise ConnectionError("Resposta inválida do navegador.") from None
    if not isinstance(value, dict):
        raise ConnectionError("Resposta inesperada do Amei.")
    return value


def run_code(source, timeout=30):
    file = DATA_ROOT / "amei-command.js"
    file.write_text(source, encoding="utf-8")
    return result(cli("run-code", "--filename", str(file), timeout=timeout))


def open_browser():
    with busy(25):
        try:
            # Reuse an existing login window without navigating away from an unfinished login.
            run_code("async page => { await page.bringToFront(); return {ready:true}; }", timeout=10)
        except ConnectionError:
            browser_arg = [] if os.environ.get("AGENDA_CLARA_BROWSER_EXE") else ["--browser=chrome"]
            cli("open", "https://amei.amorsaude.com.br", *browser_arg, "--headed",
                "--persistent", "--profile=" + str(PROFILE), timeout=45)
    return {"opened": True}


def status():
    if LOCK.locked():
        return {"status": "ocupado", "message": "Consulta em andamento."}
    with busy(15):
        try:
            data = run_code("""async page => {
              const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));
              if(!target)return {connected:false};
              try { const data=await target.evaluate(async()=>{
                const r=await fetch('/api/v1/especialidades',{credentials:'same-origin',signal:AbortSignal.timeout(12000)});
                if(!r.ok)return false;
                const body=await r.json();return Array.isArray(body);
              });return {connected:data};}catch(e){return {connected:false};}
            }""", timeout=20)
            return {"status": "conectado" if data.get("connected") else "login_necessario",
                    "message": "A sessão do Amei está ativa." if data.get("connected") else "Faça login na janela do Amei e verifique novamente."}
        except ConnectionError:
            return {"status": "fechado", "message": "Abra o Amei para iniciar a conexão."}


def scan_month(month):
    try:
        start = date.fromisoformat(month + "-01")
        if start.strftime("%Y-%m") != month:
            raise ValueError()
    except (TypeError, ValueError):
        raise ValueError("Informe o mês no formato AAAA-MM.") from None
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    if not (BOT_ROOT / "amei_api.js").is_file() or not (BOT_ROOT / "agenda_overview_amei.js").is_file():
        raise ConnectionError("Os arquivos de leitura do bot Amei não foram encontrados.")
    api_source = (BOT_ROOT / "amei_api.js").read_text(encoding="utf-8")
    scanner_source = (BOT_ROOT / "agenda_overview_amei.js").read_text(encoding="utf-8")
    # Omit cancellation lookup and patient details. Keep only agenda-level counts.
    scanner_source = scanner_source.replace("detectCancellations:true", "detectCancellations:false,includePeriods:true,includeFitIns:true")
    args = json.dumps({"initialDate": start.isoformat(), "finalDate": end.isoformat(),
                       "clinicMedicalProfessional": "Mayara Martins Colturato Minuzzo"}, ensure_ascii=False)
    source = ("async page => {"
              "const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
              "if(!target)return {error:'LOGIN_NECESSARIO'};"
              "return await target.evaluate(async()=>{try{"
              "const data=await (" + scanner_source + ")((" + api_source + ")," + args + ");"
              "return {agendas:data.agendas.map(a=>({date:a.date,professional:a.professional,specialty:a.specialty,"
              "professionalId:a.professionalId,specialtyId:a.specialtyId,total:a.total,vacant:a.vacant,"
              "pendingCount:a.pendingConfirmationTimes.length,fitInCount:a.fitInCount,periods:a.periods||[]})),"
              "warnings:data.warnings.length,status:data.status};"
              "}catch(e){return {error:e.code||'CONSULTA_FALHOU'};}});}")
    with busy(30):
        data = run_code(source, timeout=420)
    if data.get("error"):
        code = data["error"]
        if code in ("AUTH_ERROR", "LOGIN_NECESSARIO"):
            raise ConnectionError("A sessão do Amei expirou. Faça login na janela e tente novamente.")
        raise ConnectionError("O Amei não concluiu a consulta de agendas (" + str(code)[:40] + ").")
    if not isinstance(data.get("agendas"), list) or not isinstance(data.get("warnings"), int):
        raise ConnectionError("O Amei retornou dados de agenda em formato inesperado.")
    clean = []
    for a in data["agendas"]:
        try:
            if not (start <= date.fromisoformat(a["date"]) <= end):
                raise ValueError()
            total, vacant = int(a["total"]), int(a["vacant"])
            if not 0 <= vacant <= total:
                raise ValueError()
            if not all(str(a[k]).strip() for k in ("professional", "specialty", "professionalId", "specialtyId")):
                raise ValueError()
            clean.append({"data": a["date"], "profissional": str(a["professional"])[:120],
                          "especialidade": str(a["specialty"])[:120], "id_profissional": str(a["professionalId"]),
                          "id_especialidade": str(a["specialtyId"]), "total": total, "ocupados": total - vacant,
                          "vagas": vacant, "pendentes": int(a["pendingCount"]),
                          "encaixes": int(a.get("fitInCount", 0)), "periodos_amei": a["periods"]})
        except (KeyError, TypeError, ValueError):
            raise ConnectionError("O Amei retornou uma agenda inválida; a importação foi descartada.") from None
    return {"agendas": clean, "avisos": data["warnings"], "status": data["status"]}


def read_day(day, professional_id, specialty_id):
    if not (BOT_ROOT / "amei_api.js").is_file():
        raise ConnectionError("Arquivo de leitura do bot Amei não encontrado.")
    args = json.dumps({"action": "slots", "idProfissional": professional_id,
                       "idEspecialidade": specialty_id, "initialDate": day, "finalDate": day,
                       "overview": True, "includeFitIns": True}, ensure_ascii=False)
    api_source = (BOT_ROOT / "amei_api.js").read_text(encoding="utf-8")
    source = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
              "if(!target)return {error:'LOGIN_NECESSARIO'};return await target.evaluate(async()=>{try{"
              "const result=await (" + api_source + ")(" + args + ");"
              "return {agendas:result.agendas.map(a=>({date:a.date,total:a.total,vacant:a.vacant,"
              "pendingCount:a.pendingConfirmationTimes.length,fitInCount:a.fitInCount}))};"
              "}catch(e){return {error:e.code||'CONSULTA_FALHOU'};}});}")
    with busy(30):
        data = run_code(source, timeout=75)
    if data.get("error"):
        raise ConnectionError("Não foi possível ler a agenda no Amei. Confira a conexão e os IDs.")
    days = [a for a in data.get("agendas", []) if a.get("date") == day]
    if len(days) != 1:
        raise ConnectionError("O Amei não retornou uma agenda única para esta data e profissional.")
    total, vacant = int(days[0]["total"]), int(days[0]["vacant"])
    if not 0 <= vacant <= total:
        raise ConnectionError("Contagem de horários inválida no Amei.")
    return {"total": total, "ocupados": total - vacant, "vagas": vacant,
            "pendentes": int(days[0]["pendingCount"]), "encaixes": int(days[0]["fitInCount"])}


def read_agenda_detail(day, professional_id, specialty_id):
    """Fetch one agenda fresh; return only time, status and patient name for this view."""
    date.fromisoformat(day)
    if not professional_id or not specialty_id:
        raise ValueError("Esta agenda não tem IDs para consulta no Amei.")
    query = urlencode({"idClinic": "1795", "idSpecialty": str(specialty_id),
                       "idProfessional": str(professional_id), "initialDate": day.replace("-", ""),
                       "finalDate": day.replace("-", ""), "initialHour": "00:00",
                       "endHour": "23:59", "fetchPolicy": "network-only",
                       "cancelledAppointments": "false"})
    args = json.dumps({"day": day, "prof": str(professional_id), "spec": str(specialty_id), "query": query})
    source = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
              "if(!target)return {error:'LOGIN_NECESSARIO'};return await target.evaluate(async q=>{try{"
              "const response=await fetch('/api/v1/slots/list-slots-by-professional?'+q.query,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});"
              "if(response.status===401||response.status===403)return {error:'AUTH_ERROR'};"
              "if(!response.ok)return {error:'HTTP_ERROR'};const data=await response.json();"
              "if(!Array.isArray(data))return {error:'SCHEMA_ERROR'};const rows=[];"
              "for(const entry of data){if(!Array.isArray(entry.hours))return {error:'SCHEMA_ERROR'};"
              "for(const h of entry.hours){if(String(h.idProfessional)!==q.prof||String(h.specialtyId)!==q.spec)return {error:'SCHEMA_ERROR'};"
              "const dateParts=/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(String(h.date||''));"
              "const iso=dateParts?dateParts[3]+'-'+dateParts[2]+'-'+dateParts[1]:String(h.date||'').slice(0,10);"
              "if(iso!==q.day)return {error:'SCHEMA_ERROR'};"
              "const time=/^(\\d{1,2}):(\\d{2})$/.exec(String(h.formatedHour||''));if(!time)return {error:'SCHEMA_ERROR'};"
              "rows.push({time:time[1].padStart(2,'0')+':'+time[2],status:String(h.status||''),"
              "patient:String(h.patient||'').trim(),fitIn:h.encaixe===true,"
              "appointmentId:h.appointmentId==null?'':String(h.appointmentId)});}}"
              "return {rows};}catch(e){return {error:'NETWORK_ERROR'};}}," + args + ");}")
    # The browser receives only a fixed query object; no raw response is logged.
    with busy(30):
        data = run_code(source, timeout=60)
    if data.get("error"):
        raise ConnectionError("Não foi possível atualizar esta agenda no Amei. Confira a conexão e tente novamente.")
    if not isinstance(data.get("rows"), list):
        raise ConnectionError("O Amei retornou horários em formato inesperado.")
    rows = data["rows"]
    for row in rows:
        if not isinstance(row, dict) or not all(k in row for k in ("time", "status", "patient", "fitIn")):
            raise ConnectionError("O Amei retornou um horário inválido.")
    free = sorted({r["time"] for r in rows if r["status"].strip().casefold() == "livre"})
    blocked = [r for r in rows if "bloquead" in r["status"].casefold()]
    appointments = []
    seen = set()
    for row in rows:
        if not row["patient"]:
            continue
        key = row["appointmentId"] or (row["time"], row["patient"])
        if key in seen:
            continue
        seen.add(key)
        appointments.append({"time": row["time"], "patient": row["patient"],
                             "status": row["status"], "fitIn": row["fitIn"],
                             "appointmentId": row["appointmentId"]})
    appointments.sort(key=lambda r: (r["time"], r["patient"]))
    return {"date": day, "total": len(rows), "freeTimes": free, "freeCount": len(free),
            "blockedCount": len(blocked), "fitInCount": sum(a["fitIn"] for a in appointments),
            "appointments": appointments}


def scan_metrics(month, agendas, today):
    jobs = sorted({(str(a["id_especialidade"]), str(a["id_profissional"])) for a in agendas})
    source = (ROOT / "amei_metrics.js").read_text(encoding="utf-8")
    args = json.dumps({"month": month, "today": today.isoformat(), "discoverAll": True,
                       "jobs": [{"specialtyId": s, "professionalId": p} for s, p in jobs]})
    code = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
            "if(!target)return {error:'AUTH_ERROR'};return await target.evaluate((" + source + ")," + args + ");}")
    with busy():
        result = run_code(code, timeout=360)
    if result.get("error"):
        raise ConnectionError("A leitura dos atendimentos não foi concluída (" + str(result["error"])[:30] + ").")
    if not isinstance(result.get("daily"), list) or not isinstance(result.get("appointments"), dict) or not isinstance(result.get("patients"), dict):
        raise ConnectionError("O Amei retornou totais em formato inesperado.")
    if len(result["daily"]) != calendar.monthrange(int(month[:4]), int(month[5:7]))[1]:
        raise ConnectionError("A leitura não cobriu todos os dias do mês.")
    return result


def scan_diagnosis(month, today, professional_id, specialty_id):
    args = {"month": month, "today": today.isoformat(), "professionalId": str(professional_id),
            "specialtyId": str(specialty_id)}
    source = (ROOT / "amei_diagnosis.js").read_text(encoding="utf-8")
    code = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
            "if(!target)return {error:'AUTH_REQUIRED'};return await target.evaluate((" + source + ")," + json.dumps(args) + ");}")
    with busy():
        data = run_code(code, timeout=420)
    if data.get("error"):
        raise ConnectionError("Diagnóstico indisponível no Amei (" + str(data["error"])[:40] + ").")
    if not isinstance(data.get("waiting"), list) or not isinstance(data.get("returning"), list):
        raise ConnectionError("O Amei retornou um diagnóstico incompleto.")
    return data


def scan_day_patients(day, statuses=None):
    """Pacientes de um dia, com nome e CPF, para a Jessica poder ligar."""
    date.fromisoformat(day)
    args = {"date": day, "statuses": [int(x) for x in (statuses or [])]}
    source = (ROOT / "amei_day_patients.js").read_text(encoding="utf-8")
    code = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
            "if(!target)return {error:'AUTH_REQUIRED'};return await target.evaluate((" + source + ")," + json.dumps(args) + ");}")
    with busy(45):
        data = run_code(code, timeout=180)
    if data.get("error"):
        if data["error"] == "AUTH_REQUIRED":
            raise ConnectionError("A sessão do Amei expirou. Faça login na janela e tente novamente.")
        raise ConnectionError("Não foi possível ler os pacientes do dia (" + str(data["error"])[:40] + ").")
    if not isinstance(data.get("rows"), list) or not isinstance(data.get("checked"), int):
        raise ConnectionError("O Amei retornou os pacientes em formato inesperado.")
    return data


def scan_psychiatry(day, professional_id, specialty_id):
    """Confere o procedimento cobrado contra o historico do paciente no ano."""
    date.fromisoformat(day)
    args = {"date": day, "professionalId": str(professional_id), "specialtyId": str(specialty_id)}
    source = (ROOT / "amei_psiquiatria.js").read_text(encoding="utf-8")
    code = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
            "if(!target)return {error:'AUTH_REQUIRED'};return await target.evaluate((" + source + ")," + json.dumps(args) + ");}")
    with busy():
        data = run_code(code, timeout=600)
    if data.get("error"):
        if data["error"] == "AUTH_REQUIRED":
            raise ConnectionError("A sessão do Amei expirou. Faça login na janela e tente novamente.")
        raise ConnectionError("Conferência da psiquiatria indisponível (" + str(data["error"])[:40] + ").")
    if not isinstance(data.get("rows"), list) or not isinstance(data.get("conferidos"), int):
        raise ConnectionError("O Amei retornou a conferência em formato inesperado.")
    return data


def scan_card(day, professional_id, specialty_id):
    """Situacao de cada paciente da agenda no Cartao de Todos."""
    date.fromisoformat(day)
    args = {"date": day, "professionalId": str(professional_id), "specialtyId": str(specialty_id)}
    source = (ROOT / "amei_cartao.js").read_text(encoding="utf-8")
    code = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
            "if(!target)return {error:'AUTH_REQUIRED'};return await target.evaluate((" + source + ")," + json.dumps(args) + ");}")
    with busy():
        data = run_code(code, timeout=420)
    if data.get("error"):
        if data["error"] == "AUTH_REQUIRED":
            raise ConnectionError("A sessão do Amei expirou. Faça login na janela e tente novamente.")
        raise ConnectionError("Conferência do Cartão de Todos indisponível (" + str(data["error"])[:40] + ").")
    if not isinstance(data.get("rows"), list) or not isinstance(data.get("resumo"), dict):
        raise ConnectionError("O Amei retornou o Cartão de Todos em formato inesperado.")
    return data


def scan_collaborators(month):
    source = (ROOT / "amei_collaborators.js").read_text(encoding="utf-8")
    code = ("async page => {const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));"
            "if(!target)return {error:'AUTH_REQUIRED'};return await target.evaluate((" + source + ")," + json.dumps({"month": month}) + ");}")
    with busy():
        data = run_code(code, timeout=600)
    if data.get("error"):
        raise ConnectionError("Colaboradores indisponíveis no Amei (" + str(data["error"])[:40] + ").")
    if not isinstance(data.get("rows"), dict) or not isinstance(data.get("listed"), int):
        raise ConnectionError("O Amei retornou colaboradores em formato inesperado.")
    return data


# ---------------------------------------------------------------------------
# Pulso: o Chrome congela aba em segundo plano e a pagina do Amei para de
# responder. Uma sondagem curta de tempos em tempos mantem a aba acordada; se
# ela ja travou, um F5 a traz de volta. Nada do painel vive naquela pagina, entao
# recarregar nao perde dado nenhum: agendas, metricas e colaboradores ficam aqui.
# ---------------------------------------------------------------------------
PULSO_LOCK = threading.Lock()
PULSO = {"ligado": False, "intervalo_s": 30, "estado": None, "desde": None,
         "ultimo_ok": None, "ultima_falha": None, "recargas": 0, "recuperacoes": 0,
         "maior_queda_s": 0, "queda_atual_s": 0, "sondagens": 0, "seguidas": 0}

# Quantos F5 seguidos sem sucesso antes de parar e pedir login humano: passar disso
# significa que o refresh token morreu e so a pessoa resolve.
MAX_RECARGAS_SEGUIDAS = 3
PAGINA_DE_LOGIN = re.compile(r"/(login|auth|signin|sign-in|logout)", re.I)
_QUEDA_DESDE = None

SONDA = """async page => {
  const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));
  if(!target)return {estado:'sem_janela',url:''};
  const url=target.url();
  try{
    const vivo=await target.evaluate(async()=>{
      const r=await fetch('/api/v1/especialidades',{credentials:'same-origin',signal:AbortSignal.timeout(8000)});
      if(!r.ok)return false;
      return Array.isArray(await r.json());
    });
    return {estado: vivo ? 'ativo' : 'login', url};
  }catch(e){return {estado:'travado',url};}
}"""

RECARGA = """async page => {
  const target=page.context().pages().find(p=>p.url().startsWith('https://amei.amorsaude.com.br/'));
  if(!target)return {estado:'sem_janela'};
  await target.reload({waitUntil:'domcontentloaded', timeout:25000});
  return {estado:'recarregado'};
}"""


def _marcar(estado):
    """Guarda o estado e mede quanto tempo o Amei passou sem responder."""
    global _QUEDA_DESDE
    agora = time.monotonic()
    relogio = datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat(timespec="seconds")
    with PULSO_LOCK:
        PULSO["sondagens"] += 1
        if PULSO["estado"] != estado:
            PULSO["desde"] = relogio
        PULSO["estado"] = estado
        if estado == "ativo":
            PULSO["ultimo_ok"] = relogio
            if _QUEDA_DESDE is not None:
                PULSO["maior_queda_s"] = max(PULSO["maior_queda_s"], int(agora - _QUEDA_DESDE))
                _QUEDA_DESDE = None
            PULSO["queda_atual_s"] = 0
        elif estado in ("travado", "sem_resposta", "sem_janela", "login"):
            PULSO["ultima_falha"] = relogio
            if _QUEDA_DESDE is None:
                _QUEDA_DESDE = agora
            PULSO["queda_atual_s"] = int(agora - _QUEDA_DESDE)


def _pode_recarregar(url):
    """Nao recarrega por cima de um login humano nem insiste quando o F5 nao resolve."""
    if PAGINA_DE_LOGIN.search(url or ""):
        return False
    with PULSO_LOCK:
        return PULSO["seguidas"] < MAX_RECARGAS_SEGUIDAS


def heartbeat():
    """Uma batida.

    O Amei guarda um refresh token e so renova o acesso quando a pagina carrega.
    Com a aba parada em segundo plano o token expira e as chamadas voltam 401.
    Um F5 refaz a sessao sozinho - foi conferido ao vivo: 401 antes, 200 depois.
    Por isso tanto a pagina travada quanto a sessao expirada levam recarga.
    """
    with GATE:
        if PENDING:
            return {"estado": "ocupado"}
    if not LOCK.acquire(timeout=2):
        # Uma leitura de verdade esta rodando e ja mantem a pagina acordada.
        return {"estado": "ocupado"}
    recuperou = False
    try:
        try:
            sonda = run_code(SONDA, timeout=20)
            estado, url = sonda.get("estado", "sem_resposta"), sonda.get("url", "")
            if estado in ("travado", "login") and _pode_recarregar(url):
                run_code(RECARGA, timeout=45)
                with PULSO_LOCK:
                    PULSO["recargas"] += 1
                    PULSO["seguidas"] += 1
                sonda = run_code(SONDA, timeout=20)
                novo_estado = sonda.get("estado", "sem_resposta")
                recuperou = estado == "login" and novo_estado == "ativo"
                estado = novo_estado
        except ConnectionError:
            estado = "sem_resposta"
    finally:
        LOCK.release()
        with GATE:
            GATE.notify_all()
    with PULSO_LOCK:
        if recuperou:
            PULSO["recuperacoes"] += 1
        if estado == "ativo":
            PULSO["seguidas"] = 0
    _marcar(estado)
    return {"estado": estado}


def pulso():
    with PULSO_LOCK:
        dados = dict(PULSO)
    if _QUEDA_DESDE is not None:
        dados["queda_atual_s"] = int(time.monotonic() - _QUEDA_DESDE)
    return dados


def manter_acordado(intervalo=30):
    """Fica batendo no Amei para a aba nao hibernar."""
    with PULSO_LOCK:
        PULSO["ligado"] = True
        PULSO["intervalo_s"] = intervalo
    while True:
        try:
            heartbeat()
        except Exception:
            _marcar("sem_resposta")
        time.sleep(intervalo)
