import type { GraphQLContext } from "../../context.js";
import { db, eq, and, asc, userQuickActions, snakeToCamel, users } from "../../utils.js";

// Default quick actions seeded on first query
const DEFAULTS = [
	{ title: "Check my emails", prompt: "Check my emails and summarize what's new" },
	{ title: "Check opportunities", prompt: "List the last 5 opportunities in CRM" },
	{ title: "Check restaurant availability", prompt: "Check the restaurant availability at " },
	{ title: "Find a restaurant", prompt: "Search for restaurants and return availability in the " },
	{ title: "Schedule a meeting", prompt: "Schedule a meeting with the team tomorrow" },
	{ title: "Review my calendar", prompt: "Review my calendar for conflicts this week" },
	{ title: "Things to do with kids", prompt: "Search for things to do in Austin, TX with kids during the next 3 days. Since we live in Austin, highlight unique or limited experiences, not just things a visitor would be interested in." },
	{ title: "Summarize recent deals", prompt: "Summarize the status of all deals that changed stage in the last 7 days" },
	{ title: "Draft a follow-up email", prompt: "Draft a follow-up email to my most recent meeting attendees thanking them and summarizing action items" },
	{ title: "Research a company", prompt: "Research Border Tire and give me a brief company overview, recent news, and key contacts" },
	{ title: "Plan my week", prompt: "Look at my calendar and tasks for this week and suggest a prioritized daily plan" },
];

export const userQuickActions_ = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { tenantId } = args as { tenantId: string };
	const userId = ctx.auth.principalId;
	if (!userId) throw new Error("Unauthorized");

	// Resolve the internal user ID from the Cognito principalId
	const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
	if (!user) throw new Error("User not found");

	// Fetch existing quick actions
	let rows = await db
		.select()
		.from(userQuickActions)
		.where(and(eq(userQuickActions.user_id, user.id), eq(userQuickActions.tenant_id, tenantId)))
		.orderBy(asc(userQuickActions.sort_order));

	// Seed defaults on first query
	if (rows.length === 0) {
		const values = DEFAULTS.map((d, i) => ({
			user_id: user.id,
			tenant_id: tenantId,
			title: d.title,
			prompt: d.prompt,
			sort_order: i,
		}));
		rows = await db.insert(userQuickActions).values(values).returning();
		rows.sort((a, b) => a.sort_order - b.sort_order);
	}

	return rows.map((r) => snakeToCamel(r));
};
