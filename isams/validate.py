"""Validaciones de contenido. Un HTTP 200 no basta: aqui se decide si los datos son confiables.

Devuelve (errores, avisos). Con un error NO se sobrescriben los datos buenos anteriores.
"""
import os

EXPECT_STUDENT = os.environ.get("ISAMS_EXPECT_NAME", "").strip()   # opcional: tu primer nombre, como sale en iSAMS
REQUIRED_COL_KEYS = {"id", "name", "type", "value", "parentGroupings"}


def validate_raw(raw):
    errors = []
    prof = raw.get("profile") or {}
    if EXPECT_STUDENT and (prof.get("forename") or "").strip().lower() != EXPECT_STUDENT.lower():
        errors.append(f"El perfil no es del alumno esperado (forename={prof.get('forename')!r})")
    students = (raw.get("student") or {}).get("students") or []
    if len(students) != 1:
        errors.append(f"Se esperaba 1 alumno en el portal y llegaron {len(students)}")
    terms = raw.get("terms") or {}
    if not (terms.get("terms") if isinstance(terms, dict) else terms):
        errors.append("La lista de periodos llego vacia")
    books = raw.get("markbooks") or []
    current = [m for m in books if not m["book"].get("name", "").startswith("z(Archive)")]
    if not current:
        errors.append("No llego ningun gradebook vigente")
    for m in books:
        name = m["book"].get("name")
        for col in m["columns"]:
            missing = REQUIRED_COL_KEYS - set(col)
            if missing:
                errors.append(f"{name}: columna {col.get('id')} sin campos {sorted(missing)}")
                break
            if str(col["id"]) not in m["details"]:
                errors.append(f"{name}: falta el detalle (peso) de la columna {col['id']}")
                break
            v = col.get("value")
            if v not in (None, "") and _num(v) is None:
                errors.append(f"{name}: valor no numerico {v!r} en {col.get('name')!r}")
    types = (raw.get("reward_types") or {}).get("rewardTypes") or []
    if not types:
        errors.append("No llegaron los tipos de conducta")
    for tid, rec in (raw.get("conduct") or {}).items():
        if not isinstance(rec, dict) or "rewards" not in rec:
            errors.append(f"Conducta tipo {tid}: formato inesperado")
    if "reports" not in (raw.get("reports") or {}):
        errors.append("La lista de boletas tiene formato inesperado")
    return errors


def validate_tables(tables, model_issues, previous):
    """Compara contra la ultima corrida buena para detectar perdidas de informacion."""
    errors, warnings = [], [t for _, t in model_issues]
    errors += [t for lvl, t in model_issues if lvl == "error"]
    for m in tables["materias"]:
        for k in ("total_oficial", "total_calculado"):
            v = m.get(k)
            if v is not None and not (0 <= v <= 100):
                errors.append(f"{m['materia']}: {k}={v} fuera de 0-100")
    for e in tables["evaluaciones"]:
        if e["valor"] is not None and e["sobre"] and not (0 <= e["valor"] <= e["sobre"] * 1.5):
            warnings.append(f"{e['materia']}: '{e['nombre']}' vale {e['valor']} sobre {e['sobre']}")
    if previous:
        prev_eval = {e["key"] for e in previous.get("evaluaciones", [])}
        now_eval = {e["key"] for e in tables["evaluaciones"]}
        lost = prev_eval - now_eval
        if prev_eval and len(lost) > max(3, 0.2 * len(prev_eval)):
            errors.append(f"Desaparecieron {len(lost)} de {len(prev_eval)} evaluaciones respecto a la corrida anterior")
        elif lost:
            warnings.append(f"{len(lost)} evaluaciones ya no aparecen en iSAMS (se conservan en el historial)")
        prev_books = {m["id"] for m in previous.get("materias", []) if not m.get("archivada")}
        now_books = {m["id"] for m in tables["materias"]}
        gone = prev_books - now_books
        if len(gone) > 2:
            errors.append(f"Desaparecieron {len(gone)} materias vigentes respecto a la corrida anterior")
        prev_cond = {c["id"] for c in previous.get("conducta", [])}
        now_cond = {c["id"] for c in tables["conducta"]}
        if prev_cond - now_cond:
            warnings.append(f"{len(prev_cond - now_cond)} registros de conducta ya no aparecen en iSAMS")
    return errors, warnings


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
