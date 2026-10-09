/* =====================================================================
 *  CONFIGURACIÓN — pega aquí la URL /exec de tu Apps Script.
 *  Si la dejas vacía, la web funciona en MODO DEMO (datos en el navegador).
 * ===================================================================== */
const CONFIG = {
  API_URL: '',                 // p.ej. 'https://script.google.com/macros/s/AKfy.../exec'
  EMPRESA: 'Fichaje',          // nombre que aparece en la cabecera
  AUTO_LOGOUT_SEG: 60          // cierra la sesión del empleado tras X s sin actividad (dispositivos compartidos)
};

/* ============================ Utilidades ============================ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isoLocal = d => d.toLocaleDateString('sv-SE');                 // yyyy-mm-dd
const fechaES = iso => { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };
const hhmm = min => `${Math.floor(Math.round(min) / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const horaLocal = d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
const ordenarDesc = arr => arr.slice().sort((a, b) => (b.fecha + (b.hora || '')).localeCompare(a.fecha + (a.hora || '')) || a.codigo.localeCompare(b.codigo));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${tipo}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 3200);
}

async function conCarga(btn, fn, textoCarga) {
  const txt = btn.innerHTML;
  btn.disabled = true;
  if (textoCarga) btn.textContent = textoCarga;
  try { return await fn(); }
  catch (e) { toast(e.message || 'Error de conexión', 'error'); }
  finally { btn.disabled = false; if (textoCarga) btn.innerHTML = txt; }
}

function describirDispositivo() {
  const ua = navigator.userAgent;
  const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Otro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const tipo = /Mobi|Android|iPhone/i.test(ua) ? 'Móvil' : /iPad|Tablet/i.test(ua) ? 'Tablet' : 'Ordenador';
  return `${tipo} · ${so} · ${nav}`;
}

function obtenerUbicacion() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/* ============================ API ============================ */
async function api(action, data = {}) {
  if (!CONFIG.API_URL) return Demo.handle(action, data);
  // text/plain evita el preflight CORS con Apps Script
  const r = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...data })
  });
  if (!r.ok) throw new Error(`Error del servidor (${r.status})`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Error desconocido');
  return j;
}

/* ============================ Reloj y pestañas ============================ */
function tick() {
  const d = new Date();
  $('#hora').textContent = horaLocal(d);
  const f = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1);
}

function mostrarTab(nombre) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${nombre}`));
  history.replaceState(null, '', nombre === 'admin' ? '#admin' : location.pathname + location.search);
}

/* ============================ FICHAR ============================ */
const sesion = { codigo: null, pin: null, empleado: null, dentro: false, ultimo: null, hoy: [] };
let inactividad = null;

function aplicarEstado(r) {
  sesion.empleado = r.empleado;
  sesion.dentro = r.dentro;
  sesion.ultimo = r.ultimo;
  sesion.hoy = r.hoy || [];
  pintarFichar();
}

function pintarFichar() {
  const logueado = !!sesion.empleado;
  $('#card-login').hidden = logueado;
  $('#card-fichar').hidden = !logueado;
  if (!logueado) return;

  $('#emp-nombre').textContent = sesion.empleado.nombre;

  const est = $('#estado');
  if (sesion.dentro && sesion.ultimo) {
    const desde = sesion.ultimo.fecha === isoLocal(new Date())
      ? sesion.ultimo.hora.slice(0, 5)
      : `${fechaES(sesion.ultimo.fecha)} ${sesion.ultimo.hora.slice(0, 5)}`;
    est.className = 'estado dentro';
    est.textContent = `Trabajando desde las ${desde}`;
  } else {
    est.className = 'estado fuera';
    est.textContent = sesion.ultimo ? `Fuera · última salida ${fechaES(sesion.ultimo.fecha)} ${sesion.ultimo.hora.slice(0, 5)}` : 'Sin fichajes previos';
  }

  const btn = $('#btn-fichar');
  btn.className = `btn-fichar ${sesion.dentro ? 'salida' : 'entrada'}`;
  $('#btn-fichar-txt').textContent = sesion.dentro ? 'Fichar salida' : 'Fichar entrada';
  $('#ico-path').setAttribute('d', sesion.dentro
    ? 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
    : 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3');

  const ul = $('#lista-hoy');
  ul.innerHTML = sesion.hoy.length
    ? sesion.hoy.slice().reverse().map(f =>
        `<li><span>${esc(f.hora.slice(0, 5))}</span><span class="tag ${esc(f.tipo)}">${esc(f.tipo)}</span></li>`).join('')
    : '<li class="vacio">Todavía no has fichado hoy</li>';

  reiniciarInactividad();
}

function cerrarSesion() {
  Object.assign(sesion, { codigo: null, pin: null, empleado: null, dentro: false, ultimo: null, hoy: [] });
  $('#pin').value = '';
  if (!$('#recordar').checked) $('#codigo').value = '';
  clearInterval(inactividad);
  pintarFichar();
  ($('#codigo').value ? $('#pin') : $('#codigo')).focus();
}

function reiniciarInactividad() {
  clearInterval(inactividad);
  if (!CONFIG.AUTO_LOGOUT_SEG) return;
  let quedan = CONFIG.AUTO_LOGOUT_SEG;
  const aviso = $('#auto-logout');
  aviso.textContent = '';
  inactividad = setInterval(() => {
    quedan--;
    if (quedan <= 15) aviso.textContent = `La sesión se cerrará en ${quedan} s`;
    if (quedan <= 0) cerrarSesion();
  }, 1000);
}

$('#form-login').addEventListener('submit', e => {
  e.preventDefault();
  const btn = e.submitter || $('#form-login button');
  conCarga(btn, async () => {
    const codigo = $('#codigo').value.trim().toUpperCase();
    const pin = $('#pin').value.trim();
    const r = await api('estado', { codigo, pin });
    sesion.codigo = codigo;
    sesion.pin = pin;
    try {
      if ($('#recordar').checked) localStorage.setItem('fichaje_codigo', codigo);
      else localStorage.removeItem('fichaje_codigo');
    } catch {}
    aplicarEstado(r);
  });
});

$('#btn-fichar').addEventListener('click', () => conCarga($('#btn-fichar'), async () => {
  const tipo = sesion.dentro ? 'Salida' : 'Entrada';
  const pos = $('#geo').checked ? await obtenerUbicacion() : null;
  const r = await api('fichar', {
    codigo: sesion.codigo, pin: sesion.pin, tipo,
    dispositivo: describirDispositivo(),
    lat: pos?.lat ?? '', lon: pos?.lon ?? ''
  });
  aplicarEstado(r);
  navigator.vibrate?.(80);
  toast(`${r.fichaje.tipo} registrada a las ${r.fichaje.hora.slice(0, 5)}`, 'ok');
}));

$('#btn-salir').addEventListener('click', cerrarSesion);
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => sesion.empleado && reiniciarInactividad()));

/* ============================ ADMIN ============================ */
const admin = { password: null, informe: null, empleados: [] };

$('#form-admin').addEventListener('submit', e => {
  e.preventDefault();
  conCarga(e.submitter || $('#form-admin button'), async () => {
    const password = $('#admin-pass').value;
    const r = await api('empleados', { password });
    admin.password = password;
    admin.empleados = r.empleados;
    $('#f-emp').innerHTML = '<option value="*">Todos los empleados</option>' +
      r.empleados.map(x => `<option value="${esc(x.codigo)}">${esc(x.codigo)} · ${esc(x.nombre)}${x.activo ? '' : ' (baja)'}</option>`).join('');
    $('#card-admin-login').hidden = true;
    $('#admin-panel').hidden = false;
    $('#admin-pass').value = '';
    fijarRango('mes');
  });
});

$('#btn-admin-salir').addEventListener('click', () => {
  Object.assign(admin, { password: null, informe: null, empleados: [] });
  $('#admin-panel').hidden = true;
  $('#resultado').hidden = true;
  $('#doc-links').hidden = true;
  $('#card-admin-login').hidden = false;
});

function fijarRango(r) {
  const hoy = new Date();
  let d = new Date(hoy), h = new Date(hoy);
  if (r === 'semana') d.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  if (r === 'mes') d = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  if (r === 'mesant') { d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); h = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
  $('#f-desde').value = r === 'todo' ? '' : isoLocal(d);
  $('#f-hasta').value = r === 'todo' ? '' : isoLocal(h);
}
$$('.chips button').forEach(b => b.addEventListener('click', () => fijarRango(b.dataset.rango)));

function pedirInforme(generarDoc) {
  return api('informe', {
    password: admin.password,
    codigo: $('#f-emp').value,
    desde: $('#f-desde').value,
    hasta: $('#f-hasta').value,
    generarDoc
  });
}

$('#btn-ver').addEventListener('click', () => conCarga($('#btn-ver'), async () => {
  pintarInforme(await pedirInforme(false));
}));

$('#btn-drive').addEventListener('click', () => conCarga($('#btn-drive'), async () => {
  const r = await pedirInforme(true);
  pintarInforme(r);
  const box = $('#doc-links');
  box.hidden = false;
  box.innerHTML = r.documento
    ? `<span>✓ ${esc(r.documento.nombre)}</span>
       <a href="${esc(r.documento.url)}" target="_blank" rel="noopener">Abrir Google Sheet</a>
       <a href="${esc(r.documento.pdfUrl)}" target="_blank" rel="noopener">Abrir PDF</a>`
    : '<span>En modo demo no se crea documento en Drive. Usa “Imprimir / PDF” o los botones CSV.</span>';
  toast(r.documento ? 'Documento creado en Drive' : 'Modo demo: sin Drive', r.documento ? 'ok' : '');
}, 'Generando…'));

const tabla = (cols, filas) =>
  `<thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
   <tbody>${filas.length
     ? filas.map(f => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.html ? c.v(f) : esc(c.v(f))}</td>`).join('')}</tr>`).join('')
     : `<tr><td colspan="${cols.length}" class="muted">Sin datos en el periodo seleccionado</td></tr>`}</tbody>`;

const COLS = {
  totales: [
    { t: 'Código', v: f => f.codigo }, { t: 'Nombre', v: f => f.nombre },
    { t: 'Días', v: f => f.dias, num: 1 }, { t: 'Horas totales', v: f => f.horas, num: 1 },
    { t: 'Media diaria', v: f => f.media, num: 1 }, { t: 'Días con incidencias', v: f => f.incidencias, num: 1 }
  ],
  diario: [
    { t: 'Fecha', v: f => fechaES(f.fecha) }, { t: 'Código', v: f => f.codigo }, { t: 'Nombre', v: f => f.nombre },
    { t: 'Entrada', v: f => (f.primeraEntrada || '').slice(0, 5) }, { t: 'Salida', v: f => (f.ultimaSalida || '').replace(/:\d\d( |$)/, '$1') },
    { t: 'Tramos', v: f => f.tramos, num: 1 }, { t: 'Horas', v: f => f.horas, num: 1 },
    { t: 'Incidencias', v: f => f.incidencias ? `<span class="tag warn">${esc(f.incidencias)}</span>` : '', html: 1, wrap: 1 }
  ],
  fichajes: [
    { t: 'Fecha', v: f => fechaES(f.fecha) }, { t: 'Hora', v: f => f.hora }, { t: 'Código', v: f => f.codigo },
    { t: 'Nombre', v: f => f.nombre }, { t: 'Tipo', v: f => `<span class="tag ${esc(f.tipo)}">${esc(f.tipo)}</span>`, html: 1 },
    { t: 'Dispositivo', v: f => f.dispositivo },
    { t: 'Ubicación', v: f => f.lat ? `<a href="https://maps.google.com/?q=${esc(f.lat)},${esc(f.lon)}" target="_blank" rel="noopener">Ver mapa</a>` : '', html: 1 }
  ]
};

function pintarInforme(r) {
  admin.informe = r;
  $('#resultado').hidden = false;
  const min = r.totales.reduce((s, t) => s + t.minutos, 0);
  const inc = r.diario.filter(d => d.incidencias).length;
  $('#stats').innerHTML = [
    [r.totales.length, 'Empleados'], [r.fichajes.length, 'Fichajes'],
    [hhmm(min), 'Horas totales'], [inc, 'Días con incidencias']
  ].map(([v, l]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${l}</div></div>`).join('');
  $('#t-totales').innerHTML = tabla(COLS.totales, r.totales);
  $('#t-diario').innerHTML = tabla(COLS.diario, ordenarDesc(r.diario));
  $('#t-fichajes').innerHTML = tabla(COLS.fichajes, ordenarDesc(r.fichajes));
}

/* CSV con BOM y ";" para que Excel en español lo abra bien */
function descargarCSV(tipo) {
  const r = admin.informe;
  if (!r) return;
  const defs = {
    totales: [['Código', 'Nombre', 'Días trabajados', 'Horas totales', 'Media diaria', 'Días con incidencias'],
      r.totales.map(t => [t.codigo, t.nombre, t.dias, t.horas, t.media, t.incidencias])],
    diario: [['Fecha', 'Código', 'Nombre', 'Primera entrada', 'Última salida', 'Tramos', 'Horas', 'Minutos', 'Incidencias'],
      r.diario.map(d => [fechaES(d.fecha), d.codigo, d.nombre, d.primeraEntrada, d.ultimaSalida, d.tramos, d.horas, d.minutos, d.incidencias])],
    fichajes: [['Fecha', 'Hora', 'Código', 'Nombre', 'Tipo', 'Dispositivo', 'Latitud', 'Longitud'],
      r.fichajes.map(f => [fechaES(f.fecha), f.hora, f.codigo, f.nombre, f.tipo, f.dispositivo, f.lat, f.lon])]
  };
  const [cab, filas] = defs[tipo];
  const celda = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cab, ...filas].map(f => f.map(celda).join(';')).join('\r\n');
  const quien = $('#f-emp').value === '*' ? 'todos' : $('#f-emp').value;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `fichajes_${tipo}_${quien}_${$('#f-desde').value || 'inicio'}_${$('#f-hasta').value || 'hoy'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$$('[data-csv]').forEach(b => b.addEventListener('click', () => descargarCSV(b.dataset.csv)));
$('#btn-print').addEventListener('click', () => window.print());

/* ============================ Lógica de resumen (igual que en Code.gs) ============================ */
function resumir(fs) {
  const porEmp = {};
  fs.forEach(f => (porEmp[f.codigo] ||= []).push(f));
  const out = [];
  Object.keys(porEmp).sort().forEach(cod => {
    const lista = porEmp[cod].slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const dias = {};
    const dia = f => (dias[f.fecha] ||= { codigo: cod, nombre: f.nombre, fecha: f.fecha, primeraEntrada: '', ultimaSalida: '', tramos: 0, minutos: 0, incidencias: [] });
    let abierta = null;
    lista.forEach(f => {
      if (f.tipo === 'Entrada') {
        if (abierta) dia(abierta).incidencias.push(`Entrada ${abierta.hora.slice(0, 5)} sin salida`);
        abierta = f;
        const d = dia(f);
        if (!d.primeraEntrada) d.primeraEntrada = f.hora;
      } else {
        if (!abierta) { dia(f).incidencias.push(`Salida ${f.hora.slice(0, 5)} sin entrada`); return; }
        const d = dia(abierta);
        d.minutos += Math.max(0, (new Date(f.ts) - new Date(abierta.ts)) / 60000);
        d.tramos++;
        d.ultimaSalida = f.fecha === abierta.fecha ? f.hora : `${f.hora} (+1d)`;
        abierta = null;
      }
    });
    if (abierta) dia(abierta).incidencias.push(`Entrada ${abierta.hora.slice(0, 5)} abierta`);
    Object.keys(dias).sort().forEach(k => {
      const d = dias[k];
      d.minutos = Math.round(d.minutos);
      d.horas = hhmm(d.minutos);
      d.incidencias = d.incidencias.join('; ');
      out.push(d);
    });
  });
  return out;
}

function totalizar(diario) {
  const t = {};
  diario.forEach(d => {
    const x = (t[d.codigo] ||= { codigo: d.codigo, nombre: d.nombre, dias: 0, minutos: 0, incidencias: 0 });
    if (d.tramos > 0) x.dias++;
    x.minutos += d.minutos;
    if (d.incidencias) x.incidencias++;
  });
  return Object.keys(t).sort().map(k => ({ ...t[k], horas: hhmm(t[k].minutos), media: t[k].dias ? hhmm(t[k].minutos / t[k].dias) : '0:00' }));
}

/* ============================ MODO DEMO (sin backend) ============================ */
const Demo = {
  KEY: 'fichaje_demo_v1',
  ADMIN: 'admin',
  EMPLEADOS: [
    { codigo: 'E001', nombre: 'Ana García', pin: '1234', activo: true },
    { codigo: 'E002', nombre: 'Jordi Puig', pin: '5678', activo: true },
    { codigo: 'E003', nombre: 'Laura Martín', pin: '0000', activo: true }
  ],

  fichajes() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    const datos = this.semilla();
    this.guardar(datos);
    return datos;
  },
  guardar(d) { try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch {} },

  crear(emp, tipo, fecha, extra = {}) {
    return {
      id: Math.random().toString(16).slice(2, 10),
      fecha: isoLocal(fecha),
      hora: horaLocal(fecha),
      ts: fecha.toISOString(),
      codigo: emp.codigo, nombre: emp.nombre, tipo,
      dispositivo: extra.dispositivo || 'Demo', lat: extra.lat ?? '', lon: extra.lon ?? '', obs: ''
    };
  },

  semilla() {
    const out = [];
    const hoy = new Date();
    let n_dia = 0;
    for (let i = 14; i >= 1; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      n_dia++;
      this.EMPLEADOS.slice(0, 2).forEach((e, n) => {
        const at = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m + ((i * 7 + n * 5) % 12), 0);
        out.push(this.crear(e, 'Entrada', at(8 + n, 50)));
        out.push(this.crear(e, 'Salida', at(14, 0)));
        if (!(e.codigo === 'E002' && n_dia === 4)) {           // un día con salida olvidada → incidencia
          out.push(this.crear(e, 'Entrada', at(15, 0)));
          out.push(this.crear(e, 'Salida', at(18 - n, 0)));
        } else {
          out.push(this.crear(e, 'Entrada', at(15, 0)));
        }
      });
    }
    return out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  },

  auth(codigo, pin) {
    const e = this.EMPLEADOS.find(x => x.codigo === String(codigo).toUpperCase());
    if (!e || e.pin !== String(pin)) throw new Error('Código o PIN incorrectos');
    return e;
  },

  estado(fs) {
    const ult = fs[fs.length - 1] || null;
    const hoy = isoLocal(new Date());
    return { dentro: !!ult && ult.tipo === 'Entrada', ultimo: ult, hoy: fs.filter(f => f.fecha === hoy) };
  },

  async handle(action, d) {
    await sleep(250);
    const pub = e => ({ codigo: e.codigo, nombre: e.nombre, activo: e.activo });
    if (action === 'estado') {
      const e = this.auth(d.codigo, d.pin);
      return { ok: true, empleado: pub(e), ...this.estado(this.fichajes().filter(f => f.codigo === e.codigo)) };
    }
    if (action === 'fichar') {
      const e = this.auth(d.codigo, d.pin);
      const todos = this.fichajes();
      const mios = todos.filter(f => f.codigo === e.codigo);
      const dentro = mios.at(-1)?.tipo === 'Entrada';
      if (d.tipo === 'Entrada' && dentro) throw new Error('Ya tienes una entrada abierta. Ficha la salida primero.');
      if (d.tipo === 'Salida' && !dentro) throw new Error('No tienes ninguna entrada abierta.');
      const nuevo = this.crear(e, d.tipo, new Date(), d);
      todos.push(nuevo); mios.push(nuevo);
      this.guardar(todos);
      return { ok: true, empleado: pub(e), fichaje: nuevo, ...this.estado(mios) };
    }
    if (action === 'empleados' || action === 'informe') {
      if (d.password !== this.ADMIN) throw new Error('Contraseña de administración incorrecta');
    }
    if (action === 'empleados') return { ok: true, empleados: this.EMPLEADOS.map(pub) };
    if (action === 'informe') {
      const desde = d.desde || '0000-00-00', hasta = d.hasta || '9999-12-31';
      const base = this.fichajes().filter(f => d.codigo === '*' || f.codigo === d.codigo);
      const en = f => f.fecha >= desde && f.fecha <= hasta;
      const diario = resumir(base).filter(en);
      return { ok: true, fichajes: base.filter(en), diario, totales: totalizar(diario), documento: null };
    }
    throw new Error('Acción no válida');
  }
};

/* ============================ Inicio ============================ */
(function init() {
  $('#empresa').textContent = CONFIG.EMPRESA;
  document.title = `${CONFIG.EMPRESA} · Fichaje`;
  $('#demo-banner').hidden = !!CONFIG.API_URL;
  tick();
  setInterval(tick, 1000);
  $$('.tabs button').forEach(b => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
  if (location.hash === '#admin') mostrarTab('admin');
  try {
    const cod = localStorage.getItem('fichaje_codigo');
    if (cod) { $('#codigo').value = cod; $('#recordar').checked = true; }
  } catch {}
  pintarFichar();
})();
