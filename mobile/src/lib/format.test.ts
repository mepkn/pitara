import { describe, expect, it } from "vitest";
import { relativeTime } from "./format";

const now = 1_800_000_000_000;
const ago = (ms: number) => relativeTime(now - ms, now);
const MIN = 60_000;
const DAY = 86_400_000;

describe("relativeTime", () => {
  it("reads naturally at each scale", () => {
    expect(ago(10_000)).toBe("just now");
    expect(ago(5 * MIN)).toBe("5 min ago");
    expect(ago(3 * 60 * MIN)).toBe("3 h ago");
    expect(ago(30 * 60 * MIN)).toBe("yesterday");
    expect(ago(4 * DAY)).toBe("4 days ago");
    expect(ago(14 * DAY)).toBe("2 weeks ago");
    expect(ago(60 * DAY)).toBe("2 months ago");
    expect(ago(800 * DAY)).toBe("2 years ago");
  });
  it("treats a clock-skewed future time as just now", () => expect(relativeTime(now + 5 * MIN, now)).toBe("just now"));
});
