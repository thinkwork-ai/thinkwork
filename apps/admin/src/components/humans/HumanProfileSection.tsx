import { useEffect } from "react";
import { useMutation } from "urql";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { UpdateUserMutation } from "@/lib/graphql-queries";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").trim(),
  phone: z.string().optional(),
  image: z.string().url().or(z.literal("")).optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export interface HumanProfileSectionProps {
  userId: string;
  email: string;
  initial: {
    name?: string | null;
    phone?: string | null;
    image?: string | null;
  };
}

export function HumanProfileSection({ userId, email, initial }: HumanProfileSectionProps) {
  const [{ fetching }, updateUser] = useMutation(UpdateUserMutation);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: initial.name ?? "",
      phone: initial.phone ?? "",
      image: initial.image ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      name: initial.name ?? "",
      phone: initial.phone ?? "",
      image: initial.image ?? "",
    });
  }, [initial.name, initial.phone, initial.image, form]);

  const onSubmit = async (values: ProfileFormValues) => {
    const result = await updateUser({
      id: userId,
      input: {
        name: values.name.trim(),
        phone: values.phone?.trim() || undefined,
        image: values.image?.trim() || undefined,
      },
    });

    if (result.error) {
      const code = result.error.graphQLErrors?.[0]?.extensions?.code;
      if (code === "FORBIDDEN") {
        toast.error("You don't have permission to edit this human.");
      } else {
        toast.error(result.error.message);
      }
      return;
    }

    toast.success("Profile updated");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Global user fields. Email is read-only.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">Email</FormLabel>
              <FormControl>
                <Input value={email} readOnly disabled className="text-sm" />
              </FormControl>
            </FormItem>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Name</FormLabel>
                  <FormControl>
                    <Input className="text-sm" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Phone</FormLabel>
                  <FormControl>
                    <Input type="tel" placeholder="+15551234567" className="text-sm" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="image"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Image URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://…" className="text-sm" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={fetching}>
                {fetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
