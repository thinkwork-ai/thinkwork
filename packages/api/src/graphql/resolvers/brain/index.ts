import { companyBrainStatus } from "./companyBrainStatus.query.js";
import {
  requestCompanyBrainProductionMigrationMutation,
  updateCompanyBrainMigrationMutation,
} from "./companyBrainMigration.mutation.js";

export const brainQueries = {
  companyBrainStatus,
};

export const brainMutations = {
  requestCompanyBrainProductionMigration:
    requestCompanyBrainProductionMigrationMutation,
  updateCompanyBrainMigration: updateCompanyBrainMigrationMutation,
};
