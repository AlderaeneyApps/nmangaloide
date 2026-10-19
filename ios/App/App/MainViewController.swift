import Capacitor
import UIKit

/// The app's bridge view controller (set in Main.storyboard), so the app's own
/// plugins can be registered with Capacitor.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FileSaverPlugin())
        bridge?.registerPluginInstance(DownloadKeepAlivePlugin())
    }
}
