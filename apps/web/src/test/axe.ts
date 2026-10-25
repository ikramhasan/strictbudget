import axe from "axe-core";
import { expect } from "vitest";

/**
 * Fails with axe's findings for `container`. Colour contrast is left to the browser
 * audit: jsdom doesn't lay out or paint, so axe can't measure it here.
 */
export async function expectAccessible(container: Element) {
  const result = await axe.run(container, {
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  const found = result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(found).toEqual([]);
}
