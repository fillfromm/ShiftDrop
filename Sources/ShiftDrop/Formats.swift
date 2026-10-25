import Foundation
import UniformTypeIdentifiers

/// Broad kind of a file; decides which output formats the radial menu offers.
enum Category: Equatable {
    case image, audio, video, pdf, text

    init?(url: URL) {
        guard let type = UTType(filenameExtension: url.pathExtension.lowercased()) else { return nil }
        if type.conforms(to: .pdf) { self = .pdf }
        else if type.conforms(to: .image) { self = .image }
        else if type.conforms(to: .movie) { self = .video }
        else if type.conforms(to: .audio) { self = .audio }
        else if type.conforms(to: .plainText) { self = .text }
        else { return nil }
    }
}

/// Locations of optional third-party tools.
enum Tools {
    /// ffmpeg is optional (`brew install ffmpeg`). Checked on every call, so installing it
    /// while ShiftDrop is running works without a restart.
    static var ffmpeg: String? {
        ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
    }
}

/// One output format, i.e. one sector of the radial menu.
struct Format {
    enum Backend {
        /// macOS built-in `sips` (images, PDF -> image, image -> PDF).
        case sips(format: String)
        /// macOS built-in `afconvert` (audio).
        case afconvert(fileType: String, dataFormat: String)
        /// Optional `ffmpeg` (MP3, FLAC, OGG, video, ...). Arguments go between input and output.
        case ffmpeg(args: [String])
        /// macOS built-in `cupsfilter` (plain text -> PDF).
        case cupsfilter
    }

    let label: String
    let ext: String
    let backend: Backend

    var isAvailable: Bool {
        if case .ffmpeg = backend { return Tools.ffmpeg != nil }
        return true
    }
}

enum Formats {
    static func available(for category: Category) -> [Format] {
        switch category {
        case .image:
            return [
                Format(label: "PNG", ext: "png", backend: .sips(format: "png")),
                Format(label: "JPG", ext: "jpg", backend: .sips(format: "jpeg")),
                Format(label: "HEIC", ext: "heic", backend: .sips(format: "heic")),
                Format(label: "TIFF", ext: "tiff", backend: .sips(format: "tiff")),
                Format(label: "GIF", ext: "gif", backend: .sips(format: "gif")),
                Format(label: "PDF", ext: "pdf", backend: .sips(format: "pdf")),
            ]
        case .audio:
            return [
                Format(label: "M4A", ext: "m4a", backend: .afconvert(fileType: "m4af", dataFormat: "aac")),
                Format(label: "WAV", ext: "wav", backend: .afconvert(fileType: "WAVE", dataFormat: "LEI16")),
                Format(label: "AIFF", ext: "aiff", backend: .afconvert(fileType: "AIFF", dataFormat: "BEI16")),
                Format(label: "MP3", ext: "mp3", backend: .ffmpeg(args: ["-vn", "-codec:a", "libmp3lame", "-q:a", "2"])),
                Format(label: "FLAC", ext: "flac", backend: .ffmpeg(args: ["-vn", "-codec:a", "flac"])),
                Format(label: "OGG", ext: "ogg", backend: .ffmpeg(args: ["-vn", "-codec:a", "libvorbis", "-q:a", "5"])),
            ]
        case .video:
            return [
                Format(label: "MP4", ext: "mp4", backend: .ffmpeg(args: [
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                ])),
                Format(label: "WebM", ext: "webm", backend: .ffmpeg(args: [
                    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus",
                ])),
                Format(label: "GIF", ext: "gif", backend: .ffmpeg(args: [
                    "-an", "-vf", "fps=12,scale=480:-1:flags=lanczos",
                ])),
                Format(label: "MP3", ext: "mp3", backend: .ffmpeg(args: [
                    "-vn", "-codec:a", "libmp3lame", "-q:a", "2",
                ])),
                Format(label: "M4A", ext: "m4a", backend: .ffmpeg(args: [
                    "-vn", "-c:a", "aac", "-b:a", "192k",
                ])),
            ]
        case .pdf:
            // First page only (that is what `sips` renders).
            return [
                Format(label: "PNG", ext: "png", backend: .sips(format: "png")),
                Format(label: "JPG", ext: "jpg", backend: .sips(format: "jpeg")),
            ]
        case .text:
            return [
                Format(label: "PDF", ext: "pdf", backend: .cupsfilter),
            ]
        }
    }
}
