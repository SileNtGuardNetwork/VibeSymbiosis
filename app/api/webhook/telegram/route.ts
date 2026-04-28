import { Bot } from "grammy";
import { NextResponse } from "next/server";
import { analyzeLesson2Screenshot } from "@/lib/ai/geminiLesson2Proof";
import { analyzeLesson3Text } from "@/lib/ai/geminiLesson3Offer";
import { analyzeLesson4Link } from "@/lib/ai/geminiLesson4Link";
import { assertFreeVisionAuditLimit, isFreeTariff } from "@/lib/safeops/vision-limit";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

const bot = new Bot(token);
console.log("Vercel Region:", process.env.VERCEL_REGION);

function mimeTypeFromTelegramPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

bot.command("start", async (ctx) => {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: user, error: userError } = await supabase
      .from("users")
      .upsert(
        {
          telegram_id: telegramId,
          username: ctx.from?.username || "unknown",
          current_state: "start",
          tier: "free",
        },
        { onConflict: "telegram_id" },
      )
      .select()
      .single();

    if (userError) throw userError;

    if (user) {
      const { error: progressError } = await supabase.from("progress").upsert(
        {
          user_id: user.id,
          lesson_number: 1,
          status: "pending",
          deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "user_id,lesson_number" },
      );
      if (progressError) throw progressError;
    }

    await ctx.reply(
      "🚀 <b>Добро пожаловать в Симбиоз!</b>\n\nТвое задание №1: Создай дизайн SaaS на <b>v0.dev</b> и пришли ссылку.",
      { parse_mode: "HTML" },
    );
  } catch (e) {
    console.error(e);
  }
});

bot.on("message:text", async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;

    console.log("--- ПОЛУЧЕН ТЕКСТ:", ctx.message.text);

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, current_lesson")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!user?.id) {
      await ctx.reply("Сначала нажми /start, чтобы начать.");
      return;
    }

    const currentLesson = Number(user.current_lesson ?? 1);
    console.log("--- ТЕКУЩИЙ УРОК ИЗ БАЗЫ:", currentLesson);

    // Урок 3: принимаем текст оффера и оцениваем через Gemini.
    if (currentLesson === 3) {
      const { data: lesson3, error: lesson3Err } = await supabase
        .from("progress")
        .select("id, deadline_at")
        .eq("user_id", user.id)
        .eq("lesson_number", 3)
        .eq("status", "pending")
        .maybeSingle();

      if (lesson3Err) throw lesson3Err;
      if (!lesson3) {
        await ctx.reply("Нет активного задания урока 3. Напиши /start или следуй подсказкам бота.");
        return;
      }
      try {
        const deadlineMs = new Date(lesson3.deadline_at).getTime();
        if (Number.isNaN(deadlineMs) || Date.now() > deadlineMs) {
          const { error: failErr } = await supabase
            .from("progress")
            .update({ status: "failed" })
            .eq("id", lesson3.id);
          if (failErr) throw failErr;
          await ctx.reply("Время вышло");
          return;
        }

        const aiResult = await analyzeLesson3Text(text);
        if (aiResult.error) {
          await ctx.reply("Сервис проверки оффера временно недоступен. Попробуй ещё раз чуть позже.");
          return;
        }

        if (!aiResult.is_valid) {
          await ctx.reply(
            `Оффер пока сырой. ${aiResult.feedback || "Добавь четкую выгоду и боль клиента."}`,
          );
          return;
        }

        const { error: lesson3SubmitErr } = await supabase
          .from("progress")
          .update({ status: "submitted" })
          .eq("id", lesson3.id);
        if (lesson3SubmitErr) throw lesson3SubmitErr;

        const lesson4Deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const { error: lesson4Err } = await supabase.from("progress").upsert(
          {
            user_id: user.id,
            lesson_number: 4,
            status: "pending",
            deadline_at: lesson4Deadline,
          },
          { onConflict: "user_id,lesson_number" },
        );
        if (lesson4Err) throw lesson4Err;

        const { error: userLessonErr } = await supabase
          .from("users")
          .update({ current_lesson: 4 })
          .eq("id", user.id);
        if (userLessonErr) throw userLessonErr;

        await ctx.reply(
          "🔥 Оффер — пушка! Мы в финале. Урок 4: Сборка воронки. Пришли мне ссылку на свой проект в v0.dev. Я проверю, чтобы верстка и смыслы соответствовали твоему Манифесту.",
        );
        return;
      } catch (err) {
        console.error("!!! КРИТИЧЕСКАЯ ОШИБКА В УРОКЕ 3:", err);
        throw err;
      }
    }

    if (currentLesson === 1) {
      let lesson1: { id: string; deadline_at: string } | null = null;
      const { data: row, error: progErr } = await supabase
        .from("progress")
        .select("id, deadline_at")
        .eq("user_id", user.id)
        .eq("lesson_number", 1)
        .eq("status", "pending")
        .maybeSingle();
      if (progErr) throw progErr;
      lesson1 = row;

      if (!text.toLowerCase().includes("http")) {
        await ctx.reply("Пришли ссылку на свой проект v0.dev, чтобы открыть следующий урок.");
        return;
      }

      if (!lesson1) {
        await ctx.reply(
          "Сейчас нет активного задания урока 1. Если ты уже сдал ссылку, следуй инструкциям для урока 2.",
        );
        return;
      }

      const deadlineMs = new Date(lesson1.deadline_at).getTime();
      const overdue = Number.isNaN(deadlineMs) || Date.now() > deadlineMs;

      if (overdue) {
        const { error: failErr } = await supabase
          .from("progress")
          .update({ status: "failed" })
          .eq("id", lesson1.id);
        if (failErr) throw failErr;
        await ctx.reply("Время вышло");
        return;
      }

      const { error: updateErr } = await supabase
        .from("progress")
        .update({ status: "submitted", homework_url: text })
        .eq("id", lesson1.id);
      if (updateErr) throw updateErr;

      const { error: userL2Err } = await supabase
        .from("users")
        .update({ current_lesson: 2 })
        .eq("id", user.id);
      if (userL2Err) throw userL2Err;

      const vpnLink = process.env.VPN_REF_LINK ?? "";
      const cardLink = process.env.CARD_REF_LINK ?? "";

      await ctx.reply(
        "🔥 Принято! Урок 2: Инфраструктура. Для работы тебе нужны: " +
          `1. VPN (${vpnLink}), ` +
          `2. Зарубежная карта (${cardLink}), ` +
          "3. Чистый Google-аккаунт. Пришли скрины регистраций!",
      );

      const lesson2Deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { error: lesson2Err } = await supabase.from("progress").upsert(
        {
          user_id: user.id,
          lesson_number: 2,
          status: "pending",
          deadline_at: lesson2Deadline,
        },
        { onConflict: "user_id,lesson_number" },
      );
      if (lesson2Err) throw lesson2Err;
      return;
    }

    if (currentLesson === 2) {
      await ctx.reply(
        "Сейчас урок 2 — пришли скриншоты VPN и карты (фото), текст на этом шаге не принимается.",
      );
      return;
    }

    if (currentLesson === 4) {
      const normalized = text.toLowerCase();
      const hasV0ProjectLink =
        normalized.includes("v0.dev/chat/") || normalized.includes("v0.dev/design/");
      if (!hasV0ProjectLink) {
        await ctx.reply("Для завершения курса пришли ссылку на свой лендинг в v0.dev");
        return;
      }

      const lesson4Result = await analyzeLesson4Link(text);
      if (lesson4Result.error) {
        await ctx.reply("Сервис проверки ссылки временно недоступен. Попробуй ещё раз позже.");
        return;
      }

      if (!lesson4Result.is_valid) {
        await ctx.reply("Для завершения курса пришли ссылку на свой лендинг в v0.dev");
        return;
      }

      await ctx.reply(
        lesson4Result.feedback || "Крутой дизайн! Воронка готова к запуску.",
      );
      return;
    }

    await ctx.reply("Следуй текущему шагу курса или нажми /start.");
  } catch (e) {
    console.error(e);
  }
});

bot.on("message:photo", async (ctx) => {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, current_lesson, tier")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!user?.id) {
      await ctx.reply("Сначала нажми /start.");
      return;
    }

    const photoLesson = Number(user.current_lesson ?? 1);
    if (photoLesson !== 2) {
      await ctx.reply("Скрины принимаются только на уроке 2. Следуй текущему шагу курса.");
      return;
    }

    const { data: lesson2, error: l2Err } = await supabase
      .from("progress")
      .select("id, deadline_at, vpn_proof_verified, card_proof_verified, status")
      .eq("user_id", user.id)
      .eq("lesson_number", 2)
      .eq("status", "pending")
      .maybeSingle();

    if (l2Err) throw l2Err;
    if (!lesson2) {
      await ctx.reply("Скрины для урока 2 сейчас не принимаются. Следуй текущему шагу задания.");
      return;
    }

    const deadlineMs = new Date(lesson2.deadline_at).getTime();
    if (Number.isNaN(deadlineMs) || Date.now() > deadlineMs) {
      await supabase.from("progress").update({ status: "failed" }).eq("id", lesson2.id);
      await ctx.reply("Время вышло");
      return;
    }

    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const file = await ctx.api.getFile(largest.file_id);
    if (!file.file_path) {
      throw new Error("Telegram file_path missing");
    }

    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is not set before file download");
    }

    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    console.log("Telegram file URL:", fileUrl);
    console.log("--- СТАДИЯ 1: Качаю файл...");
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error("Ошибка скачивания: " + fileRes.status);
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log("--- СТАДИЯ 2: Файл в памяти, размер:", buffer.length);
    const mimeType = mimeTypeFromTelegramPath(file.file_path);

    if (isFreeTariff(user.tier)) {
      const limitResult = await assertFreeVisionAuditLimit({
        userId: user.id,
        telegramId,
      });

      if (!limitResult.allowed) {
        await ctx.reply(
          "Лимит бесплатных AI-проверок исчерпан. В Free доступно 5 проверок. Дальше — Pro.",
        );
        return;
      }
    }

    const aiResponse = await analyzeLesson2Screenshot(buffer, mimeType);
    console.log("--- ОТВЕТ ГЕМИНИ:", aiResponse);
    if (aiResponse?.error) {
      const msg =
        aiResponse?.error === "missing_api_key"
          ? "Проверка скринов настроена не полностью. Обратись к администратору."
          : aiResponse?.error === "model_not_found"
            ? "Ошибка 404: Модель не найдена. Проверь регион Vercel"
            : "Сервис проверки временно недоступен. Попробуй отправить скрин ещё раз чуть позже.";
      await ctx.reply(msg);
      return;
    }
    if (!aiResponse?.is_valid) {
      const reason = String(aiResponse?.reason ?? "непонятный объект");
      await ctx.reply(
        `Упс! ИИ увидел на фото: ${reason}. Это не похоже на скриншот VPN или карты. Попробуй еще раз!`,
      );
      return;
    }

    const reasonText = String(aiResponse.reason ?? "").toLowerCase();
    const verdictType: "vpn" | "card" | "other" = reasonText.includes("vpn")
      ? "vpn"
      : reasonText.includes("visa") ||
          reasonText.includes("mastercard") ||
          reasonText.includes("card") ||
          reasonText.includes("карта")
        ? "card"
        : "other";
    if (verdictType === "other") {
      await ctx.reply(
        "Скрин не прошёл проверку. Пришли чёткий скрин успешной регистрации в VPN или оплаты/выпуска зарубежной карты.",
      );
      return;
    }

    const vpnDone = Boolean(lesson2.vpn_proof_verified);
    const cardDone = Boolean(lesson2.card_proof_verified);

    if (verdictType === "vpn" && vpnDone) {
      await ctx.reply("VPN уже засчитан. Пришли скрин по карте, если ещё не отправлял.");
      return;
    }
    if (verdictType === "card" && cardDone) {
      await ctx.reply("Карта уже засчитана. Пришли скрин по VPN, если ещё не отправлял.");
      return;
    }

    const nextVpn = verdictType === "vpn" ? true : vpnDone;
    const nextCard = verdictType === "card" ? true : cardDone;

    const { error: updErr } = await supabase
      .from("progress")
      .update({
        vpn_proof_verified: nextVpn,
        card_proof_verified: nextCard,
      })
      .eq("id", lesson2.id);

    if (updErr) throw updErr;

    if (nextVpn && nextCard) {
      await supabase.from("progress").update({ status: "submitted" }).eq("id", lesson2.id);

      const lesson3Deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { error: l3Err } = await supabase.from("progress").upsert(
        {
          user_id: user.id,
          lesson_number: 3,
          status: "pending",
          deadline_at: lesson3Deadline,
        },
        { onConflict: "user_id,lesson_number" },
      );
      if (l3Err) throw l3Err;

      const { error: userL3Err } = await supabase
        .from("users")
        .update({ current_lesson: 3 })
        .eq("id", user.id);
      if (userL3Err) throw userL3Err;

      await ctx.reply(
        "🔥 Оба скрина приняты! Урок 3 открыт. (Текст урока 3 — заглушка, добавим позже.)",
      );
      return;
    }

    if (verdictType === "vpn") {
      await ctx.reply("VPN подтверждён! Пришли скрин по зарубежной карте (оплата или выпуск).");
    } else {
      await ctx.reply("Карта подтверждена! Пришли скрин успешной регистрации в VPN.");
    }
  } catch (e) {
    console.error("ПОЛНАЯ ОШИБКА:", e);
    try {
      await ctx.reply(
        "Сервис проверки временно недоступен. Попробуй отправить скрин ещё раз чуть позже.",
      );
    } catch {
      /* ignore */
    }
  }
});

export async function POST(req: Request) {
  try {
    console.log("=== НОВЫЙ ЗАПРОС ОТ TELEGRAM ===");
    const body = await req.json();
    console.log("BODY:", JSON.stringify(body, null, 2));

    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
    if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!bot.isInited()) {
      await bot.init();
    }

    await bot.handleUpdate(body);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}
