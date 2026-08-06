import { describe, expect, it, vi } from "vitest";

const OWNER = "0x1111111111111111111111111111111111111111";

describe("activity API service", () => {
  it("loads one normalized wallet page from durable storage", async () => {
    const module = await import("../lib/activity-route").catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const page = { entries: [], page: 2, pageSize: 5, total: 6, totalPages: 2 };
    const repository = { append: vi.fn(), listByOwner: vi.fn().mockResolvedValue(page) };

    await expect(
      module.loadWalletActivity(OWNER.toUpperCase(), 2, repository),
    ).resolves.toEqual(page);
    expect(repository.listByOwner).toHaveBeenCalledWith(OWNER, 2, 5);
  });

  it("rejects invalid wallet filters before querying storage", async () => {
    const module = await import("../lib/activity-route").catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const repository = { append: vi.fn(), listByOwner: vi.fn() };

    await expect(
      module.loadWalletActivity("not-a-wallet", 1, repository),
    ).rejects.toThrow(/valid owner/i);
    expect(repository.listByOwner).not.toHaveBeenCalled();
  });
});
