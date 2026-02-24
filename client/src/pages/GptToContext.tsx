import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Loader2,
  Send,
  FileText,
  MessageSquare,
  Target,
  ArrowLeft,
  Copy,
  Trash2,
  BookOpen,
  Sparkles,
  StickyNote,
  Search,
  CheckCircle2,
  XCircle,
  Wrench,
} from "lucide-react";
import { useLocation } from "wouter";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AgentActionResult[];
}

interface AgentActionResult {
  tool: string;
  success: boolean;
  message: string;
  data?: unknown;
}

export default function GptToContext() {
  // Inputs
  const [whatToResearch, setWhatToResearch] = useState("");
  const [whatIsObjective, setWhatIsObjective] = useState("");

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Notes state
  const [notes, setNotes] = useState("");

  // Summary state
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  const { toast } = useToast();
  const [, navigate] = useLocation();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Send chat message
  const sendMessage = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;

    const newUserMsg: ChatMessage = { role: "user", content: msg };
    setChatHistory((prev) => [...prev, newUserMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await apiRequest("POST", "/api/research/chat", {
        message: msg,
        whatToResearch,
        whatIsObjective,
        chatHistory,
        notes,
      });
      const data = await res.json();
      const actions: AgentActionResult[] = data.actions || [];
      setChatHistory((prev) => [...prev, { role: "assistant", content: data.answer, actions }]);

      // Show toast for each executed action
      for (const action of actions) {
        toast({
          title: action.success ? `Action: ${action.tool}` : `Failed: ${action.tool}`,
          description: action.message,
          variant: action.success ? "default" : "destructive",
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Chat request failed";
      toast({ title: "Error", description: errMsg, variant: "destructive" });
      // Remove the optimistic user message on error
      setChatHistory((prev) => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
      chatInputRef.current?.focus();
    }
  }, [chatInput, chatLoading, whatToResearch, whatIsObjective, chatHistory, notes, toast]);

  // Generate summary on demand
  const generateSummary = async () => {
    if (chatHistory.length === 0 && !notes.trim()) {
      toast({ title: "Nothing to summarize", description: "Have a conversation or add notes first.", variant: "destructive" });
      return;
    }

    setSummaryLoading(true);
    try {
      const res = await apiRequest("POST", "/api/research/summary", {
        whatToResearch,
        whatIsObjective,
        chatHistory,
        notes,
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Summary generation failed";
      toast({ title: "Error", description: errMsg, variant: "destructive" });
    } finally {
      setSummaryLoading(false);
    }
  };

  // Add text to notes (from chat messages)
  const addToNotes = (text: string) => {
    setNotes((prev) => {
      const separator = prev.trim() ? "\n\n---\n\n" : "";
      return prev + separator + text;
    });
    toast({ title: "Added to notes", description: "Text captured in your research notes." });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  const clearChat = () => {
    setChatHistory([]);
    toast({ title: "Chat cleared" });
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="h-5 w-px bg-border" />
          <Search className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">GPT to Context</h1>
          <Badge variant="secondary" className="text-xs">Research Assistant</Badge>
        </div>

        {/* Two input fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">What to Research</label>
            <Input
              value={whatToResearch}
              onChange={(e) => setWhatToResearch(e.target.value)}
              placeholder="e.g., Best practices for database migration strategies"
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">What is the Objective</label>
            <Input
              value={whatIsObjective}
              onChange={(e) => setWhatIsObjective(e.target.value)}
              placeholder="e.g., Write a migration plan document for the team"
              className="text-sm"
            />
          </div>
        </div>
      </header>

      {/* Three-panel layout */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* LEFT PANEL: Notes */}
          <ResizablePanel defaultSize={25} minSize={15}>
            <div className="h-full flex flex-col border-r border-border">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <StickyNote className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium">Research Notes</span>
                </div>
                {notes.trim() && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => copyToClipboard(notes, "Notes")}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                )}
              </div>
              <div className="flex-1 p-3">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Build your research notes here...&#10;&#10;Click the note icon on any chat response to capture it here. You can also type directly."
                  className="h-full min-h-0 resize-none text-sm font-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* MIDDLE PANEL: Chat */}
          <ResizablePanel defaultSize={45} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium">Researcher</span>
                  {chatHistory.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {chatHistory.length} messages
                    </Badge>
                  )}
                </div>
                {chatHistory.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={clearChat}
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Clear
                  </Button>
                )}
              </div>

              {/* Chat messages */}
              <div className="flex-1 overflow-auto p-3 space-y-4">
                {chatHistory.length === 0 && (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    <div className="text-center space-y-2">
                      <BookOpen className="w-8 h-8 mx-auto opacity-50" />
                      <p>Start your research conversation</p>
                      <p className="text-xs">Ask questions about your research topic</p>
                    </div>
                  </div>
                )}

                {chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col gap-1 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      {/* Agent action results */}
                      {msg.actions && msg.actions.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                          {msg.actions.map((action, ai) => (
                            <div
                              key={ai}
                              className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                                action.success
                                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                                  : "bg-red-500/10 text-red-700 dark:text-red-400"
                              }`}
                            >
                              {action.success ? (
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                              ) : (
                                <XCircle className="w-3 h-3 shrink-0" />
                              )}
                              <Wrench className="w-3 h-3 shrink-0 opacity-60" />
                              <span className="font-medium">{action.tool}</span>
                              <span className="opacity-75">— {action.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1 ml-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-muted-foreground"
                          onClick={() => addToNotes(msg.content)}
                          title="Capture to notes"
                        >
                          <StickyNote className="w-3 h-3 mr-1" /> Note
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-muted-foreground"
                          onClick={() => copyToClipboard(msg.content, "Response")}
                          title="Copy to clipboard"
                        >
                          <Copy className="w-3 h-3 mr-1" /> Copy
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex items-start">
                    <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Researching...
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* Chat input */}
              <div className="border-t border-border p-3 shrink-0">
                <div className="flex gap-2">
                  <Textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Ask a research question... (Enter to send, Shift+Enter for newline)"
                    className="min-h-[44px] max-h-[120px] resize-none text-sm"
                    rows={1}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={chatLoading || !chatInput.trim()}
                    size="icon"
                    className="shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT PANEL: Summary */}
          <ResizablePanel defaultSize={30} minSize={15}>
            <div className="h-full flex flex-col border-l border-border">
              <div className="px-3 py-2 border-b border-border shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium">Objective Summary</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={generateSummary}
                    disabled={summaryLoading}
                  >
                    {summaryLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    Generate
                  </Button>
                </div>
                {whatIsObjective && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {whatIsObjective}
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-auto p-3">
                {!summary && !summaryLoading && (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    <div className="text-center space-y-2">
                      <FileText className="w-8 h-8 mx-auto opacity-50" />
                      <p>Summary will appear here</p>
                      <p className="text-xs">Click "Generate" after researching</p>
                    </div>
                  </div>
                )}

                {summaryLoading && (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating summary...
                    </div>
                  </div>
                )}

                {summary && !summaryLoading && (
                  <div className="space-y-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => copyToClipboard(summary, "Summary")}
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => addToNotes(summary)}
                      >
                        <StickyNote className="w-3 h-3" /> To Notes
                      </Button>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm whitespace-pre-wrap">
                      {summary}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
