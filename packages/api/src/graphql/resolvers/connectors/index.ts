import {
  connector,
  connectorExecution,
  connectorExecutions,
  connectors_,
} from "./query.js";
import {
  archiveConnector,
  createConnector,
  pauseConnector,
  resumeConnector,
  updateConnector,
} from "./mutation.js";

export const connectorQueries = {
  connector,
  connectorExecution,
  connectorExecutions,
  connectors: connectors_,
};

export const connectorMutations = {
  archiveConnector,
  createConnector,
  pauseConnector,
  resumeConnector,
  updateConnector,
};
