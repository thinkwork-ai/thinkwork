import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("typed template admin surface", () => {
  const listSource = readSource("./index.tsx");
  const editorSource = readSource("./$templateId.$tab.tsx");
  const sidebarSource = readSource("../../../../components/Sidebar.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("labels the route as Templates and exposes kind filters", () => {
    expect(sidebarSource).toContain('label: "Templates"');
    expect(sidebarSource).toContain('label: "Ontology"');
    expect(listSource).toContain("TemplateKind.Computer");
    expect(listSource).toContain("TemplateKind.Agent");
  });

  it("does not create delegated Agents from Computer Templates", () => {
    expect(listSource).toContain("CreateAgentFromTemplateMutation");
    expect(listSource).toContain(
      "row.original.templateKind === TemplateKind.Computer",
    );
    expect(listSource).toContain('navigate({ to: "/computers" })');
  });

  it("persists templateKind through template reads and writes", () => {
    expect(queriesSource).toContain("templateKind");
    expect(editorSource).toContain("setTemplateKind");
    expect(editorSource).toContain("templateKind,");
  });

  it("surfaces platform Computer templates by merging both list queries", () => {
    expect(listSource).toContain("ComputerTemplatesListQuery");
    expect(listSource).toContain("mergeTemplates(");
    expect(listSource).toContain("computerTemplates");
  });

  it("offers a Duplicate action for platform (NULL-tenant) templates", () => {
    expect(listSource).toContain("isPlatformTemplate");
    expect(listSource).toContain("handleDuplicate");
    expect(listSource).toContain("CreateAgentTemplateMutation");
    expect(listSource).toContain('"Duplicate"');
  });
});
