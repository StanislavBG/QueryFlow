import { useState, useRef, useEffect, useCallback } from "react";
import { useAskQuestion, useChatMessages, useSaveChatMessage, useClearChatMessages } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Mic, MicOff, User, Bot, ChevronDown, ChevronRight, Trash2 } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id?: number;
}

interface QAPair {
  question: ChatMessage;
  answer: ChatMessage | null;
  collapsed: boolean;
}

interface AskModuleProps {
  queryContent: string;
  dialect: string;
}

export function AskModule({ queryContent, dialect }: AskModuleProps) {
  const [question, setQuestion] = useState("");
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const askMutation = useAskQuestion();
  const saveMutation = useSaveChatMessage();
  const clearMutation = useClearChatMessages();
  const { data: persistedMessages, isLoading: loadingMessages } = useChatMessages();
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const [initialized, setInitialized] = useState(false);

  const supportsVoice = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // Load persisted messages on mount
  useEffect(() => {
    if (persistedMessages && !initialized) {
      const loaded: ChatMessage[] = persistedMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        id: m.id,
      }));
      setLocalMessages(loaded);
      setInitialized(true);
    }
  }, [persistedMessages, initialized]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [localMessages]);

  // Group messages into Q&A pairs for expand/shrink
  const qaPairs: QAPair[] = [];
  const [collapsedPairs, setCollapsedPairs] = useState<Set<number>>(new Set());

  for (let i = 0; i < localMessages.length; i++) {
    const msg = localMessages[i];
    if (msg.role === "user") {
      const answer = localMessages[i + 1]?.role === "assistant" ? localMessages[i + 1] : null;
      qaPairs.push({
        question: msg,
        answer,
        collapsed: collapsedPairs.has(qaPairs.length),
      });
      if (answer) i++; // skip the answer message
    }
  }

  const toggleCollapse = useCallback((index: number) => {
    setCollapsedPairs(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleSend = () => {
    const trimmed = question.trim();
    if (!trimmed || askMutation.isPending) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    setLocalMessages(prev => [...prev, userMsg]);
    setQuestion("");

    // Persist user message
    saveMutation.mutate({ role: "user", content: trimmed });

    askMutation.mutate(
      { question: trimmed, queryContent: queryContent || undefined, dialect },
      {
        onSuccess: (data) => {
          const assistantMsg: ChatMessage = { role: "assistant", content: data.answer };
          setLocalMessages(prev => [...prev, assistantMsg]);
          // Persist assistant message
          saveMutation.mutate({ role: "assistant", content: data.answer });
        },
        onError: (error) => {
          const errMsg: ChatMessage = { role: "assistant", content: `Unable to process: ${error.message}` };
          setLocalMessages(prev => [...prev, errMsg]);
          saveMutation.mutate({ role: "assistant", content: errMsg.content });
        },
      }
    );
  };

  const handleClearChat = () => {
    setLocalMessages([]);
    setCollapsedPairs(new Set());
    clearMutation.mutate();
  };

  const toggleVoice = () => {
    if (!supportsVoice) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setQuestion(prev => prev + (prev ? " " : "") + transcript);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ask about your query</h3>
        {localMessages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearChat}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            disabled={clearMutation.isPending}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-3 space-y-2">
          {loadingMessages ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : qaPairs.length === 0 && !askMutation.isPending ? (
            <div className="text-center py-8 px-3">
              <Bot className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground mb-2">Ask questions about your SQL query, schema, or general SQL topics.</p>
              <div className="space-y-1">
                {["What indexes would help this query?", "Explain the JOIN logic", "How can I optimize this?"].map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setQuestion(ex)}
                    className="block w-full text-left text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-accent"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {qaPairs.map((pair, idx) => (
                <div key={idx} className="border border-border rounded-md overflow-hidden bg-background">
                  {/* Collapsible header (question) */}
                  <button
                    onClick={() => toggleCollapse(idx)}
                    className="w-full flex items-start gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {pair.collapsed ? (
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                      )}
                    </div>
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="w-3 h-3 text-primary" />
                    </div>
                    <span className="text-xs text-foreground leading-relaxed line-clamp-2 flex-1">
                      {pair.question.content}
                    </span>
                  </button>

                  {/* Answer (collapsible) */}
                  {!pair.collapsed && pair.answer && (
                    <div className="border-t border-border px-2 py-2 bg-muted/30">
                      <div className="flex gap-2">
                        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Bot className="w-3 h-3 text-primary" />
                        </div>
                        <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap flex-1">
                          {pair.answer.content}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Pending answer for the latest question */}
              {askMutation.isPending && (
                <div className="border border-border rounded-md overflow-hidden bg-background">
                  <div className="px-2 py-2 bg-muted/30">
                    <div className="flex gap-2">
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3 h-3 text-primary" />
                      </div>
                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground mt-1" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="p-2 border-t border-border">
        <div className="flex gap-1.5">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask a question..."
            className="min-h-[36px] max-h-[80px] text-xs resize-none"
            rows={1}
          />
          <div className="flex flex-col gap-1">
            {supportsVoice && (
              <Button
                size="sm"
                variant={isListening ? "destructive" : "ghost"}
                onClick={toggleVoice}
                className="h-7 w-7 p-0"
              >
                {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!question.trim() || askMutation.isPending}
              className="h-7 w-7 p-0"
            >
              <Send className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
