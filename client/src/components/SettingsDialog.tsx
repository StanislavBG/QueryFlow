import { useState } from "react";
import {
  useAgentSettings,
  useUpdateAgentSettings,
} from "@/hooks/use-sql-queries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Settings, Search, Zap, Bug, Palette, Loader2, AlignLeft, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const agentMeta: Record<string, { icon: typeof Search; label: string; description: string; color: string }> = {
  structure: {
    icon: Search,
    label: "Structure",
    description: "Query structure, nesting depth, complexity, and readability",
    color: "text-muted-foreground",
  },
  optimization: {
    icon: Zap,
    label: "Performance",
    description: "Performance patterns, index usage, and query efficiency",
    color: "text-muted-foreground",
  },
  error: {
    icon: Bug,
    label: "Correctness",
    description: "Potential SQL bugs, typos, and syntax issues",
    color: "text-muted-foreground",
  },
  style: {
    icon: Palette,
    label: "Style",
    description: "Keyword casing, naming conventions, and coding consistency",
    color: "text-muted-foreground",
  },
  formatting: {
    icon: AlignLeft,
    label: "Formatting",
    description: "Whitespace, line breaks, alignment, and visual layout",
    color: "text-muted-foreground",
  },
  documentation: {
    icon: BookOpen,
    label: "Documentation",
    description: "Comments, query purpose clarity, and team maintainability",
    color: "text-primary",
  },
};

const priorityLabels: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const { data: agentSettingsData, isLoading: agentsLoading } = useAgentSettings();
  const updateAgent = useUpdateAgentSettings();
  const { toast } = useToast();

  const handleToggleAgent = (agentType: string, enabled: boolean) => {
    updateAgent.mutate(
      { agentType, data: { enabled } },
      {
        onError: () => toast({ title: "Error", description: "Failed to update setting.", variant: "destructive" }),
      }
    );
  };

  const handlePriorityChange = (agentType: string, priority: string) => {
    updateAgent.mutate(
      { agentType, data: { priority: parseInt(priority, 10) } },
      {
        onError: () => toast({ title: "Error", description: "Failed to update priority.", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Analysis Categories</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Toggle which feedback categories are included when analyzing queries.
        </p>

        <div className="mt-2 space-y-3">
          {agentsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            agentSettingsData?.map((setting) => {
              const meta = agentMeta[setting.agentType];
              if (!meta) return null;
              const AgentIcon = meta.icon;

              return (
                <div
                  key={setting.agentType}
                  className="p-3 rounded-lg border border-border bg-muted/50 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <AgentIcon className={`w-4 h-4 ${meta.color}`} />
                      <div>
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-[10px] text-muted-foreground">{meta.description}</p>
                      </div>
                    </div>
                    <Switch
                      checked={setting.enabled}
                      onCheckedChange={(checked) => handleToggleAgent(setting.agentType, checked)}
                    />
                  </div>
                  {setting.enabled && (
                    <div className="flex items-center gap-2 pl-6.5">
                      <Label className="text-xs text-muted-foreground">Priority:</Label>
                      <Select
                        value={String(setting.priority)}
                        onValueChange={(val) => handlePriorityChange(setting.agentType, val)}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Low</SelectItem>
                          <SelectItem value="2">Medium</SelectItem>
                          <SelectItem value="3">High</SelectItem>
                        </SelectContent>
                      </Select>
                      <Badge variant="outline" className="text-[10px] h-4">
                        {priorityLabels[setting.priority] || "Low"}
                      </Badge>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
