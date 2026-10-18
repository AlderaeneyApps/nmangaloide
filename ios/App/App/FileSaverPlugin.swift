import Capacitor
import UIKit

/// Saves a file wherever the user chooses, through the Files "export" picker:
/// folders "On My iPhone", iCloud Drive, or any installed storage provider.
///
/// Like on Android, the contents aren't passed through the plugin call: the app writes
/// the file to its caches folder and passes its URI (`sourceUri`).
@objc(FileSaverPlugin)
public class FileSaverPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FileSaverPlugin"
    public let jsName = "FileSaver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveAs", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var exportedCopy: URL?

    @objc func saveAs(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName"),
              let source = cacheFile(call.getString("sourceUri")) else {
            call.reject("fileName and a sourceUri in the app's caches are required", "INVALID")
            return
        }
        guard pendingCall == nil else {
            call.reject("A save is already in progress", "BUSY")
            return
        }
        // A copy under the suggested name (only its last path component, so it stays
        // inside the temporary folder); the picker offers that name.
        let safeName = (fileName as NSString).lastPathComponent
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            if FileManager.default.fileExists(atPath: copy.path) {
                try FileManager.default.removeItem(at: copy)
            }
            try FileManager.default.copyItem(at: source, to: copy)
        } catch {
            call.reject("Could not prepare the file", "WRITE_FAILED", error)
            return
        }
        pendingCall = call
        exportedCopy = copy

        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                self.finish { $0.reject("Nothing to show the picker on", "UNAVAILABLE") }
                return
            }
            let picker = UIDocumentPickerViewController(forExporting: [copy], asCopy: true)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish { $0.resolve(["uri": urls.first?.absoluteString ?? ""]) }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish { $0.reject("Save cancelled", "CANCELLED") }
    }

    /// The file behind `sourceUri`, only if it's a file inside the app's caches folder.
    private func cacheFile(_ sourceUri: String?) -> URL? {
        guard let sourceUri = sourceUri,
              let url = URL(string: sourceUri), url.isFileURL,
              let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            return nil
        }
        let file = url.standardizedFileURL.resolvingSymlinksInPath()
        let cachesPath = caches.standardizedFileURL.resolvingSymlinksInPath().path
        var isDirectory: ObjCBool = false
        guard file.path.hasPrefix(cachesPath + "/"),
              FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else {
            return nil
        }
        return file
    }

    private func finish(_ complete: (CAPPluginCall) -> Void) {
        if let call = pendingCall {
            complete(call)
        }
        if let copy = exportedCopy {
            try? FileManager.default.removeItem(at: copy)
        }
        pendingCall = nil
        exportedCopy = nil
    }
}
