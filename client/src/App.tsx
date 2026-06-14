import { useState, useEffect, useMemo } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { dark, shadcn } from "@clerk/themes";
import Editor from "@/pages/Editor";
import AdminDashboard from "@/pages/AdminDashboard";
import NotFound from "@/pages/not-found";
import { useCurrentUser } from "@/hooks/use-admin";

// Read the Clerk publishable key from the Vite-native env var, falling back to
// the Next.js-style name (NEXT_PUBLIC_*) so the build works regardless of which
// secret name is configured. Requires both prefixes in vite.config envPrefix.
const clerkPubKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Watch the `dark` class on <html> so ClerkProvider can switch themes.
 * Uses a MutationObserver so it stays in sync with the theme toggle in Editor.
 */
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

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
  const isDark = useIsDarkMode();

  const clerkAppearance = useMemo(
    () => ({
      baseTheme: isDark ? [dark, shadcn] : [shadcn],
      variables: {
        fontFamily: "'Inter', system-ui, sans-serif",
        fontFamilyButtons: "'Inter', system-ui, sans-serif",
        borderRadius: "0.375rem",
        colorBackground: isDark ? "hsl(222 47% 8%)" : "hsl(0 0% 100%)",
        colorInputBackground: isDark ? "hsl(222 30% 14%)" : "hsl(220 14% 96%)",
        colorInputText: isDark ? "hsl(210 20% 95%)" : "hsl(222 47% 11%)",
        colorPrimary: isDark ? "hsl(210 60% 50%)" : "hsl(222 47% 31%)",
        colorTextOnPrimaryBackground: "hsl(0 0% 100%)",
        colorTextSecondary: isDark ? "hsl(218 11% 55%)" : "hsl(220 9% 46%)",
        colorNeutral: isDark ? "hsl(210 20% 95%)" : "hsl(222 47% 11%)",
      },
      elements: {
        card: "shadow-lg",
        navbar: "border-r border-[hsl(var(--border))]",
        navbarButton: "text-sm",
        headerTitle: "text-base font-semibold",
        formButtonPrimary:
          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 shadow-sm text-sm font-medium",
        footerActionLink: "text-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] hover:opacity-80",
      },
    }),
    [isDark]
  );

  return (
    <ClerkProvider publishableKey={clerkPubKey} appearance={clerkAppearance}>
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
