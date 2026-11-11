package com.torrecondominios.app;

import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Capacitor sólo abre la cámara si el input dice accept="image/*" (o video) Y capture. La web de Torre pone una lista exacta
 * (image/jpeg,image/png,image/webp) en el botón «Tomar foto» del voucher: sin este ajuste abriría el selector de archivos
 * en vez de la cámara. Si el input pide capture y acepta imágenes, se le presenta a Capacitor como image/*.
 */
public class CamaraWebChromeClient extends BridgeWebChromeClient {

    public CamaraWebChromeClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, final FileChooserParams params) {
        if (!params.isCaptureEnabled() || !pideSoloImagenes(params.getAcceptTypes())) {
            return super.onShowFileChooser(webView, filePathCallback, params);
        }
        return super.onShowFileChooser(webView, filePathCallback, new FileChooserParams() {
            @Override public int getMode() { return params.getMode(); }
            @Override public String[] getAcceptTypes() { return new String[] { "image/*" }; }
            @Override public boolean isCaptureEnabled() { return true; }
            @Override public CharSequence getTitle() { return params.getTitle(); }
            @Override public String getFilenameHint() { return params.getFilenameHint(); }
            @Override public android.content.Intent createIntent() { return params.createIntent(); }
        });
    }

    private static boolean pideSoloImagenes(String[] tipos) {
        boolean hayImagen = false;
        for (String t : tipos) {
            if (t == null || t.trim().isEmpty()) continue;
            if (!t.trim().toLowerCase().startsWith("image/")) return false;
            hayImagen = true;
        }
        return hayImagen;
    }
}
