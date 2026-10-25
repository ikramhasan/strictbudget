import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@strictbudget/ui/components/sidebar";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  // The sidebar's mobile check needs matchMedia, which jsdom lacks.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe("SidebarMenuButton", () => {
  it("marks only the active item, since the data-active: variant matches any value", () => {
    render(
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>Budget</SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>Budget settings</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>,
    );
    expect(screen.getByRole("button", { name: "Budget" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Budget settings" })).not.toHaveAttribute(
      "data-active",
    );
  });
});
