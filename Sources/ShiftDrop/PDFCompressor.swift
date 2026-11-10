import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

/// Shrinks a PDF below a byte budget by re-drawing every page as a JPEG image inside a new PDF.
/// It lowers the render resolution and JPEG quality step by step until the file fits.
/// Trade-off: text in the result is no longer selectable/searchable.
enum PDFCompressor {
    static func compress(_ input: URL, to output: URL, maxBytes: Int) throws {
        // Already small enough: nothing to do, keep the original bytes.
        if let size = try? input.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maxBytes {
            try FileManager.default.copyItem(at: input, to: output)
            return
        }

        guard let doc = CGPDFDocument(input as CFURL), doc.numberOfPages > 0 else {
            throw ConversionError.failed(tool: "PDF", message: "Can't read PDF.")
        }
        if doc.isEncrypted && !doc.isUnlocked {
            throw ConversionError.failed(tool: "PDF", message: "PDF is password protected.")
        }

        var smallest: Data?
        for dpi in [150.0, 120, 100, 80, 65, 50, 40] {
            let pages = (1...doc.numberOfPages).compactMap { render(doc.page(at: $0), dpi: dpi) }
            guard pages.count == doc.numberOfPages else { continue }

            for quality in [0.75, 0.6, 0.45, 0.3] {
                guard let data = build(pages, quality: quality) else { continue }
                if smallest == nil || data.count < smallest!.count { smallest = data }
                if data.count <= maxBytes {
                    try data.write(to: output)
                    return
                }
            }
        }

        // Nothing fit. Don't pretend it worked.
        let got = smallest.map { String(format: "%.1f MB", Double($0.count) / 1_000_000) } ?? "?"
        throw ConversionError.failed(
            tool: "PDF",
            message: "Couldn't get under \(String(format: "%.0f", Double(maxBytes) / 1_000_000)) MB (best result \(got))."
        )
    }

    private struct Page {
        let image: CGImage      // rasterised page
        let width: CGFloat      // page size in PDF points
        let height: CGFloat
    }

    private static func render(_ page: CGPDFPage?, dpi: Double) -> Page? {
        guard let page else { return nil }
        var box = page.getBoxRect(.mediaBox)
        let rotated = page.rotationAngle % 180 != 0
        if rotated { box = CGRect(x: 0, y: 0, width: box.height, height: box.width) }
        else { box = CGRect(x: 0, y: 0, width: box.width, height: box.height) }

        let scale = dpi / 72
        let px = (Int(box.width * scale), Int(box.height * scale))
        guard px.0 > 0, px.1 > 0,
              let ctx = CGContext(
                data: nil, width: px.0, height: px.1, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
              ) else { return nil }

        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: px.0, height: px.1))
        ctx.scaleBy(x: CGFloat(px.0) / box.width, y: CGFloat(px.1) / box.height)
        ctx.concatenate(page.getDrawingTransform(.mediaBox, rect: box, rotate: 0, preserveAspectRatio: true))
        ctx.drawPDFPage(page)
        guard let image = ctx.makeImage() else { return nil }
        return Page(image: image, width: box.width, height: box.height)
    }

    private static func build(_ pages: [Page], quality: Double) -> Data? {
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data) else { return nil }
        var first = CGRect(x: 0, y: 0, width: pages[0].width, height: pages[0].height)
        guard let pdf = CGContext(consumer: consumer, mediaBox: &first, nil) else { return nil }

        for page in pages {
            guard let jpeg = jpegImage(page.image, quality: quality) else { return nil }
            var box = CGRect(x: 0, y: 0, width: page.width, height: page.height)
            let info = [kCGPDFContextMediaBox as String: Data(bytes: &box, count: MemoryLayout<CGRect>.size)] as CFDictionary
            pdf.beginPDFPage(info)
            pdf.draw(jpeg, in: box)
            pdf.endPDFPage()
        }
        pdf.closePDF()
        return data as Data
    }

    /// Encodes to JPEG and reloads it so the PDF embeds the compressed bytes as-is.
    private static func jpegImage(_ image: CGImage, quality: Double) -> CGImage? {
        let buf = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(buf, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest), let provider = CGDataProvider(data: buf) else { return nil }
        return CGImage(jpegDataProviderSource: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
}
