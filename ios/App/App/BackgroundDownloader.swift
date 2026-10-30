import Foundation
import UIKit
import UserNotifications

/// Downloads the comics handed over by BackgroundDownloadsPlugin natively, with a background
/// URLSession: iOS itself (not the app) transfers the pages, so downloads keep going with the
/// app in the background, suspended, or closed by the system. The app's web view can't do this:
/// iOS freezes it soon after the app leaves the screen.
///
/// Every page of a comic is scheduled when the comic is handed over, one page every `delayMs`
/// (`earliestBeginDate`, and one connection per host), so the image servers' rate limit isn't
/// hit, with a few attempts per page. Pages go to the app's private storage first
/// (`Library/NoCloud/downloading/<id>/`, the same folder the app uses, so an interrupted
/// download resumes where it stopped); when all are there they're packed into `<id>.cbz`
/// in Documents (shown in the Files app), written as `<id>.cbz.part` and renamed when complete.
///
/// iOS wakes the app (in the background) when the session's tasks are done; the app then
/// packs finished comics and schedules retries. The queue is saved to a file so this works
/// even after iOS has closed the app.
final class BackgroundDownloader: NSObject {
    static let shared = BackgroundDownloader()
    static let sessionIdentifier = "com.alderaeney.downloads"

    enum Status: String, Codable {
        case queued, downloading, failed, finished
    }

    struct Page: Codable {
        let number: Int
        let url: String
        /// Its file name in the staging folder and in the CBZ (`001.webp`…).
        let fileName: String
    }

    struct Job: Codable {
        let id: Int
        var title: String
        var detailsJson: String
        var comicInfoXml: String
        var pages: [Page]
        var delayMs: Int
        var status: Status = .queued
        var done = 0
        /// Failed attempts by page file name.
        var attempts: [String: Int] = [:]
    }

    /// Notification texts in the app's language; `{count}`, `{done}`, `{total}` and `{title}` are filled in.
    struct Labels: Codable {
        var titleOne = "Downloading 1 comic"
        var titleOther = "Downloading {count} comics"
        var body = "{done} / {total} pages · {title}"
    }

    /// Attempts per page before the comic's download fails (the same as the app).
    static let pageAttempts = 3
    /// The download notification's id (the same as the app's and the Android service's).
    static let notificationId = "4210"

    /// Called on the main thread when a job's status or progress changes: `{ id, done, total, status }`.
    var listener: (([String: Any]) -> Void)?
    /// From AppDelegate: called once iOS has delivered every event of the session.
    var backgroundCompletionHandler: (() -> Void)?

    /// All state is changed on this queue. Suspended until the session's tasks are known.
    private let queue = DispatchQueue(label: "nMangaloide downloads")
    private var jobs: [Job] = []
    private var labels = Labels()
    /// Pages being downloaded: the task's identifier by its description, `<id>/<fileName>`.
    /// Events of tasks no longer listed here (cancelled and replaced) are ignored.
    private var pending: [String: Int] = [:]
    /// When the last scheduled page may start; the next one waits `delayMs` after it.
    private var nextSlot = Date.distantPast
    /// What the notification shows while the app is in the background (nil when there's none).
    private var shownKey: String?
    private var appActive = true

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.httpMaximumConnectionsPerHost = 1
        config.timeoutIntervalForRequest = 60
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: delegateQueue)
    }()

    private let files = FileManager.default
    private lazy var stagingRoot: URL = files.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("NoCloud", isDirectory: true)
        .appendingPathComponent("downloading", isDirectory: true)
    private lazy var downloadFolder: URL = files.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private lazy var stateFile: URL = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("background-downloads.json")

    private override init() {
        super.init()
        queue.suspend()
        DispatchQueue.main.async {
            self.appActive = UIApplication.shared.applicationState == .active
            NotificationCenter.default.addObserver(
                self, selector: #selector(self.didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
            NotificationCenter.default.addObserver(
                self, selector: #selector(self.didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        }
        restore()
        // Reconnects to the tasks left from before the app was closed; nothing else runs until they're known.
        session.getAllTasks { tasks in
            for task in tasks where task.state != .completed {
                if let description = task.taskDescription {
                    self.pending[description] = max(self.pending[description] ?? 0, task.taskIdentifier)
                }
            }
            self.queue.resume()
            self.queue.async {
                // Tasks of comics removed or failed while their cancellation didn't get through.
                let active = Set(self.jobs.filter { $0.status == .queued || $0.status == .downloading }.map { $0.id })
                self.cancel(self.pending.filter { self.parse($0.key).map { !active.contains($0.0) } ?? true })
                self.resumeAll()
            }
        }
    }

    /// Creates the session (once), so iOS can deliver its events; called at launch.
    func start() {
        _ = session
    }

    // MARK: - API (BackgroundDownloadsPlugin)

    /// Queues a comic, or updates it if it's already waiting or downloading (its progress is
    /// kept); a failed one starts again. Calls back with its state; a comic whose CBZ is
    /// already in the download folder (finished while the app was away) is reported finished.
    func enqueue(_ incoming: Job, completion: @escaping ([String: Any]) -> Void) {
        queue.async {
            if let index = self.index(of: incoming.id), self.jobs[index].status != .failed {
                self.jobs[index].title = incoming.title
                self.jobs[index].detailsJson = incoming.detailsJson
                self.jobs[index].comicInfoXml = incoming.comicInfoXml
                self.jobs[index].pages = incoming.pages
                self.jobs[index].delayMs = incoming.delayMs
                self.save()
                self.resume(incoming.id)
                completion(self.currentState(incoming))
                return
            }
            if self.index(of: incoming.id) == nil, self.files.fileExists(atPath: self.cbzURL(incoming.id).path) {
                var finished = incoming
                finished.status = .finished
                finished.done = incoming.pages.count
                completion(self.state(finished))
                return
            }
            self.jobs.removeAll { $0.id == incoming.id }
            self.jobs.append(incoming)
            self.save()
            self.resume(incoming.id)
            completion(self.currentState(incoming))
        }
    }

    /// Stops a download and deletes its files.
    func cancel(_ id: Int, completion: @escaping () -> Void) {
        queue.async {
            self.jobs.removeAll { $0.id == id }
            self.save()
            self.cancelTasks(of: id)
            self.deleteFiles(id)
            self.reschedule()
            self.updateNotification()
            completion()
        }
    }

    /// The comics handed over and their state (finished ones are no longer listed).
    func list(completion: @escaping ([[String: Any]]) -> Void) {
        queue.async {
            completion(self.jobs.map(self.state))
        }
    }

    func setLabels(_ value: Labels, completion: @escaping () -> Void) {
        queue.async {
            self.labels = value
            self.save()
            completion()
        }
    }

    // MARK: - Scheduling

    private func resumeAll() {
        for job in jobs where job.status == .queued || job.status == .downloading {
            resume(job.id)
        }
    }

    /// Schedules the pages of a job that aren't saved or being downloaded; packs it if they're all saved.
    private func resume(_ id: Int) {
        guard let index = index(of: id), jobs[index].status != .failed else {
            return
        }
        let dir = stagingDir(id)
        try? files.createDirectory(at: dir, withIntermediateDirectories: true)
        let pages = jobs[index].pages.sorted { $0.number < $1.number }
        jobs[index].done = pages.filter { isSaved(id, $0) }.count
        for page in pages where !isSaved(id, page) && pending[key(id, page.fileName)] == nil {
            schedule(jobs[index], page, after: 0)
        }
        changed(jobs[index])
        packIfComplete(id)
    }

    /// One page, starting `delayMs` after the previously scheduled one (and `extra` more).
    private func schedule(_ job: Job, _ page: Page, after extra: TimeInterval) {
        guard let url = URL(string: page.url) else {
            return
        }
        let delay = TimeInterval(max(0, job.delayMs)) / 1000
        let slot = max(Date().addingTimeInterval(extra), nextSlot.addingTimeInterval(delay))
        nextSlot = slot
        let task = session.downloadTask(with: URLRequest(url: url))
        task.taskDescription = key(job.id, page.fileName)
        task.earliestBeginDate = slot
        pending[task.taskDescription!] = task.taskIdentifier
        task.resume()
    }

    private func cancelTasks(of id: Int) {
        let prefix = "\(id)/"
        cancel(pending.filter { $0.key.hasPrefix(prefix) })
    }

    private func cancel(_ tasks: [String: Int]) {
        tasks.keys.forEach { pending.removeValue(forKey: $0) }
        let ids = Set(tasks.values)
        session.getAllTasks { all in
            all.filter { ids.contains($0.taskIdentifier) }.forEach { $0.cancel() }
        }
    }

    /// After a comic is removed or fails, the others' pages may be waiting for slots booked for its
    /// pages: they're scheduled again from now.
    private func reschedule() {
        cancel(pending)
        nextSlot = .distantPast
        resumeAll()
    }

    /// A page task ended: saved, or retried, or the job fails once it's out of attempts.
    private func pageEnded(_ description: String, saved: Bool) {
        pending.removeValue(forKey: description)
        guard case let (id, fileName)? = parse(description), let index = index(of: id),
              jobs[index].status == .queued || jobs[index].status == .downloading,
              let page = jobs[index].pages.first(where: { $0.fileName == fileName }) else {
            return
        }
        if saved {
            jobs[index].status = .downloading
            jobs[index].done = jobs[index].pages.filter { isSaved(id, $0) }.count
            changed(jobs[index])
            packIfComplete(id)
            return
        }
        let attempts = (jobs[index].attempts[fileName] ?? 0) + 1
        jobs[index].attempts[fileName] = attempts
        if attempts < Self.pageAttempts {
            // Wait longer after each failure: a rate limit eases off with time.
            schedule(jobs[index], page, after: TimeInterval(jobs[index].delayMs * attempts) / 1000)
            save()
        } else {
            jobs[index].status = .failed
            jobs[index].attempts = [:]
            save()
            cancelTasks(of: id)
            changed(jobs[index])
            reschedule()
            updateNotification()
        }
    }

    /// Packs a job whose pages are all saved into `<id>.cbz`, then forgets it.
    private func packIfComplete(_ id: Int) {
        guard let index = index(of: id) else {
            return
        }
        let job = jobs[index]
        guard !job.pages.isEmpty, job.pages.allSatisfy({ isSaved(id, $0) }) else {
            return
        }
        // Packing takes a few seconds for a large comic: ask for time in case the app is leaving.
        let task = UIApplication.shared.beginBackgroundTask(withName: "nMangaloide pack \(id)")
        defer {
            UIApplication.shared.endBackgroundTask(task)
        }
        do {
            try writeCbz(job)
            try? files.removeItem(at: stagingDir(id))
            jobs.remove(at: index)
            save()
            var finished = job
            finished.status = .finished
            finished.done = job.pages.count
            changed(finished)
        } catch {
            try? files.removeItem(at: partURL(id))
            jobs[index].status = .failed
            save()
            changed(jobs[index])
        }
        updateNotification()
    }

    // MARK: - CBZ

    /// gallery.json, ComicInfo.xml and the pages, stored uncompressed (the images already are), like the app's ZipWriter.
    private func writeCbz(_ job: Job) throws {
        let part = partURL(job.id)
        try? files.removeItem(at: part)
        guard files.createFile(atPath: part.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let handle = try FileHandle(forWritingTo: part)
        var zip = StoredZip()
        do {
            try zip.add("gallery.json", Data(job.detailsJson.utf8), to: handle)
            try zip.add("ComicInfo.xml", Data(job.comicInfoXml.utf8), to: handle)
            for page in job.pages.sorted(by: { $0.number < $1.number }) {
                try autoreleasepool {
                    try zip.add(page.fileName, Data(contentsOf: stagingDir(job.id).appendingPathComponent(page.fileName)), to: handle)
                }
            }
            try zip.finish(handle)
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
        let cbz = cbzURL(job.id)
        try? files.removeItem(at: cbz)
        try files.moveItem(at: part, to: cbz)
    }

    // MARK: - Notification

    @objc private func didBecomeActive() {
        queue.async {
            self.appActive = true
            // The app shows its own progress (and removes its notification) while open.
            self.shownKey = nil
        }
    }

    @objc private func didEnterBackground() {
        queue.async {
            self.appActive = false
            // The app posts the notification as it leaves; this only follows what changes after.
            self.shownKey = self.notificationKey()
        }
    }

    private func notificationKey() -> String? {
        let active = jobs.filter { $0.status == .queued || $0.status == .downloading }
        guard let current = active.first(where: { $0.status == .downloading }) ?? active.first else {
            return nil
        }
        return "\(active.count)|\(current.title)"
    }

    /// While the app is in the background (its web view frozen), updates the notification when
    /// the comic or the count changes (iOS shows each update as an alert), and removes it when done.
    private func updateNotification() {
        guard !appActive else {
            return
        }
        let key = notificationKey()
        guard key != shownKey else {
            return
        }
        shownKey = key
        let center = UNUserNotificationCenter.current()
        let active = jobs.filter { $0.status == .queued || $0.status == .downloading }
        guard let current = active.first(where: { $0.status == .downloading }) ?? active.first else {
            center.removePendingNotificationRequests(withIdentifiers: [Self.notificationId])
            center.removeDeliveredNotifications(withIdentifiers: [Self.notificationId])
            return
        }
        let content = UNMutableNotificationContent()
        content.title = (active.count == 1 ? labels.titleOne : labels.titleOther)
            .replacingOccurrences(of: "{count}", with: String(active.count))
        content.body = labels.body
            .replacingOccurrences(of: "{done}", with: String(current.done))
            .replacingOccurrences(of: "{total}", with: String(current.pages.count))
            .replacingOccurrences(of: "{title}", with: current.title)
        content.threadIdentifier = "downloads"
        center.add(UNNotificationRequest(identifier: Self.notificationId, content: content, trigger: nil))
    }

    // MARK: - State

    private func changed(_ job: Job) {
        let event = state(job)
        DispatchQueue.main.async {
            self.listener?(event)
        }
    }

    /// A job's state after resume(), which may have packed it already (it's then no longer listed).
    private func currentState(_ job: Job) -> [String: Any] {
        if let index = index(of: job.id) {
            return state(jobs[index])
        }
        var finished = job
        finished.status = .finished
        finished.done = job.pages.count
        return state(finished)
    }

    private func state(_ job: Job) -> [String: Any] {
        ["id": job.id, "done": job.done, "total": job.pages.count, "status": job.status.rawValue]
    }

    private struct Saved: Codable {
        var jobs: [Job]
        var labels: Labels
    }

    private func save() {
        do {
            try files.createDirectory(at: stateFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(Saved(jobs: jobs, labels: labels)).write(to: stateFile, options: .atomic)
        } catch {
            // Kept in memory; the app hands the queue over again when opened.
        }
    }

    private func restore() {
        guard let data = try? Data(contentsOf: stateFile), let saved = try? JSONDecoder().decode(Saved.self, from: data) else {
            return
        }
        jobs = saved.jobs.filter { $0.status != .finished }
        labels = saved.labels
    }

    /// iOS has delivered every event and they've been handled: it can suspend the app again.
    private func finishIfIdle() {
        DispatchQueue.main.async {
            let handler = self.backgroundCompletionHandler
            self.backgroundCompletionHandler = nil
            handler?()
        }
    }

    // MARK: - Files

    private func index(of id: Int) -> Int? {
        jobs.firstIndex { $0.id == id }
    }

    private func key(_ id: Int, _ fileName: String) -> String {
        "\(id)/\(fileName)"
    }

    private func parse(_ description: String) -> (Int, String)? {
        let parts = description.split(separator: "/", maxSplits: 1).map(String.init)
        guard parts.count == 2, let id = Int(parts[0]) else {
            return nil
        }
        return (id, parts[1])
    }

    private func stagingDir(_ id: Int) -> URL {
        stagingRoot.appendingPathComponent(String(id), isDirectory: true)
    }

    private func isSaved(_ id: Int, _ page: Page) -> Bool {
        files.fileExists(atPath: stagingDir(id).appendingPathComponent(page.fileName).path)
    }

    private func cbzURL(_ id: Int) -> URL {
        downloadFolder.appendingPathComponent("\(id).cbz")
    }

    private func partURL(_ id: Int) -> URL {
        downloadFolder.appendingPathComponent("\(id).cbz.part")
    }

    /// The staged pages and any part file of a cancelled download (the app deletes them too).
    private func deleteFiles(_ id: Int) {
        try? files.removeItem(at: stagingDir(id))
        try? files.removeItem(at: partURL(id))
    }
}

// MARK: - URLSession events

extension BackgroundDownloader: URLSessionDownloadDelegate {
    /// The file must be moved before this returns. Only a complete, successful response is kept,
    /// moved straight to its page file (so a partial page is never taken for a saved one).
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let description = downloadTask.taskDescription, case let (id, fileName)? = parse(description),
              let response = downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
              let size = (try? files.attributesOfItem(atPath: location.path))?[.size] as? NSNumber, size.intValue > 0 else {
            return
        }
        let dir = stagingDir(id)
        let file = dir.appendingPathComponent(fileName)
        do {
            try files.createDirectory(at: dir, withIntermediateDirectories: true)
            try? files.removeItem(at: file)
            try files.moveItem(at: location, to: file)
        } catch {
            // Counted as a failed attempt in didCompleteWithError.
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let description = task.taskDescription else {
            return
        }
        let identifier = task.taskIdentifier
        queue.async {
            guard self.pending[description] == identifier else {
                return
            }
            if (error as? URLError)?.code == .cancelled {
                self.pending.removeValue(forKey: description)
                return
            }
            var saved = false
            if error == nil, case let (id, fileName)? = self.parse(description) {
                saved = self.files.fileExists(atPath: self.stagingDir(id).appendingPathComponent(fileName).path)
            }
            self.pageEnded(description, saved: saved)
        }
    }

    /// Every event iOS had for the app has been delivered (it was woken in the background for them).
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        queue.async {
            self.updateNotification()
            self.finishIfIdle()
        }
    }
}

/// A ZIP writer with uncompressed ("stored") entries and UTF-8 names, written as it goes.
private struct StoredZip {
    private struct Record {
        let name: Data
        let crc: UInt32
        let size: UInt32
        let offset: UInt32
    }

    private var records: [Record] = []
    private var offset: UInt32 = 0
    private let time: UInt16
    private let date: UInt16

    init(now: Date = Date()) {
        let c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        time = UInt16((c.hour ?? 0) << 11 | (c.minute ?? 0) << 5 | (c.second ?? 0) / 2)
        date = UInt16((max(c.year ?? 1980, 1980) - 1980) << 9 | (c.month ?? 1) << 5 | (c.day ?? 1))
    }

    mutating func add(_ fileName: String, _ data: Data, to handle: FileHandle) throws {
        let name = Data(fileName.utf8)
        let crc = CRC32.checksum(data)
        var header = Data()
        header.le32(0x0403_4b50)
        header.le16(20) // version needed
        header.le16(0x0800) // UTF-8 names
        header.le16(0) // stored
        header.le16(time)
        header.le16(date)
        header.le32(crc)
        header.le32(UInt32(data.count))
        header.le32(UInt32(data.count))
        header.le16(UInt16(name.count))
        header.le16(0)
        header.append(name)
        try handle.write(contentsOf: header)
        try handle.write(contentsOf: data)
        records.append(Record(name: name, crc: crc, size: UInt32(data.count), offset: offset))
        offset += UInt32(header.count + data.count)
    }

    func finish(_ handle: FileHandle) throws {
        var central = Data()
        for record in records {
            central.le32(0x0201_4b50)
            central.le16(20) // version made by
            central.le16(20) // version needed
            central.le16(0x0800)
            central.le16(0)
            central.le16(time)
            central.le16(date)
            central.le32(record.crc)
            central.le32(record.size)
            central.le32(record.size)
            central.le16(UInt16(record.name.count))
            central.le16(0) // extra
            central.le16(0) // comment
            central.le16(0) // disk
            central.le16(0) // internal attributes
            central.le32(0) // external attributes
            central.le32(record.offset)
            central.append(record.name)
        }
        var end = Data()
        end.le32(0x0605_4b50)
        end.le16(0)
        end.le16(0)
        end.le16(UInt16(records.count))
        end.le16(UInt16(records.count))
        end.le32(UInt32(central.count))
        end.le32(offset)
        end.le16(0)
        try handle.write(contentsOf: central)
        try handle.write(contentsOf: end)
    }
}

private enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 {
            c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1
        }
        return c
    }

    static func checksum(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            for byte in bytes {
                crc = table[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
            }
        }
        return crc ^ 0xFFFF_FFFF
    }
}

private extension Data {
    mutating func le16(_ value: UInt16) {
        Swift.withUnsafeBytes(of: value.littleEndian) { append(contentsOf: $0) }
    }

    mutating func le32(_ value: UInt32) {
        Swift.withUnsafeBytes(of: value.littleEndian) { append(contentsOf: $0) }
    }
}
