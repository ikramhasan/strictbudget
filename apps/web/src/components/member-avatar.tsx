import { Tooltip, TooltipContent, TooltipTrigger } from "@strictbudget/ui/components/tooltip";
import { cn } from "@strictbudget/ui/lib/utils";
import { Bot } from "lucide-react";
import { $api } from "@/lib/api";
import { useOptionalBudget } from "@/lib/budget-context";
import { useDifferentiateWithoutColor } from "@/lib/display-options";
import { pictureSrc } from "@/lib/pictures";
import { useOptionalQueryClient } from "@/lib/query-client";

/**
 * The owner is #545BFE with white text, everyone else black text. The API numbers them 1–6 (the
 * owner 1, the others by when they joined).
 */
const AVATAR_COLORS: Record<number, string> = {
  1: "bg-[#545BFE] text-white",
  2: "bg-[#AEE865] text-black",
  3: "bg-[#41D298] text-black",
  4: "bg-[#D4D5FF] text-black",
  5: "bg-[#FBE48E] text-black",
  6: "bg-[#FAADA5] text-black",
};

/**
 * With Differentiate Without Color, members whose names start with the same character (exactly,
 * so "i" and "I" differ) are told apart: the first in member order gets no pattern, the next
 * pattern 1, then 2 … 5. Members are in the API's order, the owner first and then by when they
 * joined. Returns 0 for no pattern.
 */
export function avatarPattern(
  members: readonly { userId: string; name: string }[],
  userId: string,
): number {
  const member = members.find((m) => m.userId === userId);
  if (!member) return 0;
  const initial = member.name.trim().charAt(0);
  const same = members.filter((m) => m.name.trim().charAt(0) === initial);
  return Math.min(same.indexOf(member), 5);
}

/**
 * Black at 15% over the colour. One is the left half, two opposite quarters, three diagonal
 * stripes, four the bottom half, five a checker grid.
 */
function AvatarPattern({ pattern }: { pattern: number }) {
  if (pattern < 1) return null;
  return (
    <svg
      aria-hidden
      viewBox="0 0 40 40"
      className="pointer-events-none absolute inset-0 size-full fill-black/15"
      data-pattern={pattern}
    >
      {pattern === 1 && <rect width="20" height="40" />}
      {pattern === 2 && (
        <>
          <rect width="20" height="20" />
          <rect x="20" y="20" width="20" height="20" />
        </>
      )}
      {pattern === 3 && (
        <path d="M0 8 8 0h8L0 16zM0 24 24 0h8L0 32zM0 40 40 0v8L8 40zM16 40l24-24v8L24 40zM32 40l8-8v8z" />
      )}
      {pattern === 4 && <rect y="20" width="40" height="20" />}
      {pattern === 5 && (
        <>
          {[0, 1, 2, 3].flatMap((row) =>
            [0, 1, 2, 3]
              .filter((col) => (row + col) % 2 === 0)
              .map((col) => (
                <rect key={`${row}-${col}`} x={col * 10} y={row * 10} width="10" height="10" />
              )),
          )}
        </>
      )}
    </svg>
  );
}

function usePattern(userId: string | null, active: boolean) {
  const [strong] = useDifferentiateWithoutColor();
  const budgetId = useOptionalBudget()?.budget.id ?? "";
  const { client, present } = useOptionalQueryClient();
  const on = strong && active && userId !== null && budgetId !== "" && present;
  const members = $api.useQuery(
    "get",
    "/v1/budgets/{budgetId}/members",
    { params: { path: { budgetId } } },
    { enabled: on },
    client,
  );
  return on && userId ? avatarPattern(members.data?.members ?? [], userId) : 0;
}

/** "Pat", "Pat (you)", "Pat (removed)", "Inactive Member". */
export function memberTooltip(
  userId: string | null,
  userName: string | null,
  avatarColor: number | null,
  currentUserId: string | undefined,
): string {
  if (!userId || !userName) return "Inactive Member";
  if (!avatarColor) return `${userName} (removed)`;
  return `${userName}${userId === currentUserId ? " (you)" : ""}`;
}

/**
 * Someone no longer on the budget gets the grey inactive avatar: with their initial and
 * "(removed)" while their user exists, empty with "Inactive Member" once it's deleted.
 */
export function MemberAvatar({
  userId,
  userName,
  avatarColor,
  picture = null,
  currentUserId,
  tooltipPrefix = "",
  tooltipSuffix = "",
  agentName = null,
  className,
}: {
  userId: string | null;
  userName: string | null;
  /** 1–6 from the API; null once they've left the budget. */
  avatarColor: number | null;
  /** Shown instead of the initial. */
  picture?: string | null;
  currentUserId: string | undefined;
  /** Around the name in the tooltip: "Entered by " … ", last changed by Sam". */
  tooltipPrefix?: string;
  tooltipSuffix?: string;
  /** The agent that acted for the member (MCP client or Agent Auth agent): a bot badge and its name. */
  agentName?: string | null;
  className?: string;
}) {
  const member = memberTooltip(userId, userName, avatarColor, currentUserId);
  const tooltip = `${tooltipPrefix}${agentName ? `${agentName} for ${member}` : member}${tooltipSuffix}`;
  const colors = (avatarColor && AVATAR_COLORS[avatarColor]) || "bg-[#DBD7CC] text-[#696763]";
  // Only current members have a colour, and so a pattern.
  const pattern = usePattern(userId, Boolean(avatarColor));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={tooltip}
          className={cn(
            "relative inline-flex size-6 shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold text-xs uppercase",
            colors,
            className,
          )}
        >
          <AvatarPattern pattern={pattern} />
          <span className="relative">{userId && userName ? userName.trim().charAt(0) : ""}</span>
          {picture && (
            // Over the initial, which shows if the picture can't load.
            <img
              src={pictureSrc(picture)}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
              onError={(e) => {
                e.currentTarget.hidden = true;
              }}
            />
          )}
          {agentName && (
            // Inside the circle's corner (it clips), over the initial or picture.
            <span className="absolute right-0 bottom-0 flex size-3 items-center justify-center rounded-full bg-foreground text-background ring-1 ring-background">
              <Bot className="size-2.5" aria-hidden />
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
