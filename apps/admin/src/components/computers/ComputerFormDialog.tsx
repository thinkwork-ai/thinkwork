import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "urql";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import {
	ComputersListQuery,
	ComputerTemplatesListQuery,
	CreateComputerMutation,
	TenantMembersListQuery,
} from "@/lib/graphql-queries";
import { ComputerStatus } from "@/gql/graphql";

const PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG = "thinkwork-computer-default";

const computerSchema = z.object({
	ownerUserId: z.string().min(1, "Owner is required"),
	name: z.string().min(1, "Name is required").trim(),
	templateId: z.string().min(1, "Template is required"),
	budgetDollars: z.string().optional(),
});

type ComputerFormValues = z.infer<typeof computerSchema>;

const DEFAULT_VALUES: ComputerFormValues = {
	ownerUserId: "",
	name: "",
	templateId: "",
	budgetDollars: "",
};

export interface ComputerFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When provided, pre-fills the owner picker. Combined with `ownerLocked`, hides the picker UI. */
	initial?: Partial<Pick<ComputerFormValues, "ownerUserId" | "name">>;
	/** When true, the owner picker is replaced with a read-only display showing the locked owner. */
	ownerLocked?: boolean;
	/** Called after a successful create with the new Computer's id. */
	onCreated?: (computerId: string) => void;
}

export function ComputerFormDialog({
	open,
	onOpenChange,
	initial,
	ownerLocked = false,
	onCreated,
}: ComputerFormDialogProps) {
	const { tenantId } = useTenant();

	const [{ fetching: creating }, createComputer] = useMutation(
		CreateComputerMutation,
	);

	// Both queries run in parallel so the dialog can compute the eligible
	// owner set and the platform-default template preselect.
	const [membersResult] = useQuery({
		query: TenantMembersListQuery,
		variables: { tenantId: tenantId! },
		pause: !tenantId || !open,
	});
	const [computersResult] = useQuery({
		query: ComputersListQuery,
		variables: { tenantId: tenantId! },
		pause: !tenantId || !open,
	});
	const [templatesResult] = useQuery({
		query: ComputerTemplatesListQuery,
		variables: { tenantId: tenantId! },
		pause: !tenantId || !open,
	});

	const queriesFetching =
		membersResult.fetching ||
		computersResult.fetching ||
		templatesResult.fetching;
	const queriesReady =
		!queriesFetching &&
		membersResult.data != null &&
		computersResult.data != null &&
		templatesResult.data != null;

	const eligibleOwners = useMemo(() => {
		const members = membersResult.data?.tenantMembers ?? [];
		const computers = computersResult.data?.computers ?? [];
		const occupiedUserIds = new Set(
			computers
				.filter((c) => c.status !== ComputerStatus.Archived)
				.map((c) => c.ownerUserId),
		);
		return members
			.filter(
				(m) =>
					m.principalType.toLowerCase() === "user" &&
					m.user &&
					!occupiedUserIds.has(m.user.id),
			)
			.map((m) => ({
				userId: m.user!.id,
				name: m.user!.name ?? m.user!.email ?? m.user!.id,
				email: m.user!.email ?? "",
			}));
	}, [membersResult.data, computersResult.data]);

	const computerTemplates = templatesResult.data?.computerTemplates ?? [];

	// When ownerLocked is true, the dialog accepts whatever ownerUserId
	// the caller provides — even if that user already has an active
	// Computer. The server-side `assertNoActiveComputer` is the source of
	// truth for the slot invariant; surfacing a duplicate via locked-owner
	// would be a UI bug at the caller (Person page should hide the CTA).
	const ownerDisplay = useMemo(() => {
		if (!ownerLocked || !initial?.ownerUserId) return null;
		const fromMembers = membersResult.data?.tenantMembers?.find(
			(m) => m.user?.id === initial.ownerUserId,
		);
		const user = fromMembers?.user;
		return {
			name: user?.name ?? user?.email ?? initial.ownerUserId,
			email: user?.email ?? "",
		};
	}, [ownerLocked, initial?.ownerUserId, membersResult.data]);

	const form = useForm<ComputerFormValues>({
		resolver: zodResolver(computerSchema),
		defaultValues: DEFAULT_VALUES,
	});

	// Reset the form ONLY on the closed → open transition. The earlier
	// implementation depended on `initial` (recreated inline by callers each
	// parent render) and `computerTemplates` (recreated via `?? []` each render),
	// which made form.reset fire on every parent re-render and wipe whatever the
	// admin had typed. The ref-tracked transition isolates the reset to the
	// moment the dialog actually opens.
	const wasOpenRef = useRef(false);
	useEffect(() => {
		if (open && !wasOpenRef.current) {
			form.reset({
				...DEFAULT_VALUES,
				...initial,
			});
		}
		wasOpenRef.current = open;
		// `form` is stable in react-hook-form v7; intentionally omitted to keep
		// this reset gated on the open-transition alone. `initial` reads only
		// the snapshot captured at the moment the transition fires — subsequent
		// renders' new object identities are ignored.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	// Separately, preselect the platform-default template once the templates
	// query resolves. Only fires when the form's templateId is still empty,
	// so an admin who has explicitly chosen a different template doesn't get
	// overwritten when the query re-resolves (cache-and-network refetch).
	useEffect(() => {
		if (!open) return;
		if (computerTemplates.length === 0) return;
		if (form.getValues("templateId")) return;
		const platformDefault = computerTemplates.find(
			(t) => t.slug === PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG,
		);
		const presetTemplate =
			platformDefault?.id ?? computerTemplates[0]?.id ?? "";
		if (presetTemplate) {
			form.setValue("templateId", presetTemplate, { shouldDirty: false });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, computerTemplates]);

	// Synchronous double-submit guard. `creating` from urql is async — there is
	// a window between form-submit firing and React re-rendering the disabled
	// button where a held Enter key or rapid double-click can fire the
	// mutation twice. The ref short-circuits the second invocation before any
	// network call happens.
	const submittingRef = useRef(false);

	const onSubmit = async (values: ComputerFormValues) => {
		if (!tenantId) return;
		if (submittingRef.current) return;
		submittingRef.current = true;
		try {
			const budgetCents = parseBudgetDollarsToCents(values.budgetDollars);
			const result = await createComputer({
				input: {
					tenantId,
					ownerUserId: values.ownerUserId,
					templateId: values.templateId,
					name: values.name.trim(),
					...(budgetCents != null
						? { budgetMonthlyCents: budgetCents }
						: {}),
				},
			});

			if (result.error) {
				// Route the CONFLICT error from `assertNoActiveComputer` to the
				// owner field when the picker is visible, otherwise to the
				// form-wide banner. In `ownerLocked` mode the owner is rendered
				// as a read-only div with no FormMessage slot, so the field-level
				// error would be invisible — route to root instead.
				const message = result.error.message;
				const isConflict = classifyCreateComputerError(message);
				if (isConflict === "ownerUserId" && !ownerLocked) {
					form.setError("ownerUserId", { message });
				} else {
					form.setError("root", { message });
				}
				return;
			}
			const created = result.data?.createComputer;
			if (created) {
				onOpenChange(false);
				onCreated?.(created.id);
			}
		} finally {
			submittingRef.current = false;
		}
	};

	const rootError = form.formState.errors.root?.message;
	const noEligibleOwners = queriesReady && eligibleOwners.length === 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New Computer</DialogTitle>
				</DialogHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)}>
						<DialogBody className="space-y-4 py-2">
							{ownerLocked && ownerDisplay ? (
								<FormItem>
									<FormLabel className="text-xs text-muted-foreground">
										Owner
									</FormLabel>
									<div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
										<span className="truncate font-medium">
											{ownerDisplay.name}
										</span>
										{ownerDisplay.email &&
											ownerDisplay.email !== ownerDisplay.name && (
												<span className="truncate text-xs text-muted-foreground">
													{ownerDisplay.email}
												</span>
											)}
									</div>
									<input
										type="hidden"
										{...form.register("ownerUserId")}
									/>
								</FormItem>
							) : (
								<FormField
									control={form.control}
									name="ownerUserId"
									render={({ field }) => (
										<FormItem className="space-y-1.5">
											<FormLabel className="text-xs text-muted-foreground">
												Owner
											</FormLabel>
											<Select
												value={field.value}
												onValueChange={field.onChange}
												disabled={!queriesReady || noEligibleOwners}
											>
												<FormControl>
													<SelectTrigger className="text-sm">
														{queriesFetching ? (
															<span className="flex items-center gap-2 text-muted-foreground">
																<Loader2 className="h-3 w-3 animate-spin" />
																Loading members...
															</span>
														) : noEligibleOwners ? (
															<span className="text-muted-foreground">
																No eligible users — every member already has
																an active Computer
															</span>
														) : (
															<SelectValue placeholder="Select owner..." />
														)}
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{eligibleOwners.map((o) => (
														<SelectItem
															key={o.userId}
															value={o.userId}
															className="text-sm"
														>
															{o.name}
															{o.email && o.email !== o.name && (
																<span className="ml-2 text-xs text-muted-foreground">
																	{o.email}
																</span>
															)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}

							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel className="text-xs text-muted-foreground">
											Name
										</FormLabel>
										<FormControl>
											<Input
												placeholder="e.g. Joey's Computer"
												autoFocus={ownerLocked}
												className="text-sm"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<FormField
									control={form.control}
									name="templateId"
									render={({ field }) => (
										<FormItem className="space-y-1.5">
											<FormLabel className="text-xs text-muted-foreground">
												Template
											</FormLabel>
											<Select
												value={field.value}
												onValueChange={field.onChange}
												disabled={
													!queriesReady || computerTemplates.length === 0
												}
											>
												<FormControl>
													<SelectTrigger className="text-sm">
														{queriesFetching ? (
															<span className="flex items-center gap-2 text-muted-foreground">
																<Loader2 className="h-3 w-3 animate-spin" />
																Loading templates...
															</span>
														) : computerTemplates.length === 0 ? (
															<span className="text-muted-foreground">
																No Computer templates available
															</span>
														) : (
															<SelectValue placeholder="Select template..." />
														)}
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{computerTemplates.map((t) => (
														<SelectItem
															key={t.id}
															value={t.id}
															className="text-sm"
														>
															{t.name}
															{t.slug ===
																PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG && (
																<span className="ml-2 text-xs text-muted-foreground">
																	default
																</span>
															)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="budgetDollars"
									render={({ field }) => (
										<FormItem className="space-y-1.5">
											<FormLabel className="text-xs text-muted-foreground">
												Budget (optional)
											</FormLabel>
											<FormControl>
												<Input
													type="number"
													min="0"
													step="0.01"
													placeholder="$/mo"
													className="text-sm"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							{rootError && (
								<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{rootError}
								</div>
							)}
						</DialogBody>

						<DialogFooter className="mt-4">
							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={creating || !queriesReady || noEligibleOwners}
							>
								{creating ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Creating...
									</>
								) : (
									"Create Computer"
								)}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Classify a `createComputer` server-side error message so the form can
 * attach it to the right surface. Exported for unit testing because the
 * substring match is brittle to message rewording in shared.ts.
 */
export function classifyCreateComputerError(
	message: string,
): "ownerUserId" | "root" {
	if (message.toLowerCase().includes("already has an active computer")) {
		return "ownerUserId";
	}
	return "root";
}

export function parseBudgetDollarsToCents(input?: string): number | null {
	if (input == null) return null;
	const trimmed = input.trim();
	if (trimmed === "") return null;
	const dollars = Number(trimmed);
	if (!Number.isFinite(dollars) || dollars < 0) return null;
	return Math.round(dollars * 100);
}
