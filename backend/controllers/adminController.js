import User from "../models/User.js";
import Deposit from "../models/Deposit.js";
import Withdraw from "../models/withdrawModel.js";
import Wallet from "../models/Wallet.js";

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeSlice = (arr, max = 10) => (Array.isArray(arr) ? arr.slice(0, max) : []);
const USER_PUBLIC_SELECT =
  "-password -transactionPinHash -refreshToken -refreshTokenExpiresAt -refreshTokenRememberMe -__v";

export const getAdminDashboard = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const historyLimit = Math.min(50, Math.max(1, toInt(req.query.historyLimit, 10)));
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "").trim().toLowerCase();
    const userRole = String(req.query.userRole || "").trim().toLowerCase();
    const verified = String(req.query.verified || "").trim().toLowerCase();

    const filter = {};
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { referralCode: { $regex: search, $options: "i" } },
      ];
    }
    if (["user", "admin"].includes(role)) filter.role = role;
    if (["private", "merchant"].includes(userRole)) filter.userRole = userRole;
    if (["true", "false"].includes(verified)) filter.isVerified = verified === "true";

    const [totalUsers, usersRaw, aggregates] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.aggregate([
        {
          $group: {
            _id: null,
            totalMainBalance: { $sum: "$mainBalance" },
            totalRewardBalance: { $sum: "$rewardBalance" },
            totalDeposits: { $sum: "$totalDeposits" },
            totalDataPurchases: { $sum: "$dataBundleCount" },
            totalWins: { $sum: "$totalWins" },
            totalPrizeWon: { $sum: "$totalPrizeWon" },
            usersCount: { $sum: 1 },
            adminCount: {
              $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] },
            },
            privateCount: {
              $sum: { $cond: [{ $eq: ["$userRole", "private"] }, 1, 0] },
            },
            merchantCount: {
              $sum: { $cond: [{ $eq: ["$userRole", "merchant"] }, 1, 0] },
            },
            verifiedCount: {
              $sum: { $cond: [{ $eq: ["$isVerified", true] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const userIds = usersRaw.map((u) => u._id);

    const [deposits, withdrawals, wallets, topBuyers, topWinners] = await Promise.all([
      Deposit.find({ user: { $in: userIds } })
        .sort({ createdAt: -1 })
        .limit(500)
        .select("user amount currency reference status channel createdAt updatedAt")
        .lean(),
      Withdraw.find({ user: { $in: userIds } })
        .sort({ createdAt: -1 })
        .limit(500)
        .select("user amount status method bank accountNumber accountName createdAt updatedAt")
        .lean(),
      Wallet.find({ userId: { $in: userIds } })
        .select("userId type balance currency transactions lastUpdated")
        .lean(),
      User.find({})
        .sort({ dataBundleCount: -1, totalDeposits: -1 })
        .limit(100)
        .select("username email photo role userRole dataBundleCount totalDeposits")
        .lean(),
      User.find({})
        .sort({ totalWins: -1, totalPrizeWon: -1 })
        .limit(100)
        .select("username email photo role userRole totalWins totalPrizeWon")
        .lean(),
    ]);

    const walletMap = new Map(wallets.map((w) => [String(w.userId), w]));
    const depositsByUser = deposits.reduce((acc, item) => {
      const key = String(item.user);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    const withdrawalsByUser = withdrawals.reduce((acc, item) => {
      const key = String(item.user);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    const users = usersRaw.map((user) => {
      const dailyPlays = Array.isArray(user.dailyNumberDraw) ? user.dailyNumberDraw.length : 0;
      const dailyWins = Array.isArray(user.dailyNumberDraw)
        ? user.dailyNumberDraw.filter((x) => x?.isWinner).length
        : 0;
      const monthlyEntries = Array.isArray(user.monthlyDraws) ? user.monthlyDraws.length : 0;
      const monthlyWins = Array.isArray(user.monthlyDraws)
        ? user.monthlyDraws.filter((x) => x?.isWinner).length
        : 0;
      const topRandomEntries = Array.isArray(user.topRandomMonthlyPicks)
        ? user.topRandomMonthlyPicks.length
        : 0;
      const topRandomWins = Array.isArray(user.topRandomMonthlyPicks)
        ? user.topRandomMonthlyPicks.filter((x) => x?.isWinner).length
        : 0;

      const wallet = walletMap.get(String(user._id));
      const purchaseHistory = safeSlice(
        (wallet?.transactions || [])
          .filter((t) => t?.type === "purchase")
          .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
        historyLimit
      );
      const redeemHistory = safeSlice(
        (wallet?.transactions || [])
          .filter((t) => t?.type === "redeem")
          .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
        historyLimit
      );

      const totalBalance = toNum(user.mainBalance) + toNum(user.rewardBalance);
      const totalGameWins = dailyWins + monthlyWins + topRandomWins;
      const totalGamePlays = dailyPlays + monthlyEntries + topRandomEntries;

      return {
        id: user._id,
        personal: {
          username: user.username,
          email: user.email,
          phoneNumber: user.phoneNumber,
          state: user.state,
          birthDate: user.birthDate,
          photo: user.photo,
          isVerified: Boolean(user.isVerified),
          verifiedAt: user.verifiedAt,
          role: user.role,
          userRole: user.userRole,
          referralCode: user.referralCode,
          referredByCode: user.referredByCode,
          referredUsersCount: Array.isArray(user.referralRewardedUsers)
            ? user.referralRewardedUsers.length
            : 0,
          lastLogin: user.lastLogin,
          lastLogout: user.lastLogout,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        balances: {
          mainBalance: toNum(user.mainBalance),
          rewardBalance: toNum(user.rewardBalance),
          totalBalance,
          totalDeposits: toNum(user.totalDeposits),
          tickets: toNum(user.tickets),
          dataBundleCount: toNum(user.dataBundleCount),
        },
        games: {
          daily: {
            plays: dailyPlays,
            wins: dailyWins,
            losses: Math.max(0, dailyPlays - dailyWins),
            latest: safeSlice(
              [...(user.dailyNumberDraw || [])].sort(
                (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
              ),
              historyLimit
            ),
          },
          monthly: {
            entries: monthlyEntries,
            wins: monthlyWins,
            losses: Math.max(0, monthlyEntries - monthlyWins),
            latest: safeSlice(
              [...(user.monthlyDraws || [])].sort(
                (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
              ),
              historyLimit
            ),
          },
          topRandomMonthly: {
            entries: topRandomEntries,
            wins: topRandomWins,
            losses: Math.max(0, topRandomEntries - topRandomWins),
            latest: safeSlice(
              [...(user.topRandomMonthlyPicks || [])].sort(
                (a, b) => new Date(b.selectedAt || 0) - new Date(a.selectedAt || 0)
              ),
              historyLimit
            ),
          },
          totalGamePlays,
          totalGameWins,
          totalGameLosses: Math.max(0, totalGamePlays - totalGameWins),
          totalPrizeWon: toNum(user.totalPrizeWon),
        },
        history: {
          deposits: safeSlice(
            (depositsByUser[String(user._id)] || []).sort(
              (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
            ),
            historyLimit
          ),
          withdrawals: safeSlice(
            (withdrawalsByUser[String(user._id)] || []).sort(
              (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
            ),
            historyLimit
          ),
          purchases: purchaseHistory,
          redeems: redeemHistory,
          walletTransactions: safeSlice(
            [...(wallet?.transactions || [])].sort(
              (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
            ),
            historyLimit
          ),
        },
      };
    });

    const summaryBase = aggregates?.[0] || {};
    const response = {
      success: true,
      summary: {
        usersCount: toNum(summaryBase.usersCount),
        adminCount: toNum(summaryBase.adminCount),
        userCount: Math.max(0, toNum(summaryBase.usersCount) - toNum(summaryBase.adminCount)),
        privateCount: toNum(summaryBase.privateCount),
        merchantCount: toNum(summaryBase.merchantCount),
        verifiedCount: toNum(summaryBase.verifiedCount),
        unverifiedCount: Math.max(0, toNum(summaryBase.usersCount) - toNum(summaryBase.verifiedCount)),
        totalMainBalance: toNum(summaryBase.totalMainBalance),
        totalRewardBalance: toNum(summaryBase.totalRewardBalance),
        totalBalance: toNum(summaryBase.totalMainBalance) + toNum(summaryBase.totalRewardBalance),
        totalDeposits: toNum(summaryBase.totalDeposits),
        totalDataPurchases: toNum(summaryBase.totalDataPurchases),
        totalWins: toNum(summaryBase.totalWins),
        totalPrizeWon: toNum(summaryBase.totalPrizeWon),
      },
      rankings: {
        topBuyers: topBuyers.map((u, index) => ({
          rank: index + 1,
          userId: u._id,
          username: u.username,
          email: u.email,
          photo: u.photo,
          role: u.role,
          userRole: u.userRole,
          dataBundleCount: toNum(u.dataBundleCount),
          totalDeposits: toNum(u.totalDeposits),
        })),
        topGameWinners: topWinners.map((u, index) => ({
          rank: index + 1,
          userId: u._id,
          username: u.username,
          email: u.email,
          photo: u.photo,
          role: u.role,
          userRole: u.userRole,
          totalWins: toNum(u.totalWins),
          totalPrizeWon: toNum(u.totalPrizeWon),
        })),
      },
      users,
      pagination: {
        page,
        limit,
        totalUsers,
        totalPages: Math.max(1, Math.ceil(totalUsers / limit)),
      },
      filters: {
        search,
        role: role || null,
        userRole: userRole || null,
        verified: verified || null,
      },
      generatedAt: new Date().toISOString(),
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load admin dashboard",
      error: error.message,
    });
  }
};

export const getAdminUsers = async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "").trim().toLowerCase();
    const userRole = String(req.query.userRole || "").trim().toLowerCase();

    const filter = {};
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }
    if (["user", "admin"].includes(role)) filter.role = role;
    if (["private", "merchant"].includes(userRole)) filter.userRole = userRole;

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select(USER_PUBLIC_SELECT)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};

export const getAdminUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(USER_PUBLIC_SELECT);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid user id",
      error: error.message,
    });
  }
};

export const createAdminUser = async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.userRole && !["private", "merchant"].includes(String(payload.userRole).toLowerCase())) {
      return res.status(400).json({ success: false, message: "Invalid userRole" });
    }
    if (payload.role && !["user", "admin"].includes(String(payload.role).toLowerCase())) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    if (payload.userRole) payload.userRole = String(payload.userRole).toLowerCase();
    if (payload.role) payload.role = String(payload.role).toLowerCase();

    const user = await User.create(payload);
    const safeUser = await User.findById(user._id).select(USER_PUBLIC_SELECT);
    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: safeUser,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Failed to create user",
      error: error.message,
    });
  }
};

export const updateAdminUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("+password +transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const payload = { ...req.body };
    const allowed = [
      "username",
      "email",
      "phoneNumber",
      "birthDate",
      "state",
      "role",
      "userRole",
      "isVerified",
      "verifiedAt",
      "photo",
      "mainBalance",
      "rewardBalance",
      "totalDeposits",
      "dataBundleCount",
      "tickets",
      "notifications",
      "password",
      "referredByCode",
      "lastLogin",
      "lastLogout",
    ];

    for (const key of Object.keys(payload)) {
      if (!allowed.includes(key)) continue;
      if (key === "role") {
        const val = String(payload.role || "").toLowerCase();
        if (!["user", "admin"].includes(val)) {
          return res.status(400).json({ success: false, message: "Invalid role" });
        }
        user.role = val;
        continue;
      }
      if (key === "userRole") {
        const val = String(payload.userRole || "").toLowerCase();
        if (val && !["private", "merchant"].includes(val)) {
          return res.status(400).json({ success: false, message: "Invalid userRole" });
        }
        user.userRole = val || null;
        continue;
      }
      user[key] = payload[key];
    }

    await user.save();
    const safeUser = await User.findById(user._id).select(USER_PUBLIC_SELECT);
    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: safeUser,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Failed to update user",
      error: error.message,
    });
  }
};

export const deleteAdminUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await Promise.all([
      Wallet.deleteMany({ userId: user._id }),
      Deposit.deleteMany({ user: user._id }),
      Withdraw.deleteMany({ user: user._id }),
      User.findByIdAndDelete(user._id),
    ]);

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete user",
      error: error.message,
    });
  }
};
