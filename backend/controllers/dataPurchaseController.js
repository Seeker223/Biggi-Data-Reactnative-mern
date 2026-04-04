import DataPlan from "../models/DataPlan.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import { zenipointPost, generateReference } from "../utils/zenipoint.js";
import {
  logWalletTransaction,
  logWalletTransactionWithMeta,
  syncWalletBalance,
  updateWalletTransactionStatus,
  ensureWalletBalanceMatch,
} from "../utils/wallet.js";
import { verifyTransactionAuthorization } from "../utils/transactionAuth.js";
import { logPlatformDataPurchase } from "../utils/platformLedger.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

const mapZenipointPlanCode = (plan) => {
  const rawCode = String(plan?.zenipoint_code || plan?.plan_id || "").trim();
  const network = String(plan?.network || "").toLowerCase();

  if (network !== "airtel") return rawCode;

  // Airtel compatibility mapping for stale/internal ids vs provider ids.
  const airtelCodeMap = {
    airtel_750: "airtel_500",
    airtel_15: "airtel_1",
  };

  return airtelCodeMap[rawCode] || rawCode;
};

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Best-effort extraction: Zenipoint response formats can vary.
const extractZenipointAmount = (zenResponse) => {
  if (!zenResponse || typeof zenResponse !== "object") return null;
  const candidates = [
    zenResponse.amount,
    zenResponse.price,
    zenResponse?.data?.amount,
    zenResponse?.data?.price,
    zenResponse?.transaction?.amount,
    zenResponse?.transaction?.price,
    zenResponse?.data?.transaction?.amount,
    zenResponse?.data?.transaction?.price,
  ];
  for (const c of candidates) {
    const n = toNumberOrNull(c);
    if (n !== null) return n;
  }
  return null;
};

/**
 * Buy data bundle (production-ready)
 * - Uses plan.zenipoint_code
 * - Deducts user.mainBalance, logs transaction, calls Zenipoint
 * - Adds ticket reward on success
 * - Refunds on failure
 */
export const buyData = async (req, res) => {
  try {
    const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, msg: "Not authorized" });

    const { plan_id, mobile_no } = req.body;
    const biometricProof = String(req.body?.biometricProof || "").trim();
    const transactionPin = String(req.body?.transactionPin || "").trim();
    if (!plan_id || !mobile_no)
      return res.status(400).json({ success: false, msg: "plan_id and mobile_no required" });

    const normalizedPlanId = plan_id.trim().toLowerCase();
    const plan = await DataPlan.findOne({ plan_id: normalizedPlanId, active: true });
    if (!plan) return res.status(404).json({ success: false, msg: "Plan not found" });

    // Prevent legacy/unpriced plans from being purchased (causes provider/price mismatch).
    if (plan.provider_amount === null || plan.provider_amount === undefined) {
      return res.status(400).json({
        success: false,
        msg: "This plan is not available right now. Please refresh and select a different plan.",
      });
    }

    const user = await User.findById(userId).select("+transactionPinHash");
    if (!user) return res.status(404).json({ success: false, msg: "User not found" });

    const amount = Number(plan.amount);
    if (user.mainBalance < amount)
      return res.status(400).json({ success: false, msg: "Insufficient balance" });

    const authCheck = await verifyTransactionAuthorization({
      user,
      expectedAction: "data_purchase",
      expectedAmount: amount,
      biometricProof,
      transactionPin,
    });
    if (!authCheck.ok) {
      return res.status(400).json({
        success: false,
        msg: authCheck.message,
      });
    }

    // Create reference and prepare payload
    const reference = generateReference();
    const providerPlanCode = mapZenipointPlanCode(plan);
    const payload = { mobile_no, plan_id: providerPlanCode, reference };

    // Deduct user balance atomically (prevents double-spend on concurrent requests)
    const deductedUser = await User.findOneAndUpdate(
      { _id: userId, mainBalance: { $gte: amount } },
      { $inc: { mainBalance: -amount } },
      { new: true }
    );
    if (!deductedUser) {
      return res.status(400).json({ success: false, msg: "Insufficient balance" });
    }
    const balanceUser = deductedUser;

    // Sync wallet balance and log pending purchase
    await syncWalletBalance(userId);
    await logWalletTransactionWithMeta(userId, "purchase", amount, reference, "pending", {
      action: "data_purchase",
      plan_id: plan.plan_id,
      providerPlanCode,
      network: plan.network,
      category: plan.category,
      mobile_no,
    });

    let zenResponse;
    try {
      const response = await zenipointPost("/data", payload);
      zenResponse = response.data;
      console.log("Zenipoint raw response:", zenResponse);
    } catch (apiErr) {
      // Refund on network/API error
      await User.findByIdAndUpdate(userId, { $inc: { mainBalance: amount } });
      await syncWalletBalance(userId);
      const updated = await updateWalletTransactionStatus(
        userId,
        reference,
        "failed",
        {
          action: "data_purchase",
          plan_id: plan.plan_id,
          providerPlanCode,
          network: plan.network,
          category: plan.category,
          mobile_no,
          error: apiErr?.message || apiErr?.response?.data || "Zenipoint request failed",
          refundApplied: true,
        }
      );
      if (!updated) {
        await logWalletTransactionWithMeta(userId, "purchase", amount, reference, "failed", {
          action: "data_purchase",
          plan_id: plan.plan_id,
          providerPlanCode,
          network: plan.network,
          category: plan.category,
          mobile_no,
          error: apiErr?.message || apiErr?.response?.data || "Zenipoint request failed",
          refundApplied: true,
        });
      }
      await ensureWalletBalanceMatch(userId, "data_purchase_refund");

      await sendUserEmail({
        userId: userId,
        type: "data_purchase_failed",
        email: user.email,
        subject: "Data Purchase Failed",
        title: "Data Purchase Unsuccessful",
        bodyLines: [
          `We could not complete your data purchase for ${plan.name || plan.plan_id}.`,
          "Your balance was not deducted.",
          "Please try again later or contact support.",
        ],
      });

      return res.status(500).json({
        success: false,
        msg: "Zenipoint transaction failed",
        error: apiErr.message || apiErr.response?.data,
      });
    }

    // If simulated fallback
    if (zenResponse?.mode === "LOCAL_TEST_MODE") {
      if (isProd) {
        await User.findByIdAndUpdate(userId, { $inc: { mainBalance: amount } });
        await syncWalletBalance(userId);
        const updated = await updateWalletTransactionStatus(
          userId,
          reference,
          "failed",
          {
            action: "data_purchase",
            plan_id: plan.plan_id,
            providerPlanCode,
            network: plan.network,
            category: plan.category,
            mobile_no,
            mode: "LOCAL_TEST_MODE",
            refundApplied: true,
          }
        );
        if (!updated) {
          await logWalletTransactionWithMeta(userId, "purchase", amount, reference, "failed", {
            action: "data_purchase",
            plan_id: plan.plan_id,
            providerPlanCode,
            network: plan.network,
            category: plan.category,
            mobile_no,
            mode: "LOCAL_TEST_MODE",
            refundApplied: true,
          });
        }
        await ensureWalletBalanceMatch(userId, "data_purchase_refund_local_test");
        await sendUserEmail({
          userId: userId,
          type: "data_purchase_failed",
          email: user.email,
          subject: "Data Purchase Unavailable",
          title: "Provider Unavailable",
          bodyLines: [
            `We could not complete your data purchase for ${plan.name || plan.plan_id}.`,
            "Your balance was not deducted.",
            "Please try again shortly.",
          ],
        });
        return res.status(503).json({
          success: false,
          msg: "Data provider is currently unavailable. Please try again shortly.",
        });
      }

      const updated = await updateWalletTransactionStatus(
        userId,
        reference,
        "simulated",
        { action: "data_purchase", mode: "LOCAL_TEST_MODE" }
      );
      if (!updated) {
        await logWalletTransactionWithMeta(userId, "purchase", amount, reference, "simulated", {
          action: "data_purchase",
          mode: "LOCAL_TEST_MODE",
        });
      }

      const isMerchantRole = String(balanceUser?.userRole || "").toLowerCase() === "merchant";
      let updatedPurchaseUser = await balanceUser.updateMonthlyPurchase();
      updatedPurchaseUser = await updatedPurchaseUser.updateWeeklyPurchase();
      const weeklyPurchases = Number(updatedPurchaseUser.currentWeekPurchases || 0);
      if (isMerchantRole) {
        if (weeklyPurchases > 0 && weeklyPurchases % 7 === 0) {
          updatedPurchaseUser.tickets = (updatedPurchaseUser.tickets || 0) + 1;
          updatedPurchaseUser.addNotification({
            type: "Weekly Game Ticket",
            status: "success",
            message: "You earned 1 weekly game ticket for completing 7 purchases this week.",
          });
          await updatedPurchaseUser.save();
        }
      } else {
        updatedPurchaseUser.tickets = (updatedPurchaseUser.tickets || 0) + 1;
        await updatedPurchaseUser.save();
      }

      return res.status(200).json({
        success: true,
        msg: "Simulated success (LOCAL_TEST_MODE)",
        reference,
        providerPlanCode,
        plan,
        newBalance: balanceUser.mainBalance,
        tickets: updatedPurchaseUser.tickets,
        zenipoint: zenResponse,
      });
    }

    // Live success
    if (zenResponse?.status === "success" || zenResponse?.code === 200) {
      const providerAmount = extractZenipointAmount(zenResponse);
      const priceMismatch =
        providerAmount !== null && Number.isFinite(providerAmount) && providerAmount !== amount;

      const updated = await updateWalletTransactionStatus(
        userId,
        reference,
        priceMismatch ? "success_price_mismatch" : "success",
        {
          action: "data_purchase",
          plan_id: plan.plan_id,
          providerPlanCode,
          network: plan.network,
          category: plan.category,
          mobile_no,
          providerAmount,
          expectedAmount: amount,
          priceMismatch,
        }
      );
      if (!updated) {
        await logWalletTransactionWithMeta(
          userId,
          "purchase",
          amount,
          reference,
          priceMismatch ? "success_price_mismatch" : "success",
          {
            action: "data_purchase",
            plan_id: plan.plan_id,
            providerPlanCode,
            network: plan.network,
            category: plan.category,
            mobile_no,
            providerAmount,
            expectedAmount: amount,
            priceMismatch,
          }
        );
      }

      // Persist platform revenue/cost/profit so BiggiData margin is auditable.
      await logPlatformDataPurchase({
        userId,
        reference,
        plan,
        providerPlanCode,
        revenue: amount,
        providerAmount,
        zenipoint: zenResponse,
      });

      const isMerchantRole = String(balanceUser?.userRole || "").toLowerCase() === "merchant";
      let updatedPurchaseUser = await balanceUser.updateMonthlyPurchase();
      updatedPurchaseUser = await updatedPurchaseUser.updateWeeklyPurchase();
      const weeklyPurchases = Number(updatedPurchaseUser.currentWeekPurchases || 0);
      if (isMerchantRole) {
        if (weeklyPurchases > 0 && weeklyPurchases % 7 === 0) {
          updatedPurchaseUser.tickets = (updatedPurchaseUser.tickets || 0) + 1;
          updatedPurchaseUser.addNotification({
            type: "Weekly Game Ticket",
            status: "success",
            message: "You earned 1 weekly game ticket for completing 7 purchases this week.",
          });
          await updatedPurchaseUser.save();
        }
      } else {
        // Private users: 1 ticket per purchase
        updatedPurchaseUser.tickets = (updatedPurchaseUser.tickets || 0) + 1;
        await updatedPurchaseUser.save();
      }

      await sendUserEmail({
        userId: userId,
        type: "data_purchase_success",
        email: user.email,
        subject: "Data Purchase Successful",
        title: "Data Purchase Completed",
        bodyLines: [
          `Plan: ${plan.name || plan.plan_id}`,
          `Amount: N${Number(amount).toLocaleString()}`,
          `Phone: ${mobile_no}`,
          `Reference: ${reference}`,
        ],
      });

      return res.status(200).json({
        success: true,
        msg: zenResponse.message || "Data purchased successfully",
        reference,
        providerPlanCode,
        providerAmount,
        plan,
        zenipoint: zenResponse,
        newBalance: balanceUser.mainBalance,
        tickets: updatedPurchaseUser.tickets,
      });
    }

    // Zenipoint rejected (e.g., insufficient zeni wallet) => refund and log failed
    await User.findByIdAndUpdate(userId, { $inc: { mainBalance: amount } });
    await syncWalletBalance(userId);
    const updated = await updateWalletTransactionStatus(
      userId,
      reference,
      "failed",
      {
        action: "data_purchase",
        plan_id: plan.plan_id,
        providerPlanCode,
        network: plan.network,
        category: plan.category,
        mobile_no,
        zenipointStatus: zenResponse?.status || zenResponse?.code || "rejected",
        zenipointMessage: zenResponse?.message || "",
        refundApplied: true,
      }
    );
    if (!updated) {
      await logWalletTransactionWithMeta(userId, "purchase", amount, reference, "failed", {
        action: "data_purchase",
        plan_id: plan.plan_id,
        providerPlanCode,
        network: plan.network,
        category: plan.category,
        mobile_no,
        zenipointStatus: zenResponse?.status || zenResponse?.code || "rejected",
        zenipointMessage: zenResponse?.message || "",
        refundApplied: true,
      });
    }
    await ensureWalletBalanceMatch(userId, "data_purchase_refund_rejected");

    await sendUserEmail({
      userId: userId,
      type: "data_purchase_failed",
      email: user.email,
      subject: "Data Purchase Failed",
      title: "Data Purchase Unsuccessful",
      bodyLines: [
        `We could not complete your data purchase for ${plan.name || plan.plan_id}.`,
        "Your balance was not deducted.",
        zenResponse?.message ? `Reason: ${zenResponse.message}` : "Please try again.",
      ],
    });

    return res.status(400).json({
      success: false,
      msg: zenResponse?.message || "Zenipoint rejected transaction",
      zenipoint: zenResponse,
    });
  } catch (err) {
    console.error("BUY DATA ERROR:", err);
    return res.status(500).json({
      success: false,
      msg: "Server error during data purchase",
      error: err.message || err.response?.data,
    });
  }
};
