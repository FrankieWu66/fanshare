import { describe, it, expect, vi } from "vitest";
import { pushPriceHistoryEntry, PRICE_HISTORY_MAX } from "../app/lib/kv-history";

describe("pushPriceHistoryEntry", () => {
  it("returns null when KV is not configured", async () => {
    const fetchImpl = vi.fn();
    const res = await pushPriceHistoryEntry("k", "v", {
      kvUrl: undefined,
      kvToken: undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs a pipeline request containing RPUSH + LTRIM in one call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    await pushPriceHistoryEntry("price-history:devnet:Player_LD", '{"t":1,"p":2}', {
      kvUrl: "https://kv.example",
      kvToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://kv.example/pipeline");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual([
      ["RPUSH", "price-history:devnet:Player_LD", '{"t":1,"p":2}'],
      ["LTRIM", "price-history:devnet:Player_LD", `-${PRICE_HISTORY_MAX}`, "-1"],
    ]);
  });

  it("honours custom maxLen", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    await pushPriceHistoryEntry("k", "v", {
      kvUrl: "https://kv.example",
      kvToken: "token",
      maxLen: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body[1]).toEqual(["LTRIM", "k", "-100", "-1"]);
  });
});
