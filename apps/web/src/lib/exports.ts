import type { components } from "@strictbudget/api-client";
import {
  exportDateStamp,
  exportSeparator,
  type NumberFormat,
  planExportNames,
  selectedExportName,
} from "@strictbudget/engine";
import { zipSync } from "fflate";
import { apiClient } from "./api";
import { todayIso } from "./dates";
import { saveBlob } from "./reports";

type Selection = components["schemas"]["TransactionSelection"];

interface ExportBudget {
  id: string;
  name: string;
  numberFormat: NumberFormat;
}

/** The response's bytes as sent: `Response.text()` would drop the files' byte-order mark. */
async function bytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Export Plan: the plan file and the register file, zipped, named "as of" the local time. */
export async function exportPlan(budget: ExportBudget, now = new Date()) {
  const path = { budgetId: budget.id };
  const [plan, register] = await Promise.all([
    apiClient.GET("/v1/budgets/{budgetId}/export/plan", {
      params: { path, query: { today: todayIso() } },
      parseAs: "stream",
    }),
    apiClient.GET("/v1/budgets/{budgetId}/export/register", {
      params: { path },
      parseAs: "stream",
    }),
  ]);
  const names = planExportNames(
    budget.name,
    exportDateStamp(now),
    exportSeparator(budget.numberFormat),
  );
  const zip = zipSync({
    [names.plan]: await bytes(plan.response),
    [names.register]: await bytes(register.response),
  });
  saveBlob(new Blob([zip], { type: "application/zip" }), names.zip);
}

export async function downloadBackup(budget: { id: string; name: string }) {
  const { response } = await apiClient.GET("/v1/budgets/{budgetId}/backup", {
    params: { path: { budgetId: budget.id } },
    parseAs: "stream",
  });
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : `${budget.name}.strictbudget.json`;
  saveBlob(new Blob([await bytes(response)], { type: "application/json" }), name);
}

export async function exportSelected(budget: ExportBudget, selection: Selection, now = new Date()) {
  const { response } = await apiClient.POST("/v1/budgets/{budgetId}/export/transactions", {
    params: { path: { budgetId: budget.id } },
    body: { selection },
    parseAs: "stream",
  });
  const separator = exportSeparator(budget.numberFormat);
  saveBlob(
    new Blob([await bytes(response)], {
      type: separator === "," ? "text/csv" : "text/tab-separated-values",
    }),
    selectedExportName(budget.name, exportDateStamp(now), separator),
  );
}
