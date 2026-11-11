import UIKit
import WebKit
import Capacitor

// Torre es la web dentro de un WKWebView (capacitor.config.ts: server.url). WKWebView no baja archivos por sí solo: un PDF con
// «Content-Disposition: attachment» o un Excel no se abren ni se ofrecen. Aquí se interceptan esas respuestas, se bajan con WKDownload
// (con la sesión de la persona: mismas cookies) y se presentan con la hoja de compartir de iOS (Abrir en…, Guardar en Archivos, WhatsApp…).
//
// También reintenta la carga de la página cuando falla por un corte de red a mitad de la conexión (ver «reintentos» abajo).
// Compilado y probado en el simulador de iPhone (docs/APP-MOVIL.md); las descargas en un iPhone real siguen sin probarse.
class TorreViewController: CAPBridgeViewController {
    private var descargas: DescargasTorre?

    override func capacitorDidLoad() {
        guard let web = webView, let original = web.navigationDelegate else { return }
        let envoltura = DescargasTorre(original: original)
        descargas = envoltura // navigationDelegate es débil: lo mantenemos vivo aquí
        web.navigationDelegate = envoltura
    }

    // El WebView ocupa toda la pantalla (Capacitor lo usa como la vista raíz): al hacer scroll, el contenido pasaría por debajo de la hora
    // y la isla dinámica. Una franja con desenfoque nativo cubre sólo la zona de la barra de estado, como en Android (SystemBars).
    private let franjaSuperior = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if franjaSuperior.superview == nil {
            franjaSuperior.isUserInteractionEnabled = false
            view.addSubview(franjaSuperior)
        }
        franjaSuperior.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: view.safeAreaInsets.top)
        view.bringSubviewToFront(franjaSuperior)
    }
}

/// Envuelve el delegado de navegación de Capacitor: todo lo reenvía tal cual, salvo qué hacer con las descargas.
final class DescargasTorre: NSObject, WKNavigationDelegate, WKDownloadDelegate {
    private let original: WKNavigationDelegate
    private var destinos: [ObjectIdentifier: URL] = [:]
    // Última navegación de la página principal y cuántas veces se reintentó seguida.
    private var ultimaSolicitud: URLRequest?
    private var reintentos = 0

    init(original: WKNavigationDelegate) {
        self.original = original
        super.init()
    }

    // MARK: reenvío al delegado de Capacitor (todo lo que no se define aquí)

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || original.responds(to: aSelector)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return original.responds(to: aSelector) ? original : super.forwardingTarget(for: aSelector)
    }

    // MARK: qué se descarga

    // Un <a download> o un enlace que la web marca como descarga (CSV, markdown armados en el navegador: blob:).
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == true { ultimaSolicitud = navigationAction.request }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
        } else {
            original.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
        }
    }

    // Respuestas que el WebView no puede mostrar (Excel, adjuntos) o que el servidor marca como «attachment» (PDF de recibos, rendición).
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposicion = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if disposicion.hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    // MARK: reintento ante cortes de red

    // Con HTTP/3 (QUIC) la conexión a veces se corta justo después de abrirse (NSURLErrorNetworkConnectionLost, o «no se puede analizar la
    // respuesta»), aunque haya internet: se vio en el simulador de iPhone, donde ni Safari carga Torre de forma fiable. Capacitor mostraría
    // «Sin conexión» al primer fallo. Se reintenta hasta 2 veces (sólo GET); el segundo intento suele ir por HTTP/2. Si falla igual, se reenvía
    // el error a Capacitor y sale la pantalla «Sin conexión» con «Reintentar».
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        // Una navegación que se vuelve descarga (PDF, Excel) termina con «Carga del marco interrumpida» (WebKit 102); una carga cancelada, con -999.
        // No son fallos de red: si se reenviaran, Capacitor cambiaría la página por «Sin conexión» mientras sale la hoja de compartir.
        if (e.domain == "WebKitErrorDomain" && e.code == 102) || (e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled) { return }
        let reintentable = e.domain == NSURLErrorDomain && (e.code == NSURLErrorNetworkConnectionLost || e.code == NSURLErrorCannotParseResponse)
        if reintentable, reintentos < 2, let peticion = ultimaSolicitud, peticion.httpMethod == nil || peticion.httpMethod == "GET" {
            reintentos += 1
            CAPLog.print("⚡️  Torre: reintento \(reintentos) tras \(e.code)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { webView.load(peticion) }
            return
        }
        reintentos = 0
        original.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        reintentos = 0
        original.webView?(webView, didFinish: navigation)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: WKDownloadDelegate

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let carpeta = FileManager.default.temporaryDirectory.appendingPathComponent("descargas", isDirectory: true)
        // Lo anterior ya se compartió: no se acumulan archivos (pueden ser estados de cuenta de otras personas).
        try? FileManager.default.removeItem(at: carpeta)
        do {
            try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let nombre = suggestedFilename.isEmpty ? "torre" : suggestedFilename.replacingOccurrences(of: "/", with: "_")
        let destino = carpeta.appendingPathComponent(nombre)
        destinos[ObjectIdentifier(download)] = destino
        completionHandler(destino)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destino = destinos.removeValue(forKey: ObjectIdentifier(download)) else { return }
        DispatchQueue.main.async { Self.compartir(destino) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinos.removeValue(forKey: ObjectIdentifier(download))
        DispatchQueue.main.async { Self.avisarError() }
    }

    // MARK: presentación

    private static func visibleController() -> UIViewController? {
        let escena = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
        var vc = escena?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let presentado = vc?.presentedViewController { vc = presentado }
        return vc
    }

    private static func compartir(_ archivo: URL) {
        guard let vc = visibleController() else { return }
        let hoja = UIActivityViewController(activityItems: [archivo], applicationActivities: nil)
        // iPad: la hoja sale como globo anclado al centro.
        hoja.popoverPresentationController?.sourceView = vc.view
        hoja.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
        hoja.popoverPresentationController?.permittedArrowDirections = []
        vc.present(hoja, animated: true)
    }

    private static func avisarError() {
        guard let vc = visibleController() else { return }
        let alerta = UIAlertController(title: "No se pudo descargar", message: "Revisa tu conexión e inténtalo de nuevo.", preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "Entendido", style: .default))
        vc.present(alerta, animated: true)
    }
}
