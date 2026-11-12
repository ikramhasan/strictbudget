import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@strictbudget/ui/components/accordion";

/** The FAQ: the design system's Accordion with questions at heading size, the second answer open. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion type="single" collapsible defaultValue="1">
      {items.map((item, i) => (
        <AccordionItem key={item.q} value={String(i)}>
          <AccordionTrigger className="items-center py-5 text-lg font-normal tracking-[-0.01em] text-heading hover:no-underline">
            {item.q}
          </AccordionTrigger>
          <AccordionContent className="pb-5 text-base text-muted-foreground">
            {item.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
