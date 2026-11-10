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

    private static let size: CGFloat = 440

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
        view.configure(
            formats: Formats.available(for: category),
            sizes: Formats.compressions(for: category),
            fileCount: sameKind.count
        )

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

/// Draws two rings and acts as a drag destination.
/// Inner ring: output formats (convert). Outer ring: size targets (compress), tinted differently.
/// Drop a file on a sector to run it; release in the center or outside the rings to cancel.
final class RadialView: NSView {
    var onDrop: (([URL], Format) -> Void)?

    private struct Hit: Equatable {
        let isSize: Bool
        let index: Int
    }

    private var formats: [Format] = []
    private var sizes: [Format] = []
    private var fileCount = 0
    private var hover: Hit? {
        didSet { if hover != oldValue { needsDisplay = true } }
    }

    private let centerRadius: CGFloat = 44
    private let formatOuter: CGFloat = 120
    private let sizeInner: CGFloat = 126
    private let sizeOuter: CGFloat = 200

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isOpaque: Bool { false }

    func configure(formats: [Format], sizes: [Format], fileCount: Int) {
        self.formats = formats
        self.sizes = sizes
        self.fileCount = fileCount
        self.hover = nil
        needsDisplay = true
    }

    // MARK: Geometry

    private func format(for hit: Hit) -> Format {
        hit.isSize ? sizes[hit.index] : formats[hit.index]
    }

    /// Sectors are laid out clockwise, starting at 12 o'clock.
    private func hit(at point: NSPoint) -> Hit? {
        let dx = point.x - bounds.midX
        let dy = point.y - bounds.midY
        let distance = hypot(dx, dy)

        let isSize: Bool
        if distance >= centerRadius, distance <= formatOuter, !formats.isEmpty {
            isSize = false
        } else if distance >= sizeInner, distance <= sizeOuter, !sizes.isEmpty {
            isSize = true
        } else {
            return nil
        }

        let count = isSize ? sizes.count : formats.count
        let angle = atan2(dy, dx) * 180 / .pi            // degrees, counter-clockwise from +x
        var clockwiseFromTop = 90 - angle
        clockwiseFromTop = clockwiseFromTop.truncatingRemainder(dividingBy: 360)
        if clockwiseFromTop < 0 { clockwiseFromTop += 360 }

        let step = 360 / CGFloat(count)
        return Hit(isSize: isSize, index: min(Int(clockwiseFromTop / step), count - 1))
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        let center = NSPoint(x: bounds.midX, y: bounds.midY)

        drawRing(formats, isSize: false, inner: centerRadius, outer: formatOuter, center: center)
        drawRing(sizes, isSize: true, inner: sizeInner, outer: sizeOuter, center: center)

        // Center "cancel" disc.
        let disc = NSBezierPath(ovalIn: NSRect(
            x: center.x - centerRadius + 5, y: center.y - centerRadius + 5,
            width: (centerRadius - 5) * 2, height: (centerRadius - 5) * 2
        ))
        NSColor(white: 0.10, alpha: 0.88).setFill()
        disc.fill()
        drawLabel(fileCount > 1 ? "\(fileCount)×" : "✕", at: center, enabled: true, size: 16)
    }

    private func drawRing(_ items: [Format], isSize: Bool, inner: CGFloat, outer: CGFloat, center: NSPoint) {
        guard !items.isEmpty else { return }
        let step = 360 / CGFloat(items.count)

        for (i, format) in items.enumerated() {
            let start = 90 - CGFloat(i) * step
            let end = start - step

            let path = NSBezierPath()
            path.appendArc(withCenter: center, radius: outer, startAngle: start, endAngle: end, clockwise: true)
            path.appendArc(withCenter: center, radius: inner, startAngle: end, endAngle: start, clockwise: false)
            path.close()

            let isHovered = hover == Hit(isSize: isSize, index: i)
            let fill: NSColor
            if !format.isAvailable {
                fill = NSColor(white: 0.18, alpha: 0.7)
            } else if isHovered {
                fill = isSize ? NSColor.systemOrange : NSColor.controlAccentColor
            } else if isSize {
                fill = NSColor(calibratedRed: 0.20, green: 0.11, blue: 0.04, alpha: 0.90)   // warm tint
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
            let labelRadius = (outer + inner) / 2
            let p = NSPoint(x: center.x + labelRadius * cos(mid), y: center.y + labelRadius * sin(mid))
            drawLabel(format.label, at: p, enabled: format.isAvailable)
            if !format.isAvailable {
                drawLabel("needs ffmpeg", at: NSPoint(x: p.x, y: p.y - 15), enabled: false, size: 9)
            }
        }
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
        let target = hit(at: point)
        hover = target
        guard let target, format(for: target).isAvailable else { return [] }
        return .copy
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let point = convert(sender.draggingLocation, from: nil)
        guard let target = hit(at: point) else { return false }
        return format(for: target).isAvailable
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let point = convert(sender.draggingLocation, from: nil)
        guard let target = hit(at: point), format(for: target).isAvailable else { return false }

        let urls = sender.draggingPasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL] ?? []

        guard !urls.isEmpty else { return false }
        onDrop?(urls, format(for: target))
        return true
    }
}
