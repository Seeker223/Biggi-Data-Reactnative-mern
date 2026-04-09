import crypto from "crypto";
import User from "../models/User.js";
import { notifyAdmins } from "../utils/notifyAdmins.js";
import { sendUserEmail } from "../utils/transactionalEmail.js";

const PIN_RESET_TTL_MS = 10 * 60 * 1000;
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const hashOtp = (otp) =>
  crypto.createHash("sha256").update(String(otp)).digest("hex");

// -----------------------------------------------
// UPDATE PROFILE (name, phone, birthdate, etc)
// -----------------------------------------------
export const updateProfile = async (req, res) => {
  try {
    const updates = req.body;

    // prevent user from changing restricted fields
    delete updates.role;
    delete updates.password;

    const currentUser = await User.findById(req.user.id).select("referredByCode");
    if (!currentUser) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    if (updates.referredByCode) {
      if (currentUser.referredByCode) {
        return res.status(400).json({
          success: false,
          msg: "Referral code can only be set once",
        });
      }
      updates.referredByCode = String(updates.referredByCode).trim().toUpperCase();
      if (!updates.referredByCode) {
        delete updates.referredByCode;
      } else {
        const referrer = await User.findOne({ referralCode: updates.referredByCode }).select("_id");
        if (!referrer) {
          return res.status(400).json({
            success: false,
            msg: "Invalid referral code",
          });
        }
      }
    }

    if (updates.userRole) {
      const normalizedRole = String(updates.userRole).toLowerCase().trim();
      if (!["private", "merchant"].includes(normalizedRole)) {
        delete updates.userRole;
      } else {
        updates.userRole = normalizedRole;
      }
    }
    delete updates.email; // (frontend doesn’t update email)

    if (updates.bvn) {
      const bvn = String(updates.bvn || "").replace(/\D/g, "").trim();
      if (!/^\d{11}$/.test(bvn)) {
        return res.status(400).json({ success: false, msg: "BVN must be 11 digits." });
      }
      updates.bvn = bvn;
    }

    if (updates.nin) {
      const nin = String(updates.nin || "").replace(/\D/g, "").trim();
      if (!/^\d{11}$/.test(nin)) {
        return res.status(400).json({ success: false, msg: "NIN must be 11 digits." });
      }
      updates.nin = nin;
    }

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    const changedFields = Object.keys(updates || {}).filter(
      (key) => !["password", "role", "email"].includes(key)
    );
    await notifyAdmins({
      type: "User Update",
      status: "info",
      message: `Profile updated by ${user?.username || "a user"} (${user?.email || "unknown"}). Fields: ${changedFields.join(", ") || "profile details"}.`,
    });

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: err.message,
    });
  }
};

// -----------------------------------------------
// UPDATE AVATAR — your frontend uses FormData
// -----------------------------------------------
export const updateAvatar = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ success: false, msg: "No image uploaded" });

    // Using base64 buffer for Cloudinary or others
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // SAVE IMAGE PATH DIRECTLY (no Cloudinary in your code)
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { photo: base64Image },
      { new: true }
    ).select("-password");

    if (user) {
      user.addNotification({
        type: "Profile",
        status: "success",
        message: "Profile photo updated successfully.",
      });
      await user.save();
      await notifyAdmins({
        type: "User Update",
        status: "info",
        message: `Profile photo updated by ${user?.username || "a user"} (${user?.email || "unknown"}).`,
      });
    }

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: err.message,
    });
  }
};

// -----------------------------------------------
// GET USER NOTIFICATIONS
// -----------------------------------------------
export const getNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("notificationItems notifications");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      notifications: user.notificationItems || [],
      unread: Number(user.notifications || 0),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

// -----------------------------------------------
// MARK USER NOTIFICATIONS AS READ
// -----------------------------------------------
export const markNotificationsAsRead = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    (user.notificationItems || []).forEach((item) => {
      item.seen = true;
    });
    user.notifications = 0;
    await user.save();

    return res.json({
      success: true,
      message: "Notifications marked as read",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
    });
  }
};

// -----------------------------------------------
// GET USER REFERRALS
// -----------------------------------------------
export const getReferrals = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("referralCode");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.referralCode) {
      return res.json({ success: true, count: 0, referrals: [] });
    }

    const referrals = await User.find({ referredByCode: user.referralCode })
      .select("username photo state createdAt");

    return res.json({
      success: true,
      count: referrals.length,
      referrals,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referrals",
    });
  }
};


// -----------------------------------------------
// GET REFERRAL LEADERBOARD (MONTHLY)
// -----------------------------------------------
export const getReferralLeaderboard = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("referralCode username photo");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    const rows = await User.aggregate([
      {
        $match: {
          referredByCode: { $nin: [null, ""] },
          createdAt: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: "$referredByCode", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "referralCode",
          as: "referrer",
        },
      },
      { $unwind: "$referrer" },
      {
        $project: {
          _id: 0,
          referralCode: "$_id",
          count: 1,
          userId: "$referrer._id",
          username: "$referrer.username",
          photo: "$referrer.photo",
          state: "$referrer.state",
        },
      },
    ]);

    const leaderboard = rows.map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

    let myCount = 0;
    if (user.referralCode) {
      myCount = await User.countDocuments({
        referredByCode: user.referralCode,
        createdAt: { $gte: start, $lt: end },
      });
    }

    return res.json({
      success: true,
      month: { start, end },
      leaderboard,
      myCount,
      hasReferrals: myCount > 0,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referral leaderboard",
    });
  }
};// -----------------------------------------------
// GET TRANSACTION SECURITY STATUS
// -----------------------------------------------
export const getTransactionSecurityStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+transactionPinHash biometricAuth.enabled");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.json({
      success: true,
      security: {
        transactionPinEnabled: Boolean(user.transactionPinHash),
        biometricEnabled: Boolean(user.biometricAuth?.enabled),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transaction security status",
    });
  }
};

// -----------------------------------------------
// SET OR UPDATE TRANSACTION PIN (4 DIGITS)
// -----------------------------------------------
export const setTransactionPin = async (req, res) => {
  try {
    const pin = String(req.body?.pin || "").trim();
    const currentPin = String(req.body?.currentPin || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be exactly 4 digits",
      });
    }

    const user = await User.findById(req.user.id).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.transactionPinHash) {
      if (!/^\d{4}$/.test(currentPin)) {
        return res.status(400).json({
          success: false,
          message: "Current PIN is required to update PIN",
        });
      }
      const isCurrentPinValid = await user.matchTransactionPin(currentPin);
      if (!isCurrentPinValid) {
        return res.status(400).json({
          success: false,
          message: "Current PIN is incorrect",
        });
      }
    }

    await user.setTransactionPin(pin);
    user.addNotification({
      type: "Security",
      status: "success",
      message: "Transaction PIN updated successfully.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: "Transaction PIN saved successfully",
      transactionPinEnabled: true,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save transaction PIN",
    });
  }
};

// -----------------------------------------------
// DISABLE TRANSACTION PIN
// -----------------------------------------------
export const disableTransactionPin = async (req, res) => {
  try {
    const currentPin = String(req.body?.currentPin || "").trim();
    const user = await User.findById(req.user.id).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!user.transactionPinHash) {
      return res.json({
        success: true,
        message: "Transaction PIN already disabled",
        transactionPinEnabled: false,
      });
    }
    if (!/^\d{4}$/.test(currentPin)) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is required",
      });
    }
    const isPinValid = await user.matchTransactionPin(currentPin);
    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    user.transactionPinHash = null;
    user.addNotification({
      type: "Security",
      status: "info",
      message: "Transaction PIN disabled.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: "Transaction PIN disabled",
      transactionPinEnabled: false,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to disable transaction PIN",
    });
  }
};

// -----------------------------------------------
// VERIFY TRANSACTION PIN (WITHOUT CHANGING IT)
// -----------------------------------------------
export const verifyTransactionPin = async (req, res) => {
  try {
    const pin = String(req.body?.pin || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be exactly 4 digits",
      });
    }

    const user = await User.findById(req.user.id).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.transactionPinHash) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is not enabled for this account",
      });
    }

    const isValid = await user.matchTransactionPin(pin);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction PIN",
      });
    }

    return res.json({
      success: true,
      message: "PIN verified",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to verify transaction PIN",
    });
  }
};

// -----------------------------------------------
// REQUEST TRANSACTION PIN RESET (EMAIL OTP)
// -----------------------------------------------
export const requestTransactionPinReset = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "+transactionPinResetOtpHash +transactionPinResetExpires"
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const otp = generateOtp();
    user.transactionPinResetOtpHash = hashOtp(otp);
    user.transactionPinResetExpires = new Date(Date.now() + PIN_RESET_TTL_MS);
    await user.save({ validateBeforeSave: false });

    const emailResult = await sendUserEmail({
      userId: user._id,
      type: "transaction_pin_reset",
      email: user.email,
      subject: "Reset Transaction PIN",
      title: "Reset Transaction PIN",
      bodyLines: [
        "Use the 6-digit code below to reset your transaction PIN:",
        otp,
        "This code expires in 10 minutes.",
      ],
    });

    if (!emailResult?.success) {
      return res.status(500).json({
        success: false,
        message:
          emailResult?.reason === "type_disabled"
            ? "Email sending for PIN reset is disabled. Contact support."
            : emailResult?.reason === "rate_limited"
            ? "Too many attempts. Please try again later."
            : "Email service not configured. Please contact support.",
      });
    }

    return res.json({
      success: true,
      message: "Reset code sent to your email",
      expiresInSeconds: Math.floor(PIN_RESET_TTL_MS / 1000),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to request PIN reset",
    });
  }
};

// -----------------------------------------------
// CONFIRM TRANSACTION PIN RESET
// -----------------------------------------------
export const confirmTransactionPinReset = async (req, res) => {
  try {
    const otp = String(req.body?.otp || "").trim();
    const newPin = String(req.body?.pin || "").trim();

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "6-digit reset code is required",
      });
    }
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN must be exactly 4 digits",
      });
    }

    const user = await User.findById(req.user.id).select(
      "+transactionPinResetOtpHash +transactionPinResetExpires +transactionPinHash"
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.transactionPinResetOtpHash || !user.transactionPinResetExpires) {
      return res.status(400).json({
        success: false,
        message: "No active reset request. Please request a new code.",
      });
    }
    if (new Date(user.transactionPinResetExpires).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Reset code expired. Please request a new code.",
      });
    }

    const isMatch = user.transactionPinResetOtpHash === hashOtp(otp);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset code",
      });
    }

    await user.setTransactionPin(newPin);
    user.transactionPinResetOtpHash = null;
    user.transactionPinResetExpires = null;
    user.addNotification({
      type: "Security",
      status: "success",
      message: "Transaction PIN reset successfully.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: "Transaction PIN reset successfully",
      transactionPinEnabled: true,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to reset transaction PIN",
    });
  }
};


