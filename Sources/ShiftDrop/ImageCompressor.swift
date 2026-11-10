import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

/// Shrinks an image to a JPEG no larger than a byte budget.
/// Keeps full resolution and searches for the highest JPEG quality that fits;
/// only if even the lowest acceptable quality is too big does it start downscaling.
enum ImageCompressor {
    static func compress(_ input: URL, to output: URL, maxBytes: Int) throws {
        guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int,
              let h = props[kCGImagePropertyPixelHeight] as? Int
        else { throw ConversionError.failed(tool: "ImageIO", message: "Can't read image.") }

        let longest = max(w, h)
        var best: Data?

        for scale in [1.0, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2] {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,      // respect EXIF rotation
                kCGImageSourceThumbnailMaxPixelSize: max(Int(Double(longest) * scale), 16),
            ]
            guard let raw = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
                  let flat = flattenOnWhite(raw) else { continue }

            // Binary search for the best quality that fits.
            var low = 0.35, high = 0.95
            var fit: Data?
            if let data = encode(flat, quality: high), data.count <= maxBytes {
                fit = data
            } else {
                for _ in 0..<7 {
                    let mid = (low + high) / 2
                    if let data = encode(flat, quality: mid), data.count <= maxBytes {
                        fit = data; low = mid
                    } else {
                        high = mid
                    }
                }
            }
            if let fit { best = fit; break }
        }

        guard let best else {
            throw ConversionError.failed(tool: "compress", message: "Couldn't get under the size limit.")
        }
        try best.write(to: output)
    }

    /// JPEG has no alpha; put transparent images on white instead of black.
    private static func flattenOnWhite(_ image: CGImage) -> CGImage? {
        guard let ctx = CGContext(
            data: nil, width: image.width, height: image.height,
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return ctx.makeImage()
    }

    private static func encode(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }
}
