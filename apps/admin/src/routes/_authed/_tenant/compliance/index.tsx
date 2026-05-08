import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { ComplianceFilterBar } from "@/components/compliance/ComplianceFilterBar";
import { ComplianceEventsTable } from "@/components/compliance/ComplianceEventsTable";
import {
  validateComplianceSearch,
  type ComplianceSearchParams,
} from "@/lib/compliance/url-search-params";

export const Route = createFileRoute("/_authed/_tenant/compliance/")({
  component: ComplianceListPage,
  validateSearch: validateComplianceSearch,
});

function ComplianceListPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const invalidShown = useRef(false);

  // Surface a one-shot toast for malformed URL params, then clear the marker.
  useEffect(() => {
    if (search.invalid && !invalidShown.current) {
      invalidShown.current = true;
      toast.error("One or more URL filters were invalid and have been cleared.");
      navigate({
        to: "/compliance",
        search: (prev) => {
          const next = { ...prev };
          delete (next as ComplianceSearchParams).invalid;
          return next;
        },
        replace: true,
      });
    }
  }, [search.invalid, navigate]);

  const handleChange = (next: ComplianceSearchParams) => {
    navigate({
      to: "/compliance",
      search: () => next,
      replace: true,
    });
  };

  const handleCursorAdvance = (cursor: string) => {
    navigate({
      to: "/compliance",
      search: (prev) => ({ ...prev, cursor }),
      replace: true,
    });
  };

  return (
    <PageLayout
      header={
        <PageHeader
          title="Compliance"
          description="Audit-event log for SOC2 walkthroughs"
        />
      }
    >
      <div className="space-y-4">
        <ComplianceFilterBar search={search} onChange={handleChange} />
        <ComplianceEventsTable
          search={search}
          onCursorAdvance={handleCursorAdvance}
        />
      </div>
    </PageLayout>
  );
}
