import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";

// Skills are the tenant's S3 skill catalog, edited as a workspace. This renders
// the same catalog files admin's Agent → Skills tab edits.
export function SettingsSkills() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Skills</h1>
      <WorkspaceFileEditor
        target={{ catalog: true }}
        targetKey="catalog"
        client={spacesWorkspaceFilesClient}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
