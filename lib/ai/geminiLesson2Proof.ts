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

    const prompt = `Ты — строгий валидатор.
Твоя задача:
1. Кратко опиши (3-5 слов), что изображено на фото.
2. Если это личный кабинет VPN (видны кнопки 'Connected', 'Disconnect' или флаг страны) — верни {"is_valid": true, "reason": "описание"}.
3. Если это зарубежная карта (виден логотип банка, Visa/Mastercard, имя не на кириллице) — верни {"is_valid": true, "reason": "описание"}.
4. Иначе — {"is_valid": false, "reason": "описание"}.
Отвечай ТОЛЬКО чистым JSON.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: Buffer.from(imageBuffer).toString("base64"), mimeType } }
    ]);

    const text = result.response.text().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text) as { is_valid?: boolean; reason?: string };
    return {
      is_valid: Boolean(parsed.is_valid),
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (error: any) {
    console.error("--- ГЕМИНИ ФЕЙЛ:", error);
    if (error.response) console.error("--- ДЕТАЛИ ОТВЕТА:", JSON.stringify(error.response));
    return { is_valid: false, error: "api_error" };
  }
}