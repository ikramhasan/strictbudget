import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { breakdownSections, FutureTargetIcon, ReadyToAssignBanner } from "./ready-to-assign";

const format = (a: string) => `$${Number(a) / 100}`;

describe("ReadyToAssignBanner", () => {
  it("shows money ready to assign", () => {
    render(<ReadyToAssignBanner amount="5000" overdraft={false} format={format} />);
    expect(screen.getByText("$50")).toBeInTheDocument();
    expect(screen.getByText("Ready to Assign")).toBeInTheDocument();
  });

  it("says when all money is assigned", () => {
    render(<ReadyToAssignBanner amount="0" overdraft={false} format={format} />);
    expect(screen.getByText("All Money Assigned")).toBeInTheDocument();
  });

  it("warns when more was assigned than there is, with its action", () => {
    render(
      <ReadyToAssignBanner
        amount="-500"
        overdraft={false}
        format={format}
        action={<button type="button">Fix This</button>}
      />,
    );
    expect(screen.getByText("You assigned more than you have")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix This" })).toBeInTheDocument();
  });

  it("calls an overdraft by its name, without Fix This", () => {
    render(
      <ReadyToAssignBanner
        amount="-500"
        overdraft
        format={format}
        action={<button type="button">Fix This</button>}
      />,
    );
    expect(screen.getByText("Overdraft? We can help with that!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix This" })).not.toBeInTheDocument();
  });
});

describe("Ready to Assign Breakdown", () => {
  const october = {
    leftOver: "-200",
    inflows: "1500",
    debtInflows: "0",
    cashOverspending: "0",
    assigned: "-1200",
    assignedInFuture: "-100",
    total: "0",
  };

  it("lists the lines, leaving out lines at zero", () => {
    expect(breakdownSections(october, "2026-10")).toEqual({
      plus: [
        { label: "Ready to Assign left over from September", amount: "-200" },
        { label: "Inflow: Ready to Assign transactions in October", amount: "1500" },
      ],
      minus: [
        { label: "Assigned in October", amount: "-1200" },
        { label: "Assigned in Future", amount: "-100" },
      ],
    });
  });

  it("opens from the amount with the subtotals, total and message", async () => {
    render(
      <ReadyToAssignBanner
        amount="0"
        overdraft={false}
        format={format}
        breakdown={{ lines: october, month: "2026-10" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /View Ready to Assign Breakdown$/ }));
    expect(screen.getByText("Ready to Assign Breakdown")).toBeInTheDocument();
    expect(screen.getByText("+$13")).toBeInTheDocument();
    expect(screen.getByText("$-13")).toBeInTheDocument();
    expect(screen.getByText("= $0")).toBeInTheDocument();
    expect(screen.getByText("Nice work! Every dollar has a job.")).toBeInTheDocument();
  });
});

describe("FutureTargetIcon", () => {
  it("fills with the funded share, and turns into a check once funded", () => {
    const { rerender } = render(<FutureTargetIcon targets={{ needed: "500", funded: "300" }} />);
    expect(screen.getByRole("img", { name: "Target 60% funded" })).toBeInTheDocument();
    rerender(<FutureTargetIcon targets={{ needed: "500", funded: "500" }} />);
    expect(screen.getByLabelText("Targets funded")).toBeInTheDocument();
  });
});
