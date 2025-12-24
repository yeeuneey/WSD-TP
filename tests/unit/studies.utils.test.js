const {
  parseId,
  parsePagination,
  validateMemberStatus,
} = require("../../src/modules/studies/studies.routes");

describe("Study route helpers", () => {
  it("parses numeric ids and rejects invalid ones", () => {
    expect(parseId("5", "study")).toBe(5);
    expect(() => parseId(undefined, "study")).toThrow();
    expect(() => parseId("not-a-number", "study")).toThrow();
  });

  it("normalizes pagination with bounds", () => {
    expect(parsePagination()).toEqual(
      expect.objectContaining({ page: 1, pageSize: 10, skip: 0, take: 10 }),
    );

    expect(parsePagination("2", "5")).toEqual(
      expect.objectContaining({ page: 2, pageSize: 5, skip: 5, take: 5 }),
    );

    expect(parsePagination("-1", "100")).toEqual(
      expect.objectContaining({ page: 1, pageSize: 50 }),
    );
  });

  it("validates member status", () => {
    expect(validateMemberStatus("APPROVED")).toBe("APPROVED");
    expect(validateMemberStatus("PENDING")).toBe("PENDING");
    expect(() => validateMemberStatus("UNKNOWN")).toThrow();
  });
});
