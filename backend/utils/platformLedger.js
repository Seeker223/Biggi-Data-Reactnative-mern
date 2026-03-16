import PlatformLedger from "../models/PlatformLedger.js";

const pickProviderSnippet = (zenResponse) => {
  if (!zenResponse || typeof zenResponse !== "object") return {};
  // Keep only small, useful fields (avoid huge payloads).
  const out = {};
  for (const k of ["status", "code", "message", "reference", "ref", "transaction_id", "data"]) {
    if (zenResponse[k] !== undefined) out[k] = zenResponse[k];
  }
  return out;
};

export const logPlatformDataPurchase = async ({
  userId,
  reference,
  plan,
  providerPlanCode,
  revenue,
  providerAmount,
  zenipoint,
}) => {
  try {
    const cost =
      Number.isFinite(Number(plan?.provider_amount)) && plan?.provider_amount !== null
        ? Number(plan.provider_amount)
        : Number.isFinite(Number(providerAmount))
          ? Number(providerAmount)
          : null;

    const profit =
      cost === null || !Number.isFinite(cost) ? null : Number(revenue) - Number(cost);

    await PlatformLedger.create({
      type: "data_purchase",
      userId,
      reference,
      network: String(plan?.network || ""),
      category: String(plan?.category || ""),
      plan_id: String(plan?.plan_id || ""),
      providerPlanCode: String(providerPlanCode || ""),
      revenue: Number(revenue),
      cost,
      profit,
      provider: pickProviderSnippet(zenipoint),
    });
  } catch (err) {
    console.error("Platform ledger log failed:", err?.message || err);
  }
};
export const logPlatformDepositFee = async ({ userId, reference, revenue }) => {
  try {
    const amt = Number(revenue || 0);
    if (!Number.isFinite(amt) || amt <= 0) return;
    await PlatformLedger.create({
      type: "deposit_fee",
      userId,
      reference: String(reference || ""),
      revenue: amt,
      cost: 0,
      profit: amt,
      provider: {},
    });
  } catch (err) {
    console.error("Platform deposit fee log failed:", err?.message || err);
  }
};
