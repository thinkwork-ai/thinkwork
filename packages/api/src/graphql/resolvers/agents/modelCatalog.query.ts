import type { GraphQLContext } from "../../context.js";
import { db, eq, modelCatalog as modelCatalogTable, snakeToCamel } from "../../utils.js";

export async function modelCatalog(_parent: any, args: any, ctx: GraphQLContext) {
	const rows = await db.select().from(modelCatalogTable)
		.where(eq(modelCatalogTable.is_available, true))
		.orderBy(modelCatalogTable.display_name);
	return rows.map(snakeToCamel);
}
