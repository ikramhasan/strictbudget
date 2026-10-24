/**
 * Sets the browser tab title to "strictbudget | <name>". React hoists the `<title>` into the
 * document head ahead of index.html's static "strictbudget", so the page that renders last wins and
 * the static title stays as the fallback. Render it from page components only, not layouts.
 */
export function PageTitle({ name }: { name: string }) {
  return <title>{`strictbudget | ${name}`}</title>;
}
