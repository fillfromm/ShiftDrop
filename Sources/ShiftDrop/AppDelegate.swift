import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let monitor = DragMonitor()
    private let panel = RadialPanelController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        Notifier.requestAuthorization()

        monitor.onFilesDragged = { [weak self] urls, point in
            self?.panel.show(files: urls, at: point)
        }
        panel.onSelect = { [weak self] urls, format in
            self?.convert(urls, to: format)
        }
        monitor.start()
    }

    // MARK: - Conversion

    private func convert(_ urls: [URL], to format: Format) {
        Task {
            var done: [URL] = []
            var errors: [String] = []
            for url in urls {
                do {
                    done.append(try await Converter.convert(url, to: format))
                } catch {
                    errors.append("\(url.lastPathComponent): \(error.localizedDescription)")
                }
            }
            await MainActor.run {
                Notifier.finish(converted: done, errors: errors, format: format)
            }
        }
    }

    // MARK: - Status item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "arrow.triangle.2.circlepath",
            accessibilityDescription: "ShiftDrop"
        )

        let menu = NSMenu()

        let hint = NSMenuItem(title: "Hold ⇧ while dragging a file", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)
        menu.addItem(.separator())

        let login = NSMenuItem(
            title: "Launch at Login",
            action: #selector(toggleLaunchAtLogin(_:)),
            keyEquivalent: ""
        )
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)

        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit ShiftDrop", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            NSSound.beep()
        }
        sender.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }
}
