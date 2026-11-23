/**
 * Bodega de datos de iSAMS (esta hoja de calificaciones) + vigilante de sincronizacion.
 *
 * - doPost: recibe los datos ya validados desde GitHub Actions, firmados con HMAC-SHA256.
 *   Reescribe las pestañas de estado actual (sin duplicados), agrega historial y registro de corrida,
 *   y responde con los conteos que realmente quedaron escritos.
 * - vigilante(): corre cada hora. Si la ultima sincronizacion buena es vieja, o la ultima fallo,
 *   manda un correo (una vez por incidente) y, si hay token de GitHub, relanza la sincronizacion.
 *   Tambien compara las calificaciones de Classroom con las de iSAMS (pestaña "discrepancias") y avisa por correo
 *   de cada diferencia nueva.
 * - instalar(): se corre UNA vez desde el editor (pide los permisos), crea el activador horario y las
 *   pestañas base, y abre por 30 minutos la "ventana de configuracion" para que el instalador de tu
 *   computadora mande la clave secreta (accion "configurar" de doPost). Fuera de esa ventana nadie
 *   puede cambiar la configuracion.
 *
 * Pestañas que NO toca (son de la capa IA, de Classroom o manuales): pendientes, ceros_notas, ia_estado, maestros,
 * draft_log, cuaderno, soluciones, entregas_fisicas y las classroom*.
 */
function book_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}
var STATE_TABS = ['materias', 'categorias', 'evaluaciones', 'conducta', 'boletas'];
var MAX_SKEW_MS = 15 * 60 * 1000;

function doPost(e) {
  var out;
  try {
    out = handle_(e);
  } catch (err) {
    out = {ok: false, error: String(err && err.message || err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(e) {
  var props = PropertiesService.getScriptProperties();
  var body = JSON.parse(e.postData.contents);
  if (body.accion === 'configurar') return configurar_(props, body);
  var secret = props.getProperty('HMAC_SECRET');
  if (!secret) throw new Error('falta HMAC_SECRET; vuelve a correr el instalador');
  var expected = hex_(Utilities.computeHmacSha256Signature(body.payload, secret, Utilities.Charset.UTF_8));
  if (expected !== body.sig) throw new Error('firma invalida');
  var data = JSON.parse(body.payload);
  if (Math.abs(Date.now() - Date.parse(data.sent_at)) > MAX_SKEW_MS) throw new Error('mensaje vencido');
  if (data.accion === 'estado') return estado_();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Idempotencia: si GitHub reintenta el mismo envio (misma firma), no se vuelve a escribir nada.
    var cache = CacheService.getScriptCache();
    var seen = cache.get('sig:' + body.sig);
    if (seen) return JSON.parse(seen);
    var ss = book_();
    var counts = {};
    if (data.tables) {
      STATE_TABS.forEach(function (name) {
        var rows = data.tables[name];
        if (!rows) return;
        counts[name] = writeTable_(ss, name, data.columns[name], rows);
      });
      counts.resumen = writeKeyValue_(ss, 'resumen', data.tables.resumen || {});
    }
    var fresh = newChanges_(ss, data.changes || []);
    if (fresh.length) {
      counts.cambios = appendRows_(ss, 'cambios', data.columns.cambios, fresh);
      var neg = fresh.filter(function (c) { return c.negativo; });
      if (neg.length) {
        mail_('📉 iSAMS: ' + neg.length + ' cambio(s) a revisar', neg.map(function (c) {
          return '• ' + (c.materia ? c.materia + ': ' : '') + c.tipo + ' — ' + c.detalle +
                 (c.antes !== '' || c.despues !== '' ? ' (' + c.antes + ' → ' + c.despues + ')' : '');
        }).join('\n') + '\n\nDetalle en el dashboard.');
      }
    }
    appendRows_(ss, 'corridas', data.columns.corridas, [data.run]);
    SpreadsheetApp.flush();
    // relectura: lo que de verdad quedo escrito
    var verify = {};
    Object.keys(counts).forEach(function (name) {
      if (name === 'cambios') return;
      verify[name] = Math.max(0, ss.getSheetByName(name).getLastRow() - 1);
    });
    var result = {ok: true, written: counts, verified: verify};
    cache.put('sig:' + body.sig, JSON.stringify(result), 21600);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  // texto literal: que Sheets no lo convierta en fecha, hora, numero ni formula
  if (typeof v === 'string' && /^[\d=+\-@]/.test(v)) return "'" + v;
  return v;
}

/** Las pestañas nacen con 1000 filas y 26 columnas: crecerlas antes de escribir fuera de ese tamaño. */
function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

var KEEP_RUNS = 2000;  // ~100 dias de corridas; el historial completo de datos vive en git

function writeTable_(ss, name, cols, rows) {
  var sh = sheet_(ss, name);
  var values = [cols].concat(rows.map(function (r) { return cols.map(function (c) { return cell_(r[c]); }); }));
  ensureSize_(sh, values.length, cols.length);
  sh.clearContents();
  sh.getRange(1, 1, values.length, cols.length).setValues(values);
  sh.setFrozenRows(1);
  return rows.length;
}

function writeKeyValue_(ss, name, obj) {
  var rows = Object.keys(obj).map(function (k) { return {campo: k, valor: obj[k]}; });
  return writeTable_(ss, name, ['campo', 'valor'], rows);
}

function appendRows_(ss, name, cols, rows) {
  var sh = sheet_(ss, name);
  if (sh.getLastRow() === 0) sh.appendRow(cols);
  var values = rows.map(function (r) { return cols.map(function (c) { return cell_(r[c]); }); });
  ensureSize_(sh, sh.getLastRow() + values.length, cols.length);
  sh.getRange(sh.getLastRow() + 1, 1, values.length, cols.length).setValues(values);
  if (name === 'corridas' && sh.getLastRow() - 1 > KEEP_RUNS) sh.deleteRows(2, sh.getLastRow() - 1 - KEEP_RUNS);
  return rows.length;
}

/** Quita cambios que ya estan en el historial (p. ej. si un commit de GitHub no llego a guardarse). */
function newChanges_(ss, changes) {
  if (!changes.length) return [];
  var sh = ss.getSheetByName('cambios');
  var seen = {};
  if (sh && sh.getLastRow() > 1) {
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var ix = {};
    head.forEach(function (h, i) { ix[h] = i; });
    var start = Math.max(2, sh.getLastRow() - 1999);
    sh.getRange(start, 1, sh.getLastRow() - start + 1, head.length).getValues().forEach(function (r) {
      seen[[r[ix.tipo], r[ix.clave], r[ix.antes], r[ix.despues]].map(String).join('|')] = true;
    });
  }
  return changes.filter(function (c) {
    var k = [c.tipo, c.clave, c.antes, c.despues].map(function (v) { return String(v); }).join('|');
    return !seen[k];
  });
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ---------------- vigilante ---------------- */

function vigilante() {
  var props = PropertiesService.getScriptProperties();
  var staleHours = Number(props.getProperty('STALE_HOURS') || 8);
  var sh = book_().getSheetByName('corridas');
  var now = new Date();
  var problem = null, lastOk = null, last = null;
  if (!sh || sh.getLastRow() < 2) {
    problem = 'Todavia no hay ninguna corrida registrada.';
  } else {
    var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var h = data[0];
    var iEstado = h.indexOf('estado'), iFin = h.indexOf('fin'), iMsg = h.indexOf('errores'), iId = h.indexOf('run_id');
    for (var r = data.length - 1; r >= 1; r--) {
      var est = String(data[r][iEstado]);
      if (!last) last = {estado: est, fin: String(data[r][iFin]), msg: String(data[r][iMsg]), id: String(data[r][iId]),
                         inicio: String(data[r][h.indexOf('inicio')])};
      if (est === 'ok' || est === 'aviso') { lastOk = new Date(String(data[r][iFin]).replace(/^'/, '')); break; }
    }
    if (last && (last.estado === 'rechazado' || last.estado === 'error')) {
      problem = 'La ultima sincronizacion (' + last.fin + ') termino en "' + last.estado + '": ' + last.msg;
    } else if (!lastOk || (now - lastOk) > staleHours * 3600 * 1000) {
      problem = 'No hay una sincronizacion buena desde ' + (lastOk ? lastOk.toISOString() : 'nunca') +
                ' (limite: ' + staleHours + ' h).';
    }
  }
  var key = problem ? (last ? last.id + '|' + problem.slice(0, 40) : problem) : '';
  var alerted = props.getProperty('ALERTED') || '';
  // Reloj de respaldo: el cron de GitHub puede llegar horas tarde. Si hay token y la ultima corrida
  // empezo hace mas de 75 min dentro del horario (6-22 h y 3 h, hora de Mexico), se lanza una.
  var hora = Number(Utilities.formatDate(now, 'America/Mexico_City', 'H'));
  var enHorario = (hora >= 6 && hora <= 22) || hora === 3;
  var lastStart = last && last.inicio ? new Date(last.inicio.replace(/^'/, '')) : null;
  var atrasada = !lastStart || isNaN(lastStart) || (now - lastStart) > 75 * 60 * 1000;
  if (props.getProperty('GITHUB_TOKEN') && (problem || (enHorario && atrasada))) dispatch_(props, problem ? 'vigilante' : 'reloj');
  if (problem) {
    if (alerted !== key) {
      mail_('⚠️ iSAMS: la sincronizacion necesita atencion', problem +
            '\n\nEl sistema reintentara solo. Si esto se repite, revisa la pestaña "corridas" o pidele a Claude que lo revise.');
      props.setProperty('ALERTED', key);
    }
  } else if (alerted) {
    mail_('✅ iSAMS: la sincronizacion se recupero', 'Ultima sincronizacion buena: ' + lastOk.toISOString());
    props.deleteProperty('ALERTED');
  }
  try { revisarClassroom_(props, now); } catch (e) { Logger.log('revisarClassroom_: ' + e); }
  try { compararCalificaciones_(props, now); } catch (e) { Logger.log('compararCalificaciones_: ' + e); }
}

/* ---------------- calificaciones: Classroom contra iSAMS ---------------- */

/**
 * Materia de iSAMS → nombre con que empieza su curso en Classroom. Sale de la pestaña "materias_classroom"
 * (columnas materia_isams | curso_classroom), que Claude llena contigo la primera vez.
 */
function cursosClassroom_(ss) {
  var out = {};
  (tabla_(ss, 'materias_classroom') || []).forEach(function (r) {
    if (r.materia_isams && r.curso_classroom) out[String(r.materia_isams)] = String(r.curso_classroom);
  });
  return out;
}
var CAB_DISC = ['key', 'materia', 'trabajo', 'isams', 'classroom', 'diferencia', 'curso_classroom', 'link', 'detectada'];

/**
 * Compara cada trabajo calificado en Classroom con el mismo trabajo en iSAMS (misma materia y mismo titulo,
 * sin contar mayusculas, acentos, fechas ni signos; el titulo tiene que ser unico en las dos partes).
 * Si los porcentajes difieren en mas de medio punto, queda en la pestaña "discrepancias" y llega un correo
 * (una sola vez por cada diferencia).
 */
function compararCalificaciones_(props, now) {
  var ss = book_();
  var ev = tabla_(ss, 'evaluaciones'), cl = tabla_(ss, 'classroom'), cursos = cursosClassroom_(ss);
  if (!ev || !cl || !Object.keys(cursos).length) return;
  var materiaDe = function (curso) {
    for (var m in cursos) if (String(curso).indexOf(cursos[m]) === 0) return m;
    return null;
  };
  var enClassroom = {};
  cl.forEach(function (r) {
    if (r.tipo !== 'TAREA' && r.tipo !== 'PREGUNTA') return;
    var m = materiaDe(r.curso), t = normTitulo_(r.titulo);
    if (!m || t.length < 5) return;
    (enClassroom[m + '|' + t] = enClassroom[m + '|' + t] || []).push(r);
  });
  var vigentes = ev.filter(function (e) { return String(e.archivada) === 'no'; });
  var enIsams = {};
  vigentes.forEach(function (e) { var k = e.materia + '|' + normTitulo_(e.nombre); enIsams[k] = (enIsams[k] || 0) + 1; });

  var antes = {};
  (tabla_(ss, 'discrepancias') || []).forEach(function (d) { antes[d.key + '|' + d.isams + '|' + d.classroom] = String(d.detectada); });
  var hoy = Utilities.formatDate(now, 'America/Mexico_City', 'yyyy-MM-dd');
  var out = [];
  vigentes.forEach(function (e) {
    var t = normTitulo_(e.nombre), k = e.materia + '|' + t;
    if (t.length < 5 || enIsams[k] !== 1 || !enClassroom[k] || enClassroom[k].length !== 1) return;
    var c = enClassroom[k][0];
    var vi = num_(e.valor), si = num_(e.sobre), vc = num_(c.calificacion), pc = num_(c.puntos);
    if (vi === null || vc === null || !si || !pc) return;
    var dif = Math.round((vc / pc - vi / si) * 1000) / 10;   // puntos porcentuales, Classroom menos iSAMS
    if (Math.abs(dif) <= 0.5) return;
    var d = {key: String(e.key), materia: e.materia, trabajo: e.nombre, isams: vi + '/' + si, classroom: vc + '/' + pc,
             diferencia: dif, curso_classroom: c.curso, link: c.link};
    d.detectada = antes[d.key + '|' + d.isams + '|' + d.classroom] || hoy;
    out.push(d);
  });
  writeTable_(ss, 'discrepancias', CAB_DISC, out);

  var firma = function (d) { return d.key + '|' + d.isams + '|' + d.classroom; };
  var avisadas = JSON.parse(props.getProperty('DISC_AVISADAS') || '[]');
  var nuevas = out.filter(function (d) { return avisadas.indexOf(firma(d)) < 0; });
  if (nuevas.length) {
    mail_('📝 Calificación distinta en Classroom e iSAMS (' + nuevas.length + ')', nuevas.map(function (d) {
      return '• ' + d.materia + ' — ' + d.trabajo + ': iSAMS ' + d.isams + ', Classroom ' + d.classroom + '\n  ' + d.link;
    }).join('\n') + '\n\nLa calificación oficial es la de iSAMS. Puede ser que el maestro aún no la actualice o un error de ' +
      'captura; si crees que es un error, pregúntale. Lista completa en el dashboard (Sistema → Calificaciones distintas).');
  }
  props.setProperty('DISC_AVISADAS', JSON.stringify(out.map(firma)));
}

/** Pestaña → lista de objetos con los nombres de la primera fila. */
function tabla_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  return v.slice(1).map(function (r) {
    var o = {};
    v[0].forEach(function (h, i) { o[String(h)] = typeof r[i] === 'string' ? r[i].trim() : r[i]; });
    return o;
  });
}

/** Titulo comparable: sin mayusculas, acentos, fechas (dd/mm/aaaa) ni signos. */
function normTitulo_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/** El script de Classroom (cuenta de la escuela) escribe classroom_estado cada hora: avisar si se atrasa o falla. */
function revisarClassroom_(props, now) {
  var sh = book_().getSheetByName('classroom_estado');
  if (!sh || sh.getLastRow() < 2) return;
  var kv = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { kv[String(r[0])] = String(r[1]); });
  var ult = new Date(String(kv.ultima_corrida || '').replace(' ', 'T') + ':00-06:00');   // hora de Mexico (sin horario de verano)
  var prob = null;
  if (kv.estado === 'error') prob = 'La lectura de Classroom fallo: ' + kv.avisos;
  else if (isNaN(ult) || now - ult > 6 * 3600 * 1000) prob = 'Classroom no se actualiza desde ' + (kv.ultima_corrida || 'nunca') + '.';
  var alerted = props.getProperty('ALERTED_CR') || '';
  if (prob && alerted !== prob.slice(0, 80)) {
    mail_('⚠️ Classroom: la lectura necesita atencion', prob + '\n\nLo lee el script "Classroom → calificaciones" de tu cuenta de la escuela ' +
          '(script.google.com). Si dice que falta autorizar, abrelo y corre instalarReloj().');
    props.setProperty('ALERTED_CR', prob.slice(0, 80));
  } else if (!prob && alerted) {
    mail_('✅ Classroom: la lectura se recupero', 'Ultima lectura: ' + kv.ultima_corrida);
    props.deleteProperty('ALERTED_CR');
  }
}

function dispatch_(props, origen) {
  var repo = props.getProperty('GITHUB_REPO');
  if (!repo) return;
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/actions/workflows/sync.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + props.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json'},
    payload: JSON.stringify({ref: 'main', inputs: {origen: origen || 'vigilante'}})
  });
  if (res.getResponseCode() !== 204) {
    mail_('⚠️ iSAMS: el vigilante no pudo relanzar la sincronizacion',
          'GitHub respondio ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300) +
          '\nProbablemente el token de GitHub vencio.');
  }
}

function mail_(subject, body) {
  var to = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, subject, body);
}

/* ---------------- instalacion ---------------- */

var VENTANA_MIN = 30;
var PESTANAS_BASE = {
  materias_classroom: ['materia_isams', 'curso_classroom'],
  maestros: ['materia', 'nombre', 'correo', 'genero', 'notas'],
  cuaderno: ['Materia (como en iSAMS)', 'Materia en tus apuntes', 'Apuntes hasta'],
  entregas_fisicas: ['key', 'materia', 'trabajo', 'nota', 'agregado'],
  pendientes: ['Materia', 'Tarea', 'Fecha', 'Estado', 'Razón', 'Prompt'],
  ceros_notas: ['key', 'materia', 'que_pedia', 'estado_classroom'],
  draft_log: ['clave', 'fecha'],
  ia_estado: ['campo', 'valor'],
  soluciones: ['publicacion_id', 'materia', 'titulo', 'fecha_limite', 'archivos', 'firma', 'estado', 'generado', 'link', 'solucion']
};

/** Correla UNA vez desde el editor: pide permisos, crea el reloj y las pestañas y abre la ventana de configuracion. */
function instalar() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActive() || book_();
  if (ss && !props.getProperty('SHEET_ID')) props.setProperty('SHEET_ID', ss.getId());
  ss = book_();
  Object.keys(PESTANAS_BASE).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); }
    if (sh.getLastRow() === 0) { sh.appendRow(PESTANAS_BASE[name]); sh.setFrozenRows(1); }
  });
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && ss.getSheets().length > 1 && hoja1.getLastRow() === 0) ss.deleteSheet(hoja1);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'vigilante') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('vigilante').timeBased().everyHours(1).create();
  props.setProperty('CONFIG_HASTA', String(Date.now() + VENTANA_MIN * 60 * 1000));
  Logger.log('Listo: permisos, reloj y pestañas. Regresa a la terminal y presiona Enter (tienes ' + VENTANA_MIN + ' minutos).');
}

/**
 * La llama el instalador de tu computadora (POST {accion:'configurar', ...}) mientras la ventana esta abierta.
 * Guarda la clave HMAC y, si vienen, el repo, el token del reloj de respaldo y el correo de alertas;
 * comparte la hoja con tu cuenta de la escuela. Despues cierra la ventana.
 */
function configurar_(props, body) {
  var hasta = Number(props.getProperty('CONFIG_HASTA') || 0);
  if (!hasta || Date.now() > hasta) throw new Error('ventana de configuracion cerrada: corre instalar() en el editor y vuelve a intentar');
  if (!/^[0-9a-f]{64}$/.test(String(body.secreto || ''))) throw new Error('clave invalida (se esperan 64 caracteres hex)');
  props.setProperty('HMAC_SECRET', body.secreto);
  if (body.repo) props.setProperty('GITHUB_REPO', String(body.repo));
  if (body.token) props.setProperty('GITHUB_TOKEN', String(body.token)); else props.deleteProperty('GITHUB_TOKEN');
  if (body.correo_alertas) props.setProperty('ALERT_EMAIL', String(body.correo_alertas));
  var ss = book_(), compartida = '';
  if (body.compartir_con) {
    ss.addEditor(String(body.compartir_con));
    compartida = String(body.compartir_con);
  }
  props.deleteProperty('CONFIG_HASTA');
  return {ok: true, huella: huella_(body.secreto), hoja: ss.getId(), compartida_con: compartida, reloj: !!body.token};
}

/** Resumen para el instalador (peticion firmada): ultima corrida, cuantas materias y el estado de Classroom. */
function estado_() {
  var ss = book_(), out = {ok: true, hoja: ss.getId(), materias: 0, ultima_corrida: null, classroom: null};
  var m = ss.getSheetByName('materias');
  if (m) out.materias = Math.max(0, m.getLastRow() - 1);
  var c = tabla_(ss, 'corridas');
  if (c && c.length) {
    var u = c[c.length - 1];
    out.ultima_corrida = {estado: String(u.estado), fin: String(u.fin), evaluaciones: u.evaluaciones, errores: String(u.errores || '')};
  }
  var cr = tabla_(ss, 'classroom_estado');
  if (cr) { out.classroom = {}; cr.forEach(function (r) { out.classroom[String(r.campo)] = String(r.valor); }); }
  return out;
}

function huella_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'huella:' + s, Utilities.Charset.UTF_8)).slice(0, 8);
}

/** Prueba de alerta: manda un correo de prueba para confirmar que llegan. */
function probarAlerta() {
  mail_('🔔 iSAMS: correo de prueba', 'Si ves esto, las alertas del vigilante te llegan bien.');
}

/** Muestra una huella corta de la clave (no la clave) para compararla con la de GitHub. */
function huellaClave() {
  var s = PropertiesService.getScriptProperties().getProperty('HMAC_SECRET') || '';
  Logger.log('huella ' + huella_(s) + ', ' + s.length + ' caracteres');
}
