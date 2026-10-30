import Capacitor
import Foundation

/// Hands downloads over to BackgroundDownloader, which downloads them with a background
/// URLSession so they continue with the app in the background or closed by iOS.
/// Same API as the Android plugin (BackgroundDownloadsPlugin.java): progress comes back as
/// `progress` events, `{ id, done, total, status }`, status being `queued`, `downloading`,
/// `failed` or `finished` (the CBZ is in the Documents folder). `folderUri` is ignored:
/// on iOS downloads always go to the app's Documents folder.
@objc(BackgroundDownloadsPlugin)
public class BackgroundDownloadsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundDownloadsPlugin"
    public let jsName = "BackgroundDownloads"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enqueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLabels", returnType: CAPPluginReturnPromise)
    ]

    private let downloader = BackgroundDownloader.shared

    override public func load() {
        downloader.listener = { [weak self] event in
            self?.notifyListeners("progress", data: event)
        }
    }

    /// Queues a comic: `{ id, title, detailsJson, comicInfoXml, delayMs, pages: [{ number, url, fileName }] }`.
    /// Resolves with its state; a comic already queued or downloading is updated and keeps its progress.
    @objc func enqueue(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("An id is required", "INVALID")
            return
        }
        var pages: [BackgroundDownloader.Page] = []
        for value in call.getArray("pages", JSObject.self) ?? [] {
            guard let number = value["number"] as? Int, let url = value["url"] as? String,
                  let fileName = value["fileName"] as? String,
                  !fileName.isEmpty, !fileName.contains("/"), !fileName.contains("\\"), !fileName.hasPrefix(".") else {
                call.reject("Invalid download: bad page", "INVALID")
                return
            }
            pages.append(BackgroundDownloader.Page(number: number, url: url, fileName: fileName))
        }
        let job = BackgroundDownloader.Job(
            id: id,
            title: call.getString("title", ""),
            detailsJson: call.getString("detailsJson", "{}"),
            comicInfoXml: call.getString("comicInfoXml", ""),
            pages: pages,
            delayMs: max(0, call.getInt("delayMs", 1000)))
        downloader.enqueue(job) { state in
            call.resolve(state)
        }
    }

    /// Stops a download and deletes its files.
    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("An id is required", "INVALID")
            return
        }
        downloader.cancel(id) {
            call.resolve()
        }
    }

    /// The comics handed over and their state (finished ones are no longer listed).
    @objc func list(_ call: CAPPluginCall) {
        downloader.list { jobs in
            call.resolve(["jobs": jobs])
        }
    }

    /// The notification's texts in the app's language, with `{count}`, `{done}`, `{total}` and `{title}`;
    /// used while the app is in the background.
    @objc func setLabels(_ call: CAPPluginCall) {
        let fallback = BackgroundDownloader.Labels()
        let labels = BackgroundDownloader.Labels(
            titleOne: call.getString("titleOne", fallback.titleOne),
            titleOther: call.getString("titleOther", fallback.titleOther),
            body: call.getString("body", fallback.body))
        downloader.setLabels(labels) {
            call.resolve()
        }
    }
}
