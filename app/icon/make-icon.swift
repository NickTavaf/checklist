// Draws the app icon (1024×1024, no transparency) and the launch-screen image.
// Run:  swift app/icon/make-icon.swift
import AppKit

func png(_ size: Int, _ path: String, _ draw: (CGContext, CGFloat) -> Void) {
    let c = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!   // no transparency (App Store rule)
    draw(c, CGFloat(size))
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, c.makeImage()!, nil)
    CGImageDestinationFinalize(dest)
}

let blue = NSColor(srgbRed: 0x24/255, green: 0x59/255, blue: 0xF6/255, alpha: 1)
let ink  = NSColor(srgbRed: 0x17/255, green: 0x19/255, blue: 0x14/255, alpha: 1)

// A chunky "poster" checkbox with a tick, drawn inside a w×w area at (x, y)
func checkbox(_ c: CGContext, x: CGFloat, y: CGFloat, w: CGFloat) {
    let shadow = w * 0.06, lw = w * 0.055
    c.setFillColor(ink.cgColor)
    c.addPath(CGPath(roundedRect: CGRect(x: x + shadow, y: y - shadow, width: w, height: w), cornerWidth: w*0.12, cornerHeight: w*0.12, transform: nil))
    c.fillPath()
    let box = CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: w), cornerWidth: w*0.12, cornerHeight: w*0.12, transform: nil)
    c.setFillColor(NSColor.white.cgColor); c.addPath(box); c.fillPath()
    c.setStrokeColor(ink.cgColor); c.setLineWidth(lw); c.addPath(box); c.strokePath()
    c.setStrokeColor(blue.cgColor); c.setLineWidth(w * 0.13); c.setLineCap(.round); c.setLineJoin(.round)
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
png(2732, "\(dir)/Splash-2732.png") { c, s in
    c.setFillColor(blue.cgColor); c.fill(CGRect(x: 0, y: 0, width: s, height: s))
    checkbox(c, x: s*0.5 - 160, y: s*0.5 - 150, w: 300)
}
print("icon + splash written to \(dir)")
