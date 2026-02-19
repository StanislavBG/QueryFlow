import { type Document } from "@shared/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileJson, FileType, FileText, Copy, Check } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useState } from "react";

const typeIcons = {
  text: FileType,
  json: FileJson,
  md: FileText,
};

const typeColors = {
  text: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  json: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  md: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export function DocumentCard({ doc, index }: { doc: Document; index: number }) {
  const Icon = typeIcons[doc.contentType as keyof typeof typeIcons] || FileType;
  const colorClass = typeColors[doc.contentType as keyof typeof typeColors] || typeColors.text;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(doc.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card className="h-full glass-card border-white/5 hover:border-primary/50 transition-all duration-300 group overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-secondary/30 border-b border-white/5">
          <Badge variant="outline" className={`${colorClass} border`}>
            <Icon className="w-3 h-3 mr-1" />
            {doc.contentType.toUpperCase()}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">
            {format(new Date(doc.createdAt || new Date()), "MMM d, HH:mm")}
          </span>
        </CardHeader>
        <CardContent className="p-0 relative">
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-background/80 hover:bg-primary hover:text-white transition-colors border border-white/10"
              title="Copy content"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="max-h-[300px] overflow-auto custom-scrollbar">
            <pre className="p-4 text-sm font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
              {doc.contentType === 'json' ? (
                // Pretty print JSON if valid
                tryFormatJson(doc.content)
              ) : (
                doc.content
              )}
            </pre>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function tryFormatJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
