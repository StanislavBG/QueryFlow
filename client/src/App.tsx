import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import Home from "@/pages/Home";
import Editor from "@/pages/Editor";
import NotFound from "@/pages/not-found";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/editor" component={Editor} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ClerkProvider publishableKey={clerkPubKey}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="fixed top-4 right-4 z-50" data-testid="auth-controls">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md" data-testid="button-sign-in">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton data-testid="button-user-menu" />
            </SignedIn>
          </div>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
