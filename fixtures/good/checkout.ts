// Fixture: the same checkout handler, with the last 20% actually done.
import { fetch } from "undici";

const STRIPE_KEY = process.env.STRIPE_KEY;
if (!STRIPE_KEY) throw new Error("STRIPE_KEY is not set");

export async function chargeCustomer(customerId: string, amount: number) {
  try {
    const res = await fetch("https://api.example.com/charge", {
      method: "POST",
      body: JSON.stringify({ customerId, amount }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("charge failed", { customerId, status: res.status });
      throw new Error(`charge failed: ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error("chargeCustomer failed", { customerId, error: e });
    throw e;
  }
}

export function getUser(id: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}

export function renderBio(userInput: string) {
  const el = document.getElementById("bio")!;
  el.textContent = userInput;
}

export async function refreshProfile(id: string) {
  try {
    const user = await fetchUser(id);
    saveUser(user);
  } catch (e) {
    console.error("refreshProfile failed", { id, error: e });
    throw e;
  }
}

async function fetchUser(id: string) {
  const res = await fetch(`/api/users/${id}`, {
    signal: AbortSignal.timeout(5_000),
  });
  return res.json();
}

function saveUser(user: unknown) {
  console.log("saved", user);
}
