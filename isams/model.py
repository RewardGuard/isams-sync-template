"""Convierte las respuestas crudas en tablas limpias, sin inventar nada.

Reglas descubiertas en la Fase 0 (comprobadas contra el portal en pantalla):
- Cada gradebook trae columnas "Assessment" (trabajos) y "Calculation" (promedios).
- El total oficial del trimestre es la Calculation de un solo nivel de agrupacion
  cuyo nombre no contiene "AVG". Algunas materias (Tech) no publican total.
- Los promedios por categoria son Calculations; su peso real = weightedValue / value
  (endpoint .../columns/{id}/details).
"""
import datetime
import re

import os

# Materias que no cuentan para el GPA (talleres) y materias avanzadas (+1 en el GPA ponderado).
# Se cambian con las variables ISAMS_NO_GPA e ISAMS_AVANZADAS (listas separadas por comas; basta un pedazo del nombre).
NO_GPA = tuple(x for x in os.environ.get("ISAMS_NO_GPA", "WS ").split(",") if x.strip())
ADVANCED = tuple(x.strip() for x in os.environ.get("ISAMS_AVANZADAS", "ADV").split(",") if x.strip())


def num(v):
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def parse_book_name(name):
    archived = name.startswith("z(Archive)")
    clean = name.replace("z(Archive)", "").strip()
    year = None
    m = re.search(r"(\d\d)-(\d\d)\b", clean)
    if m:
        year = 2000 + int(m.group(1))
    term = None
    m = re.search(r"\bT([123])\b", clean)
    if m:
        term = int(m.group(1))
    short = re.sub(r"\s+\d\d-\d\d\b.*$", "", clean)          # quita "26-27 ..."
    short = re.sub(r"\s+(9|9B|8B|7B|8|7)(?=\s|$)", "", short)  # quita grupo
    short = re.sub(r"\s+T[123]\b", "", short)
    short = re.sub(r"\s+MS\b", "", short).strip()
    return {"archived": archived, "school_year": year, "term_num": term, "subject": short}


def date_in_name(name):
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", name or "")
    if not m:
        return ""
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    y = y + 2000 if y < 100 else y
    try:
        return datetime.date(y, mo, d).isoformat()
    except ValueError:
        return ""


def gpa_points(x):
    return 4 if x >= 90 else 3 if x >= 80 else 2 if x >= 70 else 1 if x >= 60 else 0


def build_book(entry):
    book, cols, details = entry["book"], entry["columns"], entry["details"]
    meta = parse_book_name(book.get("name", ""))
    issues = []
    totals, cat_calcs, assessments = [], [], []
    pending = []  # trabajos desde el ultimo promedio, para ligar promedios de un nivel
    for col in cols:
        groups = [g.get("name", "") for g in (col.get("parentGroupings") or [])]
        det = details.get(str(col["id"])) or {}
        value_raw = col.get("value")
        if col.get("type") == "Calculation":
            if len(groups) == 1 and "AVG" not in (col.get("name") or "").upper():
                totals.append(col)
                continue
            if len(groups) >= 2:
                cat = groups[-1]
            else:
                pend_groups = {p["category"] for p in pending}
                cat = pend_groups.pop() if len(pend_groups) == 1 else (col.get("name") or "")
            cat_calcs.append({"category": cat, "name": col.get("name", ""),
                              "value": num(value_raw), "weighted": num(det.get("weightedValue")),
                              "column_id": col["id"]})
            pending = []
        else:
            cat = groups[-1] if len(groups) >= 2 else ""
            row = {"column_id": col["id"], "category": cat, "name": (col.get("name") or "").strip(),
                   "value": num(value_raw), "value_text": "" if value_raw is None else str(value_raw),
                   "out_of": num(col.get("outOf")), "submitted": col.get("submitted"),
                   "absent": bool(col.get("absent")), "has_comments": bool(col.get("hasComments")),
                   "weighted": num(det.get("weightedValue")),
                   "date_in_name": date_in_name(col.get("name"))}
            assessments.append(row)
            pending.append(row)
    if len(totals) > 1:
        issues.append(("error", f"{book['name']}: {len(totals)} columnas candidatas a total"))
    official = num(totals[0].get("value")) if totals else None

    # categorias
    by_cat = {}
    for a in assessments:
        by_cat.setdefault(_norm(a["category"]), []).append(a)
    categories = []
    for cc in cat_calcs:
        items = by_cat.get(_norm(cc["category"]), [])
        vals = [a["value"] for a in items if a["value"] is not None]
        recomputed = sum(vals) / len(vals) if vals else None
        weight = (cc["weighted"] / cc["value"]) if (cc["value"] and cc["weighted"] is not None) else None
        match = (recomputed is not None and cc["value"] is not None and abs(recomputed - cc["value"]) <= 0.6)
        if not meta["archived"] and recomputed is not None and cc["value"] is not None and not match:
            issues.append(("aviso", f"{meta['subject']}: el promedio de '{cc['category']}' en iSAMS es "
                                    f"{cc['value']:g} pero sus trabajos publicados dan {recomputed:.1f}; "
                                    "probablemente hay algo no publicado en esa categoria"))
        categories.append({"category": cc["category"], "isams_avg": cc["value"],
                           "weight": None if weight is None else round(weight, 4),
                           "weighted": cc["weighted"], "n_items": len(items),
                           "n_graded": len(vals), "recomputed_avg": None if recomputed is None else round(recomputed, 2),
                           "matches": match})
    linked = {_norm(c["category"]) for c in categories}
    for key, items in by_cat.items():
        if not meta["archived"] and key not in linked and any(a["value"] is not None for a in items):
            issues.append(("aviso", f"{meta['subject']}: la categoria '{items[0]['category']}' no tiene promedio publicado"))

    known = [c for c in categories if c["weight"] is not None and c["weighted"] is not None]
    wsum = sum(c["weight"] for c in known)
    computed = (sum(c["weighted"] for c in known) / wsum) if wsum > 0 else None
    if not meta["archived"] and official is not None and computed is not None and abs(round(computed) - official) > 0.5 and abs(computed - official) > 0.6:
        issues.append(("aviso", f"{meta['subject']}: la suma ponderada de las categorias da {computed:.1f} "
                                f"pero el total oficial de iSAMS es {official:g}"))
    shown = official if official is not None else (round(computed, 1) if computed is not None else None)

    # escenarios para ceros con pesos reales
    catinfo = {_norm(c["category"]): c for c in categories}
    for a in assessments:
        a["if_100"] = None
        if a["value"] == 0 and shown is not None and wsum > 0:
            c = catinfo.get(_norm(a["category"]))
            if c and c["weight"] and c["n_graded"]:
                delta = c["weight"] * (100.0 / c["n_graded"]) / wsum
                a["if_100"] = round(min(100.0, shown + delta), 1)
                a["if_100_exact"] = bool(c["matches"])
    return {"meta": meta, "book": book, "official_total": official,
            "computed_total": None if computed is None else round(computed, 2),
            "shown_total": shown, "weights_sum": round(wsum, 4), "categories": categories,
            "assessments": assessments, "issues": issues}


def current_term(terms, today):
    for t in terms:
        if t["startDate"] <= today <= t["finishDate"]:
            return t
    future = [t for t in terms if t["startDate"] > today]
    return min(future, key=lambda t: t["startDate"]) if future else max(terms, key=lambda t: t["startDate"])


def build_tables(raw, today=None):
    today = today or datetime.date.today().isoformat()
    terms = raw["terms"]["terms"] if isinstance(raw["terms"], dict) else raw["terms"]
    cur = current_term(terms, today)
    stu = (raw["student"].get("students") or [{}])[0] if isinstance(raw["student"], dict) else {}
    books = [build_book(e) for e in raw["markbooks"]]
    issues = [i for b in books for i in b["issues"]]

    materias, categorias, evaluaciones = [], [], []
    for b in books:
        m, bid = b["meta"], b["book"]["id"]
        is_current_year = m["school_year"] == cur["schoolYear"] and not m["archived"]
        counts_gpa = (is_current_year and b["shown_total"] is not None
                      and not any(k in m["subject"] for k in NO_GPA)
                      and not (b["official_total"] is None and b["computed_total"] is None))
        pts = gpa_points(b["shown_total"]) if counts_gpa else None
        graded = [a for a in b["assessments"] if a["value"] is not None]
        materias.append({
            "id": bid, "materia": m["subject"], "nombre_isams": b["book"]["name"],
            "ciclo": f"{m['school_year']}-{(m['school_year'] or 0) + 1}" if m["school_year"] else "",
            "trimestre": m["term_num"] or "", "archivada": m["archived"],
            "total_oficial": b["official_total"], "total_calculado": b["computed_total"],
            "total": b["shown_total"], "total_es_calculado": b["official_total"] is None and b["shown_total"] is not None,
            "suma_pesos": b["weights_sum"], "evaluaciones": len(b["assessments"]),
            "calificadas": len(graded), "ceros": sum(1 for a in graded if a["value"] == 0),
            "cuenta_gpa": bool(pts is not None), "puntos_gpa": pts,
            "gpa_ponderado": None if pts is None else pts + (1 if any(k in m["subject"] for k in ADVANCED) else 0),
            "avisos": " | ".join(t for _, t in b["issues"])})
        for c in b["categories"]:
            categorias.append({"materia_id": bid, "materia": m["subject"], "trimestre": m["term_num"] or "",
                               "categoria": c["category"], "promedio_isams": c["isams_avg"],
                               "peso": c["weight"], "aporte": c["weighted"], "trabajos": c["n_items"],
                               "calificados": c["n_graded"], "promedio_recalculado": c["recomputed_avg"],
                               "coincide": c["matches"]})
        for a in b["assessments"]:
            evaluaciones.append({"key": f"{bid}:{a['column_id']}", "materia_id": bid, "materia": m["subject"],
                                 "trimestre": m["term_num"] or "", "archivada": m["archived"],
                                 "categoria": a["category"], "nombre": a["name"], "valor": a["value"],
                                 "valor_texto": a["value_text"], "sobre": a["out_of"],
                                 "entregado": a["submitted"], "ausente": a["absent"],
                                 "fecha_en_nombre": a["date_in_name"], "si_vale_100": a.get("if_100"),
                                 "escenario_exacto": a.get("if_100_exact")})

    types = {str(t["id"]): t.get("name", "") for t in (raw["reward_types"].get("rewardTypes") or [])}
    conducta = []
    for tid, rec in raw["conduct"].items():
        for r in (rec.get("rewards") or []):
            fecha = (r.get("awardedOn") or "")[:10]
            conducta.append({"id": r["id"], "tipo": types.get(tid, tid), "categoria": r.get("categoryName", ""),
                             "maestro": (r.get("teacher") or {}).get("fullName", ""), "fecha": fecha,
                             "descripcion": (r.get("description") or "").strip(),
                             "ciclo_actual": fecha >= _year_start(terms, cur)})
    conducta.sort(key=lambda r: r["fecha"], reverse=True)
    boletas = [{"id": r["id"], "nombre": r.get("reportName", ""), "trimestre": r.get("termName", ""),
                "ciclo": r.get("reportYear"), "publicada": r.get("publishedOn", "")}
               for r in (raw["reports"].get("reports") or [])]
    gpa_trim = {}
    for t in sorted({m["trimestre"] for m in materias if m["cuenta_gpa"]}):
        gp = [m for m in materias if m["cuenta_gpa"] and m["trimestre"] == t]
        gpa_trim[f"T{t}"] = {"gpa": round(sum(m["puntos_gpa"] for m in gp) / len(gp), 2),
                             "gpa_ponderado": round(sum(m["gpa_ponderado"] for m in gp) / len(gp), 2),
                             "materias": len(gp)}
    resumen = {
        "alumno": stu.get("fullName") or "", "grupo": stu.get("formGroup") or "",
        "casa": stu.get("academicHouse") or "",
        "periodo_actual": f"{cur['name']} {cur['schoolYear']}-{cur['schoolYear'] + 1}",
        "periodo_inicio": cur["startDate"], "periodo_fin": cur["finishDate"],
        "gpa_por_trimestre": gpa_trim,
        "gpa_escala": "90+=4, 80-89=3, 70-79=2, 60-69=1, <60=0; +1 en ponderado para " + (", ".join(ADVANCED) or "ninguna") + "; sin " + (", ".join(x.strip() for x in NO_GPA) or "excepciones"),
    }
    return {"resumen": resumen, "materias": materias, "categorias": categorias,
            "evaluaciones": evaluaciones, "conducta": conducta, "boletas": boletas,
            "periodos": terms}, issues


def _year_start(terms, cur):
    same = [t["startDate"] for t in terms if t["schoolYear"] == cur["schoolYear"]]
    return min(same) if same else cur["startDate"]
