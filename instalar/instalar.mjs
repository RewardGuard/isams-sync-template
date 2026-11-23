// Instalador de isams-sync. Lo lanzan instalar.sh (Mac/Linux) o instalar.ps1 (Windows), que solo se aseguran
// de que haya Node.js. Todo lo demas pasa aqui, igual en los tres sistemas.
//
// Que hace (y que NO hace):
//  - Tus contraseñas y tokens los escribes TU en esta terminal. Se guardan solo como secretos cifrados de
//    GitHub o como propiedades privadas de tu script de Google. No se escriben en archivos ni se muestran.
//  - Los permisos (GitHub, Google) los das TU en el navegador.
//  - Si algo falla, vuelve a correrlo: retoma donde se quedo (guarda el avance, sin secretos, en instalar/.trabajo).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const HERR = WIN ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'isams-sync') : path.join(os.homedir(), '.isams-sync');
const TRABAJO = path.join(RAIZ, 'instalar', '.trabajo');
const ESTADO_F = path.join(TRABAJO, 'estado.json');
const PLANTILLA = process.env.ISAMS_TEMPLATE || 'RewardGuard/isams-sync-template';
const CLASP_VERSION = '3.4.1';
const PRUEBA = process.env.ISAMS_INSTALADOR_PRUEBA === '1';   // solo para las pruebas automaticas

/* ───────────── utilidades de pantalla ───────────── */

let pasoN = 0;
function paso(titulo) { pasoN++; console.log(`\n━━━ ${pasoN}. ${titulo} ━━━`); }
function info(t) { console.log('  ' + t); }
function ok(t) { console.log('  ✓ ' + t); }
function aviso(t) { console.log('  ! ' + t); }
function fallar(t) { console.error('\n✗ ' + t + '\n\nPuedes volver a correr el instalador: retoma donde se quedo.'); process.exit(1); }

// Una sola interfaz de lectura para todo el instalador, con cola de lineas (si no, las lineas que llegan
// antes de cada pregunta se pierden).
let RL = null;
let RL_CERRANDO = false;
const COLA = [];
let ESPERA = null;
let FIN = false;
function lector() {
  if (!RL) {
    RL = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    RL.on('line', (l) => { if (ESPERA) { const r = ESPERA; ESPERA = null; r(l); } else COLA.push(l); });
    RL.on('SIGINT', () => { process.stdout.write('\n'); process.exit(130); });
    RL.on('close', () => {
      if (RL_CERRANDO) return;
      FIN = true;
      if (ESPERA) { process.stdout.write('\n'); process.exit(130); }
    });
  }
  return RL;
}
/** Antes de darle la terminal a otro programa (gh, clasp): soltar el teclado. */
function soltarTeclado() {
  if (RL && process.stdin.isTTY) { RL_CERRANDO = true; RL.close(); RL = null; RL_CERRANDO = false; }
}

function linea(texto, oculto = false) {
  const r = lector();
  if (COLA.length) {   // respuestas ya escritas (o pegadas) antes de la pregunta
    const l = COLA.shift();
    process.stdout.write(texto + (oculto ? '' : l) + '\n');
    return Promise.resolve(l);
  }
  if (FIN) { process.stdout.write('\n'); process.exit(130); }
  return new Promise((resolve) => {
    if (oculto && process.stdin.isTTY) {
      const original = r._writeToOutput;
      r._writeToOutput = (t) => { if (t.includes(texto)) original.call(r, t); };
      ESPERA = (l) => { r._writeToOutput = original; process.stdout.write('\n'); resolve(l); };
    } else ESPERA = resolve;
    r.setPrompt(texto);
    r.prompt();
  });
}

async function preguntar(texto, { def = '', valida = null, oculto = false } = {}) {
  for (;;) {
    const r = await linea(`  ${texto}${def ? ` [${def}]` : ''}${oculto ? ' (no se muestra)' : ''}: `, oculto);
    const v = (r || '').trim() || def;
    const err = valida ? valida(v) : (v ? null : 'No puede ir vacio.');
    if (!err) return v;
    console.log('    ' + err);
  }
}

const preguntarOculto = (texto) => preguntar(texto, { oculto: true });

async function siNo(texto, def = 's') {
  const r = await preguntar(`${texto} (s/n)`, { def, valida: (v) => (/^[sSyYnN]/.test(v) ? null : 'Escribe s o n.') });
  return /^[sSyY]/.test(r);
}

const enter = (texto = 'Cuando termines, presiona Enter') => preguntar(texto + ' ', { valida: () => null });

/* ───────────── avance guardado (sin secretos) ───────────── */

function leerEstado() { try { return JSON.parse(fs.readFileSync(ESTADO_F, 'utf8')); } catch { return {}; } }
const E = leerEstado();
function guardar() { fs.mkdirSync(TRABAJO, { recursive: true }); fs.writeFileSync(ESTADO_F, JSON.stringify(E, null, 2)); }

/* ───────────── procesos ───────────── */

function correr(cmd, args, { input, cwd, interactivo = false, permitirFallo = false, env } = {}) {
  if (interactivo) soltarTeclado();
  const r = spawnSync(cmd, args, {
    cwd, input, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: interactivo ? 'inherit' : ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  if (r.error) { if (permitirFallo) return { status: 1, stdout: '', stderr: String(r.error) }; fallar(`No pude ejecutar ${cmd}: ${r.error.message}`); }
  if (r.status !== 0 && !permitirFallo) {
    fallar(`Fallo: ${path.basename(cmd)} ${args.filter((a) => !String(a).startsWith('-')).slice(0, 3).join(' ')}\n${(r.stderr || r.stdout || '').trim().slice(-1500)}`);
  }
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function abrir(url) {
  info('Abriendo: ' + url);
  if (PRUEBA) return;
  if (MAC) correr('open', [url], { permitirFallo: true });
  else if (WIN) correr('rundll32', ['url.dll,FileProtocolHandler', url], { permitirFallo: true });
  else correr('xdg-open', [url], { permitirFallo: true });
}

function copiar(archivo) {
  if (PRUEBA) return true;
  if (MAC) return correr('pbcopy', [], { input: fs.readFileSync(archivo, 'utf8'), permitirFallo: true }).status === 0;
  if (WIN) return correr('powershell', ['-NoProfile', '-Command', `Get-Content -Raw -Encoding UTF8 -LiteralPath '${archivo.replace(/'/g, "''")}' | Set-Clipboard`], { permitirFallo: true }).status === 0;
  for (const [c, a] of [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]]) {
    if (correr(c, a, { input: fs.readFileSync(archivo, 'utf8'), permitirFallo: true }).status === 0) return true;
  }
  return false;
}

function enPath(nombre) {
  const r = correr(WIN ? 'where' : 'which', [nombre], { permitirFallo: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function buscar(dir, nombre) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = buscar(p, nombre); if (r) return r; } else if (e.name === nombre) return p;
  }
  return null;
}

async function descargar(url, destino) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
}

/* ───────────── herramientas: GitHub CLI y clasp ───────────── */

let GH = null;
async function asegurarGh() {
  GH = enPath('gh') || buscar(path.join(HERR, 'gh'), WIN ? 'gh.exe' : 'gh');
  if (GH) return;
  info('Descargando GitHub CLI (una sola vez)...');
  const r = await fetch('https://github.com/cli/cli/releases/latest', { redirect: 'manual' });
  const tag = (r.headers.get('location') || '').split('/tag/')[1];
  if (!tag) fallar('No pude saber cual es la version de GitHub CLI. Instalala de https://cli.github.com y vuelve a correr esto.');
  const v = tag.replace(/^v/, '');
  const arq = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const archivo = MAC ? `gh_${v}_macOS_${arq}.zip` : WIN ? `gh_${v}_windows_${arq}.zip` : `gh_${v}_linux_${arq}.tar.gz`;
  const dir = path.join(HERR, 'gh');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, archivo);
  await descargar(`https://github.com/cli/cli/releases/download/${tag}/${archivo}`, zip);
  correr('tar', ['-xf', zip, '-C', dir]);   // tar de Mac y Windows 10+ abre .zip
  fs.rmSync(zip, { force: true });
  GH = buscar(dir, WIN ? 'gh.exe' : 'gh');
  if (!GH) fallar('No encontre gh dentro de la descarga.');
  if (!WIN) fs.chmodSync(GH, 0o755);
  ok('GitHub CLI listo');
}
const gh = (args, opc = {}) => correr(GH, args, opc);

let CLASP = null;
function npmCli() {
  const base = path.dirname(process.execPath);
  for (const p of [path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(base, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) if (fs.existsSync(p)) return p;
  return null;
}
function asegurarClasp() {
  const dir = path.join(HERR, 'clasp');
  CLASP = path.join(dir, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
  let versionOk = false;
  try { versionOk = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', '@google', 'clasp', 'package.json'), 'utf8')).version === CLASP_VERSION; } catch { /* no esta */ }
  if (fs.existsSync(CLASP) && versionOk) return;
  info('Instalando clasp, la herramienta oficial de Google para Apps Script (una sola vez)...');
  fs.mkdirSync(dir, { recursive: true });
  const npm = npmCli();
  const args = ['install', '--prefix', dir, '--no-audit', '--no-fund', '--loglevel', 'error', `@google/clasp@${CLASP_VERSION}`];
  if (npm) correr(process.execPath, [npm, ...args]);
  else correr(WIN ? 'npm.cmd' : 'npm', args);
  if (!fs.existsSync(CLASP)) fallar('No se instalo clasp.');
  ok('clasp listo');
}
const clasp = (usuario, args, opc = {}) => correr(process.execPath, [CLASP, '--user', usuario, ...args], opc);
const claspJson = (usuario, args, opc = {}) => {
  const r = clasp(usuario, ['--json', ...args], opc);
  const t = r.stdout;
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch {
    if (opc.permitirFallo) { aviso('clasp: ' + (t + r.stderr).trim().slice(-400)); return null; }
    fallar('clasp respondio algo inesperado:\n' + (t + r.stderr).slice(-800));
  }
};

/* ───────────── pasos ───────────── */

async function bienvenida() {
  console.log(`
  isams-sync — instalador
  ───────────────────────
  Esto deja funcionando, en la nube y sin depender de tu computadora:
   • una copia PRIVADA de este proyecto en tu GitHub que baja tus calificaciones de iSAMS cada hora,
   • una hoja de Google tuya donde se guardan (con alertas por correo si algo baja o falla),
   • (opcional) la lectura de tus tareas de Google Classroom con tu cuenta de la escuela.
  Al final te da un prompt para pegar en Claude, que arma el dashboard y la tarea diaria.

  Antes de seguir:
   • Usa esto solo con TU cuenta. Revisa que el reglamento de tu escuela permita leer tu portal con un programa.
   • Tardas ~15 minutos. Vas a dar permisos en el navegador (GitHub y Google): eso lo haces tu.
   • Si algo falla, vuelve a correr el mismo comando: retoma donde se quedo.`);
  if (!(await siNo('¿Seguimos?'))) process.exit(0);
}

async function datos() {
  paso('Tus datos');
  if (!E.escuela) {
    E.escuela = await preguntar('Subdominio de tu portal iSAMS (en https://miescuela.isamshosting.cloud es "miescuela")', {
      valida: (v) => (/^[a-z0-9-]+$/i.test(v) ? null : 'Solo letras, numeros y guiones; sin https:// ni puntos.'),
    });
  }
  E.repoNombre = E.repoNombre || await preguntar('Nombre para tu repo privado de GitHub', { def: 'isams-sync', valida: (v) => (/^[A-Za-z0-9._-]+$/.test(v) ? null : 'Solo letras, numeros, punto, guion y guion bajo.') });
  if (E.classroom === undefined) {
    E.classroom = await siNo('¿Tu escuela usa Google Classroom y tienes cuenta de Google de la escuela?');
    if (E.classroom) {
      E.correoEscuela = await preguntar('Correo de tu cuenta de la escuela (la de Classroom)', { valida: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Escribe un correo valido.') });
    }
  }
  if (E.reloj === undefined) {
    info('');
    info('El horario de GitHub a veces llega tarde o se salta horas. Con un "token" de GitHub (permiso solo para');
    info('lanzar la sincronizacion de tu repo) el vigilante de tu hoja la relanza cuando se atrasa. Es opcional.');
    E.reloj = await siNo('¿Activar el reloj de respaldo? (recomendado)');
  }
  guardar();
}

async function github() {
  paso('GitHub');
  await asegurarGh();
  if (gh(['auth', 'status'], { permitirFallo: true }).status !== 0) {
    if (!(await siNo('¿Ya tienes cuenta de GitHub?'))) {
      abrir('https://github.com/signup');
      await enter('Crea tu cuenta, verifica tu correo y presiona Enter');
    }
    info('Se va a abrir el navegador para que inicies sesion en GitHub (copia el codigo que aparece aqui).');
    gh(['auth', 'login', '--web', '--git-protocol', 'https', '--hostname', 'github.com'], { interactivo: true });
  }
  E.dueno = gh(['api', 'user', '--jq', '.login']).stdout.trim();
  E.repo = `${E.dueno}/${E.repoNombre}`;
  ok(`Sesion de GitHub: ${E.dueno}`);
  const existe = gh(['api', `repos/${E.repo}`, '--jq', '.private'], { permitirFallo: true });
  if (existe.status === 0) {
    if (existe.stdout.trim() !== 'true') fallar(`${E.repo} ya existe y es PUBLICO. Hazlo privado o elige otro nombre (borra instalar/.trabajo para empezar de nuevo).`);
    if (!E.repoCreado) {
      if (!(await siNo(`${E.repo} ya existe. ¿Uso ese repo?`, 'n'))) fallar('Elige otro nombre: borra la carpeta instalar/.trabajo y vuelve a correr el instalador.');
    }
    ok(`Uso ${E.repo} (privado)`);
  } else {
    info(`Creando ${E.repo} (PRIVADO) desde la plantilla...`);
    gh(['repo', 'create', E.repo, '--private', '--template', PLANTILLA]);
    for (let i = 0; i < 15; i++) {
      if (gh(['api', `repos/${E.repo}`, '--jq', '.private'], { permitirFallo: true }).stdout.trim() === 'true') break;
      await dormir(2000);
    }
    if (gh(['api', `repos/${E.repo}`, '--jq', '.private']).stdout.trim() !== 'true') fallar('El repo no quedo privado. Cancelo.');
    ok(`${E.repo} creado (privado)`);
  }
  E.repoCreado = true; guardar();
  if (!E.credencialesIsams) await pedirCredencialesIsams();
  gh(['variable', 'set', 'ISAMS_ENABLED', '--body', 'true', '--repo', E.repo]);
}

async function pedirCredencialesIsams() {
  const usuario = await preguntar('Usuario de iSAMS');
  const clave = await preguntarOculto('Contraseña de iSAMS');
  secreto('ISAMS_SCHOOL', E.escuela);
  secreto('ISAMS_USER', usuario);
  secreto('ISAMS_PASS', clave);
  E.credencialesIsams = true; guardar();
  ok('Usuario y contraseña de iSAMS guardados como secretos cifrados de tu repo');
}

function secreto(nombre, valor) { gh(['secret', 'set', nombre, '--repo', E.repo], { input: valor }); }

async function tokenReloj() {
  if (!E.reloj) return '';
  paso('Token para el reloj de respaldo');
  info('Se abre GitHub para crear un token con permiso SOLO sobre tu repo. Llena asi:');
  info(`  • Token name: isams-sync reloj     • Expiration: 366 days`);
  info(`  • Repository access: Only select repositories → ${E.repo}`);
  info('  • Permissions → Repository permissions → Actions: Read and write  (deja lo demas como esta)');
  info('  • Generate token, y copia el token (empieza con github_pat_).');
  abrir('https://github.com/settings/personal-access-tokens/new');
  for (let intento = 0; intento < 3; intento++) {
    const t = (await preguntarOculto('Pega el token aqui (o escribe "no" para saltarlo)')).trim();
    if (/^no$/i.test(t)) { E.reloj = false; guardar(); return ''; }
    const r = PRUEBA ? { ok: t.startsWith('github_pat_'), status: 401 }
      : await fetch(`https://api.github.com/repos/${E.repo}/actions/workflows`, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' } });
    if (r.ok) { ok('Token correcto'); return t; }
    aviso(`GitHub no acepto el token (HTTP ${r.status}). Revisa que sea del repo ${E.repo} con Actions: Read and write.`);
  }
  aviso('Sigo sin reloj de respaldo (lo puedes activar despues volviendo a correr el instalador).');
  E.reloj = false; guardar(); return '';
}

async function googleApi(cuenta, correo) {
  info(`Primero, en tu cuenta ${cuenta}, activa la "API de Google Apps Script" (un interruptor).`);
  info('Si el navegador abre otra cuenta, cambia de cuenta arriba a la derecha.');
  abrir('https://script.google.com/home/usersettings' + (correo ? '?authuser=' + encodeURIComponent(correo) : ''));
  await enter('Cuando el interruptor diga "Activado", presiona Enter');
}

async function loginClasp(usuario, cuenta) {
  const clave = `login_${usuario}`;
  if (E[clave]) return true;
  info(`Se abre el navegador para que inicies sesion en Google con tu cuenta ${cuenta} y le des permiso a`);
  info('"clasp" (la herramienta oficial de Google para subir scripts).');
  if (usuario === 'escuela') info('Si Google dice que el acceso esta BLOQUEADO por tu escuela, cierra esa pestaña y presiona Ctrl+C aqui.');
  let interrumpido = false;
  const alCtrlC = () => { interrumpido = true; };
  process.on('SIGINT', alCtrlC);
  const r = clasp(usuario, ['login'], { interactivo: true, permitirFallo: true });
  process.removeListener('SIGINT', alCtrlC);
  if (r.status !== 0 || interrumpido) return false;
  E[clave] = true; guardar();
  return true;
}

function prepararCarpeta(nombre, archivos) {
  const dir = path.join(TRABAJO, nombre);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f !== '.clasp.json') fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  for (const [destino, contenido] of Object.entries(archivos)) fs.writeFileSync(path.join(dir, destino), contenido);
  return dir;
}

async function hojaGoogle() {
  paso('Tu hoja de Google (cuenta PERSONAL)');
  info('La hoja y su script van en tu cuenta de Google personal (Gmail), porque las cuentas de escuela no');
  info('suelen permitir que GitHub mande datos a un script. Ahi llegan tambien las alertas por correo.');
  asegurarClasp();
  if (!E.login_personal) await googleApi('PERSONAL');
  if (!(await loginClasp('personal', 'PERSONAL'))) fallar('No se pudo iniciar sesion en Google.');
  const dir = path.join(TRABAJO, 'hoja');
  if (!E.hoja) {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const r = claspJson('personal', ['create-script', '--type', 'sheets', '--title', 'Mis calificaciones (iSAMS)', '--rootDir', '.'], { cwd: dir });
    const parent = Array.isArray(r.parentId) ? r.parentId[0] : r.parentId;
    if (!r.scriptId || !parent) fallar('clasp no regreso los ids de la hoja.');
    E.hoja = { scriptId: r.scriptId, sheetId: parent }; guardar();
    ok('Hoja creada: https://docs.google.com/spreadsheets/d/' + parent);
  }
  prepararCarpeta('hoja', {
    'Code.gs': fs.readFileSync(path.join(RAIZ, 'apps_script', 'hoja', 'Code.gs'), 'utf8'),
    'appsscript.json': fs.readFileSync(path.join(RAIZ, 'apps_script', 'hoja', 'appsscript.json'), 'utf8'),
  });
  clasp('personal', ['push', '--force'], { cwd: dir });
  if (!E.hoja.deploymentId) {
    const d = claspJson('personal', ['create-deployment', '--description', 'receptor de GitHub'], { cwd: dir });
    if (!d.deploymentId) fallar('clasp no regreso el id del despliegue.');
    E.hoja.deploymentId = d.deploymentId; guardar();
  } else {
    clasp('personal', ['update-deployment', E.hoja.deploymentId, '--description', 'receptor de GitHub (actualizado)'], { cwd: dir });
  }
  E.hoja.url = (PRUEBA && process.env.ISAMS_PRUEBA_URL) || `https://script.google.com/macros/s/${E.hoja.deploymentId}/exec`; guardar();
  ok('Script subido y publicado');
}

let CLAVE = '';   // clave HMAC de esta corrida: solo en memoria (en GitHub queda cifrada)

async function configurarHoja() {
  const token = await tokenReloj();
  paso('Conectar GitHub con tu hoja');
  const clave = crypto.randomBytes(32).toString('hex');
  CLAVE = clave;
  secreto('SHEETS_WEBAPP_URL', E.hoja.url);
  secreto('SHEETS_HMAC_SECRET', clave);
  const huella = crypto.createHash('sha256').update('huella:' + clave).digest('hex').slice(0, 8);
  for (let intento = 1; intento <= 3; intento++) {
    info('Se abre el editor de tu script. Ahi:');
    info('  1) Arriba, en la lista de funciones, elige "instalar" y presiona "Ejecutar".');
    info('  2) Google pide permisos: Revisar permisos → tu cuenta personal → "Configuracion avanzada" →');
    info('     "Ir a Mis calificaciones (no seguro)" → Permitir. (Dice "no seguro" porque el script es tuyo y no');
    info('     lo reviso Google; solo tu lo puedes usar.)');
    info('  3) Espera a que abajo diga "Listo: permisos, reloj y pestañas".');
    abrir(`https://script.google.com/d/${E.hoja.scriptId}/edit`);
    await enter();
    const r = await postar(E.hoja.url, { accion: 'configurar', secreto: clave, repo: E.repo, token, compartir_con: E.classroom ? E.correoEscuela : '' });
    if (r && r.ok && r.huella === huella) {
      E.hojaConfigurada = true; E.reloj = !!r.reloj; guardar();
      ok('La hoja ya acepta los datos de GitHub (clave verificada)' + (r.compartida_con ? ` y quedo compartida con ${r.compartida_con}` : ''));
      return;
    }
    aviso('La hoja respondio: ' + (r ? (r.error || JSON.stringify(r)) : 'nada (¿aceptaste los permisos?)'));
    if (intento < 3) info('Vamos otra vez.');
  }
  fallar('No pude conectar la hoja. Revisa que "instalar" haya terminado sin error y vuelve a correr el instalador.');
}

async function postar(url, cuerpo) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), redirect: 'follow' });
    const t = await res.text();
    try { return JSON.parse(t); } catch { return { ok: false, error: `respuesta no JSON (HTTP ${res.status}): ${t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}` }; }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

async function firmado(url, clave, datos) {
  const payload = JSON.stringify({ ...datos, sent_at: new Date().toISOString() });
  const sig = crypto.createHmac('sha256', clave).update(payload).digest('hex');
  return postar(url, { payload, sig });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, PRUEBA ? 1 : ms));

async function primeraSincronizacion() {
  paso('Primera sincronizacion con iSAMS');
  for (let intento = 1; intento <= 3; intento++) {
    const antes = gh(['run', 'list', '--repo', E.repo, '--workflow', 'sync.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // ""'], { permitirFallo: true }).stdout.trim();
    gh(['workflow', 'run', 'sync.yml', '--repo', E.repo, '-f', 'origen=instalador']);
    info('Lanzada. Esperando a que GitHub la empiece...');
    let id = '';
    for (let i = 0; i < 30 && (!id || id === antes); i++) {
      await dormir(3000);
      id = gh(['run', 'list', '--repo', E.repo, '--workflow', 'sync.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // ""'], { permitirFallo: true }).stdout.trim();
    }
    if (!id || id === antes) fallar(`GitHub no empezo la corrida. Revisala en https://github.com/${E.repo}/actions`);
    const w = gh(['run', 'watch', id, '--repo', E.repo, '--exit-status', '--interval', '5'], { interactivo: !PRUEBA, permitirFallo: true });
    if (w.status === 0) { ok('Sincronizacion correcta: tus calificaciones ya estan en la hoja'); E.primeraOk = true; guardar(); return; }
    const log = gh(['run', 'view', id, '--repo', E.repo, '--log-failed'], { permitirFallo: true }).stdout;
    const ult = log.split(/\r?\n/).filter((l) => /error|rechaz|fall|Login|HTTP|ID/i.test(l)).slice(-8).map((l) => l.replace(/^.*?\d{2}:\d{2}:\d{2}\.\d+Z\s*/, '')).join('\n    ');
    aviso('La sincronizacion fallo:\n    ' + (ult || 'mira el detalle en GitHub → Actions'));
    if (/Login rechazado|credenciales|Login fallo/i.test(log)) {
      info('Parece que el usuario o la contraseña de iSAMS no son correctos. Vuelve a escribirlos.');
      await pedirCredencialesIsams();
    } else if (/ID de estudiante/i.test(log)) {
      info('No encontre tu ID de estudiante solo. Abre tus calificaciones en el portal con el navegador, presiona F12 →');
      info('Red/Network, y busca una direccion /markbooks/students/<numero>. Escribe ese numero.');
      secreto('ISAMS_STUDENT_ID', await preguntar('ID de estudiante', { valida: (v) => (/^\d+$/.test(v) ? null : 'Solo numeros.') }));
    } else if (intento < 3 && !(await siNo('¿Lo intento otra vez?'))) break;
  }
  fallar(`La sincronizacion no funciono. Revisa https://github.com/${E.repo}/actions y vuelve a correr el instalador.`);
}

async function classroom() {
  if (!E.classroom) return;
  paso('Google Classroom (cuenta de la ESCUELA)');
  if (E.classroomListo) { ok('Ya estaba instalado'); return; }
  asegurarClasp();
  if (!E.login_escuela) await googleApi('de la ESCUELA', E.correoEscuela);
  if (!(await loginClasp('escuela', `de la ESCUELA (${E.correoEscuela})`))) { planB(); return; }
  const dir = path.join(TRABAJO, 'classroom');
  if (!E.classroomScript) {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const r = claspJson('escuela', ['create-script', '--type', 'standalone', '--title', 'Classroom → calificaciones', '--rootDir', '.'], { cwd: dir, permitirFallo: true });
    if (!r || !r.scriptId) { planB(); return; }
    E.classroomScript = r.scriptId; guardar();
  }
  prepararCarpeta('classroom', {
    'Classroom.gs': fs.readFileSync(path.join(RAIZ, 'apps_script', 'classroom', 'Classroom.gs'), 'utf8'),
    'appsscript.json': fs.readFileSync(path.join(RAIZ, 'apps_script', 'classroom', 'appsscript.json'), 'utf8'),
    'Config.gs': `// Lo escribio el instalador. Id de tu hoja de calificaciones (cuenta personal).\nvar CONFIG = {SHEET_ID: '${E.hoja.sheetId}'};\n`,
  });
  clasp('escuela', ['push', '--force'], { cwd: dir });
  info('Se abre el editor del script de Classroom con tu cuenta de la escuela. Ahi:');
  info('  1) En la lista de funciones elige "instalarReloj" y presiona "Ejecutar".');
  info('  2) Acepta los permisos (son de SOLO LECTURA de Classroom y Drive, mas escribir en tu hoja).');
  info('  3) Espera a que abajo diga cuantas publicaciones leyo (tarda 1-3 minutos).');
  abrir(`https://script.google.com/d/${E.classroomScript}/edit?authuser=${encodeURIComponent(E.correoEscuela)}`);
  await enter();
  E.classroomListo = true; guardar();
  ok('Classroom instalado: se lee cada hora');
}

function planB() {
  aviso('Tu escuela no deja usar clasp con su cuenta. Classroom se puede instalar a mano (5 minutos):');
  info('Sigue la seccion "Classroom a mano" del README. El id de tu hoja es:');
  info('  ' + E.hoja.sheetId);
  E.classroomManual = true; guardar();
}

async function verificar() {
  paso('Revision final');
  if (CLAVE) {
    // Le pregunta a la hoja (con la misma firma que usa GitHub) que tiene guardado.
    const r = await firmado(E.hoja.url, CLAVE, { accion: 'estado' });
    if (r && r.ok) {
      const u = r.ultima_corrida || {};
      ok(`La hoja tiene ${r.materias} materias; ultima sincronizacion: ${u.estado || '—'} (${u.fin || 'sin fecha'})`);
      if (r.classroom) ok(`Classroom: ${r.classroom.publicaciones || 0} publicaciones leidas, estado ${r.classroom.estado}`);
      else if (E.classroomListo) aviso('Classroom todavia no escribe en la hoja: revisa que "instalarReloj" haya terminado sin error.');
    } else aviso('No pude leer el estado de la hoja: ' + (r && r.error));
  }
  ok(`Repo privado: https://github.com/${E.repo}`);
  ok(`Hoja: https://docs.google.com/spreadsheets/d/${E.hoja.sheetId}`);
  ok(`Reloj de respaldo: ${E.reloj ? 'activado' : 'no'}`);
  ok(`Classroom: ${E.classroomListo ? 'activado (' + E.correoEscuela + ')' : E.classroomManual ? 'pendiente: instalalo a mano (README)' : 'no'}`);
}

async function promptClaude() {
  paso('Prompt para Claude');
  const t = fs.readFileSync(path.join(RAIZ, 'claude', 'PROMPT_INSTALACION.md'), 'utf8');
  const cuerpo = t.split(/^-{3,}\s*$/m).slice(1).join('---').trim();
  const valores = {
    SHEET_ID: E.hoja.sheetId, SHEET_URL: `https://docs.google.com/spreadsheets/d/${E.hoja.sheetId}`,
    REPO: E.repo, PLANTILLA: PLANTILLA,
    CLASSROOM: E.classroomListo ? `sí, con la cuenta de la escuela ${E.correoEscuela}` : 'no',
    CLASSROOM_FRASE: E.classroomListo ? ', y un script de mi cuenta de la escuela lee mis tareas de Google Classroom' : '',
  };
  const texto = cuerpo.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in valores ? valores[k] : m));
  const archivo = path.join(RAIZ, 'MI_PROMPT_PARA_CLAUDE.txt');
  fs.writeFileSync(archivo, texto + '\n');
  const copiado = copiar(archivo);
  ok(`Prompt guardado en ${archivo}` + (copiado ? ' y copiado al portapapeles' : ''));
  console.log(`
  ÚLTIMO PASO
   1. En claude.ai activa los conectores de Google Drive/Sheets (con tu cuenta personal, la dueña de la hoja)
      y de Gmail (con la cuenta donde quieres los borradores para tus maestros).
   2. Abre un chat nuevo y pega el prompt${copiado ? ' (ya esta copiado: Cmd+V / Ctrl+V)' : ' (abre el archivo de arriba y copialo)'}.
   3. Claude te hace unas preguntas (tus maestros, tus materias) y arma el dashboard y la tarea diaria.
`);
  abrir('https://claude.ai/new');
}

function cerrarSesiones() {
  for (const u of ['personal', 'escuela']) if (E['login_' + u]) clasp(u, ['logout'], { permitirFallo: true });
  for (const u of ['personal', 'escuela']) delete E['login_' + u];
  guardar();
  ok('Cerre las sesiones de clasp en esta computadora (ya no hacen falta).');
}

async function main() {
  const [mayor] = process.versions.node.split('.').map(Number);
  if (mayor < 20) fallar('Se necesita Node.js 20 o mas nuevo.');
  fs.mkdirSync(TRABAJO, { recursive: true });
  if (!E.bienvenida) { await bienvenida(); E.bienvenida = true; guardar(); }
  await datos();
  await github();
  await hojaGoogle();
  if (!E.hojaConfigurada) await configurarHoja();
  if (!E.primeraOk) await primeraSincronizacion();
  await classroom();
  await verificar();
  await promptClaude();
  cerrarSesiones();
  console.log('  Listo. Si algun dia quieres reinstalar desde cero, borra la carpeta instalar/.trabajo.\n');
  RL_CERRANDO = true; if (RL) RL.close();
}

main().catch((e) => fallar(e && e.stack || String(e)));
