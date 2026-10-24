"use client";

// strictbudget: shadcn has no Autocomplete wrapper yet. Base UI's Autocomplete (free text with
// suggestions) shares its input, popup, list, group and empty parts with Combobox, so this reuses
// the shadcn combobox styling and only adds the root and item.
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react";
import {
  ComboboxCollection as AutocompleteCollection,
  ComboboxContent as AutocompleteContent,
  ComboboxEmpty as AutocompleteEmpty,
  ComboboxGroup as AutocompleteGroup,
  ComboboxLabel as AutocompleteGroupLabel,
  ComboboxInput as AutocompleteInput,
  ComboboxList as AutocompleteList,
} from "@strictbudget/ui/components/combobox";
import { cn } from "@strictbudget/ui/lib/utils";

const Autocomplete = AutocompletePrimitive.Root;

function AutocompleteItem({ className, ...props }: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
};
