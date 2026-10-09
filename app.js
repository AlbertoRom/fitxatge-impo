/* =====================================================================
 *  CONFIGURACIÓ
 *  API_URL: la URL /exec del teu Google Apps Script.
 *  Si la deixes buida, la web funciona en MODE DEMO (dades al navegador).
 * ===================================================================== */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyf45k9Vfw4utsff3LPfNk61bwY6LLlufly4VS2NXq4dzTZ2ml2MQq2BGslfDXYAxBUjw/exec',
  TITOL: "Full d'assistència",
  PLANTILLA: 'plantilla.pdf',
  AUTO_LOGOUT_SEG: 300          // tanca la sessió després de 5 min sense activitat (0 = mai)
};

const TIPUS = { EM: 'Entrada matí', SM: 'Sortida matí', ET: 'Entrada tarda', ST: 'Sortida tarda' };
const ORDRE = ['EM', 'SM', 'ET', 'ST'];
const MOTIUS = {
  PJ: 'Permís justificat', V: 'Vacances', FE: 'Festiu', NL: 'No laborable',
  BE: 'Baixa malaltia comuna', BA: 'Baixa accident laboral', A: 'Absència injustificada'
};
const MESOS = ['GENER', 'FEBRER', 'MARÇ', 'ABRIL', 'MAIG', 'JUNY', 'JULIOL', 'AGOST', 'SETEMBRE', 'OCTUBRE', 'NOVEMBRE', 'DESEMBRE'];

/* ============================ Utilitats ============================ */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoData = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoMes = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const horaLocal = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dataCat = iso => { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };
const hm = h => String(h || '').slice(0, 5);
const aMinuts = h => { const m = String(h || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = min => `${Math.floor(Math.round(min) / 60)}:${pad(Math.round(min) % 60)}`;
const nomMes = mes => { const [a, m] = mes.split('-'); return `${MESOS[+m - 1]} ${a}`; };
const nomMesCurt = mes => { const n = nomMes(mes).toLowerCase(); return n.charAt(0).toUpperCase() + n.slice(1); };
const sumaMes = (mes, d) => { const [a, m] = mes.split('-').map(Number); return isoMes(new Date(a, m - 1 + d, 1)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(msg, tipus = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${tipus}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 3600);
}

async function ambCarrega(btn, fn, text) {
  const html = btn.innerHTML;
  btn.disabled = true;
  if (text) btn.textContent = text;
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || 'Error de connexió', 'error'); }
  finally { btn.disabled = false; btn.innerHTML = html; }
}

function dispositiu() {
  const ua = navigator.userAgent;
  const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Altre';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const tipus = /Mobi|Android|iPhone/i.test(ua) ? 'Mòbil' : /iPad|Tablet/i.test(ua) ? 'Tauleta' : 'Ordinador';
  return `${tipus} · ${so} · ${nav}`;
}

function ubicacio() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

function bytesABase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function descarregar(bytesOText, nom, tipus) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytesOText], { type: tipus }));
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================ API ============================ */
async function api(action, dades = {}) {
  if (!CONFIG.API_URL) return Demo.handle(action, dades);
  const r = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // evita el preflight CORS d'Apps Script
    body: JSON.stringify({ action, ...dades })
  });
  if (!r.ok) throw new Error(`Error del servidor (${r.status})`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Error desconegut');
  return j;
}

/* ============================ Càlcul del mes ============================ */
/** Construeix la graella del full: una entrada per dia amb EM/SM/ET/ST, absències i hores */
function construirMes(mes, fitxatges, absencies) {
  const [a, m] = mes.split('-').map(Number);
  const nDies = new Date(a, m, 0).getDate();
  const dies = Array.from({ length: nDies }, (_, i) => ({
    dia: i + 1, data: `${mes}-${pad(i + 1)}`, cap: [0, 6].includes(new Date(a, m - 1, i + 1).getDay()),
    EM: '', SM: '', ET: '', ST: '', absMin: 0, motius: [], minuts: 0, incidencies: []
  }));
  const ordenats = fitxatges.slice().sort((x, y) => (x.data + x.hora).localeCompare(y.data + y.hora));
  ordenats.forEach(f => {
    const d = dies[+f.data.slice(8, 10) - 1];
    if (d && ORDRE.includes(f.tipus) && !d[f.tipus]) d[f.tipus] = f.hora;
  });
  absencies.forEach(ab => {
    const d = dies[+ab.data.slice(8, 10) - 1];
    if (!d) return;
    d.absMin += aMinuts(ab.hores) || 0;
    if (!d.motius.includes(ab.motiu)) d.motius.push(ab.motiu);
  });
  const tram = (e, s, nom) => (d) => {
    if (d[e] && d[s]) d.minuts += Math.max(0, aMinuts(d[s]) - aMinuts(d[e]));
    else if (d[e] && !d[s] && d.data < isoData(new Date())) d.incidencies.push(`${nom} sense sortida`);
    else if (!d[e] && d[s]) d.incidencies.push(`${nom} sense entrada`);
  };
  const mati = tram('EM', 'SM', 'Matí'), tarda = tram('ET', 'ST', 'Tarda');
  dies.forEach(d => { mati(d); tarda(d); });
  const ambDades = dies.filter(d => d.EM || d.SM || d.ET || d.ST || d.absMin || d.motius.length);
  return {
    mes, dies, ambDades,
    totals: {
      diesTreballats: dies.filter(d => d.minuts > 0).length,
      minuts: dies.reduce((s, d) => s + d.minuts, 0),
      absMin: dies.reduce((s, d) => s + d.absMin, 0),
      incidencies: dies.filter(d => d.incidencies.length).length
    }
  };
}

/* ============================ Generació del PDF ============================ */
/* Coordenades de la plantilla (punts, origen a dalt a l'esquerra; A4 = 595 x 842) */
const G = {
  H: 842,
  info: { x: 113, ample: 184, files: { nom: 107.5, projecte: 117.4, categoria: 127.3, responsable: 137.3, mes: 146.6 }, alt: 9.6 },
  files: [262.8, 276.2, 289.6, 303.0, 316.5, 329.9, 343.3, 356.7, 370.2, 383.6, 397.0, 410.4, 423.9, 437.3, 450.7, 464.1, 477.6],
  colsE: [[55, 91.7], [91.7, 130.3], [130.3, 163], [163, 200.9], [200.9, 243.5], [243.5, 290.8]],
  colsD: [[328.1, 366.1], [366.1, 404], [404, 436.7], [436.7, 474.7], [474.7, 517.3], [517.3, 559.3]],
  tasques: { x0: 36, x1: 559.3, top: 504.4, bottom: 684.8 },
  sigT: { dataX: 63.5, base: 713.6, caixa: [152, 699, 296, 746] },
  sigR: { dataX: 328, base: 713.6, caixa: [418, 699, 555, 746] }
};

/* Helvetica (WinAnsi) no admet emojis ni alguns símbols: els netegem */
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function netejaText(t) {
  return String(t ?? '')
    .replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
    .replace(/‐|‑|‒/g, '-').replace(/ /g, ' ')
    .split('').filter(c => c === '\n' || (c.charCodeAt(0) >= 32 && (c.charCodeAt(0) <= 255 || WINANSI_EXTRA.includes(c)))).join('');
}

function partirLinies(text, font, mida, ample) {
  const linies = [];
  netejaText(text).split('\n').forEach(par => {
    let actual = '';
    par.split(/ +/).forEach(paraula => {
      const prova = actual ? `${actual} ${paraula}` : paraula;
      if (font.widthOfTextAtSize(prova, mida) <= ample) { actual = prova; return; }
      if (actual) linies.push(actual);
      // paraula més llarga que la línia: la tallem
      while (font.widthOfTextAtSize(paraula, mida) > ample) {
        let n = paraula.length;
        while (n > 1 && font.widthOfTextAtSize(paraula.slice(0, n), mida) > ample) n--;
        linies.push(paraula.slice(0, n));
        paraula = paraula.slice(n);
      }
      actual = paraula;
    });
    linies.push(actual);
  });
  while (linies.length && !linies[linies.length - 1]) linies.pop();
  return linies;
}

let plantillaCache = null;
async function carregarPlantilla() {
  if (!plantillaCache) {
    const r = await fetch(CONFIG.PLANTILLA);
    if (!r.ok) throw new Error("No s'ha pogut carregar la plantilla PDF");
    plantillaCache = await r.arrayBuffer();
  }
  return plantillaCache;
}

/**
 * fulls: [{ empleat, mes, fitxatges, absencies, tasques, signatura, dataSignatura }]
 * opcions: { signaturaResp, dataResp }
 */
async function generarPdf(fulls, opcions = {}) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const plantilla = await PDFDocument.load(await carregarPlantilla());
  const doc = await PDFDocument.create();
  doc.setTitle(fulls.length === 1 ? `Full d'assistència ${nomMes(fulls[0].mes)} - ${fulls[0].empleat.nom}` : `Fulls d'assistència ${nomMes(fulls[0].mes)}`);
  doc.setCreator('Fitxatge web');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const negre = rgb(0.05, 0.05, 0.1);
  const blau = rgb(0.05, 0.15, 0.45);
  const Y = top => G.H - top;
  const sigResp = opcions.signaturaResp ? await doc.embedPng(opcions.signaturaResp) : null;

  for (const f of fulls) {
    const [pagina] = await doc.copyPages(plantilla, [0]);
    doc.addPage(pagina);
    const p = pagina;
    const escriu = (text, x, top, mida = 8, color = negre) =>
      p.drawText(netejaText(text), { x, y: Y(top), size: mida, font, color });
    const centrat = (text, [x0, x1], top, mida = 8, color = blau) => {
      text = netejaText(text);
      while (text.length > 1 && font.widthOfTextAtSize(text, mida) > x1 - x0 - 3) text = text.slice(0, -1);
      escriu(text, (x0 + x1) / 2 - font.widthOfTextAtSize(text, mida) / 2, top, mida, color);
    };
    const encaixa = (text, mida, ample) => {
      text = netejaText(text);
      while (text.length > 1 && font.widthOfTextAtSize(text, mida) > ample) text = text.slice(0, -1);
      return text;
    };

    // Capçalera
    const e = f.empleat;
    const info = { nom: e.nom, projecte: e.projecte, categoria: e.categoria, responsable: e.responsable, mes: nomMes(f.mes) };
    Object.entries(G.info.files).forEach(([clau, top]) =>
      escriu(encaixa(info[clau] || '', 7.6, G.info.ample), G.info.x, top + 7.6, 7.6));

    // Graella de dies
    const graella = construirMes(f.mes, f.fitxatges, f.absencies);
    graella.dies.forEach(d => {
      const fila = d.dia <= 15 ? d.dia - 1 : d.dia - 16;
      const cols = d.dia <= 15 ? G.colsE : G.colsD;
      const top = G.files[fila] + 9.4;
      const valors = [hm(d.EM), hm(d.SM), hm(d.ET), hm(d.ST), d.absMin ? hhmm(d.absMin) : '', d.motius.join('/')];
      valors.forEach((v, i) => v && centrat(v, cols[i], top));
    });

    // Resum de tasques (redueix la lletra si cal perquè hi càpiga)
    const T = G.tasques, ample = T.x1 - T.x0 - 12, alt = T.bottom - T.top - 10;
    let mida = 9, linies;
    for (; mida >= 6; mida -= 0.5) {
      linies = partirLinies(f.tasques || '', font, mida, ample);
      if (linies.length * mida * 1.25 <= alt) break;
    }
    const maxLinies = Math.floor(alt / (mida * 1.25));
    if (linies.length > maxLinies) { linies = linies.slice(0, maxLinies); linies[maxLinies - 1] += ' …'; }
    linies.forEach((l, i) => escriu(l, T.x0 + 6, T.top + 6 + mida + i * mida * 1.25, mida));

    // Signatures
    const posaSignatura = (img, [x0, t0, x1, t1]) => {
      const esc = Math.min((x1 - x0) / img.width, (t1 - t0) / img.height);
      const w = img.width * esc, h = img.height * esc;
      p.drawImage(img, { x: x0 + (x1 - x0 - w) / 2, y: Y(t1) + (t1 - t0 - h) / 2, width: w, height: h });
    };
    if (f.signatura) {
      posaSignatura(await doc.embedPng(f.signatura), G.sigT.caixa);
      escriu(dataCat(f.dataSignatura || isoData(new Date())), G.sigT.dataX, G.sigT.base, 8.3);
    }
    if (sigResp) {
      posaSignatura(sigResp, G.sigR.caixa);
      escriu(dataCat(opcions.dataResp || isoData(new Date())), G.sigR.dataX, G.sigR.base, 8.3);
    }
  }
  return doc.save();
}

/* ============================ Signatura ============================ */
class Signatura {
  constructor(canvas) {
    this.c = canvas;
    this.wrap = canvas.parentElement;
    this.traços = [];
    this.actual = null;
    this.ample = 0;
    const pos = e => { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.actual = [pos(e)];
      this.traços.push(this.actual);
      this.dibuixa();
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.actual) return;
      (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach(ev => this.actual.push(pos(ev)));
      this.dibuixa();
    });
    const fi = () => { this.actual = null; this.wrap.classList.toggle('signat', !this.buida()); };
    canvas.addEventListener('pointerup', fi);
    canvas.addEventListener('pointercancel', fi);
    new ResizeObserver(() => this.ajusta()).observe(canvas);
  }
  ajusta() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    if (this.ample && this.ample !== r.width) {               // reescala els traços si canvia la mida
      const k = r.width / this.ample;
      this.traços = this.traços.map(t => t.map(([x, y]) => [x * k, y * k]));
    }
    this.ample = r.width;
    const dpr = window.devicePixelRatio || 1;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.dibuixa();
  }
  traça(ctx, k = 1, dx = 0, dy = 0) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0d1b3d'; ctx.lineWidth = 2.4 * k;
    this.traços.forEach(t => {
      ctx.beginPath();
      t.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (x - dx) * k, (y - dy) * k));
      if (t.length === 1) ctx.lineTo((t[0][0] - dx) * k + 0.1, (t[0][1] - dy) * k);
      ctx.stroke();
    });
  }
  dibuixa() {
    const ctx = this.c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    this.traça(ctx, dpr);
  }
  buida() { return !this.traços.some(t => t.length > 1); }
  neteja() { this.traços = []; this.dibuixa(); this.wrap.classList.remove('signat'); }
  /** PNG retallat a la signatura, fons transparent */
  png() {
    if (this.buida()) return '';
    const xs = this.traços.flat().map(p => p[0]), ys = this.traços.flat().map(p => p[1]);
    const m = 4, x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m;
    const w = Math.max(...xs) + m - x0, h = Math.max(...ys) + m - y0;
    const k = Math.min(3, 900 / w);
    const off = document.createElement('canvas');
    off.width = Math.ceil(w * k); off.height = Math.ceil(h * k);
    this.traça(off.getContext('2d'), k, x0, y0);
    return off.toDataURL('image/png');
  }
}

/* ============================ Rellotge i pestanyes ============================ */
function rellotge() {
  const d = new Date();
  $('#hora').textContent = horaLocal(d);
  const t = d.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#data').textContent = t.charAt(0).toUpperCase() + t.slice(1);
}
function mostraTab(nom) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === nom));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${nom}`));
  history.replaceState(null, '', nom === 'admin' ? '#admin' : location.pathname + location.search);
  if (nom === 'admin') sigResp.ajusta(); else sig.ajusta();
}

/* ============================ TREBALLADOR ============================ */
const sessio = { codi: null, pin: null, empleat: null, avui: null, mes: null, dades: null };
let temporitzador = null;
const sig = new Signatura($('#sig'));

function estatBotons(a) {
  const pot = {
    EM: !a.EM && !a.ET,
    SM: !!a.EM && !a.SM,
    ET: !a.ET && !(a.EM && !a.SM),
    ST: !!a.ET && !a.ST
  };
  let seguent = null;
  if (a.EM && !a.SM) seguent = 'SM';
  else if (a.ET && !a.ST) seguent = 'ST';
  else if (!a.EM && !a.ET) seguent = new Date().getHours() < 14 ? 'EM' : 'ET';
  else if (a.SM && !a.ET) seguent = 'ET';
  return { pot, seguent };
}

function pintaAvui() {
  const a = sessio.avui;
  const { pot, seguent } = estatBotons(a);
  $$('.fitxa').forEach(b => {
    const t = b.dataset.tipus;
    b.className = 'fitxa' + (a[t] ? ' fet' : t === seguent ? ' seguent' : pot[t] ? ' possible' : '');
    b.disabled = !!a[t] || !pot[t];
    b.querySelector('.f-hora').textContent = a[t] ? hm(a[t]) : '';
  });
  const est = $('#estat');
  const obert = a.EM && !a.SM ? ['EM', 'matí'] : a.ET && !a.ST ? ['ET', 'tarda'] : null;
  if (obert) {
    est.className = 'estat dins';
    est.textContent = `Treballant des de les ${hm(a[obert[0]])} (${obert[1]})`;
  } else {
    const min = (a.EM && a.SM ? aMinuts(a.SM) - aMinuts(a.EM) : 0) + (a.ET && a.ST ? aMinuts(a.ST) - aMinuts(a.ET) : 0);
    est.className = 'estat fora';
    est.textContent = ORDRE.some(t => a[t]) ? `Fora · avui portes ${hhmm(min)} h treballades` : 'Encara no has fitxat avui';
  }
}

function pintaMes() {
  const d = sessio.dades;
  if (!d) return;
  const g = construirMes(d.mes, d.fitxatges, d.absencies);
  $('#resum-mes-txt').textContent =
    `${nomMesCurt(d.mes)}: ${g.totals.diesTreballats} dies · ${hhmm(g.totals.minuts)} h` + (g.totals.absMin ? ` · ${hhmm(g.totals.absMin)} h absència` : '');
  $('#t-mes').innerHTML = `<thead><tr><th>Dia</th><th>Ent. matí</th><th>Sort. matí</th><th>Ent. tarda</th><th>Sort. tarda</th><th class="num">Abs.</th><th>Motiu</th></tr></thead><tbody>${
    g.ambDades.length ? g.ambDades.map(x => `<tr><td>${x.dia}</td><td>${hm(x.EM)}</td><td>${hm(x.SM)}</td><td>${hm(x.ET)}</td><td>${hm(x.ST)}</td>
      <td class="num">${x.absMin ? hhmm(x.absMin) : ''}</td><td>${esc(x.motius.join('/'))}</td></tr>`).join('')
    : '<tr><td colspan="7" class="muted">Cap registre aquest mes</td></tr>'}</tbody>`;

  $('#llista-abs').innerHTML = d.absencies.slice().sort((a, b) => a.data.localeCompare(b.data)).map(a =>
    `<li><span><b>${dataCat(a.data)}</b> · ${esc(a.hores)} h · ${esc(a.motiu)} <span class="muted">(${esc(MOTIUS[a.motiu] || '')})</span></span>
     <button class="x" data-id="${esc(a.id)}" type="button">Esborrar</button></li>`).join('');

  if (document.activeElement !== $('#tasques')) $('#tasques').value = d.tasques || '';
  $('#tasques-estat').textContent = '';
  $('#pdf-drive').innerHTML = d.pdfUrl ? `Últim full desat a Drive: <a href="${esc(d.pdfUrl)}" target="_blank" rel="noopener">obrir</a>` : '';
}

function aplicaEstat(r) {
  sessio.empleat = r.empleat;
  sessio.avui = r.avui;
  $('#card-login').hidden = true;
  $('#zona-treballador').hidden = false;
  $('#emp-nom').textContent = r.empleat.nom;

  const avui = new Date(), actual = isoMes(avui), anterior = sumaMes(actual, -1);
  $('#sel-mes').innerHTML = [actual, anterior].map(m => `<option value="${m}">${nomMesCurt(m)}</option>`).join('');
  // De l'1 al 5 de cada mes es lliura el full del mes anterior
  sessio.mes = avui.getDate() <= 5 ? anterior : actual;
  $('#sel-mes').value = sessio.mes;
  $('#abs-data').value = isoData(avui);
  $('#abs-data').min = `${anterior}-01`;
  $('#abs-data').max = isoData(new Date(avui.getFullYear(), avui.getMonth() + 2, 0));

  pintaAvui();
  sig.neteja();
  requestAnimationFrame(() => sig.ajusta());
  if (sessio.mes === actual) { sessio.dades = r; pintaMes(); }
  else carregaMes();
  reiniciaInactivitat();
}

async function carregaMes() {
  try {
    sessio.dades = await api('mes', { codi: sessio.codi, pin: sessio.pin, mes: sessio.mes });
    pintaMes();
  } catch (e) { toast(e.message, 'error'); }
}

function tancaSessio() {
  Object.assign(sessio, { codi: null, pin: null, empleat: null, avui: null, mes: null, dades: null });
  $('#pin').value = '';
  $('#tasques').value = '';
  if (!$('#recordar').checked) $('#codi').value = '';
  sig.neteja();
  clearInterval(temporitzador);
  $('#auto-logout').textContent = '';
  $('#zona-treballador').hidden = true;
  $('#card-login').hidden = false;
  ($('#codi').value ? $('#pin') : $('#codi')).focus();
}

function reiniciaInactivitat() {
  clearInterval(temporitzador);
  $('#auto-logout').textContent = '';
  if (!CONFIG.AUTO_LOGOUT_SEG || !sessio.empleat) return;
  let queden = CONFIG.AUTO_LOGOUT_SEG;
  temporitzador = setInterval(() => {
    queden--;
    if (queden <= 20) $('#auto-logout').textContent = `La sessió es tancarà d'aquí a ${queden} s`;
    if (queden <= 0) tancaSessio();
  }, 1000);
}
['pointerdown', 'keydown', 'input'].forEach(ev => document.addEventListener(ev, () => sessio.empleat && reiniciaInactivitat(), { passive: true }));

$('#form-login').addEventListener('submit', e => {
  e.preventDefault();
  ambCarrega(e.submitter || $('#form-login button'), async () => {
    const codi = $('#codi').value.trim().toUpperCase(), pin = $('#pin').value.trim();
    const r = await api('estat', { codi, pin });
    Object.assign(sessio, { codi, pin });
    try { $('#recordar').checked ? localStorage.setItem('fitxatge_codi', codi) : localStorage.removeItem('fitxatge_codi'); } catch {}
    aplicaEstat(r);
  });
});

$$('.fitxa').forEach(b => b.addEventListener('click', () => ambCarrega(b, async () => {
  const tipus = b.dataset.tipus;
  const pos = $('#geo').checked ? await ubicacio() : null;
  const r = await api('fitxar', { codi: sessio.codi, pin: sessio.pin, tipus, dispositiu: dispositiu(), lat: pos?.lat ?? '', lon: pos?.lon ?? '' });
  sessio.avui = r.avui;
  pintaAvui();
  navigator.vibrate?.(80);
  toast(`${TIPUS[tipus]} registrada a les ${hm(r.hora)}`, 'ok');
  if (sessio.mes === isoMes(new Date())) carregaMes();
}).then(() => sessio.avui && pintaAvui())));

$('#btn-sortir').addEventListener('click', tancaSessio);

/* Absències */
$('#abs-motiu').innerHTML = Object.entries(MOTIUS).map(([k, v]) => `<option value="${k}">${v} (${k})</option>`).join('');
$('#form-abs').addEventListener('submit', e => {
  e.preventDefault();
  ambCarrega(e.submitter || $('#form-abs button'), async () => {
    const data = $('#abs-data').value;
    const r = await api('absencia', { codi: sessio.codi, pin: sessio.pin, data, motiu: $('#abs-motiu').value, hores: $('#abs-hores').value.trim() });
    $('#abs-hores').value = '';
    toast(`Absència del ${dataCat(data)} desada`, 'ok');
    if (r.mes === sessio.mes) { sessio.dades = { ...sessio.dades, ...r }; pintaMes(); }
  });
});
$('#llista-abs').addEventListener('click', e => {
  const b = e.target.closest('.x');
  if (!b) return;
  ambCarrega(b, async () => {
    const r = await api('esborrarAbsencia', { codi: sessio.codi, pin: sessio.pin, id: b.dataset.id });
    if (r.mes === sessio.mes) { sessio.dades = { ...sessio.dades, ...r }; pintaMes(); }
    toast('Absència esborrada');
  });
});

/* Full mensual */
$('#sel-mes').addEventListener('change', () => { sessio.mes = $('#sel-mes').value; carregaMes(); });

async function desaTasques() {
  await api('tasques', { codi: sessio.codi, pin: sessio.pin, mes: sessio.mes, text: $('#tasques').value });
  if (sessio.dades) sessio.dades.tasques = $('#tasques').value;
  $('#tasques-estat').textContent = `Desat a les ${hm(horaLocal(new Date()))}`;
}
$('#btn-tasques').addEventListener('click', () => ambCarrega($('#btn-tasques'), desaTasques));
$('#tasques').addEventListener('input', () => ($('#tasques-estat').textContent = 'Canvis sense desar'));
$('#btn-netejar').addEventListener('click', () => sig.neteja());

$('#btn-pdf').addEventListener('click', () => ambCarrega($('#btn-pdf'), async () => {
  if (sig.buida()) throw new Error('Has de signar abans de generar el PDF');
  const signatura = sig.png();
  const tasques = $('#tasques').value;
  const d = await api('mes', { codi: sessio.codi, pin: sessio.pin, mes: sessio.mes });
  const bytes = await generarPdf([{ empleat: sessio.empleat, mes: sessio.mes, fitxatges: d.fitxatges, absencies: d.absencies, tasques, signatura }]);
  const nom = `Full_assistencia_${sessio.mes}_${sessio.empleat.codi}.pdf`;
  descarregar(bytes, nom, 'application/pdf');

  $('#btn-pdf').textContent = 'Desant a Drive…';
  const r = await api('desarFull', { codi: sessio.codi, pin: sessio.pin, mes: sessio.mes, tasques, signatura, pdf: bytesABase64(bytes) });
  sessio.dades = { ...d, tasques, pdfUrl: r.pdfUrl || '' };
  pintaMes();
  toast(r.pdfUrl ? 'PDF descarregat i desat a Drive' : 'PDF descarregat', 'ok');
}, 'Generant PDF…'));

/* ============================ ADMINISTRACIÓ ============================ */
const admin = { password: null, empleats: [], dades: null };
const sigResp = new Signatura($('#sig-resp'));

$('#form-admin').addEventListener('submit', e => {
  e.preventDefault();
  ambCarrega(e.submitter || $('#form-admin button'), async () => {
    const password = $('#admin-pass').value;
    const r = await api('empleats', { password });
    Object.assign(admin, { password, empleats: r.empleats });
    $('#f-emp').innerHTML = '<option value="*">Tots els empleats actius</option>' +
      r.empleats.map(x => `<option value="${esc(x.codi)}">${esc(x.codi)} · ${esc(x.nom)}${x.actiu ? '' : ' (baixa)'}</option>`).join('');
    const avui = new Date();
    $('#f-mes').value = avui.getDate() <= 10 ? sumaMes(isoMes(avui), -1) : isoMes(avui);
    $('#admin-pass').value = '';
    $('#card-admin-login').hidden = true;
    $('#admin-panel').hidden = false;
    requestAnimationFrame(() => sigResp.ajusta());
  });
});

$('#btn-admin-sortir').addEventListener('click', () => {
  Object.assign(admin, { password: null, empleats: [], dades: null });
  sigResp.neteja();
  $('#admin-panel').hidden = true;
  $('#resultat').hidden = true;
  $('#admin-links').hidden = true;
  $('#card-admin-login').hidden = false;
});
$('#btn-netejar-resp').addEventListener('click', () => sigResp.neteja());

async function dadesAdmin(ambSignatura) {
  const mes = $('#f-mes').value;
  if (!mes) throw new Error('Tria un mes');
  const r = await api('mesAdmin', { password: admin.password, mes, codi: $('#f-emp').value, ambSignatura });
  admin.dades = r;
  pintaAdmin(r);
  return r;
}

function pintaAdmin(r) {
  $('#resultat').hidden = false;
  const files = r.llista.map(x => ({ ...x, g: construirMes(r.mes, x.fitxatges, x.absencies) }));
  const tot = files.reduce((s, x) => ({ min: s.min + x.g.totals.minuts, abs: s.abs + x.g.totals.absMin }), { min: 0, abs: 0 });
  const enviats = files.filter(x => x.pdfUrl).length;
  $('#stats').innerHTML = [
    [files.length, 'Empleats'], [hhmm(tot.min), 'Hores treballades'], [hhmm(tot.abs), "Hores d'absència"], [`${enviats}/${files.length}`, 'Fulls signats a Drive']
  ].map(([v, l]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${l}</div></div>`).join('');

  $('#t-resum').innerHTML = `<thead><tr><th>Codi</th><th>Nom</th><th class="num">Dies</th><th class="num">Hores treb.</th><th class="num">Hores abs.</th><th class="num">Incidències</th><th>Full</th></tr></thead><tbody>${
    files.map(x => `<tr><td>${esc(x.empleat.codi)}</td><td>${esc(x.empleat.nom)}</td><td class="num">${x.g.totals.diesTreballats}</td>
      <td class="num">${hhmm(x.g.totals.minuts)}</td><td class="num">${hhmm(x.g.totals.absMin)}</td>
      <td class="num">${x.g.totals.incidencies ? `<span class="tag warn">${x.g.totals.incidencies}</span>` : '0'}</td>
      <td>${x.pdfUrl ? `<a class="tag ok" href="${esc(x.pdfUrl)}" target="_blank" rel="noopener">Signat ✓</a>` : '<span class="tag">Pendent</span>'}</td></tr>`).join('')}</tbody>`;

  const detall = files.flatMap(x => x.g.ambDades.map(d => ({ ...d, e: x.empleat })))
    .sort((a, b) => a.data.localeCompare(b.data) || a.e.codi.localeCompare(b.e.codi));
  $('#t-detall').innerHTML = `<thead><tr><th>Data</th><th>Codi</th><th>Nom</th><th>Ent. matí</th><th>Sort. matí</th><th>Ent. tarda</th><th>Sort. tarda</th><th class="num">Hores</th><th class="num">Abs.</th><th>Motiu</th><th>Incidències</th></tr></thead><tbody>${
    detall.length ? detall.map(d => `<tr class="${d.cap ? 'cap-setmana' : ''}"><td>${dataCat(d.data)}</td><td>${esc(d.e.codi)}</td><td>${esc(d.e.nom)}</td>
      <td>${hm(d.EM)}</td><td>${hm(d.SM)}</td><td>${hm(d.ET)}</td><td>${hm(d.ST)}</td><td class="num">${d.minuts ? hhmm(d.minuts) : ''}</td>
      <td class="num">${d.absMin ? hhmm(d.absMin) : ''}</td><td>${esc(d.motius.join('/'))}</td>
      <td class="wrap">${d.incidencies.length ? `<span class="tag warn">${esc(d.incidencies.join('; '))}</span>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="11" class="muted">Sense registres aquest mes</td></tr>'}</tbody>`;
}

async function pdfAdmin() {
  const r = await dadesAdmin($('#f-sig-treb').checked);
  const bytes = await generarPdf(r.llista.map(x => ({
    empleat: x.empleat, mes: r.mes, fitxatges: x.fitxatges, absencies: x.absencies, tasques: x.tasques,
    signatura: $('#f-sig-treb').checked ? x.signatura : ''
  })), { signaturaResp: sigResp.buida() ? '' : sigResp.png() });
  const qui = $('#f-emp').value === '*' ? 'tots' : $('#f-emp').value;
  return { bytes, nom: `Fulls_assistencia_${r.mes}_${qui}`, mes: r.mes };
}

$('#btn-veure').addEventListener('click', () => ambCarrega($('#btn-veure'), () => dadesAdmin(false)));
$('#btn-admin-pdf').addEventListener('click', () => ambCarrega($('#btn-admin-pdf'), async () => {
  const { bytes, nom } = await pdfAdmin();
  descarregar(bytes, `${nom}.pdf`, 'application/pdf');
}, 'Generant…'));
$('#btn-admin-drive').addEventListener('click', () => ambCarrega($('#btn-admin-drive'), async () => {
  const { bytes, nom, mes } = await pdfAdmin();
  const r = await api('desarPdfAdmin', { password: admin.password, mes, nom, pdf: bytesABase64(bytes) });
  const box = $('#admin-links');
  box.hidden = false;
  box.innerHTML = r.pdfUrl
    ? `<span>✓ ${esc(r.nom)}</span><a href="${esc(r.pdfUrl)}" target="_blank" rel="noopener">Obrir a Drive</a>`
    : '<span>En mode demo no es desa a Drive (el PDF s\'ha generat igualment).</span>';
  toast(r.pdfUrl ? 'PDF desat a Drive' : 'Mode demo: sense Drive', r.pdfUrl ? 'ok' : '');
}, 'Desant…'));

$('#btn-admin-csv').addEventListener('click', () => ambCarrega($('#btn-admin-csv'), async () => {
  const r = admin.dades && admin.dades.mes === $('#f-mes').value ? admin.dades : await dadesAdmin(false);
  const cel = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const files = [['Data', 'Codi', 'Nom', 'Entrada matí', 'Sortida matí', 'Entrada tarda', 'Sortida tarda', 'Hores treballades', 'Hores absència', 'Motiu', 'Incidències']];
  r.llista.forEach(x => construirMes(r.mes, x.fitxatges, x.absencies).ambDades.forEach(d => files.push([
    dataCat(d.data), x.empleat.codi, x.empleat.nom, hm(d.EM), hm(d.SM), hm(d.ET), hm(d.ST),
    d.minuts ? hhmm(d.minuts) : '', d.absMin ? hhmm(d.absMin) : '', d.motius.join('/'), d.incidencies.join('; ')
  ])));
  const qui = $('#f-emp').value === '*' ? 'tots' : $('#f-emp').value;
  descarregar('﻿' + files.map(f => f.map(cel).join(';')).join('\r\n'), `fitxatges_${r.mes}_${qui}.csv`, 'text/csv;charset=utf-8');
}));

/* ============================ MODE DEMO (sense backend) ============================ */
const Demo = {
  KEY: 'fitxatge_demo_v2',
  ADMIN: 'admin',
  EMPLEATS: [
    { codi: 'E001', nom: 'Agent cívic 1', pin: '1234', projecte: 'PO AGENTS CÍVICS', categoria: 'AGENT CÍVIC/A', responsable: 'Marta Soler', actiu: true },
    { codi: 'E002', nom: 'Agent cívic 2', pin: '5678', projecte: 'PO AGENTS CÍVICS', categoria: 'AGENT CÍVIC/A', responsable: 'Marta Soler', actiu: true }
  ],
  db() {
    try { const raw = localStorage.getItem(this.KEY); if (raw) return JSON.parse(raw); } catch {}
    const db = this.llavor();
    this.desa(db);
    return db;
  },
  desa(db) { try { localStorage.setItem(this.KEY, JSON.stringify(db)); } catch {} this._mem = db; },
  id: () => Math.random().toString(16).slice(2, 10),
  llavor() {
    const db = { fitxatges: [], absencies: [], mensual: {} };
    const avui = new Date();
    const inici = new Date(avui.getFullYear(), avui.getMonth() - 1, 1);
    for (let d = new Date(inici); d < new Date(avui.getFullYear(), avui.getMonth(), avui.getDate()); d.setDate(d.getDate() + 1)) {
      if ([0, 6].includes(d.getDay())) continue;
      const data = isoData(d), n = d.getDate();
      this.EMPLEATS.forEach((e, i) => {
        if (e.codi === 'E002' && n % 11 === 3) { db.absencies.push({ id: this.id(), data, codi: e.codi, nom: e.nom, hores: '07:00', motiu: 'PJ' }); return; }
        const m = (n * 7 + i * 3) % 9;
        const f = (tipus, h) => db.fitxatges.push({ id: this.id(), data, hora: h, codi: e.codi, nom: e.nom, tipus });
        f('EM', `${pad(8 + i)}:${pad(45 + m)}:00`);
        f('SM', `13:${pad(30 + m)}:00`);
        if (!(e.codi === 'E001' && n === 14)) {
          f('ET', `15:${pad(m)}:00`);
          f('ST', `17:${pad(30 + m)}:00`);
        }
      });
    }
    db.mensual[`E001|${isoMes(inici)}`] = { tasques: "Informació a la ciutadania als parcs i places del barri.\nSuport en activitats de civisme a la platja i acompanyament a la sortida d'escoles.\nDetecció i comunicació d'incidències a la via pública." };
    return db;
  },
  auth(codi, pin) {
    const e = this.EMPLEATS.find(x => x.codi === String(codi).toUpperCase());
    if (!e || e.pin !== String(pin)) throw new Error('Codi o PIN incorrectes');
    return e;
  },
  pub: e => ({ codi: e.codi, nom: e.nom, projecte: e.projecte, categoria: e.categoria, responsable: e.responsable, actiu: e.actiu }),
  avui(db, codi) {
    const r = { EM: '', SM: '', ET: '', ST: '' }, avui = isoData(new Date());
    db.fitxatges.forEach(f => { if (f.codi === codi && f.data === avui && !r[f.tipus]) r[f.tipus] = f.hora; });
    return r;
  },
  mes(db, e, mes) {
    const m = db.mensual[`${e.codi}|${mes}`] || {};
    return {
      mes, fitxatges: db.fitxatges.filter(f => f.codi === e.codi && f.data.startsWith(mes)),
      absencies: db.absencies.filter(a => a.codi === e.codi && a.data.startsWith(mes)),
      tasques: m.tasques || '', pdfUrl: '', teSignatura: !!m.signatura, signatura: m.signatura || ''
    };
  },
  async handle(action, d) {
    await sleep(200);
    const db = this.db();
    const ok = x => ({ ok: true, ...x });
    if (['empleats', 'mesAdmin', 'desarPdfAdmin'].includes(action)) {
      if (d.password !== this.ADMIN) throw new Error("Contrasenya d'administració incorrecta");
      if (action === 'empleats') return ok({ empleats: this.EMPLEATS.map(this.pub) });
      if (action === 'desarPdfAdmin') return ok({ pdfUrl: '', nom: d.nom });
      const llista = this.EMPLEATS.filter(e => d.codi === '*' || e.codi === d.codi).map(e => {
        const x = this.mes(db, e, d.mes);
        return { empleat: this.pub(e), fitxatges: x.fitxatges, absencies: x.absencies, tasques: x.tasques, pdfUrl: '', signatura: d.ambSignatura ? x.signatura : '' };
      });
      return ok({ mes: d.mes, llista });
    }
    const e = this.auth(d.codi, d.pin);
    if (action === 'estat') return ok({ empleat: this.pub(e), avui: this.avui(db, e.codi), ...this.mes(db, e, isoMes(new Date())) });
    if (action === 'mes') return ok(this.mes(db, e, d.mes));
    if (action === 'fitxar') {
      const a = this.avui(db, e.codi), t = d.tipus;
      if (a[t]) throw new Error(`${TIPUS[t]} ja registrada avui a les ${hm(a[t])}.`);
      if (!estatBotons(a).pot[t]) throw new Error('Aquest fitxatge no és vàlid ara mateix.');
      const ara = new Date();
      db.fitxatges.push({ id: this.id(), data: isoData(ara), hora: horaLocal(ara), codi: e.codi, nom: e.nom, tipus: t, dispositiu: d.dispositiu });
      this.desa(db);
      const nou = this.avui(db, e.codi);
      return ok({ avui: nou, tipus: t, hora: nou[t] });
    }
    if (action === 'absencia') {
      const m = String(d.hores).match(/^(\d{1,2})(?::(\d{2}))?$/);
      const min = m ? +m[1] * 60 + +(m[2] || 0) : 0;
      if (!m || !min || min > 720 || +(m[2] || 0) > 59) throw new Error('Hores no vàlides (format HH:MM, màxim 12:00)');
      db.absencies.push({ id: this.id(), data: d.data, codi: e.codi, nom: e.nom, hores: `${pad(Math.floor(min / 60))}:${pad(min % 60)}`, motiu: d.motiu });
      this.desa(db);
      return ok(this.mes(db, e, d.data.slice(0, 7)));
    }
    if (action === 'esborrarAbsencia') {
      const a = db.absencies.find(x => x.id === d.id && x.codi === e.codi);
      if (!a) throw new Error('Absència no trobada');
      db.absencies = db.absencies.filter(x => x !== a);
      this.desa(db);
      return ok(this.mes(db, e, a.data.slice(0, 7)));
    }
    if (action === 'tasques') {
      db.mensual[`${e.codi}|${d.mes}`] = { ...(db.mensual[`${e.codi}|${d.mes}`] || {}), tasques: d.text };
      this.desa(db);
      return ok({ desat: true });
    }
    if (action === 'desarFull') {
      db.mensual[`${e.codi}|${d.mes}`] = { ...(db.mensual[`${e.codi}|${d.mes}`] || {}), tasques: d.tasques, signatura: d.signatura };
      this.desa(db);
      return ok({ pdfUrl: '', nom: '' });
    }
    throw new Error('Acció no vàlida');
  }
};

/* ============================ Inici ============================ */
(function inici() {
  $('#titol').textContent = CONFIG.TITOL;
  $('#demo-banner').hidden = !!CONFIG.API_URL;
  rellotge();
  setInterval(rellotge, 1000);
  $$('.tabs button').forEach(b => b.addEventListener('click', () => mostraTab(b.dataset.tab)));
  if (location.hash === '#admin') mostraTab('admin');
  try {
    const codi = localStorage.getItem('fitxatge_codi');
    if (codi) { $('#codi').value = codi; $('#recordar').checked = true; }
  } catch {}
})();
