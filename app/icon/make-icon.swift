// Draws the app icon (1024×1024, no transparency) and the launch-screen image.
// Run:  swift app/icon/make-icon.swift
import AppKit

func png(_ size: Int, _ path: String, alpha: Bool = false, _ draw: (CGContext, CGFloat) -> Void) {
    let c = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: (alpha ? CGImageAlphaInfo.premultipliedLast : CGImageAlphaInfo.noneSkipLast).rawValue)!   // main icon: no transparency (App Store rule)
    draw(c, CGFloat(size))
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, c.makeImage()!, nil)
    CGImageDestinationFinalize(dest)
}

let blue = NSColor(srgbRed: 0x24/255, green: 0x59/255, blue: 0xF6/255, alpha: 1)
let ink  = NSColor(srgbRed: 0x17/255, green: 0x19/255, blue: 0x14/255, alpha: 1)

// A chunky "poster" checkbox with a tick, drawn inside a w×w area at (x, y)
func checkbox(_ c: CGContext, x: CGFloat, y: CGFloat, w: CGFloat, paper: NSColor = .white, line: NSColor = ink, tick: NSColor = blue, shade: NSColor = ink) {
    let shadow = w * 0.06, lw = w * 0.055
    c.setFillColor(shade.cgColor)
    c.addPath(CGPath(roundedRect: CGRect(x: x + shadow, y: y - shadow, width: w, height: w), cornerWidth: w*0.12, cornerHeight: w*0.12, transform: nil))
    c.fillPath()
    let box = CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: w), cornerWidth: w*0.12, cornerHeight: w*0.12, transform: nil)
    c.setFillColor(paper.cgColor); c.addPath(box); c.fillPath()
    c.setStrokeColor(line.cgColor); c.setLineWidth(lw); c.addPath(box); c.strokePath()
    c.setStrokeColor(tick.cgColor); c.setLineWidth(w * 0.13); c.setLineCap(.round); c.setLineJoin(.round)
    c.move(to: CGPoint(x: x + w*0.22, y: y + w*0.50))
    c.addLine(to: CGPoint(x: x + w*0.42, y: y + w*0.30))
    c.addLine(to: CGPoint(x: x + w*0.80, y: y + w*0.74))
    c.strokePath()
}

let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "app/icon"
png(1024, "\(dir)/AppIcon-1024.png") { c, s in
    c.setFillColor(blue.cgColor); c.fill(CGRect(x: 0, y: 0, width: s, height: s))
    checkbox(c, x: s*0.22, y: s*0.24, w: s*0.54)
}
// iOS 18+ dark-mode icon: transparent background (the system adds a dark one)
let ice = NSColor(srgbRed: 0xA3/255, green: 0xBC/255, blue: 0xFF/255, alpha: 1)
png(1024, "\(dir)/AppIcon-Dark-1024.png", alpha: true) { c, s in
    checkbox(c, x: s*0.22, y: s*0.24, w: s*0.54, paper: NSColor(white: 0.13, alpha: 1), line: ice, tick: ice, shade: NSColor(white: 0, alpha: 0.6))
}
// iOS 18+ tinted icon: greyscale, the system colours it
png(1024, "\(dir)/AppIcon-Tinted-1024.png") { c, s in
    c.setFillColor(NSColor.black.cgColor); c.fill(CGRect(x: 0, y: 0, width: s, height: s))
    checkbox(c, x: s*0.22, y: s*0.24, w: s*0.54, paper: NSColor(white: 0.18, alpha: 1), line: .white, tick: .white, shade: NSColor(white: 0.08, alpha: 1))
}
png(2732, "\(dir)/Splash-2732.png") { c, s in
    c.setFillColor(blue.cgColor); c.fill(CGRect(x: 0, y: 0, width: s, height: s))
    checkbox(c, x: s*0.5 - 160, y: s*0.5 - 150, w: 300)
}
print("icon + splash written to \(dir)")
