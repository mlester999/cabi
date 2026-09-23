import { describe, expect, it } from "vitest";
import { bondFromPoints } from "@/lib/bond";

describe("bond progression", () => {
  it("is bounded and friendly", () => {
    expect(bondFromPoints(-10)).toMatchObject({ level: 1, label: "Stranger", progress: 0 });
    expect(bondFromPoints(72).level).toBe(3);
    expect(bondFromPoints(100000)).toMatchObject({ level: 10, label: "Forever CPU", progress: 100 });
  });
});
