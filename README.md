# Full d'assistència mensual — fitxatge web

Web responsive per fitxar des de qualsevol dispositiu (entrada/sortida de **matí** i **tarda**), registrar **absències**, escriure el **resum de tasques** del mes, **signar** i generar el **PDF del full d'assistència** sobre la plantilla oficial. Totes les dades es desen en una **Google Sheet** del teu Drive i els PDF a la carpeta **Fulls d'assistència/AAAA-MM**.

```
web/                 → el que es publica a Netlify
  index.html
  styles.css
  app.js             → lògica, generació del PDF i mode demo
  plantilla.pdf      → plantilla en blanc (A4)
  vendor/pdf-lib.min.js
backend/Code.gs      → Google Apps Script (no es publica)
netlify.toml         → publica només web/
```

Sense configurar res, la web funciona en **mode demo** (dades al navegador): `E001 / 1234`, `E002 / 5678`, admin `admin`.

---

## 1. Backend a Google Drive

1. Crea una Google Sheet nova (p. ex. "Fitxatges agents cívics").
2. **Extensions → Apps Script**. Enganxa el contingut de `backend/Code.gs` i desa.
3. Tria la funció `setup` → **Executa** → accepta els permisos.
   Crea els fulls **Empleats**, **Fitxatges**, **Absencies**, **Mensual** i la carpeta de Drive.
4. **Configuració del projecte (⚙) → Propietats de l'script** → canvia `ADMIN_PASSWORD` (per defecte `canviam`).
5. **Implementa → Nova implementació → Aplicació web**
   - Executa com a: **Jo**
   - Qui hi té accés: **Qualsevol usuari**
   Copia la URL que acaba en `/exec`.

> Quan modifiquis `Code.gs`: **Implementa → Gestiona les implementacions → ✎ → Versió nova**, i la URL es manté.

### Empleats

Al full **Empleats**, una fila per persona:

| Codi | Nom i cognoms | PIN | Projecte | Categoria | Responsable | Actiu |
|---|---|---|---|---|---|---|
| E001 | Agent cívic 1 | 1234 | PO AGENTS CÍVICS | AGENT CÍVIC/A | Nom del responsable | ☑ |

Projecte, Categoria i Responsable surten a la capçalera del PDF. Desmarca *Actiu* per donar de baixa sense perdre l'històric.

## 2. Connectar la web

A `web/app.js`:

```js
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXX/exec',
  ...
};
```

## 3. GitHub + Netlify

1. Puja aquesta carpeta a un repositori de GitHub (pot ser privat).
2. Netlify → **Add new site → Import an existing project → GitHub** → tria el repo.
3. No cal tocar res: `netlify.toml` ja indica `publish = "web"` i sense build.
4. Deploy. Cada `git push` torna a publicar.

L'administració s'obre directament amb `https://el-teu-lloc.netlify.app/#admin`.

---

## Funcionament

**Treballador**
- Entra amb codi + PIN. Quatre botons: *Entrada matí, Sortida matí, Entrada tarda, Sortida tarda*. El botó que toca queda ressaltat; els fets mostren l'hora.
- L'hora la posa el servidor (Europe/Madrid). Es valida l'ordre: no es pot sortir sense haver entrat, ni entrar al matí després de començar la tarda, ni repetir un fitxatge el mateix dia.
- **Absències**: dia, motiu (FE, V, NL, A, BE, BA, PJ) i hores (`02:00`, `7`…). Es poden esborrar mentre el mes no està tancat.
- **Full mensual**: tria el mes (de l'1 al 5 surt per defecte el mes anterior), revisa els fitxatges, escriu les tasques, signa i prem **Generar i descarregar PDF**. El PDF es descarrega i es desa a Drive juntament amb la signatura.

**Administració**
- Tria empleat (o tots) i mes → **Veure**: hores treballades, hores d'absència, incidències (entrades sense sortida…) i si el full ja està signat.
- **Descarregar PDF**: un full per empleat (tots en un sol PDF si tries "Tots"), amb la signatura del treballador desada i, opcionalment, la del responsable.
- **Desar PDF a Drive** i **CSV** (separador `;`, s'obre bé amb Excel).

## Notes

- **Correccions**: si algú s'oblida de fitxar, es corregeix directament al full *Fitxatges* de la Sheet (afegint la fila amb Data `AAAA-MM-DD`, Hora `HH:MM:SS` i Tipus `EM`/`SM`/`ET`/`ST`).
- **Plantilla**: `web/plantilla.pdf` és la plantilla original sense dades. Si canvia el model, cal ajustar les coordenades de l'objecte `G` a `app.js`.
- **Seguretat**: la URL de l'API és pública però sense PIN o contrasenya no dona accés a res. Bloqueig de 10 minuts després de 5 intents fallits. Els PIN es guarden a la Sheet, que només veu la persona propietària.
- **Conservació**: el registre de jornada s'ha de conservar 4 anys (art. 34.9 ET). No esborris files de *Fitxatges*.
- `pdf-lib` (MIT) s'inclou a `web/vendor` perquè la web no depengui de cap CDN.
