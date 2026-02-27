import User from "../models/User.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";

const TOP_RANDOM_MAX_WINNERS = 10;
const TOP_RANDOM_PRIZE = 10000;

const getCurrentMonthString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const isValidMonthString = (month = "") => /^\d{4}-\d{2}$/.test(month);

const getMonthEnd = (month) => {
  const [year, monthNum] = String(month).split("-").map(Number);
  return new Date(year, monthNum, 0, 23, 59, 59, 999);
};

const shuffle = (arr = []) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const awardReferralReward = async ({ winner, prizeAmount, gameLabel }) => {
  const referralCode = winner?.referredByCode;
  if (!referralCode) return null;

  const referrer = await User.findOne({ referralCode }).select(
    "_id username rewardBalance totalPrizeWon referralRewardedUsers notificationItems notifications"
  );
  if (!referrer) return null;
  if (String(referrer._id) === String(winner._id)) return null;

  const alreadyRewarded = (referrer.referralRewardedUsers || []).some(
    (id) => String(id) === String(winner._id)
  );
  if (alreadyRewarded) return null;

  const bonus = Math.floor(Number(prizeAmount || 0) * 0.2);
  if (bonus <= 0) return null;

  referrer.rewardBalance = Number(referrer.rewardBalance || 0) + bonus;
  referrer.totalPrizeWon = Number(referrer.totalPrizeWon || 0) + bonus;
  referrer.referralRewardedUsers = [
    ...(referrer.referralRewardedUsers || []),
    winner._id,
  ];
  referrer.addNotification({
    type: "Referral Reward",
    status: "success",
    amount: bonus,
    message: `${winner.username || "Your referral"} won ${gameLabel}. You earned â‚¦${bonus.toLocaleString()}.`,
  });

  await referrer.save();
  return bonus;
};

const runTopRandomMonthlyDrawIfNeeded = async (month) => {
  const now = Date.now();
  const monthEnd = getMonthEnd(month).getTime();
  const drawReady = now >= monthEnd;

  const eligibleUsers = await User.find({
    monthlyDraws: {
      $elemMatch: {
        month,
        purchasesCount: { $gt: 0 },
      },
    },
  }).select("_id username topRandomMonthlyPicks notificationItems notifications");

  const eligibleCount = eligibleUsers.length;
  const maxWinnersForMonth = Math.min(TOP_RANDOM_MAX_WINNERS, eligibleCount);

  const existingWinnerUsers = await User.find({
    topRandomMonthlyPicks: {
      $elemMatch: {
        month,
        isWinner: true,
      },
    },
  }).select("_id");

  const existingWinnerIds = new Set(existingWinnerUsers.map((u) => String(u._id)));
  const currentWinnersCount = existingWinnerIds.size;

  if (!drawReady || maxWinnersForMonth === 0 || currentWinnersCount >= maxWinnersForMonth) {
    return {
      drawReady,
      eligibleCount,
      winnersCount: currentWinnersCount,
      maxWinnersForMonth,
      selectedNow: 0,
    };
  }

  const remainingSlots = maxWinnersForMonth - currentWinnersCount;
  const candidateUsers = eligibleUsers.filter((u) => !existingWinnerIds.has(String(u._id)));
  const selectedUsers = shuffle(candidateUsers).slice(0, remainingSlots);

  for (const user of selectedUsers) {
    const existingPick = (user.topRandomMonthlyPicks || []).find((pick) => pick.month === month);

    if (existingPick) {
      existingPick.isWinner = true;
      existingPick.prizeAmount = Number(existingPick.prizeAmount || TOP_RANDOM_PRIZE);
      existingPick.claimed = false;
      existingPick.claimedAt = null;
      existingPick.selectedAt = new Date();
    } else {
      user.topRandomMonthlyPicks.push({
        month,
        isWinner: true,
        prizeAmount: TOP_RANDOM_PRIZE,
        claimed: false,
        claimedAt: null,
        selectedAt: new Date(),
      });
    }

    user.addNotification({
      type: "Top Random Monthly Picks",
      status: "success",
      amount: TOP_RANDOM_PRIZE,
      message: `You were selected in Top Random Monthly Picks for ${month}. Claim â‚¦${TOP_RANDOM_PRIZE.toLocaleString()} reward.`,
    });

    await user.save();
    await awardReferralReward({
      winner: user,
      prizeAmount: TOP_RANDOM_PRIZE,
      gameLabel: "Top Random Monthly Picks",
    });
  }

  return {
    drawReady,
    eligibleCount,
    winnersCount: currentWinnersCount + selectedUsers.length,
    maxWinnersForMonth,
    selectedNow: selectedUsers.length,
  };
};

export const getTopRandomMonthlyStatus = async (req, res) => {
  try {
    const month = String(req.query.month || getCurrentMonthString());
    if (!isValidMonthString(month)) {
      return res.status(400).json({
        success: false,
        message: "Invalid month format. Use YYYY-MM.",
      });
    }

    const drawMeta = await runTopRandomMonthlyDrawIfNeeded(month);
    const user = await User.findById(req.user.id).select(
      "username photo monthlyDraws topRandomMonthlyPicks rewardBalance"
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const monthlyPurchase = (user.monthlyDraws || []).find((m) => m.month === month);
    const purchasesCount = Number(monthlyPurchase?.purchasesCount || 0);
    const hasBoughtForMonth = purchasesCount > 0;

    const myPick = (user.topRandomMonthlyPicks || []).find((pick) => pick.month === month);
    const isWinner = Boolean(myPick?.isWinner);
    const claimed = Boolean(myPick?.claimed);
    const claimable = isWinner && !claimed;

    return res.json({
      success: true,
      month,
      prizeAmount: TOP_RANDOM_PRIZE,
      maxWinners: TOP_RANDOM_MAX_WINNERS,
      drawReady: drawMeta.drawReady,
      drawCompleted: drawMeta.winnersCount >= drawMeta.maxWinnersForMonth && drawMeta.maxWinnersForMonth > 0,
      eligibleUsersCount: drawMeta.eligibleCount,
      winnersCount: drawMeta.winnersCount,
      user: {
        username: user.username,
        photo: user.photo || null,
        purchasesCount,
        hasBoughtForMonth,
        isWinner,
        claimed,
        claimable,
        claimedAt: myPick?.claimedAt || null,
        selectedAt: myPick?.selectedAt || null,
      },
    });
  } catch (error) {
    console.error("Get Top Random Monthly status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load Top Random Monthly status",
    });
  }
};

export const getTopRandomMonthlyWinners = async (req, res) => {
  try {
    const month = String(req.query.month || getCurrentMonthString());
    if (!isValidMonthString(month)) {
      return res.status(400).json({
        success: false,
        message: "Invalid month format. Use YYYY-MM.",
      });
    }

    await runTopRandomMonthlyDrawIfNeeded(month);

    const winners = await User.find({
      topRandomMonthlyPicks: {
        $elemMatch: {
          month,
          isWinner: true,
        },
      },
    }).select("username photo topRandomMonthlyPicks");

    const items = winners
      .map((user) => {
        const pick = (user.topRandomMonthlyPicks || []).find(
          (entry) => entry.month === month && entry.isWinner
        );
        if (!pick) return null;
        return {
          userId: user._id,
          username: user.username,
          photo: user.photo || null,
          month,
          amount: Number(pick.prizeAmount || TOP_RANDOM_PRIZE),
          claimed: Boolean(pick.claimed),
          claimedAt: pick.claimedAt || null,
          selectedAt: pick.selectedAt || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.selectedAt || 0).getTime() - new Date(a.selectedAt || 0).getTime());

    return res.json({
      success: true,
      month,
      winners: items,
      count: items.length,
      maxWinners: TOP_RANDOM_MAX_WINNERS,
      prizeAmount: TOP_RANDOM_PRIZE,
    });
  } catch (error) {
    console.error("Get Top Random Monthly winners error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load Top Random Monthly winners",
    });
  }
};

export const claimTopRandomMonthlyReward = async (req, res) => {
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Top Random Monthly reward claiming is temporarily disabled for review.",
    });
  }

  try {
    const month = String(req.body?.month || getCurrentMonthString());
    if (!isValidMonthString(month)) {
      return res.status(400).json({
        success: false,
        message: "Invalid month format. Use YYYY-MM.",
      });
    }

    await runTopRandomMonthlyDrawIfNeeded(month);

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const pick = (user.topRandomMonthlyPicks || []).find((entry) => entry.month === month);
    if (!pick || !pick.isWinner) {
      return res.status(400).json({
        success: false,
        message: "You are not a winner for this month",
      });
    }

    if (pick.claimed) {
      return res.status(400).json({
        success: false,
        message: "Reward already claimed",
      });
    }

    const amount = Number(pick.prizeAmount || TOP_RANDOM_PRIZE);
    pick.claimed = true;
    pick.claimedAt = new Date();
    user.rewardBalance = Number(user.rewardBalance || 0) + amount;
    user.totalPrizeWon = Number(user.totalPrizeWon || 0) + amount;
    user.totalWins = Number(user.totalWins || 0) + 1;

    user.addNotification({
      type: "Top Random Monthly Picks",
      status: "success",
      amount,
      message: `Top Random Monthly reward of â‚¦${amount.toLocaleString()} claimed for ${month}.`,
    });

    await user.save();

    return res.json({
      success: true,
      message: "Top Random Monthly reward claimed successfully",
      month,
      claimedAmount: amount,
      rewardBalance: user.rewardBalance,
      mainBalance: user.mainBalance,
      claimedAt: pick.claimedAt,
    });
  } catch (error) {
    console.error("Claim Top Random Monthly reward error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to claim Top Random Monthly reward",
    });
  }
};


