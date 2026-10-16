// A closed, read-only helper. No input, focus, AX actions, trust prompt, private attributes or cloud calls.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Regular ChatGPT and Claude Desktop monitoring is deferred; retain Codex only.
let allowed: Set<String> = ["com.openai.codex"]
let deadline = ProcessInfo.processInfo.systemUptime + 1.8
let maxWindows = 16, maxNodes = 2000, maxDepth = 12, maxBytes = 131072
func inTime() -> Bool { ProcessInfo.processInfo.systemUptime < deadline }
func emit(_ value: [String: Any]) {
    if let bytes = try? JSONSerialization.data(withJSONObject: value), bytes.count <= 262144 {
        FileHandle.standardOutput.write(bytes)
    } else {
        FileHandle.standardOutput.write(Data("{\"health\":\"unavailable\",\"reason\":\"native-reader-unavailable\",\"windows\":[]}".utf8))
    }
}
func unavailable(_ reason: String) { emit(["health": "unavailable", "reason": reason, "windows": []]) }
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    guard inTime() else { return nil }
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &result) == .success ? result : nil
}
func elements(_ element: AXUIElement, _ name: CFString, limit: Int) -> (values: [AXUIElement], complete: Bool)? {
    guard inTime() else { return nil }
    var count: CFIndex = 0
    guard AXUIElementGetAttributeValueCount(element, name, &count) == .success, count >= 0 else { return nil }
    if count == 0 { return ([], true) }
    var values: CFArray?
    guard inTime(), AXUIElementCopyAttributeValues(element, name, 0, min(count, limit), &values) == .success,
          let array = values as? [AXUIElement] else { return nil }
    return (array, count <= limit)
}
struct Window {
    let bundle: String, pid: pid_t, start: String, number: CGWindowID, element: AXUIElement
    var identity: [String: Any] { ["bundleId": bundle, "pid": Int(pid), "processStart": start, "windowId": Int(number)] }
    var key: String { "\(bundle):\(pid):\(start):\(number)" }
}
// Public AX provides no window-number attribute. Do not guess among multiple windows by title or geometry.
// A singleton normal CG window and singleton AX window must have matching public bounds and owner PID.
// optionAll includes offscreen/minimized windows; on-screen filtering would fabricate singleton proof.
func window(_ app: NSRunningApplication, cg: [[String: Any]]) -> Window? {
    guard inTime(), let bundle = app.bundleIdentifier, allowed.contains(bundle), !app.isTerminated,
          let launched = app.launchDate else { return nil }
    let pid = app.processIdentifier
    let owned = cg.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid &&
        ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 }
    guard owned.count == 1, let info = owned.first,
          let number = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value, number > 0,
          let bounds = info[kCGWindowBounds as String] as? [String: Any],
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return nil }
    let application = AXUIElementCreateApplication(pid)
    guard let list = elements(application, kAXWindowsAttribute as CFString, limit: maxWindows + 1),
          list.complete, list.values.count == 1, let element = list.values.first else { return nil }
    var owner: pid_t = 0
    guard AXUIElementGetPid(element, &owner) == .success, owner == pid,
          let position = attribute(element, kAXPositionAttribute as CFString), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = attribute(element, kAXSizeAttribute as CFString), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point), AXValueGetValue(size as! AXValue, .cgSize, &dimensions),
          rect.origin == point, rect.size == dimensions else { return nil }
    let start = String(format: "%.6f", launched.timeIntervalSince1970)
    return Window(bundle: bundle, pid: pid, start: start, number: number, element: element)
}
func inventory() -> (windows: [Window], partial: Bool)? {
    guard inTime(), let cg = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier.map(allowed.contains) == true }
        .sorted { $0.processIdentifier < $1.processIdentifier }
    var rows: [Window] = [], partial = false
    for app in apps {
        guard inTime() else { return nil }
        // Absence of normal windows is successful absence; ambiguous/unreadable mapping is an explicit limit.
        let owned = cg.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier &&
            ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 }
        if owned.isEmpty { continue }
        guard rows.count < maxWindows else { partial = true; break }
        if let row = window(app, cg: cg) { rows.append(row) } else { partial = true }
    }
    return (rows, partial)
}
func loadedText(_ root: AXUIElement, pid: pid_t) -> (text: [String], truncated: Bool) {
    var result: [String] = [], visited: Set<AXUIElement> = [], nodes = 0, bytes = 0, truncated = false
    var stack: [(AXUIElement, Int)] = [(root, 0)]
    while let (element, depth) = stack.popLast() {
        guard inTime(), nodes < maxNodes else { truncated = true; break }
        if visited.contains(element) { continue }
        visited.insert(element); nodes += 1
        var owner: pid_t = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { truncated = true; continue }
        guard let role = attribute(element, kAXRoleAttribute as CFString) as? String else { continue }
        let subrole = attribute(element, kAXSubroleAttribute as CFString) as? String
        // Do not read compose/password controls, their descendants, editable values or unknown private attributes.
        if [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role) || subrole == kAXSecureTextFieldSubrole { continue }
        if role == kAXStaticTextRole {
            var settable = DarwinBoolean(false)
            if AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, !settable.boolValue,
               let value = attribute(element, kAXValueAttribute as CFString) as? String, !value.isEmpty {
                let count = value.utf8.count + (result.isEmpty ? 0 : 1)
                if bytes + count <= maxBytes { result.append(value); bytes += count }
                else { truncated = true }
            }
        }
        if depth >= maxDepth { truncated = true; continue }
        let remaining = maxNodes - nodes - stack.count
        guard remaining > 0 else { truncated = true; continue }
        guard let children = elements(element, kAXChildrenAttribute as CFString, limit: remaining) else { continue }
        if !children.complete { truncated = true }
        for child in children.values.reversed() { stack.append((child, depth + 1)) }
    }
    return (result, truncated)
}
let args = Array(CommandLine.arguments.dropFirst())
if !(args == ["inventory"] || (args.count == 5 && args[0] == "inspect")) {
    unavailable("invalid-request")
} else if !AXIsProcessTrusted() {
    // This query uses existing trust only. Never call AXIsProcessTrustedWithOptions or request permission.
    unavailable("permission-denied")
} else {
    _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.05)
    if args[0] == "inventory" {
        if let data = inventory() {
            emit(["health": "available", "reason": data.partial ? "window-mapping-unavailable" : NSNull(), "windows": data.windows.map { $0.identity }])
        } else { unavailable("native-reader-unavailable") }
    } else if allowed.contains(args[1]), let pid = Int32(args[2]), pid > 0,
              args[3].range(of: "^[0-9]{1,16}\\.[0-9]{6}$", options: .regularExpression) != nil,
              let number = UInt32(args[4]), number > 0 {
        if let before = inventory(), let target = before.windows.first(where: { $0.bundle == args[1] && $0.pid == pid && $0.start == args[3] && $0.number == number }) {
            let body = loadedText(target.element, pid: target.pid)
            if let after = inventory(), after.windows.contains(where: { $0.key == target.key }), inTime() {
                emit(["health": "available", "identity": target.identity, "text": body.text, "truncated": body.truncated])
            } else { unavailable("identity-unavailable") }
        } else { unavailable("identity-unavailable") }
    } else { unavailable("invalid-request") }
}
