# PDI Fuel Order n8n Migration

The first n8n migration target is represented by
`packages/api/src/lib/routines/n8n/pdi-fuel-order-fixture.json`.

The mapper intentionally produces a ThinkWork routine draft, not a general n8n
importer. The draft contains two TypeScript code steps:

1. `TransformOrderToPDI` transforms the incoming webhook payload into the PDI
   fuel-order shape. It is seeded from
   `lastmile/n8n/nodes/LastMile/actions/transformations/TransformOrderToPDI.action.ts`.
2. `AddFuelOrder` posts the transformed order to the PDI SOAP endpoint. It is
   seeded from
   `lastmile/n8n/nodes/PDI/actions/order/AddFuelOrder.action.ts`.

The webhook trigger and respond-to-webhook nodes are preserved as migration
metadata in the routine step manifest for the U7 synchronous webhook adapter.

## Credential

The `AddFuelOrder` step declares one tenant credential binding:

- Alias: `pdi`
- Suggested credential slug: `pdi-soap`
- Required fields: `apiUrl`, `username`, `password`, `partnerId`

Routine ASL, step manifests, code buffers, and admin config contain only the
credential handle and required field names. Raw credential values are resolved
by the routine code-step wrapper at execution time.

## Draft Creation

In the admin New Routine page, choose the `PDI Fuel Order` draft button, then
plan the routine. The generated draft can be reviewed and published once the
tenant has an active `pdi-soap` credential or the binding is changed to another
active PDI credential.

The routine will appear in the Routines list after publish because it uses the
existing `createRoutine` Step Functions path.
