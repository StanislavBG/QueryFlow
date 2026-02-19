import { useState } from "react";
import { useCreateDocument } from "@/hooks/use-documents";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, FileJson, FileType, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

export function CreateDocumentDialog() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("text");
  const { mutate, isPending } = useCreateDocument();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!content.trim()) {
      toast({
        title: "Content required",
        description: "Please enter some content for your document.",
        variant: "destructive",
      });
      return;
    }

    if (contentType === "json") {
      try {
        JSON.parse(content);
      } catch (e) {
        toast({
          title: "Invalid JSON",
          description: "Please ensure your content is valid JSON.",
          variant: "destructive",
        });
        return;
      }
    }

    mutate(
      { content, contentType },
      {
        onSuccess: () => {
          setOpen(false);
          setContent("");
          setContentType("text");
          toast({
            title: "Success",
            description: "Document created successfully.",
          });
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          size="lg" 
          className="rounded-full shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all duration-300 bg-gradient-to-r from-primary to-purple-600 border-0"
        >
          <Plus className="w-5 h-5 mr-2" />
          New Document
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] glass-card border-white/10">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
            Create Document
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-2">
            <Label htmlFor="type" className="text-sm font-medium text-muted-foreground">Type</Label>
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger className="bg-secondary/50 border-white/10 h-12">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">
                  <div className="flex items-center gap-2">
                    <FileType className="w-4 h-4" />
                    <span>Plain Text</span>
                  </div>
                </SelectItem>
                <SelectItem value="json">
                  <div className="flex items-center gap-2">
                    <FileJson className="w-4 h-4" />
                    <span>JSON</span>
                  </div>
                </SelectItem>
                <SelectItem value="md">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    <span>Markdown</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="content" className="text-sm font-medium text-muted-foreground">Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={contentType === 'json' ? '{"hello": "world"}' : 'Hello world...'}
              className="min-h-[200px] font-mono bg-secondary/50 border-white/10 resize-none focus-visible:ring-primary/50"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={() => setOpen(false)}
              className="hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
