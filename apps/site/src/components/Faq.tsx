import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@strictbudget/ui/components/accordion";

/** The FAQ: the design system's Accordion at the page's body size, the second answer open. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion type="single" collapsible defaultValue="1">
      {items.map((item, i) => (
        <AccordionItem key={item.q} value={String(i)}>
          <AccordionTrigger className="items-center py-4 text-base text-heading">
            {item.q}
          </AccordionTrigger>
          <AccordionContent className="pb-4 text-base">{item.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
