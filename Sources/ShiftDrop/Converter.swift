import Foundation

enum ConversionError: LocalizedError {
    case toolMissing(String)
    case failed(tool: String, message: String)

    var errorDescription: String? {
        switch self {
        case .toolMissing(let tool):
            return "\(tool) is not installed. Try: brew install \(tool)"
        case .failed(let tool, let message):
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "\(tool) failed." : "\(tool): \(trimmed)"
        }
    }
}

/// Everything runs locally by shelling out to tools that ship with macOS (or ffmpeg, if installed).
/// Nothing is ever uploaded anywhere.
enum Converter {
    /// Converts `input` and writes the result next to it. Returns the output URL.
    static func convert(_ input: URL, to format: Format) async throws -> URL {
        let output = uniqueOutputURL(for: input, ext: format.ext)

        do {
            switch format.backend {
            case .sips(let target):
                try await run("/usr/bin/sips", ["-s", "format", target, input.path, "--out", output.path])

            case .afconvert(let fileType, let dataFormat):
                try await run("/usr/bin/afconvert", ["-f", fileType, "-d", dataFormat, input.path, output.path])

            case .ffmpeg(let args):
                guard let ffmpeg = Tools.ffmpeg else { throw ConversionError.toolMissing("ffmpeg") }
                try await run(ffmpeg, ["-y", "-loglevel", "error", "-i", input.path] + args + [output.path])

            case .cupsfilter:
                try await run("/usr/sbin/cupsfilter", [input.path], stdoutTo: output)
            }
        } catch {
            try? FileManager.default.removeItem(at: output)   // don't leave a half-written file
            throw error
        }
        return output
    }

    /// `photo.heic` -> `photo.png`, or `photo 2.png` if that already exists, and so on.
    static func uniqueOutputURL(for input: URL, ext: String) -> URL {
        let dir = input.deletingLastPathComponent()
        let base = input.deletingPathExtension().lastPathComponent
        var candidate = dir.appendingPathComponent(base).appendingPathExtension(ext)
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = dir.appendingPathComponent("\(base) \(n)").appendingPathExtension(ext)
            n += 1
        }
        return candidate
    }

    private static func run(_ executable: String, _ arguments: [String], stdoutTo: URL? = nil) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments

            let errorPipe = Pipe()
            process.standardError = errorPipe
            process.standardOutput = FileHandle.nullDevice

            var outHandle: FileHandle?
            if let stdoutTo {
                FileManager.default.createFile(atPath: stdoutTo.path, contents: nil)
                outHandle = try? FileHandle(forWritingTo: stdoutTo)
                if let outHandle { process.standardOutput = outHandle }
            }

            let name = (executable as NSString).lastPathComponent
            process.terminationHandler = { proc in
                try? outHandle?.close()
                let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let message = String(data: data, encoding: .utf8) ?? ""
                if proc.terminationStatus == 0 {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: ConversionError.failed(tool: name, message: message))
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
