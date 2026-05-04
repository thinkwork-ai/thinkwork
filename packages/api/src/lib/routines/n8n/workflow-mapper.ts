import type {
  RoutinePlan,
  RoutinePlanStep,
} from "../routine-authoring-planner.js";
import { getRecipeConfigFields } from "../recipe-catalog.js";
import type { N8nWorkflow, N8nWorkflowNode } from "./workflow-types.js";

export interface N8nMigrationOptions {
  name?: string;
  description?: string;
  credentialMappings?: Partial<Record<"PDIApi", string>>;
}

export type N8nWorkflowMapResult =
  | { ok: true; plan: RoutinePlan }
  | { ok: false; reason: string };

interface MigrationStage {
  node: N8nWorkflowNode;
  step?: RoutinePlanStep;
  metadata: Record<string, unknown>;
}

const PDI_REQUIRED_FIELDS = ["apiUrl", "username", "password", "partnerId"];

export function mapN8nWorkflowToRoutinePlan(
  workflow: N8nWorkflow,
  options: N8nMigrationOptions = {},
): N8nWorkflowMapResult {
  const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const webhook = workflow.nodes.find(isWebhookNode);
  const response = workflow.nodes.find(isRespondToWebhookNode);
  if (!webhook) return unsupported("n8n workflow has no webhook trigger node.");
  if (!response) {
    return unsupported("n8n workflow has no respond-to-webhook node.");
  }

  const path = linearPath(workflow, webhook.name, response.name, nodesByName);
  if (!path.ok) return path;

  const stages: MigrationStage[] = [];
  const todos: Array<Record<string, unknown>> = [];
  for (const node of path.nodes.slice(1, -1)) {
    const mapped = mapNodeToStage(node, options);
    stages.push(mapped);
    if (mapped.metadata.todo) todos.push(mapped.metadata);
  }

  const steps = stages
    .map((stage) => stage.step)
    .filter((step): step is RoutinePlanStep => Boolean(step));
  if (steps.length === 0) {
    return unsupported("n8n workflow did not contain any migratable steps.");
  }

  const credentialRequirements = stages.some(
    (stage) => stage.metadata.credentialType === "PDIApi",
  )
    ? [
        {
          credentialType: "PDIApi",
          suggestedSlug: options.credentialMappings?.PDIApi ?? "pdi-soap",
          requiredFields: PDI_REQUIRED_FIELDS,
          usedByNodeId: "AddFuelOrder",
        },
      ]
    : [];

  const migration = {
    source: "n8n",
    sourceWorkflowId: workflow.id ?? null,
    sourceWorkflowName: workflow.name,
    trigger: {
      nodeId: webhook.id,
      nodeName: webhook.name,
      nodeType: webhook.type,
      method: stringParam(webhook, "httpMethod") || "POST",
      path: stringParam(webhook, "path") || "pdi-fuel-order",
      responseMode: stringParam(webhook, "responseMode") || "responseNode",
      deferredToUnit: "U7",
    },
    response: {
      nodeId: response.id,
      nodeName: response.name,
      nodeType: response.type,
      respondWith: stringParam(response, "respondWith") || "lastNode",
      responseBodyPath:
        stringParam(response, "responseBody") || "$.AddFuelOrder.stdoutPreview",
      deferredToUnit: "U7",
    },
    sourceNodes: stages.map((stage) => stage.metadata),
    credentialRequirements,
    todos,
  };

  return {
    ok: true,
    plan: {
      kind: "recipe_graph",
      title: options.name?.trim() || workflow.name || "PDI Fuel Order",
      description:
        options.description ??
        "Migrated draft for the PDI Fuel Order n8n workflow: transform the incoming order payload, submit it to PDI via SOAP, and preserve webhook response metadata for the U7 adapter.",
      metadata: { migration },
      steps,
    },
  };
}

function mapNodeToStage(
  node: N8nWorkflowNode,
  options: N8nMigrationOptions,
): MigrationStage {
  if (isLastMileTransformOrderToPdi(node)) {
    const args = {
      code: transformOrderToPdiCode(),
      timeoutSeconds: 60,
      networkAllowlist: [],
    };
    return {
      node,
      step: stepFromNode(
        node,
        "TransformOrderToPDI",
        "Transform order to PDI",
        args,
      ),
      metadata: sourceMetadata(node, {
        migrationKind: "typescript_code_step",
        reference:
          "lastmile/n8n/nodes/LastMile/actions/transformations/TransformOrderToPDI.action.ts",
      }),
    };
  }

  if (isPdiAddFuelOrder(node)) {
    const credentialId = options.credentialMappings?.PDIApi ?? "pdi-soap";
    const args = {
      code: addFuelOrderCode(),
      timeoutSeconds: 120,
      networkAllowlist: [],
      credentialBindings: [
        {
          alias: "pdi",
          credentialId,
          requiredFields: PDI_REQUIRED_FIELDS,
        },
      ],
    };
    return {
      node,
      step: stepFromNode(node, "AddFuelOrder", "Add fuel order in PDI", args),
      metadata: sourceMetadata(node, {
        migrationKind: "typescript_code_step",
        reference:
          "lastmile/n8n/nodes/PDI/actions/order/AddFuelOrder.action.ts",
        credentialType: "PDIApi",
        requiredFields: PDI_REQUIRED_FIELDS,
      }),
    };
  }

  const nodeId = safeNodeId(node.name);
  const args = {
    code: unknownNodePlaceholderCode(node),
    timeoutSeconds: 60,
    networkAllowlist: [],
  };
  return {
    node,
    step: stepFromNode(node, nodeId, node.name, args),
    metadata: sourceMetadata(node, {
      migrationKind: "typescript_placeholder",
      todo: true,
      message: `Review unsupported n8n node '${node.name}' (${node.type}) before activation.`,
    }),
  };
}

function stepFromNode(
  node: N8nWorkflowNode,
  nodeId: string,
  label: string,
  args: Record<string, unknown>,
): RoutinePlanStep {
  return {
    nodeId,
    recipeId: "typescript",
    recipeName: "Run TypeScript code",
    label,
    args,
    configFields: getRecipeConfigFields("typescript", args),
  };
}

function sourceMetadata(
  node: N8nWorkflowNode,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sourceNodeId: node.id,
    sourceNodeName: node.name,
    sourceNodeType: node.type,
    sourceOperation: node.parameters?.operation ?? null,
    sourceResource: node.parameters?.resource ?? null,
    ...extra,
  };
}

function linearPath(
  workflow: N8nWorkflow,
  start: string,
  end: string,
  nodesByName: Map<string, N8nWorkflowNode>,
): { ok: true; nodes: N8nWorkflowNode[] } | { ok: false; reason: string } {
  const path: N8nWorkflowNode[] = [];
  const seen = new Set<string>();
  let currentName: string | null = start;

  while (currentName) {
    if (seen.has(currentName)) {
      return unsupported(`n8n workflow contains a cycle at '${currentName}'.`);
    }
    seen.add(currentName);
    const node = nodesByName.get(currentName);
    if (!node) {
      return unsupported(
        `n8n workflow connection points to missing node '${currentName}'.`,
      );
    }
    path.push(node);
    if (currentName === end) return { ok: true, nodes: path };

    const outgoing: Array<{ node?: string }> =
      workflow.connections[currentName]?.main?.[0] ?? [];
    if (outgoing.length !== 1) {
      return unsupported(
        `n8n workflow node '${currentName}' must have exactly one main connection for this migration draft.`,
      );
    }
    currentName = outgoing[0]?.node ?? null;
  }

  return unsupported(`n8n workflow does not connect '${start}' to '${end}'.`);
}

function isWebhookNode(node: N8nWorkflowNode): boolean {
  return (
    node.type === "n8n-nodes-base.webhook" || node.type.endsWith(".webhook")
  );
}

function isRespondToWebhookNode(node: N8nWorkflowNode): boolean {
  return (
    node.type === "n8n-nodes-base.respondToWebhook" ||
    node.type.endsWith(".respondToWebhook")
  );
}

function isLastMileTransformOrderToPdi(node: N8nWorkflowNode): boolean {
  return (
    (node.type.toLowerCase().includes("lastmile") ||
      node.type.toLowerCase().includes("last-mile") ||
      node.type === "lastMile") &&
    node.parameters?.operation === "transformOrderToPDI"
  );
}

function isPdiAddFuelOrder(node: N8nWorkflowNode): boolean {
  return (
    node.type.toLowerCase().includes("pdi") &&
    node.parameters?.operation === "addFuelOrder"
  );
}

function stringParam(node: N8nWorkflowNode, key: string): string {
  const value = node.parameters?.[key];
  return typeof value === "string" ? value : "";
}

function safeNodeId(value: string): string {
  const candidate = value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  const safe = candidate || "MigratedStep";
  return /^[A-Za-z]/.test(safe) ? safe : `Step${safe}`;
}

function unsupported(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function transformOrderToPdiCode(): string {
  return `type WebhookItem = {
  product_id?: string;
  name?: string;
  quantity?: string | number;
  tank_id?: string;
  unit_price?: number;
  total?: number;
};

const orderJson = (input as any).body ?? (input as any).order ?? input;
const destinationType = 1;
const originType = 0;
const includeItemTypes = ["fuelItems"];
const options = {
  defaultDeliveryTime: "06:00:00",
  defaultUnitPrice: 0,
  defaultFreightUnitPrice: 0,
  idPrefix: "PDI:",
  originVendorId: "",
  originTerminalId: "",
  originSiteId: "",
};

function stripPrefix(value: unknown, prefix: string): string {
  const str = value == null ? "" : String(value);
  return prefix && str.startsWith(prefix) ? str.slice(prefix.length) : str;
}

function toStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function toNum(value: unknown, defaultValue = 0): number {
  if (value == null) return defaultValue;
  const num = Number(value);
  return Number.isNaN(num) ? defaultValue : num;
}

function formatPDIDateTime(dateStr: string, defaultTime = "06:00:00"): string {
  if (!dateStr) return "";
  if (dateStr.includes("T")) return dateStr;
  return \`\${dateStr.slice(0, 10)}T\${defaultTime}\`;
}

function formatPDIDate(dateStr: string): string {
  return dateStr ? dateStr.slice(0, 10) : "";
}

function transformFuelItem(item: WebhookItem, lineItemNo: number) {
  const productId = toStr(item.name || item.product_id);
  const quantity = toNum(item.quantity, 0);
  const loadDetail: Record<string, unknown> = {
    liftDateTime,
    loadProductId: productId,
    loadQuantity: quantity,
    liftGrossQuantity: quantity,
    liftNetQuantity: quantity,
    originType,
    bolNo,
    unitCost: 0,
    freightUnitCost: 0,
  };
  if (originType === 0) {
    if (options.originVendorId) loadDetail.originVendorId = options.originVendorId;
    if (options.originTerminalId) loadDetail.originTerminalId = options.originTerminalId;
  } else if (options.originSiteId) {
    loadDetail.originSiteId = options.originSiteId;
  }
  return {
    orderLineItemNo: lineItemNo,
    orderedProductId: productId,
    purchasedProductId: productId,
    ...(item.tank_id ? { destinationTankId: toStr(item.tank_id) } : {}),
    orderedQuantity: quantity,
    deliveredGrossQuantity: quantity,
    deliveredNetQuantity: quantity,
    unitPrice: toNum(item.unit_price, options.defaultUnitPrice),
    freightUnitPrice: options.defaultFreightUnitPrice,
    loadDetails: [loadDetail],
  };
}

const deliveryDate = toStr(orderJson.delivery_date);
const deliveryDateTime = formatPDIDateTime(deliveryDate, options.defaultDeliveryTime);
const businessDate = formatPDIDate(deliveryDate);
const liftDateTime = deliveryDateTime;
const bolNo = toStr(orderJson.bol_number);
const fuelDetails: unknown[] = [];
let lineItemNo = 1;

if (includeItemTypes.includes("fuelItems")) {
  for (const item of Array.isArray(orderJson.fuel_items) ? orderJson.fuel_items : []) {
    fuelDetails.push(transformFuelItem(item, lineItemNo++));
  }
}
for (const item of Array.isArray(orderJson.items) ? orderJson.items : []) {
  fuelDetails.push(transformFuelItem(item, lineItemNo++));
}

const pdiOrder: Record<string, unknown> = {
  destinationType,
  deliveryDateTime,
  businessDate,
  liftDateTime,
  fuelDetails,
};
if (destinationType === 1) {
  pdiOrder.customerId = stripPrefix(orderJson.customer_external_id, options.idPrefix);
  pdiOrder.customerLocationId = stripPrefix(orderJson.ship_to_external_id, options.idPrefix);
} else {
  pdiOrder.siteId = stripPrefix(orderJson.branch_id, options.idPrefix);
}
if (orderJson.po_number) pdiOrder.purchaseOrderNo = toStr(orderJson.po_number);
if (orderJson.order_id) pdiOrder.alternateReferenceNo = toStr(orderJson.order_id);
if (orderJson.job_name) pdiOrder.deliveryNotes = toStr(orderJson.job_name);

console.log(JSON.stringify(pdiOrder));`;
}

function addFuelOrderCode(): string {
  return `const previous = (input as any).TransformOrderToPDI;
if (previous?.truncated) {
  throw new Error("TransformOrderToPDI output was truncated; rerun with a smaller order payload or promote this migration to a first-class recipe that can pass structured output.");
}
const order = JSON.parse(previous?.stdoutPreview ?? "{}");
const pdi = credentials.pdi as {
  apiUrl: string;
  username: string;
  password: string;
  partnerId: string;
};
const targetOrderStatus = 5;

for (const field of ["apiUrl", "username", "password", "partnerId"]) {
  if (!(pdi as any)[field]) throw new Error(\`PDI credential is missing \${field}\`);
}
if (order.destinationType === undefined) throw new Error("Missing required field 'destinationType'");
if (!order.deliveryDateTime) throw new Error("Missing required field 'deliveryDateTime'");
if (!order.businessDate) throw new Error("Missing required field 'businessDate'");
if (!order.liftDateTime) throw new Error("Missing required field 'liftDateTime'");
if (!Array.isArray(order.fuelDetails) || order.fuelDetails.length === 0) {
  throw new Error("Missing required field 'fuelDetails' - at least one fuel detail is required");
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xml(name: string, value: unknown): string {
  const text = value === undefined || value === null ? "" : escapeXml(value);
  return text ? \`<\${name}>\${text}</\${name}>\` : \`<\${name}/>\`;
}

function xmlIf(name: string, value: unknown): string {
  return value === undefined || value === null ? "" : xml(name, value);
}

function loadDetailXml(load: any): string {
  return \`<LoadDetail>
    \${xml("LiftDateTime", load.liftDateTime)}
    \${xml("LoadProductID", load.loadProductId)}
    \${xml("LoadQuantity", load.loadQuantity)}
    \${xml("LiftGrossQuantity", load.liftGrossQuantity)}
    \${xml("LiftNetQuantity", load.liftNetQuantity)}
    \${xml("OriginType", load.originType)}
    \${xmlIf("OriginVendorID", load.originVendorId)}
    \${xmlIf("OriginTerminalID", load.originTerminalId)}
    \${xmlIf("OriginSiteID", load.originSiteId)}
    \${xml("BOLNo", load.bolNo)}
    \${xml("UnitCost", load.unitCost)}
    \${xml("FreightUnitCost", load.freightUnitCost)}
  </LoadDetail>\`;
}

function fuelDetailXml(fuel: any): string {
  return \`<FuelDetail>
    \${xml("OrderLineItemNo", fuel.orderLineItemNo)}
    \${xml("OrderedProductID", fuel.orderedProductId)}
    \${xml("PurchasedProductID", fuel.purchasedProductId)}
    \${xmlIf("DestinationTankID", fuel.destinationTankId)}
    \${xml("OrderedQuantity", fuel.orderedQuantity)}
    \${xml("DeliveredGrossQuantity", fuel.deliveredGrossQuantity)}
    \${xml("DeliveredNetQuantity", fuel.deliveredNetQuantity)}
    \${xml("UnitPrice", fuel.unitPrice)}
    \${xml("FreightUnitPrice", fuel.freightUnitPrice)}
    \${(fuel.loadDetails ?? []).map(loadDetailXml).join("\\n")}
  </FuelDetail>\`;
}

function buildEnvelope(order: any): string {
  return \`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <UserCredentials xmlns="http://profdata.com.Petronet">
      <Password>\${escapeXml(pdi.password)}</Password>
      <PartnerID>\${escapeXml(pdi.partnerId)}</PartnerID>
    </UserCredentials>
  </soap:Header>
  <soap:Body>
    <AddFuelOrder xmlns="http://profdata.com.Petronet">
      <TargetOrderStatus>\${targetOrderStatus}</TargetOrderStatus>
      <PDIFuelOrders>
        <PDIFuelOrders xmlns="">
          <PDIFuelOrder>
            \${xml("DestinationType", order.destinationType)}
            \${xmlIf("CustomerID", order.customerId)}
            \${xmlIf("CustomerLocationID", order.customerLocationId)}
            \${xmlIf("SiteID", order.siteId)}
            \${xmlIf("PurchaseOrderNo", order.purchaseOrderNo)}
            \${xmlIf("AlternateReferenceNo", order.alternateReferenceNo)}
            \${xml("DeliveryDateTime", order.deliveryDateTime)}
            \${xml("BusinessDate", order.businessDate)}
            \${xml("LiftDateTime", order.liftDateTime)}
            \${xmlIf("DeliveryNotes", order.deliveryNotes)}
            \${order.fuelDetails.map(fuelDetailXml).join("\\n")}
          </PDIFuelOrder>
        </PDIFuelOrders>
      </PDIFuelOrders>
    </AddFuelOrder>
  </soap:Body>
</soap:Envelope>\`;
}

function parseResult(responseXml: string): Record<string, unknown> {
  const block = responseXml.match(/<AddFuelOrderResult>(.*?)<\\/AddFuelOrderResult>/s)?.[1] ?? "";
  const decoded = block
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  const field = (name: string) => decoded.match(new RegExp(\`<\${name}>(.*?)</\${name}>\`, "s"))?.[1] ?? null;
  const resultCode = field("Result") ?? "0";
  return {
    success: resultCode === "1" || resultCode === "3",
    resultCode,
    orderNo: field("OrderNo"),
    referenceNo: field("ReferenceNo"),
    siteId: field("SiteID"),
    orderStatus: field("OrderStatus"),
  };
}

const requestUrl = \`\${String(pdi.apiUrl).replace(/\\/$/, "")}?WSDL\`;
const response = await fetch(requestUrl, {
  method: "POST",
  headers: {
    "Content-Type": "text/xml; charset=utf-8",
    SOAPAction: "http://profdata.com.Petronet/AddFuelOrder",
  },
  body: buildEnvelope(order),
});
const responseXml = await response.text();
const parsed = parseResult(responseXml);
console.log(JSON.stringify({ ...parsed, httpStatusCode: response.status }));`;
}

function unknownNodePlaceholderCode(node: N8nWorkflowNode): string {
  return `// TODO: Review unsupported n8n node before activation.
// Source node: ${node.name}
// Source type: ${node.type}
// Source parameters:
// ${JSON.stringify(node.parameters ?? {}, null, 2).replace(/\n/g, "\n// ")}
console.log(JSON.stringify({ input, todo: "Review unsupported n8n node ${node.name}" }));`;
}
