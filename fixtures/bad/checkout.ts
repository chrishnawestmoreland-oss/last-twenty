// Fixture: agent-written checkout handler. Looks done; the last 20% is missing.
import { fetch } from "undici";

const STRIPE_KEY = "sk-live-4eC39HqLyjWDarjtT1zdp7dc";

export async function chargeCustomer(customerId: string, amount: number) {
  try {
    const res = await fetch("https://api.example.com/charge", {
      method: "POST",
      body: JSON.stringify({ customerId, amount }),
    });
    return await res.json();
  } catch (e) {
    // will handle later
  }
}

export function getUser(id: string) {
  const query = `SELECT * FROM users WHERE id = ${id}`;
  return db.query(query);
}

export function renderBio(userInput: string) {
  document.getElementById("bio")!.innerHTML = userInput;
}

export function refreshProfile(id: string) {
  fetchUser(id).then((user) => {
    saveUser(user);
  });
}

function fetchUser(id: string) {
  return fetch(`/api/users/${id}`).then((r) => r.json());
}

function saveUser(user: unknown) {
  console.log("saved", user);
}
