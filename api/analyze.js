export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "AI is not configured yet. Add GEMINI_API_KEY in the Vercel project environment variables." });

  try {
    const { tool, text = "", fileName, mimeType, fileBase64 } = req.body || {};
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    let prompt = "";

    if (tool === "Document Analyzer") {
      if (!fileBase64 || !allowedTypes.includes(mimeType)) {
        return res.status(400).json({ error: "Upload a PDF, JPG or PNG document." });
      }
      if (fileBase64.length > 5_500_000) return res.status(413).json({ error: "File is too large. Maximum size is 4 MB." });
      prompt = `You are Trade AI, an assistant for international trade documentation. Review the attached ${fileName || "document"}.
Identify the document type and extract visible key fields where possible: exporter/seller, importer/buyer, invoice number/date, currency, goods description, quantities, unit values, total value, weights, packages, country of origin, Incoterms, and transport details.
Then provide: (1) document summary, (2) missing or unreadable information, (3) possible inconsistencies within the document, (4) questions the user should verify against related documents, and (5) a clear disclaimer.
Do not invent missing values. Distinguish observed facts from possible issues. Do not claim legal, tariff classification, valuation, or customs compliance certainty. ${text ? "Additional user context: " + text : ""}`;
    } else if (tool === "Trade Translator") {
      prompt = `You are a professional international trade translator. Translate the following text into clear, professional English. Preserve names, numbers, dates, units, trade terms and document references. If already in English, polish it without changing meaning:\n\n${text}`;
    } else if (tool === "Email Assistant") {
      prompt = `You are an international trade business communication assistant. Draft a concise, professional email in English based on these instructions. Include a useful subject line, greeting, body and closing. Do not invent facts:\n\n${text}`;
    } else if (tool === "Trade Checklist") {
      prompt = `You are an international trade operations assistant. Create a practical, clearly grouped import/export checklist based on the user's context. Mark items that depend on country, product or transport mode as requiring verification. Do not present it as legal advice:\n\n${text}`;
    } else {
      return res.status(400).json({ error: "Unknown tool." });
    }

    const parts = [{ text: prompt }];
    if (tool === "Document Analyzer") {
      parts.push({ inline_data: { mime_type: mimeType, data: fileBase64 } });
    }

    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/:generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1800 }
        })
      }
    );
    const result = await upstream.json();
    if (!upstream.ok) {
      const message = result?.error?.message || "The AI provider returned an error.";
      return res.status(502).json({ error: message });
    }
    const answer = result?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n").trim();
    if (!answer) return res.status(502).json({ error: "The AI returned an empty response. Please try again." });
    return res.status(200).json({ result: answer });
  } catch (error) {
    return res.status(500).json({ error: "Server error while processing your request." });
  }
}
