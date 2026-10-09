/**
 * FULL D'ASSISTÈNCIA MENSUAL — Backend (Google Apps Script)
 * ---------------------------------------------------------------
 * Vinculat a una Google Sheet del teu Drive. Desa:
 *   - Fitxatges (entrada/sortida matí i tarda)
 *   - Absències (hores + motiu)
 *   - Resum de tasques mensual i signatura
 *   - Els PDF generats, a la carpeta "Fulls d'assistència/AAAA-MM"
 *
 * Posada en marxa (veure README.md):
 *   1) Executa setup() una vegada.
 *   2) Implementa > Nova implementació > Aplicació web
 *      (Executa com a: Jo · Qui hi té accés: Qualsevol usuari).
 *   3) Copia la URL /exec a web/app.js → CONFIG.API_URL.
 */

const TZ = 'Europe/Madrid';
const CARPETA_ARREL = "Fulls d'assistència";
const MAX_INTENTS = 5;
const BLOQUEIG_SEG = 600;

const FULLS = {
  Empleats:   ['Codi', 'Nom i cognoms', 'PIN', 'Projecte', 'Categoria', 'Responsable', 'Actiu'],
  Fitxatges:  ['ID', 'Data', 'Hora', 'Timestamp', 'Codi', 'Nom', 'Tipus', 'Descripció', 'Dispositiu', 'Latitud', 'Longitud'],
  Absencies:  ['ID', 'Data', 'Codi', 'Nom', 'Hores', 'Motiu', 'Registrat'],
  Mensual:    ['Codi', 'Mes', 'Tasques', 'SignaturaId', 'PdfUrl', 'Actualitzat']
};

const TIPUS = { EM: 'Entrada matí', SM: 'Sortida matí', ET: 'Entrada tarda', ST: 'Sortida tarda' };
const MOTIUS = { FE: 'Festiu', V: 'Vacances', NL: 'No laborable', A: 'Absència injustificada',
                 BE: 'Baixa malaltia comuna', BA: 'Baixa accident laboral', PJ: 'Permís justificat' };

/* ============================ SETUP ============================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(FULLS).forEach(nom => {
    const h = ss.getSheetByName(nom) || ss.insertSheet(nom);
    if (h.getLastRow() === 0) {
      h.appendRow(FULLS[nom]);
      h.getRange(1, 1, 1, FULLS[nom].length).setFontWeight('bold').setBackground('#0b5cab').setFontColor('#ffffff');
      h.setFrozenRows(1);
    }
    // Tot com a text (conserva zeros dels PIN i evita conversions de dates), excepte la casella "Actiu"
    const cols = nom === 'Empleats' ? FULLS[nom].length - 1 : FULLS[nom].length;
    h.getRange(1, 1, h.getMaxRows(), cols).setNumberFormat('@');
  });

  const emp = ss.getSheetByName('Empleats');
  if (emp.getLastRow() === 1) {
    emp.appendRow(['E001', 'Agent cívic 1', '1234', 'PO AGENTS CÍVICS', 'AGENT CÍVIC/A', '', true]);
  }
  emp.getRange('G2:G').insertCheckboxes();

  const fullDef = ss.getSheetByName('Full 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja 1');
  if (fullDef && ss.getSheets().length > 1 && fullDef.getLastRow() === 0) ss.deleteSheet(fullDef);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSWORD')) props.setProperty('ADMIN_PASSWORD', 'canviam');
  carpeta_();
  Logger.log("Fet. Canvia ADMIN_PASSWORD a Configuració del projecte > Propietats de l'script.");
}

/* ============================ API ============================ */

function doGet() {
  return json_({ ok: true, missatge: 'API de fitxatge activa', hora: fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const accions = {
      estat: accEstat_, mes: accMes_, fitxar: accFitxar_,
      absencia: accAbsencia_, esborrarAbsencia: accEsborrarAbsencia_,
      tasques: accTasques_, desarFull: accDesarFull_,
      empleats: accEmpleats_, mesAdmin: accMesAdmin_, desarPdfAdmin: accDesarPdfAdmin_
    };
    const fn = accions[req.action];
    if (!fn) throw new Error('Acció no vàlida');
    return json_(Object.assign({ ok: true }, fn(req)));
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

/* ---------- Treballador ---------- */

function accEstat_(req) {
  const emp = autenticar_(req.codi, req.pin);
  const mes = fmt_(new Date(), 'yyyy-MM');
  return Object.assign({ empleat: public_(emp), avui: avui_(emp.codi) }, dadesMes_(emp, mes, false));
}

function accMes_(req) {
  const emp = autenticar_(req.codi, req.pin);
  return dadesMes_(emp, mesValid_(req.mes), false);
}

function accFitxar_(req) {
  return ambLock_(() => {
    const emp = autenticar_(req.codi, req.pin);
    const tipus = String(req.tipus || '');
    if (!TIPUS[tipus]) throw new Error('Tipus de fitxatge no vàlid');

    const fet = avui_(emp.codi);
    if (fet[tipus]) throw new Error(TIPUS[tipus] + ' ja registrada avui a les ' + fet[tipus].slice(0, 5) + '.');
    if (tipus === 'SM' && !fet.EM) throw new Error("Primer has de fitxar l'entrada del matí.");
    if (tipus === 'ST' && !fet.ET) throw new Error("Primer has de fitxar l'entrada de la tarda.");
    if (tipus === 'EM' && fet.ET) throw new Error("Ja has començat la tarda: no pots fitxar l'entrada del matí.");
    if (tipus === 'ET' && fet.EM && !fet.SM) throw new Error('Tens el matí obert: fitxa primer la sortida del matí.');

    const ara = new Date();
    const lat = num_(req.lat), lon = num_(req.lon);
    full_('Fitxatges').appendRow([
      Utilities.getUuid().slice(0, 8), fmt_(ara, 'yyyy-MM-dd'), fmt_(ara, 'HH:mm:ss'),
      fmt_(ara, "yyyy-MM-dd'T'HH:mm:ssXXX"), emp.codi, emp.nom, tipus, TIPUS[tipus],
      String(req.dispositiu || '').slice(0, 120), lat === null ? '' : lat, lon === null ? '' : lon
    ]);
    SpreadsheetApp.flush();
    const nou = avui_(emp.codi);
    return { avui: nou, tipus: tipus, hora: nou[tipus] };
  });
}

function accAbsencia_(req) {
  return ambLock_(() => {
    const emp = autenticar_(req.codi, req.pin);
    const data = String(req.data || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data no vàlida');
    const motiu = String(req.motiu || '').toUpperCase();
    if (!MOTIUS[motiu]) throw new Error('Motiu no vàlid');
    const hores = normalitzaHores_(req.hores);
    if (hores === null) throw new Error('Hores no vàlides (format HH:MM, màxim 12:00)');
    if (!dinsFinestra_(data)) throw new Error("Només es poden registrar absències del mes actual, l'anterior o el següent.");

    full_('Absencies').appendRow([Utilities.getUuid().slice(0, 8), data, emp.codi, emp.nom, hores, motiu,
      fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss')]);
    SpreadsheetApp.flush();
    return dadesMes_(emp, data.slice(0, 7), false);
  });
}

function accEsborrarAbsencia_(req) {
  return ambLock_(() => {
    const emp = autenticar_(req.codi, req.pin);
    const h = full_('Absencies');
    const files = h.getDataRange().getDisplayValues();
    for (let i = files.length - 1; i >= 1; i--) {
      if (files[i][0] === String(req.id) && files[i][2] === emp.codi) {
        if (!dinsFinestra_(files[i][1])) throw new Error("No es pot esborrar una absència d'un mes tancat.");
        h.deleteRow(i + 1);
        return dadesMes_(emp, files[i][1].slice(0, 7), false);
      }
    }
    throw new Error('Absència no trobada');
  });
}

function accTasques_(req) {
  return ambLock_(() => {
    const emp = autenticar_(req.codi, req.pin);
    const mes = mesValid_(req.mes);
    upsertMensual_(emp.codi, mes, { tasques: String(req.text || '').slice(0, 3000) });
    return { desat: true };
  });
}

function accDesarFull_(req) {
  return ambLock_(() => {
    const emp = autenticar_(req.codi, req.pin);
    const mes = mesValid_(req.mes);
    const dir = carpetaMes_(mes);
    const nom = mes + ' - ' + emp.codi + ' - ' + emp.nom;
    const canvis = { tasques: String(req.tasques || '').slice(0, 3000) };

    if (req.signatura) {
      const anterior = (llegirMensual_().find(m => m.codi === emp.codi && m.mes === mes) || {}).signaturaId;
      if (anterior) try { DriveApp.getFileById(anterior).setTrashed(true); } catch (e) {}
      const sig = dir.createFile(blobDeDataUrl_(req.signatura, 'image/png', 'Signatura - ' + nom + '.png'));
      canvis.signaturaId = sig.getId();
    }
    const pdf = desarPdf_(dir, nom + '.pdf', req.pdf);
    canvis.pdfUrl = pdf.getUrl();
    upsertMensual_(emp.codi, mes, canvis);
    return { pdfUrl: pdf.getUrl(), nom: pdf.getName() };
  });
}

/* ---------- Administració ---------- */

function accEmpleats_(req) {
  checkAdmin_(req.password);
  return { empleats: llegirEmpleats_().map(public_) };
}

function accMesAdmin_(req) {
  checkAdmin_(req.password);
  const mes = mesValid_(req.mes);
  const codi = String(req.codi || '*').trim().toUpperCase();
  const emps = llegirEmpleats_().filter(e => codi === '*' ? e.actiu : e.codi === codi);
  if (!emps.length) throw new Error('Cap empleat trobat');

  const fit = llegirFitxatges_().filter(f => f.data.slice(0, 7) === mes);
  const abs = llegirAbsencies_().filter(a => a.data.slice(0, 7) === mes);
  const mens = llegirMensual_().filter(m => m.mes === mes);

  return {
    mes: mes,
    llista: emps.map(e => {
      const m = mens.find(x => x.codi === e.codi) || {};
      return {
        empleat: public_(e),
        fitxatges: fit.filter(f => f.codi === e.codi),
        absencies: abs.filter(a => a.codi === e.codi),
        tasques: m.tasques || '',
        pdfUrl: m.pdfUrl || '',
        signatura: req.ambSignatura && m.signaturaId ? dataUrlDeFitxer_(m.signaturaId) : ''
      };
    })
  };
}

function accDesarPdfAdmin_(req) {
  checkAdmin_(req.password);
  const mes = mesValid_(req.mes);
  const nom = String(req.nom || ('Fulls ' + mes)).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
  const pdf = desarPdf_(carpetaMes_(mes), nom + '.pdf', req.pdf);
  return { pdfUrl: pdf.getUrl(), nom: pdf.getName() };
}

/* ============================ DADES ============================ */

function dadesMes_(emp, mes, ambSignatura) {
  const m = llegirMensual_().find(x => x.codi === emp.codi && x.mes === mes) || {};
  return {
    mes: mes,
    fitxatges: llegirFitxatges_().filter(f => f.codi === emp.codi && f.data.slice(0, 7) === mes),
    absencies: llegirAbsencies_().filter(a => a.codi === emp.codi && a.data.slice(0, 7) === mes),
    tasques: m.tasques || '',
    pdfUrl: m.pdfUrl || '',
    teSignatura: !!m.signaturaId,
    signatura: ambSignatura && m.signaturaId ? dataUrlDeFitxer_(m.signaturaId) : ''
  };
}

function avui_(codi) {
  const avui = fmt_(new Date(), 'yyyy-MM-dd');
  const r = { EM: '', SM: '', ET: '', ST: '' };
  llegirFitxatges_().forEach(f => {
    if (f.codi === codi && f.data === avui && !r[f.tipus]) r[f.tipus] = f.hora;
  });
  return r;
}

function llegirEmpleats_() {
  return files_('Empleats').filter(r => String(r[0]).trim()).map(r => ({
    codi: String(r[0]).trim().toUpperCase(), nom: String(r[1]).trim(), pin: String(r[2]).trim(),
    projecte: String(r[3]).trim(), categoria: String(r[4]).trim(), responsable: String(r[5]).trim(),
    actiu: !/^(false|fals|no|0)$/i.test(String(r[6]).trim())
  }));
}
function llegirFitxatges_() {
  return files_('Fitxatges').filter(r => r[0]).map(r => ({
    id: r[0], data: r[1], hora: r[2], ts: r[3], codi: r[4], nom: r[5], tipus: r[6],
    dispositiu: r[8], lat: r[9], lon: r[10]
  }));
}
function llegirAbsencies_() {
  return files_('Absencies').filter(r => r[0]).map(r => ({
    id: r[0], data: r[1], codi: r[2], nom: r[3], hores: r[4], motiu: r[5]
  }));
}
function llegirMensual_() {
  return files_('Mensual').filter(r => r[0]).map(r => ({
    codi: r[0], mes: r[1], tasques: r[2], signaturaId: r[3], pdfUrl: r[4]
  }));
}

function upsertMensual_(codi, mes, canvis) {
  const h = full_('Mensual');
  const files = h.getDataRange().getDisplayValues();
  let fila = files.findIndex((r, i) => i > 0 && r[0] === codi && r[1] === mes);
  const actual = fila > 0 ? files[fila] : [codi, mes, '', '', '', ''];
  if (canvis.tasques !== undefined) actual[2] = canvis.tasques;
  if (canvis.signaturaId !== undefined) actual[3] = canvis.signaturaId;
  if (canvis.pdfUrl !== undefined) actual[4] = canvis.pdfUrl;
  actual[5] = fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss');
  if (fila > 0) h.getRange(fila + 1, 1, 1, 6).setValues([actual]);
  else h.appendRow(actual);
}

function public_(e) {
  return { codi: e.codi, nom: e.nom, projecte: e.projecte, categoria: e.categoria, responsable: e.responsable, actiu: e.actiu };
}

/* ============================ AUTENTICACIÓ ============================ */

function autenticar_(codi, pin) {
  codi = String(codi || '').trim().toUpperCase();
  pin = String(pin || '').trim();
  if (!codi || !pin) throw new Error('Introdueix codi i PIN');
  const cache = CacheService.getScriptCache();
  const clau = 'errors_' + codi;
  const errors = Number(cache.get(clau) || 0);
  if (errors >= MAX_INTENTS) throw new Error("Massa intents fallits. Torna-ho a provar d'aquí a 10 minuts.");
  const emp = llegirEmpleats_().find(x => x.codi === codi);
  if (!emp || emp.pin !== pin) {
    cache.put(clau, String(errors + 1), BLOQUEIG_SEG);
    throw new Error('Codi o PIN incorrectes');
  }
  if (!emp.actiu) throw new Error("Usuari de baixa. Contacta amb l'administració.");
  cache.remove(clau);
  return emp;
}

function checkAdmin_(password) {
  const cache = CacheService.getScriptCache();
  const errors = Number(cache.get('errors_admin') || 0);
  if (errors >= MAX_INTENTS) throw new Error("Accés bloquejat temporalment. Prova-ho d'aquí a 10 minuts.");
  const ok = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!ok || String(password || '') !== ok) {
    cache.put('errors_admin', String(errors + 1), BLOQUEIG_SEG);
    throw new Error("Contrasenya d'administració incorrecta");
  }
  cache.remove('errors_admin');
}

/* ============================ DRIVE ============================ */

function carpeta_() {
  const it = DriveApp.getFoldersByName(CARPETA_ARREL);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_ARREL);
}
function carpetaMes_(mes) {
  const arrel = carpeta_();
  const it = arrel.getFoldersByName(mes);
  return it.hasNext() ? it.next() : arrel.createFolder(mes);
}
function desarPdf_(dir, nom, base64) {
  if (!base64) throw new Error('Falta el PDF');
  const antics = dir.getFilesByName(nom);
  while (antics.hasNext()) antics.next().setTrashed(true);   // substitueix la versió anterior
  return dir.createFile(Utilities.newBlob(Utilities.base64Decode(base64), MimeType.PDF, nom));
}
function blobDeDataUrl_(dataUrl, tipus, nom) {
  const m = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error('Signatura no vàlida');
  if (m[1].length > 600000) throw new Error('Signatura massa gran');
  return Utilities.newBlob(Utilities.base64Decode(m[1]), tipus, nom);
}
function dataUrlDeFitxer_(id) {
  try { return 'data:image/png;base64,' + Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); }
  catch (e) { return ''; }
}

/* ============================ UTILITATS ============================ */

function ambLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function full_(nom) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nom);
  if (!h) throw new Error('Falta el full "' + nom + '". Executa setup().');
  return h;
}
function files_(nom) {
  const h = full_(nom);
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, FULLS[nom].length).getDisplayValues();
}
function mesValid_(mes) {
  mes = String(mes || fmt_(new Date(), 'yyyy-MM'));
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes no vàlid');
  return mes;
}
function dinsFinestra_(dataIso) {
  const ara = new Date();
  const mesos = [-1, 0, 1].map(d => fmt_(new Date(ara.getFullYear(), ara.getMonth() + d, 15), 'yyyy-MM'));
  return mesos.indexOf(String(dataIso).slice(0, 7)) >= 0;
}
function normalitzaHores_(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = +m[1], mi = +(m[2] || 0);
  if (mi > 59 || h * 60 + mi <= 0 || h * 60 + mi > 720) return null;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
function fmt_(d, patro) { return Utilities.formatDate(d, TZ, patro); }
function num_(v) { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 1e6) / 1e6 : null; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
