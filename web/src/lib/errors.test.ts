import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { authErrorMessage, errorCode, errorMessage } from "./errors";
import { strings } from "./strings";

const CODES = [
  "notAuthenticated", "notAllowed", "notFound", "invalidUrl", "tooLong", "limitReached", "invalidName",
  "invalidParent", "duplicate", "inTrash", "notInTrash", "tooManyRequests", "badRequest",
];

describe("errorMessage", () => {
  it("has a message for every backend error code", () => {
    for (const code of CODES) expect(errorMessage(new ConvexError(code))).toBe(strings.errors[code]);
    for (const code of CODES) expect(strings.errors[code]).toBeTruthy();
  });
  it("falls back for unknown codes and plain errors", () => {
    expect(errorMessage(new ConvexError("weird"))).toBe(strings.somethingWentWrong);
    expect(errorMessage(new Error("boom"))).toBe(strings.somethingWentWrong);
    expect(errorCode(new Error("x"))).toBeUndefined();
  });
});

describe("authErrorMessage", () => {
  it("maps Convex Auth failures", () => {
    expect(authErrorMessage(new Error("InvalidSecret"), "signIn")).toBe(strings.errors.invalidCredentials);
    expect(authErrorMessage(new Error("Account already exists"), "signUp")).toBe(strings.errors.accountExists);
    expect(authErrorMessage(new Error("Server Error"), "verify")).toBe(strings.errors.invalidCode);
    expect(authErrorMessage(new ConvexError("notAllowed"), "signUp")).toBe(strings.errors.notAllowed);
  });
});
