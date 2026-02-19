import { useDocuments } from "@/hooks/use-documents";
import { CreateDocumentDialog } from "@/components/CreateDocumentDialog";
import { DocumentCard } from "@/components/DocumentCard";
import { Loader2, Database, Code2 } from "lucide-react";
import { motion } from "framer-motion";

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
              <span className="text-gradient">Hello World</span> Storage
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
              A high-performance storage engine for your text, JSON, and Markdown documents.
              Optimized for speed and simplicity.
            </p>
          </div>
          <div className="flex-shrink-0">
            <CreateDocumentDialog />
          </div>
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
