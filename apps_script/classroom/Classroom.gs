/**
 * Google Classroom → tu hoja de calificaciones. SOLO LEE Classroom y Drive: no entrega, no edita, no borra.
 *
 * Se instala con tu CUENTA DE LA ESCUELA (la de Classroom). El instalador crea Config.gs con el id de la hoja
 * (CONFIG.SHEET_ID); la hoja es de tu cuenta personal y ya esta compartida con la de la escuela.
 * Escribe solo estas pestañas (las crea si faltan) y no toca ninguna otra:
 *   classroom           una fila por publicacion: tarea, pregunta, material o anuncio, con instrucciones
 *                       completas, fecha limite, el ESTADO DE TU ENTREGA y cuantos archivos subiste
 *   classroom_adjuntos  una fila por adjunto (del maestro o tuyo), con link y el texto si es Doc/Slides/texto
 *   classroom_estado    cuando corrio, cuanto trajo y si hubo problemas
 *   classroom_archivos  (oculta) copia en base64 de los PDF, imagenes, Word y PowerPoint que el maestro adjunto
 *                       a las tareas PENDIENTES recientes, partida en trozos de 45 000 caracteres por celda,
 *                       para que la capa de IA pueda leer las hojas de ejercicios (la IA no tiene acceso al Drive
 *                       de la escuela). Solo se vuelve a descargar un archivo si el maestro lo cambio.
 *
 * El manifiesto activa los servicios avanzados Classroom y Drive: Drive se necesita aunque el texto se lea
 * con UrlFetch, porque asi queda habilitada la API de Drive en el proyecto (sin eso responde 403).
 *
 * Funciones:
 *   probar()         pide los permisos y comprueba Classroom, Drive y la hoja. Corre esta primero.
 *   sincronizar()    llena las pestañas (la llama el reloj cada hora).
 *   instalarReloj()  programa sincronizar() cada hora.
 */
/** Id de la hoja: lo pone el instalador en Config.gs (o en la propiedad del script SHEET_ID). */
function hojaId_() {
  if (typeof CONFIG !== 'undefined' && CONFIG.SHEET_ID) return CONFIG.SHEET_ID;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Falta el id de la hoja: vuelve a correr el instalador.');
  return id;
}
var DIAS_ATRAS = 120;        // publicaciones de los ultimos N dias
var MAX_TEXTO = 20000;       // caracteres de texto por adjunto
var MAX_CELDA = 49000;       // una celda de Sheets aguanta 50 000
var SEGUNDOS_TEXTO = 240;    // tiempo maximo para leer textos de Drive; lo que falte se lee en la siguiente corrida
var TZ = 'America/Mexico_City';

// Archivos de las tareas pendientes (para que la IA lea las hojas de ejercicios)
var CAB_ARCH = ['file_id', 'publicacion_id', 'curso', 'titulo_publicacion', 'nombre', 'mime', 'modificado', 'bytes',
  'parte', 'partes', 'nota', 'base64'];
var MIME_ARCHIVO = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation))$/;
var MAX_ARCHIVO = 4 * 1024 * 1024;           // bytes por archivo
var MAX_ARCHIVOS_TOTAL = 15 * 1024 * 1024;   // bytes entre todos
var TROZO = 45000;                           // caracteres de base64 por celda
var SEGUNDOS_ARCHIVOS = 300;                 // despues de esto ya no se descarga nada nuevo (el limite de Apps Script es 360)
var DIAS_LIMITE_ATRAS = 14;                  // tareas cuya fecha limite fue hace 14 dias o menos, o es futura
var DIAS_SIN_FECHA = 30;                     // tareas sin fecha limite publicadas en los ultimos 30 dias
var PENDIENTE = {sin_entregar: 1, sin_abrir: 1, retirado: 1};

// Classroom NO da al alumno el historial de su entrega (cuando entrego): solo el estado actual y sus archivos.
// Por eso "devuelto" no prueba que se haya entregado: el maestro tambien devuelve trabajos no entregados.
// La evidencia es adjuntos_mios (> 0 = subiste archivos) o estado "entregado".
var CAB = ['curso', 'seccion', 'curso_id', 'id', 'tipo', 'titulo', 'instrucciones', 'publicado', 'fecha_limite',
  'puntos', 'estado_entrega', 'tarde', 'calificacion', 'adjuntos_mios', 'ultimo_cambio', 'adjuntos_maestro', 'link'];
var CAB_ADJ = ['curso', 'publicacion_id', 'titulo_publicacion', 'origen', 'tipo', 'nombre', 'url', 'file_id',
  'mime', 'modificado', 'texto', 'nota'];

var ESTADOS = {NEW: 'sin_abrir', CREATED: 'sin_entregar', TURNED_IN: 'entregado', RETURNED: 'devuelto',
  RECLAIMED_BY_STUDENT: 'retirado'};
var TIPOS = {ASSIGNMENT: 'TAREA', SHORT_ANSWER_QUESTION: 'PREGUNTA', MULTIPLE_CHOICE_QUESTION: 'PREGUNTA'};

/* ───────────── funciones que corres tu ───────────── */

function probar() {
  var cursos = cursos_();
  Logger.log('Classroom OK: ' + cursos.length + ' clases activas: ' + cursos.map(function (c) { return c.name; }).join(' | '));
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', auth_());
  Logger.log('Drive ' + (r.getResponseCode() === 200 ? 'OK' : 'FALLO (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 400)));
  Logger.log('Hoja OK: "' + SpreadsheetApp.openById(hojaId_()).getName() + '"');
}

function instalarReloj() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  Logger.log('Reloj instalado: sincronizar() cada hora.');
}

function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('Ya hay una corrida en curso.'); return; }
  var inicio = Date.now();
  var libro = SpreadsheetApp.openById(hojaId_());
  try {
    var r = recolectar_(libro, inicio);
    escribir_(libro, 'classroom', CAB, r.filas);
    escribir_(libro, 'classroom_adjuntos', CAB_ADJ, r.adj);
    // Los archivos van aparte: si algo falla aqui, lo de arriba ya quedo guardado.
    var ar = {guardados: 0, omitidos: 0, bytes: 0, descargados: 0};
    try { ar = archivos_(libro, r, inicio); } catch (e) { r.avisos.push('archivos de tareas: ' + (e && e.message || e)); }
    estado_(libro, {
      ultima_corrida: ahora_(), estado: r.avisos.length ? 'aviso' : 'ok', cursos: r.cursos,
      publicaciones: r.filas.length, adjuntos: r.adj.length, textos_leidos: r.leidos,
      textos_pendientes: r.pendientes, archivos_guardados: ar.guardados, archivos_mb: mb_(ar.bytes),
      archivos_omitidos: ar.omitidos, segundos: Math.round((Date.now() - inicio) / 1000),
      avisos: r.avisos.join(' | ') || 'ninguno'
    });
    Logger.log(r.filas.length + ' publicaciones, ' + r.adj.length + ' adjuntos, ' + r.leidos +
      ' textos nuevos, ' + r.pendientes + ' pendientes; archivos de tareas: ' + ar.guardados + ' guardados (' +
      mb_(ar.bytes) + ' MB, ' + ar.descargados + ' descargados ahora), ' + ar.omitidos + ' omitidos. ' +
      (r.avisos.join(' | ') || 'sin avisos'));
  } catch (e) {
    // Los datos anteriores se quedan; solo se marca el error para que se vea en el dashboard.
    estado_(libro, {ultima_corrida: ahora_(), estado: 'error', avisos: String(e && e.message || e)});
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/* ───────────── lectura de Classroom ───────────── */

function recolectar_(libro, inicio) {
  var previo = textoPrevio_(libro);
  var desde = new Date(Date.now() - DIAS_ATRAS * 864e5);
  var out = {filas: [], adj: [], avisos: [], cursos: 0, leidos: 0, pendientes: 0};
  var pendientesDeTexto = [];   // [indice en out.adj, file_id, modificado]

  function agregarAdjuntos(c, pub, origen, lista) {
    (lista || []).forEach(function (m) {
      var a = adjunto_(m);
      var fila = [c.name, pub.id, pub.titulo, origen, a.tipo, a.nombre, a.url, a.id, '', '', '', ''];
      if (a.id) pendientesDeTexto.push([out.adj.length, a.id]);
      out.adj.push(fila);
    });
  }

  var cursos = cursos_();
  out.cursos = cursos.length;
  cursos.forEach(function (c) {
    // Tareas y preguntas, con tu entrega
    var entregas = {};
    try {
      paginar_(function (t) {
        return Classroom.Courses.CourseWork.StudentSubmissions.list(c.id, '-', {userId: 'me', pageSize: 100, pageToken: t});
      }, 'studentSubmissions').forEach(function (s) { entregas[s.courseWorkId] = s; });
    } catch (e) { out.avisos.push(c.name + ': no se pudieron leer tus entregas (' + e.message + ')'); }

    try {
      paginar_(function (t) {
        return Classroom.Courses.CourseWork.list(c.id, {pageSize: 100, pageToken: t});
      }, 'courseWork').forEach(function (w) {
        if (new Date(w.creationTime) < desde) return;
        var s = entregas[w.id];
        var mios = (s && s.assignmentSubmission && s.assignmentSubmission.attachments) || [];
        out.filas.push([c.name, c.section || '', c.id, w.id, TIPOS[w.workType] || w.workType || 'TAREA',
          w.title || '', w.description || '', fecha_(w.creationTime), limite_(w),
          w.maxPoints == null ? '' : w.maxPoints, s ? (ESTADOS[s.state] || s.state) : 'sin_dato',
          s && s.late ? 'sí' : 'no', s && s.assignedGrade != null ? s.assignedGrade : '',
          mios.length, s ? fecha_(s.updateTime) : '', (w.materials || []).length, w.alternateLink || '']);
        var pub = {id: w.id, titulo: w.title || ''};
        agregarAdjuntos(c, pub, 'maestro', w.materials);
        agregarAdjuntos(c, pub, 'mi_entrega', mios);
      });
    } catch (e) { out.avisos.push(c.name + ': no se pudieron leer las tareas (' + e.message + ')'); }

    // Materiales (sin entrega)
    try {
      paginar_(function (t) {
        return Classroom.Courses.CourseWorkMaterials.list(c.id, {pageSize: 100, pageToken: t});
      }, 'courseWorkMaterial').forEach(function (w) {
        if (new Date(w.creationTime) < desde) return;
        out.filas.push([c.name, c.section || '', c.id, w.id, 'MATERIAL', w.title || '', w.description || '',
          fecha_(w.creationTime), '', '', 'no_aplica', '', '', '', '', (w.materials || []).length, w.alternateLink || '']);
        agregarAdjuntos(c, {id: w.id, titulo: w.title || ''}, 'maestro', w.materials);
      });
    } catch (e) { out.avisos.push(c.name + ': no se pudieron leer los materiales (' + e.message + ')'); }

    // Anuncios del tablon
    try {
      paginar_(function (t) {
        return Classroom.Courses.Announcements.list(c.id, {pageSize: 100, pageToken: t});
      }, 'announcements').forEach(function (a) {
        if (new Date(a.creationTime) < desde) return;
        var titulo = (a.text || '').split('\n')[0].slice(0, 120);
        out.filas.push([c.name, c.section || '', c.id, a.id, 'ANUNCIO', titulo, a.text || '',
          fecha_(a.creationTime), '', '', 'no_aplica', '', '', '', '', (a.materials || []).length, a.alternateLink || '']);
        agregarAdjuntos(c, {id: a.id, titulo: titulo}, 'maestro', a.materials);
      });
    } catch (e) { out.avisos.push(c.name + ': no se pudieron leer los anuncios (' + e.message + ')'); }
  });

  // Texto de los archivos de Drive: se reusa lo ya leido si el archivo no cambio.
  pendientesDeTexto.forEach(function (p) {
    var fila = out.adj[p[0]], id = p[1];
    var t;
    if ((Date.now() - inicio) / 1000 > SEGUNDOS_TEXTO) {
      if (reusable_(previo[id])) {
        t = previo[id];
      } else {
        t = {mime: '', modificado: '', texto: '', nota: 'pendiente: se lee en la siguiente corrida'};
        out.pendientes++;
      }
    } else {
      t = texto_(id, previo[id]);
      if (t.nuevo) out.leidos++;
    }
    fila[8] = t.mime; fila[9] = t.modificado; fila[10] = t.texto; fila[11] = t.nota;
  });
  return out;
}

function cursos_() {
  return paginar_(function (t) {
    return Classroom.Courses.list({studentId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken: t});
  }, 'courses');
}

function paginar_(fn, campo) {
  var out = [], tok;
  do { var r = reintentar_(function () { return fn(tok); }) || {}; out = out.concat(r[campo] || []); tok = r.nextPageToken; } while (tok);
  return out;
}

/** Google a veces responde "service unavailable" o similar por un momento: se reintenta 3 veces. */
function reintentar_(fn) {
  for (var i = 0; ; i++) {
    try { return fn(); } catch (e) {
      var temporal = /unavailable|backend error|internal error|timed out|rate limit|quota|try again/i.test(String(e && e.message));
      if (!temporal || i >= 3) throw e;
      Utilities.sleep(1500 * Math.pow(2, i));
    }
  }
}

function adjunto_(m) {
  if (m.driveFile) {   // en materiales viene como {driveFile:{driveFile:{...}}}; en entregas como {driveFile:{...}}
    var f = m.driveFile.driveFile || m.driveFile;
    return {tipo: 'drive', nombre: f.title || '', url: f.alternateLink || '', id: f.id || ''};
  }
  var y = m.youtubeVideo || m.youTubeVideo;
  if (y) return {tipo: 'youtube', nombre: y.title || '', url: y.alternateLink || '', id: ''};
  if (m.link) return {tipo: 'link', nombre: m.link.title || '', url: m.link.url || '', id: ''};
  if (m.form) return {tipo: 'form', nombre: m.form.title || '', url: m.form.formUrl || '', id: ''};
  return {tipo: 'otro', nombre: '', url: '', id: ''};
}

/* ───────────── texto de Drive (solo lectura) ───────────── */

function auth_() {
  return {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true};
}

/** Docs, Slides y archivos de texto. PDF, Word y PowerPoint quedan solo con el link. */
function texto_(id, prev) {
  var base = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id);
  var meta = UrlFetchApp.fetch(base + '?fields=mimeType,modifiedTime&supportsAllDrives=true', auth_());
  if (meta.getResponseCode() !== 200) {
    return {mime: '', modificado: '', texto: '', nota: 'sin acceso al archivo (' + meta.getResponseCode() + ')', nuevo: false};
  }
  var m = JSON.parse(meta.getContentText());
  var mod = fecha_(m.modifiedTime);
  if (reusable_(prev) && prev.modificado === mod) {
    return {mime: prev.mime, modificado: mod, texto: prev.texto, nota: prev.nota, nuevo: false};
  }
  var url = null;
  if (m.mimeType === 'application/vnd.google-apps.document' || m.mimeType === 'application/vnd.google-apps.presentation') {
    url = base + '/export?mimeType=text/plain';
  } else if (/^text\//.test(m.mimeType)) {
    url = base + '?alt=media&supportsAllDrives=true';
  }
  if (!url) return {mime: m.mimeType, modificado: mod, texto: '', nota: 'sin texto extraible; abrir con el link', nuevo: true};
  var r = UrlFetchApp.fetch(url, auth_());
  if (r.getResponseCode() !== 200) {
    return {mime: m.mimeType, modificado: mod, texto: '', nota: 'no se pudo leer (' + r.getResponseCode() + ')', nuevo: false};
  }
  var txt = r.getContentText().trim();
  return {mime: m.mimeType, modificado: mod, texto: txt.slice(0, MAX_TEXTO),
    nota: txt.length > MAX_TEXTO ? 'texto recortado a ' + MAX_TEXTO + ' caracteres' : '', nuevo: true};
}

/** Un resultado anterior se reusa solo si fue definitivo (texto leido o archivo sin texto). */
function reusable_(prev) {
  return !!prev && (prev.texto !== '' || /^sin texto extraible/.test(prev.nota));
}

function textoPrevio_(libro) {
  var hoja = libro.getSheetByName('classroom_adjuntos'), out = {};
  if (!hoja || hoja.getLastRow() < 2) return out;
  var cab = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  if (cab.join() !== CAB_ADJ.join()) return out;   // formato viejo: se vuelve a leer todo
  hoja.getRange(2, 1, hoja.getLastRow() - 1, CAB_ADJ.length).getValues().forEach(function (r) {
    var id = String(r[7]);
    if (id) out[id] = {mime: String(r[8]), modificado: String(r[9]), texto: String(r[10]), nota: String(r[11])};
  });
  return out;
}

/* ───────────── archivos de las tareas pendientes (solo lectura de Drive) ───────────── */

/**
 * Guarda en classroom_archivos los PDF, imagenes, Word y PowerPoint del maestro de las tareas pendientes recientes.
 * Reusa lo guardado si el archivo no cambio; solo reescribe la pestaña si algo cambio.
 */
function archivos_(libro, r, inicio) {
  var ahora = Date.now();
  var pend = {};
  r.filas.forEach(function (f) {
    if ((f[4] !== 'TAREA' && f[4] !== 'PREGUNTA') || !PENDIENTE[f[10]]) return;
    var reciente = f[8] ? aFecha_(f[8]) >= ahora - DIAS_LIMITE_ATRAS * 864e5
                        : aFecha_(f[7]) >= ahora - DIAS_SIN_FECHA * 864e5;
    if (reciente) pend[f[3]] = {publicado: f[7]};
  });

  var lista = [], porId = {};
  r.adj.forEach(function (a) {
    if (a[3] !== 'maestro' || !a[7] || !pend[a[1]]) return;
    if (porId[a[7]]) { porId[a[7]].pubs.push(a[1]); return; }
    porId[a[7]] = {id: a[7], pubs: [a[1]], curso: a[0], titulo: a[2], nombre: a[5], publicado: pend[a[1]].publicado};
    lista.push(porId[a[7]]);
  });
  lista.sort(function (x, y) { return x.publicado < y.publicado ? 1 : x.publicado > y.publicado ? -1 : 0; });  // lo mas nuevo primero

  // Lo que ya estaba guardado (solo columnas de datos; el base64 se lee solo si se reusa)
  var hoja = libro.getSheetByName('classroom_archivos'), prev = {};
  if (hoja && hoja.getLastRow() > 1 && hoja.getLastColumn() >= CAB_ARCH.length &&
      hoja.getRange(1, 1, 1, CAB_ARCH.length).getValues()[0].join() === CAB_ARCH.join()) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, CAB_ARCH.length - 1).getValues().forEach(function (v, i) {
      var id = String(v[0]);
      if (!prev[id]) prev[id] = {modificado: String(v[6]), fila: i + 2, partes: Number(v[9]) || 0, nota: String(v[10]), n: 0};
      prev[id].n++;
    });
  }

  var out = {guardados: 0, omitidos: 0, bytes: 0, descargados: 0}, filas = [], cambio = false, vistos = {};
  lista.forEach(function (c) {
    var m = metaArchivo_(c.id);
    if (!m.error && !MIME_ARCHIVO.test(m.mime)) return;   // Docs/Slides ya traen su texto en classroom_adjuntos
    vistos[c.id] = true;
    var base = [c.id, c.pubs.join(' '), c.curso, c.titulo, c.nombre, m.mime, m.modificado, m.bytes];
    var p = prev[c.id];
    var nota = m.error ||
      (m.bytes > MAX_ARCHIVO ? 'muy grande (' + mb_(m.bytes) + ' MB); abrir con el link de Classroom' : '') ||
      (out.bytes + m.bytes > MAX_ARCHIVOS_TOTAL ? 'no cupo en el limite total; abrir con el link de Classroom' : '');
    var trozos = null;
    if (!nota) {
      if (p && !p.nota && p.modificado === m.modificado && p.partes > 0 && p.n === p.partes) {
        trozos = hoja.getRange(p.fila, CAB_ARCH.length, p.partes, 1).getValues().map(function (v) { return String(v[0]); });
      } else if ((Date.now() - inicio) / 1000 > SEGUNDOS_ARCHIVOS) {
        nota = 'pendiente: se descarga en la siguiente corrida';
      } else {
        var d = descargar_(c.id);
        if (d.error) nota = d.error;
        else { trozos = partir_(d.base64, TROZO); out.descargados++; cambio = true; }
      }
    }
    if (nota) {
      filas.push(base.concat([1, 1, nota, '']));
      out.omitidos++;
      if (!p || p.nota !== nota || p.modificado !== m.modificado) cambio = true;
      return;
    }
    trozos.forEach(function (t, i) { filas.push(base.concat([i + 1, trozos.length, '', t])); });
    out.guardados++;
    out.bytes += m.bytes;
  });
  Object.keys(prev).forEach(function (id) { if (!vistos[id]) cambio = true; });   // ya no esta pendiente: se quita
  if (cambio || !hoja) escribirPorLotes_(libro, 'classroom_archivos', CAB_ARCH, filas, true);
  return out;
}

function metaArchivo_(id) {
  var res = reintentar_(function () {
    return UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?fields=mimeType,modifiedTime,size&supportsAllDrives=true', auth_());
  });
  if (res.getResponseCode() !== 200) return {mime: '', modificado: '', bytes: 0, error: 'sin acceso al archivo (' + res.getResponseCode() + ')'};
  var j = JSON.parse(res.getContentText());
  return {mime: j.mimeType || '', modificado: j.modifiedTime || '', bytes: Number(j.size) || 0, error: ''};
}

function descargar_(id) {
  var res = reintentar_(function () {
    return UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?alt=media&supportsAllDrives=true', auth_());
  });
  if (res.getResponseCode() !== 200) return {error: 'no se pudo descargar (' + res.getResponseCode() + '); abrir con el link de Classroom'};
  return {base64: Utilities.base64Encode(res.getBlob().getBytes())};
}

function partir_(s, n) {
  var out = [];
  for (var i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [''];
}

function mb_(bytes) { return Math.round(bytes / 1048576 * 10) / 10; }

/** 'yyyy-MM-dd HH:mm' o 'yyyy-MM-dd' en hora de Mexico (sin horario de verano) → milisegundos. */
function aFecha_(s) {
  s = String(s || '');
  if (!s) return NaN;
  return new Date(s.length > 10 ? s.replace(' ', 'T') + ':00-06:00' : s + 'T12:00:00-06:00').getTime();
}

/* ───────────── escritura ───────────── */

/** Todo texto se guarda como texto literal: Sheets no lo convierte en fecha, numero ni formula. */
function celda_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return "'" + String(v).slice(0, MAX_CELDA);
}

function escribir_(libro, nombre, cab, filas) {
  var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
  var datos = [cab].concat(filas).map(function (f) { return f.map(celda_); });
  if (hoja.getMaxRows() < datos.length) hoja.insertRowsAfter(hoja.getMaxRows(), datos.length - hoja.getMaxRows());
  if (hoja.getMaxColumns() < cab.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), cab.length - hoja.getMaxColumns());
  hoja.clearContents();
  hoja.getRange(1, 1, datos.length, cab.length).setValues(datos);
  hoja.setFrozenRows(1);
}

/** Para pestañas pesadas (base64): escribe de 40 en 40 filas para no mandar un solo bloque enorme. */
function escribirPorLotes_(libro, nombre, cab, filas, ocultar) {
  var hoja = libro.getSheetByName(nombre);
  if (!hoja) { hoja = libro.insertSheet(nombre); if (ocultar) hoja.hideSheet(); }
  var total = filas.length + 1;
  if (hoja.getMaxRows() < total) hoja.insertRowsAfter(hoja.getMaxRows(), total - hoja.getMaxRows());
  if (hoja.getMaxColumns() < cab.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), cab.length - hoja.getMaxColumns());
  hoja.clearContents();
  hoja.getRange(1, 1, 1, cab.length).setValues([cab.map(celda_)]);
  for (var i = 0; i < filas.length; i += 40) {
    var lote = filas.slice(i, i + 40).map(function (f) { return f.map(celda_); });
    hoja.getRange(i + 2, 1, lote.length, cab.length).setValues(lote);
  }
  hoja.setFrozenRows(1);
}

function estado_(libro, obj) {
  var filas = Object.keys(obj).map(function (k) { return [k, obj[k]]; });
  escribir_(libro, 'classroom_estado', ['campo', 'valor'], filas);
}

/* ───────────── fechas ───────────── */

function ahora_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }

function fecha_(iso) { return iso ? Utilities.formatDate(new Date(iso), TZ, 'yyyy-MM-dd HH:mm') : ''; }

/** La API da la fecha y hora limite en UTC. */
function limite_(w) {
  if (!w.dueDate) return '';
  var d = w.dueDate, t = w.dueTime;
  if (!t) return Utilities.formatDate(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)), 'UTC', 'yyyy-MM-dd');
  return fecha_(new Date(Date.UTC(d.year, d.month - 1, d.day, t.hours || 0, t.minutes || 0)).toISOString());
}
