import { useState, useMemo } from "react";
import {
  useAdminUsers,
  useAdminActivity,
  useAdminAdoption,
  useAdminUserMetrics,
  type AdminUser,
} from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Users,
  Activity,
  BarChart3,
  ArrowLeft,
  Loader2,
  Search,
  Code,
  Sparkles,
  MessageSquare,
  Database,
  FileCode2,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";

// Friendly labels for action types
const ACTION_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  "query.create": { label: "Query Created", icon: FileCode2, color: "text-blue-500" },
  "query.analyze": { label: "Query Analyzed", icon: Sparkles, color: "text-purple-500" },
  "format.run": { label: "Format Run", icon: Code, color: "text-green-500" },
  "schema.upload": { label: "Schema Uploaded", icon: Database, color: "text-orange-500" },
  "chat.ask": { label: "Chat Question", icon: MessageSquare, color: "text-cyan-500" },
};

function getActionMeta(action: string) {
  return ACTION_LABELS[action] || { label: action, icon: Zap, color: "text-muted-foreground" };
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Activity Feed Tab ───────────────────────────────────────────────

function ActivityFeedPanel() {
  const { data, isLoading } = useAdminActivity(300);
  const { data: users } = useAdminUsers();
  const userMap = useMemo(() => {
    const m = new Map<string, AdminUser>();
    for (const u of users ?? []) m.set(u.clerkId, u);
    return m;
  }, [users]);

  if (isLoading) return <LoadingState />;
  if (!data) return <EmptyState message="No activity data" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
        <Badge variant="secondary" className="text-xs">{data.total} total events</Badge>
      </div>
      <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
        {data.events.map((event) => {
          const meta = getActionMeta(event.action);
          const Icon = meta.icon;
          const user = event.userId ? userMap.get(event.userId) : null;
          return (
            <div
              key={event.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent/50 transition-colors"
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${meta.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{meta.label}</span>
                  {event.resourceId && (
                    <span className="text-[10px] text-muted-foreground">#{event.resourceId}</span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground truncate block">
                  {user?.email || user?.displayName || event.userId?.slice(0, 12) || "anonymous"}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {timeAgo(event.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Adoption Center Tab ─────────────────────────────────────────────

function AdoptionPanel() {
  const { data, isLoading } = useAdminAdoption();

  if (isLoading) return <LoadingState />;
  if (!data) return <EmptyState message="No adoption data" />;

  // Sort features by total uses descending
  const sortedFeatures = [...data.features].sort((a, b) => b.totalUses - a.totalUses);

  // Compute daily signups for display
  const signupDays = Object.entries(data.signupsByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14); // last 14 days

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalEvents}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Features Tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.features.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Feature adoption breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Feature Adoption</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sortedFeatures.map((f) => {
            const meta = getActionMeta(f.action);
            const Icon = meta.icon;
            return (
              <div key={f.action} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                    <span className="text-xs font-medium">{meta.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{f.uniqueUsers} users</span>
                    <span>|</span>
                    <span>{f.totalUses} uses</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {f.adoptionRate}%
                    </Badge>
                  </div>
                </div>
                <Progress value={f.adoptionRate} className="h-1.5" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Signup trend */}
      {signupDays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Signups (Last 14 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {signupDays.map(([day, count]) => {
                const max = Math.max(...signupDays.map(([, c]) => c));
                const pct = max > 0 ? (count / max) * 100 : 0;
                return (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-primary/80 rounded-t transition-all"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                      title={`${day}: ${count} signups`}
                    />
                    <span className="text-[8px] text-muted-foreground -rotate-45 origin-top-left">
                      {day.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Per-User Metrics Tab ────────────────────────────────────────────

function UserMetricsPanel() {
  const { data: adoption, isLoading } = useAdminAdoption();
  const [selectedClerkId, setSelectedClerkId] = useState<string | null>(null);
  const { data: userMetrics, isLoading: metricsLoading } = useAdminUserMetrics(selectedClerkId);
  const [search, setSearch] = useState("");

  if (isLoading) return <LoadingState />;
  if (!adoption) return <EmptyState message="No user data" />;

  const filtered = search
    ? adoption.perUser.filter(
        (u) =>
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          (u.displayName || "").toLowerCase().includes(search.toLowerCase())
      )
    : adoption.perUser;

  // Sort by totalActions desc
  const sorted = [...filtered].sort((a, b) => b.totalActions - a.totalActions);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Users table */}
      <div className="rounded-md border max-h-[300px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">User</TableHead>
              <TableHead className="text-xs">Role</TableHead>
              <TableHead className="text-xs text-right">Actions</TableHead>
              <TableHead className="text-xs text-right">First Seen</TableHead>
              <TableHead className="text-xs text-right">Last Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((u) => (
              <TableRow
                key={u.clerkId}
                className={`cursor-pointer transition-colors ${
                  selectedClerkId === u.clerkId ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() => setSelectedClerkId(u.clerkId)}
              >
                <TableCell className="text-xs">
                  <div>
                    <span className="font-medium">{u.displayName || u.email}</span>
                    {u.displayName && (
                      <span className="block text-[10px] text-muted-foreground">{u.email}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.role === "admin" ? "default" : "secondary"}
                    className="text-[10px] h-4 px-1.5"
                  >
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-right font-mono">{u.totalActions}</TableCell>
                <TableCell className="text-[10px] text-right text-muted-foreground">
                  {u.firstSeen ? new Date(u.firstSeen).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-[10px] text-right text-muted-foreground">
                  {timeAgo(u.lastActive)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Selected user detail */}
      {selectedClerkId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>User Metrics: {adoption.perUser.find((u) => u.clerkId === selectedClerkId)?.email}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedClerkId(null)} className="h-6 text-xs">
                Close
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : userMetrics ? (
              <div className="space-y-4">
                {/* Action breakdown */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Action Breakdown</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(userMetrics.byAction)
                      .sort(([, a], [, b]) => b - a)
                      .map(([action, count]) => {
                        const meta = getActionMeta(action);
                        const Icon = meta.icon;
                        return (
                          <div key={action} className="flex items-center gap-2 px-2 py-1.5 rounded bg-accent/30">
                            <Icon className={`w-3 h-3 ${meta.color}`} />
                            <span className="text-xs flex-1">{meta.label}</span>
                            <span className="text-xs font-mono font-medium">{count}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Daily activity mini chart */}
                {Object.keys(userMetrics.dailyCounts).length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Daily Activity (30d)</h4>
                    <div className="flex items-end gap-0.5 h-16">
                      {Object.entries(userMetrics.dailyCounts)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([day, count]) => {
                          const max = Math.max(...Object.values(userMetrics.dailyCounts));
                          const pct = max > 0 ? (count / max) * 100 : 0;
                          return (
                            <div
                              key={day}
                              className="flex-1 bg-primary/70 rounded-t transition-all"
                              style={{ height: `${Math.max(pct, 4)}%` }}
                              title={`${day}: ${count} actions`}
                            />
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No metrics for this user yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <BarChart3 className="w-8 h-8 mb-2 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Main Admin Dashboard ────────────────────────────────────────────

export default function AdminDashboard() {
  const [, setLocation] = useLocation();

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="h-7 px-2">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            <span className="text-xs">Back to Editor</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Admin Dashboard</h1>
          </div>
        </div>
        <Badge variant="outline" className="text-xs">Admin</Badge>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4">
        <Tabs defaultValue="adoption" className="h-full flex flex-col">
          <TabsList className="w-fit mb-4">
            <TabsTrigger value="adoption" className="text-xs gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" />
              Adoption Center
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-xs gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Activity Feed
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Per-User Metrics
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="adoption" className="mt-0">
              <AdoptionPanel />
            </TabsContent>
            <TabsContent value="activity" className="mt-0">
              <ActivityFeedPanel />
            </TabsContent>
            <TabsContent value="users" className="mt-0">
              <UserMetricsPanel />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
