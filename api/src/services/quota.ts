import type { KeyValueNamespace } from "@keep-li/shared";

type QuotaKeyParts = {
  scope: "license" | "user";
  identifier: string;
};

type QuotaRecord = {
  count: number;
};

export type QuotaCheckResult = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function incrementDailyQuota(
  kv: KeyValueNamespace,
  parts: QuotaKeyParts,
  limit: number
): Promise<QuotaCheckResult> {
  if (limit <= 0) {
    return {
      allowed: false,
      count: limit,
      limit,
      remaining: 0
    };
  }

  const key = createQuotaKey(parts);
  const existing = (await kv.get(key, "json")) as QuotaRecord | null;
  const currentCount = existing?.count ?? 0;
  if (currentCount >= limit) {
    return {
      allowed: false,
      count: currentCount,
      limit,
      remaining: 0
    };
  }

  const nextCount = currentCount + 1;
  const expiration = getEndOfDayEpoch();
  await kv.put(key, JSON.stringify({ count: nextCount } satisfies QuotaRecord), {
    expiration
  });

  return {
    allowed: true,
    count: nextCount,
    limit,
    remaining: Math.max(limit - nextCount, 0)
  };
}

function createQuotaKey(parts: QuotaKeyParts): string {
  return ["quota", parts.scope, parts.identifier, getCurrentDateKey()].join(":");
}

function getCurrentDateKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function getEndOfDayEpoch(): number {
  const now = new Date();
  const midnight = new Date(now.getTime() + MS_PER_DAY);
  midnight.setUTCHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}
