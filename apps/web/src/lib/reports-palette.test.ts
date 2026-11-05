import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_COLORS } from "./reports";

/**
 * The report palette in theme.css, checked as charts use it: every pair of neighbouring colours
 * (and each colour against the first, a donut's wrap-around) apart for normal, protan and deutan
 * vision, and every colour at least 3:1 against the page and the card in both themes.
 */
const css = readFileSync(join(__dirname, "../../../../packages/ui/src/styles/theme.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  return css.slice(start, css.indexOf("\n}", start));
};
const token = (body: string, name: string) => {
  const value = new RegExp(`--${name}: ([^;]+);`).exec(body)?.[1];
  if (!value) throw new Error(`--${name} missing`);
  return value;
};

type Rgb = [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** A hex or oklch() token as linear sRGB. */
function linear(value: string): Rgb {
  if (value.startsWith("#")) {
    return [1, 3, 5].map((i) => toLinear(Number.parseInt(value.slice(i, i + 2), 16) / 255)) as Rgb;
  }
  const [L = 0, C = 0, h = 0] = (/oklch\(([^)]+)\)/.exec(value)?.[1] ?? "")
    .split(/\s+/)
    .map(Number);
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, c))) as Rgb;
}
function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
// Machado, Oliveira & Fernandes (2009) at full severity.
const CVD: Record<string, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};
const simulate = (rgb: Rgb, matrix: number[][]) =>
  matrix.map((row) =>
    Math.min(
      1,
      Math.max(
        0,
        row.reduce((sum, k, i) => sum + k * (rgb[i] ?? 0), 0),
      ),
    ),
  ) as Rgb;
/** OKLab distance ×100. */
const deltaE = (x: Rgb, y: Rgb) => {
  const [a, b] = [oklab(x), oklab(y)];
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (x: Rgb, y: Rgb) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

const root = block(":root");
const themes = {
  light: { palette: root, surfaces: root },
  dark: { palette: block(".dark"), surfaces: block(".dark") },
};

describe.each(Object.entries(themes))("the %s report palette", (_, theme) => {
  const colors = Array.from({ length: REPORT_COLORS }, (_, i) =>
    linear(token(theme.palette, `report-${i + 1}`)),
  );
  const neighbours: [number, number][] = [
    ...colors.slice(1).map((_, i) => [i, i + 1] as [number, number]),
    ...colors.slice(2).map((_, i) => [0, i + 2] as [number, number]),
  ];

  it("keeps neighbouring colours apart for every kind of colour vision", () => {
    for (const [i, j] of neighbours) {
      const [a, b] = [colors[i] as Rgb, colors[j] as Rgb];
      expect(deltaE(a, b), `${i + 1}/${j + 1}`).toBeGreaterThanOrEqual(15);
      for (const matrix of Object.values(CVD)) {
        expect(
          deltaE(simulate(a, matrix), simulate(b, matrix)),
          `${i + 1}/${j + 1}`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("stands 3:1 against the page and the card, neutrals included", () => {
    const marks = [
      ...colors,
      linear(token(theme.palette, "report-uncategorized")),
      linear(token(theme.palette, "report-other")),
    ];
    for (const surface of ["background", "card"]) {
      const bg = linear(token(theme.surfaces, surface));
      for (const [i, mark] of marks.entries()) {
        expect(contrast(mark, bg), `${i + 1} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
