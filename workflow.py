"""Ações operacionais derivadas das agendas, sem guardar dados de pacientes."""
from __future__ import annotations

import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta


ROOM_LIMIT = 4
# Lembrete de abertura: nos cinco dias anteriores ao atendimento.
PREVISION_LEAD_DAYS = 5
# Profissionais com sala propria nao disputam as quatro salas comuns.
DEDICATED_ROOM_IDS = {"25123"}          # Larissa Brandão Romanholi, Biomedicina
DEDICATED_ROOM_NAMES = {"larissa brandao romanholi"}

FIXED_DEFAULTS = (
    ("17784", "Dra. Mayara Martins Colturato Minuzzo", "Clínica médica", (2,)),
    ("51344", "Dra. Camila Lucchese Veronesi", "Psiquiatria", (2, 4)),
    ("44683", "Dr. Osmar Leão Resende", "Dermatologia", (3,)),
    ("19605", "Dra. Clara Bruni Brolezi", "Psicologia", (2,)),
    ("16597", "Sr. Vitor Edson de Oliveira Medeiros", "Psicologia", (4,)),
)


def norm(value):
    text = unicodedata.normalize("NFD", str(value or "").casefold())
    return " ".join("".join(ch for ch in text if not unicodedata.combining(ch))
                    .replace("dra.", "").replace("dr.", "").replace("sr.", "").split())


def professional_key(row):
    return str(row.get("id_profissional") or norm(row.get("profissional")))


def has_dedicated_room(row):
    """Quem tem sala propria fica fora da conta das quatro salas.

    Casa por id e, se faltar id, pelo nome contido - o cadastro varia entre
    "Larissa...", "Sra. Larissa..." e afins, e o tratamento nem sempre e removido.
    """
    if str(row.get("id_profissional") or "") in DEDICATED_ROOM_IDS:
        return True
    nome = norm(row.get("profissional"))
    return any(alvo in nome for alvo in DEDICATED_ROOM_NAMES)


def room_periods(row):
    """Turnos ocupados por uma agenda, combinando cadastro local e leitura do Amei."""
    periods = set()
    for p in row.get("periodos") or []:
        if p["inicio"] < "12:00":
            periods.add("manha")
        if p["fim"] > "12:00":
            periods.add("tarde")
    for p in row.get("turnos_amei") or []:
        if int(p.get("total") or 0) <= 0:
            continue
        periods.add("manha" if norm(p.get("period")) in ("madrugada", "manha") else "tarde")
    return periods


def room_usage(rows, day):
    """Quantas das quatro salas estao ocupadas em cada turno do dia."""
    occupied = {"manha": set(), "tarde": set()}
    doctors = set()
    for row in rows:
        if row["data"] != day or row["situacao"] not in ("aberta", "prevista"):
            continue
        if has_dedicated_room(row):
            continue
        key = norm(row["profissional"])
        doctors.add(key)
        for period in room_periods(row):
            occupied[period].add(key)
    return {"limite": ROOM_LIMIT, "medicos": len(doctors),
            "manha": len(occupied["manha"]), "tarde": len(occupied["tarde"]),
            "disponiveis_manha": max(0, ROOM_LIMIT - len(occupied["manha"])),
            "disponiveis_tarde": max(0, ROOM_LIMIT - len(occupied["tarde"]))}


def make_task(key, kind, title, detail, day, priority, action, *, agenda_id=None,
              recheck=False, professional=None):
    return {"key": key, "kind": kind, "title": title, "detail": detail,
            "date": day, "priority": priority, "action": action,
            "agendaId": agenda_id, "recheck": recheck, "professional": professional}


def build_tasks(rows, today, imports, metrics, fixed_rules):
    """Retorna tarefas ordenadas; falta de importação vira pedido de leitura, não acusação."""
    today_iso = today.isoformat()
    tomorrow = today + timedelta(days=1)
    active = [r for r in rows if r["situacao"] in ("aberta", "prevista")]
    open_rows = [r for r in active if r["situacao"] == "aberta"]
    tasks = []

    for row in active:
        day = date.fromisoformat(row["data"])
        days = (day - today).days
        # Cinco dias de antecedencia: so lembra enquanto a agenda segue prevista,
        # porque a que ja abriu no Amei deixa de estar nesta situacao.
        if row["situacao"] == "prevista" and 0 <= days <= PREVISION_LEAD_DAYS:
            tasks.append(make_task(f"previsao:{row['id']}", "previsao",
                f"Abrir a agenda de {row['profissional']}",
                f"Previsão para {day.strftime('%d/%m/%Y')} ({'hoje' if days == 0 else 'amanhã' if days == 1 else f'faltam {days} dias'}) "
                "ainda sem abertura confirmada no Amei. Confira e abra a agenda no Amei.",
                row["data"], "alta" if days <= 2 else "media", "Verificar abertura",
                agenda_id=row["id"], recheck=True, professional=row["profissional"]))
        # A agenda da Larissa (biomedicina, sala propria) nao e preenchida pelo call center.
        if (row["situacao"] == "aberta" and 0 <= days <= 14
                and row.get("prioridade") in ("alta", "atencao")
                and not has_dedicated_room(row)):
            free = row.get("vagas")
            if free is None and row.get("total") is not None and row.get("ocupados") is not None:
                free = max(0, row["total"] - row["ocupados"])
            if free is not None and free > 0:
                tasks.append(make_task(f"vagas:{row['id']}", "vagas",
                    f"Preencher a agenda de {row['profissional']}",
                    f"{free} horário(s) livre(s) em {day.strftime('%d/%m/%Y')}. Avise o call center e acompanhe o preenchimento.",
                    row["data"], "alta" if days <= 3 or row["prioridade"] == "alta" else "media",
                    "Avisar o call center", agenda_id=row["id"], recheck=True,
                    professional=row["profissional"]))

    # Amanhã: contagem do mês lida no Amei. Se não houver leitura, pedir conferência.
    tomorrow_open = [r for r in open_rows if r["data"] == tomorrow.isoformat()]
    if tomorrow_open:
        month = tomorrow.strftime("%Y-%m")
        daily = (metrics.get(month) or {}).get("daily") or []
        measured = next((d for d in daily if d.get("date") == tomorrow.isoformat()), None)
        if measured:
            expected, confirmed = int(measured.get("expected") or 0), int(measured.get("confirmed") or 0)
            missing = max(0, expected - confirmed)
            if missing:
                tasks.append(make_task(f"confirmacao:{tomorrow.isoformat()}", "confirmacao",
                    "Confirmar os pacientes de amanhã",
                    f"{missing} de {expected} agendamento(s) ainda sem confirmação no Amei. Organize as ligações com o call center.",
                    tomorrow.isoformat(), "alta", "Avisar o call center", recheck=True))
        else:
            tasks.append(make_task(f"confirmacao:{tomorrow.isoformat()}", "confirmacao",
                "Conferir as confirmações de amanhã",
                "Ainda não há uma contagem recente de confirmações para as agendas de amanhã.",
                tomorrow.isoformat(), "media", "Conferir no Amei", recheck=True))

    # Limite de salas também pode ser ultrapassado por abertura feita fora deste painel.
    # Usa a mesma contagem da Visão geral e do bloqueio de previsão: regra única.
    for offset in range(0, 15):
        day = today + timedelta(days=offset)
        usage = room_usage(active, day.isoformat())
        for period, label in (("manha", "manhã"), ("tarde", "tarde")):
            if usage[period] > ROOM_LIMIT:
                tasks.append(make_task(f"salas:{day.isoformat()}:{period}", "salas",
                    f"Mais médicos que salas na {label}",
                    f"{usage[period]} profissionais para {ROOM_LIMIT} salas em {day.strftime('%d/%m/%Y')}. Ajuste as agendas.",
                    day.isoformat(), "alta", "Ajustar salas", recheck=True))

    # Rotinas semanais declaradas, somente com importação recente do mês.
    sync_months = set()
    for rule in fixed_rules:
        if not rule["enabled"]:
            continue
        rule_name = norm(rule["name"])
        for offset in range(0, 15):
            day = today + timedelta(days=offset)
            if day.weekday() not in rule["weekdays"]:
                continue
            month = day.strftime("%Y-%m")
            imported_at = imports.get(month)
            fresh = imported_at and (datetime.now(imported_at.tzinfo) - imported_at).total_seconds() <= 24 * 3600
            if not fresh:
                if month not in sync_months:
                    sync_months.add(month)
                    tasks.append(make_task(f"leitura:{month}", "leitura",
                        f"Atualizar as agendas de {month[5:7]}/{month[:4]}",
                        "A leitura do Amei precisa ser atualizada antes de conferir as rotinas fixas deste mês.",
                        day.isoformat(), "media", "Atualizar no Amei"))
                continue
            matches = [r for r in active if r["data"] == day.isoformat() and
                       (str(r.get("id_profissional") or "") == rule["id"] or norm(r["profissional"]) == rule_name)]
            if any(r["situacao"] == "aberta" for r in matches):
                continue
            state = "há previsão, mas ainda não abriu" if matches else "não há agenda aberta"
            tasks.append(make_task(f"fixo:{rule['id']}:{day.isoformat()}", "fixo",
                f"Conferir agenda fixa de {rule['name']}",
                f"{day.strftime('%d/%m/%Y')}: {state} no Amei. Confirme com o profissional antes de divulgar horários.",
                day.isoformat(), "alta" if offset <= 7 else "media", "Verificar com o profissional",
                professional=rule["name"]))

    # Profissionais sem rotina fixa: lembrar após 20 dias da última agenda,
    # desde que haja histórico mínimo e nenhuma data futura aberta ou prevista.
    fixed_ids = {r["id"] for r in fixed_rules if r["enabled"]}
    by_professional = defaultdict(list)
    for row in active:
        if str(row.get("id_profissional") or "") not in fixed_ids:
            by_professional[professional_key(row)].append(row)
    for key, agendas in by_professional.items():
        historical = sorted({r["data"] for r in agendas if r["data"] < today_iso and r["situacao"] == "aberta"})
        if len(historical) < 2 or any(r["data"] >= today_iso for r in agendas):
            continue
        last = date.fromisoformat(historical[-1])
        days = (today - last).days
        if days < 20:
            continue
        latest = next(r for r in agendas if r["data"] == historical[-1])
        detail = (f"A última agenda foi em {last.strftime('%d/%m/%Y')}, há {days} dias, "
                  "e não há próxima data aberta ou prevista. Avalie com o profissional se já é hora de abrir outra.")
        if "ginecolog" in norm(latest["especialidade"]):
            detail += " Se houver exames aguardando retorno, confira se os resultados já ficaram prontos."
        tasks.append(make_task(f"retorno:{key}:{last.isoformat()}", "retorno",
            f"Avaliar nova agenda de {latest['profissional']}", detail,
            today_iso, "media" if days < 30 else "alta", "Avaliar nova data",
            professional=latest["profissional"]))

    order = {"alta": 0, "media": 1, "baixa": 2}
    return sorted(tasks, key=lambda t: (order[t["priority"]], t["date"], t["title"]))
