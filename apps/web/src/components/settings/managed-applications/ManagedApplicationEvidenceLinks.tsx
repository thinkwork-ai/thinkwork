import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { ExternalLink } from "lucide-react";
import { SettingsDeploymentEvidenceQuery } from "@/lib/settings-queries";

export function ManagedApplicationEvidenceLinks({
  jobId,
  fallbackBucket,
  fallbackPrefix,
}: {
  jobId?: string | null;
  fallbackBucket?: string | null;
  fallbackPrefix?: string | null;
}) {
  const [result] = useQuery({
    query: SettingsDeploymentEvidenceQuery,
    variables: { jobId: jobId ?? "" },
    pause: !jobId,
  });

  if (!jobId) {
    return (
      <p className="text-sm text-muted-foreground">
        Evidence links appear after a deployment job starts.
      </p>
    );
  }

  if (result.fetching) {
    return <p className="text-sm text-muted-foreground">Loading evidence...</p>;
  }

  if (result.error && !(fallbackBucket && fallbackPrefix)) {
    return (
      <p className="text-sm text-muted-foreground">
        Evidence is unavailable for this job.
      </p>
    );
  }

  const evidence =
    result.data?.deploymentEvidence ??
    (fallbackBucket && fallbackPrefix
      ? {
          jobId,
          bucket: fallbackBucket,
          prefix: fallbackPrefix,
          urls: [],
        }
      : null);
  if (!evidence) {
    return (
      <p className="text-sm text-muted-foreground">
        Evidence is not available yet.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <p className="font-medium text-foreground">Evidence location</p>
        <p className="mt-1 leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {evidence.bucket && evidence.prefix
            ? `s3://${evidence.bucket}/${evidence.prefix}`
            : "Evidence bucket not configured yet."}
        </p>
      </div>
      {evidence.urls.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {evidence.urls.map((url, index) => (
            <Button asChild key={url} type="button" variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Evidence {index + 1}
              </a>
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No signed evidence links are available yet.
        </p>
      )}
    </div>
  );
}
