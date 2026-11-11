package com.torrecondominios.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * Torre es la web dentro de un WebView (capacitor.config.ts: server.url). Aquí va lo que el WebView no hace solo:
 *  - Atrás: vuelve en el historial de la web y, en la raíz, manda la app al fondo (como cualquier app).
 *  - Descargas: PDF y Excel (recibos, rendición, estado de cuenta) se bajan con la sesión y se abren o comparten (ver Descargas.java).
 *  - Cámara: el botón «Tomar foto» del voucher (input con capture) abre la cámara aunque el accept sea una lista de tipos (ver CamaraWebChromeClient.java).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebView web = getBridge().getWebView();

        final Descargas descargas = new Descargas(this, web);
        web.addJavascriptInterface(descargas, Descargas.NOMBRE_JS);
        web.setDownloadListener(descargas);
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView view) {
                view.evaluateJavascript(Descargas.SHIM_JS, null);
            }
        });

        web.setWebChromeClient(new CamaraWebChromeClient(getBridge()));

        // Se registra después del que pone Capacitor, así que manda éste (los más nuevos van primero).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
