import { isAuthed } from "@/lib/auth";
import { getAccount } from "@/lib/linkedin";
import Login from "./login";
import Console from "./console";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isAuthed()) {
    return <Login />;
  }

  const account = await getAccount();

  return (
    <Console
      linkedinConnected={!!account}
      accountName={account?.name ?? null}
      isDev={process.env.NODE_ENV !== "production"}
    />
  );
}
