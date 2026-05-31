import { describe, expect, it, vi } from "vitest";
import { createTaskQueue } from "../src/background/taskQueue";

describe("taskQueue", () => {
  it("runs queued tasks in order", async () => {
    const events: string[] = [];
    const queue = createTaskQueue(() => undefined);
    let releaseFirst!: () => void;

    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          events.push("first-start");
          releaseFirst = () => {
            events.push("first-end");
            resolve();
          };
        })
    );
    const second = queue.enqueue(async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    releaseFirst();

    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("reports rejected tasks and keeps the queue usable", async () => {
    const onError = vi.fn();
    const queue = createTaskQueue(onError);
    const error = new Error("boom");

    await expect(
      queue.enqueue(async () => {
        throw error;
      })
    ).rejects.toThrow("boom");

    await queue.enqueue(async () => undefined);

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("does not leak an unhandled rejection when a queued task is ignored", async () => {
    const onError = vi.fn();
    const queue = createTaskQueue(onError);
    const error = new Error("ignored boom");

    queue.enqueue(async () => {
      throw error;
    });

    await queue.enqueue(async () => undefined);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
