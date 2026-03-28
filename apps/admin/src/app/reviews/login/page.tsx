import { LoginForm } from "./login-form";

export default async function ReviewsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const raw = sp.next?.trim() ?? "";
  const defaultNext = raw.startsWith("/") ? raw : "/reviews";

  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <LoginForm defaultNext={defaultNext} />
    </main>
  );
}
