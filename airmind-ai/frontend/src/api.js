export const API_BASE = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

export async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || 12000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const detail = contentType.includes("application/json") ? (await response.json()).detail : response.statusText;
      throw new Error(detail || `Request failed (${response.status})`);
    }
    return contentType.includes("application/json") ? response.json() : response;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The API request timed out.");
    if (error instanceof TypeError || (error.message && error.message.toLowerCase().includes("fetch"))) {
      throw new Error(`Can't reach the AirMind backend. Make sure it is running on ${API_BASE}.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const postJSON = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });