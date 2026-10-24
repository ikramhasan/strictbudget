import { TooltipProvider } from "@strictbudget/ui/components/tooltip";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { pictureSrc } from "@/lib/pictures";
import { AccountLogo } from "./accounts-nav";
import { MemberAvatar } from "./member-avatar";
import { PictureField } from "./picture-field";

describe("PictureField", () => {
  it("offers Upload without a picture, and Change and Remove with one", async () => {
    const onRemove = vi.fn();
    const { rerender } = render(
      <PictureField
        shape="circle"
        size={512}
        src={undefined}
        fallback="P"
        label="Profile picture"
        cropTitle="Crop"
        onPick={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole("button", { name: "Upload profile picture" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove profile picture" })).toBeNull();
    rerender(
      <PictureField
        shape="circle"
        size={512}
        src="blob:x"
        fallback="P"
        label="Profile picture"
        cropTitle="Crop"
        onPick={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole("button", { name: "Change profile picture" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove profile picture" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe("pictureSrc", () => {
  it("only takes our own API paths", () => {
    expect(pictureSrc("/v1/users/u1/picture?v=1")).toMatch(/\/v1\/users\/u1\/picture\?v=1$/);
    expect(pictureSrc("https://x.test/p.png")).toBeUndefined();
    expect(pictureSrc(".evil.test/p.png")).toBeUndefined();
    expect(pictureSrc(null)).toBeUndefined();
  });
});

describe("pictures where people and accounts show", () => {
  it("shows an account's logo over its initial", () => {
    const { container, rerender } = render(<AccountLogo name="Brac Bank" logo={null} />);
    expect(container).toHaveTextContent("B");
    expect(container.querySelector("img")).toBeNull();
    rerender(<AccountLogo name="Brac Bank" logo="/v1/budgets/b/accounts/a/logo?v=1" />);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      pictureSrc("/v1/budgets/b/accounts/a/logo?v=1"),
    );
  });

  it("shows a member's profile picture in their avatar", () => {
    const { container } = render(
      <TooltipProvider>
        <MemberAvatar
          userId="u1"
          userName="Pat"
          avatarColor={2}
          picture="/v1/users/u1/picture?v=1"
          currentUserId="me"
        />
      </TooltipProvider>,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      pictureSrc("/v1/users/u1/picture?v=1"),
    );
    expect(screen.getByRole("img", { name: "Pat" })).toBeInTheDocument();
  });
});
