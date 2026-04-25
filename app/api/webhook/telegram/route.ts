import { NextResponse } from "next/server";
import { Bot } from "grammy";
import { supabase } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type BotInstance = Bot;

let botInstance: BotInstance | null = null;

function getBot(): BotInstance {
  if (botInstance) {
    return botInstance;
  }

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  const bot = new Bot(telegramToken);

  bot.command("start", async (ctx) => {
    try {
      const telegramId = ctx.from?.id;
      const username = ctx.from?.username ?? null;

      if (!telegramId) {
        return;
      }

      const { data: existingUser, error: userFetchError } = await supabase
        .from("users")
        .select("id")
        .eq("telegram_id", telegramId)
        .maybeSingle();

      if (userFetchError) {
        throw userFetchError;
      }

      let userId = existingUser?.id as string | undefined;

      if (!userId) {
        const { data: createdUser, error: userInsertError } = await supabase
          .from("users")
          .insert({
            telegram_id: telegramId,
            username,
            current_state: "start",
            tier: "free",
          })
          .select("id")
          .single();

        if (userInsertError) {
          throw userInsertError;
        }

        userId = createdUser.id;
      }

      const { data: firstLesson, error: progressFetchError } = await supabase
        .from("progress")
        .select("id")
        .eq("user_id", userId)
        .eq("lesson_number", 1)
        .maybeSingle();

      if (progressFetchError) {
        throw progressFetchError;
      }

      if (!firstLesson) {
        const deadlineAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const { error: progressInsertError } = await supabase.from("progress").insert({
          user_id: userId,
          lesson_number: 1,
          status: "pending",
          deadline_at: deadlineAt,
        });

        if (progressInsertError) {
          throw progressInsertError;
        }
      }

      await ctx.reply(
        "Привет! Ты здесь, чтобы научиться собирать сложные IT-продукты без кода, используя Vibe-coding.\n\n" +
          "Твои первые 3 урока — бесплатные. Но есть условие: на каждое ДЗ у тебя ровно 24 часа. Не успел — бот закроет доступ навсегда.\n\n" +
          "Твое время пошло. Твоя первая задача — сгенерировать интерфейс в браузере. Инструкция ниже... [Здесь пока оставим заглушку текста Урока 1]",
        { parse_mode: "HTML" },
      );
    } catch (error) {
      console.error("[telegram/start] handler failed:", error);
    }
  });

  botInstance = bot;
  return bot;
}

export async function POST(req: Request) {
  const bot = getBot();

  try {
    const update = await req.json();
    await bot.handleUpdate(update);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    // Всегда возвращаем 200, чтобы Телеграм не спамил нас повторами при ошибке
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
