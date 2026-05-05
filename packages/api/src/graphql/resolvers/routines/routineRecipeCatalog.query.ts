import type { GraphQLContext } from "../../context.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { and, db, eq, tenantCredentials } from "../../utils.js";
import {
  getRecipeConfigFields,
  getRecipeDefaultArgs,
  listRecipes,
} from "../../../lib/routines/recipe-catalog.js";

export async function routineRecipeCatalog(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  await requireAdminOrApiKeyCaller(ctx, args.tenantId, "create_routine");
  const credentials = await db
    .select({
      id: tenantCredentials.id,
      slug: tenantCredentials.slug,
      display_name: tenantCredentials.display_name,
      kind: tenantCredentials.kind,
      eventbridge_connection_arn: tenantCredentials.eventbridge_connection_arn,
    })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, args.tenantId),
        eq(tenantCredentials.status, "active"),
      ),
    );
  const allCredentialOptions = credentials.map((credential) => credential.id);
  const httpCredentialOptions = credentials
    .filter(
      (credential) =>
        credential.eventbridge_connection_arn &&
        ["api_key", "bearer_token", "basic_auth"].includes(credential.kind),
    )
    .map((credential) => credential.id);

  return listRecipes().map((recipe) => {
    const defaultArgs = getRecipeDefaultArgs(recipe.id);
    return {
      id: recipe.id,
      displayName: recipe.displayName,
      description: recipe.description,
      category: recipe.category,
      hitlCapable: recipe.hitlCapable,
      defaultArgs,
      configFields: getRecipeConfigFields(recipe.id, defaultArgs).map(
        (field) =>
          field.control === "credential_select"
            ? {
                ...field,
                options:
                  recipe.id === "http_request"
                    ? httpCredentialOptions
                    : allCredentialOptions,
              }
            : field,
      ),
    };
  });
}
