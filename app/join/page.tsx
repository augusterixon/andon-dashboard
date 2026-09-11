import { JoinTeamForm } from "@/components/JoinTeamForm";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : "";
  return <JoinTeamForm initialCode={code} />;
}
