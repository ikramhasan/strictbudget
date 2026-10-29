import { createRouter } from "../../lib/router";
import {
  createCategoryGroupHandler,
  createCategoryHandler,
  deleteCategoryGroupHandler,
  deleteCategoryHandler,
  deleteCategoryTargetHandler,
  listCategoriesHandler,
  moveCategoryGroupHandler,
  moveCategoryHandler,
  restoreCategoryTargetHandler,
  setCategoryTargetHandler,
  setSavingsSuggestionHandler,
  snoozeCategoryTargetHandler,
  updateCategoryGroupHandler,
  updateCategoryHandler,
} from "./handlers";
import {
  createCategory,
  createCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  deleteCategoryTarget,
  listCategories,
  moveCategory,
  moveCategoryGroup,
  restoreCategoryTarget,
  setCategoryTarget,
  setSavingsSuggestion,
  snoozeCategoryTarget,
  updateCategory,
  updateCategoryGroup,
} from "./routes";

export const categoriesRouter = createRouter()
  .openapi(listCategories, listCategoriesHandler)
  .openapi(createCategoryGroup, createCategoryGroupHandler)
  .openapi(updateCategoryGroup, updateCategoryGroupHandler)
  .openapi(deleteCategoryGroup, deleteCategoryGroupHandler)
  .openapi(moveCategoryGroup, moveCategoryGroupHandler)
  .openapi(createCategory, createCategoryHandler)
  .openapi(updateCategory, updateCategoryHandler)
  .openapi(deleteCategory, deleteCategoryHandler)
  .openapi(moveCategory, moveCategoryHandler)
  .openapi(setCategoryTarget, setCategoryTargetHandler)
  .openapi(restoreCategoryTarget, restoreCategoryTargetHandler)
  .openapi(deleteCategoryTarget, deleteCategoryTargetHandler)
  .openapi(snoozeCategoryTarget, snoozeCategoryTargetHandler)
  .openapi(setSavingsSuggestion, setSavingsSuggestionHandler);
