"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

export async function disconnect(formData: FormData) {
  const platform = String(formData.get("platform"));
  const { user, supabase } = await requireUser();

  await supabase
    .from("platform_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("platform", platform);

  revalidatePath("/connections");
}
