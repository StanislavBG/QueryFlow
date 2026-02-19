import { useState, useRef, useEffect } from "react";
import { useAskQuestion } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Mic, MicOff, User, Bot } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AskModuleProps {
  queryContent: string;
  dialect: string;
}

export function AskModule({ queryContent, dialect }: AskModuleProps) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const askMutation = useAskQuestion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const supportsVoice = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = question.trim();
    if (!trimmed || askMutation.isPending) return;

    setMessages(prev => [...prev, { role: "user", content: trimmed }]);
    setQuestion("");

    askMutation.mutate(
      { question: trimmed, queryContent: queryContent || undefined, dialect },
      {
        onSuccess: (data) => {
          setMessages(prev => [...prev, { role: "assistant", content: data.answer }]);
        },
        onError: (error) => {
          setMessages(prev => [...prev, { role: "assistant", content: `Unable to process: ${error.message}` }]);
        },
      }
    );
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

    recognition.onresult = (event: SpeechRecognitionEvent) => {
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
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ask about your query</h3>
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-3 space-y-3">
          {messages.length === 0 ? (
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
            messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                {msg.role === "assistant" && (
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-3 h-3 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-md px-2.5 py-1.5 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted border border-border"
                }`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
                {msg.role === "user" && (
                  <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-3 h-3 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))
          )}
          {askMutation.isPending && (
            <div className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3 h-3 text-primary" />
              </div>
              <div className="bg-muted border border-border rounded-md px-2.5 py-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              </div>
            </div>
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
