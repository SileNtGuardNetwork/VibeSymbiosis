import { GoogleGenerativeAI } from "@google/generative-ai";

export async function analyzeLesson2Screenshot(imageBuffer: Buffer, mimeType: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { is_valid: false, error: "missing_api_key" };

  try {
    console.log("--- СТАДИЯ 3: Отправляю в Gemini 3...");
    console.log("--- МИМ-ТИП:", mimeType);
    console.log("--- КЛЮЧ ЕСТЬ:", !!apiKey);
    const genAI = new GoogleGenerativeAI(apiKey);
    // Используем ТОЧНОЕ название модели, которое заработало у тебя в тестах
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview"
    });

    const prompt =
      "Ты — робот-валидатор. Проверь картинку. Если это VPN или Карта — напиши ТОЛЬКО слово VALID. Если нет — слово INVALID.";

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: Buffer.from(imageBuffer).toString("base64"), mimeType } }
    ]);

    const text = result.response.text().trim().toUpperCase();
    if (text.includes("VALID")) {
      return { is_valid: true, type: "vpn" as const };
    }
    return { is_valid: false, type: "other" as const };
  } catch (error: any) {
    console.error("--- ГЕМИНИ ФЕЙЛ:", error);
    if (error.response) console.error("--- ДЕТАЛИ ОТВЕТА:", JSON.stringify(error.response));
    return { is_valid: false, error: "api_error" };
  }
}