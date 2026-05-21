import { useEffect } from "react";
import { useMutation } from "urql";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UpdateUserProfileMutation } from "@/lib/graphql-queries";

const userContextSchema = z.object({
  title: z.string().optional(),
  timezone: z.string().optional(),
  pronouns: z.string().optional(),
  callBy: z.string().optional(),
  notes: z.string().optional(),
  family: z.string().optional(),
  context: z.string().optional(),
});

type UserContextFormValues = z.infer<typeof userContextSchema>;

export interface HumanUserWorkspaceSectionProps {
  userId: string;
  profile?: {
    title?: string | null;
    timezone?: string | null;
    pronouns?: string | null;
    callBy?: string | null;
    notes?: string | null;
    family?: string | null;
    context?: string | null;
  } | null;
  onSaved?: () => void;
}

export function HumanUserWorkspaceSection({
  userId,
  profile,
  onSaved,
}: HumanUserWorkspaceSectionProps) {
  const [{ fetching }, updateUserProfile] = useMutation(
    UpdateUserProfileMutation,
  );

  const form = useForm<UserContextFormValues>({
    resolver: zodResolver(userContextSchema),
    defaultValues: formValues(profile),
  });

  useEffect(() => {
    form.reset(formValues(profile));
  }, [form, profile]);

  async function onSubmit(values: UserContextFormValues) {
    const result = await updateUserProfile({
      userId,
      input: {
        title: clean(values.title),
        timezone: clean(values.timezone),
        pronouns: clean(values.pronouns),
        callBy: clean(values.callBy),
        notes: clean(values.notes),
        family: clean(values.family),
        context: clean(values.context),
      },
    });

    if (result.error) {
      toast.error(result.error.message);
      return;
    }

    toast.success("User workspace updated");
    onSaved?.();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Workspace</CardTitle>
        <CardDescription>
          USER.md profile context and user-scoped memory files.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="context" className="gap-4">
          <TabsList>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>

          <TabsContent value="context">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <ContextInput
                    control={form.control}
                    name="title"
                    label="Title"
                  />
                  <ContextInput
                    control={form.control}
                    name="timezone"
                    label="Timezone"
                    placeholder="America/Chicago"
                  />
                  <ContextInput
                    control={form.control}
                    name="pronouns"
                    label="Pronouns"
                  />
                  <ContextInput
                    control={form.control}
                    name="callBy"
                    label="Call by"
                  />
                </div>
                <ContextTextarea
                  control={form.control}
                  name="notes"
                  label="Notes"
                  rows={5}
                />
                <ContextTextarea
                  control={form.control}
                  name="family"
                  label="Family"
                  rows={5}
                />
                <ContextTextarea
                  control={form.control}
                  name="context"
                  label="Context"
                  rows={8}
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={fetching}>
                    {fetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="files" className="min-h-0">
            <WorkspaceEditor
              target={{ userId }}
              mode="context"
              className="h-[560px] min-h-0"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ContextInput({
  control,
  name,
  label,
  placeholder,
}: {
  control: ReturnType<typeof useForm<UserContextFormValues>>["control"];
  name: keyof UserContextFormValues;
  label: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground">
            {label}
          </FormLabel>
          <FormControl>
            <Input
              className="text-sm"
              placeholder={placeholder}
              {...field}
              value={field.value ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ContextTextarea({
  control,
  name,
  label,
  rows,
}: {
  control: ReturnType<typeof useForm<UserContextFormValues>>["control"];
  name: keyof UserContextFormValues;
  label: string;
  rows: number;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-xs text-muted-foreground">
            {label}
          </FormLabel>
          <FormControl>
            <Textarea
              rows={rows}
              className="resize-y text-sm"
              {...field}
              value={field.value ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function formValues(
  profile: HumanUserWorkspaceSectionProps["profile"],
): UserContextFormValues {
  return {
    title: profile?.title ?? "",
    timezone: profile?.timezone ?? "",
    pronouns: profile?.pronouns ?? "",
    callBy: profile?.callBy ?? "",
    notes: profile?.notes ?? "",
    family: profile?.family ?? "",
    context: profile?.context ?? "",
  };
}

function clean(value: string | undefined) {
  const next = value?.trim();
  return next ? next : null;
}
