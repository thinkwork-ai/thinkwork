import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Check, Loader2, X } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	ComputerTemplatesListQuery,
	UpdateComputerMutation,
} from "@/lib/graphql-queries";
import { formatDateTime } from "@/lib/utils";
import type { Computer } from "@/gql/graphql";

type ComputerSlice = Pick<
	Computer,
	"id" | "name" | "slug" | "templateId" | "budgetMonthlyCents" | "createdAt" | "updatedAt"
> & {
	template?: { id: string; name: string; slug: string } | null;
	owner?: { id: string; name?: string | null; email?: string | null } | null;
};

interface Props {
	computer: ComputerSlice;
	onUpdated?: () => void;
}

export function ComputerIdentityEditPanel({ computer, onUpdated }: Props) {
	const { tenantId } = useTenant();
	const [{ fetching: saving }, updateComputer] = useMutation(
		UpdateComputerMutation,
	);

	const [templatesResult] = useQuery({
		query: ComputerTemplatesListQuery,
		variables: { tenantId: tenantId! },
		pause: !tenantId,
		requestPolicy: "cache-and-network",
	});
	const templates = templatesResult.data?.computerTemplates ?? [];

	const ownerLabel = computer.owner?.name ?? computer.owner?.email ?? "—";

	// Name edit state. Resync drafts with the server-truth value whenever the
	// `computer` prop changes (e.g. after a successful save + refetch), so the
	// "dirty" indicator and Save button correctly reflect the new baseline.
	const [nameDraft, setNameDraft] = useState(computer.name);
	const [nameError, setNameError] = useState<string | null>(null);
	useEffect(() => {
		setNameDraft(computer.name);
		setNameError(null);
	}, [computer.name]);
	const nameDirty = nameDraft.trim() !== computer.name;

	async function saveName() {
		const trimmed = nameDraft.trim();
		if (!trimmed) {
			setNameError("Name is required");
			return;
		}
		setNameError(null);
		const result = await updateComputer({
			id: computer.id,
			input: { name: trimmed },
		});
		if (result.error) {
			setNameError(result.error.message);
			return;
		}
		onUpdated?.();
	}

	function cancelName() {
		setNameDraft(computer.name);
		setNameError(null);
	}

	// Template edit state — resync with server truth on prop change.
	const [templateDraft, setTemplateDraft] = useState(computer.templateId);
	const [confirmingTemplate, setConfirmingTemplate] = useState(false);
	const [templateError, setTemplateError] = useState<string | null>(null);
	useEffect(() => {
		setTemplateDraft(computer.templateId);
		setTemplateError(null);
	}, [computer.templateId]);
	const templateChanged = templateDraft !== computer.templateId;

	function openTemplateConfirm() {
		setTemplateError(null);
		setConfirmingTemplate(true);
	}

	async function confirmTemplateChange() {
		const result = await updateComputer({
			id: computer.id,
			input: { templateId: templateDraft },
		});
		if (result.error) {
			setTemplateError(result.error.message);
			return;
		}
		setConfirmingTemplate(false);
		onUpdated?.();
	}

	function cancelTemplate() {
		setTemplateDraft(computer.templateId);
		setTemplateError(null);
	}

	// Budget edit state — resync with server truth on prop change.
	const initialBudgetDollars = centsToDollarString(computer.budgetMonthlyCents);
	const [budgetDraft, setBudgetDraft] = useState(initialBudgetDollars);
	const [budgetError, setBudgetError] = useState<string | null>(null);
	useEffect(() => {
		setBudgetDraft(centsToDollarString(computer.budgetMonthlyCents));
		setBudgetError(null);
	}, [computer.budgetMonthlyCents]);
	const budgetDirty = budgetDraft.trim() !== initialBudgetDollars;

	async function saveBudget() {
		const parsed = parseBudgetInput(budgetDraft);
		if (parsed === "invalid") {
			setBudgetError("Enter a positive number or leave blank to clear");
			return;
		}
		setBudgetError(null);
		const result = await updateComputer({
			id: computer.id,
			input: { budgetMonthlyCents: parsed },
		});
		if (result.error) {
			setBudgetError(result.error.message);
			return;
		}
		onUpdated?.();
	}

	async function clearBudget() {
		setBudgetError(null);
		const result = await updateComputer({
			id: computer.id,
			input: { budgetMonthlyCents: null },
		});
		if (result.error) {
			setBudgetError(result.error.message);
			return;
		}
		setBudgetDraft("");
		onUpdated?.();
	}

	function cancelBudget() {
		setBudgetDraft(initialBudgetDollars);
		setBudgetError(null);
	}

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Identity</CardTitle>
					<CardDescription>
						Rename, change the base template, or set the monthly budget.
						Slug and creation metadata are read-only.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-6">
						{/* Name */}
						<div>
							<dt className="mb-1 text-xs font-medium text-muted-foreground">
								Name
							</dt>
							<dd className="flex items-start gap-2">
								<Input
									value={nameDraft}
									onChange={(e) => setNameDraft(e.target.value)}
									className="max-w-md text-sm"
									aria-label="Computer name"
								/>
								{nameDirty && (
									<>
										<Button
											size="sm"
											onClick={saveName}
											disabled={saving}
										>
											{saving ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Check className="h-3.5 w-3.5" />
											)}
											Save
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={cancelName}
											disabled={saving}
										>
											<X className="h-3.5 w-3.5" />
											Cancel
										</Button>
									</>
								)}
							</dd>
							{nameError && (
								<p className="mt-1 text-xs text-destructive">{nameError}</p>
							)}
						</div>

						{/* Template */}
						<div>
							<dt className="mb-1 text-xs font-medium text-muted-foreground">
								Base Template
							</dt>
							<dd className="flex items-center gap-2">
								<Select
									value={templateDraft}
									onValueChange={(v) => setTemplateDraft(v)}
									disabled={templates.length === 0}
								>
									<SelectTrigger className="max-w-md text-sm">
										<SelectValue placeholder="Select template..." />
									</SelectTrigger>
									<SelectContent>
										{templates.map((t) => (
											<SelectItem key={t.id} value={t.id} className="text-sm">
												{t.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{templateChanged && (
									<>
										<Button
											size="sm"
											onClick={openTemplateConfirm}
											disabled={saving}
										>
											<Check className="h-3.5 w-3.5" />
											Save
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={cancelTemplate}
											disabled={saving}
										>
											<X className="h-3.5 w-3.5" />
											Cancel
										</Button>
									</>
								)}
							</dd>
							{templateError && (
								<p className="mt-1 text-xs text-destructive">{templateError}</p>
							)}
						</div>

						{/* Budget */}
						<div>
							<dt className="mb-1 text-xs font-medium text-muted-foreground">
								Monthly Budget
							</dt>
							<dd className="flex items-center gap-2">
								<Input
									type="number"
									min="0"
									step="0.01"
									placeholder="Unbounded"
									value={budgetDraft}
									onChange={(e) => setBudgetDraft(e.target.value)}
									className="max-w-[160px] text-sm"
									aria-label="Monthly budget in dollars"
								/>
								<span className="text-xs text-muted-foreground">USD / mo</span>
								{budgetDirty && (
									<>
										<Button
											size="sm"
											onClick={saveBudget}
											disabled={saving}
										>
											{saving ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Check className="h-3.5 w-3.5" />
											)}
											Save
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={cancelBudget}
											disabled={saving}
										>
											<X className="h-3.5 w-3.5" />
											Cancel
										</Button>
									</>
								)}
								{computer.budgetMonthlyCents != null && !budgetDirty && (
									<Button
										size="sm"
										variant="ghost"
										onClick={clearBudget}
										disabled={saving}
									>
										Clear
									</Button>
								)}
							</dd>
							{budgetError && (
								<p className="mt-1 text-xs text-destructive">{budgetError}</p>
							)}
						</div>

						{/* Read-only metadata */}
						<div className="grid gap-4 sm:grid-cols-3">
							<div className="min-w-0">
								<dt className="text-xs font-medium text-muted-foreground">
									Owner
								</dt>
								<dd className="mt-1 truncate text-sm">{ownerLabel}</dd>
							</div>
							<div className="min-w-0">
								<dt className="text-xs font-medium text-muted-foreground">
									Slug
								</dt>
								<dd className="mt-1 break-all text-sm">{computer.slug}</dd>
							</div>
							<div className="min-w-0">
								<dt className="text-xs font-medium text-muted-foreground">
									Updated
								</dt>
								<dd className="mt-1 text-sm">
									{formatDateTime(computer.updatedAt)}
								</dd>
							</div>
						</div>
					</dl>
				</CardContent>
			</Card>

			<Dialog
				open={confirmingTemplate}
				onOpenChange={(open) => {
					if (!open) {
						setConfirmingTemplate(false);
						setTemplateError(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Change base template?</DialogTitle>
						<DialogDescription>
							This will update this Computer's template association. Re-deriving
							the workspace's skills and MCP configuration from the new
							template is <Badge variant="outline">not yet implemented</Badge>
							{" "}— you'll need to re-seed manually for now.
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-2 text-sm">
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground">From:</span>
							<Badge variant="outline">
								{computer.template?.name ?? "—"}
							</Badge>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground">To:</span>
							<Badge variant="outline">
								{templates.find((t) => t.id === templateDraft)?.name ?? "—"}
							</Badge>
						</div>
					</DialogBody>
					{templateError && (
						<div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{templateError}
						</div>
					)}
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => {
								setConfirmingTemplate(false);
								setTemplateError(null);
							}}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button onClick={confirmTemplateChange} disabled={saving}>
							{saving ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Saving...
								</>
							) : (
								"Change template"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

export function centsToDollarString(
	cents: number | null | undefined,
): string {
	if (cents == null) return "";
	return (cents / 100).toString();
}

/**
 * Parse the budget input field.
 * - "" or "   " → null (admin chose to clear)
 * - positive number → cents (Math.round)
 * - "invalid" sentinel for non-numeric or negative input
 *
 * Exported for unit testing.
 */
export function parseBudgetInput(
	input: string,
): number | null | "invalid" {
	const trimmed = input.trim();
	if (trimmed === "") return null;
	const n = Number(trimmed);
	if (!Number.isFinite(n) || n < 0) return "invalid";
	return Math.round(n * 100);
}

