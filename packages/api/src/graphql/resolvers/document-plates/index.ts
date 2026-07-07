import { documentPlatePreview } from "./documentPlatePreview.query.js";
import { documentPlates } from "./documentPlates.query.js";
import { plateConformance } from "./plateConformance.query.js";
import { tenantDocumentPalette } from "./tenantDocumentPalette.query.js";
import { deleteDocumentPlate } from "./deleteDocumentPlate.mutation.js";
import { saveDocumentPlate } from "./saveDocumentPlate.mutation.js";
import { updateTenantDocumentPalette } from "./updateTenantDocumentPalette.mutation.js";

export const documentPlateQueries = {
  documentPlates,
  documentPlatePreview,
  plateConformance,
  tenantDocumentPalette,
};

export const documentPlateMutations = {
  saveDocumentPlate,
  deleteDocumentPlate,
  updateTenantDocumentPalette,
};
