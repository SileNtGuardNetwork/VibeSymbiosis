import { GoogleGenerativeAI } from "@google/generative-ai";

const LESSON2_PROOF_PROMPT =
  'Это скриншот успешной регистрации в VPN или оплаты/выпуска зарубежной карты? Ответь строго в формате JSON: {is_valid: boolean, type: \'vpn\' | \'card\' | \'other\'}';

export type Lesson2ProofVerdict = {
  is_valid: boolean;
  type: "vpn" | "card" | "other";
};

function parseVerdict(raw: string): Lesson2ProofVerdict | null {
  const trimmed = raw.trim();
  const unwrapped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const tryParse = (s: string): Lesson2ProofVerdict | null => {
    try {
      const obj = JSON.parse(s) as unknown;
      if (!obj || typeof obj !== "object") return null;
      const o = obj as Record<string, unknown>;
      if (typeof o.is_valid !== "boolean") return null;
      const t = o.type;
      if (t !== "vpn" && t !== "card" && t !== "other") return null;
      return { is_valid: o.is_valid, type: t };
    } catch {
      return null;
    }
  };

  const brace = trimmed.match(/\{[\s\S]*\}/)?.[0];
  return tryParse(unwrapped) ?? (brace ? tryParse(brace) : null);
}

export async function analyzeLesson2Screenshot(input: {
  base64: string;
  mimeType: string;
}): Promise<
  | { ok: true; verdict: Lesson2ProofVerdict }
  | {
      ok: false;
      reason: "missing_api_key" | "api_unavailable" | "parse_failed" | "model_not_found_404";
    }
> {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Ключ начинается на:", apiKey?.slice(0, 4));

  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([
      LESSON2_PROOF_PROMPT,
      { inlineData: { mimeType: input.mimeType, data: input.base64 } },
    ]);
    const text = result.response.text();
    const verdict = parseVerdict(text);
    if (!verdict) {
      return { ok: false, reason: "parse_failed" };
    }
    return { ok: true, verdict };
  } catch (e) {
    console.error("[gemini] analyzeLesson2Screenshot full error:", e);
    const errorText =
      e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : JSON.stringify(e);
    if (errorText.includes("404")) {
      return { ok: false, reason: "model_not_found_404" };
    }
    if (e instanceof Error) {
      console.error("[gemini] message:", e.message);
      console.error("[gemini] stack:", e.stack);
    } else {
      console.error("[gemini] non-Error payload:", JSON.stringify(e));
    }
    return { ok: false, reason: "api_unavailable" };
  }
}

export function mimeTypeFromTelegramPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

