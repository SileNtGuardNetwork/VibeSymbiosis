import { GoogleGenerativeAI } from "@google/generative-ai";

export async function analyzeLesson3Text(text: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { is_valid: false, feedback: "", error: "missing_api_key" };

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
    });

    const prompt = `Ты — эксперт по продажам. Проанализируй оффер пользователя: ${text}.
Если в тексте есть четкая выгода и решение боли — верни {"is_valid": true, "feedback": "похвала"}.
Если текст слабый — верни {"is_valid": false, "feedback": "совет, что дожать"}.
Отвечай ТОЛЬКО JSON.`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as { is_valid?: boolean; feedback?: string };

    return {
      is_valid: Boolean(parsed.is_valid),
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
    };
  } catch (error) {
    console.error("[lesson3] analyzeLesson3Text failed:", error);
    return { is_valid: false, feedback: "", error: "api_error" };
  }
}

