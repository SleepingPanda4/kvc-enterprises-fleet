export async function refetchHomebaseAssignments<T>(
  operationalDate: string,
  requestJson: <TResponse>(url: string) => Promise<TResponse>,
  fetchImplementation: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetchImplementation("/api/homebase/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationalDate }),
    });
  } catch {
    throw new Error("Could not connect to the Homebase collector.");
  }
  const body = await response.json().catch(() => ({ error: "Homebase assignments could not be refreshed." })) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Homebase assignments could not be refreshed.");
  return requestJson<T>(`/api/dro/assignments?date=${encodeURIComponent(operationalDate)}`);
}
