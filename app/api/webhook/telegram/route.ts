import { Bot } from "grammy";
import { NextResponse } from "next/server";
import { analyzeLesson2Screenshot } from "@/lib/ai/geminiLesson2Proof";
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

    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) throw userErr;

    let lesson1: { id: string; deadline_at: string } | null = null;
    if (user?.id) {
      const { data: row, error: progErr } = await supabase
        .from("progress")
        .select("id, deadline_at")
        .eq("user_id", user.id)
        .eq("lesson_number", 1)
        .eq("status", "pending")
        .maybeSingle();
      if (progErr) throw progErr;
      lesson1 = row;
    }

    if (!text.toLowerCase().includes("http")) {
      await ctx.reply("Пришли ссылку на свой проект v0.dev, чтобы открыть следующий урок.");
      return;
    }

    if (!user?.id) {
      await ctx.reply("Сначала нажми /start, чтобы начать.");
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
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!user?.id) {
      await ctx.reply("Сначала нажми /start.");
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
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      throw new Error(`Telegram file download failed: ${fileRes.status}`);
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const mimeType = mimeTypeFromTelegramPath(file.file_path);

    const gemini = await analyzeLesson2Screenshot(buffer, mimeType);
    if (!gemini?.is_valid) {
      const msg =
        gemini?.error === "missing_api_key"
          ? "Проверка скринов настроена не полностью. Обратись к администратору."
          : gemini?.error === "model_not_found"
            ? "Ошибка 404: Модель не найдена. Проверь регион Vercel"
            : "Сервис проверки временно недоступен. Попробуй отправить скрин ещё раз чуть позже.";
      await ctx.reply(msg);
      return;
    }

    const verdictType = gemini.type as "vpn" | "card" | "other";
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
    console.error("[message:photo]", e);
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
    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
    if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const update = await req.json();

    if (!bot.isInited()) {
      await bot.init();
    }

    await bot.handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 200 });
  }
}
