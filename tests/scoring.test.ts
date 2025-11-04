import demo from "@/lib/demo/nvda.json";
import { scoreCompany } from "@/lib/scoring";

describe("十倍股快篩 - NVDA Demo", () => {
  it("should score and return required fields", () => {
    const res = scoreCompany(demo as any);
    expect(res).toHaveProperty("total_score");
    expect(res).toHaveProperty("rating");
    expect(res.rules).toBeTruthy();
    expect(typeof res.total_score).toBe("number");
  });
});
