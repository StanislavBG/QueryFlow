import { useSqlQueries, useCreateSqlQuery, useDeleteSqlQuery } from "@/hooks/use-sql-queries";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, FileCode2, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { SqlQuery } from "@shared/schema";

interface QueryDocumentListProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function QueryDocumentList({ selectedId, onSelect }: QueryDocumentListProps) {
  const { data: queries, isLoading } = useSqlQueries();
  const createMutation = useCreateSqlQuery();
  const deleteMutation = useDeleteSqlQuery();
  const { toast } = useToast();

  const handleCreate = () => {
    createMutation.mutate(
      { title: "Untitled Query", content: "" },
      {
        onSuccess: (query) => {
          onSelect(query.id);
          toast({ title: "Query created", description: "New query document created." });
        },
        onError: (error) => {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteMutation.mutate(id, {
      onSuccess: () => {
        if (selectedId === id) {
          const remaining = queries?.filter(q => q.id !== id);
          if (remaining && remaining.length > 0) {
            onSelect(remaining[0].id);
          }
        }
        toast({ title: "Query deleted" });
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          size="sm"
          variant="outline"
          className="w-full"
        >
          {createMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          New Query
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !queries || queries.length === 0 ? (
            <div className="text-center py-8 px-3">
              <FileCode2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No queries yet</p>
            </div>
          ) : (
            queries.map((query: SqlQuery) => (
              <button
                key={query.id}
                onClick={() => onSelect(query.id)}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm group ${
                  selectedId === query.id
                    ? "bg-accent border border-border text-foreground"
                    : "hover:bg-accent/50 border border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileCode2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate font-medium">{query.title}</span>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, query.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/20 rounded transition-all"
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </button>
                </div>
                <p className="text-[10px] mt-1 opacity-60 pl-5.5">
                  {query.updatedAt ? format(new Date(query.updatedAt), "MMM d, HH:mm") : ""}
                </p>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
