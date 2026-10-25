import AppKit

// MARK: - Panel controller

/// Owns the floating, transparent panel that hosts the radial menu.
final class RadialPanelController {
    var onSelect: (([URL], Format) -> Void)?

    private let panel: NSPanel
    private let view: RadialView
    private var category: Category?
    private var pollTimer: Timer?
    private var ticksSinceRelease = 0

    private static let size: CGFloat = 320

    init() {
        let frame = NSRect(x: 0, y: 0, width: Self.size, height: Self.size)
        view = RadialView(frame: frame)
        panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = view
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .popUpMenu
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]

        view.onDrop = { [weak self] urls, format in
            guard let self else { return }
            let matching = urls.filter { Category(url: $0) == self.category }
            self.hide()
            if !matching.isEmpty { self.onSelect?(matching, format) }
        }
    }

    func show(files: [URL], at point: NSPoint) {
        guard let first = files.first, let category = Category(url: first) else { return }
        self.category = category

        let sameKind = files.filter { Category(url: $0) == category }
        view.configure(formats: Formats.available(for: category), fileCount: sameKind.count)

        // Center on the cursor, but keep the whole circle on screen.
        let screen = NSScreen.screens.first { NSMouseInRect(point, $0.frame, false) } ?? NSScreen.main
        var origin = NSPoint(x: point.x - Self.size / 2, y: point.y - Self.size / 2)
        if let visible = screen?.visibleFrame {
            origin.x = min(max(origin.x, visible.minX), visible.maxX - Self.size)
            origin.y = min(max(origin.y, visible.minY), visible.maxY - Self.size)
        }
        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
        startPolling()
    }

    func hide() {
        pollTimer?.invalidate()
        pollTimer = nil
        panel.orderOut(nil)
    }

    /// While a drag session runs, the OS may swallow the global mouse-up event,
    /// so we poll the button state instead. After release we wait a moment
    /// (so a drop onto the panel can still be delivered) and then hide.
    private func startPolling() {
        pollTimer?.invalidate()
        ticksSinceRelease = 0
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self else { return }
            if NSEvent.pressedMouseButtons & 1 == 0 {
                self.ticksSinceRelease += 1
                if self.ticksSinceRelease >= 5 { self.hide() }
            } else {
                self.ticksSinceRelease = 0
            }
        }
    }
}

// MARK: - Radial view

/// Draws the ring of format "sectors" and acts as a drag destination.
/// Drop a file on a sector to convert it; release in the center or outside the ring to cancel.
final class RadialView: NSView {
    var onDrop: (([URL], Format) -> Void)?

    private var formats: [Format] = []
    private var fileCount = 0
    private var hover: Int? {
        didSet { if hover != oldValue { needsDisplay = true } }
    }

    private let outerRadius: CGFloat = 150
    private let innerRadius: CGFloat = 44

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isOpaque: Bool { false }

    func configure(formats: [Format], fileCount: Int) {
        self.formats = formats
        self.fileCount = fileCount
        self.hover = nil
        needsDisplay = true
    }

    // MARK: Geometry

    /// Sectors are laid out clockwise, starting at 12 o'clock.
    private func sectorIndex(at point: NSPoint) -> Int? {
        guard !formats.isEmpty else { return nil }
        let dx = point.x - bounds.midX
        let dy = point.y - bounds.midY
        let distance = hypot(dx, dy)
        guard distance >= innerRadius, distance <= outerRadius else { return nil }

        let angle = atan2(dy, dx) * 180 / .pi            // degrees, counter-clockwise from +x
        var clockwiseFromTop = 90 - angle
        clockwiseFromTop = clockwiseFromTop.truncatingRemainder(dividingBy: 360)
        if clockwiseFromTop < 0 { clockwiseFromTop += 360 }

        let step = 360 / CGFloat(formats.count)
        return min(Int(clockwiseFromTop / step), formats.count - 1)
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        guard !formats.isEmpty else { return }
        let center = NSPoint(x: bounds.midX, y: bounds.midY)
        let step = 360 / CGFloat(formats.count)

        for (i, format) in formats.enumerated() {
            let start = 90 - CGFloat(i) * step
            let end = start - step

            let path = NSBezierPath()
            path.appendArc(withCenter: center, radius: outerRadius, startAngle: start, endAngle: end, clockwise: true)
            path.appendArc(withCenter: center, radius: innerRadius, startAngle: end, endAngle: start, clockwise: false)
            path.close()

            let isHovered = hover == i
            let fill: NSColor
            if !format.isAvailable {
                fill = NSColor(white: 0.18, alpha: 0.7)
            } else if isHovered {
                fill = NSColor.controlAccentColor
            } else {
                fill = NSColor(white: 0.10, alpha: 0.88)
            }
            fill.setFill()
            path.fill()

            NSColor(white: 1, alpha: 0.15).setStroke()
            path.lineWidth = 1
            path.stroke()

            // Label in the middle of the sector.
            let mid = (start - step / 2) * .pi / 180
            let labelRadius = (outerRadius + innerRadius) / 2
            let p = NSPoint(x: center.x + labelRadius * cos(mid), y: center.y + labelRadius * sin(mid))
            drawLabel(format.label, at: p, enabled: format.isAvailable)
            if !format.isAvailable {
                drawLabel("needs ffmpeg", at: NSPoint(x: p.x, y: p.y - 15), enabled: false, size: 9)
            }
        }

        // Center "cancel" disc.
        let disc = NSBezierPath(ovalIn: NSRect(
            x: center.x - innerRadius + 5, y: center.y - innerRadius + 5,
            width: (innerRadius - 5) * 2, height: (innerRadius - 5) * 2
        ))
        NSColor(white: 0.10, alpha: 0.88).setFill()
        disc.fill()
        drawLabel(fileCount > 1 ? "\(fileCount)×" : "✕", at: center, enabled: true, size: 16)
    }

    private func drawLabel(_ text: String, at point: NSPoint, enabled: Bool, size: CGFloat = 14) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: size, weight: .semibold),
            .foregroundColor: NSColor(white: 1, alpha: enabled ? 1 : 0.45)
        ]
        let string = NSAttributedString(string: text, attributes: attrs)
        let s = string.size()
        string.draw(at: NSPoint(x: point.x - s.width / 2, y: point.y - s.height / 2))
    }

    // MARK: NSDraggingDestination

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        update(for: sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        update(for: sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        hover = nil
    }

    private func update(for sender: NSDraggingInfo) -> NSDragOperation {
        let point = convert(sender.draggingLocation, from: nil)
        let index = sectorIndex(at: point)
        hover = index
        guard let index, formats[index].isAvailable else { return [] }
        return .copy
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let point = convert(sender.draggingLocation, from: nil)
        guard let index = sectorIndex(at: point) else { return false }
        return formats[index].isAvailable
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let point = convert(sender.draggingLocation, from: nil)
        guard let index = sectorIndex(at: point), formats[index].isAvailable else { return false }

        let urls = sender.draggingPasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL] ?? []

        guard !urls.isEmpty else { return false }
        onDrop?(urls, formats[index])
        return true
    }
}
