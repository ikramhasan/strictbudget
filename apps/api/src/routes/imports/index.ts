import { createRouter } from "../../lib/router";
import {
  dontRenameHandler,
  getImportContextHandler,
  importTransactionsHandler,
  matchTransactionsHandler,
  undoDontRenameHandler,
  unmatchTransactionHandler,
} from "./handlers";
import {
  dontRenameTransaction,
  getImportContext,
  importTransactions,
  matchTransactions,
  undoDontRenameTransaction,
  unmatchTransaction,
} from "./routes";

export const importsRouter = createRouter()
  .openapi(getImportContext, getImportContextHandler)
  .openapi(importTransactions, importTransactionsHandler)
  .openapi(matchTransactions, matchTransactionsHandler)
  .openapi(unmatchTransaction, unmatchTransactionHandler)
  .openapi(dontRenameTransaction, dontRenameHandler)
  .openapi(undoDontRenameTransaction, undoDontRenameHandler);
