/**
 * BACKEND DE FICHAJE — Google Apps Script
 * ------------------------------------------------------------
 * Vinculado a una Google Sheet de tu Drive. Guarda cada fichaje
 * (entrada/salida) en la hoja "Fichajes" y genera informes
 * (Google Sheet + PDF) en la carpeta "Informes de fichajes".
 *
 * Pasos: ver README.md. Resumen:
 *   1) Ejecuta setup() una vez.
 *   2) Implementar > Nueva implementación > Aplicación web
 *      (Ejecutar como: Yo · Acceso: Cualquier usuario).
 *   3) Copia la URL /exec en app.js → CONFIG.API_URL.
 */

const TZ = 'Europe/Madrid';
const HOJA_EMP = 'Empleados';
const HOJA_FIC = 'Fichajes';
const CARPETA_INFORMES = 'Informes de fichajes';
const MAX_INTENTOS = 5;       // intentos fallidos antes de bloquear
const BLOQUEO_SEG = 600;      // 10 minutos

const CAB_EMP = ['Código', 'Nombre', 'PIN', 'Activo'];
const CAB_FIC = ['ID', 'Fecha', 'Hora', 'Timestamp', 'Código', 'Nombre', 'Tipo',
                 'Dispositivo', 'Latitud', 'Longitud', 'Observaciones'];

/* ============================ SETUP ============================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const emp = obtenerHoja_(ss, HOJA_EMP, CAB_EMP);
  emp.getRange('A:C').setNumberFormat('@'); // PIN como texto (conserva ceros)
  if (emp.getLastRow() === 1) {
    emp.appendRow(['E001', 'Empleado de ejemplo', '1234', true]);
  }
  emp.getRange('D2:D').insertCheckboxes();

  const fic = obtenerHoja_(ss, HOJA_FIC, CAB_FIC);
  fic.getRange('A:H').setNumberFormat('@');
  fic.getRange('K:K').setNumberFormat('@');

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSWORD')) props.setProperty('ADMIN_PASSWORD', 'cambiame');

  obtenerCarpeta_();
  Logger.log('Listo. Cambia ADMIN_PASSWORD en Configuración del proyecto > Propiedades del script.');
}

/* ============================ API ============================ */

function doGet() {
  return json_({ ok: true, mensaje: 'API de fichaje activa', hora: fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const acciones = {
      estado: accEstado_,
      fichar: accFichar_,
      empleados: accEmpleados_,
      informe: accInforme_
    };
    const fn = acciones[req.action];
    if (!fn) throw new Error('Acción no válida');
    return json_(Object.assign({ ok: true }, fn(req)));
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

/** Estado actual del empleado (dentro/fuera + fichajes de hoy) */
function accEstado_(req) {
  const emp = autenticar_(req.codigo, req.pin);
  const fs = leerFichajes_().filter(f => f.codigo === emp.codigo);
  return Object.assign({ empleado: publico_(emp) }, resumenEstado_(fs));
}

/** Registra una entrada o salida (la hora la pone el servidor) */
function accFichar_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const emp = autenticar_(req.codigo, req.pin);
    const fs = leerFichajes_().filter(f => f.codigo === emp.codigo);
    const ult = fs[fs.length - 1];
    const dentro = !!ult && ult.tipo === 'Entrada';

    const tipo = (req.tipo === 'Entrada' || req.tipo === 'Salida') ? req.tipo : (dentro ? 'Salida' : 'Entrada');
    if (tipo === 'Entrada' && dentro) {
      throw new Error('Ya tienes una entrada abierta (' + fechaES_(ult.fecha) + ' ' + ult.hora + '). Ficha la salida primero.');
    }
    if (tipo === 'Salida' && !dentro) throw new Error('No tienes ninguna entrada abierta.');

    const ahora = new Date();
    const lat = num_(req.lat), lon = num_(req.lon);
    const fila = [
      Utilities.getUuid().slice(0, 8),
      fmt_(ahora, 'yyyy-MM-dd'),
      fmt_(ahora, 'HH:mm:ss'),
      fmt_(ahora, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      emp.codigo, emp.nombre, tipo,
      String(req.dispositivo || '').slice(0, 120),
      lat === null ? '' : lat,
      lon === null ? '' : lon,
      String(req.obs || '').slice(0, 200)
    ];
    hoja_(HOJA_FIC).appendRow(fila);
    SpreadsheetApp.flush();

    const nuevo = filaAObj_(fila.map(String));
    fs.push(nuevo);
    return Object.assign({ empleado: publico_(emp), fichaje: nuevo }, resumenEstado_(fs));
  } finally {
    lock.releaseLock();
  }
}

/** Lista de empleados (admin) */
function accEmpleados_(req) {
  checkAdmin_(req.password);
  return { empleados: leerEmpleados_().map(publico_) };
}

/** Informe de fichajes: un empleado o todos ('*'), rango de fechas opcional */
function accInforme_(req) {
  checkAdmin_(req.password);
  const desde = req.desde || '0000-00-00';
  const hasta = req.hasta || '9999-12-31';
  const cod = String(req.codigo || '*').trim().toUpperCase();

  // Se emparejan entradas/salidas sobre TODO el histórico del empleado
  // (así un turno que cruza medianoche se calcula bien) y luego se filtra.
  const base = leerFichajes_().filter(f => cod === '*' || f.codigo === cod);
  const enRango = f => f.fecha >= desde && f.fecha <= hasta;
  const diario = resumir_(base).filter(enRango);
  const fichajes = base.filter(enRango);
  const totales = totalizar_(diario);

  const documento = req.generarDoc
    ? crearDocumento_(fichajes, diario, totales, { desde: req.desde, hasta: req.hasta, cod: cod })
    : null;

  return { fichajes: fichajes, diario: diario, totales: totales, documento: documento };
}

/* ============================ LÓGICA ============================ */

function resumenEstado_(fs) {
  const ult = fs[fs.length - 1] || null;
  const hoy = fmt_(new Date(), 'yyyy-MM-dd');
  return {
    dentro: !!ult && ult.tipo === 'Entrada',
    ultimo: ult,
    hoy: fs.filter(f => f.fecha === hoy)
  };
}

/** Empareja Entrada→Salida por empleado y agrupa por día (día = fecha de la entrada) */
function resumir_(fs) {
  const porEmp = {};
  fs.forEach(f => (porEmp[f.codigo] = porEmp[f.codigo] || []).push(f));
  const salida = [];

  Object.keys(porEmp).sort().forEach(cod => {
    const lista = porEmp[cod].slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const dias = {};
    const dia = f => dias[f.fecha] = dias[f.fecha] || {
      codigo: cod, nombre: f.nombre, fecha: f.fecha,
      primeraEntrada: '', ultimaSalida: '', tramos: 0, minutos: 0, incidencias: []
    };
    let abierta = null;

    lista.forEach(f => {
      if (f.tipo === 'Entrada') {
        if (abierta) dia(abierta).incidencias.push('Entrada ' + abierta.hora.slice(0, 5) + ' sin salida');
        abierta = f;
        const d = dia(f);
        if (!d.primeraEntrada) d.primeraEntrada = f.hora;
      } else {
        if (!abierta) { dia(f).incidencias.push('Salida ' + f.hora.slice(0, 5) + ' sin entrada'); return; }
        const d = dia(abierta);
        d.minutos += Math.max(0, (new Date(f.ts) - new Date(abierta.ts)) / 60000);
        d.tramos++;
        d.ultimaSalida = f.fecha === abierta.fecha ? f.hora : f.hora + ' (+1d)';
        abierta = null;
      }
    });
    if (abierta) dia(abierta).incidencias.push('Entrada ' + abierta.hora.slice(0, 5) + ' abierta');

    Object.keys(dias).sort().forEach(k => {
      const d = dias[k];
      d.minutos = Math.round(d.minutos);
      d.horas = hhmm_(d.minutos);
      d.incidencias = d.incidencias.join('; ');
      salida.push(d);
    });
  });
  return salida;
}

function totalizar_(diario) {
  const t = {};
  diario.forEach(d => {
    const x = t[d.codigo] = t[d.codigo] || { codigo: d.codigo, nombre: d.nombre, dias: 0, minutos: 0, incidencias: 0 };
    if (d.tramos > 0) x.dias++;
    x.minutos += d.minutos;
    if (d.incidencias) x.incidencias++;
  });
  return Object.keys(t).sort().map(k => Object.assign(t[k], {
    horas: hhmm_(t[k].minutos),
    media: t[k].dias ? hhmm_(Math.round(t[k].minutos / t[k].dias)) : '0:00'
  }));
}

/* ============================ DOCUMENTO ============================ */

function crearDocumento_(fichajes, diario, totales, p) {
  const carpeta = obtenerCarpeta_();
  const quien = p.cod === '*' ? 'Todos' : p.cod + (totales[0] ? ' ' + totales[0].nombre : '');
  const rango = (p.desde ? fechaES_(p.desde) : 'inicio') + ' - ' + (p.hasta ? fechaES_(p.hasta) : 'hoy');
  const nombre = 'Fichajes · ' + quien + ' · ' + rango.replace(/\//g, '-');

  const ss = SpreadsheetApp.create(nombre);
  DriveApp.getFileById(ss.getId()).moveTo(carpeta);

  // Resumen
  const r = ss.getSheets()[0].setName('Resumen');
  r.getRange('A1').setValue('Registro de jornada').setFontSize(16).setFontWeight('bold');
  r.getRange('A2').setValue('Empleado: ' + quien + '   ·   Periodo: ' + rango);
  r.getRange('A3').setValue('Generado: ' + fmt_(new Date(), 'dd/MM/yyyy HH:mm'));
  escribirTabla_(r, 5,
    ['Código', 'Nombre', 'Días trabajados', 'Horas totales', 'Media diaria', 'Días con incidencias'],
    totales.map(t => [t.codigo, t.nombre, t.dias, t.horas, t.media, t.incidencias]));

  // Detalle diario
  escribirTabla_(ss.insertSheet('Detalle diario'), 1,
    ['Código', 'Nombre', 'Fecha', 'Primera entrada', 'Última salida', 'Tramos', 'Horas', 'Incidencias'],
    diario.map(d => [d.codigo, d.nombre, fechaES_(d.fecha), d.primeraEntrada, d.ultimaSalida, d.tramos, d.horas, d.incidencias]));

  // Fichajes en bruto
  escribirTabla_(ss.insertSheet('Fichajes'), 1,
    ['Fecha', 'Hora', 'Código', 'Nombre', 'Tipo', 'Dispositivo', 'Latitud', 'Longitud'],
    fichajes.map(f => [fechaES_(f.fecha), f.hora, f.codigo, f.nombre, f.tipo, f.dispositivo, f.lat, f.lon]));

  SpreadsheetApp.flush();
  const pdf = carpeta.createFile(DriveApp.getFileById(ss.getId()).getAs(MimeType.PDF).setName(nombre + '.pdf'));
  return { nombre: nombre, url: ss.getUrl(), pdfUrl: pdf.getUrl() };
}

function escribirTabla_(sh, fila, cab, datos) {
  sh.getRange(fila, 1, 1, cab.length).setValues([cab])
    .setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
  if (datos.length) {
    const rng = sh.getRange(fila + 1, 1, datos.length, cab.length);
    rng.setNumberFormat('@').setValues(datos.map(r => r.map(v => (v === null || v === undefined) ? '' : String(v))));
    rng.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  } else {
    sh.getRange(fila + 1, 1).setValue('Sin datos en el periodo seleccionado');
  }
  sh.setFrozenRows(fila);
  sh.autoResizeColumns(1, cab.length);
}

/* ============================ AUTH ============================ */

function autenticar_(codigo, pin) {
  codigo = String(codigo || '').trim().toUpperCase();
  pin = String(pin || '').trim();
  if (!codigo || !pin) throw new Error('Introduce código y PIN');

  const cache = CacheService.getScriptCache();
  const clave = 'fallos_' + codigo;
  const fallos = Number(cache.get(clave) || 0);
  if (fallos >= MAX_INTENTOS) throw new Error('Demasiados intentos fallidos. Vuelve a probar en 10 minutos.');

  const emp = leerEmpleados_().find(x => x.codigo === codigo);
  if (!emp || emp.pin !== pin) {
    cache.put(clave, String(fallos + 1), BLOQUEO_SEG);
    throw new Error('Código o PIN incorrectos');
  }
  if (!emp.activo) throw new Error('Empleado dado de baja. Contacta con administración.');
  cache.remove(clave);
  return emp;
}

function checkAdmin_(password) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallos_admin') || 0);
  if (fallos >= MAX_INTENTOS) throw new Error('Acceso bloqueado temporalmente. Prueba en 10 minutos.');
  const ok = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!ok || String(password || '') !== ok) {
    cache.put('fallos_admin', String(fallos + 1), BLOQUEO_SEG);
    throw new Error('Contraseña de administración incorrecta');
  }
  cache.remove('fallos_admin');
}

/* ============================ DATOS ============================ */

function leerEmpleados_() {
  const h = hoja_(HOJA_EMP);
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, 4).getDisplayValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({
      codigo: String(r[0]).trim().toUpperCase(),
      nombre: String(r[1]).trim(),
      pin: String(r[2]).trim(),
      activo: !/^(false|falso|no|0)$/i.test(String(r[3]).trim())
    }));
}

function leerFichajes_() {
  const h = hoja_(HOJA_FIC);
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, CAB_FIC.length).getDisplayValues()
    .filter(r => r[0] !== '')
    .map(filaAObj_);
}

function filaAObj_(r) {
  return { id: r[0], fecha: r[1], hora: r[2], ts: r[3], codigo: r[4], nombre: r[5],
           tipo: r[6], dispositivo: r[7], lat: r[8], lon: r[9], obs: r[10] };
}

function publico_(e) { return { codigo: e.codigo, nombre: e.nombre, activo: e.activo }; }

/* ============================ UTILIDADES ============================ */

function hoja_(nombre) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h) throw new Error('Falta la hoja "' + nombre + '". Ejecuta setup().');
  return h;
}

function obtenerHoja_(ss, nombre, cab) {
  const h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  if (h.getLastRow() === 0) {
    h.appendRow(cab);
    h.getRange(1, 1, 1, cab.length).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
    h.setFrozenRows(1);
  }
  return h;
}

function obtenerCarpeta_() {
  const it = DriveApp.getFoldersByName(CARPETA_INFORMES);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_INFORMES);
}

function fmt_(d, patron) { return Utilities.formatDate(d, TZ, patron); }
function fechaES_(iso) { const p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
function hhmm_(min) { min = Math.round(min); return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0'); }
function num_(v) { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 1e6) / 1e6 : null; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
