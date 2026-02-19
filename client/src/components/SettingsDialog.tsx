import { useState } from "react";
import {
  useAgentSettings,
  useUpdateAgentSettings,
  useFormattingRules,
  useUpdateFormattingRule,
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Settings, Search, Zap, Bug, Palette, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const agentMeta: Record<string, { icon: typeof Search; label: string; description: string; color: string }> = {
  structure: {
    icon: Search,
    label: "Structure",
    description: "Analyzes query structure, nesting depth, and readability",
    color: "text-muted-foreground",
  },
  optimization: {
    icon: Zap,
    label: "Performance",
    description: "Reviews query patterns and suggests performance considerations",
    color: "text-muted-foreground",
  },
  error: {
    icon: Bug,
    label: "Correctness",
    description: "Checks for potential SQL issues, typos, and syntax patterns",
    color: "text-muted-foreground",
  },
  style: {
    icon: Palette,
    label: "Style",
    description: "Reviews formatting consistency and coding conventions",
    color: "text-muted-foreground",
  },
};

const priorityLabels: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

const ruleLabels: Record<string, { label: string; type: "boolean" | "number" | "select"; options?: string[] }> = {
  uppercaseKeywords: { label: "Uppercase Keywords", type: "boolean" },
  indentSize: { label: "Indent Size (spaces)", type: "number" },
  commaPosition: { label: "Comma Position", type: "select", options: ["trailing", "leading"] },
  maxLineLength: { label: "Max Line Length", type: "number" },
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const { data: agentSettingsData, isLoading: agentsLoading } = useAgentSettings();
  const { data: formattingRulesData, isLoading: rulesLoading } = useFormattingRules();
  const updateAgent = useUpdateAgentSettings();
  const updateRule = useUpdateFormattingRule();
  const { toast } = useToast();

  const handleToggleAgent = (agentType: string, enabled: boolean) => {
    updateAgent.mutate(
      { agentType, data: { enabled } },
      {
        onError: () => toast({ title: "Error", description: "Failed to update agent settings.", variant: "destructive" }),
      }
    );
  };

  const handlePriorityChange = (agentType: string, priority: string) => {
    updateAgent.mutate(
      { agentType, data: { priority: parseInt(priority, 10) } },
      {
        onError: () => toast({ title: "Error", description: "Failed to update agent priority.", variant: "destructive" }),
      }
    );
  };

  const handleRuleValueChange = (name: string, value: string) => {
    updateRule.mutate(
      { name, data: { value } },
      {
        onError: () => toast({ title: "Error", description: "Failed to update formatting rule.", variant: "destructive" }),
      }
    );
  };

  const handleToggleRule = (name: string, enabled: boolean) => {
    updateRule.mutate(
      { name, data: { enabled } },
      {
        onError: () => toast({ title: "Error", description: "Failed to update formatting rule.", variant: "destructive" }),
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
          <DialogTitle className="text-xl font-bold">Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="agents" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="agents" className="flex-1">Agents</TabsTrigger>
            <TabsTrigger value="formatting" className="flex-1">Formatting</TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="mt-4 space-y-3">
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
          </TabsContent>

          <TabsContent value="formatting" className="mt-4 space-y-3">
            {rulesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              formattingRulesData?.map((rule) => {
                const meta = ruleLabels[rule.name];
                if (!meta) return null;

                return (
                  <div
                    key={rule.name}
                    className="p-3 rounded-lg border border-border bg-muted/50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{meta.label}</p>
                        {rule.description && (
                          <p className="text-[10px] text-muted-foreground">{rule.description}</p>
                        )}
                      </div>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => handleToggleRule(rule.name, checked)}
                      />
                    </div>
                    {rule.enabled && (
                      <div className="mt-2">
                        {meta.type === "boolean" ? (
                          <Select
                            value={rule.value}
                            onValueChange={(val) => handleRuleValueChange(rule.name, val)}
                          >
                            <SelectTrigger className="h-7 w-32 text-xs bg-background border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : meta.type === "select" ? (
                          <Select
                            value={rule.value}
                            onValueChange={(val) => handleRuleValueChange(rule.name, val)}
                          >
                            <SelectTrigger className="h-7 w-32 text-xs bg-background border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {meta.options?.map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type="number"
                            value={rule.value}
                            onChange={(e) => handleRuleValueChange(rule.name, e.target.value)}
                            className="h-7 w-24 text-xs bg-background border-border"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
