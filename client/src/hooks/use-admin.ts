import { useQuery } from "@tanstack/react-query";

// ─── Current User / Role ─────────────────────────────────────────────

export interface CurrentUser {
  authenticated: boolean;
  id?: number;
  clerkId?: string;
  email?: string;
  role?: string;
  displayName?: string | null;
  firstSeen?: string;
  lastActive?: string;
}

export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/me");
      if (!res.ok) return { authenticated: false };
      return res.json();
    },
    staleTime: 60_000,
  });
}

// ─── Admin: Users ─────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  clerkId: string;
  email: string;
  role: string;
  displayName: string | null;
  firstSeen: string;
  lastActive: string;
}

export function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });
}

// ─── Admin: Per-User Metrics ──────────────────────────────────────────

export interface UserMetrics {
  clerkId: string;
  totalEvents: number;
  byAction: Record<string, number>;
  dailyCounts: Record<string, number>;
}

export function useAdminUserMetrics(clerkId: string | null) {
  return useQuery<UserMetrics>({
    queryKey: ["admin", "user-metrics", clerkId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${clerkId}/metrics`);
      if (!res.ok) throw new Error("Failed to fetch user metrics");
      return res.json();
    },
    enabled: !!clerkId,
  });
}

// ─── Admin: Activity Feed ─────────────────────────────────────────────

export interface ActivityEvent {
  id: number;
  userId: string | null;
  action: string;
  resource: string | null;
  resourceId: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityFeed {
  events: ActivityEvent[];
  total: number;
}

export function useAdminActivity(limit = 200) {
  return useQuery<ActivityFeed>({
    queryKey: ["admin", "activity", limit],
    queryFn: async () => {
      const res = await fetch(`/api/admin/activity?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
  });
}

// ─── Admin: Adoption Dashboard ────────────────────────────────────────

export interface FeatureAdoption {
  action: string;
  uniqueUsers: number;
  totalUses: number;
  adoptionRate: number;
}

export interface AdoptionPerUser {
  clerkId: string;
  email: string;
  displayName: string | null;
  role: string;
  firstSeen: string;
  lastActive: string;
  totalActions: number;
}

export interface AdoptionData {
  totalUsers: number;
  totalEvents: number;
  features: FeatureAdoption[];
  perUser: AdoptionPerUser[];
  signupsByDay: Record<string, number>;
}

export function useAdminAdoption() {
  return useQuery<AdoptionData>({
    queryKey: ["admin", "adoption"],
    queryFn: async () => {
      const res = await fetch("/api/admin/adoption");
      if (!res.ok) throw new Error("Failed to fetch adoption data");
      return res.json();
    },
  });
}
