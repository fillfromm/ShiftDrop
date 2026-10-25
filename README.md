# ShiftDrop

Convert files on macOS by **holding Shift while you drag them**. A radial menu appears under the cursor; drop the file on a format and the converted copy lands next to the original. Everything runs locally, nothing is uploaded.

> Status: early prototype (v0.1). Contributions welcome.

The idea is inspired by the app Tangerine. ShiftDrop is written from scratch and does not copy any of its code.

## How it works

1. Start dragging a file from Finder or the Desktop.
2. Hold **Shift**. A ring of output formats pops up around the cursor.
3. Drop the file on a sector, for example `PNG`. Release in the center or outside the ring to cancel.
4. The converted file appears in the same folder (`photo.heic` becomes `photo.png`, or `photo 2.png` if that name is taken).

Multiple files of the same kind can be dragged at once.

## Supported conversions

| Input | Output | Engine |
|-------|--------|--------|
| Images (HEIC, PNG, JPG, TIFF, GIF, ...) | PNG, JPG, HEIC, TIFF, GIF, PDF | `sips` (built into macOS) |
| PDF | PNG, JPG (first page) | `sips` |
| Audio | M4A, WAV, AIFF | `afconvert` (built into macOS) |
| Audio | MP3, FLAC, OGG | `ffmpeg` (optional) |
| Video | MP4, WebM, GIF, MP3, M4A | `ffmpeg` (optional) |
| Plain text | PDF | `cupsfilter` (built into macOS) |

Sectors that need `ffmpeg` are greyed out until you install it: `brew install ffmpeg`.

## Requirements

- macOS 13 or later
- Xcode command line tools / Swift 5.9+ to build

## Build and run

```bash
git clone https://github.com/fillfromm/ShiftDrop.git
cd ShiftDrop

# quick run from the terminal
swift run

# or build a proper menu-bar app (needed for notifications and "Launch at Login")
./scripts/build_app.sh
open build/ShiftDrop.app
```

ShiftDrop lives in the menu bar (no Dock icon). Use the menu bar icon to enable "Launch at Login" or quit.

## Project layout

```
Sources/ShiftDrop/
  main.swift          app entry point (menu-bar only)
  AppDelegate.swift   status item, wires everything together
  DragMonitor.swift   detects "drag + Shift" via global mouse monitors and the drag pasteboard
  RadialPanel.swift   floating transparent panel + radial menu view (drag destination)
  Formats.swift       file categories and the formats offered for each
  Converter.swift     runs sips / afconvert / ffmpeg / cupsfilter
  Notifier.swift      result notifications and error alerts
Resources/Info.plist  bundle metadata (LSUIElement = menu-bar app)
scripts/build_app.sh  builds build/ShiftDrop.app
```

## What works / known issues

Tested on macOS 14 with Xcode 16.2 (Apple Silicon): the project builds with `./scripts/build_app.sh`, the app starts as a menu-bar app and the Shift-drag menu works. Not every conversion pair has been tested yet.

Known issues and limits:

- Only the first page of a PDF is converted to an image.
- MP3, FLAC, OGG and all video outputs need `ffmpeg`; without it those sectors are greyed out.
- Notifications work only in the `.app` build, not with `swift run`.
- The menu needs Accessibility and Input Monitoring permissions (see Troubleshooting).
- Office documents (DOCX, XLSX, PPTX) are not supported yet.
- The build is only ad-hoc signed, so it is not notarized. macOS may warn about it on other machines.
- `build_app.sh` can fail at `codesign` with "detritus not allowed" if the folder is synced by iCloud or similar. Run `xattr -cr build/ShiftDrop.app` and sign again.

## Troubleshooting

- **The menu does not appear:** start the drag first, *then* press Shift. If it still does not show up, add ShiftDrop under System Settings, Privacy & Security, Accessibility (and Input Monitoring) and restart it.
- **No notifications:** run the `.app` build, not `swift run`.
- **Grey MP3/FLAC/OGG/video sectors:** install `ffmpeg`.

## Ideas / roadmap

- Keyboard selection (arrow keys + Enter) like in the original concept
- Second menu on Shift+Option with tools: compress, trim, crop, merge, split PDF, read QR code
- Configurable output folder and quality settings
- Document formats (DOCX, RTF, HTML) via `textutil`
- Custom app icon and a signed/notarized release

## License

MIT, see [LICENSE](LICENSE).
