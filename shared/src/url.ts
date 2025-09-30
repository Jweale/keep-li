const TRACKING_PARAMS = [/^utm_/i, /^li_/i, /^trk$/i, /^tracking$/i];

export function canonicaliseUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    const params = url.searchParams;
    TRACKING_PARAMS.forEach((pattern) => {
      for (const key of Array.from(params.keys())) {
        if (pattern.test(key)) {
          params.delete(key);
        }
      }
    });
    url.search = params.toString();
    return url.toString();
  } catch {
    return input;
  }
}

export async function computeUrlHash(url: string): Promise<string> {
  const canonical = canonicaliseUrl(url);

  const webCrypto = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;

  if (webCrypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const digest = await webCrypto.subtle.digest("SHA-1", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
