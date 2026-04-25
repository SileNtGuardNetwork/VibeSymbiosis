import { GoogleGenerativeAI } from "@google/generative-ai";

export async function analyzeLesson4Link(text: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { is_valid: false, error: "missing_api_key" };

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
    });

    const prompt = `Пользователь прислал ссылку на свой лендинг: ${text}. Подбодри его, скажи что v0.dev — отличный выбор, и теперь его воронка готова к приему трафика. Верни JSON {"is_valid": true, "feedback": "твой текст"}.`;
    const result = await model.generateContent(prompt);
    const raw = result.response.text().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as { is_valid?: boolean; feedback?: string };

    return {
      is_valid: Boolean(parsed.is_valid),
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
    };
  } catch (error) {
    console.error("[lesson4] analyzeLesson4Link failed:", error);
    return { is_valid: false, error: "api_error" };
  }
}

