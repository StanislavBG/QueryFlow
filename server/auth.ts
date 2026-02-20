/**
 * RBAC middleware and helpers.
 *
 * Admin email: StanislavBG@gmail.com
 * All other users default to "user" role.
 */
import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { storage } from "./storage";
import type { AppUser } from "@shared/schema";

const ADMIN_EMAIL = "stanislavbg@gmail.com"; // lowercase for comparison

/**
 * Resolve the current Clerk user into an AppUser row, upserting on first visit.
 * Returns null if the request is unauthenticated.
 */
export async function resolveAppUser(req: Request): Promise<AppUser | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;

  // Check if already cached on the request
  if ((req as any).__appUser) return (req as any).__appUser;

  let appUser = await storage.getAppUserByClerkId(userId);

  if (!appUser) {
    // First time seeing this user — fetch email from Clerk
    let email = "";
    let displayName: string | undefined;
    try {
      const clerkUser = await clerkClient.users.getUser(userId);
      email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
      displayName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;
    } catch {
      // If Clerk is unavailable, we still create the record
    }

    const role = email.toLowerCase() === ADMIN_EMAIL ? "admin" : "user";
    appUser = await storage.upsertAppUser({ clerkId: userId, email, role, displayName });
  } else {
    // Touch last-active timestamp (fire and forget)
    storage.touchUserActivity(userId).catch(() => {});
  }

  (req as any).__appUser = appUser;
  return appUser;
}

/**
 * Express middleware that requires the caller to be an admin.
 * Returns 403 if not an admin, 401 if not authenticated.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  resolveAppUser(req)
    .then((user) => {
      if (!user) return res.status(401).json({ message: "Authentication required" });
      if (user.role !== "admin") return res.status(403).json({ message: "Admin access required" });
      next();
    })
    .catch((err) => {
      console.error("requireAdmin error:", err);
      res.status(500).json({ message: "Internal server error" });
    });
}

/**
 * Log a user activity event (fire-and-forget).
 */
export function logActivity(
  userId: string | null | undefined,
  action: string,
  resource?: string,
  resourceId?: number,
  metadata?: Record<string, unknown>
) {
  if (!userId) return;
  storage.logActivity({
    userId,
    action,
    resource: resource ?? null,
    resourceId: resourceId ?? null,
    metadata: metadata ?? {},
  }).catch((err) => console.error("Activity log error:", err));
}
