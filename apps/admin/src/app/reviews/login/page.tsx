import { LoginForm } from "./login-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
      <AdminPageHeader
        eyebrow="后台登录"
        title="进入管理工作台"
        description="统一使用和知识库工作台一致的页面骨架，登录后即可进入 PC 后台。"
      />
      <div className="flex min-h-[calc(100vh-20rem)] flex-col items-center justify-center py-8">
        <LoginForm defaultNext={defaultNext} />
      </div>
    </AdminShell>
  );
}
