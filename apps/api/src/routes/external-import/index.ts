import { createRouter } from "../../lib/router";
import {
  importExternalFilesHandler,
  importExternalPlanHandler,
  listExternalPlansHandler,
} from "./handlers";
import { importExternalFiles, importExternalPlan, listExternalPlans } from "./routes";

export const externalImportRouter = createRouter()
  .openapi(listExternalPlans, listExternalPlansHandler)
  .openapi(importExternalPlan, importExternalPlanHandler)
  .openapi(importExternalFiles, importExternalFilesHandler);
