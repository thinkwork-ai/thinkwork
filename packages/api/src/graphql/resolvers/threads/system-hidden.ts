import { sql, threads } from "../../utils.js";
import { AUTOMATION_BUILDER_SPACE_TEMPLATE_KEY } from "../../../lib/agent-loops/automation-builder-constants.js";

export function visibleThreadListPredicate() {
  return sql`NOT (
    COALESCE(${threads.metadata}->>'systemHidden', 'false') = 'true'
    OR COALESCE(${threads.metadata}->>'visibility', '') = 'system_hidden'
    OR COALESCE(${threads.metadata}->>'purpose', '') = 'automation_builder'
    OR EXISTS (
      SELECT 1
        FROM spaces hidden_space
       WHERE hidden_space.tenant_id = ${threads.tenant_id}
         AND hidden_space.id = ${threads.space_id}
         AND hidden_space.template_key = ${AUTOMATION_BUILDER_SPACE_TEMPLATE_KEY}
         AND COALESCE(hidden_space.config->>'visibility', '') = 'system_hidden'
    )
  )`;
}
