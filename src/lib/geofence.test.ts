import { describe, expect, it } from "vitest";
import { shouldPrompt, withinRadius } from "./geofence";

const farm = { lat: 37.6, lng: 126.77 };

describe("geofence", () => {
  it("radius check in meters", () => {
    expect(withinRadius({ lat: 37.6009, lng: 126.77 }, farm, 200)).toBe(true); // 약 100m
    expect(withinRadius({ lat: 37.603, lng: 126.77 }, farm, 200)).toBe(false); // 약 330m
  });

  it("prompts once a day only inside and without my log", () => {
    const base = { today: "2026-10-01", lastShownOn: null, inside: true, hasMyLogToday: false };
    expect(shouldPrompt(base)).toBe(true);
    expect(shouldPrompt({ ...base, inside: false })).toBe(false);
    expect(shouldPrompt({ ...base, hasMyLogToday: true })).toBe(false);
    expect(shouldPrompt({ ...base, lastShownOn: "2026-10-01" })).toBe(false);
    expect(shouldPrompt({ ...base, lastShownOn: "2026-09-30" })).toBe(true);
  });
});
