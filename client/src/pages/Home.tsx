import { useDocuments } from "@/hooks/use-documents";
import { CreateDocumentDialog } from "@/components/CreateDocumentDialog";
import { DocumentCard } from "@/components/DocumentCard";
import { Loader2, Database, Code2, FileCode2, Sparkles, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function Home() {
  const { data: documents, isLoading, error } = useDocuments();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-destructive">
        <p>Error loading documents: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12"
        >
          <div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4">
              <span className="text-gradient">QueryFlow</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
              Intelligent SQL query editor with specialized feedback agents.
              Write better queries with automated analysis and one-click formatting.
            </p>
          </div>
          <div className="flex-shrink-0 flex gap-3">
            <Link href="/editor">
              <button className="inline-flex items-center gap-2 px-6 py-3 rounded-full shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-purple-600 text-primary-foreground font-semibold">
                <FileCode2 className="w-5 h-5" />
                Open SQL Editor
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
            <CreateDocumentDialog />
          </div>
        </motion.div>

        {/* SQL Editor Feature Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mb-12"
        >
          <Link href="/editor">
            <div className="glass-card rounded-2xl p-6 border-primary/20 hover:border-primary/40 transition-all cursor-pointer group">
              <div className="flex items-start gap-5">
                <div className="p-3 rounded-xl bg-gradient-to-br from-primary/20 to-purple-600/20 border border-primary/20">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                    SQL Query Feedback System
                  </h2>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    Get intelligent feedback on your SQL queries from specialized agents.
                    Analyze query structure, optimize performance, detect errors, and enforce style standards.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-3 py-1 rounded-full text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      Structure Analysis
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Optimization Tips
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs bg-red-500/10 text-red-400 border border-red-500/20">
                      Error Detection
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Style Checking
                    </span>
                    <span className="px-3 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      One-Click Format
                    </span>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0 mt-2" />
              </div>
            </div>
          </Link>
        </motion.div>

        {!documents || documents.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20 border border-dashed border-white/10 rounded-3xl bg-white/5"
          >
            <div className="p-4 rounded-full bg-primary/10 mb-4">
              <Database className="w-12 h-12 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No documents yet</h3>
            <p className="text-muted-foreground max-w-sm text-center mb-8">
              Your storage is empty. Create your first "Hello World" document to get started.
            </p>
            <CreateDocumentDialog />
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map((doc, i) => (
              <DocumentCard key={doc.id} doc={doc} index={i} />
            ))}
          </div>
        )}

        <footer className="mt-20 pt-8 border-t border-white/5 text-center text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Code2 className="w-4 h-4" />
            <span>Built with React + TanStack Query</span>
          </div>
          <p>© {new Date().getFullYear()} Hello World Storage. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}
