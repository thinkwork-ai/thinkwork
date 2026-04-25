import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Zap,
  FileText,
  Code,
  ArrowLeft,
  ArrowRight,
  Check,
  Wand2,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as markdownLang, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTenantSkill, saveTenantFile } from "@/lib/skills-api";

export const Route = createFileRoute("/_authed/_tenant/capabilities/skills/builder")({
  component: SkillBuilderPage,
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type TemplateKey = "script-tool" | "knowledge" | "process" | "blank";

const TEMPLATES: Record<TemplateKey, {
  label: string;
  description: string;
  icon: typeof Zap;
  skillMd: string;
  extraFiles?: Record<string, string>;
}> = {
  "script-tool": {
    label: "Script Tool",
    description: "Skill with embedded Python scripts the agent executes directly",
    icon: Code,
    skillMd: `---
name: {{slug}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
---

# {{name}}

## Tools

Describe the tools this skill provides.

## Usage

Explain when and how to use this skill.
`,
    extraFiles: {
      "scripts/tool.py": `"""{{name}} — custom skill script."""

import json
import os


def {{slug_underscore}}_action(query: str) -> str:
    """Execute the main action for this skill.

    Args:
        query: The user's request.

    Returns:
        JSON result.
    """
    # TODO: Implement your skill logic here
    return json.dumps({"result": f"Processed: {query}"})
`,
    },
  },
  knowledge: {
    label: "Knowledge Skill",
    description: "Domain-specific instructions with no tools — pure context",
    icon: FileText,
    skillMd: `---
name: {{slug}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
---

# {{name}}

## Overview

Describe the domain knowledge this skill provides.

## Key Principles

List the most important rules and guidelines.

## References

- Read \`references/guide.md\` when you need the detailed reference for this domain.
`,
    extraFiles: {
      "references/guide.md": `# {{name}} — Reference Guide

Add detailed reference material here that the agent can load on demand.
`,
    },
  },
  process: {
    label: "Process / Workflow",
    description: "Multi-step business process with structured steps",
    icon: Wand2,
    skillMd: `---
name: {{slug}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
---

# {{name}}

## Overview

Describe what this process achieves.

## Steps Summary

1. **Step 1** — Brief description
2. **Step 2** — Brief description
3. **Step 3** — Brief description

## References

- Read \`references/steps.md\` when you need the detailed step-by-step instructions.

## Guardrails

- What NOT to do during this process.
`,
    extraFiles: {
      "references/steps.md": `# {{name}} — Detailed Steps

## Step 1: [Name]

Detailed instructions for step 1.

## Step 2: [Name]

Detailed instructions for step 2.

## Step 3: [Name]

Detailed instructions for step 3.
`,
    },
  },
  blank: {
    label: "Blank",
    description: "Empty template with required structure only",
    icon: Zap,
    skillMd: `---
name: {{slug}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
---

# {{name}}

Add your skill instructions here.
`,
  },
};

const CATEGORIES = [
  { value: "productivity", label: "Productivity" },
  { value: "integrations", label: "Integrations" },
  { value: "processes", label: "Processes" },
  { value: "knowledge", label: "Knowledge" },
  { value: "communication", label: "Communication" },
  { value: "research", label: "Research" },
  { value: "custom", label: "Custom" },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function SkillBuilderPage() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug;
  const navigate = useNavigate();
  useBreadcrumbs([
    { label: "Capabilities", href: "/capabilities" },
    { label: "Skills", href: "/capabilities/skills" },
    { label: "Build New Skill" },
  ]);

  // Wizard state
  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);

  // Step 1: Template
  const [template, setTemplate] = useState<TemplateKey | null>(null);

  // Step 2: Metadata
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("custom");
  const [tags, setTags] = useState("");

  // Step 3: Content editor
  const [skillMdContent, setSkillMdContent] = useState("");

  // Derived
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const slugUnderscore = slug.replace(/-/g, "_");

  const canNext = (() => {
    if (step === 1) return template !== null;
    if (step === 2) return name.trim().length > 0;
    if (step === 3) return skillMdContent.trim().length > 0;
    return true;
  })();

  const goNext = () => {
    if (step === 2 && template) {
      // Generate SKILL.md content from template
      const tmpl = TEMPLATES[template];
      const content = tmpl.skillMd
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{slug\}\}/g, slug)
        .replace(/\{\{slug_underscore\}\}/g, slugUnderscore)
        .replace(/\{\{description\}\}/g, description || `Custom skill: ${name}`);
      setSkillMdContent(content);
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 1));

  const handleCreate = async () => {
    if (!tenantSlug || !name.trim()) {
      toast.error("Missing tenant or skill name");
      return;
    }
    setCreating(true);
    try {
      // 1. Create the skill (generates SKILL.md from template — plan
      //    2026-04-24-009 §U3 retired the parallel skill.yaml writer).
      const result = await createTenantSkill(tenantSlug, {
        name: name.trim(),
        slug,
        description: description.trim() || undefined,
      });

      // 2. Overwrite SKILL.md with the edited content
      await saveTenantFile(tenantSlug, result.slug, "SKILL.md", skillMdContent);

      // 3. Create extra files from template
      if (template) {
        const tmpl = TEMPLATES[template];
        if (tmpl.extraFiles) {
          for (const [path, content] of Object.entries(tmpl.extraFiles)) {
            const rendered = content
              .replace(/\{\{name\}\}/g, name)
              .replace(/\{\{slug\}\}/g, slug)
              .replace(/\{\{slug_underscore\}\}/g, slugUnderscore)
              .replace(/\{\{description\}\}/g, description || `Custom skill: ${name}`);
            try {
              const { createTenantFile } = await import("@/lib/skills-api");
              await createTenantFile(tenantSlug, result.slug, path, rendered);
            } catch {
              // File might already exist from template, try save instead
              await saveTenantFile(tenantSlug, result.slug, path, rendered);
            }
          }
        }
      }

      // 4. Navigate to the skill detail page
      navigate({ to: "/capabilities/skills/$slug", params: { slug: result.slug } });
    } catch (err) {
      console.error("Failed to create skill:", err);
      toast.error(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderStep1 = () => (
    <div className="grid grid-cols-2 gap-4">
      {(Object.entries(TEMPLATES) as [TemplateKey, typeof TEMPLATES[TemplateKey]][]).map(
        ([key, tmpl]) => {
          const Icon = tmpl.icon;
          const selected = template === key;
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-colors ${
                selected
                  ? "border-primary bg-primary/5"
                  : "hover:border-muted-foreground/30"
              }`}
              onClick={() => setTemplate(key)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    selected ? "bg-primary text-primary-foreground" : "bg-accent"
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-sm">{tmpl.label}</CardTitle>
                  {selected && <Check className="h-4 w-4 text-primary ml-auto" />}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-xs">
                  {tmpl.description}
                </CardDescription>
              </CardContent>
            </Card>
          );
        },
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4 max-w-lg">
      <div>
        <Label htmlFor="skill-name">Name *</Label>
        <Input
          id="skill-name"
          placeholder="My Custom Skill"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
        />
        {slug && (
          <p className="text-xs text-muted-foreground mt-1">
            Slug: <code className="text-primary">{slug}</code>
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="skill-desc">Description</Label>
        <Textarea
          id="skill-desc"
          placeholder="What does this skill do? Include 'Use when...' to help the agent know when to activate it."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1"
          rows={3}
        />
      </div>
      <div>
        <Label>Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="skill-tags">Tags</Label>
        <Input
          id="skill-tags"
          placeholder="tag1, tag2, tag3"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">Comma-separated</p>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="outline" className="text-xs">SKILL.md</Badge>
        <span className="text-xs text-muted-foreground">
          Entry point — keep under 200 lines. Move details to references/.
        </span>
      </div>
      <div className="flex-1 min-h-0 border rounded-md overflow-hidden bg-black">
        <CodeMirror
          value={skillMdContent}
          onChange={(val) => setSkillMdContent(val)}
          height="100%"
          theme={vscodeDark}
          extensions={[
            markdownLang({ base: markdownLanguage, codeLanguages: languages }),
            EditorView.lineWrapping,
          ]}
          style={{ fontSize: "12px", backgroundColor: "black" }}
          className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: false,
            bracketMatching: true,
          }}
        />
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4 max-w-lg">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Slug</span>
            <code className="text-xs">{slug}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Template</span>
            <span>{template ? TEMPLATES[template].label : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Category</span>
            <Badge variant="outline" className="text-xs">{category}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">SKILL.md</span>
            <span>{skillMdContent.split("\n").length} lines</span>
          </div>
          {template && TEMPLATES[template].extraFiles && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Extra files</span>
              <span>{Object.keys(TEMPLATES[template].extraFiles!).join(", ")}</span>
            </div>
          )}
        </CardContent>
      </Card>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const STEPS = [
    { num: 1, label: "Template" },
    { num: 2, label: "Metadata" },
    { num: 3, label: "Content" },
    { num: 4, label: "Review" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header with step indicator */}
      <div className="flex items-center justify-between pb-4 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Build New Skill</h1>
          <p className="text-sm text-muted-foreground">
            {STEPS[step - 1].label} — Step {step} of {STEPS.length}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {STEPS.map((s) => (
            <div
              key={s.num}
              className={`h-2 w-8 rounded-full transition-colors ${
                s.num <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 shrink-0">
        <Button
          variant="outline"
          onClick={step === 1 ? () => navigate({ to: "/capabilities/skills" }) : goBack}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          {step === 1 ? "Cancel" : "Back"}
        </Button>

        {step < 4 ? (
          <Button onClick={goNext} disabled={!canNext}>
            Next
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={creating || !canNext}>
            {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Create Skill
          </Button>
        )}
      </div>
    </div>
  );
}
