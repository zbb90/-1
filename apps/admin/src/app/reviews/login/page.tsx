import { LoginForm } from "./login-form";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function ReviewsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const raw = sp.next?.trim() ?? "";
  const defaultNext = raw.startsWith("/") ? raw : "/reviews";

  return (
    <AdminShell>
      <div className="flex min-h-[calc(100vh-3rem)] flex-col items-center justify-center py-8">
        <LoginForm defaultNext={defaultNext} />
      </div>
    </AdminShell>
  );
}
