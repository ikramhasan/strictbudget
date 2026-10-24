import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@strictbudget/ui/components/input-group";
import { Label } from "@strictbudget/ui/components/label";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { agentSetupPrompt, mcpServerUrl } from "@/lib/agents";

/** How to connect an outside agent: the MCP server URL and a prompt that sets the agent up. */
export function McpSetup() {
  return (
    <>
      <CopyField
        id="mcp-url"
        label="MCP server URL"
        hint="Add it as a remote MCP server in Claude, Cursor or another MCP client, then sign in when it asks."
        value={mcpServerUrl()}
      />
      <SetupPrompt />
    </>
  );
}

function CopyField({
  id,
  label,
  hint,
  value,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup>
        <InputGroupInput id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label={`Copy ${label}`} size="icon-xs" onClick={() => copy(value)}>
            {copied ? <Check /> : <Copy />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-muted-foreground text-sm">{hint}</p>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error("Couldn't copy. Select the text and copy it instead."));
  };
  return { copied, copy };
}

/** A prompt to paste into an agent so it connects itself (adds the MCP server, then signs in). */
function SetupPrompt() {
  const prompt = agentSetupPrompt();
  const { copied, copy } = useCopy();
  return (
    <div className="grid gap-2">
      <Label htmlFor="agent-setup-prompt">Set up with your agent</Label>
      <InputGroup>
        <InputGroupTextarea
          id="agent-setup-prompt"
          readOnly
          value={prompt}
          className="field-sizing-fixed h-40 font-mono text-xs leading-relaxed md:text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <InputGroupAddon align="block-end" className="justify-end border-t">
          <InputGroupButton size="sm" variant="secondary" onClick={() => copy(prompt)}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy prompt"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-muted-foreground text-sm">
        Paste it into Claude Code, Claude, Cursor or another agent and it connects itself.
      </p>
    </div>
  );
}
