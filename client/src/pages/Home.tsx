import { FileCode2, Sparkles, ArrowRight, Shield, Lock, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";

function DataPolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap and Escape key
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (el) el.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-policy-title"
        tabIndex={-1}
        className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-auto outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h2 id="data-policy-title" className="text-lg font-bold">How We Handle Your Data</h2>
          </div>

          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <div>
              <h3 className="text-foreground font-semibold mb-1 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-500" />
                Encryption at Rest
              </h3>
              <p>
                All data stored in QueryFlow — including your SQL queries, schemas, voice context, and
                analysis feedback — is encrypted at rest using AES-256 encryption via the database
                provider's built-in encryption layer. Backups are also encrypted. Your data is never
                stored in plaintext on disk.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1 flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
                AI Processing via OpenAI
              </h3>
              <p>
                QueryFlow sends your SQL queries, schema definitions, and associated context to
                OpenAI's <strong>API / Developer Platform</strong> for analysis, formatting, and
                query generation. This is <strong>not</strong> the consumer ChatGPT product. By
                using QueryFlow's AI features, you acknowledge and consent to this data
                transmission.
              </p>
              <p className="mt-1.5">
                Under OpenAI's API data usage policy, data submitted through the API / Developer
                Platform is <strong>not used to train OpenAI models</strong> by default.
                OpenAI may retain API inputs and outputs for up to 30 days solely for abuse and
                misuse monitoring, after which it is deleted.
              </p>
              <p className="mt-1.5 text-xs">
                For full details, see{" "}
                <a href="https://openai.com/policies/api-data-usage-policies" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  OpenAI's API Data Usage Policies
                </a>,{" "}
                <a href="https://openai.com/policies/terms-of-use" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  OpenAI's Terms of Use
                </a>, and{" "}
                <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  OpenAI's Privacy Policy
                </a>.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">Your Responsibility</h3>
              <p>
                You are responsible for determining whether your SQL queries and schema data are
                appropriate to process through third-party AI services. Do not submit queries
                containing sensitive credentials, personally identifiable information (PII), or
                data subject to regulatory restrictions (HIPAA, GDPR, etc.) unless you have
                confirmed compliance with your organization's data policies.
              </p>
            </div>

            <div>
              <h3 className="text-foreground font-semibold mb-1">Data Retention</h3>
              <p>
                Your queries and schemas are stored only in your QueryFlow account database.
                You can delete any query, schema, or context at any time. Deletion is permanent
                and immediate from our database.
              </p>
              <p className="mt-1.5">
                Data sent to OpenAI via the API / Developer Platform is retained by OpenAI for
                up to 30 days solely for abuse monitoring, then deleted. It is <strong>not used
                for model training</strong>.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [showPolicy, setShowPolicy] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background overflow-hidden">
      {/* Main content — centered, fills available space */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-8"
        >
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-3">
            <span className="text-gradient">QueryFlow</span>
          </h1>
          <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Intelligent SQL query editor with AI-powered analysis.
            Write better queries with automated feedback, voice-to-SQL, and one-click formatting.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mb-10"
        >
          <Link href="/editor">
            <button className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-purple-600 text-primary-foreground font-semibold text-base">
              <FileCode2 className="w-5 h-5" />
              Open SQL Editor
              <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="flex flex-wrap justify-center gap-2 max-w-2xl"
        >
          <span className="px-3 py-1 rounded-full text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Structure Analysis</span>
          <span className="px-3 py-1 rounded-full text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">Performance Optimization</span>
          <span className="px-3 py-1 rounded-full text-xs bg-red-500/10 text-red-400 border border-red-500/20">Error Detection</span>
          <span className="px-3 py-1 rounded-full text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">Style Checking</span>
          <span className="px-3 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">One-Click Format</span>
          <span className="px-3 py-1 rounded-full text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">Voice-to-SQL</span>
        </motion.div>

        {/* Trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.45 }}
          className="flex items-center gap-4 mt-8 text-muted-foreground/60"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <Lock className="w-3 h-3" />
            <span>AES-256 encrypted</span>
          </div>
          <span className="text-muted-foreground/20">|</span>
          <div className="flex items-center gap-1.5 text-xs">
            <Sparkles className="w-3 h-3" />
            <span>Powered by OpenAI</span>
          </div>
          <span className="text-muted-foreground/20">|</span>
          <div className="flex items-center gap-1.5 text-xs">
            <Shield className="w-3 h-3" />
            <span>Your data, your choice</span>
          </div>
        </motion.div>
      </div>

      {/* Footer — always at bottom, never scrolled to */}
      <footer className="flex-shrink-0 border-t border-border/30 px-6 py-3">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground/60">
          <p>&copy; {new Date().getFullYear()} QueryFlow. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowPolicy(true)}
              className="hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              Data Handling &amp; Privacy
            </button>
          </div>
        </div>
      </footer>

      <DataPolicyModal open={showPolicy} onClose={() => setShowPolicy(false)} />
    </div>
  );
}
