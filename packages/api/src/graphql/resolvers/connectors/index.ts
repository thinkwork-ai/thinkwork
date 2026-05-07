import {
  connector,
  connectorExecution,
  connectorExecutions,
  connectorRunLifecycles,
  connectors_,
} from "./query.js";
import {
  archiveConnector,
  createConnector,
  pauseConnector,
  resumeConnector,
  runConnectorNow,
  updateConnector,
} from "./mutation.js";

export const connectorQueries = {
  connector,
  connectorExecution,
  connectorExecutions,
  connectorRunLifecycles,
  connectors: connectors_,
};

export const connectorMutations = {
  archiveConnector,
  createConnector,
  pauseConnector,
  resumeConnector,
  runConnectorNow,
  updateConnector,
};
