import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAdminExtensionsForTest,
  getAdminExtension,
  getAdminExtensions,
  registerAdminExtension,
} from "../registry";

const extension = {
  id: "customer-module",
  label: "Customer Module",
  load: async () => ({ default: () => null }),
};

describe("admin extension registry", () => {
  beforeEach(() => {
    clearAdminExtensionsForTest();
  });

  it("registers build-time extensions with stable defaults", () => {
    registerAdminExtension(extension);

    expect(getAdminExtension("customer-module")).toMatchObject({
      id: "customer-module",
      label: "Customer Module",
      navGroup: "integrations",
      proxyBasePath: "/api/extensions/customer-module",
    });
  });

  it("sorts extensions by label for navigation", () => {
    registerAdminExtension({ ...extension, id: "zeta", label: "Zeta" });
    registerAdminExtension({ ...extension, id: "alpha", label: "Alpha" });

    expect(getAdminExtensions().map((item) => item.id)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("rejects invalid and duplicate ids", () => {
    expect(() =>
      registerAdminExtension({ ...extension, id: "Symphony" }),
    ).toThrow(/lowercase/);

    registerAdminExtension(extension);
    expect(() => registerAdminExtension(extension)).toThrow(/already/);
  });
});
