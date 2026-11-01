import { ForbiddenException } from "@nestjs/common";
import type { AuthContext } from "../auth/auth.types";

/**
 * Owner-only operations: merchant profile, API keys, and anything that changes
 * where money is routed (QRIS upload / replace / archive).
 * API-key callers are treated as OWNER by ApiKeyOrSessionGuard, but the guarded
 * controllers below are session-only, so this only restricts STAFF users.
 */
export function assertOwner(ctx: AuthContext): void {
  if (ctx.role !== "OWNER") {
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Only the merchant owner can do this.",
    });
  }
}
