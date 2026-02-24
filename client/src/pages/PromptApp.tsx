import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Sparkles, Copy, ArrowLeft, Users, Target, MessageSquare } from "lucide-react";
import { useLocation } from "wouter";

interface AimResult {
  enhanced: string;
  audience: string;
  intent: string;
  message: string;
}

export default function PromptApp() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const handleApplyAim = async () => {
    if (!prompt.trim()) {
      toast({ title: "Enter a prompt", description: "Type a prompt to enhance with the AIM framework.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/prompt/aim", { prompt: prompt.trim() });
      const data: AimResult = await res.json();
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to apply AIM framework";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="h-5 w-px bg-border" />
        <Sparkles className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">Prompt Engineer</h1>
        <Badge variant="secondary" className="text-xs">AIM Framework</Badge>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Input section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your Prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your prompt here... e.g., 'Help me write a project proposal for migrating our database to PostgreSQL'"
                className="min-h-[120px] font-mono text-sm resize-y"
              />
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleApplyAim}
                  disabled={loading || !prompt.trim()}
                  className="gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Apply AIM Framework
                </Button>
                {prompt.trim() && (
                  <span className="text-xs text-muted-foreground">
                    {prompt.length} characters
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Result section */}
          {result && (
            <div className="space-y-4">
              {/* AIM Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-blue-500/30 bg-blue-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-500" />
                      Audience
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{result.audience}</p>
                  </CardContent>
                </Card>

                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4 text-amber-500" />
                      Intent
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{result.intent}</p>
                  </CardContent>
                </Card>

                <Card className="border-green-500/30 bg-green-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-green-500" />
                      Message
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{result.message}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Enhanced Prompt */}
              <Card className="border-primary/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Enhanced Prompt
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(result.enhanced, "Enhanced prompt")}
                      className="gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted/50 rounded-md p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
                    {result.enhanced}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
