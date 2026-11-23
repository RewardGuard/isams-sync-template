#!/usr/bin/env python3
"""Sincronizacion v2: login -> extraccion completa -> validacion -> historial -> hoja -> verificacion.

Codigos de salida: 0 bien (con o sin avisos), 1 fallo (GitHub manda correo y el vigilante avisa).
Con errores de validacion NO se sobrescriben los datos buenos anteriores.
"""
import datetime
import json
import os
import sys
import traceback

from isams import api, extract, model, validate, changes, sheets

DATA = os.environ.get("ISAMS_DATA_DIR", "data")
STATE = os.path.join(DATA, "state.json")
CHANGES = os.path.join(DATA, "changes.jsonl")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def load_previous():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def main():
    run = {"run_id": os.environ.get("GITHUB_RUN_ID", "local") + "-" + os.environ.get("GITHUB_RUN_ATTEMPT", "1"),
           "inicio": now(), "origen": os.environ.get("RUN_ORIGIN", "manual"),
           "commit": os.environ.get("GITHUB_SHA", "")[:7], "avisos": "", "errores": "",
           "datos_cambiaron": False}
    tables = None
    try:
        print("1/5 login")
        api.login()
        print("2/5 extraccion")
        raw = extract.fetch_all()
        print("3/5 validacion")
        errs = validate.validate_raw(raw)
        if not errs:
            tables, issues = model.build_tables(raw)
            prev = load_previous()
            errs, warns = validate.validate_tables(tables, issues, prev)
        if errs:
            run.update(estado="rechazado", errores=" | ".join(errs)[:4000], fin=now())
            print("RECHAZADO:\n  " + "\n  ".join(errs))
            _report_only(run)
            return 1
        ch = changes.diff(prev, tables, run["run_id"], run["inicio"])
        run.update(materias=len(tables["materias"]), evaluaciones=len(tables["evaluaciones"]),
                   conducta=len(tables["conducta"]), cambios=len(ch), avisos=" | ".join(warns)[:4000],
                   estado="aviso" if warns else "ok")
        print(f"   {run['materias']} materias, {run['evaluaciones']} evaluaciones, {run['conducta']} conducta, "
              f"{len(ch)} cambios, {len(warns)} avisos")
        print("4/5 guardar historial")
        os.makedirs(DATA, exist_ok=True)
        stable = {k: v for k, v in tables.items()}
        if prev is None or _strip(prev) != _strip(stable):
            run["datos_cambiaron"] = True
            with open(STATE, "w", encoding="utf-8") as f:
                json.dump(stable, f, ensure_ascii=False, indent=1, sort_keys=True)
            with open(CHANGES, "a", encoding="utf-8") as f:
                for c in ch:
                    f.write(json.dumps(c, ensure_ascii=False) + "\n")
        print("5/5 hoja")
        tables["resumen"] = dict(tables["resumen"], actualizado=run["inicio"],
                                 gpa_por_trimestre=json.dumps(tables["resumen"]["gpa_por_trimestre"], ensure_ascii=False))
        run["fin"] = now()
        sheet_tables = {k: tables[k] for k in ("materias", "categorias", "evaluaciones", "conducta", "boletas", "resumen")}
        if os.environ.get("DRY_RUN") == "1":
            print("DRY_RUN: no se envia a la hoja")
            with open(os.path.join(DATA, "dry_run.json"), "w", encoding="utf-8") as f:
                json.dump({"run": run, "changes": ch, "tables": sheet_tables}, f, ensure_ascii=False, indent=1)
            return 0
        resp = sheets.post(sheet_tables, ch, run)
        problems = sheets.verify(resp, sheet_tables)
        if problems:
            raise sheets.SheetsError("Verificacion de la hoja fallo: " + "; ".join(problems))
        print("OK", json.dumps(resp.get("verified")))
        return 0
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        kind = "auth" if isinstance(e, api.AuthError) else type(e).__name__
        run.update(estado="error", errores=f"[{kind}] {e}"[:4000], fin=now())
        _report_only(run)
        return 1


def _strip(t):
    t = dict(t)
    r = dict(t.get("resumen") or {})
    r.pop("actualizado", None)
    t["resumen"] = r
    return json.dumps(t, sort_keys=True, ensure_ascii=False)


def _report_only(run):
    """Registra la corrida fallida en la hoja sin tocar los datos buenos."""
    if os.environ.get("DRY_RUN") == "1":
        print("DRY_RUN corrida:", json.dumps(run, ensure_ascii=False))
        return
    try:
        sheets.post(None, [], run)
    except Exception as e:  # noqa: BLE001
        print("No se pudo registrar la corrida en la hoja:", e)


if __name__ == "__main__":
    sys.exit(main())
