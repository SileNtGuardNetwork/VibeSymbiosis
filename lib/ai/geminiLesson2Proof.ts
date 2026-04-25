import { GoogleGenerativeAI } from "@google/generative-ai";

export async function analyzeLesson2Screenshot(imageBuffer: Buffer, mimeType: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { is_valid: false, error: "missing_api_key" };

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Используем ТОЧНОЕ название модели, которое заработало у тебя в тестах
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview"
    });

    const prompt = `Ты — ассистент курса. Проанализируй изображение.
    - Если это скриншот личного кабинета VPN — верни {"is_valid": true, "type": "vpn"}
    - Если это зарубежная банковская карта — верни {"is_valid": true, "type": "card"}
    - Иначе — верни {"is_valid": false, "type": "other"}
    Отвечай ТОЛЬКО чистым JSON.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: imageBuffer.toString("base64"), mimeType } }
    ]);

    const text = result.response.text().replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (error: any) {
    console.error("[gemini] Error:", error.message);
    return { is_valid: false, error: "api_error" };
  }
}