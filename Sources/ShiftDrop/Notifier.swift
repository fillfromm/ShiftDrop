import AppKit
import UserNotifications

/// Tells the user how a conversion went.
/// Notifications only work when running as a real `.app` bundle (see scripts/build_app.sh);
/// with plain `swift run` we fall back to printing to the console.
enum Notifier {
    private static var canNotify: Bool {
        Bundle.main.bundleIdentifier != nil && Bundle.main.bundlePath.hasSuffix(".app")
    }

    static func requestAuthorization() {
        guard canNotify else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in }
    }

    static func finish(converted: [URL], errors: [String], format: Format) {
        if !converted.isEmpty {
            let title = converted.count == 1
                ? "Converted to \(format.label)"
                : "Converted \(converted.count) files to \(format.label)"
            let body = converted.map(\.lastPathComponent).joined(separator: ", ")
            post(title: title, body: body)
        }

        if !errors.isEmpty {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Conversion failed"
            alert.informativeText = errors.joined(separator: "\n")
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    private static func post(title: String, body: String) {
        guard canNotify else {
            print("\(title): \(body)")
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
