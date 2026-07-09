import { analystInternalClusters } from "./analystInternalClusters.query.js";
import { provisionAnalystConnector } from "./provisionAnalystConnector.mutation.js";
import { registerAnalystDataSource } from "./registerAnalystDataSource.mutation.js";
import { registerInternalAnalystDataSource } from "./registerInternalAnalystDataSource.mutation.js";

export const analystQueries = {
  analystInternalClusters,
};

export const analystMutations = {
  provisionAnalystConnector,
  registerAnalystDataSource,
  registerInternalAnalystDataSource,
};
