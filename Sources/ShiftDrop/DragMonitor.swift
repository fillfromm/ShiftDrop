import AppKit

/// Watches for a file drag that happens while Shift is held.
///
/// Global mouse monitors see events that go to *other* apps (e.g. Finder),
/// which is exactly what we need: the user drags a file out of Finder / Desktop,
/// we notice it, and pop up the radial menu under the cursor.
final class DragMonitor {
    /// Called once per drag, with the dragged file URLs and the cursor position (screen coordinates).
    var onFilesDragged: (([URL], NSPoint) -> Void)?

    private var monitors: [Any] = []
    private var changeCountAtMouseDown = 0
    private var alreadyShown = false

    func start() {
        guard monitors.isEmpty else { return }

        if let m = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown, handler: { [weak self] _ in
            // Remember the drag pasteboard state, so we can tell a *fresh* drag
            // from stale file URLs left over from an earlier drag.
            self?.changeCountAtMouseDown = NSPasteboard(name: .drag).changeCount
            self?.alreadyShown = false
        }) {
            monitors.append(m)
        }

        if let m = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDragged, handler: { [weak self] _ in
            self?.handleDrag()
        }) {
            monitors.append(m)
        }

        if let m = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseUp, handler: { [weak self] _ in
            self?.alreadyShown = false
        }) {
            monitors.append(m)
        }
    }

    func stop() {
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors.removeAll()
    }

    private func handleDrag() {
        guard !alreadyShown else { return }
        // Reading the class property needs no special permission (unlike a key monitor).
        guard NSEvent.modifierFlags.contains(.shift) else { return }

        let pasteboard = NSPasteboard(name: .drag)
        guard pasteboard.changeCount != changeCountAtMouseDown else { return }

        guard let urls = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL], !urls.isEmpty else { return }

        alreadyShown = true
        onFilesDragged?(urls, NSEvent.mouseLocation)
    }

    deinit { stop() }
}
