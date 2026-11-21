// PDF text extraction with Mozilla's pdf.js. Returns every text run, including text a human
// reader would not see (tiny or white), because the guard needs to see what the model sees.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfText(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  const tiny = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const size = Math.hypot(item.transform[0], item.transform[1]);
      if (size > 0 && size < 5 && item.str.trim()) tiny.push(item.str.trim());
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ""; }
    }
    if (line) lines.push(line);
  }
  await doc.destroy();
  return { text: lines.join("\n").replace(/[ \t]+\n/g, "\n").trim(), tinyText: tiny.join(" "), pages: doc.numPages };
}
