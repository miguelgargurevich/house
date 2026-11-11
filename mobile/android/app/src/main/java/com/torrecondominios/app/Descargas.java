package com.torrecondominios.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Descargas de la web (PDF de recibos y estado de cuenta, Excel de rendición, CSV…). Un WebView no descarga solo: aquí se baja el archivo
 * con la sesión de la persona (mismas cookies), se guarda en la caché de la app y se abre con la app que tenga el teléfono (visor de PDF,
 * hoja de cálculo…). Si no hay ninguna que lo abra, se ofrece compartirlo (WhatsApp, Drive, correo, «Guardar en Archivos»).
 *
 * Dos caminos: URL normal (https://torrecondominios.com/api/…) se baja aquí mismo; blob: (archivos que la web arma en el navegador)
 * se lee en la página (SHIM_JS recuerda cada Blob que se crea) y llega en base64 por TorreNativo.guardar.
 */
public class Descargas implements DownloadListener {

    public static final String NOMBRE_JS = "TorreNativo";
    private static final String CARPETA = "descargas";

    /** Se inyecta al empezar cada página. Recuerda los Blob para poder leerlos sin `fetch` (la política de seguridad de Torre no deja leer blob: con fetch). */
    public static final String SHIM_JS =
        "(function(){if(window.__torreShim)return;window.__torreShim=true;"
            // Recuerda cada Blob y el nombre que la web le puso con <a download>: el WebView avisa sólo la URL blob:, sin nombre.
            + "var m={},n={};var c=URL.createObjectURL.bind(URL),r=URL.revokeObjectURL.bind(URL);"
            + "URL.createObjectURL=function(b){var u=c(b);try{if(b instanceof Blob)m[u]=b;}catch(e){}return u;};"
            // La web revoca el blob justo después del clic; el WebView avisa un instante más tarde. Se suelta a los 30 s.
            + "URL.revokeObjectURL=function(u){r(u);setTimeout(function(){delete m[u];delete n[u];},30000);};"
            + "var k=HTMLAnchorElement.prototype.click;"
            + "HTMLAnchorElement.prototype.click=function(){try{if(this.download&&/^blob:/.test(this.href))n[this.href]=this.download;}catch(e){}return k.apply(this,arguments);};"
            + "window.__torreGuardarBlob=function(u,f){var b=m[u];if(!b||!window." + NOMBRE_JS + "){return false;}"
            + "var r2=new FileReader();r2.onload=function(){var s=String(r2.result);window." + NOMBRE_JS + ".guardar(n[u]||f||'',b.type||'',s.substring(s.indexOf(',')+1));};"
            + "r2.readAsDataURL(b);return true;};})();";

    private final Activity actividad;
    private final WebView web;

    public Descargas(Activity actividad, WebView web) {
        this.actividad = actividad;
        this.web = web;
    }

    @Override
    public void onDownloadStart(final String url, final String userAgent, final String contentDisposition, final String mimeType, long contentLength) {
        final String nombre = nombreSeguro(URLUtil.guessFileName(url, contentDisposition, mimeType), mimeType);
        if (url.startsWith("blob:")) {
            final String js = "window.__torreGuardarBlob&&window.__torreGuardarBlob(" + comillas(url) + "," + comillas(nombre) + ")";
            web.post(() -> web.evaluateJavascript(js, valor -> {
                if (!"true".equals(valor)) avisar(R.string.descarga_error);
            }));
            return;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            avisar(R.string.descarga_error);
            return;
        }
        avisar(R.string.descarga_bajando);
        new Thread(() -> bajar(url, userAgent, nombre), "torre-descarga").start();
    }

    /** Lo llama la página (SHIM_JS) con el contenido de un blob. */
    @JavascriptInterface
    public void guardar(String nombre, String mime, String base64) {
        try {
            File archivo = destino(nombreSeguro(nombre, mime));
            try (OutputStream out = new FileOutputStream(archivo)) {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            }
            abrir(archivo, mime);
        } catch (Exception e) {
            avisar(R.string.descarga_error);
        }
    }

    private void bajar(String url, String userAgent, String nombre) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(15000);
            con.setReadTimeout(60000);
            con.setRequestProperty("User-Agent", userAgent);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) con.setRequestProperty("Cookie", cookies);
            if (con.getResponseCode() != 200) throw new IllegalStateException("HTTP " + con.getResponseCode());
            String mime = con.getContentType();
            if (mime != null && mime.contains(";")) mime = mime.substring(0, mime.indexOf(';'));
            File archivo = destino(nombre);
            try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(archivo)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            abrir(archivo, mime);
        } catch (Exception e) {
            avisar(R.string.descarga_error);
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private File destino(String nombre) {
        File carpeta = new File(actividad.getCacheDir(), CARPETA);
        //noinspection ResultOfMethodCallIgnored
        carpeta.mkdirs();
        // Lo anterior ya se abrió o compartió: no se acumulan archivos (pueden ser estados de cuenta de otras personas).
        File[] viejos = carpeta.listFiles();
        if (viejos != null) for (File f : viejos) { //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        return new File(carpeta, nombre);
    }

    private void abrir(File archivo, String mime) {
        final Uri uri = FileProvider.getUriForFile(actividad, actividad.getPackageName() + ".fileprovider", archivo);
        final String tipo = (mime == null || mime.isEmpty() || mime.equals("application/octet-stream")) ? tipoPorNombre(archivo.getName()) : mime;
        actividad.runOnUiThread(() -> {
            Intent ver = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, tipo).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                actividad.startActivity(ver);
            } catch (ActivityNotFoundException sinApp) {
                Intent compartir = new Intent(Intent.ACTION_SEND).setType(tipo).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                compartir.setClipData(android.content.ClipData.newRawUri("", uri)); // vista previa en la hoja de compartir
                try {
                    actividad.startActivity(Intent.createChooser(compartir, actividad.getString(R.string.descarga_compartir)));
                } catch (ActivityNotFoundException e) {
                    avisar(R.string.descarga_error);
                }
            }
        });
    }

    private void avisar(final int texto) {
        actividad.runOnUiThread(() -> Toast.makeText(actividad, texto, Toast.LENGTH_SHORT).show());
    }

    private static String tipoPorNombre(String nombre) {
        String n = nombre.toLowerCase();
        if (n.endsWith(".pdf")) return "application/pdf";
        if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (n.endsWith(".xls")) return "application/vnd.ms-excel";
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".md")) return "text/markdown";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    /** Sin rutas ni caracteres raros: el nombre viene de la web. */
    private static String nombreSeguro(String nombre, String mime) {
        String n = nombre == null ? "" : nombre.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (n.isEmpty() || n.startsWith(".")) n = "torre" + n;
        if (n.length() > 120) n = n.substring(n.length() - 120);
        if (!n.contains(".") && mime != null && !mime.isEmpty()) {
            String ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime.split(";")[0].trim());
            if (ext != null) n = n + "." + ext;
        }
        return n;
    }

    private static String comillas(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'";
    }
}
