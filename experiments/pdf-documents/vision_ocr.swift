import Foundation
import Vision
import ImageIO

// JSON lines in and out; all recognition stays on this Mac.
while let line = readLine() {
    autoreleasepool {
        var result: [String: Any] = [:]
        do {
            let input = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
            result["id"] = input["id"]
            let url = URL(fileURLWithPath: input["path"] as! String)
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                throw NSError(domain: "image", code: 1)
            }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["zh-Hans", "en-US"]
            request.usesLanguageCorrection = false
            request.minimumTextHeight = 0.005
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            try handler.perform([request])
            var rows: [[String: Any]] = []
            for observation in request.results ?? [] {
                guard let candidate = observation.topCandidates(1).first else { continue }
                let box = observation.boundingBox
                rows.append(["text": candidate.string, "confidence": candidate.confidence,
                             "bbox": [box.minX, 1-box.maxY, box.maxX, 1-box.minY]])
            }
            result["lines"] = rows
            result["width"] = image.width
            result["height"] = image.height
        } catch {
            result["error"] = String(describing: error)
        }
        let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        fflush(stdout)
    }
}
