import User from "../models/User.js";
import { FEATURE_FLAGS } from "../config/featureFlags.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

const TOP_RANDOM_MAX_WINNERS = 10;
const TOP_RANDOM_MIN_PURCHASES = 7;
const TOP_RANDOM_PRIZE = 10000;

const getCurrentWeekKey = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    );
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const isValidWeekString = (week = "") => /^\d{4}-W\d{2}$/.test(week);

const getWeekEnd = (week) => {
  const [yearStr, weekStr] = String(week).split("-W");
  const year = Number(yearStr);
  const weekNum = Number(weekStr);
  const jan4 = new Date(year, 0, 4);
  const day = (jan4.getDay() + 6) % 7;
  const weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - day + (weekNum - 1) * 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
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
    message: `${winner.username || "Your referral"} won ${gameLabel}. You earned ₦${bonus.toLocaleString()}.`,
  });

  await referrer.save();
  return bonus;
};

const runTopRandomWeeklyDrawIfNeeded = async (week) => {
  const now = Date.now();
  const weekEnd = getWeekEnd(week).getTime();
  const drawReady = now >= weekEnd;

  const eligibleUsers = await User.find({
    currentWeekKey: week,
    currentWeekPurchases: { $gte: TOP_RANDOM_MIN_PURCHASES },
  }).select("_id username topRandomMonthlyPicks notificationItems notifications currentWeekPurchases currentWeekKey");

  const eligibleCount = eligibleUsers.length;
  const maxWinnersForMonth = Math.min(TOP_RANDOM_MAX_WINNERS, eligibleCount);

  const existingWinnerUsers = await User.find({
    topRandomMonthlyPicks: {
      $elemMatch: {
        month: week,
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
    const existingPick = (user.topRandomMonthlyPicks || []).find((pick) => pick.month === week);

    if (existingPick) {
      existingPick.isWinner = true;
      existingPick.prizeAmount = Number(existingPick.prizeAmount || TOP_RANDOM_PRIZE);
      existingPick.claimed = false;
      existingPick.claimedAt = null;
      existingPick.selectedAt = new Date();
    } else {
      user.topRandomMonthlyPicks.push({
        month: week,
        isWinner: true,
        prizeAmount: TOP_RANDOM_PRIZE,
        claimed: false,
        claimedAt: null,
        selectedAt: new Date(),
      });
    }

    user.addNotification({
      type: "Top Random Weekly Picks",
      status: "success",
      amount: TOP_RANDOM_PRIZE,
      message: `You were selected in Top Random Weekly Picks for ${week}. Claim ₦${TOP_RANDOM_PRIZE.toLocaleString()} reward.`,
    });

    await user.save();
    await sendUserEmail({
      userId: user._id,
      type: "top_random_win",
      email: user.email,
      subject: "Top Random Weekly Picks",
      title: "You Were Selected",
      bodyLines: [
        `You were selected for Top Random Weekly Picks (${week}).`,
        `Reward: N${TOP_RANDOM_PRIZE.toLocaleString()}.`,
        "You can claim your reward now.",
      ],
    });
    await awardReferralReward({
      winner: user,
      prizeAmount: TOP_RANDOM_PRIZE,
      gameLabel: "Top Random Weekly Picks",
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
    const week = String(req.query.week || getCurrentWeekKey());
    if (!isValidWeekString(week)) {
      return res.status(400).json({
        success: false,
        message: "Invalid week format. Use YYYY-WW.",
      });
    }

    const drawMeta = await runTopRandomWeeklyDrawIfNeeded(week);
    const user = await User.findById(req.user.id).select(
      "username photo topRandomMonthlyPicks rewardBalance currentWeekPurchases currentWeekKey"
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const purchasesCount =
      user.currentWeekKey === week ? Number(user.currentWeekPurchases || 0) : 0;
    const hasBoughtForWeek = purchasesCount > 0;

    const myPick = (user.topRandomMonthlyPicks || []).find((pick) => pick.month === week);
    const isWinner = Boolean(myPick?.isWinner);
    const claimed = Boolean(myPick?.claimed);
    const claimable = isWinner && !claimed;
    const remaining = Math.max(0, TOP_RANDOM_MIN_PURCHASES - purchasesCount);
    const progress = TOP_RANDOM_MIN_PURCHASES
      ? Math.min(100, (purchasesCount / TOP_RANDOM_MIN_PURCHASES) * 100)
      : 0;

    return res.json({
      success: true,
      week,
      prizeAmount: TOP_RANDOM_PRIZE,
      maxWinners: TOP_RANDOM_MAX_WINNERS,
      required: TOP_RANDOM_MIN_PURCHASES,
      remaining,
      progress,
      drawReady: drawMeta.drawReady,
      drawCompleted: drawMeta.winnersCount >= drawMeta.maxWinnersForMonth && drawMeta.maxWinnersForMonth > 0,
      eligibleUsersCount: drawMeta.eligibleCount,
      winnersCount: drawMeta.winnersCount,
      user: {
        username: user.username,
        photo: user.photo || null,
        purchasesCount,
        hasBoughtForWeek,
        isWinner,
        claimed,
        claimable,
        claimedAt: myPick?.claimedAt || null,
        selectedAt: myPick?.selectedAt || null,
      },
    });
  } catch (error) {
    console.error("Get Top Random Weekly status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load Top Random Weekly status",
    });
  }
};

export const getTopRandomMonthlyWinners = async (req, res) => {
  try {
    const week = String(req.query.week || getCurrentWeekKey());
    if (!isValidWeekString(week)) {
      return res.status(400).json({
        success: false,
        message: "Invalid week format. Use YYYY-WW.",
      });
    }

    await runTopRandomWeeklyDrawIfNeeded(week);

    const winners = await User.find({
      topRandomMonthlyPicks: {
        $elemMatch: {
          month: week,
          isWinner: true,
        },
      },
    }).select("username photo topRandomMonthlyPicks");

    const items = winners
      .map((user) => {
        const pick = (user.topRandomMonthlyPicks || []).find(
          (entry) => entry.month === week && entry.isWinner
        );
        if (!pick) return null;
        return {
          userId: user._id,
          username: user.username,
          photo: user.photo || null,
          week,
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
      week,
      winners: items,
      count: items.length,
      maxWinners: TOP_RANDOM_MAX_WINNERS,
      prizeAmount: TOP_RANDOM_PRIZE,
    });
  } catch (error) {
    console.error("Get Top Random Weekly winners error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load Top Random Weekly winners",
    });
  }
};

export const claimTopRandomMonthlyReward = async (req, res) => {
  if (FEATURE_FLAGS.DISABLE_GAME_AND_REDEEM) {
    return res.status(403).json({
      success: false,
      message: "Top Random Weekly reward claiming is temporarily disabled for review.",
    });
  }

  try {
    const week = String(req.body?.week || getCurrentWeekKey());
    if (!isValidWeekString(week)) {
      return res.status(400).json({
        success: false,
        message: "Invalid week format. Use YYYY-WW.",
      });
    }

    await runTopRandomWeeklyDrawIfNeeded(week);

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const pick = (user.topRandomMonthlyPicks || []).find((entry) => entry.month === week);
    if (!pick || !pick.isWinner) {
      return res.status(400).json({
        success: false,
        message: "You are not a winner for this week",
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
      type: "Top Random Weekly Picks",
      status: "success",
      amount,
      message: `Top Random Weekly reward of ₦${amount.toLocaleString()} claimed for ${week}.`,
    });

    await user.save();

    await sendUserEmail({
      userId: user._id,
      type: "top_random_claim",
      email: user.email,
      subject: "Reward Claimed",
      title: "Top Random Reward Claimed",
      bodyLines: [
        `You claimed N${Number(amount).toLocaleString()} for ${week}.`,
        "Your reward balance has been updated.",
      ],
    });

    return res.json({
      success: true,
      message: "Top Random Weekly reward claimed successfully",
      week,
      claimedAmount: amount,
      rewardBalance: user.rewardBalance,
      mainBalance: user.mainBalance,
      claimedAt: pick.claimedAt,
    });
  } catch (error) {
    console.error("Claim Top Random Weekly reward error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to claim Top Random Weekly reward",
    });
  }
};




