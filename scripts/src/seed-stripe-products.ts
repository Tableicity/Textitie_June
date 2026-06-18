import { getUncachableStripeClient } from "./stripeClient";

const PLANS = [
  {
    name: "Textitie Starter",
    tierCode: "starter",
    description: "1 agent seat, 1 phone number, 1,000 SMS credits/mo — for solo operators.",
    amount: 13900,
  },
  {
    name: "Textitie Teams",
    tierCode: "growth",
    description: "Up to 10 agents, 5 numbers, 5,000 SMS credits/mo — for growing teams.",
    amount: 34900,
  },
];

const PHONE_ADDON = {
  name: "Textitie Phone Number Add-on",
  description: "Additional dedicated phone number — $14.95/mo per number.",
  amount: 1495,
};

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  console.log("Connected to Stripe.");

  for (const plan of PLANS) {
    const existing = await stripe.products.search({
      query: `metadata['tierCode']:'${plan.tierCode}' AND active:'true'`,
    });

    if (existing.data.length > 0) {
      const p = existing.data[0];
      console.log(`[SKIP] ${plan.name} already exists: ${p.id}`);
      const prices = await stripe.prices.list({ product: p.id, active: true });
      for (const pr of prices.data) {
        console.log(`       price: ${pr.id}  $${((pr.unit_amount ?? 0) / 100).toFixed(2)}/mo`);
      }
      continue;
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { tierCode: plan.tierCode, platform: "textitie" },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { tierCode: plan.tierCode },
    });

    console.log(`[CREATED] ${plan.name}`);
    console.log(`          product: ${product.id}`);
    console.log(`          price:   ${price.id}  $${(plan.amount / 100).toFixed(2)}/mo`);
  }

  // Phone number add-on
  const existingAddon = await stripe.products.search({
    query: `metadata['type']:'phone_addon' AND active:'true'`,
  });

  if (existingAddon.data.length > 0) {
    const p = existingAddon.data[0];
    console.log(`[SKIP] Phone add-on already exists: ${p.id}`);
    const prices = await stripe.prices.list({ product: p.id, active: true });
    for (const pr of prices.data) {
      console.log(`       price: ${pr.id}  $${((pr.unit_amount ?? 0) / 100).toFixed(2)}/mo`);
    }
  } else {
    const product = await stripe.products.create({
      name: PHONE_ADDON.name,
      description: PHONE_ADDON.description,
      metadata: { type: "phone_addon", platform: "textitie" },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: PHONE_ADDON.amount,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { type: "phone_addon" },
    });
    console.log(`[CREATED] ${PHONE_ADDON.name}`);
    console.log(`          product: ${product.id}`);
    console.log(`          price:   ${price.id}  $14.95/mo`);
  }

  console.log("\nDone. Copy the price IDs above into your billing config.");
}

seedProducts().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
