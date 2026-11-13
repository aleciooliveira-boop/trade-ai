
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "GEMINI_API_KEY is missing in Vercel."
    });
  }

  try {
    const {
      tool,
      text = "",
      mimeType,
      fileBase64
    } = req.body || {};

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png"
    ];

    let prompt = "";

    if (tool === "Document Analyzer") {
      if (!fileBase64 || !allowedTypes.includes(mimeType)) {
        return res.status(400).json({
          error: "Upload a PDF, JPG or PNG document."
        });
      }

      if (fileBase64.length > 5500000) {
        return res.status(413).json({
          error: "File is too large. Maximum size is 4 MB."
        });
      }

      prompt = `Review this international trade document. Identify its type and extract visible fields: exporter, importer, invoice number, date, currency, goods, quantities, values, weights, packages, origin, Incoterms and transport details. Summarize it, identify missing information and possible inconsistencies, and list items to verify. Never invent information or claim legal certainty. ${text}`;

    } else if (tool === "Trade Translator") {
      prompt = `Translate into clear, professional English. Preserve names, numbers, dates, units and trade terms. If already in English, polish without changing meaning:\n\n${text}`;

    } else if (tool === "Email Assistant") {
      prompt = `Draft a concise, professional international trade email in English. Include a subject, greeting, body and closing. Do not invent facts:\n\n${text}`;

    } else if (tool === "Trade Checklist") {
      prompt = `Create a practical, grouped import/export checklist. Mark items dependent on country, product or transport mode for verification. Do not present it as legal advice:\n\n${text}`;

    } else {
      return res.status(400).json({ error: "Unknown tool." });
    }

    const parts = [{ text: prompt }];

    if (tool === "Document Analyzer") {
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: fileBase64
        }
      });
    }

    let upstream;

    try {
      upstream = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
          encodeURIComponent(apiKey),
        {
          method: "POST",
          signal: AbortSignal.timeout(55000),
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1800
            }
          })
        }
      );
    } catch (error) {
      console.error("Gemini connection error:", error);

      if (
        error.name === "TimeoutError" ||
        error.name === "AbortError"
      ) {
        return res.status(504).json({
          error: "The AI provider took too long to respond. Please try again."
        });
      }

      return res.status(502).json({
        error: "Could not connect to the AI provider."
      });
    }

    const responseText = await upstream.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      console.error("Invalid Gemini response:", responseText);
      return res.status(502).json({
        error: "The AI provider returned an invalid response."
      });
    }

    if (!upstream.ok) {
      console.error("Gemini API error:", upstream.status, result);
      return res.status(502).json({
        error: result?.error?.message || "AI provider error."
      });
    }

    const answer = result?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      console.error("Empty Gemini response:", result);
      return res.status(502).json({
        error: "AI returned an empty response."
      });
    }

    return res.status(200).json({ result: answer });

  } catch (error) {
    console.error("Trade AI server error:", error);
    return res.status(500).json({
      error: "Server error while processing your request."
    });
  }
}
