#!/usr/bin/env python3
"""Sincroniza calificaciones y conducta de iSAMS, detecta cambios negativos y avisa.

Corre en tu Mac (programado con launchd). Requiere isams_client.py en la misma carpeta
y haber hecho `python3 isams_client.py login` al menos una vez.

Que hace en cada corrida:
  1. Baja calificaciones (gradebooks no archivados) y registros de conducta.
  2. Guarda un resumen compacto en ~/isams_data/latest.json (+ copia en history/).
  3. Compara con la corrida anterior. Si hay algo negativo, muestra una notificacion
     de macOS y lo anota en ~/isams_data/changes.log.

Es negativo: total de una materia que baja >= ISAMS_DROP puntos (default 1), una nota
nueva menor a ISAMS_LOW (default 60), una nota que baja, o un reporte de conducta nuevo
(conducta, tardanza, uniforme, suspension, etc.). La primera corrida solo guarda la base.
"""
import datetime
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import isams_client as c  # noqa: E402

DATA = os.path.expanduser(os.environ.get("ISAMS_DATA_DIR", "~/isams_data"))
DROP = float(os.environ.get("ISAMS_DROP", "1"))
LOW = float(os.environ.get("ISAMS_LOW", "60"))
NEGATIVE_TYPES = {
    "Tardy Report", "Conduct Report", "Suspension Report", "Uniform Report",
    "Academic Conditional Matricula", "Carta Compromiso", "Dress Code Violation",
}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_raw():
    status, books = c.api_json(f"/markbooks/students/{c.STUDENT_ID}")
    if status != 200:
        raise RuntimeError(f"markbooks HTTP {status}")
    raw_books = []
    for b in c.find_list(books):
        if b.get("name", "").startswith("z(Archive)"):
            continue
        st, cols = c.api_json(f"/markbooks/{b['id']}/students/{c.STUDENT_ID}/columns")
        if st != 200:
            raise RuntimeError(f"columns {b['name']} HTTP {st}")
        raw_books.append({"id": b["id"], "name": b["name"], "columns": cols})
    st, types = c.api_json("/rewardsandconduct/rewardtypes")
    if st != 200:
        raise RuntimeError(f"rewardtypes HTTP {st}")
    conduct = {"types": types, "records": {}}
    for t in c.find_list(types):
        st, rec = c.api_json(f"/students/{c.STUDENT_ID}/rewardsandconduct/rewardtypes/{t['id']}")
        if st != 200:
            raise RuntimeError(f"conduct {t['id']} HTTP {st}")
        conduct["records"][str(t["id"])] = rec
    return raw_books, conduct


def summarize(books, conduct):
    subjects = {}
    for b in books:
        cols = b["columns"] if isinstance(b["columns"], list) else []
        total, items = None, {}
        for col in cols:
            groups = col.get("parentGroupings") or []
            if col.get("type") == "Calculation":
                if total is None and len(groups) == 1:  # el total del trimestre
                    total = num(col.get("value"))
            else:
                items[str(col["id"])] = {
                    "name": (col.get("name") or "").strip(),
                    "value": num(col.get("value")),
                    "group": groups[-1]["name"] if groups else "",
                }
        subjects[b["name"]] = {"total": total, "items": items}
    names = {str(t["id"]): t.get("name", "") for t in c.find_list(conduct.get("types"))}
    reports = {}
    for tid, rec in (conduct.get("records") or {}).items():
        rewards = rec.get("rewards", []) if isinstance(rec, dict) else []
        reports[tid] = {"type": names.get(tid, tid), "records": [{
            "id": r["id"], "date": (r.get("awardedOn") or "")[:10],
            "category": r.get("categoryName", ""),
            "teacher": (r.get("teacher") or {}).get("fullName", ""),
            "description": r.get("description", ""),
        } for r in rewards]}
    return {"taken_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "subjects": subjects, "conduct": reports}


def diff(old, new):
    neg, pos = [], []
    for sname, s in new["subjects"].items():
        o = old["subjects"].get(sname)
        if o is None:
            continue
        ot, nt = o["total"], s["total"]
        if ot is not None and nt is not None:
            if nt <= ot - DROP:
                neg.append(f"{sname}: total {ot:g} -> {nt:g}")
            elif nt >= ot + DROP:
                pos.append(f"{sname}: total {ot:g} -> {nt:g}")
        for iid, it in s["items"].items():
            v, oi = it["value"], o["items"].get(iid)
            if v is None:
                continue
            if oi is None or oi["value"] is None:
                if v < LOW:
                    neg.append(f"{sname}: nota baja nueva '{it['name']}' = {v:g}")
            elif v < oi["value"]:
                neg.append(f"{sname}: '{it['name']}' bajo {oi['value']:g} -> {v:g}")
    for tid, t in new["conduct"].items():
        seen = {r["id"] for r in old["conduct"].get(tid, {}).get("records", [])}
        for r in t["records"]:
            if r["id"] not in seen:
                msg = f"{t['type']}: {r['category']} ({r['date']})"
                (neg if t["type"] in NEGATIVE_TYPES else pos).append(msg)
    return neg, pos


CI_ALERT = os.environ.get("CI_ALERT_FILE")  # en GitHub Actions: archivo que se vuelve un Issue


def notify(title, msg):
    if CI_ALERT:
        return  # en la nube las alertas se escriben completas en main()
    msg = (msg[:220] + "...") if len(msg) > 223 else msg
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    subprocess.run(["osascript", "-e",
                    f'display notification "{esc(msg)}" with title "{esc(title)}"'], check=False)


def strip(snap):
    return {k: v for k, v in snap.items() if k != "taken_at"}


def log(line):
    with open(os.path.join(DATA, "changes.log"), "a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {line}\n")


def main():
    os.makedirs(os.path.join(DATA, "history"), exist_ok=True)
    try:
        raw_books, raw_conduct = fetch_raw()
    except (SystemExit, Exception) as e:  # sesion expirada, red caida, cambio de API...
        print("ERROR:", e)
        if CI_ALERT:
            return 1
        marker = os.path.join(DATA, ".error_notified")
        today = datetime.date.today().isoformat()
        if not (os.path.exists(marker) and open(marker).read() == today):  # 1 aviso por dia
            notify("iSAMS", "No pude actualizar. Si es sesion expirada corre: python3 isams_client.py login")
            open(marker, "w").write(today)
        log(f"ERROR {e}")
        return 1
    new = summarize(raw_books, raw_conduct)
    latest = os.path.join(DATA, "latest.json")
    if os.path.exists(latest):
        with open(latest, encoding="utf-8") as f:
            old = json.load(f)
        neg, pos = diff(old, new)
        for line in neg:
            log("NEGATIVO " + line)
        for line in pos:
            log("positivo " + line)
        if neg and CI_ALERT:
            with open(CI_ALERT, "w", encoding="utf-8") as f:
                f.write("Cambios negativos detectados en iSAMS:\n\n" + "\n".join(f"- {n}" for n in neg) + "\n")
        if CI_ALERT and not neg and not pos and strip(old) == strip(new):
            print("Sin cambios; no se reescribe latest.json")
            return 0
        if neg and not CI_ALERT:
            extra = f" (+{len(neg) - 3} mas)" if len(neg) > 3 else ""
            notify(f"iSAMS: {len(neg)} cambio(s) negativo(s)", "; ".join(neg[:3]) + extra)
        print(f"{len(neg)} negativos, {len(pos)} positivos")
    else:
        print("Primera corrida: base guardada, sin comparar")
        log("base inicial guardada")
    with open(latest, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=1)
    if CI_ALERT:
        return 0  # git ya guarda el historial
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    with open(os.path.join(DATA, "history", f"{stamp}.json"), "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
