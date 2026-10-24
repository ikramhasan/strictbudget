import { beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyStorage } from "./legacy-storage";

describe("migrateLegacyStorage", () => {
  beforeEach(() => localStorage.clear());

  it("moves keys saved under the former name", () => {
    localStorage.setItem("everycent:sidebar-width", "280");
    localStorage.setItem("everycent.assignTab", "auto");
    localStorage.setItem("react-resizable-panels:everycent:budget-inspector", "[60,40]");
    localStorage.setItem("theme", "dark");
    migrateLegacyStorage();
    expect(localStorage.getItem("strictbudget:sidebar-width")).toBe("280");
    expect(localStorage.getItem("strictbudget.assignTab")).toBe("auto");
    expect(localStorage.getItem("react-resizable-panels:strictbudget:budget-inspector")).toBe(
      "[60,40]",
    );
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("everycent:sidebar-width")).toBeNull();
    expect(localStorage.length).toBe(4);
  });

  it("keeps a value already saved under the new name", () => {
    localStorage.setItem("everycent:progress-bars", "off");
    localStorage.setItem("strictbudget:progress-bars", "on");
    migrateLegacyStorage();
    expect(localStorage.getItem("strictbudget:progress-bars")).toBe("on");
    expect(localStorage.getItem("everycent:progress-bars")).toBeNull();
  });
});
