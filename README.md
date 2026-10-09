# Fichaje web + Google Drive

Web responsive (HTML/CSS/JS) para fichar entrada y salida desde cualquier dispositivo. Los fichajes se guardan en una **Google Sheet de tu Drive** y desde el panel de administración se generan informes (Google Sheet + PDF en Drive, o CSV) de un empleado o de todos.

```
index.html   → la web
styles.css   → estilos (móvil primero, modo oscuro, impresión)
app.js       → lógica + modo demo
Code.gs      → backend en Google Apps Script
```

Sin configurar nada, la web arranca en **modo demo** (datos en el navegador) para probarla: `E001 / 1234`, `E002 / 5678`, admin `admin`.

## 1. Backend en Google Drive (5 min)

1. Crea una Google Sheet nueva (p. ej. "Registro de fichajes").
2. **Extensiones → Apps Script**. Borra el contenido y pega `Code.gs`. Guarda.
3. Selecciona la función `setup` y pulsa **Ejecutar**. Acepta los permisos.
   Crea las hojas **Empleados** y **Fichajes**, la carpeta **Informes de fichajes** en Drive y una contraseña admin provisional.
4. **Configuración del proyecto (⚙) → Propiedades del script** → cambia `ADMIN_PASSWORD` (por defecto `cambiame`).
5. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   Copia la URL que acaba en `/exec`.

> Al modificar `Code.gs`, usa **Implementar → Gestionar implementaciones → editar (✎) → Nueva versión** para mantener la misma URL.

## 2. Empleados

En la hoja **Empleados** añade una fila por persona:

| Código | Nombre | PIN | Activo |
|---|---|---|---|
| E001 | Ana García | 1234 | ☑ |

Desmarca *Activo* para dar de baja sin borrar su histórico. La columna PIN está como texto, así que los ceros a la izquierda se conservan.

## 3. Conectar la web

En `app.js`:

```js
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXX/exec',
  EMPRESA: 'Tu empresa',
  AUTO_LOGOUT_SEG: 60
};
```

## 4. Publicarla

Sube los 3 archivos a cualquier hosting estático con **HTTPS** (la geolocalización lo requiere): GitHub Pages, Netlify, Cloudflare Pages o tu servidor/IIS. Abre la URL desde móvil, tablet u ordenador; en móvil se puede "Añadir a pantalla de inicio".

El panel admin se abre directamente con `tu-web/#admin`.

## Cómo funciona

- **Fichar**: el empleado introduce código + PIN; la web muestra si está dentro o fuera y un único botón (Entrada/Salida). La **hora la pone el servidor** (Europe/Madrid), no el dispositivo, para que no se pueda manipular.
- **Validaciones**: no deja dos entradas seguidas ni una salida sin entrada; bloqueo de 10 min tras 5 PIN erróneos; `LockService` evita duplicados por doble clic.
- **Se registra**: ID, fecha, hora, timestamp ISO, empleado, tipo, dispositivo y (opcional) ubicación.
- **Informes** (Administración): elige empleado o todos y rango de fechas.
  - *Ver informe*: totales por empleado, detalle diario (primera entrada, última salida, tramos, horas, incidencias) y todos los fichajes.
  - *Generar documento en Drive*: crea en **Informes de fichajes** una Google Sheet (Resumen, Detalle diario, Fichajes) y su **PDF**, y devuelve los enlaces.
  - *CSV* (separador `;`, abre bien en Excel) e *Imprimir / PDF* desde el navegador.
- Las horas se calculan emparejando Entrada→Salida; un turno que pasa de medianoche cuenta en el día de la entrada (salida marcada `+1d`). Entradas sin salida aparecen como incidencia.

## Notas

- **Registro de jornada (España)**: el art. 34.9 del Estatuto de los Trabajadores obliga a conservar los registros 4 años y tenerlos a disposición de la plantilla, sus representantes y la Inspección. No borres filas de la hoja *Fichajes*; si hay que corregir algo, añade el fichaje que falte y anótalo en *Observaciones*.
- Los PIN se guardan en claro en la Sheet, que solo ve su propietario. Para algo más serio, cámbialos por un hash SHA-256 (`Utilities.computeDigest`).
- La API es pública (cualquiera con la URL puede llamarla), pero sin PIN/contraseña válidos no puede leer ni escribir nada.
- Capacidad: Apps Script lee la hoja entera en cada fichaje; va bien hasta decenas de miles de filas. Si crece mucho, archiva años anteriores en otra hoja.
