import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import Editor from "@/pages/Editor";
import AdminDashboard from "@/pages/AdminDashboard";
import NotFound from "@/pages/not-found";
import { useCurrentUser } from "@/hooks/use-admin";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** Route guard: only renders children if the current user is an admin. */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">Loading...</div>;
  if (!user?.authenticated || user.role !== "admin") {
    return <div className="flex items-center justify-center h-screen text-muted-foreground text-sm">Access denied. Admin only.</div>;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Editor} />
      <Route path="/admin">
        <AdminGuard><AdminDashboard /></AdminGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ClerkProvider publishableKey={clerkPubKey}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
