import Capacitor
import UIKit

/// iOS has no foreground services: when the app goes to the background while downloads are
/// running, this asks iOS for extra time (usually around 30 seconds) so the page being
/// downloaded can finish. The progress notification is posted from JavaScript with
/// Local Notifications. Same API as the Android plugin (update / stop).
@objc(DownloadKeepAlivePlugin)
public class DownloadKeepAlivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DownloadKeepAlivePlugin"
    public let jsName = "DownloadKeepAlive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var active = false
    private var task: UIBackgroundTaskIdentifier = .invalid

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc func update(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.active = true
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.active = false
            self.endTask()
            call.resolve()
        }
    }

    @objc private func didEnterBackground() {
        guard active, task == .invalid else {
            return
        }
        task = UIApplication.shared.beginBackgroundTask(withName: "nMangaloide downloads") { [weak self] in
            self?.endTask()
        }
    }

    @objc private func willEnterForeground() {
        endTask()
    }

    private func endTask() {
        if task != .invalid {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
    }
}
