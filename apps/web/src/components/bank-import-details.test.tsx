import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PayeeField } from "./register-fields";

const payees = [
  {
    id: "p1",
    name: "Corner Cafe",
    hidden: false,
  },
] as unknown as Parameters<typeof PayeeField>[0]["payees"];

describe("Bank Import Details", () => {
  it("shows the payee as imported, the store link and Don't Rename", async () => {
    const onDontRename = vi.fn();
    render(
      <PayeeField
        value="Corner Cafe"
        onChange={vi.fn()}
        payees={payees}
        transfers={[]}
        autoFocus
        importDetails={{
          statement: "AMAZON MKTPL*X1",
          imported: "AMAZON MKTPL*X1",
          renamedTo: "Corner Cafe",
          orderLink: { label: "Amazon.com Order History", url: "https://www.amazon.com/x" },
          onDontRename,
        }}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Bank Import Details" }));
    const panel = await screen.findByRole("region", { name: "Bank Import Details" });
    expect(panel).toHaveTextContent("As it appears on your statement");
    expect(panel).toHaveTextContent("AMAZON MKTPL*X1");
    expect(screen.getByRole("link", { name: /Amazon.com Order History/ })).toHaveAttribute(
      "href",
      "https://www.amazon.com/x",
    );
    await userEvent.click(screen.getByRole("button", { name: "Don't Rename as Corner Cafe" }));
    expect(onDontRename).toHaveBeenCalled();
  });

  it("has no details button for entered transactions", async () => {
    render(
      <PayeeField
        value="Corner Cafe"
        onChange={vi.fn()}
        payees={payees}
        transfers={[]}
        autoFocus
      />,
    );
    expect(await screen.findByText("Selected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bank Import Details" })).not.toBeInTheDocument();
  });
});
