import { supabase } from "@/lib/supabase/client";

type ApiUsageCounterRow = {
  id: string;
  used: number;
  limit_total: number;
};

export function isFreeTariff(tariff?: string | null): boolean {
  return tariff == null || tariff === "free";
}

export async function assertFreeVisionAuditLimit(input: {
  userId?: string | null;
  telegramId: number;
}): Promise<
  | { allowed: true; counter: ApiUsageCounterRow }
  | { allowed: false; counter: ApiUsageCounterRow; reason: string }
> {
  const feature = "vision_audit";
  const scope = "lifetime";
  const periodKey = "lifetime";
  const limitTotal = 5;

  const { data: existing, error: selectError } = await supabase
    .from("api_usage_counters")
    .select("id, used, limit_total")
    .eq("telegram_id", input.telegramId)
    .eq("feature", feature)
    .eq("scope", scope)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to load api_usage_counters: ${selectError.message}`);
  }

  let counter = existing as ApiUsageCounterRow | null;

  if (!counter) {
    const { data: created, error: insertError } = await supabase
      .from("api_usage_counters")
      .insert({
        user_id: input.userId ?? null,
        telegram_id: input.telegramId,
        feature,
        scope,
        period_key: periodKey,
        used: 0,
        limit_total: limitTotal,
        metadata: {},
      })
      .select("id, used, limit_total")
      .single();

    if (insertError || !created) {
      throw new Error(`Failed to create api_usage_counters: ${insertError?.message ?? "unknown error"}`);
    }

    counter = created as ApiUsageCounterRow;
  }

  if (counter.used >= counter.limit_total) {
    return {
      allowed: false,
      counter,
      reason: `Usage limit reached for ${feature} (${counter.used}/${counter.limit_total}).`,
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("api_usage_counters")
    .update({
      used: counter.used + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", counter.id)
    .select("id, used, limit_total")
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to update api_usage_counters: ${updateError?.message ?? "unknown error"}`);
  }

  return { allowed: true, counter: updated as ApiUsageCounterRow };
}
